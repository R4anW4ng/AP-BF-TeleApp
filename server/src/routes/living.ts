import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { authorSelect, cellGroupSelect, PageQuerySchema, pageArgs, text, toPage, viewerOf } from "../lib/feed.js";
import { currentUser, HttpError } from "../lib/http.js";
import { feedAuthor, type Viewer } from "../lib/privacy.js";
import { deleteObjects, imageUpload, MAX_IMAGES_PER_POST, mediaUrl, type Storage, storeImages } from "../lib/storage.js";
import { campaignInfo } from "../lib/time.js";
import { userLimiter } from "../middleware/rateLimit.js";
import { awardPoints } from "../services/points.js";

const livingInclude = {
  author: { select: authorSelect },
  cellGroup: { select: cellGroupSelect },
  media: { orderBy: { sortOrder: "asc" as const }, select: { id: true, storageKey: true, width: true, height: true } },
};

type LivingRow = Awaited<ReturnType<typeof prisma.livingPost.findMany<{ include: typeof livingInclude }>>>[number];

async function livingDto(p: LivingRow, viewer: Viewer, storage: Storage) {
  return {
    id: p.id,
    content: p.content,
    weekNumber: p.weekNumber,
    createdAt: p.createdAt,
    author: feedAuthor(p.author, p.isAnonymous, viewer),
    cellGroup: p.cellGroup,
    images: await Promise.all(
      p.media.map(async (m) => ({ id: m.id, url: await mediaUrl(storage, m.storageKey), width: m.width, height: m.height })),
    ),
  };
}

const ListQuerySchema = PageQuerySchema.extend({
  /** Cell Group code, e.g. "AP1". Omit or "ALL" for every group. */
  zone: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,16}$/)
    .transform((z) => z.toUpperCase())
    .optional(),
});

/** Multipart text fields arrive as strings. */
const CreateLivingSchema = z
  .object({
    content: text(2000),
    isAnonymous: z
      .enum(["true", "false"])
      .optional()
      .transform((v) => v === "true"),
  })
  .strict();

export function livingRouter({ storage }: { storage: Storage }): Router {
  const router = Router();

  /** GET /api/living?zone=AP1&cursor=&limit= */
  router.get("/", async (req, res) => {
    const viewer = viewerOf(currentUser(req));
    const { zone, ...page } = ListQuerySchema.parse(req.query);
    const rows = await prisma.livingPost.findMany({
      where: { hiddenAt: null, ...(zone && zone !== "ALL" ? { cellGroup: { code: zone } } : {}) },
      include: livingInclude,
      ...pageArgs(page),
    });
    const { items, nextCursor } = toPage(rows, page.limit);
    res.json({ items: await Promise.all(items.map((p) => livingDto(p, viewer, storage))), nextCursor });
  });

  /**
   * POST /api/living — multipart/form-data: `content`, optional `isAnonymous`, 0–4 files in `images`.
   * Photos go through the same pipeline as /api/uploads (re-encoded, GPS stripped, stored in R2).
   * Awards LIVING_POST points (10, max 2 per SGT day); a post past the cap is still published.
   */
  router.post("/", userLimiter(60 * 60_000, 20), imageUpload.array("images", MAX_IMAGES_PER_POST), async (req, res) => {
    const user = currentUser(req);
    const input = CreateLivingSchema.parse(req.body);
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length > 0 && !storage.configured) {
      throw new HttpError(503, "STORAGE_UNAVAILABLE", "Photo uploads are not configured on this server");
    }

    const images = await storeImages(storage, "LIVING_POST", files.map((f) => f.buffer));
    let post: LivingRow;
    try {
      post = await prisma.livingPost.create({
        data: {
          authorId: user.id,
          cellGroupId: user.cellGroupId,
          content: input.content,
          isAnonymous: input.isAnonymous,
          weekNumber: campaignInfo(config.CAMPAIGN_START, config.CAMPAIGN_END).weekNumber ?? 0,
          media: {
            create: images.map((img, i) => ({
              kind: "LIVING_POST" as const,
              storageKey: img.storageKey,
              mimeType: img.contentType,
              sizeBytes: img.body.length,
              width: img.width,
              height: img.height,
              sortOrder: i,
              uploaderId: user.id,
            })),
          },
        },
        include: livingInclude,
      });
    } catch (e) {
      await deleteObjects(storage, images.map((img) => img.storageKey));
      throw e;
    }

    const points = await awardPoints(user.id, "LIVING_POST", { sourceId: post.id });
    res.status(201).json({ post: await livingDto(post, viewerOf(user), storage), points });
  });

  return router;
}

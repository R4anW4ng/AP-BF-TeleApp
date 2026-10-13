import { randomBytes } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import type { Testimony, User } from "../generated/prisma/client.js";
import { text } from "../lib/feed.js";
import { currentUser, HttpError, idParam } from "../lib/http.js";
import { deleteObjects, mediaUrl, type Storage } from "../lib/storage.js";
import { requireAdmin } from "../middleware/telegramAuth.js";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

/** Structured content: rendered as plain React elements, so there is no HTML/XSS surface. */
const BlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("heading"), text: text(200) }).strict(),
  z.object({ type: z.literal("paragraph"), text: text(5000) }).strict(),
  z.object({ type: z.literal("quote"), text: text(1000), cite: optionalText(200) }).strict(),
  z.object({ type: z.literal("image"), mediaId: z.string().min(1).max(64), caption: optionalText(300) }).strict(),
]);
export type TestimonyBlock = z.infer<typeof BlockSchema>;

const UpsertSchema = z
  .object({
    title: text(200),
    subtitle: optionalText(300),
    byline: optionalText(120),
    coverMediaId: z.string().min(1).max(64).nullish().transform((v) => v ?? null),
    blocks: z.array(BlockSchema).min(1).max(200),
    status: z.enum(["DRAFT", "PUBLISHED"]).default("DRAFT"),
  })
  .strict();
type UpsertInput = z.infer<typeof UpsertSchema>;

function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_-]+/g, "-")
    .slice(0, 60);
  return `${base || "testimony"}-${randomBytes(3).toString("hex")}`;
}

function blocksOf(t: Pick<Testimony, "blocks">): TestimonyBlock[] {
  return t.blocks as TestimonyBlock[];
}

function excerpt(blocks: TestimonyBlock[]): string | null {
  const first = blocks.find((b) => b.type === "paragraph");
  if (!first || first.type !== "paragraph") return null;
  return first.text.length > 200 ? `${first.text.slice(0, 199).trimEnd()}…` : first.text;
}

/**
 * Every referenced image must be a TESTIMONY upload that is unattached or
 * already belongs to this testimony; returns the ids to attach.
 */
async function validateMedia(input: UpsertInput, testimonyId: string | null): Promise<string[]> {
  const blockIds = input.blocks.flatMap((b) => (b.type === "image" ? [b.mediaId] : []));
  const ids = [...new Set([...blockIds, ...(input.coverMediaId ? [input.coverMediaId] : [])])];
  if (ids.length === 0) return [];

  const media = await prisma.media.findMany({
    where: { id: { in: ids } },
    select: { id: true, kind: true, testimonyId: true, livingPostId: true, coverOf: { select: { id: true } } },
  });
  const usable = media.filter(
    (m) =>
      m.kind === "TESTIMONY" &&
      m.livingPostId === null &&
      (m.testimonyId === null || m.testimonyId === testimonyId) &&
      (m.coverOf === null || m.coverOf.id === testimonyId),
  );
  if (usable.length !== ids.length) {
    throw new HttpError(400, "VALIDATION_ERROR", "One or more images are missing or belong to another post");
  }
  return ids;
}

async function audit(actor: User, action: "TESTIMONY_CREATE" | "TESTIMONY_UPDATE" | "TESTIMONY_DELETE", t: Testimony) {
  await prisma.auditLog.create({
    data: { actorId: actor.id, action, targetType: "Testimony", targetId: t.id, metadata: { title: t.title } },
  });
}

export function testimoniesRouter({ storage }: { storage: Storage }): Router {
  const router = Router();

  async function summaryDto(t: Testimony & { coverMedia: { storageKey: string } | null }) {
    return {
      id: t.id,
      slug: t.slug,
      title: t.title,
      subtitle: t.subtitle,
      byline: t.byline,
      status: t.status,
      publishedAt: t.publishedAt,
      coverUrl: t.coverMedia ? await mediaUrl(storage, t.coverMedia.storageKey) : null,
      excerpt: excerpt(blocksOf(t)),
    };
  }

  async function fullDto(t: Testimony & { coverMedia: { storageKey: string } | null }) {
    const blocks = blocksOf(t);
    const imageIds = blocks.flatMap((b) => (b.type === "image" ? [b.mediaId] : []));
    const media = await prisma.media.findMany({
      where: { id: { in: imageIds } },
      select: { id: true, storageKey: true, width: true, height: true },
    });
    const byId = new Map(media.map((m) => [m.id, m]));
    return {
      ...(await summaryDto(t)),
      updatedAt: t.updatedAt,
      blocks: await Promise.all(
        blocks.map(async (b) => {
          if (b.type !== "image") return b;
          const m = byId.get(b.mediaId);
          return { ...b, url: m ? await mediaUrl(storage, m.storageKey) : null, width: m?.width ?? null, height: m?.height ?? null };
        }),
      ),
    };
  }

  const withCover = { coverMedia: { select: { storageKey: true } } };

  /** GET /api/testimonies — published only; admins may add ?status=all to include drafts. */
  router.get("/", async (req, res) => {
    const user = currentUser(req);
    const includeDrafts = user.role === "ADMIN" && req.query.status === "all";
    const rows = await prisma.testimony.findMany({
      where: includeDrafts ? {} : { status: "PUBLISHED" },
      include: withCover,
      orderBy: [{ publishedAt: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }],
      take: 100,
    });
    res.json({ items: await Promise.all(rows.map(summaryDto)) });
  });

  /** GET /api/testimonies/:id — by id or slug. Drafts are visible to admins only. */
  router.get("/:id", async (req, res) => {
    const key = idParam(req);
    const t = await prisma.testimony.findFirst({ where: { OR: [{ id: key }, { slug: key }] }, include: withCover });
    if (!t || (t.status !== "PUBLISHED" && currentUser(req).role !== "ADMIN")) {
      throw new HttpError(404, "NOT_FOUND", "Testimony not found");
    }
    res.json(await fullDto(t));
  });

  // ---- Admin only below --------------------------------------------------

  router.post("/", requireAdmin, async (req, res) => {
    const user = currentUser(req);
    const input = UpsertSchema.parse(req.body);
    const mediaIds = await validateMedia(input, null);

    const t = await prisma.$transaction(async (tx) => {
      const created = await tx.testimony.create({
        data: {
          ...input,
          slug: slugify(input.title),
          publishedAt: input.status === "PUBLISHED" ? new Date() : null,
          authorId: user.id,
        },
        include: withCover,
      });
      await tx.media.updateMany({ where: { id: { in: mediaIds } }, data: { testimonyId: created.id } });
      return created;
    });
    await audit(user, "TESTIMONY_CREATE", t);
    res.status(201).json(await fullDto(t));
  });

  /** Full replace of the editable fields. Images no longer referenced are deleted. */
  router.put("/:id", requireAdmin, async (req, res) => {
    const user = currentUser(req);
    const id = idParam(req);
    const input = UpsertSchema.parse(req.body);
    const existing = await prisma.testimony.findUnique({ where: { id }, include: { media: { select: { id: true, storageKey: true } } } });
    if (!existing) throw new HttpError(404, "NOT_FOUND", "Testimony not found");
    const mediaIds = await validateMedia(input, id);
    const dropped = existing.media.filter((m) => !mediaIds.includes(m.id));

    const t = await prisma.$transaction(async (tx) => {
      await tx.media.deleteMany({ where: { id: { in: dropped.map((m) => m.id) } } });
      await tx.media.updateMany({ where: { id: { in: mediaIds } }, data: { testimonyId: id } });
      return tx.testimony.update({
        where: { id },
        data: {
          ...input,
          // Keep the original publication date when re-publishing or editing.
          publishedAt: input.status === "PUBLISHED" ? (existing.publishedAt ?? new Date()) : existing.publishedAt,
        },
        include: withCover,
      });
    });
    await deleteObjects(storage, dropped.map((m) => m.storageKey));
    await audit(user, "TESTIMONY_UPDATE", t);
    res.json(await fullDto(t));
  });

  router.delete("/:id", requireAdmin, async (req, res) => {
    const user = currentUser(req);
    const id = idParam(req);
    const existing = await prisma.testimony.findUnique({
      where: { id },
      include: { media: { select: { id: true, storageKey: true } }, coverMedia: { select: { id: true, storageKey: true } } },
    });
    if (!existing) throw new HttpError(404, "NOT_FOUND", "Testimony not found");
    const media = [...existing.media, ...(existing.coverMedia ? [existing.coverMedia] : [])];

    await prisma.$transaction([
      prisma.testimony.delete({ where: { id } }),
      prisma.media.deleteMany({ where: { id: { in: media.map((m) => m.id) } } }),
    ]);
    await deleteObjects(storage, [...new Set(media.map((m) => m.storageKey))]);
    await audit(user, "TESTIMONY_DELETE", existing);
    res.status(204).end();
  });

  return router;
}

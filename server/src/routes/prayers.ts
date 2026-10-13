import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { ReactionType } from "../generated/prisma/client.js";
import { authorSelect, cellGroupSelect, PageQuerySchema, pageArgs, text, toPage, viewerOf } from "../lib/feed.js";
import { currentUser, HttpError, idParam } from "../lib/http.js";
import { feedAuthor, type Viewer } from "../lib/privacy.js";
import { isUniqueViolation } from "../lib/prismaErrors.js";
import { userLimiter } from "../middleware/rateLimit.js";

const COMMENTS_PER_PRAYER = 50;

const prayerInclude = {
  author: { select: authorSelect },
  cellGroup: { select: cellGroupSelect },
  comments: {
    where: { hiddenAt: null },
    orderBy: { createdAt: "asc" as const },
    take: COMMENTS_PER_PRAYER,
    include: { author: { select: authorSelect } },
  },
  reactions: { select: { type: true, userId: true } },
  _count: { select: { comments: { where: { hiddenAt: null } } } },
};

type PrayerRow = NonNullable<Awaited<ReturnType<typeof findPrayer>>>;

function findPrayer(id: string) {
  return prisma.prayer.findFirst({ where: { id, hiddenAt: null }, include: prayerInclude });
}

function reactionSummary(reactions: { type: ReactionType; userId: string }[], viewer: Viewer) {
  const counts = Object.fromEntries(Object.values(ReactionType).map((t) => [t, 0])) as Record<ReactionType, number>;
  const mine: ReactionType[] = [];
  for (const r of reactions) {
    counts[r.type]++;
    if (r.userId === viewer.id) mine.push(r.type);
  }
  return { counts, mine };
}

/** Shape sent to the client: names resolved by privacy rules; no other user's id leaves the server. */
function prayerDto(p: PrayerRow, viewer: Viewer) {
  return {
    id: p.id,
    content: p.content,
    isAnswered: p.isAnswered,
    createdAt: p.createdAt,
    author: feedAuthor(p.author, p.isAnonymous, viewer),
    cellGroup: p.cellGroup,
    reactions: reactionSummary(p.reactions, viewer),
    commentCount: p._count.comments,
    comments: p.comments.map((c) => ({
      id: c.id,
      content: c.content,
      createdAt: c.createdAt,
      author: feedAuthor(c.author, c.isAnonymous, viewer),
    })),
  };
}

const CreatePrayerSchema = z.object({ content: text(2000), isAnonymous: z.boolean().default(false) }).strict();
const CreateCommentSchema = z.object({ content: text(1000), isAnonymous: z.boolean().default(false) }).strict();
const ReactionSchema = z.object({ type: z.enum(ReactionType) }).strict();

export function prayersRouter(): Router {
  const router = Router();
  const writeLimiter = userLimiter(60_000, 20);

  /** GET /api/prayers?cursor=&limit= — newest first. */
  router.get("/", async (req, res) => {
    const viewer = viewerOf(currentUser(req));
    const page = PageQuerySchema.parse(req.query);
    const rows = await prisma.prayer.findMany({ where: { hiddenAt: null }, include: prayerInclude, ...pageArgs(page) });
    const { items, nextCursor } = toPage(rows, page.limit);
    res.json({ items: items.map((p) => prayerDto(p, viewer)), nextCursor });
  });

  router.post("/", writeLimiter, async (req, res) => {
    const user = currentUser(req);
    const input = CreatePrayerSchema.parse(req.body);
    const { id } = await prisma.prayer.create({
      data: { ...input, authorId: user.id, cellGroupId: user.cellGroupId },
    });
    res.status(201).json(prayerDto((await findPrayer(id))!, viewerOf(user)));
  });

  router.post("/:id/comments", writeLimiter, async (req, res) => {
    const user = currentUser(req);
    const prayerId = idParam(req);
    const input = CreateCommentSchema.parse(req.body);
    if (!(await findPrayer(prayerId))) throw new HttpError(404, "NOT_FOUND", "Prayer not found");
    await prisma.prayerComment.create({ data: { ...input, prayerId, authorId: user.id } });
    res.status(201).json(prayerDto((await findPrayer(prayerId))!, viewerOf(user)));
  });

  /** Toggle: adds the reaction, or removes it if the user already left that one. */
  router.post("/:id/reactions", writeLimiter, async (req, res) => {
    const user = currentUser(req);
    const { type } = ReactionSchema.parse(req.body);
    const prayerId = idParam(req);
    if (!(await findPrayer(prayerId))) throw new HttpError(404, "NOT_FOUND", "Prayer not found");

    const reaction = { prayerId, userId: user.id, type };
    const removed = await prisma.prayerReaction.deleteMany({ where: reaction });
    if (removed.count === 0) {
      try {
        await prisma.prayerReaction.create({ data: reaction });
      } catch (e) {
        // A concurrent double-tap already added it: the end state is "reacted" either way.
        if (!isUniqueViolation(e)) throw e;
      }
    }

    const prayer = (await findPrayer(prayerId))!;
    res.json({ id: prayerId, reactions: reactionSummary(prayer.reactions, viewerOf(user)) });
  });

  return router;
}

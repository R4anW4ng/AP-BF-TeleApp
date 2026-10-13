import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { prisma } from "../db.js";
import type { AuditAction, Prisma, User, WeeklyChallenge } from "../generated/prisma/client.js";
import { text } from "../lib/feed.js";
import { currentUser, HttpError, idParam } from "../lib/http.js";
import { isUniqueViolation } from "../lib/prismaErrors.js";
import { realName } from "../lib/privacy.js";
import { campaignWeekOf, campaignWeeks, sgMidnight, weeklyPublishAt } from "../lib/time.js";
import { requireAdmin } from "../middleware/telegramAuth.js";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

const DateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const MonthKey = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use YYYY-MM");

async function audit(actor: User, action: AuditAction, targetType: string, targetId: string | null, metadata?: Prisma.InputJsonValue) {
  await prisma.auditLog.create({ data: { actorId: actor.id, action, targetType, targetId, metadata } });
}

// ---- Weekly challenges ---------------------------------------------------

/**
 * Field limits match what the Monday broadcast can fit (services/broadcast.ts
 * clips to these too), so what the admin types is what members receive.
 */
const ChallengeSchema = z
  .object({
    weekStart: DateKey.refine((d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 1, "Must be a Monday"),
    title: text(200),
    financialInitiatives: z.array(text(80)).min(1, "Add at least one initiative").max(8),
    description: optionalText(600),
    memoryVerseText: text(900),
    memoryVerseRef: text(100),
    /** DRAFT is hidden and never broadcast; SCHEDULED goes live (and is broadcast) at publishAt. */
    status: z.enum(["DRAFT", "SCHEDULED"]).default("SCHEDULED"),
    /** Defaults to Monday 05:00 SGT of that week; must fall inside the week. */
    publishAt: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();
type ChallengeInput = z.infer<typeof ChallengeSchema>;

function challengeData(input: ChallengeInput) {
  const weekNumber = campaignWeekOf(input.weekStart, config.CAMPAIGN_START, config.CAMPAIGN_END);
  if (weekNumber === null) {
    throw new HttpError(400, "VALIDATION_ERROR", "That week is outside the campaign");
  }
  const weekStart = new Date(`${input.weekStart}T00:00:00Z`);
  const publishAt = input.publishAt ? new Date(input.publishAt) : weeklyPublishAt(weekStart);
  const weekBegins = sgMidnight(input.weekStart).getTime();
  if (publishAt.getTime() < weekBegins || publishAt.getTime() >= weekBegins + 7 * 86_400_000) {
    throw new HttpError(400, "VALIDATION_ERROR", "Publish time must be within that week (Singapore time)");
  }
  const { weekStart: _w, publishAt: _p, ...rest } = input;
  return { ...rest, weekStart, weekNumber, publishAt };
}

function challengeDto(c: WeeklyChallenge) {
  return {
    id: c.id,
    weekStart: c.weekStart.toISOString().slice(0, 10),
    weekNumber: c.weekNumber,
    title: c.title,
    financialInitiatives: c.financialInitiatives,
    description: c.description,
    memoryVerseText: c.memoryVerseText,
    memoryVerseRef: c.memoryVerseRef,
    status: c.status,
    publishAt: c.publishAt,
    broadcast: {
      startedAt: c.broadcastStartedAt,
      completedAt: c.broadcastCompletedAt,
      sent: c.broadcastSentCount,
      failed: c.broadcastFailedCount,
    },
    updatedAt: c.updatedAt,
  };
}

function challengesRouter(): Router {
  const router = Router();

  router.get("/", async (_req, res) => {
    const rows = await prisma.weeklyChallenge.findMany({ orderBy: { weekStart: "asc" } });
    res.json({ items: rows.map(challengeDto), weeks: campaignWeeks(config.CAMPAIGN_START, config.CAMPAIGN_END) });
  });

  router.post("/", async (req, res) => {
    const user = currentUser(req);
    const data = challengeData(ChallengeSchema.parse(req.body));
    let created: WeeklyChallenge;
    try {
      created = await prisma.weeklyChallenge.create({ data: { ...data, createdById: user.id } });
    } catch (e) {
      if (isUniqueViolation(e)) throw new HttpError(409, "WEEK_TAKEN", "That week already has a challenge. Edit it instead.");
      throw e;
    }
    await audit(user, "CHALLENGE_CREATE", "WeeklyChallenge", created.id, { weekNumber: created.weekNumber });
    res.status(201).json(challengeDto(created));
  });

  router.put("/:id", async (req, res) => {
    const user = currentUser(req);
    const id = idParam(req);
    const existing = await prisma.weeklyChallenge.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "NOT_FOUND", "Challenge not found");
    const data = challengeData(ChallengeSchema.parse(req.body));

    if (existing.broadcastStartedAt) {
      // Text can still be corrected (Home shows the fix), but a sent challenge can't move weeks.
      if (data.weekStart.getTime() !== existing.weekStart.getTime() || data.publishAt.getTime() !== existing.publishAt.getTime()) {
        throw new HttpError(409, "ALREADY_SENT", "This challenge was already broadcast; its week and time can't change.");
      }
    }
    // The broadcast marks a challenge PUBLISHED; keep that unless the admin is pulling it back to draft.
    const status = data.status === "SCHEDULED" && existing.status === "PUBLISHED" ? "PUBLISHED" : data.status;

    let updated: WeeklyChallenge;
    try {
      updated = await prisma.weeklyChallenge.update({ where: { id }, data: { ...data, status } });
    } catch (e) {
      if (isUniqueViolation(e)) throw new HttpError(409, "WEEK_TAKEN", "That week already has a challenge.");
      throw e;
    }
    await audit(user, "CHALLENGE_UPDATE", "WeeklyChallenge", id, { weekNumber: updated.weekNumber });
    res.json(challengeDto(updated));
  });

  router.delete("/:id", async (req, res) => {
    const user = currentUser(req);
    const id = idParam(req);
    const deleted = await prisma.weeklyChallenge.delete({ where: { id } }); // P2025 → 404
    await audit(user, "CHALLENGE_DELETE", "WeeklyChallenge", id, { weekNumber: deleted.weekNumber, title: deleted.title });
    res.status(204).end();
  });

  return router;
}

// ---- Monthly goals ---------------------------------------------------------

const GoalSchema = z.object({ title: text(200), description: optionalText(500) }).strict();

/** "YYYY-MM" for every month the campaign touches (Oct 2026 … Feb 2027). */
function campaignMonths(): string[] {
  const months: string[] = [];
  const last = config.CAMPAIGN_END.slice(0, 7);
  let [year, month] = config.CAMPAIGN_START.slice(0, 7).split("-").map(Number);
  for (let key = config.CAMPAIGN_START.slice(0, 7); key <= last; ) {
    months.push(key);
    month = month === 12 ? 1 : month + 1;
    if (month === 1) year++;
    key = `${year}-${String(month).padStart(2, "0")}`;
  }
  return months;
}

function monthParam(raw: unknown): { key: string; date: Date } {
  const key = MonthKey.parse(raw);
  if (!campaignMonths().includes(key)) throw new HttpError(400, "VALIDATION_ERROR", "That month is outside the campaign");
  return { key, date: new Date(`${key}-01T00:00:00Z`) };
}

function goalsRouter(): Router {
  const router = Router();

  router.get("/", async (_req, res) => {
    const rows = await prisma.monthlyGoal.findMany({ orderBy: { month: "asc" } });
    res.json({
      months: campaignMonths(),
      items: rows.map((g) => ({ id: g.id, month: g.month.toISOString().slice(0, 7), title: g.title, description: g.description, updatedAt: g.updatedAt })),
    });
  });

  /** PUT /api/admin/monthly-goals/2026-11 — create or replace that month's goal. */
  router.put("/:month", async (req, res) => {
    const user = currentUser(req);
    const { key, date } = monthParam(req.params.month);
    const input = GoalSchema.parse(req.body);
    const goal = await prisma.monthlyGoal.upsert({
      where: { month: date },
      create: { month: date, ...input, createdById: user.id },
      update: input,
    });
    await audit(user, "MONTHLY_GOAL_UPSERT", "MonthlyGoal", goal.id, { month: key });
    res.json({ id: goal.id, month: key, title: goal.title, description: goal.description, updatedAt: goal.updatedAt });
  });

  router.delete("/:month", async (req, res) => {
    const user = currentUser(req);
    const { key, date } = monthParam(req.params.month);
    const goal = await prisma.monthlyGoal.delete({ where: { month: date } }); // P2025 → 404
    await audit(user, "MONTHLY_GOAL_DELETE", "MonthlyGoal", goal.id, { month: key });
    res.status(204).end();
  });

  return router;
}

// ---- People & roles --------------------------------------------------------

/**
 * Admins see real names here, including Stay Anonymous members: promoting
 * someone or fixing their Cell Group requires knowing who they are. Telegram
 * IDs are still never returned.
 */
function personDto(u: User & { cellGroup: { id: string; code: string } | null }, viewer: User) {
  return {
    id: u.id,
    name: realName(u),
    username: u.username,
    role: u.role,
    cellGroup: u.cellGroup,
    points: u.totalPoints,
    stayAnonymous: u.stayAnonymous,
    isMe: u.id === viewer.id,
    /** In ADMIN_TELEGRAM_IDS: always admin, can't be demoted here. */
    isWhitelisted: config.adminTelegramIds.has(u.telegramId),
    lastSeenAt: u.lastSeenAt,
  };
}

const withCellGroup = { cellGroup: { select: { id: true, code: true } } } as const;

function peopleRouter(): Router {
  const router = Router();

  /** GET /api/admin/users?q=grace&role=ADMIN */
  router.get("/", async (req, res) => {
    const viewer = currentUser(req);
    const { q, role } = z
      .object({ q: z.string().trim().max(60).optional(), role: z.enum(["ADMIN", "USER"]).optional() })
      .parse(req.query);
    const contains = q ? { contains: q.replace(/^@/, ""), mode: "insensitive" as const } : undefined;
    const users = await prisma.user.findMany({
      where: {
        ...(role ? { role } : {}),
        ...(contains
          ? { OR: [{ firstName: contains }, { lastName: contains }, { displayName: contains }, { username: contains }] }
          : {}),
      },
      include: withCellGroup,
      orderBy: [{ role: "asc" }, { firstName: "asc" }],
      take: 50,
    });
    res.json({ items: users.map((u) => personDto(u, viewer)) });
  });

  router.post("/:id/role", async (req, res) => {
    const viewer = currentUser(req);
    const id = idParam(req);
    const { role } = z.object({ role: z.enum(["ADMIN", "USER"]) }).strict().parse(req.body);
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) throw new HttpError(404, "NOT_FOUND", "User not found");

    if (role === "USER") {
      if (target.id === viewer.id) throw new HttpError(409, "CANNOT_DEMOTE_SELF", "You can't remove your own admin role");
      if (config.adminTelegramIds.has(target.telegramId)) {
        throw new HttpError(409, "WHITELISTED_ADMIN", "This admin is set in ADMIN_TELEGRAM_IDS on the server and can't be demoted here");
      }
    }
    if (target.role === role) {
      res.json(personDto({ ...target, cellGroup: await cellGroupOf(target) }, viewer));
      return;
    }

    const updated = await prisma.user.update({ where: { id }, data: { role }, include: withCellGroup });
    await audit(viewer, role === "ADMIN" ? "PROMOTE_ADMIN" : "DEMOTE_ADMIN", "User", id);
    res.json(personDto(updated, viewer));
  });

  /** Move a member to another Cell Group (members can only pick once themselves). Their points move with them. */
  router.patch("/:id", async (req, res) => {
    const viewer = currentUser(req);
    const id = idParam(req);
    const { cellGroupId } = z.object({ cellGroupId: z.string().min(1).max(64).nullable() }).strict().parse(req.body);
    const target = await prisma.user.findUnique({ where: { id }, include: withCellGroup });
    if (!target) throw new HttpError(404, "NOT_FOUND", "User not found");
    if (cellGroupId && !(await prisma.cellGroup.findFirst({ where: { id: cellGroupId, isActive: true } }))) {
      throw new HttpError(400, "VALIDATION_ERROR", "Unknown Cell Group");
    }
    const updated = await prisma.user.update({ where: { id }, data: { cellGroupId }, include: withCellGroup });
    await audit(viewer, "CELL_GROUP_CHANGE", "User", id, { from: target.cellGroup?.code ?? null, to: updated.cellGroup?.code ?? null });
    res.json(personDto(updated, viewer));
  });

  return router;
}

async function cellGroupOf(u: User) {
  return u.cellGroupId ? prisma.cellGroup.findUnique({ where: { id: u.cellGroupId }, select: { id: true, code: true } }) : null;
}

/** Everything under /api/admin requires role ADMIN (read from the DB row for this request). */
export function adminRouter(): Router {
  const router = Router();
  router.use(requireAdmin);
  router.use("/challenges", challengesRouter());
  router.use("/monthly-goals", goalsRouter());
  router.use("/users", peopleRouter());
  return router;
}

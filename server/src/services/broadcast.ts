import { type Api, InlineKeyboardBuilder, TelegramApiError } from "node-telegram-bot-api";
import { config } from "../config.js";
import { prisma } from "../db.js";
import type { MonthlyGoal, WeeklyChallenge } from "../generated/prisma/client.js";
import { clip, escapeHtml } from "../lib/telegramHtml.js";
import { sgMonthStart, sgWeekStart } from "../lib/time.js";

/** A challenge is only broadcast within this long after its publishAt. */
export const BROADCAST_WINDOW_MS = 24 * 60 * 60 * 1000;
const USER_BATCH_SIZE = 200;

export type BroadcastResult =
  | { status: "SENT"; challengeId: string; sent: number; failed: number; blocked: number }
  | { status: "NO_CHALLENGE" }
  | { status: "ALREADY_SENT"; challengeId: string };

type ChallengeContent = Pick<
  WeeklyChallenge,
  "weekNumber" | "title" | "financialInitiatives" | "description" | "memoryVerseText" | "memoryVerseRef"
>;
type GoalContent = Pick<MonthlyGoal, "month" | "title" | "description">;

/**
 * The Monday message. All admin-entered text is HTML-escaped and clipped; the
 * per-field limits keep the worst case (every field at maximum) under Telegram's
 * 4096-character message limit.
 */
export function buildWeeklyMessage(challenge: ChallengeContent, goal: GoalContent | null): string {
  const e = (s: string, max: number) => escapeHtml(clip(s.trim(), max));
  const lines = [
    `🗓 <b>Week ${challenge.weekNumber} · ${escapeHtml(config.ZONE_NAME)} Building Fund</b>`,
    `<b>${e(challenge.title, 200)}</b>`,
    "",
    "📖 <b>Memory verse</b>",
    `<i>“${e(challenge.memoryVerseText, 900)}”</i>`,
    `— ${e(challenge.memoryVerseRef, 100)}`,
    "",
    "💰 <b>This week's financial challenge</b>",
    ...challenge.financialInitiatives.slice(0, 8).map((item) => `• ${e(item, 80)}`),
  ];
  if (challenge.description?.trim()) lines.push(e(challenge.description, 600));

  if (goal) {
    const month = goal.month.toLocaleString("en-SG", { month: "long", timeZone: "UTC" });
    lines.push("", `🙏 <b>${month} spiritual goal</b>`, `<b>${e(goal.title, 200)}</b>`);
    if (goal.description?.trim()) lines.push(e(goal.description, 500));
  }

  lines.push("", "Tap below to log your week and cheer on your Cell Group.");
  return lines.join("\n");
}

export function openAppKeyboard(label = "Open Building Fund app") {
  return new InlineKeyboardBuilder().webApp(label, config.webAppUrl).build();
}

/** Telegram will never deliver to this chat until the user (re)starts the bot. */
function isUnreachable(err: unknown): err is TelegramApiError {
  return (
    err instanceof TelegramApiError &&
    (err.errorCode === 403 || (err.errorCode === 400 && /chat not found|user is deactivated/i.test(err.description)))
  );
}

/**
 * Send this week's challenge to every reachable user, at most once per challenge.
 *
 * 1. Find this SGT week's challenge whose publishAt has passed (within BROADCAST_WINDOW_MS).
 * 2. Claim it by setting broadcastStartedAt where it is still NULL. Only one caller
 *    can win, so the Monday job, the catch-up sweep, a restart or a second server
 *    instance can never send it twice.
 * 3. Load this month's spiritual goal and build the message once.
 * 4. Page through users and send one by one. Each send has its own try/catch:
 *    a user who blocked the bot is logged and flagged `botBlocked` (skipped next
 *    time until they /start again), and the loop carries on.
 */
export async function broadcastWeeklyChallenge(api: Api, now: Date = new Date()): Promise<BroadcastResult> {
  const challenge = await prisma.weeklyChallenge.findFirst({
    where: {
      weekStart: sgWeekStart(now),
      status: { in: ["SCHEDULED", "PUBLISHED"] },
      publishAt: { lte: now, gt: new Date(now.getTime() - BROADCAST_WINDOW_MS) },
    },
  });
  if (!challenge) return { status: "NO_CHALLENGE" };

  const claim = await prisma.weeklyChallenge.updateMany({
    where: { id: challenge.id, broadcastStartedAt: null },
    data: { broadcastStartedAt: now, status: "PUBLISHED" },
  });
  if (claim.count === 0) return { status: "ALREADY_SENT", challengeId: challenge.id };

  const goal = await prisma.monthlyGoal.findUnique({ where: { month: sgMonthStart(now) } });
  const text = buildWeeklyMessage(challenge, goal);
  const reply_markup = openAppKeyboard();

  let sent = 0;
  let failed = 0;
  let blocked = 0;
  let cursor: string | undefined;

  for (;;) {
    const users = await prisma.user.findMany({
      where: { botBlocked: false, notificationsEnabled: true },
      select: { id: true, telegramId: true },
      orderBy: { id: "asc" },
      take: USER_BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (users.length === 0) break;
    cursor = users[users.length - 1].id;

    for (const user of users) {
      try {
        await api.sendMessage({
          chat_id: Number(user.telegramId),
          text,
          parse_mode: "HTML",
          reply_markup,
          link_preview_options: { is_disabled: true },
        });
        sent++;
      } catch (err) {
        failed++;
        // Log the internal user id only: no names or Telegram IDs in logs.
        if (isUnreachable(err)) {
          blocked++;
          console.warn(`[broadcast] user ${user.id} unreachable (${err.description}); marking botBlocked`);
          await prisma.user.update({ where: { id: user.id }, data: { botBlocked: true } }).catch(() => {});
        } else {
          console.error(`[broadcast] send to user ${user.id} failed:`, err);
        }
      }
    }
  }

  await prisma.weeklyChallenge.update({
    where: { id: challenge.id },
    data: { broadcastCompletedAt: new Date(), broadcastSentCount: sent, broadcastFailedCount: failed },
  });
  console.log(`[broadcast] week ${challenge.weekNumber}: sent ${sent}, failed ${failed} (${blocked} blocked)`);
  return { status: "SENT", challengeId: challenge.id, sent, failed, blocked };
}

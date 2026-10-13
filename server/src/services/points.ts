import { prisma } from "../db.js";
import type { PointType, User } from "../generated/prisma/client.js";
import { isUniqueViolation } from "../lib/prismaErrors.js";
import { addDaysKey, sgDate, sgDateKey, sgMonthKey } from "../lib/time.js";

type EarnedPointType = Exclude<PointType, "ADMIN_ADJUSTMENT">;

interface PointRule {
  points: number;
  /** Max awards per period. */
  cap: number;
  period: "day" | "month";
}

/** Campaign point values. Periods are SGT calendar days / months. */
export const POINT_RULES: Record<EarnedPointType, PointRule> = {
  TITHE: { points: 100, cap: 1, period: "month" },
  MEAL_LOG: { points: 5, cap: 3, period: "day" },
  LIVING_POST: { points: 10, cap: 2, period: "day" },
};

export type AwardResult =
  | { awarded: true; points: number; used: number; cap: number; totalPoints: number; currentStreak: number }
  | { awarded: false; reason: "CAP_REACHED"; used: number; cap: number };

function periodKeyFor(rule: PointRule, now: Date): string {
  return rule.period === "month" ? sgMonthKey(now) : sgDateKey(now);
}

/**
 * Award points for an action, respecting its cap.
 *
 * The cap is enforced by the unique key (userId, type, periodKey, slot): each
 * attempt claims the next slot, and a concurrent request that claimed it first
 * makes ours fail with P2002, so we try the next one. Once every slot up to the
 * cap is taken, the award is refused. The ledger insert and the user's
 * totalPoints/streak update commit together or not at all.
 */
export async function awardPoints(
  userId: string,
  type: EarnedPointType,
  { sourceId, now = new Date() }: { sourceId?: string; now?: Date } = {},
): Promise<AwardResult> {
  const rule = POINT_RULES[type];
  const periodKey = periodKeyFor(rule, now);
  const today = sgDateKey(now);
  const yesterday = addDaysKey(today, -1);

  const used = await prisma.pointTransaction.count({ where: { userId, type, periodKey } });

  for (let slot = used + 1; slot <= rule.cap; slot++) {
    try {
      const [, rows] = await prisma.$transaction([
        prisma.pointTransaction.create({
          data: { userId, type, points: rule.points, periodKey, slot, sgDate: sgDate(now), sourceId },
        }),
        // Streak: same SGT day keeps it, the next day extends it, any gap resets to 1.
        // In SET, column references read the pre-update values.
        prisma.$queryRaw<{ totalPoints: number; currentStreak: number }[]>`
          UPDATE "users" SET
            "totalPoints"    = "totalPoints" + ${rule.points},
            "currentStreak"  = CASE
                                 WHEN "lastActiveDate" = ${today}::date     THEN "currentStreak"
                                 WHEN "lastActiveDate" = ${yesterday}::date THEN "currentStreak" + 1
                                 ELSE 1 END,
            "longestStreak"  = GREATEST("longestStreak", CASE
                                 WHEN "lastActiveDate" = ${today}::date     THEN "currentStreak"
                                 WHEN "lastActiveDate" = ${yesterday}::date THEN "currentStreak" + 1
                                 ELSE 1 END),
            "lastActiveDate" = ${today}::date,
            "updatedAt"      = now()
          WHERE "id" = ${userId}
          RETURNING "totalPoints", "currentStreak"`,
      ]);
      return { awarded: true, points: rule.points, used: slot, cap: rule.cap, ...rows[0] };
    } catch (e) {
      if (isUniqueViolation(e)) continue;
      throw e;
    }
  }

  return { awarded: false, reason: "CAP_REACHED", used: rule.cap, cap: rule.cap };
}

/** How much of each capped action the user has used in the current period. */
export async function pointUsage(userId: string, now: Date = new Date()) {
  const keys = Object.entries(POINT_RULES).map(([type, rule]) => ({
    type: type as EarnedPointType,
    periodKey: periodKeyFor(rule, now),
  }));
  const rows = await prisma.pointTransaction.groupBy({
    by: ["type"],
    where: { userId, OR: keys },
    _count: { _all: true },
  });
  const counts = new Map(rows.map((r) => [r.type, r._count._all]));
  return Object.fromEntries(
    keys.map(({ type }) => [type, { used: counts.get(type) ?? 0, cap: POINT_RULES[type].cap, points: POINT_RULES[type].points }]),
  ) as Record<EarnedPointType, { used: number; cap: number; points: number }>;
}

/** The stored streak goes stale if the user skips a day; report 0 in that case. */
export function effectiveStreak(user: Pick<User, "currentStreak" | "lastActiveDate">, now: Date = new Date()): number {
  if (!user.lastActiveDate) return 0;
  const last = user.lastActiveDate.toISOString().slice(0, 10);
  const today = sgDateKey(now);
  return last === today || last === addDaysKey(today, -1) ? user.currentStreak : 0;
}

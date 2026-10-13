/**
 * All campaign time logic runs in Singapore time (UTC+8, no DST).
 *
 * Postgres `@db.Date` columns are represented as a JS Date at 00:00 UTC of that
 * calendar day, so "the SGT day" is always expressed that way here.
 */

export const SGT_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/** Wall-clock SGT fields, read via the getUTC* accessors. */
function sgtClock(now: Date): Date {
  return new Date(now.getTime() + SGT_OFFSET_MS);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-10-13" — the SGT calendar day. */
export function sgDateKey(now: Date = new Date()): string {
  const t = sgtClock(now);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** "2026-10" — the SGT calendar month. */
export function sgMonthKey(now: Date = new Date()): string {
  return sgDateKey(now).slice(0, 7);
}

/** The SGT calendar day as a `@db.Date` value. */
export function sgDate(now: Date = new Date()): Date {
  return new Date(`${sgDateKey(now)}T00:00:00Z`);
}

/** First day of the SGT month as a `@db.Date` value. */
export function sgMonthStart(now: Date = new Date()): Date {
  return new Date(`${sgMonthKey(now)}-01T00:00:00Z`);
}

/** Monday of the SGT week containing `now`, as a `@db.Date` value. */
export function sgWeekStart(now: Date = new Date()): Date {
  const day = sgDate(now);
  const daysSinceMonday = (day.getUTCDay() + 6) % 7;
  return new Date(day.getTime() - daysSinceMonday * DAY_MS);
}

/** Shift a `@db.Date` value by whole days and return its key. */
export function addDaysKey(dateKey: string, days: number): string {
  const d = new Date(new Date(`${dateKey}T00:00:00Z`).getTime() + days * DAY_MS);
  return d.toISOString().slice(0, 10);
}

/** Instant of 00:00 SGT on a "YYYY-MM-DD" day. */
export function sgMidnight(dateKey: string): Date {
  return new Date(new Date(`${dateKey}T00:00:00Z`).getTime() - SGT_OFFSET_MS);
}

/** Monday 05:00 SGT (= Sunday 21:00 UTC) for a week starting on `weekStart`. */
export function weeklyPublishAt(weekStart: Date): Date {
  return new Date(weekStart.getTime() - SGT_OFFSET_MS + 5 * 60 * 60 * 1000);
}

export interface CampaignInfo {
  start: string;
  end: string;
  hasStarted: boolean;
  hasEnded: boolean;
  /** 1-based week of the campaign; null before the start. */
  weekNumber: number | null;
  totalWeeks: number;
  daysRemaining: number;
  weeksRemaining: number;
}

/** Countdown for the Home screen. `end` is inclusive (the campaign runs through that day). */
export function campaignInfo(start: string, end: string, now: Date = new Date()): CampaignInfo {
  const startAt = sgMidnight(start).getTime();
  const endExclusive = sgMidnight(addDaysKey(end, 1)).getTime();
  const t = now.getTime();

  const totalWeeks = Math.ceil((endExclusive - startAt) / WEEK_MS);
  const hasStarted = t >= startAt;
  const hasEnded = t >= endExclusive;
  const daysRemaining = hasEnded ? 0 : Math.ceil((endExclusive - Math.max(t, startAt)) / DAY_MS);

  return {
    start,
    end,
    hasStarted,
    hasEnded,
    weekNumber: hasStarted ? Math.min(Math.floor((t - startAt) / WEEK_MS) + 1, totalWeeks) : null,
    totalWeeks,
    daysRemaining,
    weeksRemaining: Math.ceil(daysRemaining / 7),
  };
}

/**
 * 1-based campaign week for the SGT Monday `weekStartKey` ("YYYY-MM-DD"),
 * or null when that week is outside the campaign.
 */
export function campaignWeekOf(weekStartKey: string, start: string, end: string): number | null {
  const first = sgWeekStart(sgMidnight(start)).getTime();
  const last = sgWeekStart(sgMidnight(end)).getTime();
  const week = new Date(`${weekStartKey}T00:00:00Z`).getTime();
  if (Number.isNaN(week) || week < first || week > last) return null;
  return Math.round((week - first) / WEEK_MS) + 1;
}

/** Every campaign Monday as "YYYY-MM-DD", in order. */
export function campaignWeeks(start: string, end: string): { weekStart: string; weekNumber: number }[] {
  const weeks = [];
  const last = sgWeekStart(sgMidnight(end)).getTime();
  for (let t = sgWeekStart(sgMidnight(start)).getTime(), n = 1; t <= last; t += WEEK_MS, n++) {
    weeks.push({ weekStart: new Date(t).toISOString().slice(0, 10), weekNumber: n });
  }
  return weeks;
}

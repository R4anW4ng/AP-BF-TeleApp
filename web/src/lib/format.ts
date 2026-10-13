const SGT = "Asia/Singapore";

const dateTime = new Intl.DateTimeFormat("en-SG", {
  timeZone: SGT,
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});
const dateOnly = new Intl.DateTimeFormat("en-SG", { timeZone: SGT, day: "numeric", month: "long", year: "numeric" });
const monthName = new Intl.DateTimeFormat("en-SG", { timeZone: "UTC", month: "long" });

/** "just now", "5m ago", "3h ago", "2d ago", then "12 Oct, 9:30 pm" (Singapore time). */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const s = Math.max(0, (now.getTime() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)}d ago`;
  return dateTime.format(new Date(iso));
}

export const formatDate = (iso: string) => dateOnly.format(new Date(iso));

/** For @db.Date values (UTC midnight of the day). */
export const formatMonth = (iso: string) => monthName.format(new Date(iso));

/** "Mon, 19 Oct, 5:00 am" in Singapore time. */
export const formatDateTime = (iso: string) =>
  new Intl.DateTimeFormat("en-SG", { timeZone: SGT, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

/** For "YYYY-MM-DD" calendar dates: "19 Oct 2026". */
export const formatDay = (key: string) =>
  new Intl.DateTimeFormat("en-SG", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(new Date(`${key}T00:00:00Z`));

/** For "YYYY-MM": "November 2026". */
export const formatMonthKey = (key: string) =>
  new Intl.DateTimeFormat("en-SG", { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(`${key}-01T00:00:00Z`));

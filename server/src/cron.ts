import cron, { type ScheduledTask } from "node-cron";
import type { Api } from "node-telegram-bot-api";
import { broadcastWeeklyChallenge } from "./services/broadcast.js";

/**
 * Timezone handling
 * -----------------
 * node-cron evaluates the expression in `timezone` (via Intl), not in the
 * server's local time, so "0 5 * * 1" means 05:00 Monday in Singapore whether
 * the host runs in UTC, Europe or the US. That instant is Sunday 21:00 UTC.
 * Singapore has no daylight saving, so it never shifts.
 *
 * Inside the job, "this week" and "this month" are computed with the explicit
 * UTC+8 helpers in lib/time.ts. Nothing reads the host timezone.
 */
export const CRON_TIMEZONE = "Asia/Singapore";
export const WEEKLY_BROADCAST_CRON = "0 5 * * 1"; // 05:00 every Monday, SGT
/**
 * Safety net: if the server was down or restarting at 05:00, or an admin
 * published this week's challenge late, this sends it within 15 minutes.
 * It can't double-send: broadcastWeeklyChallenge claims each challenge atomically.
 */
export const CATCH_UP_CRON = "*/15 * * * *";

async function runBroadcast(api: Api, trigger: string): Promise<void> {
  try {
    const result = await broadcastWeeklyChallenge(api);
    if (trigger === "weekly" && result.status === "NO_CHALLENGE") {
      console.warn("[cron] Monday 05:00 SGT: no challenge published for this week. Nothing sent.");
    }
  } catch (err) {
    console.error(`[cron] ${trigger} broadcast failed:`, err);
  }
}

export function createCronTasks(api: Api): ScheduledTask[] {
  return [
    cron.createTask(WEEKLY_BROADCAST_CRON, () => runBroadcast(api, "weekly"), {
      name: "weekly-broadcast",
      timezone: CRON_TIMEZONE,
      noOverlap: true,
    }),
    cron.createTask(CATCH_UP_CRON, () => runBroadcast(api, "catch-up"), {
      name: "broadcast-catch-up",
      timezone: CRON_TIMEZONE,
      noOverlap: true,
    }),
  ];
}

/** Start the scheduled jobs, plus one immediate catch-up check for a broadcast missed while we were down. */
export function startCron(api: Api): { stop: () => Promise<void> } {
  const tasks = createCronTasks(api);
  for (const task of tasks) void task.start();
  const weekly = tasks[0];
  console.log(`[cron] weekly broadcast scheduled; next run ${weekly.getNextRun()?.toISOString()} (05:00 ${CRON_TIMEZONE})`);
  void runBroadcast(api, "startup");

  return {
    stop: async () => {
      await Promise.all(tasks.map((t) => t.destroy()));
    },
  };
}

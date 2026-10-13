import cron from "node-cron";
import { afterAll, describe, expect, it } from "vitest";
import { CATCH_UP_CRON, createCronTasks, WEEKLY_BROADCAST_CRON } from "../src/cron.js";
import { fakeTelegram } from "./fakeTelegram.js";

describe("Monday 05:00 Singapore schedule", () => {
  // The exact tasks the server starts (created, not started).
  const tasks = createCronTasks(fakeTelegram().api);
  const weekly = tasks.find((t) => t.name === "weekly-broadcast")!;
  afterAll(() => Promise.all(tasks.map((t) => t.destroy())));

  it("schedules the weekly broadcast with the agreed expression", () => {
    expect(weekly.getPattern()).toBe("0 5 * * 1");
  });

  it("runs in a non-Singapore host timezone (this test process uses America/New_York)", () => {
    expect(process.env.TZ).toBe("America/New_York");
    expect(new Date("2026-10-18T21:00:00Z").getHours()).toBe(17); // 5 PM in New York
  });

  it("fires at Monday 05:00 SGT, which is Sunday 21:00 UTC", () => {
    expect(weekly.match(new Date("2026-10-18T21:00:00Z"))).toBe(true); // Mon 19 Oct, 05:00 SGT
    expect(weekly.match(new Date("2026-10-19T05:00:00Z"))).toBe(false); // Mon 05:00 UTC = 13:00 SGT
    expect(weekly.match(new Date("2026-10-19T09:00:00Z"))).toBe(false); // Mon 05:00 New York
    expect(weekly.match(new Date("2026-10-18T20:00:00Z"))).toBe(false); // Mon 04:00 SGT
  });

  it("every upcoming run is a Sunday 21:00 UTC instant", () => {
    const runs = weekly.getNextRuns(10);
    expect(runs).toHaveLength(10);
    for (const run of runs) {
      expect([run.getUTCDay(), run.getUTCHours(), run.getUTCMinutes()]).toEqual([0, 21, 0]);
    }
    // Weekly, with no DST jumps (Singapore has none).
    for (let i = 1; i < runs.length; i++) expect(runs[i].getTime() - runs[i - 1].getTime()).toBe(7 * 86_400_000);
  });

  it("uses valid expressions", () => {
    expect(cron.validate(WEEKLY_BROADCAST_CRON)).toBe(true);
    expect(cron.validate(CATCH_UP_CRON)).toBe(true);
  });
});

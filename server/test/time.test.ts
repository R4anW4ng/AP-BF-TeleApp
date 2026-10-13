import { describe, expect, it } from "vitest";
import { campaignInfo, sgDateKey, sgMonthKey, sgWeekStart, weeklyPublishAt } from "../src/lib/time.js";

const START = "2026-10-19";
const END = "2027-02-28";

describe("SGT helpers", () => {
  it("rolls the day over at midnight Singapore time, not UTC", () => {
    expect(sgDateKey(new Date("2026-10-12T15:59:59Z"))).toBe("2026-10-12");
    expect(sgDateKey(new Date("2026-10-12T16:00:00Z"))).toBe("2026-10-13");
    expect(sgMonthKey(new Date("2026-10-31T16:00:00Z"))).toBe("2026-11");
  });

  it("finds the SGT Monday and the 05:00 SGT publish instant", () => {
    // Sunday 2026-10-25 23:30 SGT is still the week of Monday 19 Oct.
    expect(sgWeekStart(new Date("2026-10-25T15:30:00Z")).toISOString().slice(0, 10)).toBe("2026-10-19");
    expect(sgWeekStart(new Date("2026-10-25T16:00:00Z")).toISOString().slice(0, 10)).toBe("2026-10-26");
    expect(weeklyPublishAt(new Date("2026-10-19T00:00:00Z")).toISOString()).toBe("2026-10-18T21:00:00.000Z");
  });
});

describe("campaignInfo", () => {
  it("is 19 weeks long", () => {
    expect(campaignInfo(START, END, new Date("2026-10-13T00:00:00Z")).totalWeeks).toBe(19);
  });

  it("counts down before the start", () => {
    const info = campaignInfo(START, END, new Date("2026-10-13T00:00:00Z"));
    expect(info).toMatchObject({ hasStarted: false, weekNumber: null, weeksRemaining: 19, daysRemaining: 133 });
  });

  it("is week 1 from 00:00 SGT on 19 Oct", () => {
    expect(campaignInfo(START, END, new Date("2026-10-18T15:59:59Z")).weekNumber).toBeNull();
    expect(campaignInfo(START, END, new Date("2026-10-18T16:00:00Z")).weekNumber).toBe(1);
    expect(campaignInfo(START, END, new Date("2026-10-26T00:00:00Z")).weekNumber).toBe(2);
  });

  it("is in its last week on 28 Feb and over afterwards", () => {
    const last = campaignInfo(START, END, new Date("2027-02-28T15:00:00Z"));
    expect(last).toMatchObject({ weekNumber: 19, hasEnded: false, daysRemaining: 1, weeksRemaining: 1 });
    const after = campaignInfo(START, END, new Date("2027-02-28T16:00:00Z"));
    expect(after).toMatchObject({ hasEnded: true, daysRemaining: 0, weeksRemaining: 0 });
  });
});

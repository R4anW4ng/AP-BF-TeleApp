import { describe, expect, it } from "vitest";
import type { AdminChallenge } from "../../api/types";
import { challengeState } from "./ChallengesAdmin";

const base: AdminChallenge = {
  id: "c1",
  weekStart: "2026-10-19",
  weekNumber: 1,
  title: "t",
  financialInitiatives: ["No Grab"],
  description: null,
  memoryVerseText: "v",
  memoryVerseRef: "r",
  status: "SCHEDULED",
  publishAt: "2026-10-18T21:00:00.000Z",
  broadcast: { startedAt: null, completedAt: null, sent: 0, failed: 0 },
  updatedAt: "2026-10-13T00:00:00.000Z",
};

describe("challengeState", () => {
  const before = new Date("2026-10-15T00:00:00Z");
  it("labels drafts, scheduled, live and sent challenges", () => {
    expect(challengeState({ ...base, status: "DRAFT" }, before).tone).toBe("muted");
    const scheduled = challengeState(base, before);
    expect(scheduled.tone).toBe("pending");
    expect(scheduled.label).toMatch(/Scheduled · Mon, 19 Oct, 5:00\s?am/i); // Singapore time
    expect(challengeState(base, new Date("2026-10-19T01:00:00Z")).label).toBe("Live on Home");
    const sent = { ...base, status: "PUBLISHED" as const, broadcast: { startedAt: "x", completedAt: "y", sent: 41, failed: 2 } };
    expect(challengeState(sent).label).toBe("Sent to 41 (2 failed)");
  });
});

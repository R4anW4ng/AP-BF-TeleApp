import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db.js";
import { sgWeekStart, weeklyPublishAt } from "../src/lib/time.js";
import { broadcastWeeklyChallenge, buildWeeklyMessage } from "../src/services/broadcast.js";
import { blockedByUser, fakeTelegram } from "./fakeTelegram.js";
import { resetDatabase } from "./helpers.js";

// Monday 26 Oct 2026, 05:00:00.5 SGT: the instant the weekly cron fires.
const MONDAY_5AM = new Date("2026-10-25T21:00:00.500Z");
const WEEK = sgWeekStart(MONDAY_5AM);

async function createChallenge(overrides: Partial<Parameters<typeof prisma.weeklyChallenge.create>[0]["data"]> = {}) {
  return prisma.weeklyChallenge.create({
    data: {
      weekStart: WEEK,
      weekNumber: 2,
      title: "Sacrifice & save",
      financialInitiatives: ["No Grab", "Water Only"],
      memoryVerseText: "Each of you should give what you have decided in your heart to give.",
      memoryVerseRef: "2 Corinthians 9:7",
      publishAt: weeklyPublishAt(WEEK),
      ...overrides,
    },
  });
}

let nextId = 5000;
async function createUser(overrides: Partial<Parameters<typeof prisma.user.create>[0]["data"]> = {}) {
  const id = nextId++;
  return prisma.user.create({ data: { telegramId: BigInt(id), firstName: `U${id}`, botStartedAt: new Date(), ...overrides } });
}

beforeEach(resetDatabase);

describe("broadcastWeeklyChallenge", () => {
  it("sends verse, initiatives and monthly goal to every reachable user, continuing past a user who blocked the bot", async () => {
    const challenge = await createChallenge();
    await prisma.monthlyGoal.create({
      data: { month: new Date("2026-10-01T00:00:00Z"), title: "Sacrifice ME time", description: "One hour a week" },
    });
    const [a, blocker, c] = [await createUser(), await createUser(), await createUser()];
    const optedOut = await createUser({ notificationsEnabled: false });
    const alreadyBlocked = await createUser({ botBlocked: true });
    const miniAppOnly = await createUser({ botStartedAt: null }); // opened the app but never pressed /start

    const tg = fakeTelegram((call) => (call.params.chat_id === String(blocker.telegramId) ? blockedByUser : undefined));
    const result = await broadcastWeeklyChallenge(tg.api, MONDAY_5AM);

    expect(result).toMatchObject({ status: "SENT", sent: 3, failed: 1, blocked: 1 });
    const recipients = tg.sent().map((c) => c.params.chat_id);
    expect(recipients.sort()).toEqual(
      [a, blocker, c, miniAppOnly].map((u) => String(u.telegramId)).sort(),
    );
    expect(recipients).not.toContain(String(optedOut.telegramId));
    expect(recipients).not.toContain(String(alreadyBlocked.telegramId));

    const msg = tg.sent()[0].params;
    expect(msg.parse_mode).toBe("HTML");
    expect(msg.text).toContain("2 Corinthians 9:7");
    expect(msg.text).toContain("• No Grab\n• Water Only");
    expect(msg.text).toContain("October spiritual goal");
    expect(msg.text).toContain("Sacrifice ME time");
    expect(msg.text).toContain("Sacrifice &amp; save"); // admin text is HTML-escaped
    expect(msg.reply_markup).toEqual({
      inline_keyboard: [[{ text: "Open Building Fund app", web_app: { url: "https://miniapp.example.org/" } }]],
    });

    expect((await prisma.user.findUniqueOrThrow({ where: { id: blocker.id } })).botBlocked).toBe(true);
    expect(await prisma.weeklyChallenge.findUniqueOrThrow({ where: { id: challenge.id } })).toMatchObject({
      status: "PUBLISHED",
      broadcastSentCount: 3,
      broadcastFailedCount: 1,
      broadcastCompletedAt: expect.any(Date),
    });
  });

  it("logs and continues on other errors without flagging the user", async () => {
    await createChallenge();
    const [flaky, ok] = [await createUser(), await createUser()];
    const tg = fakeTelegram((call) =>
      call.params.chat_id === String(flaky.telegramId)
        ? { ok: false, error_code: 500, description: "Internal Server Error" }
        : undefined,
    );
    expect(await broadcastWeeklyChallenge(tg.api, MONDAY_5AM)).toMatchObject({ sent: 1, failed: 1, blocked: 0 });
    expect(tg.sent().map((c) => c.params.chat_id)).toContain(String(ok.telegramId));
    expect((await prisma.user.findUniqueOrThrow({ where: { id: flaky.id } })).botBlocked).toBe(false);
  });

  it("sends each challenge only once, even when the weekly job and catch-up fire together", async () => {
    await createChallenge();
    await createUser();
    await createUser();
    const tg = fakeTelegram();
    const results = await Promise.all([
      broadcastWeeklyChallenge(tg.api, MONDAY_5AM),
      broadcastWeeklyChallenge(tg.api, MONDAY_5AM),
      broadcastWeeklyChallenge(tg.api, new Date(MONDAY_5AM.getTime() + 15 * 60_000)),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["ALREADY_SENT", "ALREADY_SENT", "SENT"]);
    expect(tg.sent()).toHaveLength(2);
  });

  it("does nothing before 05:00 SGT", async () => {
    await createChallenge();
    await createUser();
    const tg = fakeTelegram();
    expect(await broadcastWeeklyChallenge(tg.api, new Date("2026-10-25T20:59:59Z"))).toEqual({ status: "NO_CHALLENGE" });
    expect(tg.calls).toHaveLength(0);
  });

  it("never re-sends last week's challenge when this week's is missing", async () => {
    const lastWeek = new Date(WEEK.getTime() - 7 * 86_400_000);
    await createChallenge({ weekStart: lastWeek, weekNumber: 1, publishAt: weeklyPublishAt(lastWeek) });
    await createUser();
    const tg = fakeTelegram();
    expect(await broadcastWeeklyChallenge(tg.api, MONDAY_5AM)).toEqual({ status: "NO_CHALLENGE" });
    expect(tg.calls).toHaveLength(0);
  });

  it("skips drafts, and challenges more than 24h past their publish time", async () => {
    await createChallenge({ status: "DRAFT" });
    await createUser();
    const tg = fakeTelegram();
    expect((await broadcastWeeklyChallenge(tg.api, MONDAY_5AM)).status).toBe("NO_CHALLENGE");

    await prisma.weeklyChallenge.updateMany({ data: { status: "SCHEDULED" } });
    const wednesday = new Date(MONDAY_5AM.getTime() + 2 * 86_400_000);
    expect((await broadcastWeeklyChallenge(tg.api, wednesday)).status).toBe("NO_CHALLENGE");
    expect(tg.calls).toHaveLength(0);
  });

  it("works without a monthly goal", async () => {
    await createChallenge();
    await createUser();
    const tg = fakeTelegram();
    await broadcastWeeklyChallenge(tg.api, MONDAY_5AM);
    expect(tg.sent()[0].params.text).not.toContain("spiritual goal");
  });
});

describe("buildWeeklyMessage", () => {
  it("escapes HTML and stays under Telegram's 4096-character limit", () => {
    const long = "<script>".repeat(2000);
    const text = buildWeeklyMessage(
      { weekNumber: 1, title: long, financialInitiatives: Array(50).fill(long), description: long, memoryVerseText: long, memoryVerseRef: long },
      { month: new Date("2026-11-01T00:00:00Z"), title: long, description: long },
    );
    expect(text).not.toContain("<script>");
    // Telegram counts the rendered text: tags removed, each entity one character.
    expect(text.replace(/<[^>]+>/g, "").replace(/&lt;|&gt;|&amp;/g, "x").length).toBeLessThan(4096);
  });
});

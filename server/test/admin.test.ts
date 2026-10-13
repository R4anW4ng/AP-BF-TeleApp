import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";
import { createMemoryStorage } from "../src/lib/storage.js";
import { broadcastWeeklyChallenge } from "../src/services/broadcast.js";
import { fakeTelegram } from "./fakeTelegram.js";
import { authHeader, resetDatabase, tgUser } from "./helpers.js";

const app = createApp({ storage: createMemoryStorage() });
const admin = tgUser(1000, { first_name: "Ryan", last_name: "Wang" }); // in ADMIN_TELEGRAM_IDS
const grace = tgUser(6001, { first_name: "Grace", last_name: "Tan", username: "gracet" });
const ben = tgUser(6002, { first_name: "Ben", last_name: "Lim" });

const as = (u: ReturnType<typeof tgUser>) => ({
  get: (p: string) => request(app).get(p).set("Authorization", authHeader(u)),
  post: (p: string) => request(app).post(p).set("Authorization", authHeader(u)),
  put: (p: string) => request(app).put(p).set("Authorization", authHeader(u)),
  patch: (p: string) => request(app).patch(p).set("Authorization", authHeader(u)),
  delete: (p: string) => request(app).delete(p).set("Authorization", authHeader(u)),
});

const challenge = (overrides: object = {}) => ({
  weekStart: "2026-10-19",
  title: "Kick-off week",
  financialInitiatives: ["No Grab", "Water Only"],
  description: "Every dollar saved goes to the fund.",
  memoryVerseText: "Bring the whole tithe into the storehouse.",
  memoryVerseRef: "Malachi 3:10",
  ...overrides,
});

let ap1: string, ap2: string;
beforeEach(async () => {
  await resetDatabase();
  ap1 = (await prisma.cellGroup.create({ data: { code: "AP1", name: "Cell Group AP1" } })).id;
  ap2 = (await prisma.cellGroup.create({ data: { code: "AP2", name: "Cell Group AP2" } })).id;
  for (const u of [admin, grace, ben]) await as(u).get("/api/me").expect(200);
  await as(grace).patch("/api/me").send({ cellGroupId: ap1 }).expect(200);
});

describe("access", () => {
  it.each([
    ["get", "/api/admin/challenges"],
    ["post", "/api/admin/challenges"],
    ["put", "/api/admin/challenges/x"],
    ["delete", "/api/admin/challenges/x"],
    ["get", "/api/admin/monthly-goals"],
    ["put", "/api/admin/monthly-goals/2026-11"],
    ["delete", "/api/admin/monthly-goals/2026-11"],
    ["get", "/api/admin/users"],
    ["post", "/api/admin/users/x/role"],
    ["patch", "/api/admin/users/x"],
  ] as const)("%s %s is admin-only", async (method, path) => {
    expect((await request(app)[method](path)).status).toBe(401);
    expect((await as(grace)[method](path).send({})).status).toBe(403);
  });
});

describe("weekly challenges", () => {
  it("schedules a week: computes the week number and Monday 05:00 SGT publish time", async () => {
    const res = await as(admin).post("/api/admin/challenges").send(challenge());
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      weekStart: "2026-10-19",
      weekNumber: 1,
      status: "SCHEDULED",
      publishAt: "2026-10-18T21:00:00.000Z",
      broadcast: { startedAt: null, sent: 0 },
    });
    const week5 = await as(admin).post("/api/admin/challenges").send(challenge({ weekStart: "2026-11-16" }));
    expect(week5.body.weekNumber).toBe(5);

    const list = await as(admin).get("/api/admin/challenges");
    expect(list.body.items).toHaveLength(2);
    expect(list.body.weeks).toHaveLength(19);
    expect(list.body.weeks.at(-1)).toEqual({ weekStart: "2027-02-22", weekNumber: 19 });
  });

  it("validates the week, the publish time, and one challenge per week", async () => {
    const post = (o: object) => as(admin).post("/api/admin/challenges").send(challenge(o));
    expect((await post({ weekStart: "2026-10-20" })).body.error.issues[0].message).toBe("Must be a Monday");
    expect((await post({ weekStart: "2026-10-12" })).body.error.message).toMatch(/outside the campaign/);
    expect((await post({ weekStart: "2027-03-01" })).status).toBe(400);
    expect((await post({ publishAt: "2026-10-26T01:00:00+08:00" })).body.error.message).toMatch(/within that week/);
    expect((await post({ financialInitiatives: [] })).status).toBe(400);
    expect((await post({ memoryVerseText: "x".repeat(901) })).status).toBe(400);
    expect((await post({ publishAt: "2026-10-19T07:30:00+08:00" })).body.publishAt).toBe("2026-10-18T23:30:00.000Z");
    expect((await post({})).body.error.code).toBe("WEEK_TAKEN");
  });

  it("is what the Monday 05:00 cron broadcasts", async () => {
    await as(grace).get("/api/me");
    await prisma.user.updateMany({ data: { botStartedAt: new Date() } });
    await as(admin).post("/api/admin/challenges").send(challenge()).expect(201);
    const tg = fakeTelegram();
    const result = await broadcastWeeklyChallenge(tg.api, new Date("2026-10-18T21:00:00.500Z"));
    expect(result).toMatchObject({ status: "SENT", sent: 3 });
    expect(tg.sent()[0].params.text).toContain("Kick-off week");
  });

  it("allows text fixes after the broadcast but not moving the week", async () => {
    const { body } = await as(admin).post("/api/admin/challenges").send(challenge());
    await prisma.weeklyChallenge.update({ where: { id: body.id }, data: { status: "PUBLISHED", broadcastStartedAt: new Date() } });

    const fix = await as(admin).put(`/api/admin/challenges/${body.id}`).send(challenge({ title: "Kick-off week (fixed)" }));
    expect(fix.body).toMatchObject({ title: "Kick-off week (fixed)", status: "PUBLISHED" });
    const move = await as(admin).put(`/api/admin/challenges/${body.id}`).send(challenge({ weekStart: "2026-10-26" }));
    expect(move.status).toBe(409);
    const draft = await as(admin).put(`/api/admin/challenges/${body.id}`).send(challenge({ status: "DRAFT" }));
    expect(draft.body.status).toBe("DRAFT"); // admin can still pull it from Home
  });

  it("deletes, and records every change in the audit log", async () => {
    const { body } = await as(admin).post("/api/admin/challenges").send(challenge());
    await as(admin).put(`/api/admin/challenges/${body.id}`).send(challenge({ title: "t2" })).expect(200);
    await as(admin).delete(`/api/admin/challenges/${body.id}`).expect(204);
    expect((await as(admin).delete(`/api/admin/challenges/${body.id}`)).status).toBe(404);
    const actions = (await prisma.auditLog.findMany({ orderBy: { createdAt: "asc" } })).map((a) => a.action);
    expect(actions).toEqual(["CHALLENGE_CREATE", "CHALLENGE_UPDATE", "CHALLENGE_DELETE"]);
  });
});

describe("monthly goals", () => {
  it("upserts by month within the campaign and shows the current month on Home", async () => {
    const list = await as(admin).get("/api/admin/monthly-goals");
    expect(list.body.months).toEqual(["2026-10", "2026-11", "2026-12", "2027-01", "2027-02"]);

    await as(admin).put("/api/admin/monthly-goals/2026-10").send({ title: "Sacrifice ME time", description: "One hour a week" }).expect(200);
    const again = await as(admin).put("/api/admin/monthly-goals/2026-10").send({ title: "Sacrifice ME time 2" });
    expect(again.body).toMatchObject({ month: "2026-10", title: "Sacrifice ME time 2", description: null });
    expect(await prisma.monthlyGoal.count()).toBe(1);

    expect((await as(admin).put("/api/admin/monthly-goals/2026-09").send({ title: "x" })).status).toBe(400);
    expect((await as(admin).put("/api/admin/monthly-goals/2026-13").send({ title: "x" })).status).toBe(400);

    // The real clock is in October 2026 (the test suite's "today").
    const home = await as(grace).get("/api/home");
    if (new Date().toISOString().startsWith("2026-10")) expect(home.body.monthlyGoal.title).toBe("Sacrifice ME time 2");

    await as(admin).delete("/api/admin/monthly-goals/2026-10").expect(204);
    expect((await as(admin).delete("/api/admin/monthly-goals/2026-10")).status).toBe(404);
  });
});

describe("people", () => {
  const find = async (q: string) => (await as(admin).get(`/api/admin/users?q=${encodeURIComponent(q)}`)).body.items;

  it("searches by name or @username, without exposing Telegram IDs", async () => {
    expect((await find("gra")).map((u: any) => u.name)).toEqual(["Grace Tan"]);
    expect((await find("@gracet"))[0]).toMatchObject({ name: "Grace Tan", role: "USER", cellGroup: { code: "AP1" }, isWhitelisted: false });
    const all = await as(admin).get("/api/admin/users");
    expect(all.body.items).toHaveLength(3);
    expect(JSON.stringify(all.body)).not.toContain("telegramId");
    expect((await as(admin).get("/api/admin/users?role=ADMIN")).body.items.map((u: any) => u.name)).toEqual(["Ryan Wang"]);
  });

  it("promotes and demotes admins", async () => {
    const [b] = await find("Ben");
    const promoted = await as(admin).post(`/api/admin/users/${b.id}/role`).send({ role: "ADMIN" });
    expect(promoted.body.role).toBe("ADMIN");
    expect((await as(ben).get("/api/me")).body.isAdmin).toBe(true);
    expect((await as(ben).get("/api/admin/users")).status).toBe(200);

    await as(admin).post(`/api/admin/users/${b.id}/role`).send({ role: "USER" }).expect(200);
    expect((await as(ben).get("/api/admin/users")).status).toBe(403);

    const actions = (await prisma.auditLog.findMany({ orderBy: { createdAt: "asc" } })).map((a) => a.action);
    expect(actions).toEqual(["PROMOTE_ADMIN", "DEMOTE_ADMIN"]);
  });

  it("won't let admins demote themselves or a whitelisted admin", async () => {
    const [me] = await find("Ryan");
    expect((await as(admin).post(`/api/admin/users/${me.id}/role`).send({ role: "USER" })).body.error.code).toBe("CANNOT_DEMOTE_SELF");

    const [b] = await find("Ben");
    await as(admin).post(`/api/admin/users/${b.id}/role`).send({ role: "ADMIN" }).expect(200);
    const res = await as(ben).post(`/api/admin/users/${me.id}/role`).send({ role: "USER" });
    expect(res.body.error.code).toBe("WHITELISTED_ADMIN");
  });

  it("moves a member to another Cell Group, taking their points along", async () => {
    await prisma.user.update({ where: { telegramId: 6001n }, data: { totalPoints: 40 } });
    const [g] = await find("Grace");
    const res = await as(admin).patch(`/api/admin/users/${g.id}`).send({ cellGroupId: ap2 });
    expect(res.body.cellGroup.code).toBe("AP2");
    const board = (await as(admin).get("/api/leaderboard/cell-groups")).body.entries;
    expect(board.find((e: any) => e.code === "AP2").points).toBe(40);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "CELL_GROUP_CHANGE" } });
    expect(log.metadata).toEqual({ from: "AP1", to: "AP2" });
    expect((await as(admin).patch(`/api/admin/users/${g.id}`).send({ cellGroupId: "nope" })).status).toBe(400);
  });
});

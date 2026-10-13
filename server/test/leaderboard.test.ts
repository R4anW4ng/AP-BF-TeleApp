import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";
import { createMemoryStorage } from "../src/lib/storage.js";
import { authHeader, resetDatabase, tgUser } from "./helpers.js";

const app = createApp({ storage: createMemoryStorage() });

const grace = tgUser(5001, { first_name: "Grace", last_name: "Tan" });
const ben = tgUser(5002, { first_name: "Ben", last_name: "Lim" });
const chloe = tgUser(5003, { first_name: "Chloe", last_name: "Ng" });
const dan = tgUser(5004, { first_name: "Dan", last_name: "Koh" });
const eve = tgUser(5005, { first_name: "Eve", last_name: "Ong" });
const zed = tgUser(5006, { first_name: "Zed", last_name: "Lee" });

const get = (u: ReturnType<typeof tgUser>, path: string) => request(app).get(path).set("Authorization", authHeader(u));

/**
 * Grace  AP1 100  Show me on boards ON (default)
 * Ben    AP1  50  both OFF               → real name to everyone
 * Chloe  AP2 100  Stay Anonymous ON      → not listed, still counts for AP2
 * Dan    AP2  50  Show me on boards ON
 * Eve    —    10  both OFF, no Cell Group
 * Zed    AP3   0  no points              → not listed
 */
beforeEach(async () => {
  await resetDatabase();
  const cgs = await Promise.all(
    ["AP1", "AP2", "AP3", "AP4"].map((code, i) => prisma.cellGroup.create({ data: { code, name: `Cell Group ${code}`, sortOrder: i } })),
  );
  const cg = (code: string) => cgs.find((c) => c.code === code)!.id;
  const setups: [ReturnType<typeof tgUser>, object][] = [
    [grace, { cellGroupId: cg("AP1"), totalPoints: 100 }],
    [ben, { cellGroupId: cg("AP1"), totalPoints: 50, showOnBoards: false }],
    [chloe, { cellGroupId: cg("AP2"), totalPoints: 100, stayAnonymous: true }],
    [dan, { cellGroupId: cg("AP2"), totalPoints: 50 }],
    [eve, { totalPoints: 10, showOnBoards: false }],
    [zed, { cellGroupId: cg("AP3") }],
  ];
  for (const [u, data] of setups) {
    await get(u, "/api/me").expect(200); // registers the user
    await prisma.user.update({ where: { telegramId: BigInt(u.id) }, data });
  }
});

describe("individual leaderboard", () => {
  it("applies the privacy rules for a viewer in AP1", async () => {
    const res = await get(grace, "/api/leaderboard/individuals");
    expect(res.status).toBe(200);
    const byName = Object.fromEntries(res.body.entries.map((e: any) => [e.name, e]));
    expect(res.body.entries.map((e: any) => e.points)).toEqual([100, 50, 50, 10]);

    expect(byName["Grace Tan"]).toEqual({ rank: 1, name: "Grace Tan", isMe: true, cellGroup: "AP1", points: 100 });
    expect(byName["Ben Lim"]).toMatchObject({ rank: 2, cellGroup: "AP1" }); // both OFF: real name
    expect(byName["Anonymous"]).toMatchObject({ rank: 2, cellGroup: null, points: 50 }); // Dan, outside my CG
    expect(byName["Eve Ong"]).toMatchObject({ rank: 4, cellGroup: null });
    expect(JSON.stringify(res.body)).not.toMatch(/Chloe|Zed|Dan|telegramId|"id"/);
    expect(res.body).toMatchObject({ participants: 4, me: { rank: 1, points: 100, hidden: false } });
  });

  it("shows CG peers' real names and hides outsiders who chose 'Show me on boards'", async () => {
    const names = (await get(dan, "/api/leaderboard/individuals")).body.entries.map((e: any) => e.name);
    expect(names).toContain("Dan Koh"); // himself
    expect(names).toContain("Anonymous"); // Grace, AP1, seen from AP2
    expect(names).not.toContain("Grace Tan");
    expect(names).toContain("Ben Lim");
  });

  it("tells a Stay Anonymous member they're hidden, and a member without points they're unranked", async () => {
    expect((await get(chloe, "/api/leaderboard/individuals")).body.me).toEqual({ rank: null, points: 100, hidden: true });
    expect((await get(zed, "/api/leaderboard/individuals")).body.me).toEqual({ rank: null, points: 0, hidden: false });
  });

  it("ranks the viewer even when they're outside the top N", async () => {
    const res = await get(eve, "/api/leaderboard/individuals?limit=2");
    expect(res.body.entries).toHaveLength(2);
    expect(res.body.me).toEqual({ rank: 4, points: 10, hidden: false });
  });
});

describe("Cell Group leaderboard", () => {
  it("sums every member's points, including Stay Anonymous members, and lists empty groups", async () => {
    const res = await get(grace, "/api/leaderboard/cell-groups");
    expect(res.body.entries.map((e: any) => [e.code, e.points, e.members, e.rank, e.isMine])).toEqual([
      ["AP1", 150, 2, 1, true],
      ["AP2", 150, 2, 1, false], // Chloe's 100 counts even though she's hidden from the individual board
      ["AP3", 0, 1, 3, false],
      ["AP4", 0, 0, 3, false],
    ]);
  });

  it("subtracts a member's points when they delete their data", async () => {
    await request(app).delete("/api/me").set("Authorization", authHeader(grace)).send({ confirm: "DELETE" }).expect(204);
    const ap1 = (await get(ben, "/api/leaderboard/cell-groups")).body.entries.find((e: any) => e.code === "AP1");
    expect(ap1).toMatchObject({ points: 50, members: 1 });
  });
});

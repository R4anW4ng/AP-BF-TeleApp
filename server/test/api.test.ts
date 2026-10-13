import sharp from "sharp";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";
import { createMemoryStorage } from "../src/lib/storage.js";
import { sgWeekStart, weeklyPublishAt } from "../src/lib/time.js";
import { awardPoints } from "../src/services/points.js";
import { authHeader, resetDatabase, tgUser } from "./helpers.js";

const storage = createMemoryStorage();
const app = createApp({ storage });

const alice = tgUser(2001, { first_name: "Alice" });
const admin = tgUser(1000, { first_name: "Admin" }); // in ADMIN_TELEGRAM_IDS

const me = (u = alice) => request(app).get("/api/me").set("Authorization", authHeader(u));
const post = (path: string, u = alice) => request(app).post(path).set("Authorization", authHeader(u));

beforeEach(async () => {
  await resetDatabase();
  storage.objects.clear();
});

describe("initData middleware", () => {
  it("rejects requests without Telegram authorization", async () => {
    const res = await request(app).get("/api/me");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("rejects forged initData (initDataUnsafe-style spoofing)", async () => {
    const forged = new URLSearchParams(authHeader(alice).slice(4));
    forged.set("user", JSON.stringify({ ...alice, id: 1000 })); // pretend to be the admin
    const res = await request(app).get("/api/me").set("Authorization", `tma ${forged}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_INIT_DATA");
    expect(await prisma.user.count()).toBe(0);
  });

  it("rejects expired initData with a code the client can act on", async () => {
    const res = await request(app)
      .get("/api/me")
      .set("Authorization", authHeader(alice, new Date(Date.now() - 2 * 86_400_000)));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INIT_DATA_EXPIRED");
  });

  it("registers the user on first request and keeps their Telegram profile fresh", async () => {
    const first = await me();
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ name: "Alice Test", role: "USER", isAdmin: false, zone: "AP", pinEnabled: false });
    expect(first.body).not.toHaveProperty("telegramId");
    expect(first.body).not.toHaveProperty("pinHash");

    await me(tgUser(2001, { first_name: "Alicia" }));
    expect((await prisma.user.findUniqueOrThrow({ where: { telegramId: 2001n } })).firstName).toBe("Alicia");
    expect(await prisma.user.count()).toBe(1);
  });

  it("grants ADMIN to whitelisted Telegram IDs", async () => {
    expect((await me(admin)).body).toMatchObject({ role: "ADMIN", isAdmin: true });
  });

  it("sets Cache-Control: no-store on API responses", async () => {
    expect((await me()).headers["cache-control"]).toBe("no-store");
  });
});

describe("points", () => {
  it("awards 5 points per meal log, max 3 per day", async () => {
    const results = [];
    for (let i = 0; i < 4; i++) results.push((await post("/api/points/meal-log")).body);
    expect(results.map((r) => r.awarded)).toEqual([true, true, true, false]);
    expect(results[2]).toMatchObject({ totalPoints: 15, used: 3, cap: 3 });
    expect(results[3]).toMatchObject({ reason: "CAP_REACHED" });
  });

  it("holds the meal cap under concurrent taps", async () => {
    await me(); // create the user first
    const results = await Promise.all(Array.from({ length: 8 }, () => post("/api/points/meal-log")));
    expect(results.filter((r) => r.body.awarded).length).toBe(3);
    expect((await me()).body.points.total).toBe(15);
  });

  it("awards 100 points for tithe once per month", async () => {
    expect((await post("/api/points/tithe")).body).toMatchObject({ awarded: true, totalPoints: 100 });
    expect((await post("/api/points/tithe")).body).toMatchObject({ awarded: false, reason: "CAP_REACHED" });
  });

  it("awards 10 points per Living it Out post, max 2 per day", async () => {
    const { body } = await me();
    const awards = [];
    for (let i = 0; i < 3; i++) awards.push(await awardPoints(body.id, "LIVING_POST"));
    expect(awards.map((a) => a.awarded)).toEqual([true, true, false]);
    expect((await me()).body.points.total).toBe(20);
  });

  it("reports today's usage and builds a streak across SGT days", async () => {
    const { body } = await me();
    await awardPoints(body.id, "MEAL_LOG", { now: new Date(Date.now() - 86_400_000) });
    await post("/api/points/meal-log");
    const res = await me();
    expect(res.body.points.currentStreak).toBe(2);
    expect(res.body.usage.MEAL_LOG).toEqual({ used: 1, cap: 3, points: 5 });
  });
});

describe("profile", () => {
  it("lets a member pick a Cell Group once; later changes need an admin", async () => {
    const [ap1, ap2] = await Promise.all([
      prisma.cellGroup.create({ data: { code: "AP1", name: "Cell Group AP1" } }),
      prisma.cellGroup.create({ data: { code: "AP2", name: "Cell Group AP2" } }),
    ]);
    const patch = (body: object) => request(app).patch("/api/me").set("Authorization", authHeader(alice)).send(body);

    expect((await patch({ cellGroupId: ap1.id, stayAnonymous: true })).body).toMatchObject({
      cellGroup: { code: "AP1" },
      privacy: { stayAnonymous: true, showOnBoards: true },
    });
    expect((await patch({ cellGroupId: ap2.id })).body.error.code).toBe("CELL_GROUP_LOCKED");
    expect((await patch({ role: "ADMIN" })).status).toBe(400); // unknown fields rejected
  });

  it("locks the PIN after 5 wrong attempts", async () => {
    const pin = (method: "put" | "post", path: string, body: object) =>
      request(app)[method](path).set("Authorization", authHeader(alice)).send(body);

    expect((await pin("put", "/api/me/pin", { pin: "1234" })).body).toEqual({ pinEnabled: true });
    expect((await pin("post", "/api/me/pin/verify", { pin: "1234" })).body).toEqual({ ok: true });

    const wrong = await pin("post", "/api/me/pin/verify", { pin: "0000" });
    expect(wrong.status).toBe(403);
    expect(wrong.body.error).toMatchObject({ code: "PIN_INCORRECT", attemptsRemaining: 4 });
    for (let i = 0; i < 3; i++) await pin("post", "/api/me/pin/verify", { pin: "0000" });
    expect((await pin("post", "/api/me/pin/verify", { pin: "0000" })).status).toBe(423);
    // Even the right PIN is refused while locked.
    expect((await pin("post", "/api/me/pin/verify", { pin: "1234" })).status).toBe(423);

    const stored = await prisma.user.findUniqueOrThrow({ where: { telegramId: 2001n } });
    expect(stored.pinHash).toMatch(/^scrypt\$/);
  });
});

describe("home", () => {
  it("shows a challenge only once its Monday 05:00 SGT publish time has passed", async () => {
    const thisWeek = sgWeekStart();
    const nextWeek = new Date(thisWeek.getTime() + 7 * 86_400_000);
    const base = { financialInitiatives: ["No Grab", "Water Only"], memoryVerseText: "v", memoryVerseRef: "Mal 3:10" };
    await prisma.weeklyChallenge.createMany({
      data: [
        { ...base, weekStart: thisWeek, weekNumber: 1, title: "This week", publishAt: weeklyPublishAt(thisWeek) },
        { ...base, weekStart: nextWeek, weekNumber: 2, title: "Next week", publishAt: weeklyPublishAt(nextWeek) },
      ],
    });
    const res = await request(app).get("/api/home").set("Authorization", authHeader(alice));
    expect(res.body.challenge.title).toBe("This week");
    expect(res.body.campaign.totalWeeks).toBe(19);
  });
});

describe("uploads", () => {
  const jpegWithGps = () =>
    sharp({ create: { width: 2400, height: 1200, channels: 3, background: "#c33" } })
      .jpeg()
      .withExif({ IFD3: { GPSLatitudeRef: "N", GPSLatitude: "1/1 17/1 0/1" } })
      .toBuffer();

  it("re-encodes to WebP, downsizes, strips EXIF/GPS and records the media", async () => {
    const input = await jpegWithGps();
    expect((await sharp(input).metadata()).exif).toBeDefined();

    const res = await post("/api/uploads?kind=LIVING_POST").attach("image", input, "photo.jpg");
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ width: 1600, height: 800 });

    const [stored] = [...storage.objects.values()];
    const meta = await sharp(stored.body).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.exif).toBeUndefined();
    expect(await prisma.media.count({ where: { id: res.body.id, livingPostId: null } })).toBe(1);
  });

  it("rejects files that are not images", async () => {
    const res = await post("/api/uploads").attach("image", Buffer.from("#!/bin/sh\necho hi"), "photo.jpg");
    expect(res.status).toBe(415);
    expect(storage.objects.size).toBe(0);
  });

  it("only lets admins upload testimony images", async () => {
    const img = await jpegWithGps();
    expect((await post("/api/uploads?kind=TESTIMONY").attach("image", img, "a.jpg")).status).toBe(403);
    expect((await post("/api/uploads?kind=TESTIMONY", admin).attach("image", img, "a.jpg")).status).toBe(201);
  });
});

describe("delete my data", () => {
  it("removes PII and points, anonymises content, and drops unattached uploads", async () => {
    const cg = await prisma.cellGroup.create({ data: { code: "AP1", name: "Cell Group AP1" } });
    await request(app).patch("/api/me").set("Authorization", authHeader(alice)).send({ cellGroupId: cg.id });
    const { body: profile } = await me();
    await post("/api/points/tithe");
    const prayer = await prisma.prayer.create({ data: { authorId: profile.id, cellGroupId: cg.id, content: "Pray for me" } });
    await post("/api/uploads").attach("image", await sharp({ create: { width: 10, height: 10, channels: 3, background: "#fff" } }).png().toBuffer(), "a.png");
    expect(storage.objects.size).toBe(1);

    const unconfirmed = await request(app).delete("/api/me").set("Authorization", authHeader(alice)).send({});
    expect(unconfirmed.status).toBe(400);

    const res = await request(app).delete("/api/me").set("Authorization", authHeader(alice)).send({ confirm: "DELETE" });
    expect(res.status).toBe(204);

    expect(await prisma.user.count({ where: { telegramId: 2001n } })).toBe(0);
    expect(await prisma.pointTransaction.count()).toBe(0);
    expect(await prisma.prayer.findUniqueOrThrow({ where: { id: prayer.id } })).toMatchObject({
      authorId: null,
      cellGroupId: cg.id,
      content: "Pray for me",
    });
    expect(await prisma.media.count()).toBe(0);
    expect(storage.objects.size).toBe(0);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "USER_SELF_DELETE" } });
    expect(audit).toMatchObject({ actorId: null, targetId: null, metadata: null });
  });
});

describe("without object storage", () => {
  it("returns 503 for uploads but keeps the rest of the API working", async () => {
    const { createUnconfiguredStorage } = await import("../src/lib/storage.js");
    const bare = createApp({ storage: createUnconfiguredStorage() });
    const res = await request(bare).post("/api/uploads").set("Authorization", authHeader(alice)).attach("image", Buffer.from("x"), "a.jpg");
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("STORAGE_UNAVAILABLE");
    expect((await request(bare).delete("/api/me").set("Authorization", authHeader(alice)).send({ confirm: "DELETE" })).status).toBe(204);
  });
});

import sharp from "sharp";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";
import { createMemoryStorage } from "../src/lib/storage.js";
import { authHeader, resetDatabase, tgUser } from "./helpers.js";

const storage = createMemoryStorage();
const app = createApp({ storage });

const grace = tgUser(4001, { first_name: "Grace", last_name: "Tan" }); // AP1
const ben = tgUser(4002, { first_name: "Ben", last_name: "Lim" }); // AP1
const chloe = tgUser(4003, { first_name: "Chloe", last_name: "Ng" }); // AP2
const admin = tgUser(1000, { first_name: "Admin" });

const as = (u: ReturnType<typeof tgUser>) => ({
  get: (path: string) => request(app).get(path).set("Authorization", authHeader(u)),
  post: (path: string) => request(app).post(path).set("Authorization", authHeader(u)),
  put: (path: string) => request(app).put(path).set("Authorization", authHeader(u)),
  delete: (path: string) => request(app).delete(path).set("Authorization", authHeader(u)),
  patch: (path: string) => request(app).patch(path).set("Authorization", authHeader(u)),
});

const png = () => sharp({ create: { width: 40, height: 30, channels: 3, background: "#3a6" } }).png().toBuffer();

beforeEach(async () => {
  await resetDatabase();
  storage.objects.clear();
  const [ap1, ap2] = await Promise.all([
    prisma.cellGroup.create({ data: { code: "AP1", name: "Cell Group AP1", sortOrder: 0 } }),
    prisma.cellGroup.create({ data: { code: "AP2", name: "Cell Group AP2", sortOrder: 1 } }),
  ]);
  for (const [u, cg] of [[grace, ap1], [ben, ap1], [chloe, ap2]] as const) {
    await as(u).patch("/api/me").send({ cellGroupId: cg.id }).expect(200);
  }
});

describe("all feed routes require Telegram initData", () => {
  it.each([
    ["get", "/api/prayers"],
    ["post", "/api/prayers"],
    ["post", "/api/prayers/x/comments"],
    ["post", "/api/prayers/x/reactions"],
    ["get", "/api/living"],
    ["post", "/api/living"],
    ["get", "/api/testimonies"],
    ["get", "/api/testimonies/x"],
    ["post", "/api/testimonies"],
    ["put", "/api/testimonies/x"],
    ["delete", "/api/testimonies/x"],
  ] as const)("%s %s → 401", async (method, path) => {
    expect((await request(app)[method](path)).status).toBe(401);
  });
});

describe("Prayer Wall", () => {
  it("creates, lists with author/CG, comments and reactions", async () => {
    const created = await as(grace).post("/api/prayers").send({ content: "  Pray for my exams  " });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      content: "Pray for my exams",
      author: { name: "Grace Tan", isMe: true, isAnonymous: false },
      cellGroup: { code: "AP1" },
      commentCount: 0,
    });
    const id = created.body.id;

    await as(ben).post(`/api/prayers/${id}/comments`).send({ content: "Praying for you!" }).expect(201);
    await as(chloe).post(`/api/prayers/${id}/reactions`).send({ type: "AMEN" }).expect(200);
    const toggle = await as(ben).post(`/api/prayers/${id}/reactions`).send({ type: "HEART" });
    expect(toggle.body.reactions).toMatchObject({ counts: { HEART: 1, AMEN: 1 }, mine: ["HEART"] });

    const list = await as(chloe).get("/api/prayers");
    expect(list.status).toBe(200);
    const [prayer] = list.body.items;
    expect(prayer.author).toEqual({ name: "Grace Tan", isMe: false, isAnonymous: false });
    expect(prayer.comments).toEqual([
      expect.objectContaining({ content: "Praying for you!", author: { name: "Ben Lim", isMe: false, isAnonymous: false } }),
    ]);
    expect(prayer.reactions).toEqual({ counts: { HEART: 1, AMEN: 1, PRAYING: 0, HUG: 0 }, mine: ["AMEN"] });
    expect(JSON.stringify(list.body)).not.toMatch(/telegramId|firstName|userId/);
  });

  it("toggles a reaction off on the second tap, and survives a double-tap race", async () => {
    const { body } = await as(grace).post("/api/prayers").send({ content: "x" });
    const react = () => as(ben).post(`/api/prayers/${body.id}/reactions`).send({ type: "PRAYING" });
    expect((await react()).body.reactions.counts.PRAYING).toBe(1);
    expect((await react()).body.reactions.counts.PRAYING).toBe(0);
    const results = await Promise.all([react(), react()]);
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(await prisma.prayerReaction.count()).toBeLessThanOrEqual(1);
  });

  it("hides names for anonymous posts and Stay Anonymous users, but not from the author", async () => {
    await as(grace).post("/api/prayers").send({ content: "anon", isAnonymous: true });
    await as(ben).patch("/api/me").send({ stayAnonymous: true });
    await as(ben).post("/api/prayers").send({ content: "ben" });

    const names = (await as(chloe).get("/api/prayers")).body.items.map((p: any) => p.author.name);
    expect(names).toEqual(["Anonymous", "Anonymous"]);
    const own = (await as(grace).get("/api/prayers")).body.items.find((p: any) => p.content === "anon");
    expect(own.author).toEqual({ name: "Grace Tan", isMe: true, isAnonymous: true });
  });

  it("shows Former Member after the author deletes their data", async () => {
    await as(grace).post("/api/prayers").send({ content: "old prayer" });
    await as(grace).delete("/api/me").send({ confirm: "DELETE" }).expect(204);
    const [p] = (await as(ben).get("/api/prayers")).body.items;
    expect(p.author.name).toBe("Former Member");
    expect(p.cellGroup.code).toBe("AP1");
  });

  it("paginates newest first with a cursor", async () => {
    for (let i = 1; i <= 5; i++) await as(grace).post("/api/prayers").send({ content: `p${i}` });
    const first = await as(grace).get("/api/prayers?limit=2");
    expect(first.body.items.map((p: any) => p.content)).toEqual(["p5", "p4"]);
    const second = await as(grace).get(`/api/prayers?limit=2&cursor=${first.body.nextCursor}`);
    expect(second.body.items.map((p: any) => p.content)).toEqual(["p3", "p2"]);
    const last = await as(grace).get(`/api/prayers?limit=2&cursor=${second.body.nextCursor}`);
    expect(last.body).toMatchObject({ items: [expect.objectContaining({ content: "p1" })], nextCursor: null });
  });

  it("validates input and 404s unknown prayers", async () => {
    expect((await as(grace).post("/api/prayers").send({ content: "   " })).status).toBe(400);
    expect((await as(grace).post("/api/prayers").send({ content: "x", authorId: "someone" })).status).toBe(400);
    expect((await as(grace).post("/api/prayers/nope/comments").send({ content: "x" })).status).toBe(404);
    expect((await as(grace).post("/api/prayers/nope/reactions").send({ type: "LOL" })).status).toBe(400);
  });
});

describe("Living it Out", () => {
  const postLiving = (u: ReturnType<typeof tgUser>, content: string, images: Buffer[] = []) => {
    let req = as(u).post("/api/living").field("content", content);
    for (const [i, img] of images.entries()) req = req.attach("images", img, `p${i}.png`);
    return req;
  };

  it("uploads photos to storage, records week/CG, and awards 10 points up to 2 per day", async () => {
    const first = await postLiving(grace, "DIY coffee instead of Starbucks ☕", [await png(), await png()]);
    expect(first.status).toBe(201);
    expect(first.body.post).toMatchObject({
      content: "DIY coffee instead of Starbucks ☕",
      cellGroup: { code: "AP1" },
      author: { name: "Grace Tan", isMe: true },
    });
    expect(typeof first.body.post.weekNumber).toBe("number");
    expect(first.body.post.images).toHaveLength(2);
    expect(first.body.post.images[0].url).toMatch(/^memory:\/\/living-post\/.+\.webp$/);
    expect(storage.objects.size).toBe(2);
    expect(first.body.points).toMatchObject({ awarded: true, points: 10, totalPoints: 10 });

    expect((await postLiving(grace, "second")).body.points).toMatchObject({ awarded: true, totalPoints: 20 });
    const third = await postLiving(grace, "third");
    expect(third.status).toBe(201); // still published…
    expect(third.body.points).toMatchObject({ awarded: false, reason: "CAP_REACHED" }); // …but no more points
    expect((await as(grace).get("/api/me")).body.points.total).toBe(20);
  });

  it("filters by ?zone= Cell Group code", async () => {
    await postLiving(grace, "g");
    await postLiving(ben, "b");
    await postLiving(chloe, "c");
    const content = async (q: string) => (await as(grace).get(`/api/living${q}`)).body.items.map((p: any) => p.content);
    expect(await content("")).toEqual(["c", "b", "g"]);
    expect(await content("?zone=ALL")).toEqual(["c", "b", "g"]);
    expect(await content("?zone=AP1")).toEqual(["b", "g"]);
    expect(await content("?zone=ap2")).toEqual(["c"]);
    expect(await content("?zone=AP9")).toEqual([]);
    expect((await as(grace).get("/api/living?zone=AP1';--")).status).toBe(400);
  });

  it("rejects non-images and leaves nothing behind", async () => {
    const res = await postLiving(grace, "x", [await png(), Buffer.from("not an image")]);
    expect(res.status).toBe(415);
    expect(storage.objects.size).toBe(0);
    expect(await prisma.livingPost.count()).toBe(0);
    expect(await prisma.pointTransaction.count()).toBe(0);
  });

  it("rejects more than 4 photos", async () => {
    const img = await png();
    const res = await postLiving(grace, "x", [img, img, img, img, img]);
    expect(res.status).toBe(400);
    expect(storage.objects.size).toBe(0);
  });

  it("needs storage only when photos are attached", async () => {
    const { createUnconfiguredStorage } = await import("../src/lib/storage.js");
    const bare = createApp({ storage: createUnconfiguredStorage() });
    const text = await request(bare).post("/api/living").set("Authorization", authHeader(grace)).field("content", "text only");
    expect(text.status).toBe(201);
    const withPhoto = await request(bare)
      .post("/api/living")
      .set("Authorization", authHeader(grace))
      .field("content", "x")
      .attach("images", await png(), "a.png");
    expect(withPhoto.status).toBe(503);
  });
});

describe("Testimonies", () => {
  const uploadTestimonyImage = async () =>
    (await as(admin).post("/api/uploads?kind=TESTIMONY").attach("image", await png(), "t.png")).body.id as string;

  const draft = (overrides: object = {}) => ({
    title: "How God provided our rent",
    subtitle: "A story from AP2",
    byline: "A member of AP2",
    blocks: [
      { type: "heading", text: "The month we had nothing" },
      { type: "paragraph", text: "We gave our tithe anyway…" },
      { type: "quote", text: "My God will meet all your needs", cite: "Philippians 4:19" },
    ],
    status: "PUBLISHED",
    ...overrides,
  });

  it("only admins can create, update and delete", async () => {
    expect((await as(grace).post("/api/testimonies").send(draft())).status).toBe(403);
    const created = await as(admin).post("/api/testimonies").send(draft());
    expect(created.status).toBe(201);
    const id = created.body.id;
    expect((await as(grace).put(`/api/testimonies/${id}`).send(draft({ title: "hacked" }))).status).toBe(403);
    expect((await as(grace).delete(`/api/testimonies/${id}`)).status).toBe(403);
    expect((await as(admin).put(`/api/testimonies/${id}`).send(draft({ title: "Updated" }))).body.title).toBe("Updated");
    expect((await as(admin).delete(`/api/testimonies/${id}`)).status).toBe(204);
    expect(await prisma.testimony.count()).toBe(0);
    expect(
      (await prisma.auditLog.findMany({ orderBy: { createdAt: "asc" } })).map((a) => a.action),
    ).toEqual(["TESTIMONY_CREATE", "TESTIMONY_UPDATE", "TESTIMONY_DELETE"]);
  });

  it("serves published testimonies with inline images to everyone; drafts only to admins", async () => {
    const coverId = await uploadTestimonyImage();
    const inlineId = await uploadTestimonyImage();
    const pub = await as(admin)
      .post("/api/testimonies")
      .send(draft({ coverMediaId: coverId, blocks: [...draft().blocks, { type: "image", mediaId: inlineId, caption: "Our home" }] }));
    expect(pub.status).toBe(201);
    await as(admin).post("/api/testimonies").send(draft({ title: "Draft story", status: "DRAFT" })).expect(201);

    const list = await as(grace).get("/api/testimonies");
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({
      title: "How God provided our rent",
      excerpt: "We gave our tithe anyway…",
      coverUrl: expect.stringMatching(/^memory:\/\/testimony\//),
      publishedAt: expect.any(String),
    });
    expect(list.body.items[0]).not.toHaveProperty("authorId");

    const full = await as(grace).get(`/api/testimonies/${pub.body.slug}`);
    expect(full.body.blocks.at(-1)).toMatchObject({ type: "image", caption: "Our home", url: expect.stringMatching(/^memory:\/\//) });

    expect((await as(admin).get("/api/testimonies?status=all")).body.items).toHaveLength(2);
    expect((await as(grace).get("/api/testimonies?status=all")).body.items).toHaveLength(1);
    const draftRow = await prisma.testimony.findFirstOrThrow({ where: { status: "DRAFT" } });
    expect((await as(grace).get(`/api/testimonies/${draftRow.id}`)).status).toBe(404);
    expect((await as(admin).get(`/api/testimonies/${draftRow.id}`)).status).toBe(200);
  });

  it("rejects HTML/unknown block types and images that aren't testimony uploads", async () => {
    expect((await as(admin).post("/api/testimonies").send(draft({ blocks: [{ type: "html", html: "<script>" }] }))).status).toBe(400);
    const livingImg = (await as(grace).post("/api/uploads?kind=LIVING_POST").attach("image", await png(), "a.png")).body.id;
    const res = await as(admin).post("/api/testimonies").send(draft({ blocks: [{ type: "image", mediaId: livingImg }] }));
    expect(res.status).toBe(400);
  });

  it("deletes images (DB and storage) that an edit removes, and all images on delete", async () => {
    const a = await uploadTestimonyImage();
    const b = await uploadTestimonyImage();
    const created = await as(admin)
      .post("/api/testimonies")
      .send(draft({ coverMediaId: a, blocks: [{ type: "image", mediaId: b }, { type: "paragraph", text: "p" }] }));
    expect(storage.objects.size).toBe(2);

    await as(admin).put(`/api/testimonies/${created.body.id}`).send(draft({ coverMediaId: a, blocks: [{ type: "paragraph", text: "p" }] })).expect(200);
    expect(await prisma.media.count()).toBe(1);
    expect(storage.objects.size).toBe(1);

    await as(admin).delete(`/api/testimonies/${created.body.id}`).expect(204);
    expect(await prisma.media.count()).toBe(0);
    expect(storage.objects.size).toBe(0);
  });
});

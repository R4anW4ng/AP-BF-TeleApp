import type { Update } from "node-telegram-bot-api";
import { beforeEach, describe, expect, it } from "vitest";
import { createBot } from "../src/bot.js";
import { prisma } from "../src/db.js";
import { syncTelegramUser } from "../src/services/users.js";
import { TEST_ENV } from "./env.js";
import { fakeTelegram } from "./fakeTelegram.js";
import { resetDatabase } from "./helpers.js";

let updateId = 1;
const from = { id: 3001, is_bot: false, first_name: "Grace <3", last_name: "Tan", username: "gracet", language_code: "en" };

function message(text: string, overrides: { chatType?: "private" | "group"; sender?: typeof from } = {}): Update {
  const sender = overrides.sender ?? from;
  const chat =
    overrides.chatType === "group"
      ? { id: -100123, type: "group" as const, title: "AP Zone" }
      : { id: sender.id, type: "private" as const, first_name: sender.first_name };
  return {
    update_id: updateId++,
    message: {
      message_id: updateId,
      date: Math.floor(Date.now() / 1000),
      chat,
      from: sender,
      text,
      entities: text.startsWith("/") ? [{ type: "bot_command", offset: 0, length: text.split(" ")[0].length }] : [],
    },
  } as Update;
}

function myChatMember(status: "kicked" | "member"): Update {
  const old = status === "kicked" ? "member" : "kicked";
  return {
    update_id: updateId++,
    my_chat_member: {
      chat: { id: from.id, type: "private", first_name: from.first_name },
      from,
      date: Math.floor(Date.now() / 1000),
      old_chat_member: { status: old, user: { id: 1, is_bot: true, first_name: "bot" } },
      new_chat_member: { status, user: { id: 1, is_bot: true, first_name: "bot" } },
    },
  } as Update;
}

function setup() {
  const tg = fakeTelegram();
  const bot = createBot(TEST_ENV.TELEGRAM_BOT_TOKEN, { fetch: tg.fetch, maxRetries: 0 });
  return { tg, bot };
}

beforeEach(resetDatabase);

describe("/start", () => {
  it("saves the Telegram user and replies with a button that opens the Mini App", async () => {
    const { tg, bot } = setup();
    await bot.handleUpdate(message("/start"));

    const user = await prisma.user.findUniqueOrThrow({ where: { telegramId: 3001n } });
    expect(user).toMatchObject({ firstName: "Grace <3", lastName: "Tan", username: "gracet", role: "USER", botBlocked: false });
    expect(user.botStartedAt).toBeInstanceOf(Date);

    const [reply] = tg.sent();
    expect(reply.params.chat_id).toBe("3001");
    expect(reply.params.parse_mode).toBe("HTML");
    expect(reply.params.text).toContain("Welcome, <b>Grace &lt;3</b>");
    expect(reply.params.text).toContain("Monday at 5:00 AM");
    expect(reply.params.reply_markup).toEqual({
      inline_keyboard: [[{ text: "Open Building Fund app", web_app: { url: "https://miniapp.example.org/" } }]],
    });
  });

  it("is idempotent and keeps Mini App data (photo, Cell Group) intact", async () => {
    const cg = await prisma.cellGroup.create({ data: { code: "AP2", name: "Cell Group AP2" } });
    const existing = await syncTelegramUser({ ...from, photo_url: "https://t.me/i/userpic/1.jpg" });
    await prisma.user.update({ where: { id: existing.id }, data: { cellGroupId: cg.id, botBlocked: true } });

    const { bot } = setup();
    await bot.handleUpdate(message("/start"));
    await bot.handleUpdate(message("/start some-deep-link"));

    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: existing.id } })).toMatchObject({
      photoUrl: "https://t.me/i/userpic/1.jpg",
      cellGroupId: cg.id,
      botBlocked: false, // pressing /start (or "Restart") after a block makes them reachable again
    });
  });

  it("makes whitelisted Telegram IDs admins", async () => {
    const { bot } = setup();
    await bot.handleUpdate(message("/start", { sender: { ...from, id: 1000 } }));
    expect((await prisma.user.findUniqueOrThrow({ where: { telegramId: 1000n } })).role).toBe("ADMIN");
  });

  it("asks people in group chats to message privately, without registering the group", async () => {
    const { tg, bot } = setup();
    await bot.handleUpdate(message("/start", { chatType: "group" }));
    expect(await prisma.user.count()).toBe(0);
    expect(tg.sent()[0].params.text).toContain("private chat");
  });

  it("ignores other bots", async () => {
    const { tg, bot } = setup();
    await bot.handleUpdate(message("/start", { sender: { ...from, is_bot: true } }));
    expect(await prisma.user.count()).toBe(0);
    expect(tg.sent()).toHaveLength(0);
  });
});

describe("block tracking", () => {
  it("flags users who block the bot and clears the flag when they unblock", async () => {
    const { bot } = setup();
    await bot.handleUpdate(message("/start"));
    await bot.handleUpdate(myChatMember("kicked"));
    expect((await prisma.user.findUniqueOrThrow({ where: { telegramId: 3001n } })).botBlocked).toBe(true);
    await bot.handleUpdate(myChatMember("member"));
    expect((await prisma.user.findUniqueOrThrow({ where: { telegramId: 3001n } })).botBlocked).toBe(false);
  });
});

describe("/resetpin", () => {
  it("removes the sender's PIN", async () => {
    const { tg, bot } = setup();
    await bot.handleUpdate(message("/start"));
    await prisma.user.update({ where: { telegramId: 3001n }, data: { pinHash: "scrypt$x", pinFailedAttempts: 3 } });
    await bot.handleUpdate(message("/resetpin"));
    expect(await prisma.user.findUniqueOrThrow({ where: { telegramId: 3001n } })).toMatchObject({
      pinHash: null,
      pinFailedAttempts: 0,
    });
    expect(tg.sent().at(-1)!.params.text).toContain("PIN has been removed");
  });
});

describe("startBot", () => {
  it("gives up on a rejected token instead of retrying forever", async () => {
    const { startBot } = await import("../src/bot.js");
    const tg = fakeTelegram(() => ({ ok: false, error_code: 401, description: "Unauthorized" }));
    const bot = createBot(TEST_ENV.TELEGRAM_BOT_TOKEN, { fetch: tg.fetch, maxRetries: 0 });
    await startBot(bot); // resolves instead of looping
    expect(tg.calls.map((c) => c.method)).toEqual(["deleteWebhook"]);
    expect(bot.isRunning()).toBe(false);
  });
});

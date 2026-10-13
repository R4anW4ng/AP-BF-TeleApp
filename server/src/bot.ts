import { Bot, type BotOptions, type Context, TelegramApiError } from "node-telegram-bot-api";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { escapeHtml } from "./lib/telegramHtml.js";
import { openAppKeyboard } from "./services/broadcast.js";
import { registerBotUser, setBotBlocked } from "./services/users.js";

const COMMANDS = [
  { command: "start", description: "Open the Building Fund app" },
  { command: "help", description: "What this bot does" },
  { command: "resetpin", description: "Remove your app PIN lock" },
];

/** Only private chats can open Web Apps or receive the Monday broadcast. */
function privateSender(ctx: Context) {
  const from = ctx.from;
  if (!from || from.is_bot || ctx.chat?.type !== "private") return undefined;
  return from;
}

async function handleStart(ctx: Context): Promise<void> {
  const from = privateSender(ctx);
  if (!from) {
    if (ctx.chat && ctx.chat.type !== "private") {
      await ctx.reply("Please open a private chat with me and send /start to join the Building Fund app.");
    }
    return;
  }

  // Saves the Telegram ID so this user gets the Monday 05:00 broadcast.
  await registerBotUser(from);

  await ctx.reply(
    [
      `👋 Welcome, <b>${escapeHtml(from.first_name)}</b>!`,
      "",
      `This is the <b>${escapeHtml(config.ZONE_NAME)} Building Fund</b> companion. Log your daily sacrifices, pray with the zone, and see how your Cell Group is doing through Feb 2027.`,
      "",
      "📬 Every <b>Monday at 5:00 AM</b> I'll send you the new memory verse and the week's challenge.",
      "",
      "Tap the button below to open the app.",
    ].join("\n"),
    { parse_mode: "HTML", reply_markup: openAppKeyboard() },
  );
}

async function handleHelp(ctx: Context): Promise<void> {
  await ctx.reply(
    [
      "<b>Commands</b>",
      "/start: open the Building Fund app",
      "/resetpin: remove your app PIN lock if you've forgotten it",
      "",
      "You can turn the Monday message off under <b>Me → Settings</b> in the app.",
    ].join("\n"),
    { parse_mode: "HTML", reply_markup: openAppKeyboard() },
  );
}

/**
 * Forgotten-PIN recovery. The message itself proves the sender owns this
 * Telegram account, which is the same proof the Mini App relies on.
 */
async function handleResetPin(ctx: Context): Promise<void> {
  const from = privateSender(ctx);
  if (!from) return;
  const { count } = await prisma.user.updateMany({
    where: { telegramId: BigInt(from.id), pinHash: { not: null } },
    data: { pinHash: null, pinFailedAttempts: 0, pinLockedUntil: null },
  });
  await ctx.reply(
    count > 0
      ? "🔓 Your app PIN has been removed. You can set a new one under Me → Security."
      : "You don't have an app PIN set.",
  );
}

/** Telegram tells us when a user blocks (status "kicked") or unblocks the bot. */
async function handleMyChatMember(ctx: Context): Promise<void> {
  if (!("my_chat_member" in ctx.update)) return;
  const update = ctx.update.my_chat_member;
  if (update.chat.type !== "private") return;
  const status = update.new_chat_member.status;
  if (status === "kicked") await setBotBlocked(update.from.id, true);
  else if (status === "member") await setBotBlocked(update.from.id, false);
}

export function createBot(token: string = config.TELEGRAM_BOT_TOKEN, options: BotOptions = {}): Bot {
  // Stay under Telegram's ~30 messages/second limit during the Monday broadcast.
  const bot = new Bot(token, { rateLimit: { global: 25 }, ...options });

  bot.command("start", handleStart);
  bot.command("help", handleHelp);
  bot.command("resetpin", handleResetPin);
  bot.on("my_chat_member", handleMyChatMember);

  bot.catch((err, ctx) => {
    console.error(`[bot] update ${ctx.update.update_id} failed:`, err);
  });

  return bot;
}

const RETRY_MIN_MS = 5_000;
const RETRY_MAX_MS = 5 * 60_000;

/**
 * Connect to Telegram and start long polling. Runs in the background and never
 * throws: while Telegram is unreachable it retries with backoff, and the API
 * keeps serving the Mini App meanwhile. A rejected token (401) stops retrying.
 */
export async function startBot(bot: Bot, signal?: AbortSignal): Promise<void> {
  for (let delay = RETRY_MIN_MS; !signal?.aborted; delay = Math.min(delay * 2, RETRY_MAX_MS)) {
    try {
      // Polling and webhooks are mutually exclusive; clear any webhook left from another deploy.
      await bot.api.deleteWebhook({ drop_pending_updates: false });
      await bot.api.setMyCommands({ commands: COMMANDS });
      const me = await bot.api.getMe();
      console.log(`[bot] @${me.username} polling for updates`);
      break;
    } catch (err) {
      if (err instanceof TelegramApiError && err.errorCode === 401) {
        console.error("[bot] Telegram rejected TELEGRAM_BOT_TOKEN (401). Bot disabled; fix the token and restart.");
        return;
      }
      console.warn(`[bot] can't reach Telegram (${err instanceof Error ? err.message : err}); retrying in ${delay / 1000}s`);
      await new Promise((resolve) => setTimeout(resolve, delay).unref());
    }
  }
  if (signal?.aborted) return;

  await bot
    .startPolling(undefined, {
      allowedUpdates: ["message", "my_chat_member"],
      onError: (err) => console.warn("[bot] polling error, retrying:", err instanceof Error ? err.message : err),
    })
    .catch((err) => {
      // e.g. 409 Conflict: another process is polling with the same token.
      console.error("[bot] polling stopped:", err);
    });
}

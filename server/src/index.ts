import { createApp } from "./app.js";
import { createBot, startBot } from "./bot.js";
import { config } from "./config.js";
import { startCron } from "./cron.js";
import { prisma } from "./db.js";
import { createS3Storage, createUnconfiguredStorage } from "./lib/storage.js";

const storage = config.storage ? createS3Storage(config.storage) : createUnconfiguredStorage();
if (!config.storage) {
  console.warn("[storage] S3_* variables not set — photo uploads will return 503.");
}

const app = createApp({ storage });

const server = app.listen(config.PORT, () => {
  console.log(`[server] listening on :${config.PORT} (${config.NODE_ENV})`);
});

// One Bot instance: long polling for /start etc., and its API client for the broadcast.
const bot = createBot();
const botAbort = new AbortController();
if (config.BOT_POLLING) void startBot(bot, botAbort.signal);
else console.log("[bot] BOT_POLLING=false: not polling for updates.");

// Independent of polling: the broadcast only needs the bot's API client.
const cronJobs = config.CRON_ENABLED ? startCron(bot.api) : undefined;
if (!cronJobs) console.log("[cron] CRON_ENABLED=false: Monday broadcast disabled in this process.");

async function shutdown(signal: string) {
  console.log(`[server] ${signal} received, shutting down`);
  botAbort.abort();
  bot.stop();
  await cronJobs?.stop();
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

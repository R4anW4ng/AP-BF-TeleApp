import { createApp } from "./app.js";
import { config } from "./config.js";
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

// The Telegram bot and cron jobs attach here in Phase 3.

async function shutdown(signal: string) {
  console.log(`[server] ${signal} received, shutting down`);
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

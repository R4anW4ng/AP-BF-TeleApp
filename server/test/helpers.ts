import { prisma } from "../src/db.js";
import { signInitData, type TelegramUser } from "../src/lib/telegramInitData.js";
import { TEST_ENV } from "./env.js";

export function tgUser(id: number, overrides: Partial<TelegramUser> = {}): TelegramUser {
  return { id, first_name: `User${id}`, last_name: "Test", username: `user${id}`, ...overrides };
}

/** `Authorization` header value for a correctly signed initData. */
export function authHeader(user: TelegramUser, authDate: Date = new Date()): string {
  return `tma ${signInitData({ user, authDate, query_id: "AAH-test" }, TEST_ENV.TELEGRAM_BOT_TOKEN)}`;
}

export async function resetDatabase() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
}

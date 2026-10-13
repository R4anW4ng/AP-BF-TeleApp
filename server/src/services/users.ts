import { config } from "../config.js";
import { prisma } from "../db.js";
import type { Prisma, User } from "../generated/prisma/client.js";
import { isUniqueViolation } from "../lib/prismaErrors.js";
import type { TelegramUser } from "../lib/telegramInitData.js";
import { deleteObjects, type Storage } from "../lib/storage.js";

/** Only bump lastSeenAt this often, so normal requests stay read-only. */
const LAST_SEEN_THROTTLE_MS = 5 * 60 * 1000;

/**
 * Find or create the user behind a validated initData payload, keeping their
 * Telegram profile fresh and applying the ADMIN_TELEGRAM_IDS whitelist.
 */
export async function syncTelegramUser(tg: TelegramUser, now: Date = new Date()): Promise<User> {
  const telegramId = BigInt(tg.id);
  const isWhitelistedAdmin = config.adminTelegramIds.has(telegramId);
  const profile: Pick<User, "firstName" | "lastName" | "username" | "languageCode"> & { photoUrl?: string | null } = {
    firstName: tg.first_name,
    lastName: tg.last_name ?? null,
    username: tg.username ?? null,
    languageCode: tg.language_code ?? null,
  };
  // Only Mini App initData carries photo_url; bot messages never do, so don't let /start erase it.
  if ("photo_url" in tg) profile.photoUrl = tg.photo_url ?? null;

  const existing = await prisma.user.findUnique({ where: { telegramId } });

  if (!existing) {
    try {
      return await prisma.user.create({
        data: { telegramId, ...profile, role: isWhitelistedAdmin ? "ADMIN" : "USER", lastSeenAt: now },
      });
    } catch (e) {
      // Two first requests raced; the other one created the row.
      if (!isUniqueViolation(e)) throw e;
      return prisma.user.findUniqueOrThrow({ where: { telegramId } });
    }
  }

  const changes: Prisma.UserUpdateInput = Object.fromEntries(
    Object.entries(profile).filter(([key, value]) => existing[key as keyof typeof profile] !== value),
  );
  if (isWhitelistedAdmin && existing.role !== "ADMIN") changes.role = "ADMIN";
  if (now.getTime() - existing.lastSeenAt.getTime() > LAST_SEEN_THROTTLE_MS) changes.lastSeenAt = now;

  if (Object.keys(changes).length === 0) return existing;
  return prisma.user.update({ where: { id: existing.id }, data: changes });
}

/**
 * Called on /start: make sure the user exists and mark them reachable by the bot.
 * Users created here have no Cell Group yet; they pick one in the Mini App.
 */
export async function registerBotUser(from: TelegramUser, now: Date = new Date()): Promise<User> {
  const user = await syncTelegramUser(from, now);
  if (user.botStartedAt && !user.botBlocked) return user;
  return prisma.user.update({
    where: { id: user.id },
    data: { botStartedAt: user.botStartedAt ?? now, botBlocked: false },
  });
}

/** Record that Telegram says the bot can (not) message this user. Unknown IDs are ignored. */
export async function setBotBlocked(telegramId: number, blocked: boolean): Promise<void> {
  await prisma.user.updateMany({ where: { telegramId: BigInt(telegramId) }, data: { botBlocked: blocked } });
}

/**
 * "Delete my data". One transaction:
 *  - the users row (all PII, PIN hash, Telegram ID) is deleted;
 *  - point ledger rows and reactions CASCADE, so points leave every leaderboard;
 *  - prayers, comments and posts keep their content with authorId = NULL ("Former Member");
 *  - uploads that were never attached to a post are removed;
 *  - a USER_SELF_DELETE audit row is written with no identifying data.
 */
export async function deleteUserData(userId: string, storage: Storage): Promise<void> {
  const orphanMedia = await prisma.media.findMany({
    where: { uploaderId: userId, livingPostId: null, testimonyId: null, coverOf: { is: null } },
    select: { id: true, storageKey: true },
  });

  await prisma.$transaction([
    prisma.media.deleteMany({ where: { id: { in: orphanMedia.map((m) => m.id) } } }),
    prisma.user.delete({ where: { id: userId } }),
    prisma.auditLog.create({ data: { action: "USER_SELF_DELETE" } }),
  ]);

  // Object storage is outside the transaction; a failure here leaves an unreferenced blob, not PII in the DB.
  await deleteObjects(storage, orphanMedia.map((m) => m.storageKey));
}

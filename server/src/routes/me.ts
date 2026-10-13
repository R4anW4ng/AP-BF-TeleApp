import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { prisma } from "../db.js";
import type { User } from "../generated/prisma/client.js";
import { currentUser, HttpError } from "../lib/http.js";
import { hashPin, PIN_LOCKOUT_MS, PIN_MAX_ATTEMPTS, PIN_PATTERN, verifyPin } from "../lib/pin.js";
import { realName } from "../lib/privacy.js";
import type { Storage } from "../lib/storage.js";
import { userLimiter } from "../middleware/rateLimit.js";
import { effectiveStreak, pointUsage } from "../services/points.js";
import { deleteUserData } from "../services/users.js";

async function meDto(user: User) {
  const [cellGroup, usage] = await Promise.all([
    user.cellGroupId
      ? prisma.cellGroup.findUnique({ where: { id: user.cellGroupId }, select: { id: true, code: true, name: true } })
      : null,
    pointUsage(user.id),
  ]);
  return {
    id: user.id,
    name: realName(user),
    firstName: user.firstName,
    lastName: user.lastName,
    username: user.username,
    displayName: user.displayName,
    photoUrl: user.photoUrl,
    role: user.role,
    isAdmin: user.role === "ADMIN",
    zone: config.ZONE_NAME,
    cellGroup,
    privacy: { stayAnonymous: user.stayAnonymous, showOnBoards: user.showOnBoards },
    notificationsEnabled: user.notificationsEnabled,
    pinEnabled: user.pinHash !== null,
    points: {
      total: user.totalPoints,
      currentStreak: effectiveStreak(user),
      longestStreak: user.longestStreak,
    },
    usage,
  };
}

const UpdateMeSchema = z
  .object({
    displayName: z.string().trim().min(1).max(40).nullable(),
    cellGroupId: z.string().min(1),
    stayAnonymous: z.boolean(),
    showOnBoards: z.boolean(),
    notificationsEnabled: z.boolean(),
  })
  .partial()
  .strict();

const Pin = z.string().regex(PIN_PATTERN, "PIN must be 4–6 digits");

/** Verify a PIN with attempt counting and a temporary lockout. Throws on failure. */
async function checkPin(user: User, pin: string, now: Date = new Date()): Promise<void> {
  if (!user.pinHash) throw new HttpError(409, "PIN_NOT_SET", "No PIN is set");
  if (user.pinLockedUntil && user.pinLockedUntil > now) {
    throw new HttpError(423, "PIN_LOCKED", "Too many wrong attempts. Try again later.", {
      lockedUntil: user.pinLockedUntil.toISOString(),
    });
  }

  if (await verifyPin(pin, user.pinHash)) {
    if (user.pinFailedAttempts > 0 || user.pinLockedUntil) {
      await prisma.user.update({ where: { id: user.id }, data: { pinFailedAttempts: 0, pinLockedUntil: null } });
    }
    return;
  }

  const { pinFailedAttempts } = await prisma.user.update({
    where: { id: user.id },
    data: { pinFailedAttempts: { increment: 1 } },
    select: { pinFailedAttempts: true },
  });
  if (pinFailedAttempts >= PIN_MAX_ATTEMPTS) {
    const lockedUntil = new Date(now.getTime() + PIN_LOCKOUT_MS);
    await prisma.user.update({ where: { id: user.id }, data: { pinFailedAttempts: 0, pinLockedUntil: lockedUntil } });
    throw new HttpError(423, "PIN_LOCKED", "Too many wrong attempts. Try again later.", {
      lockedUntil: lockedUntil.toISOString(),
    });
  }
  // 403, not 401: the Telegram session is fine, only the PIN is wrong.
  throw new HttpError(403, "PIN_INCORRECT", "Incorrect PIN", {
    attemptsRemaining: PIN_MAX_ATTEMPTS - pinFailedAttempts,
  });
}

export function meRouter({ storage }: { storage: Storage }): Router {
  const router = Router();
  const pinLimiter = userLimiter(15 * 60_000, 20);

  router.get("/", async (req, res) => {
    res.json(await meDto(currentUser(req)));
  });

  router.patch("/", async (req, res) => {
    const user = currentUser(req);
    const input = UpdateMeSchema.parse(req.body);

    if (input.cellGroupId !== undefined && input.cellGroupId !== user.cellGroupId) {
      // CG totals follow current membership, so switching groups would move points between
      // teams. Members pick their CG once; after that an admin has to change it.
      if (user.cellGroupId !== null && user.role !== "ADMIN") {
        throw new HttpError(409, "CELL_GROUP_LOCKED", "Ask an admin to change your Cell Group");
      }
      const cg = await prisma.cellGroup.findFirst({ where: { id: input.cellGroupId, isActive: true } });
      if (!cg) throw new HttpError(400, "VALIDATION_ERROR", "Unknown Cell Group");
    }

    const updated = await prisma.user.update({ where: { id: user.id }, data: input });
    res.json(await meDto(updated));
  });

  // --- App PIN lock ---------------------------------------------------------

  router.put("/pin", pinLimiter, async (req, res) => {
    const user = currentUser(req);
    const { pin, currentPin } = z.object({ pin: Pin, currentPin: Pin.optional() }).strict().parse(req.body);
    if (user.pinHash) {
      if (!currentPin) throw new HttpError(400, "CURRENT_PIN_REQUIRED", "Enter your current PIN to change it");
      await checkPin(user, currentPin);
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { pinHash: await hashPin(pin), pinFailedAttempts: 0, pinLockedUntil: null },
    });
    res.json({ pinEnabled: true });
  });

  router.post("/pin/verify", pinLimiter, async (req, res) => {
    const { pin } = z.object({ pin: Pin }).strict().parse(req.body);
    await checkPin(currentUser(req), pin);
    res.json({ ok: true });
  });

  router.delete("/pin", pinLimiter, async (req, res) => {
    const user = currentUser(req);
    const { pin } = z.object({ pin: Pin }).strict().parse(req.body);
    await checkPin(user, pin);
    await prisma.user.update({
      where: { id: user.id },
      data: { pinHash: null, pinFailedAttempts: 0, pinLockedUntil: null },
    });
    res.json({ pinEnabled: false });
  });

  // --- Delete my data -------------------------------------------------------

  router.delete("/", async (req, res) => {
    const user = currentUser(req);
    z.object({ confirm: z.literal("DELETE") }).parse(req.body);
    await deleteUserData(user.id, storage);
    res.status(204).end();
  });

  return router;
}

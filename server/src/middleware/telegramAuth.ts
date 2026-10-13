import type { RequestHandler } from "express";
import { config } from "../config.js";
import { HttpError } from "../lib/http.js";
import { InitDataError, validateInitData } from "../lib/telegramInitData.js";
import { syncTelegramUser } from "../services/users.js";

/**
 * Authenticates every Mini App request.
 *
 * The client sends `Authorization: tma <Telegram.WebApp.initData>`. We verify the
 * HMAC-SHA256 signature with the bot token, reject stale payloads, then load (or
 * create) the matching user. Nothing from `initDataUnsafe` or the request body
 * is ever used to decide who the caller is.
 */
export function telegramAuth(): RequestHandler {
  return async (req, _res, next) => {
    const header = req.get("authorization") ?? "";
    const match = /^tma (.+)$/.exec(header);
    if (!match) {
      throw new HttpError(401, "UNAUTHENTICATED", "Missing Telegram authorization");
    }

    let data;
    try {
      data = validateInitData(match[1], config.TELEGRAM_BOT_TOKEN, {
        maxAgeSeconds: config.INIT_DATA_MAX_AGE_SECONDS,
      });
    } catch (e) {
      if (e instanceof InitDataError) {
        // Don't reveal which check failed beyond "expired" (which the client can act on).
        const code = e.code === "EXPIRED" ? "INIT_DATA_EXPIRED" : "INVALID_INIT_DATA";
        throw new HttpError(401, code, e.code === "EXPIRED" ? e.message : "Invalid Telegram authorization");
      }
      throw e;
    }

    if (data.user.is_bot) throw new HttpError(403, "FORBIDDEN", "Bots cannot use this app");

    req.telegram = data;
    req.user = await syncTelegramUser(data.user);
    next();
  };
}

/** Use after `telegramAuth`. Role is read from the DB row loaded for this request. */
export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (req.user?.role !== "ADMIN") throw new HttpError(403, "FORBIDDEN", "Admins only");
  next();
};

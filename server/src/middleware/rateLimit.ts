import { ipKeyGenerator, rateLimit, type Options } from "express-rate-limit";
import { HttpError } from "../lib/http.js";

// In-memory counters: fine for a single instance. Use a Redis store if you scale out.
const base: Partial<Options> = {
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_req, _res, next) => next(new HttpError(429, "RATE_LIMITED", "Too many requests — please slow down")),
};

/** Coarse per-IP limit in front of authentication. */
export const ipLimiter = rateLimit({ ...base, windowMs: 60_000, limit: 300 });

/** Per-user limit for routes behind `telegramAuth`. */
export function userLimiter(windowMs: number, limit: number) {
  return rateLimit({
    ...base,
    windowMs,
    limit,
    keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? ""),
  });
}

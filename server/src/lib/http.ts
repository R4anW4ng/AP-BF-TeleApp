import type { Request } from "express";
import type { User } from "../generated/prisma/client.js";

/** An error that is safe to show to the client as-is. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/** The authenticated user. Only valid on routes behind `telegramAuth`. */
export function currentUser(req: Request): User {
  if (!req.user) throw new HttpError(401, "UNAUTHENTICATED", "Not authenticated");
  return req.user;
}


/** The `:id` route parameter as a plain string. */
export function idParam(req: Request): string {
  const id = req.params.id;
  if (typeof id !== "string" || id.length === 0 || id.length > 64) {
    throw new HttpError(404, "NOT_FOUND", "Not found");
  }
  return id;
}

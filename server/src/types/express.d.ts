import type { User } from "../generated/prisma/client.js";
import type { ValidatedInitData } from "../lib/telegramInitData.js";

declare global {
  namespace Express {
    interface Request {
      /** Set by `telegramAuth` after initData passes HMAC validation. */
      user?: User;
      telegram?: ValidatedInitData;
    }
  }
}

export {};

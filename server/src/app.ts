import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import { config } from "./config.js";
import { prisma } from "./db.js";
import type { Storage } from "./lib/storage.js";
import { errorHandler, notFound } from "./middleware/errors.js";
import { ipLimiter } from "./middleware/rateLimit.js";
import { telegramAuth } from "./middleware/telegramAuth.js";
import { adminRouter } from "./routes/admin.js";
import { cellGroupsRouter } from "./routes/cellGroups.js";
import { homeRouter } from "./routes/home.js";
import { leaderboardRouter } from "./routes/leaderboard.js";
import { livingRouter } from "./routes/living.js";
import { meRouter } from "./routes/me.js";
import { pointsRouter } from "./routes/points.js";
import { prayersRouter } from "./routes/prayers.js";
import { testimoniesRouter } from "./routes/testimonies.js";
import { uploadsRouter } from "./routes/uploads.js";

export interface AppDeps {
  storage: Storage;
}

export function createApp(deps: AppDeps): Express {
  const app = express();

  app.set("trust proxy", config.TRUST_PROXY);
  // Telegram IDs are BigInt; never let one crash JSON serialisation.
  app.set("json replacer", (_key: string, value: unknown) => (typeof value === "bigint" ? value.toString() : value));

  app.use(helmet());
  // Auth is a header, not a cookie, so there is no CSRF surface; CORS just limits which origin may call us.
  app.use(
    cors({
      origin: config.corsOrigins,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
      allowedHeaders: ["Authorization", "Content-Type"],
      maxAge: 600,
    }),
  );

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });
  app.get("/health/ready", async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true });
  });

  // Everything under /api requires valid Telegram initData.
  const api = express.Router();
  api.use(ipLimiter);
  api.use(express.json({ limit: "100kb" }));
  api.use(telegramAuth());
  api.use((_req, res, next) => {
    // Per-user data; never cache, so Home reflects a new challenge immediately.
    res.set("Cache-Control", "no-store");
    next();
  });

  api.use("/me", meRouter(deps));
  api.use("/home", homeRouter());
  api.use("/points", pointsRouter());
  api.use("/cell-groups", cellGroupsRouter());
  api.use("/uploads", uploadsRouter(deps));
  api.use("/prayers", prayersRouter());
  api.use("/living", livingRouter(deps));
  api.use("/testimonies", testimoniesRouter(deps));
  api.use("/leaderboard", leaderboardRouter());
  api.use("/admin", adminRouter());
  api.use(notFound);

  app.use("/api", api);
  app.use(notFound);
  app.use(errorHandler);

  return app;
}

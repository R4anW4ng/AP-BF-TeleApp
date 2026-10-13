import { Router } from "express";
import { z } from "zod";
import { currentUser } from "../lib/http.js";
import { cellGroupLeaderboard, individualLeaderboard } from "../services/leaderboard.js";

export function leaderboardRouter(): Router {
  const router = Router();

  /** GET /api/leaderboard/individuals?limit=50 */
  router.get("/individuals", async (req, res) => {
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(req.query);
    res.json(await individualLeaderboard(currentUser(req), limit));
  });

  /** GET /api/leaderboard/cell-groups */
  router.get("/cell-groups", async (req, res) => {
    res.json(await cellGroupLeaderboard(currentUser(req)));
  });

  return router;
}

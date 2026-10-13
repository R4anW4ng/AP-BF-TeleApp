import { Router } from "express";
import { currentUser } from "../lib/http.js";
import { userLimiter } from "../middleware/rateLimit.js";
import { awardPoints } from "../services/points.js";

/**
 * Self-logged actions. Caps are enforced in awardPoints; a capped request is a
 * normal 200 with `awarded: false`, so the button can just show "3/3 today".
 * Living it Out points are awarded by the post-creation route, not here.
 */
export function pointsRouter(): Router {
  const router = Router();
  router.use(userLimiter(60_000, 30));

  router.post("/meal-log", async (req, res) => {
    res.json(await awardPoints(currentUser(req).id, "MEAL_LOG"));
  });

  // A declaration that this month's tithe is done. The amount is never asked for or stored.
  router.post("/tithe", async (req, res) => {
    res.json(await awardPoints(currentUser(req).id, "TITHE"));
  });

  return router;
}

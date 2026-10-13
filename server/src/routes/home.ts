import { Router } from "express";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { campaignInfo, sgMonthStart } from "../lib/time.js";

/**
 * Home screen data. The current challenge is simply the latest one whose
 * publishAt (Monday 05:00 SGT) has passed, so the app shows the new week's
 * challenge the moment the broadcast goes out, with no separate sync job.
 */
export function homeRouter(): Router {
  const router = Router();

  router.get("/", async (_req, res) => {
    const now = new Date();
    const [challenge, monthlyGoal] = await Promise.all([
      prisma.weeklyChallenge.findFirst({
        where: { status: { in: ["SCHEDULED", "PUBLISHED"] }, publishAt: { lte: now } },
        orderBy: { publishAt: "desc" },
        select: {
          id: true,
          weekStart: true,
          weekNumber: true,
          title: true,
          financialInitiatives: true,
          description: true,
          memoryVerseText: true,
          memoryVerseRef: true,
          publishAt: true,
        },
      }),
      prisma.monthlyGoal.findUnique({
        where: { month: sgMonthStart(now) },
        select: { id: true, month: true, title: true, description: true },
      }),
    ]);

    res.json({
      zone: config.ZONE_NAME,
      campaign: campaignInfo(config.CAMPAIGN_START, config.CAMPAIGN_END, now),
      challenge,
      monthlyGoal,
    });
  });

  return router;
}

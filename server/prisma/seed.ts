import { config } from "../src/config.js";
import { prisma } from "../src/db.js";
import { campaignInfo, sgMonthStart, sgWeekStart, weeklyPublishAt } from "../src/lib/time.js";

// Cell Groups in zone AP. Override with SEED_CELL_GROUPS="AP1,AP2,AP3".
const cellGroupCodes = (process.env.SEED_CELL_GROUPS ?? "AP1,AP2,AP3,AP4")
  .split(",")
  .map((c) => c.trim())
  .filter(Boolean);

async function seedCellGroups() {
  for (const [i, code] of cellGroupCodes.entries()) {
    await prisma.cellGroup.upsert({
      where: { code },
      update: {},
      create: { code, name: `Cell Group ${code}`, sortOrder: i },
    });
  }
  console.log(`Cell Groups: ${cellGroupCodes.join(", ")}`);
}

/**
 * Sample Home content for local development only (SEED_SAMPLE_CONTENT=true).
 * Marked as already broadcast so the Monday cron never pushes it to real users.
 */
async function seedSampleContent() {
  const now = new Date();
  const weekStart = sgWeekStart(now);
  const weekNumber = campaignInfo(config.CAMPAIGN_START, config.CAMPAIGN_END, now).weekNumber ?? 1;

  await prisma.weeklyChallenge.upsert({
    where: { weekStart },
    update: {},
    create: {
      weekStart,
      weekNumber,
      title: "Sample week: everyday sacrifices",
      financialInitiatives: ["No Grab", "Water Only"],
      memoryVerseText: "Bring the whole tithe into the storehouse, that there may be food in my house.",
      memoryVerseRef: "Malachi 3:10",
      publishAt: weeklyPublishAt(weekStart),
      status: "PUBLISHED",
      broadcastStartedAt: now,
      broadcastCompletedAt: now,
    },
  });

  await prisma.monthlyGoal.upsert({
    where: { month: sgMonthStart(now) },
    update: {},
    create: {
      month: sgMonthStart(now),
      title: "Sacrifice ME time",
      description: "Give one hour a week back to God and others.",
    },
  });
  console.log("Sample weekly challenge and monthly goal created.");
}

async function main() {
  await seedCellGroups();
  if (process.env.SEED_SAMPLE_CONTENT === "true") await seedSampleContent();
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

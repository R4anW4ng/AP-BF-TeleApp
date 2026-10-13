import "dotenv/config";
import { prisma } from "../src/db.js";

// Zones (Cell Groups). Override with SEED_ZONES="ZN1,ZN2,ZN3".
const zoneCodes = (process.env.SEED_ZONES ?? "ZN1,ZN2,ZN3,ZN4")
  .split(",")
  .map((z) => z.trim())
  .filter(Boolean);

const SGT_OFFSET_MS = 8 * 60 * 60 * 1000;

/** Monday 00:00 SGT of the week containing `now`, as a UTC-midnight Date for @db.Date. */
function sgtMondayOf(now: Date): Date {
  const sgt = new Date(now.getTime() + SGT_OFFSET_MS);
  const daysSinceMonday = (sgt.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(sgt.getUTCFullYear(), sgt.getUTCMonth(), sgt.getUTCDate() - daysSinceMonday));
}

/** Monday 05:00 SGT == Sunday 21:00 UTC. */
function publishAtFor(weekStart: Date): Date {
  return new Date(weekStart.getTime() + 5 * 60 * 60 * 1000 - SGT_OFFSET_MS);
}

async function main() {
  for (const [i, code] of zoneCodes.entries()) {
    await prisma.zone.upsert({
      where: { code },
      update: {},
      create: { code, name: `Zone ${code.replace(/\D/g, "") || code}`, sortOrder: i },
    });
  }

  const campaignStart = new Date(`${process.env.CAMPAIGN_START ?? "2026-01-05"}T00:00:00Z`);
  const weekStart = sgtMondayOf(new Date());
  const weekNumber = Math.floor((weekStart.getTime() - sgtMondayOf(campaignStart).getTime()) / (7 * 86400000)) + 1;

  await prisma.weeklyChallenge.upsert({
    where: { weekStart },
    update: {},
    create: {
      weekStart,
      weekNumber,
      title: "Sample week: everyday sacrifices",
      financialInitiatives: ["No Grab", "Water Only"],
      memoryVerseText:
        "Bring the whole tithe into the storehouse, that there may be food in my house.",
      memoryVerseRef: "Malachi 3:10",
      publishAt: publishAtFor(weekStart),
      status: "PUBLISHED",
      // Mark as already broadcast so seeding never triggers a real push.
      broadcastStartedAt: new Date(),
      broadcastCompletedAt: new Date(),
    },
  });

  const sgtNow = new Date(Date.now() + SGT_OFFSET_MS);
  const month = new Date(Date.UTC(sgtNow.getUTCFullYear(), sgtNow.getUTCMonth(), 1));
  await prisma.monthlyGoal.upsert({
    where: { month },
    update: {},
    create: { month, title: "Sacrifice ME time", description: "Give one hour a week back to God and others." },
  });

  console.log(`Seeded ${zoneCodes.length} zones, week ${weekNumber} challenge, and monthly goal.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

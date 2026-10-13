import "dotenv/config";
import { defineConfig, env } from "prisma/config";

/**
 * The Prisma CLI (migrate, db seed) connects with DIRECT_URL when it's set.
 *
 * On Supabase, DATABASE_URL is the Transaction pooler (port 6543), which the
 * running app uses but which can't run migrations. Set DIRECT_URL to the
 * Session pooler (port 5432; IPv4, so it works from Render's free tier).
 * The app itself always uses DATABASE_URL (see src/db.ts).
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.DIRECT_URL || env("DATABASE_URL"),
  },
});

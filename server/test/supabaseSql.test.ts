import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildSupabaseSql, OUTPUT } from "../scripts/build-supabase-sql.js";

describe("prisma/supabase/apply-migrations.sql", () => {
  it("is up to date with prisma/migrations (run `npm run db:sql` after adding a migration)", () => {
    expect(readFileSync(OUTPUT, "utf8")).toBe(buildSupabaseSql());
  });
});

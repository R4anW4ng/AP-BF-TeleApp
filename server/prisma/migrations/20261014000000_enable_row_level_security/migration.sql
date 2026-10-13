-- Supabase exposes every table in the "public" schema through its Data API
-- (PostgREST), where the project's anon key is public by design. Enabling RLS
-- with no policies makes these tables invisible there.
--
-- The app is unaffected: it connects as the tables' owner (postgres), which
-- bypasses RLS. On plain PostgreSQL (local dev, tests) this is a no-op for the
-- same reason.
ALTER TABLE "cell_groups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "point_transactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "weekly_challenges" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "monthly_goals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "prayers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "prayer_comments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "prayer_reactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "living_posts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "testimonies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "media" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "_prisma_migrations" ENABLE ROW LEVEL SECURITY;

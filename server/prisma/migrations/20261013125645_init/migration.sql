-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "PointType" AS ENUM ('TITHE', 'MEAL_LOG', 'LIVING_POST', 'ADMIN_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "ReactionType" AS ENUM ('HEART', 'AMEN', 'PRAYING', 'HUG');

-- CreateEnum
CREATE TYPE "ContentStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "MediaKind" AS ENUM ('LIVING_POST', 'TESTIMONY');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('PROMOTE_ADMIN', 'DEMOTE_ADMIN', 'CHALLENGE_CREATE', 'CHALLENGE_UPDATE', 'CHALLENGE_DELETE', 'MONTHLY_GOAL_UPSERT', 'TESTIMONY_CREATE', 'TESTIMONY_UPDATE', 'TESTIMONY_DELETE', 'CONTENT_HIDE', 'POINTS_ADJUST', 'USER_SELF_DELETE');

-- CreateTable
CREATE TABLE "zones" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "telegramId" BIGINT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT,
    "username" TEXT,
    "displayName" TEXT,
    "photoUrl" TEXT,
    "languageCode" TEXT,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "zoneId" TEXT,
    "stayAnonymous" BOOLEAN NOT NULL DEFAULT false,
    "showOnBoards" BOOLEAN NOT NULL DEFAULT true,
    "pinHash" TEXT,
    "pinFailedAttempts" INTEGER NOT NULL DEFAULT 0,
    "pinLockedUntil" TIMESTAMP(3),
    "totalPoints" INTEGER NOT NULL DEFAULT 0,
    "currentStreak" INTEGER NOT NULL DEFAULT 0,
    "longestStreak" INTEGER NOT NULL DEFAULT 0,
    "lastActiveDate" DATE,
    "botStartedAt" TIMESTAMP(3),
    "botBlocked" BOOLEAN NOT NULL DEFAULT false,
    "notificationsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "point_transactions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "PointType" NOT NULL,
    "points" INTEGER NOT NULL,
    "periodKey" TEXT NOT NULL,
    "slot" INTEGER NOT NULL DEFAULT 1,
    "sgDate" DATE NOT NULL,
    "sourceId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "point_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weekly_challenges" (
    "id" TEXT NOT NULL,
    "weekStart" DATE NOT NULL,
    "weekNumber" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "financialInitiatives" TEXT[],
    "description" TEXT,
    "memoryVerseText" TEXT NOT NULL,
    "memoryVerseRef" TEXT NOT NULL,
    "publishAt" TIMESTAMP(3) NOT NULL,
    "status" "ContentStatus" NOT NULL DEFAULT 'SCHEDULED',
    "broadcastStartedAt" TIMESTAMP(3),
    "broadcastCompletedAt" TIMESTAMP(3),
    "broadcastSentCount" INTEGER NOT NULL DEFAULT 0,
    "broadcastFailedCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "weekly_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monthly_goals" (
    "id" TEXT NOT NULL,
    "month" DATE NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "monthly_goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prayers" (
    "id" TEXT NOT NULL,
    "authorId" TEXT,
    "zoneId" TEXT,
    "content" TEXT NOT NULL,
    "isAnonymous" BOOLEAN NOT NULL DEFAULT false,
    "isAnswered" BOOLEAN NOT NULL DEFAULT false,
    "hiddenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prayers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prayer_comments" (
    "id" TEXT NOT NULL,
    "prayerId" TEXT NOT NULL,
    "authorId" TEXT,
    "content" TEXT NOT NULL,
    "isAnonymous" BOOLEAN NOT NULL DEFAULT false,
    "hiddenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prayer_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prayer_reactions" (
    "id" TEXT NOT NULL,
    "prayerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "ReactionType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prayer_reactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "living_posts" (
    "id" TEXT NOT NULL,
    "authorId" TEXT,
    "zoneId" TEXT,
    "content" TEXT NOT NULL,
    "weekNumber" INTEGER NOT NULL,
    "isAnonymous" BOOLEAN NOT NULL DEFAULT false,
    "hiddenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "living_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "testimonies" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "coverMediaId" TEXT,
    "blocks" JSONB NOT NULL,
    "byline" TEXT,
    "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "testimonies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media" (
    "id" TEXT NOT NULL,
    "kind" "MediaKind" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "uploaderId" TEXT,
    "livingPostId" TEXT,
    "testimonyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" "AuditAction" NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "zones_code_key" ON "zones"("code");

-- CreateIndex
CREATE UNIQUE INDEX "users_telegramId_key" ON "users"("telegramId");

-- CreateIndex
CREATE INDEX "users_zoneId_idx" ON "users"("zoneId");

-- CreateIndex
CREATE INDEX "users_totalPoints_idx" ON "users"("totalPoints" DESC);

-- CreateIndex
CREATE INDEX "users_botStartedAt_botBlocked_notificationsEnabled_idx" ON "users"("botStartedAt", "botBlocked", "notificationsEnabled");

-- CreateIndex
CREATE INDEX "point_transactions_userId_sgDate_idx" ON "point_transactions"("userId", "sgDate");

-- CreateIndex
CREATE INDEX "point_transactions_type_sgDate_idx" ON "point_transactions"("type", "sgDate");

-- CreateIndex
CREATE UNIQUE INDEX "point_transactions_userId_type_periodKey_slot_key" ON "point_transactions"("userId", "type", "periodKey", "slot");

-- CreateIndex
CREATE UNIQUE INDEX "weekly_challenges_weekStart_key" ON "weekly_challenges"("weekStart");

-- CreateIndex
CREATE INDEX "weekly_challenges_status_publishAt_idx" ON "weekly_challenges"("status", "publishAt");

-- CreateIndex
CREATE UNIQUE INDEX "monthly_goals_month_key" ON "monthly_goals"("month");

-- CreateIndex
CREATE INDEX "prayers_createdAt_idx" ON "prayers"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "prayers_zoneId_createdAt_idx" ON "prayers"("zoneId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "prayers_authorId_idx" ON "prayers"("authorId");

-- CreateIndex
CREATE INDEX "prayer_comments_prayerId_createdAt_idx" ON "prayer_comments"("prayerId", "createdAt");

-- CreateIndex
CREATE INDEX "prayer_comments_authorId_idx" ON "prayer_comments"("authorId");

-- CreateIndex
CREATE INDEX "prayer_reactions_prayerId_type_idx" ON "prayer_reactions"("prayerId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "prayer_reactions_prayerId_userId_type_key" ON "prayer_reactions"("prayerId", "userId", "type");

-- CreateIndex
CREATE INDEX "living_posts_createdAt_idx" ON "living_posts"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "living_posts_zoneId_createdAt_idx" ON "living_posts"("zoneId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "living_posts_authorId_idx" ON "living_posts"("authorId");

-- CreateIndex
CREATE UNIQUE INDEX "testimonies_slug_key" ON "testimonies"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "testimonies_coverMediaId_key" ON "testimonies"("coverMediaId");

-- CreateIndex
CREATE INDEX "testimonies_status_publishedAt_idx" ON "testimonies"("status", "publishedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "media_storageKey_key" ON "media"("storageKey");

-- CreateIndex
CREATE INDEX "media_livingPostId_sortOrder_idx" ON "media"("livingPostId", "sortOrder");

-- CreateIndex
CREATE INDEX "media_testimonyId_sortOrder_idx" ON "media"("testimonyId", "sortOrder");

-- CreateIndex
CREATE INDEX "audit_logs_action_createdAt_idx" ON "audit_logs"("action", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_actorId_idx" ON "audit_logs"("actorId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "point_transactions" ADD CONSTRAINT "point_transactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_challenges" ADD CONSTRAINT "weekly_challenges_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monthly_goals" ADD CONSTRAINT "monthly_goals_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prayers" ADD CONSTRAINT "prayers_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prayers" ADD CONSTRAINT "prayers_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prayer_comments" ADD CONSTRAINT "prayer_comments_prayerId_fkey" FOREIGN KEY ("prayerId") REFERENCES "prayers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prayer_comments" ADD CONSTRAINT "prayer_comments_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prayer_reactions" ADD CONSTRAINT "prayer_reactions_prayerId_fkey" FOREIGN KEY ("prayerId") REFERENCES "prayers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prayer_reactions" ADD CONSTRAINT "prayer_reactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "living_posts" ADD CONSTRAINT "living_posts_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "living_posts" ADD CONSTRAINT "living_posts_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "testimonies" ADD CONSTRAINT "testimonies_coverMediaId_fkey" FOREIGN KEY ("coverMediaId") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "testimonies" ADD CONSTRAINT "testimonies_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media" ADD CONSTRAINT "media_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media" ADD CONSTRAINT "media_livingPostId_fkey" FOREIGN KEY ("livingPostId") REFERENCES "living_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media" ADD CONSTRAINT "media_testimonyId_fkey" FOREIGN KEY ("testimonyId") REFERENCES "testimonies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Rename Zone -> CellGroup in place (keeps existing rows and FKs intact).

ALTER TABLE "zones" RENAME TO "cell_groups";
ALTER TABLE "cell_groups" RENAME CONSTRAINT "zones_pkey" TO "cell_groups_pkey";
ALTER INDEX "zones_code_key" RENAME TO "cell_groups_code_key";

ALTER TABLE "users" RENAME COLUMN "zoneId" TO "cellGroupId";
ALTER INDEX "users_zoneId_idx" RENAME TO "users_cellGroupId_idx";
ALTER TABLE "users" RENAME CONSTRAINT "users_zoneId_fkey" TO "users_cellGroupId_fkey";

ALTER TABLE "prayers" RENAME COLUMN "zoneId" TO "cellGroupId";
ALTER INDEX "prayers_zoneId_createdAt_idx" RENAME TO "prayers_cellGroupId_createdAt_idx";
ALTER TABLE "prayers" RENAME CONSTRAINT "prayers_zoneId_fkey" TO "prayers_cellGroupId_fkey";

ALTER TABLE "living_posts" RENAME COLUMN "zoneId" TO "cellGroupId";
ALTER INDEX "living_posts_zoneId_createdAt_idx" RENAME TO "living_posts_cellGroupId_createdAt_idx";
ALTER TABLE "living_posts" RENAME CONSTRAINT "living_posts_zoneId_fkey" TO "living_posts_cellGroupId_fkey";

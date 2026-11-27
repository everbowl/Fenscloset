-- Security item 8: the AI usage table (daily caps) and the import pause column.
-- AlterTable
ALTER TABLE "ImportEntry" ADD COLUMN     "retryAfter" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AiUsage" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiUsage_day_idx" ON "AiUsage"("day");

-- CreateIndex
CREATE UNIQUE INDEX "AiUsage_personId_provider_day_key" ON "AiUsage"("personId", "provider", "day");


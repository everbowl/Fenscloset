-- CreateEnum
CREATE TYPE "LookFeedbackKind" AS ENUM ('worn', 'passed', 'swapped_out', 'swapped_in');

-- CreateTable
CREATE TABLE "LookFeedback" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "kind" "LookFeedbackKind" NOT NULL,
    "itemIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "itemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LookFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LookFeedback_personId_createdAt_idx" ON "LookFeedback"("personId", "createdAt");

-- AddForeignKey
ALTER TABLE "LookFeedback" ADD CONSTRAINT "LookFeedback_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;


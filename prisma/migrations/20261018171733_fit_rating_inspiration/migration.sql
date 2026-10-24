-- CreateEnum
CREATE TYPE "FitRating" AS ENUM ('loved', 'fine', 'never_again');

-- AlterTable
ALTER TABLE "Fit" ADD COLUMN     "rating" "FitRating";

-- CreateTable
CREATE TABLE "InspirationLook" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "bucketKey" TEXT NOT NULL,
    "notes" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InspirationLook_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InspirationLook_bucketKey_key" ON "InspirationLook"("bucketKey");

-- CreateIndex
CREATE INDEX "InspirationLook_personId_createdAt_idx" ON "InspirationLook"("personId", "createdAt");

-- AddForeignKey
ALTER TABLE "InspirationLook" ADD CONSTRAINT "InspirationLook_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;


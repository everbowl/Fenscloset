/*
  Warnings:

  - Added the required column `updatedAt` to the `Item` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "LaundryStatus" AS ENUM ('clean', 'dirty', 'cleaners');

-- CreateEnum
CREATE TYPE "PhotoKind" AS ENUM ('alone', 'worn', 'label', 'cutout', 'thumb');

-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('open', 'done');

-- CreateEnum
CREATE TYPE "EntryStatus" AS ENUM ('queued', 'uploaded', 'processing', 'needs_confirm', 'done', 'failed', 'skipped');

-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "aiConfidence" JSONB,
ADD COLUMN     "brandId" TEXT,
ADD COLUMN     "fitNotes" TEXT,
ADD COLUMN     "isFavorite" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "laundryStatus" "LaundryStatus" NOT NULL DEFAULT 'clean',
ADD COLUMN     "neverSuggest" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "phash" TEXT,
ADD COLUMN     "purchaseDate" TIMESTAMP(3),
ADD COLUMN     "purchasePrice" DECIMAL(10,2),
ADD COLUMN     "purchaseUrl" TEXT,
ADD COLUMN     "size" TEXT,
ADD COLUMN     "storeId" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- CreateTable
CREATE TABLE "ItemPhoto" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "kind" "PhotoKind" NOT NULL,
    "bucketKey" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemShare" (
    "itemId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,

    CONSTRAINT "ItemShare_pkey" PRIMARY KEY ("itemId","personId")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "status" "BatchStatus" NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportEntry" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "originalKey" TEXT NOT NULL,
    "status" "EntryStatus" NOT NULL DEFAULT 'queued',
    "cutoutKey" TEXT,
    "thumbKey" TEXT,
    "labelKey" TEXT,
    "phash" TEXT,
    "aiResult" JSONB,
    "error" TEXT,
    "itemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_ColorToItem" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ColorToItem_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_FabricToItem" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_FabricToItem_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_FormalityLevelToItem" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_FormalityLevelToItem_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_ItemToPattern" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ItemToPattern_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_ItemToSeason" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ItemToSeason_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_ItemToOccasion" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ItemToOccasion_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_ItemToTag" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ItemToTag_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "ItemPhoto_itemId_idx" ON "ItemPhoto"("itemId");

-- CreateIndex
CREATE INDEX "ImportBatch_personId_status_idx" ON "ImportBatch"("personId", "status");

-- CreateIndex
CREATE INDEX "ImportEntry_batchId_status_idx" ON "ImportEntry"("batchId", "status");

-- CreateIndex
CREATE INDEX "_ColorToItem_B_index" ON "_ColorToItem"("B");

-- CreateIndex
CREATE INDEX "_FabricToItem_B_index" ON "_FabricToItem"("B");

-- CreateIndex
CREATE INDEX "_FormalityLevelToItem_B_index" ON "_FormalityLevelToItem"("B");

-- CreateIndex
CREATE INDEX "_ItemToPattern_B_index" ON "_ItemToPattern"("B");

-- CreateIndex
CREATE INDEX "_ItemToSeason_B_index" ON "_ItemToSeason"("B");

-- CreateIndex
CREATE INDEX "_ItemToOccasion_B_index" ON "_ItemToOccasion"("B");

-- CreateIndex
CREATE INDEX "_ItemToTag_B_index" ON "_ItemToTag"("B");

-- CreateIndex
CREATE INDEX "Item_ownerId_phash_idx" ON "Item"("ownerId", "phash");

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemPhoto" ADD CONSTRAINT "ItemPhoto_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemShare" ADD CONSTRAINT "ItemShare_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemShare" ADD CONSTRAINT "ItemShare_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportEntry" ADD CONSTRAINT "ImportEntry_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportEntry" ADD CONSTRAINT "ImportEntry_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ColorToItem" ADD CONSTRAINT "_ColorToItem_A_fkey" FOREIGN KEY ("A") REFERENCES "Color"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ColorToItem" ADD CONSTRAINT "_ColorToItem_B_fkey" FOREIGN KEY ("B") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_FabricToItem" ADD CONSTRAINT "_FabricToItem_A_fkey" FOREIGN KEY ("A") REFERENCES "Fabric"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_FabricToItem" ADD CONSTRAINT "_FabricToItem_B_fkey" FOREIGN KEY ("B") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_FormalityLevelToItem" ADD CONSTRAINT "_FormalityLevelToItem_A_fkey" FOREIGN KEY ("A") REFERENCES "FormalityLevel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_FormalityLevelToItem" ADD CONSTRAINT "_FormalityLevelToItem_B_fkey" FOREIGN KEY ("B") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ItemToPattern" ADD CONSTRAINT "_ItemToPattern_A_fkey" FOREIGN KEY ("A") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ItemToPattern" ADD CONSTRAINT "_ItemToPattern_B_fkey" FOREIGN KEY ("B") REFERENCES "Pattern"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ItemToSeason" ADD CONSTRAINT "_ItemToSeason_A_fkey" FOREIGN KEY ("A") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ItemToSeason" ADD CONSTRAINT "_ItemToSeason_B_fkey" FOREIGN KEY ("B") REFERENCES "Season"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ItemToOccasion" ADD CONSTRAINT "_ItemToOccasion_A_fkey" FOREIGN KEY ("A") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ItemToOccasion" ADD CONSTRAINT "_ItemToOccasion_B_fkey" FOREIGN KEY ("B") REFERENCES "Occasion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ItemToTag" ADD CONSTRAINT "_ItemToTag_A_fkey" FOREIGN KEY ("A") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ItemToTag" ADD CONSTRAINT "_ItemToTag_B_fkey" FOREIGN KEY ("B") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

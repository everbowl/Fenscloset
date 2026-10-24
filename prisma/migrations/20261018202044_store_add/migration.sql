-- AlterTable
ALTER TABLE "ImportEntry" ADD COLUMN     "storeMeta" JSONB;

-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "photoNudgedAt" INTEGER,
ADD COLUMN     "storePhoto" BOOLEAN NOT NULL DEFAULT false;


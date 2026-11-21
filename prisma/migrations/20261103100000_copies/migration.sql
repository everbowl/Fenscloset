-- AlterTable
ALTER TABLE "Item" ADD COLUMN "copies" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "dirtyCopies" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "cleanersCopies" INTEGER NOT NULL DEFAULT 0;

-- The single pieces that are in the wash or at the cleaners today keep saying so, copy-counted.
UPDATE "Item" SET "dirtyCopies" = 1 WHERE "laundryStatus" = 'dirty';
UPDATE "Item" SET "cleanersCopies" = 1 WHERE "laundryStatus" = 'cleaners';

-- AlterTable
ALTER TABLE "ImportEntry" ADD COLUMN "quantity" INTEGER NOT NULL DEFAULT 1;

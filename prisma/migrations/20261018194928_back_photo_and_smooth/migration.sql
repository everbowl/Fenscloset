-- AlterEnum
ALTER TYPE "PhotoKind" ADD VALUE 'back';

-- AlterTable
ALTER TABLE "ImportEntry" ADD COLUMN     "backKey" TEXT,
ADD COLUMN     "smoothKey" TEXT;


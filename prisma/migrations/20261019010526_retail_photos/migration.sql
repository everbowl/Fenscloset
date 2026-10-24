-- AlterEnum
ALTER TYPE "PhotoKind" ADD VALUE 'retail';

-- AlterTable
ALTER TABLE "ImportEntry" ADD COLUMN     "retailKeys" TEXT[] DEFAULT ARRAY[]::TEXT[];


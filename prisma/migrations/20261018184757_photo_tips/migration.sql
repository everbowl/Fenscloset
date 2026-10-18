-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "photoTip" TEXT;

-- AlterTable
ALTER TABLE "Person" ADD COLUMN     "addTipsHidden" BOOLEAN NOT NULL DEFAULT false;


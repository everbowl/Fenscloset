-- CreateEnum
CREATE TYPE "BodyView" AS ENUM ('front', 'side', 'back');

-- AlterTable
ALTER TABLE "BodyPhoto" ADD COLUMN     "view" "BodyView" NOT NULL DEFAULT 'front';


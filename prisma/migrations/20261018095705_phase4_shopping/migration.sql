-- CreateEnum
CREATE TYPE "ShopSource" AS ENUM ('link', 'screenshot', 'photo');

-- CreateTable
CREATE TABLE "ShoppingLookup" (
    "id" TEXT NOT NULL,
    "shopperId" TEXT NOT NULL,
    "forPersonId" TEXT NOT NULL,
    "source" "ShopSource" NOT NULL,
    "inputUrl" TEXT,
    "imageKey" TEXT,
    "title" TEXT,
    "priceText" TEXT,
    "brandText" TEXT,
    "verdict" JSONB NOT NULL,
    "similarItemIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "pairings" JSONB NOT NULL,
    "recommendations" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShoppingLookup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShoppingLookup_shopperId_createdAt_idx" ON "ShoppingLookup"("shopperId", "createdAt");

-- CreateIndex
CREATE INDEX "ShoppingLookup_forPersonId_createdAt_idx" ON "ShoppingLookup"("forPersonId", "createdAt");

-- AddForeignKey
ALTER TABLE "ShoppingLookup" ADD CONSTRAINT "ShoppingLookup_shopperId_fkey" FOREIGN KEY ("shopperId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShoppingLookup" ADD CONSTRAINT "ShoppingLookup_forPersonId_fkey" FOREIGN KEY ("forPersonId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;


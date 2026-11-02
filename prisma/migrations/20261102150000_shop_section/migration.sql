-- CreateTable
CREATE TABLE "ShopSection" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShopSection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShopSection_name_key" ON "ShopSection"("name");

-- AlterTable
ALTER TABLE "Person" ADD COLUMN "shopSectionId" TEXT;

-- AddForeignKey
ALTER TABLE "Person" ADD CONSTRAINT "Person_shopSectionId_fkey" FOREIGN KEY ("shopSectionId") REFERENCES "ShopSection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "Person" ADD COLUMN     "tryOnEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "TryOn" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "bucketKey" TEXT NOT NULL,
    "itemIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "bodyPhotoKey" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TryOn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TryOn_bucketKey_key" ON "TryOn"("bucketKey");

-- CreateIndex
CREATE INDEX "TryOn_personId_createdAt_idx" ON "TryOn"("personId", "createdAt");

-- AddForeignKey
ALTER TABLE "TryOn" ADD CONSTRAINT "TryOn_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;


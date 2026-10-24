-- CreateTable
CREATE TABLE "BrandFeed" (
    "personId" TEXT NOT NULL,
    "brands" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "products" JSONB NOT NULL DEFAULT '[]',
    "lastFetchedAt" TIMESTAMP(3),
    "seenAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandFeed_pkey" PRIMARY KEY ("personId")
);

-- AddForeignKey
ALTER TABLE "BrandFeed" ADD CONSTRAINT "BrandFeed_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- CreateTable
CREATE TABLE "Want" (
    "id" TEXT NOT NULL,
    "forPersonId" TEXT NOT NULL,
    "askedById" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "queries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "category" TEXT,
    "maxPrice" INTEGER,
    "matches" JSONB NOT NULL DEFAULT '[]',
    "newCount" INTEGER NOT NULL DEFAULT 0,
    "lastSearchedAt" TIMESTAMP(3),
    "seenAt" TIMESTAMP(3),
    "foundAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Want_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Want_forPersonId_foundAt_createdAt_idx" ON "Want"("forPersonId", "foundAt", "createdAt");

-- AddForeignKey
ALTER TABLE "Want" ADD CONSTRAINT "Want_forPersonId_fkey" FOREIGN KEY ("forPersonId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Want" ADD CONSTRAINT "Want_askedById_fkey" FOREIGN KEY ("askedById") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;


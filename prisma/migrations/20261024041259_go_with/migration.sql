-- CreateTable
CREATE TABLE "GoWith" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "forPersonId" TEXT NOT NULL,
    "askedById" TEXT NOT NULL,
    "needCategory" TEXT,
    "reason" TEXT NOT NULL,
    "queries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "products" JSONB NOT NULL DEFAULT '[]',
    "closetLooks" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoWith_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GoWith_itemId_createdAt_idx" ON "GoWith"("itemId", "createdAt");

-- CreateIndex
CREATE INDEX "GoWith_forPersonId_createdAt_idx" ON "GoWith"("forPersonId", "createdAt");

-- AddForeignKey
ALTER TABLE "GoWith" ADD CONSTRAINT "GoWith_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoWith" ADD CONSTRAINT "GoWith_forPersonId_fkey" FOREIGN KEY ("forPersonId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoWith" ADD CONSTRAINT "GoWith_askedById_fkey" FOREIGN KEY ("askedById") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- CreateTable: a look someone is putting together (store finds and closet pieces together); named = saved under Fits
CREATE TABLE "Look" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "byId" TEXT NOT NULL,
    "name" TEXT,
    "savedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Look_pkey" PRIMARY KEY ("id")
);

-- CreateTable: one piece of a look, a closet piece or a store find
CREATE TABLE "LookPiece" (
    "id" TEXT NOT NULL,
    "lookId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "itemId" TEXT,
    "title" TEXT,
    "url" TEXT,
    "storeName" TEXT,
    "priceText" TEXT,
    "imageUrl" TEXT,
    "imageKey" TEXT,
    "category" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LookPiece_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Look_personId_savedAt_idx" ON "Look"("personId", "savedAt");

-- CreateIndex
CREATE INDEX "LookPiece_lookId_idx" ON "LookPiece"("lookId");

-- AddForeignKey
ALTER TABLE "Look" ADD CONSTRAINT "Look_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Look" ADD CONSTRAINT "Look_byId_fkey" FOREIGN KEY ("byId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LookPiece" ADD CONSTRAINT "LookPiece_lookId_fkey" FOREIGN KEY ("lookId") REFERENCES "Look"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LookPiece" ADD CONSTRAINT "LookPiece_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

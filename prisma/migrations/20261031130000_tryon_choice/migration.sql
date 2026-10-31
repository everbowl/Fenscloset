-- CreateTable
CREATE TABLE "TryOnChoice" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "lookKey" TEXT NOT NULL,
    "engine" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TryOnChoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TryOnChoice_personId_lookKey_key" ON "TryOnChoice"("personId", "lookKey");

-- AddForeignKey
ALTER TABLE "TryOnChoice" ADD CONSTRAINT "TryOnChoice_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

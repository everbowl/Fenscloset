-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "features" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Person" ADD COLUMN     "mirrorPrefs" JSONB;

-- AlterTable
ALTER TABLE "TryOn" ADD COLUMN     "styling" TEXT;

-- CreateTable
CREATE TABLE "MirrorPose" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prompt" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MirrorPose_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WearGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "needs" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WearGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WearOption" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prompt" TEXT NOT NULL DEFAULT '',
    "groupId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WearOption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MirrorPose_name_key" ON "MirrorPose"("name");

-- CreateIndex
CREATE UNIQUE INDEX "WearGroup_name_key" ON "WearGroup"("name");

-- CreateIndex
CREATE UNIQUE INDEX "WearOption_groupId_name_key" ON "WearOption"("groupId", "name");

-- AddForeignKey
ALTER TABLE "WearOption" ADD CONSTRAINT "WearOption_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "WearGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;


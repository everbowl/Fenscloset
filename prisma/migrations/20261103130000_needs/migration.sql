-- AlterTable: what an engine last said about a body photo it could not read (cleared when a dressing on it works)
ALTER TABLE "BodyPhoto" ADD COLUMN "problem" TEXT;

-- CreateTable: "Not now" on a What's-needed row of the Closet page
CREATE TABLE "NeedSnooze" (
    "personId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "until" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NeedSnooze_pkey" PRIMARY KEY ("personId","key")
);

-- AddForeignKey
ALTER TABLE "NeedSnooze" ADD CONSTRAINT "NeedSnooze_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

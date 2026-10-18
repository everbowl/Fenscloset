-- CreateEnum
CREATE TYPE "CheckInSource" AS ENUM ('taps', 'selfie');

-- CreateEnum
CREATE TYPE "TogetherMode" AS ENUM ('coordinate', 'match', 'contrast');

-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "cleanOutSnoozedUntil" TIMESTAMP(3),
ADD COLUMN     "retiredAt" TIMESTAMP(3),
ADD COLUMN     "retiredReason" TEXT;

-- CreateTable
CREATE TABLE "CheckIn" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "source" "CheckInSource" NOT NULL DEFAULT 'taps',
    "selfieKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckIn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckInAnswer" (
    "checkInId" TEXT NOT NULL,
    "scaleId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,

    CONSTRAINT "CheckInAnswer_pkey" PRIMARY KEY ("checkInId","scaleId")
);

-- CreateTable
CREATE TABLE "TogetherSession" (
    "id" TEXT NOT NULL,
    "mode" "TogetherMode" NOT NULL,
    "occasionId" TEXT,
    "occasionText" TEXT,
    "createdById" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TogetherSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TogetherPerson" (
    "sessionId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,

    CONSTRAINT "TogetherPerson_pkey" PRIMARY KEY ("sessionId","personId")
);

-- CreateTable
CREATE TABLE "OutfitSuggestion" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "inputs" JSONB NOT NULL,
    "outfits" JSONB NOT NULL,
    "togetherSessionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutfitSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WearLog" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "wornOn" TEXT NOT NULL,
    "fitId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WearLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fit" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "occasionId" TEXT,
    "photoKey" TEXT,
    "outfitSuggestionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Fit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FitItem" (
    "fitId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "FitItem_pkey" PRIMARY KEY ("fitId","itemId")
);

-- CreateTable
CREATE TABLE "FitViewer" (
    "fitId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,

    CONSTRAINT "FitViewer_pkey" PRIMARY KEY ("fitId","personId")
);

-- CreateTable
CREATE TABLE "GoogleCalendarConnection" (
    "personId" TEXT NOT NULL,
    "email" TEXT,
    "refreshToken" TEXT NOT NULL,
    "calendarIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleCalendarConnection_pkey" PRIMARY KEY ("personId")
);

-- CreateTable
CREATE TABLE "WeatherCache" (
    "key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeatherCache_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "CheckIn_selfieKey_key" ON "CheckIn"("selfieKey");

-- CreateIndex
CREATE UNIQUE INDEX "CheckIn_personId_date_key" ON "CheckIn"("personId", "date");

-- CreateIndex
CREATE INDEX "OutfitSuggestion_personId_date_idx" ON "OutfitSuggestion"("personId", "date");

-- CreateIndex
CREATE INDEX "WearLog_personId_wornOn_idx" ON "WearLog"("personId", "wornOn");

-- CreateIndex
CREATE INDEX "WearLog_itemId_wornOn_idx" ON "WearLog"("itemId", "wornOn");

-- CreateIndex
CREATE UNIQUE INDEX "Fit_photoKey_key" ON "Fit"("photoKey");

-- CreateIndex
CREATE INDEX "Fit_personId_date_idx" ON "Fit"("personId", "date");

-- AddForeignKey
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckInAnswer" ADD CONSTRAINT "CheckInAnswer_checkInId_fkey" FOREIGN KEY ("checkInId") REFERENCES "CheckIn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckInAnswer" ADD CONSTRAINT "CheckInAnswer_scaleId_fkey" FOREIGN KEY ("scaleId") REFERENCES "CheckInScale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckInAnswer" ADD CONSTRAINT "CheckInAnswer_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "CheckInOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TogetherSession" ADD CONSTRAINT "TogetherSession_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TogetherSession" ADD CONSTRAINT "TogetherSession_occasionId_fkey" FOREIGN KEY ("occasionId") REFERENCES "Occasion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TogetherPerson" ADD CONSTRAINT "TogetherPerson_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TogetherSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TogetherPerson" ADD CONSTRAINT "TogetherPerson_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutfitSuggestion" ADD CONSTRAINT "OutfitSuggestion_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutfitSuggestion" ADD CONSTRAINT "OutfitSuggestion_togetherSessionId_fkey" FOREIGN KEY ("togetherSessionId") REFERENCES "TogetherSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WearLog" ADD CONSTRAINT "WearLog_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WearLog" ADD CONSTRAINT "WearLog_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WearLog" ADD CONSTRAINT "WearLog_fitId_fkey" FOREIGN KEY ("fitId") REFERENCES "Fit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fit" ADD CONSTRAINT "Fit_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fit" ADD CONSTRAINT "Fit_occasionId_fkey" FOREIGN KEY ("occasionId") REFERENCES "Occasion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fit" ADD CONSTRAINT "Fit_outfitSuggestionId_fkey" FOREIGN KEY ("outfitSuggestionId") REFERENCES "OutfitSuggestion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FitItem" ADD CONSTRAINT "FitItem_fitId_fkey" FOREIGN KEY ("fitId") REFERENCES "Fit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FitItem" ADD CONSTRAINT "FitItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FitViewer" ADD CONSTRAINT "FitViewer_fitId_fkey" FOREIGN KEY ("fitId") REFERENCES "Fit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FitViewer" ADD CONSTRAINT "FitViewer_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoogleCalendarConnection" ADD CONSTRAINT "GoogleCalendarConnection_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;


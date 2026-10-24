-- CreateTable
CREATE TABLE "DayPlan" (
    "personId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "occasionId" TEXT,
    "text" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DayPlan_pkey" PRIMARY KEY ("personId","date")
);

-- AddForeignKey
ALTER TABLE "DayPlan" ADD CONSTRAINT "DayPlan_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DayPlan" ADD CONSTRAINT "DayPlan_occasionId_fkey" FOREIGN KEY ("occasionId") REFERENCES "Occasion"("id") ON DELETE SET NULL ON UPDATE CASCADE;


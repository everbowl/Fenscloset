-- CreateTable
CREATE TABLE "SeedSet" (
    "name" TEXT NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeedSet_pkey" PRIMARY KEY ("name")
);


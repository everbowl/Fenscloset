-- CreateTable
CREATE TABLE "ListRequest" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "requestedById" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ListRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ListRequest_status_createdAt_idx" ON "ListRequest"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "ListRequest" ADD CONSTRAINT "ListRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

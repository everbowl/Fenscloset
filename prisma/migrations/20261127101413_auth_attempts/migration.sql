-- CreateTable
CREATE TABLE "AuthAttempt" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "accountKey" TEXT NOT NULL,
    "ipKey" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuthAttempt_kind_accountKey_createdAt_idx" ON "AuthAttempt"("kind", "accountKey", "createdAt");

-- CreateIndex
CREATE INDEX "AuthAttempt_kind_ipKey_createdAt_idx" ON "AuthAttempt"("kind", "ipKey", "createdAt");

-- CreateIndex
CREATE INDEX "AuthAttempt_createdAt_idx" ON "AuthAttempt"("createdAt");


-- CreateTable
CREATE TABLE "ConsumedCeremonyNonce" (
    "id" TEXT NOT NULL,
    "nonceKeyHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsumedCeremonyNonce_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthThrottleBucket" (
    "id" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "resetAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthThrottleBucket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConsumedCeremonyNonce_nonceKeyHash_key" ON "ConsumedCeremonyNonce"("nonceKeyHash");

-- CreateIndex
CREATE INDEX "ConsumedCeremonyNonce_expiresAt_idx" ON "ConsumedCeremonyNonce"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuthThrottleBucket_keyHash_key" ON "AuthThrottleBucket"("keyHash");

-- CreateIndex
CREATE INDEX "AuthThrottleBucket_resetAt_idx" ON "AuthThrottleBucket"("resetAt");

-- CreateEnum
CREATE TYPE "PackingSessionStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PackingCheckMethod" AS ENUM ('SCAN');

-- CreateEnum
CREATE TYPE "PointReason" AS ENUM ('PACKING_COMPLETE', 'REDEMPTION', 'MORNING_CHECK_FAIL', 'MANUAL_ADJUST');

-- CreateEnum
CREATE TYPE "RedemptionStatus" AS ENUM ('PENDING', 'FULFILLED');

-- CreateTable
CREATE TABLE "packing_sessions" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "forDate" DATE NOT NULL,
    "status" "PackingSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "pointsAwarded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "packing_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "packing_checks" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "itemCopyId" TEXT NOT NULL,
    "method" "PackingCheckMethod" NOT NULL DEFAULT 'SCAN',
    "photoPath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "packing_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "point_ledger" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" "PointReason" NOT NULL,
    "refId" TEXT,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "point_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rewards" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cost" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rewards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "redemptions" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "rewardId" TEXT NOT NULL,
    "pointsSpent" INTEGER NOT NULL,
    "status" "RedemptionStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fulfilledAt" TIMESTAMP(3),
    "fulfilledByTeacherId" TEXT,

    CONSTRAINT "redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "packing_sessions_studentId_forDate_idx" ON "packing_sessions"("studentId", "forDate");

-- CreateIndex
CREATE INDEX "packing_checks_itemCopyId_idx" ON "packing_checks"("itemCopyId");

-- CreateIndex
CREATE UNIQUE INDEX "packing_checks_sessionId_itemCopyId_key" ON "packing_checks"("sessionId", "itemCopyId");

-- CreateIndex
CREATE INDEX "point_ledger_studentId_idx" ON "point_ledger"("studentId");

-- CreateIndex
CREATE INDEX "rewards_schoolId_idx" ON "rewards"("schoolId");

-- CreateIndex
CREATE INDEX "redemptions_studentId_idx" ON "redemptions"("studentId");

-- CreateIndex
CREATE INDEX "redemptions_rewardId_idx" ON "redemptions"("rewardId");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "push_subscriptions_studentId_idx" ON "push_subscriptions"("studentId");

-- AddForeignKey
ALTER TABLE "packing_sessions" ADD CONSTRAINT "packing_sessions_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packing_checks" ADD CONSTRAINT "packing_checks_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "packing_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packing_checks" ADD CONSTRAINT "packing_checks_itemCopyId_fkey" FOREIGN KEY ("itemCopyId") REFERENCES "item_copies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "point_ledger" ADD CONSTRAINT "point_ledger_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rewards" ADD CONSTRAINT "rewards_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_rewardId_fkey" FOREIGN KEY ("rewardId") REFERENCES "rewards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('scientist', 'patron', 'admin');

-- CreateEnum
CREATE TYPE "IntentStatus" AS ENUM ('draft', 'submitted', 'ai_screening', 'published', 'funded', 'completed', 'rejected');

-- CreateEnum
CREATE TYPE "MilestoneStatus" AS ENUM ('locked', 'in_progress', 'proof_submitted', 'ai_verifying', 'released', 'rejected');

-- CreateEnum
CREATE TYPE "AiJobType" AS ENUM ('gatekeeper', 'verifier');

-- CreateEnum
CREATE TYPE "AiJobStatus" AS ENUM ('queued', 'running', 'succeeded', 'failed');

-- CreateEnum
CREATE TYPE "ActivityKind" AS ENUM ('intent_published', 'deposited', 'proof_submitted', 'milestone_verified', 'refunded');

-- CreateTable
CREATE TABLE "User" (
    "wallet" VARCHAR(42) NOT NULL,
    "role" "UserRole" NOT NULL,
    "email" VARCHAR(200),
    "displayName" VARCHAR(80),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("wallet")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "wallet" VARCHAR(42) NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revoked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scientist" (
    "wallet" VARCHAR(42) NOT NULL,
    "displayName" VARCHAR(80) NOT NULL,
    "bio" TEXT,
    "avatarUrl" VARCHAR(500),
    "orcid" VARCHAR(20),
    "orcidVerified" BOOLEAN NOT NULL DEFAULT false,
    "githubHandle" VARCHAR(40),
    "affiliation" VARCHAR(200),
    "intentsPublished" INTEGER NOT NULL DEFAULT 0,
    "milestonesVerified" INTEGER NOT NULL DEFAULT 0,
    "reputation" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Scientist_pkey" PRIMARY KEY ("wallet")
);

-- CreateTable
CREATE TABLE "Intent" (
    "intentId" VARCHAR(66) NOT NULL,
    "scientistWallet" VARCHAR(42) NOT NULL,
    "ticker" VARCHAR(16) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "descriptionMd" TEXT NOT NULL,
    "category" VARCHAR(50) NOT NULL,
    "tags" TEXT[],
    "coverImageUrl" VARCHAR(500),
    "fundingGoalUsdc" BIGINT NOT NULL,
    "status" "IntentStatus" NOT NULL DEFAULT 'draft',
    "aiGatekeeperScore" INTEGER,
    "aiGatekeeperRationale" TEXT,
    "totalRaisedUsdc" BIGINT NOT NULL DEFAULT 0,
    "totalReleasedUsdc" BIGINT NOT NULL DEFAULT 0,
    "publishTxHash" VARCHAR(66),
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Intent_pkey" PRIMARY KEY ("intentId")
);

-- CreateTable
CREATE TABLE "Milestone" (
    "id" TEXT NOT NULL,
    "intentId" VARCHAR(66) NOT NULL,
    "idx" INTEGER NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "descriptionMd" TEXT NOT NULL,
    "releaseAmountUsdc" BIGINT NOT NULL,
    "dueDate" TIMESTAMP(3),
    "status" "MilestoneStatus" NOT NULL DEFAULT 'locked',
    "proofCid" VARCHAR(80),
    "proofHash" VARCHAR(66),
    "proofFileName" VARCHAR(255),
    "proofFileMime" VARCHAR(100),
    "proofUploadedAt" TIMESTAMP(3),
    "aiScore" INTEGER,
    "aiRationale" TEXT,
    "releaseSignature" VARCHAR(132),
    "releaseNonce" VARCHAR(66),
    "releaseTxHash" VARCHAR(66),
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Milestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Patronage" (
    "id" TEXT NOT NULL,
    "intentId" VARCHAR(66) NOT NULL,
    "patronWallet" VARCHAR(42) NOT NULL,
    "amountUsdc" BIGINT NOT NULL,
    "txHash" VARCHAR(66) NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "refundedAmount" BIGINT NOT NULL DEFAULT 0,
    "refundTxHash" VARCHAR(66),
    "refundedAt" TIMESTAMP(3),

    CONSTRAINT "Patronage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Release" (
    "id" TEXT NOT NULL,
    "intentId" VARCHAR(66) NOT NULL,
    "milestoneId" TEXT NOT NULL,
    "to" VARCHAR(42) NOT NULL,
    "amountUsdc" BIGINT NOT NULL,
    "nonce" VARCHAR(66) NOT NULL,
    "reason" VARCHAR(66) NOT NULL,
    "txHash" VARCHAR(66) NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Release_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefundRecord" (
    "id" TEXT NOT NULL,
    "intentId" VARCHAR(66) NOT NULL,
    "patronWallet" VARCHAR(42) NOT NULL,
    "amountUsdc" BIGINT NOT NULL,
    "nonce" VARCHAR(66) NOT NULL,
    "reason" VARCHAR(66) NOT NULL,
    "txHash" VARCHAR(66) NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefundRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" BIGSERIAL NOT NULL,
    "kind" "ActivityKind" NOT NULL,
    "intentId" VARCHAR(66),
    "actorWallet" VARCHAR(42),
    "amountUsdc" BIGINT,
    "milestoneIdx" INTEGER,
    "txHash" VARCHAR(66),
    "blockNumber" BIGINT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiJob" (
    "id" TEXT NOT NULL,
    "type" "AiJobType" NOT NULL,
    "status" "AiJobStatus" NOT NULL DEFAULT 'queued',
    "intentId" VARCHAR(66),
    "milestoneId" TEXT,
    "inputCid" VARCHAR(80),
    "score" INTEGER,
    "rationale" TEXT,
    "agentVerdicts" JSONB,
    "signature" VARCHAR(132),
    "nonce" VARCHAR(66),
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "AiJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignedNonce" (
    "nonce" VARCHAR(66) NOT NULL,
    "purpose" VARCHAR(20) NOT NULL,
    "intentId" VARCHAR(66) NOT NULL,
    "amountUsdc" BIGINT NOT NULL,
    "recipient" VARCHAR(42) NOT NULL,
    "signature" VARCHAR(132) NOT NULL,
    "consumed" BOOLEAN NOT NULL DEFAULT false,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignedNonce_pkey" PRIMARY KEY ("nonce")
);

-- CreateTable
CREATE TABLE "IndexerCheckpoint" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "lastBlock" BIGINT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IndexerCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuraSeason" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "budgetPerPatron" INTEGER NOT NULL DEFAULT 100,
    "yieldPerMilestone" INTEGER NOT NULL DEFAULT 20,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuraSeason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuraSpend" (
    "id" TEXT NOT NULL,
    "wallet" VARCHAR(42) NOT NULL,
    "intentId" VARCHAR(66) NOT NULL,
    "seasonId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuraSpend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuraYield" (
    "id" TEXT NOT NULL,
    "wallet" VARCHAR(42) NOT NULL,
    "intentId" VARCHAR(66),
    "seasonId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "source" VARCHAR(30) NOT NULL,
    "milestoneIdx" INTEGER,
    "txHash" VARCHAR(66),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuraYield_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Session_wallet_idx" ON "Session"("wallet");

-- CreateIndex
CREATE INDEX "Intent_scientistWallet_idx" ON "Intent"("scientistWallet");

-- CreateIndex
CREATE INDEX "Intent_status_idx" ON "Intent"("status");

-- CreateIndex
CREATE INDEX "Intent_category_idx" ON "Intent"("category");

-- CreateIndex
CREATE UNIQUE INDEX "Milestone_intentId_idx_key" ON "Milestone"("intentId", "idx");

-- CreateIndex
CREATE INDEX "Patronage_intentId_idx" ON "Patronage"("intentId");

-- CreateIndex
CREATE INDEX "Patronage_patronWallet_idx" ON "Patronage"("patronWallet");

-- CreateIndex
CREATE UNIQUE INDEX "Patronage_txHash_key" ON "Patronage"("txHash");

-- CreateIndex
CREATE UNIQUE INDEX "Release_txHash_key" ON "Release"("txHash");

-- CreateIndex
CREATE UNIQUE INDEX "Release_nonce_key" ON "Release"("nonce");

-- CreateIndex
CREATE UNIQUE INDEX "RefundRecord_txHash_key" ON "RefundRecord"("txHash");

-- CreateIndex
CREATE UNIQUE INDEX "RefundRecord_nonce_key" ON "RefundRecord"("nonce");

-- CreateIndex
CREATE INDEX "ActivityLog_intentId_idx" ON "ActivityLog"("intentId");

-- CreateIndex
CREATE INDEX "ActivityLog_actorWallet_idx" ON "ActivityLog"("actorWallet");

-- CreateIndex
CREATE INDEX "ActivityLog_createdAt_idx" ON "ActivityLog"("createdAt");

-- CreateIndex
CREATE INDEX "AiJob_status_idx" ON "AiJob"("status");

-- CreateIndex
CREATE INDEX "AiJob_intentId_idx" ON "AiJob"("intentId");

-- CreateIndex
CREATE INDEX "SignedNonce_intentId_idx" ON "SignedNonce"("intentId");

-- CreateIndex
CREATE UNIQUE INDEX "AuraSeason_name_key" ON "AuraSeason"("name");

-- CreateIndex
CREATE INDEX "AuraSeason_active_idx" ON "AuraSeason"("active");

-- CreateIndex
CREATE INDEX "AuraSpend_wallet_seasonId_idx" ON "AuraSpend"("wallet", "seasonId");

-- CreateIndex
CREATE INDEX "AuraSpend_intentId_seasonId_idx" ON "AuraSpend"("intentId", "seasonId");

-- CreateIndex
CREATE INDEX "AuraYield_wallet_seasonId_idx" ON "AuraYield"("wallet", "seasonId");

-- CreateIndex
CREATE UNIQUE INDEX "AuraYield_wallet_source_txHash_key" ON "AuraYield"("wallet", "source", "txHash");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_wallet_fkey" FOREIGN KEY ("wallet") REFERENCES "User"("wallet") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scientist" ADD CONSTRAINT "Scientist_wallet_fkey" FOREIGN KEY ("wallet") REFERENCES "User"("wallet") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Intent" ADD CONSTRAINT "Intent_scientistWallet_fkey" FOREIGN KEY ("scientistWallet") REFERENCES "Scientist"("wallet") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "Intent"("intentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Patronage" ADD CONSTRAINT "Patronage_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "Intent"("intentId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Release" ADD CONSTRAINT "Release_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "Intent"("intentId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Release" ADD CONSTRAINT "Release_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "Milestone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundRecord" ADD CONSTRAINT "RefundRecord_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "Intent"("intentId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiJob" ADD CONSTRAINT "AiJob_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "Intent"("intentId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiJob" ADD CONSTRAINT "AiJob_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "Milestone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuraSpend" ADD CONSTRAINT "AuraSpend_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "Intent"("intentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuraSpend" ADD CONSTRAINT "AuraSpend_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "AuraSeason"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuraYield" ADD CONSTRAINT "AuraYield_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "Intent"("intentId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuraYield" ADD CONSTRAINT "AuraYield_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "AuraSeason"("id") ON DELETE CASCADE ON UPDATE CASCADE;


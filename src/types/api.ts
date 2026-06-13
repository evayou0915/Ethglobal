/** Shared API response shapes.
 *  Server-side BigInt fields (USDC amounts) are serialized to numeric strings by `serialize()` in src/server/http.ts. */

export type IntentStatus =
  | "draft" | "submitted" | "ai_screening" | "published" | "funded" | "completed" | "rejected";

export type MilestoneStatus =
  | "locked" | "in_progress" | "proof_submitted" | "ai_verifying" | "released" | "rejected";

export type ActivityKind =
  | "intent_published" | "deposited" | "proof_submitted" | "milestone_verified" | "refunded";

export interface ScientistDto {
  wallet: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  orcid: string | null;
  orcidVerified: boolean;
  githubHandle: string | null;
  affiliation: string | null;
  intentsPublished: number;
  milestonesVerified: number;
  reputation: number;
  createdAt: string;
  updatedAt: string;
}

export interface MilestoneDto {
  id: string;
  intentId: string;
  idx: number;
  title: string;
  descriptionMd: string;
  releaseAmountUsdc: string; // BigInt → string
  dueDate: string | null;
  status: MilestoneStatus;
  proofCid: string | null;   // Walrus blobId of the proof artifact
  proofHash: string | null;  // 0x + SHA-256 of the artifact bytes
  proofFileName: string | null;
  proofUploadedAt: string | null;
  aiScore: number | null;
  aiRationale: string | null;
  releaseSignature: string | null;
  releaseNonce: string | null;
  releaseTxHash: string | null;
  verifiedAt: string | null;
}

export interface IntentDto {
  intentId: string;            // 0x bytes32
  scientistWallet: string;
  ticker: string;
  title: string;
  descriptionMd: string;
  category: string;
  tags: string[];
  coverImageUrl: string | null;
  fundingGoalUsdc: string;
  totalRaisedUsdc: string;
  totalReleasedUsdc: string;
  status: IntentStatus;
  aiGatekeeperScore: number | null;
  aiGatekeeperRationale: string | null;
  publishTxHash: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  milestones: MilestoneDto[];
  scientist?: Pick<ScientistDto, "wallet" | "displayName" | "affiliation" | "avatarUrl" | "bio" | "orcid" | "orcidVerified" | "githubHandle" | "reputation"> | null;
  patronages?: Array<{ patronWallet: string; amountUsdc: string; txHash: string; createdAt: string }>;
  _count?: { patronages: number };
}

export interface ActivityRow {
  id: string;
  kind: ActivityKind;
  intentId: string | null;
  actorWallet: string | null;
  amountUsdc: string | null;
  milestoneIdx: number | null;
  txHash: string | null;
  blockNumber: string | null;
  payload: unknown;
  createdAt: string;
}

export interface ApiOk<T> { data: T; }
export interface ApiErr { error: { code: string; message: string; extra?: unknown }; }

export interface IntentListResponse {
  items: IntentDto[];
  nextCursor: string | null;
}
export interface ActivityListResponse {
  items: ActivityRow[];
  nextCursor: string | null;
}
export interface VerifierPassResponse {
  passed: true;
  score: number;
  rationale: string;
  signer: string;
  release: {
    intentId: `0x${string}`;
    to: `0x${string}`;
    amount: string;
    nonce: `0x${string}`;
    reason: `0x${string}`;
    signature: `0x${string}`;
  };
}
export interface VerifierFailResponse {
  passed: false;
  score: number;
  rationale: string;
}
export type VerifierResponse = VerifierPassResponse | VerifierFailResponse;

export interface PublicConfig {
  chainId: number;
  chainName: string;
  usdcAddress: `0x${string}`;
  escrowAddress: `0x${string}`;
  explorerBase: string;
  rpcUrl: string;
}

export interface LeaderboardRow {
  rank: number;
  wallet: string;
  displayName: string | null;
  avatarUrl: string | null;
  totalCommittedUsdc: string;
  totalRefundedUsdc: string;
  netCommittedUsdc: string;
  projects: number;
}
export interface LeaderboardResponse {
  items: LeaderboardRow[];
  summary: {
    totalCommittedUsdc: string;
    activePatrons: number;
    top10ShareBps: number;
  };
}

export interface RefundQuote {
  intentId: `0x${string}`;
  patron: `0x${string}`;
  amount: string;        // BigInt → string
  nonce: `0x${string}`;
  reason: `0x${string}`;
  signature: `0x${string}`;
}

export interface AdminRefundAllResponse {
  intentId: `0x${string}`;
  count: number;
  refunds: Array<{
    patron: `0x${string}`;
    amount: string;
    nonce: `0x${string}`;
    reason: `0x${string}`;
    signature: `0x${string}`;
  }>;
}

// ─── Aura social-points system ──────────────────────────────────────────

export interface AuraSeasonDto {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
  budgetPerPatron: number;
  yieldPerMilestone: number;
  active: boolean;
  createdAt: string;
}

export interface AuraBalanceDto {
  season: AuraSeasonDto;
  budgetPerPatron: number;
  bonus: number;        // yield earned this season
  used: number;         // spent this season
  total: number;        // budget + bonus
  remaining: number;
}

export interface AuraSeasonAndYou {
  season: AuraSeasonDto;
  you: {
    budgetPerPatron: number;
    bonus: number;
    used: number;
    total: number;
    remaining: number;
  } | null;
}

export interface AuraSpendDto {
  id: string;
  wallet: string;
  intentId: string;
  seasonId: string;
  amount: number;
  createdAt: string;
  intent: { intentId: string; ticker: string; title: string } | null;
}

export interface AuraYieldDto {
  id: string;
  wallet: string;
  intentId: string | null;
  seasonId: string;
  amount: number;
  source: string;
  milestoneIdx: number | null;
  txHash: string | null;
  createdAt: string;
  intent: { intentId: string; ticker: string; title: string } | null;
}

export interface AuraBoostResponse {
  spend: AuraSpendDto;
  remaining: number;
  heat: number;
}

/** Map of intentId → heat (Aura spend) on that intent. */
export type AuraHeatMap = Record<string, number>;

export interface RefundEligibility {
  eligible: boolean;
  intentStatus: IntentStatus;
  rejectedMilestoneIdx: number | null;
  totalDepositedUsdc: string;
  totalRefundedUsdc: string;
  availableUsdc: string;
  escrowRemainingUsdc: string;
  refundableUsdc: string;
}

export type AiJobStatus = "queued" | "running" | "succeeded" | "failed";
export type AiJobType = "gatekeeper" | "verifier";
export interface AgentVerdictDto {
  agent: string;
  persona: string;
  score: number;
  rationale: string;
  approved: boolean;
  model: string;
  errored?: boolean;
}

export interface AiJobDto {
  id: string;
  type: AiJobType;
  status: AiJobStatus;
  intentId: string | null;
  milestoneId: string | null;
  score: number | null;
  rationale: string | null;
  /** Per-agent breakdown for gatekeeper jobs (null for verifier jobs). */
  agentVerdicts: AgentVerdictDto[] | null;
  signature: string | null;
  nonce: string | null;
  error: string | null;
  attempts: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

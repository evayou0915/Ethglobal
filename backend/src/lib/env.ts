/** Centralized env access. Loaded once at boot; any missing required
 *  variable throws so we fail fast instead of in the middle of a request. */
import "dotenv/config";

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) throw new Error(`env: ${name} is required`);
  return v;
}
function optional(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.length > 0 ? v : fallback;
}

export const ENV = {
  PORT:        Number(optional("PORT", "8787")),
  NODE_ENV:    optional("NODE_ENV", "development"),
  CORS_ORIGIN: optional("CORS_ORIGIN", "http://localhost:3000").split(",").map((s) => s.trim()).filter(Boolean),

  DATABASE_URL: required("DATABASE_URL"),

  // Secret for the self-issued SIWE session JWTs. Generate with
  // `openssl rand -hex 32`; rotating it invalidates every active session.
  JWT_SECRET:      required("JWT_SECRET"),
  JWT_TTL_SECONDS: Number(optional("JWT_TTL_SECONDS", "604800")), // 7d

  // Privy (optional dual-token path). Empty = Privy disabled, SIWE-only auth.
  // APP_ID is also exposed to the browser as NEXT_PUBLIC_PRIVY_APP_ID.
  PRIVY_APP_ID:     process.env.PRIVY_APP_ID ?? "",
  PRIVY_APP_SECRET: process.env.PRIVY_APP_SECRET ?? "",

  CHAIN_ID:               Number(optional("CHAIN_ID", "84532")),
  BASE_RPC_URL:           optional("BASE_RPC_URL", "https://mainnet.base.org"),
  BASE_SEPOLIA_RPC_URL:   optional("BASE_SEPOLIA_RPC_URL", "https://sepolia.base.org"),
  ESCROW_ADDRESS:         (process.env.ESCROW_ADDRESS ?? "0x0000000000000000000000000000000000000000").toLowerCase() as `0x${string}`,
  USDC_ADDRESS:           (process.env.USDC_ADDRESS  ?? "0x036CbD53842c5426634e7929541eC2318f3dCF7e").toLowerCase() as `0x${string}`,

  SIGNER_PRIVATE_KEY:     (process.env.SIGNER_PRIVATE_KEY ?? "") as `0x${string}` | "",

  // Walrus blob storage (proof artifacts + app media). The public testnet
  // endpoints work with no key; swap for your own publisher/aggregator in prod.
  WALRUS_PUBLISHER_URL:  optional("WALRUS_PUBLISHER_URL", "https://publisher.walrus-testnet.walrus.space").replace(/\/$/, ""),
  WALRUS_AGGREGATOR_URL: optional("WALRUS_AGGREGATOR_URL", "https://aggregator.walrus-testnet.walrus.space").replace(/\/$/, ""),
  WALRUS_EPOCHS:         Number(optional("WALRUS_EPOCHS", "5")),

  // Anthropic API — powers the gatekeeper quorum + proof verifier when
  // AI_VERIFIER_MODE=llm. Default model is the most capable Opus; set
  // ANTHROPIC_MODEL=claude-sonnet-4-6 or claude-haiku-4-5 to cut cost.
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "",
  ANTHROPIC_MODEL:   optional("ANTHROPIC_MODEL", "claude-haiku-4-5"),

  // Canton private rail — JSON Ledger API of the sandbox started by
  // `daml start` in canton/ (default http://localhost:7575). Empty = the
  // /api/canton routes answer 503 and the rest of the app is unaffected.
  CANTON_JSON_API_URL: (process.env.CANTON_JSON_API_URL ?? "").replace(/\/$/, ""),

  INDEXER_CONFIRMATIONS: Number(optional("INDEXER_CONFIRMATIONS", "1")),
  INDEXER_POLL_MS:       Number(optional("INDEXER_POLL_MS", "4000")),
} as const;

export const EXPLORER_BASE =
  ENV.CHAIN_ID === 8453 ? "https://basescan.org" : "https://sepolia.basescan.org";

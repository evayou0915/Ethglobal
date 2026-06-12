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

  CHAIN_ID:               Number(optional("CHAIN_ID", "84532")),
  BASE_RPC_URL:           optional("BASE_RPC_URL", "https://mainnet.base.org"),
  BASE_SEPOLIA_RPC_URL:   optional("BASE_SEPOLIA_RPC_URL", "https://sepolia.base.org"),
  ESCROW_ADDRESS:         (process.env.ESCROW_ADDRESS ?? "0x0000000000000000000000000000000000000000").toLowerCase() as `0x${string}`,
  USDC_ADDRESS:           (process.env.USDC_ADDRESS  ?? "0x036CbD53842c5426634e7929541eC2318f3dCF7e").toLowerCase() as `0x${string}`,

  SIGNER_PRIVATE_KEY:     (process.env.SIGNER_PRIVATE_KEY ?? "") as `0x${string}` | "",

  PINATA_JWT:     process.env.PINATA_JWT ?? "",
  // OpenAI-compatible relay. Any provider that exposes `/v1/chat/completions`
  // works (LiteLLM, OpenRouter, Anthropic's compat endpoint, your own proxy).
  // Leave OPENAI_BASE_URL unset to hit api.openai.com.
  OPENAI_API_KEY:  process.env.OPENAI_API_KEY ?? "",
  OPENAI_BASE_URL: optional("OPENAI_BASE_URL", "https://api.openai.com/v1").replace(/\/$/, ""),
  OPENAI_MODEL:    optional("OPENAI_MODEL", "gpt-4o-mini"),

  INDEXER_CONFIRMATIONS: Number(optional("INDEXER_CONFIRMATIONS", "1")),
  INDEXER_POLL_MS:       Number(optional("INDEXER_POLL_MS", "4000")),
} as const;

export const EXPLORER_BASE =
  ENV.CHAIN_ID === 8453 ? "https://basescan.org" : "https://sepolia.basescan.org";

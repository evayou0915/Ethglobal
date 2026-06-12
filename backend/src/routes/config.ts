import { Hono } from "hono";
import { ok } from "../lib/http.js";
import { ENV, EXPLORER_BASE } from "../lib/env.js";

export const configRouter = new Hono();

/** GET /api/config — public bootstrap config for the frontend. */
configRouter.get("/", (c) =>
  ok(c, {
    chainId: ENV.CHAIN_ID,
    chainName: ENV.CHAIN_ID === 8453 ? "Base" : "Base Sepolia",
    usdcAddress: ENV.USDC_ADDRESS,
    escrowAddress: ENV.ESCROW_ADDRESS,
    explorerBase: EXPLORER_BASE,
    rpcUrl: ENV.CHAIN_ID === 8453 ? ENV.BASE_RPC_URL : ENV.BASE_SEPOLIA_RPC_URL,
  }),
);

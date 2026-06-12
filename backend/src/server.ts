import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { HTTPException } from "hono/http-exception";
import { ENV } from "./lib/env.js";
import { fail } from "./lib/http.js";

import { configRouter }     from "./routes/config.js";
import { authRouter }       from "./routes/auth.js";
import { intentsRouter }    from "./routes/intents.js";
import { proofsRouter }     from "./routes/proofs.js";
import { aiRouter }         from "./routes/ai.js";
import { scientistsRouter } from "./routes/scientists.js";
import { activityRouter }   from "./routes/activity.js";
import { ipfsRouter }       from "./routes/ipfs.js";
import { leaderboardRouter } from "./routes/leaderboard.js";
import { refundsRouter }     from "./routes/refunds.js";
import { adminRouter }       from "./routes/admin.js";
import { auraRouter }        from "./routes/aura.js";

const app = new Hono();

app.use("*", logger());
app.use(
  "*",
  cors({
    origin: ENV.CORS_ORIGIN,
    credentials: false,                              // JWT in header, not cookies
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400,
  }),
);

app.get("/", (c) => c.json({ service: "aurasci-backend", ok: true }));
app.get("/health", (c) => c.json({ ok: true, ts: Date.now() }));

app.route("/api/config",     configRouter);
app.route("/api/auth",       authRouter);
app.route("/api/intents",    intentsRouter);
app.route("/api",            proofsRouter);              // mounts /api/intents/:id/milestones/:idx/submit-proof
app.route("/api/ai",         aiRouter);
app.route("/api/scientists", scientistsRouter);
app.route("/api/activity",   activityRouter);
app.route("/api/ipfs-upload", ipfsRouter);
app.route("/api/leaderboard", leaderboardRouter);
app.route("/api/refunds",     refundsRouter);
app.route("/api/admin",       adminRouter);
app.route("/api/aura",        auraRouter);

// Centralized error handler
app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return fail(c, err.status, "http_" + err.status, err.message);
  }
  console.error("[api] unhandled:", err);
  return fail(c, 500, "internal_error", "unexpected server error");
});

app.notFound((c) => fail(c, 404, "not_found", `no route for ${c.req.method} ${c.req.path}`));

serve({ fetch: app.fetch, port: ENV.PORT }, (info) => {
  console.log(`▶ aurasci-backend listening on http://localhost:${info.port}`);
  console.log(`  chain     = ${ENV.CHAIN_ID === 8453 ? "base" : "base-sepolia"} (${ENV.CHAIN_ID})`);
  console.log(`  escrow    = ${ENV.ESCROW_ADDRESS}`);
  console.log(`  cors      = ${ENV.CORS_ORIGIN.join(", ")}`);
});

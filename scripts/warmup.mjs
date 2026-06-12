// Warm up Next dev routes after the server is ready, so the first time you
// click a page in the browser it's already compiled. Combined with the
// `onDemandEntries` settings in next.config.js, this means a single warmup
// pass keeps the whole app responsive for the entire dev session.
//
// Run alongside `next dev` via `npm run dev` (see package.json).

const HOST = process.env.WARMUP_HOST ?? "http://localhost:5173";
const ROUTES = [
  "/market",
  "/portfolio",
  "/scientist",
  "/create",
  "/leaderboard",
  "/onboard",
  "/intent/demo",
];

async function waitForServer() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(HOST, { redirect: "manual" });
      if (r.status < 500) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function warm(path) {
  const t0 = Date.now();
  try {
    const r = await fetch(HOST + path, { redirect: "manual" });
    const ms = Date.now() - t0;
    console.log(`  ${r.status} ${path}  (${(ms / 1000).toFixed(1)}s)`);
  } catch (e) {
    console.log(`  ERR ${path}  ${e.message}`);
  }
}

(async () => {
  if (!(await waitForServer())) {
    console.log("[warmup] dev server didn't come up within 60s, giving up");
    return;
  }
  console.log(`[warmup] precompiling ${ROUTES.length} routes…`);
  for (const route of ROUTES) await warm(route);
  console.log("[warmup] done — switching between pages should be instant now");
})();

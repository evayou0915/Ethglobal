// pm2 deployment manifest — describes all three backend processes.
//
// One command:  pm2 start ecosystem.config.cjs
//
// Each entry is a separate pm2-managed process — if `aurasci-ai` crashes,
// pm2 restarts only that one (the api + indexer keep running). Same
// independence guarantees you'd get from running three `pm2 start dist/*.js`
// commands by hand.
//
// `.cjs` extension because the backend's package.json sets "type": "module";
// pm2 reads this config via require() under the hood and needs CommonJS.
//
// Usage:
//   pm2 start ecosystem.config.cjs        # start all three
//   pm2 reload ecosystem.config.cjs       # zero-downtime reload
//   pm2 restart aurasci-api               # restart just one
//   pm2 stop ecosystem.config.cjs         # stop all
//   pm2 delete ecosystem.config.cjs       # remove all from pm2's list
//   pm2 save && pm2 startup               # persist across reboots
module.exports = {
  apps: [
    {
      name: "aurasci-api",
      script: "./dist/server.js",
      cwd: __dirname,
      env: { NODE_ENV: "production" },
      max_memory_restart: "512M",        // restart if leaks past 512 MB
      autorestart: true,
      watch: false,
    },
    {
      name: "aurasci-indexer",
      script: "./dist/indexer.js",
      cwd: __dirname,
      env: { NODE_ENV: "production" },
      max_memory_restart: "256M",
      autorestart: true,
      watch: false,
      // Indexer is single-instance by design (writes to IndexerCheckpoint);
      // never run > 1 replica or events get double-mirrored. Default fork
      // mode (no `instances` field) already gives us exactly one process.
      exec_mode: "fork",
    },
    {
      name: "aurasci-ai",
      script: "./dist/ai-worker.js",
      cwd: __dirname,
      env: { NODE_ENV: "production" },
      max_memory_restart: "512M",
      autorestart: true,
      watch: false,
      // Worker uses prisma updateMany to claim jobs; safe-by-itself but
      // not designed for multi-replica racing. Fork mode keeps it single.
      exec_mode: "fork",
    },
  ],
};

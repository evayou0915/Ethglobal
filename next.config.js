/** @type {import('next').NextConfig} */
const nextConfig = {
  // Bundle `three` (incl. examples/jsm) through Next's compiler so the landing
  // hero gets a single shared THREE instance in the production webpack build.
  transpilePackages: ["three"],
  // Keep already-compiled dev routes alive in memory for an hour and retain up
  // to 10 of them, so switching between pages mid-session doesn't trigger a
  // recompile (default is 25s / 2 pages). Dev-only — has no effect on prod.
  onDemandEntries: {
    maxInactiveAge: 60 * 60 * 1000,
    pagesBufferLength: 10,
  },
  // Turbopack equivalent of the webpack fallback below. Plain string aliases
  // (no `{ browser: ... }` form) — that conditional form isn't recognized in 14.2.
  experimental: {
    turbo: {
      resolveAlias: {
        "@react-native-async-storage/async-storage": "./empty.js",
        "pino-pretty": "./empty.js",
        lokijs: "./empty.js",
        encoding: "./empty.js",
        // We don't use the metaMaskWallet connector (see src/wagmi/config.ts),
        // but @wagmi/connectors does `await import('@metamask/sdk')`. The SDK
        // uses webpackMode:"lazy" dynamic chunks (`./${i}.entry.js`) Turbopack
        // can't statically resolve. Alias to empty — the dynamic import path
        // never fires at runtime because no connector references metaMask().
        "@metamask/sdk": "./empty.js",
        // @privy-io/react-auth ships optional adapters (Farcaster mini-app,
        // Stripe on-ramp) we don't use; stub so the bundler doesn't choke.
        "@farcaster/mini-app-solana": "./empty.js",
        "@stripe/crypto": "./empty.js",
      },
    },
  },
  // Silence the noisy webpack warnings from wagmi/RainbowKit/WalletConnect
  // dependency chain. These modules are optional and only used in environments
  // we don't target (React Native, pretty-printed pino logs in dev tooling).
  // Kept for `next build` (Turbopack handles dev via the alias above).
  webpack: (config) => {
    config.externals.push("pino-pretty", "lokijs", "encoding");
    config.resolve.fallback = {
      ...config.resolve.fallback,
      "@react-native-async-storage/async-storage": false,
      // Privy optional adapters we don't use — let the build ignore them.
      "@farcaster/mini-app-solana": false,
      "@stripe/crypto": false,
    };
    return config;
  },
  async redirects() {
    // Permanently send the old .html routes to the new clean URLs.
    return [
      { source: "/market.html",               destination: "/market",      permanent: true },
      { source: "/dashboard-scientist.html",  destination: "/scientist",   permanent: true },
      { source: "/dashboard-patron.html",     destination: "/portfolio",   permanent: true },
      { source: "/create-intent.html",        destination: "/create",      permanent: true },
      { source: "/onboarding-scientist.html", destination: "/onboard",     permanent: true },
      { source: "/leaderboard.html",          destination: "/leaderboard", permanent: true },
      // /intent-detail.html?id=X → /intent/X is handled by middleware.ts because
      // Next redirect rules can't lift a query param into a path segment.
    ];
  },
  // NOTE: "/" is now served by the React landing page at
  // src/app/(app)/page.tsx (real <Nav> + wallet auth). The previous rewrite
  // pointing "/" at the static public/index.html bundle has been removed.
};

module.exports = nextConfig;

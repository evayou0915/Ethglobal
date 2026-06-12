import { Nav } from "@/components/Nav";
import { Providers } from "../providers";

// All routes under (app) depend on wagmi/wallet APIs that only exist
// in the browser — static prerender breaks because those libs touch
// undefined React refs and `window`. Force-dynamic skips SSG and renders
// these pages on demand; the small TTFB cost doesn't matter for a wallet-
// gated dApp and it makes Vercel builds robust against client-only deps.
export const dynamic = "force-dynamic";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      <Nav />
      <main style={{ minHeight: "calc(100vh - 80px)" }}>{children}</main>
    </Providers>
  );
}

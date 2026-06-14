"use client";

import { useEffect, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useSiweLogin } from "@/client/hooks";

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";

/** When Privy is enabled, all sign-in (wallet incl. WalletConnect, email,
 *  social) goes through Privy's own polished modal — far more robust than a
 *  hand-rolled wagmi flow, and it works without a browser extension (mobile
 *  wallets via WalletConnect QR). When Privy is disabled, fall back to the
 *  custom SIWE-only modal below. */
export function SignInModal(props: { open: boolean; onClose: () => void }) {
  return PRIVY_APP_ID ? <PrivyAutoLogin {...props} /> : <SiweModal {...props} />;
}

/** Opens Privy's native login modal when our sign-in is requested, and
 *  dismisses our own modal flag so only Privy's UI shows. */
function PrivyAutoLogin({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { ready, authenticated, login } = usePrivy();
  const fired = useRef(false);
  useEffect(() => {
    if (!open) { fired.current = false; return; }
    if (!ready) return;
    if (authenticated) { onClose(); return; }   // already signed in
    if (fired.current) return;
    fired.current = true;
    login();        // Privy's modal: wallet (MetaMask/Rabby/WalletConnect) + email + enabled socials
    onClose();      // drop our store flag; Privy renders its own overlay
  }, [open, ready, authenticated, login, onClose]);
  return null;
}

/** SIWE-only sign-in modal (used when Privy is disabled). Connects an
 *  injected wallet via wagmi and signs a Sign-In-With-Ethereum message. */
function SiweModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [err, setErr] = useState<string | null>(null);
  const login = useSiweLogin();

  useEffect(() => { if (open) setErr(null); }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  async function handleConnectWallet() {
    setErr(null);
    try {
      await login.mutateAsync();
      onClose();
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      if (/user rejected|user denied|rejected the request/i.test(msg)) {
        setErr("Signature request was cancelled.");
      } else {
        setErr(msg);
      }
    }
  }

  return (
    <>
      <div
        className={"as-modal-bd" + (open ? " on" : "")}
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <div className="as-modal" role="dialog" aria-modal="true" aria-labelledby="signin-title">
          <button className="as-close" aria-label="Close" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>

          <div className="as-eyebrow">Sign in</div>
          <h3 id="signin-title">Welcome to <em>AuraSci</em></h3>
          <p className="sub">
            Connect your browser wallet and sign a message to continue. The
            signature proves you own the wallet — it costs no gas and sends
            no transaction.
          </p>

          <button className="as-wallet-btn" disabled={login.isPending} onClick={handleConnectWallet}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="6" width="20" height="14" rx="2" />
              <path d="M16 14a2 2 0 1 1 0-4h6" />
            </svg>
            {login.isPending ? "Check your wallet…" : "Connect wallet & sign in"}
          </button>

          {err && <div className="as-err">{err}</div>}
          <div className="as-foot">Sign-In with Ethereum · works with MetaMask, Rabby &amp; other browser wallets.</div>
        </div>
      </div>

      <style jsx global>{`
        .as-modal-bd { position: fixed; inset: 0; z-index: 9000; background: rgba(42,26,16,0.55); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; padding: 20px; opacity: 0; transition: opacity .2s ease; pointer-events: none; }
        .as-modal-bd.on { opacity: 1; pointer-events: auto; }
        .as-modal { position: relative; width: 100%; max-width: 440px; background: #fdfcf8; border: 1px solid rgba(58,36,24,0.18); border-radius: 8px; padding: 32px 30px; box-shadow: 0 32px 80px rgba(58,36,24,0.25); font-family: 'Inter', sans-serif; color: #2a1a10; transform: translateY(8px); transition: transform .25s ease; }
        .as-modal-bd.on .as-modal { transform: translateY(0); }
        .as-modal::before, .as-modal::after { content: ''; position: absolute; width: 14px; height: 14px; border: 1.5px solid #c2410c; pointer-events: none; }
        .as-modal::before { top: -1px; left: -1px; border-right: none; border-bottom: none; }
        .as-modal::after { bottom: -1px; right: -1px; border-left: none; border-top: none; }
        .as-eyebrow { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #c2410c; letter-spacing: .18em; text-transform: uppercase; margin: 0 0 10px; display: flex; align-items: center; gap: 10px; }
        .as-eyebrow::before { content: ''; width: 14px; height: 1px; background: #c2410c; }
        .as-modal h3 { font-family: 'Newsreader', serif; font-weight: 500; font-size: 24px; letter-spacing: -0.01em; margin: 0 0 8px; }
        .as-modal h3 em { font-style: italic; color: #c2410c; }
        .as-modal .sub { font-size: 13px; color: #5a3d2a; margin: 0 0 22px; line-height: 1.55; }
        .as-wallet-btn { width: 100%; padding: 12px 16px; border-radius: 6px; background: #c2410c; border: 1px solid #c2410c; color: #faf3e3; font-family: 'Inter', sans-serif; font-size: 14px; font-weight: 600; cursor: pointer; transition: all .2s; display: inline-flex; align-items: center; justify-content: center; gap: 8px; }
        .as-wallet-btn:hover:not(:disabled) { background: #9a3412; border-color: #9a3412; box-shadow: 0 6px 16px rgba(154,52,18,0.30); }
        .as-wallet-btn:disabled { opacity: .5; cursor: not-allowed; }
        .as-close { position: absolute; top: 14px; right: 14px; width: 28px; height: 28px; border-radius: 50%; background: transparent; border: none; color: rgba(58,36,24,0.55); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: color .2s, background .2s; }
        .as-close:hover { color: #c2410c; background: rgba(254,215,170,0.30); }
        .as-foot { margin-top: 14px; font-family: 'JetBrains Mono', monospace; font-size: 10px; color: rgba(58,36,24,0.45); letter-spacing: .06em; text-align: center; }
        .as-err { margin-top: 14px; padding: 10px 12px; border-radius: 6px; background: rgba(194,65,12,0.08); border: 1px solid rgba(194,65,12,0.30); color: #7c2d12; font-size: 12px; font-family: 'JetBrains Mono', monospace; line-height: 1.5; }
      `}</style>
    </>
  );
}

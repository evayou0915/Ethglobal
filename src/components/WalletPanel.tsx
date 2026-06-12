"use client";

/**
 * Right-side slide-over showing the user's active wallet:
 *  - Address + chain
 *  - ETH balance (for gas) + USDC balance (for funding/claims)
 *  - Copy address to clipboard
 *  - Testnet faucet links (auto-shown on Base Sepolia)
 *
 * Triggered from the Nav user dropdown. No backend changes — pure UI on
 * top of wagmi.
 */
import { useEffect, useState } from "react";
import { useBalance, useReadContract } from "wagmi";
import { useSession } from "@/client/hooks";
import { ACTIVE_CHAIN, USDC_ADDRESS, addrUrl } from "@/wagmi/config";

const ERC20_BALANCE_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "decimals",  stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;

const IS_SEPOLIA = ACTIVE_CHAIN.id === 84532;

export function WalletPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const session = useSession();

  const [copied, setCopied] = useState(false);

  // ESC to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Always show the DB-pinned wallet — the address committed at signup that
  // every backend check (intent ownership, scientistWallet payout, refund
  // eligibility) recognises as "this user". Reading from /me instead of
  // wagmi's `address` means the panel can't briefly flash a non-pinned
  // wallet while wagmi rehydrates after a page reload.
  const activeAddr = (session.data?.wallet ?? null) as `0x${string}` | null;

  const ethBal = useBalance({
    address: activeAddr ?? undefined,
    chainId: ACTIVE_CHAIN.id,
    query: { enabled: Boolean(activeAddr) && open },
  });
  const usdcBal = useReadContract({
    address: USDC_ADDRESS,
    abi: ERC20_BALANCE_ABI,
    functionName: "balanceOf",
    args: activeAddr ? [activeAddr] : undefined,
    chainId: ACTIVE_CHAIN.id,
    query: { enabled: Boolean(activeAddr) && open },
  });
  const usdcDecimals = useReadContract({
    address: USDC_ADDRESS,
    abi: ERC20_BALANCE_ABI,
    functionName: "decimals",
    chainId: ACTIVE_CHAIN.id,
    query: { enabled: open },
  });

  async function copyAddr() {
    if (!activeAddr) return;
    try {
      await navigator.clipboard.writeText(activeAddr);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* ignore */ }
  }

  const ethHuman = ethBal.data ? Number(ethBal.data.value) / 1e18 : null;
  const usdcHuman = usdcBal.data && usdcDecimals.data
    ? Number(usdcBal.data as bigint) / 10 ** Number(usdcDecimals.data as number)
    : null;

  return (
    <>
      <div className={"wp-backdrop" + (open ? " on" : "")} onClick={onClose} />
      <aside className={"wp-panel" + (open ? " on" : "")} aria-hidden={!open}>
        <header className="wp-head">
          <h3>Your wallet</h3>
          <button className="wp-close" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className="wp-body">
          {!activeAddr && (
            <div className="wp-empty">
              No wallet attached yet. Sign in or link a wallet to get started.
            </div>
          )}

          {activeAddr && (
            <>
              {/* Address block */}
              <div className="wp-section">
                <div className="wp-label">Address</div>
                <div className="wp-addr">
                  <code>{activeAddr}</code>
                  <button className="wp-mini-btn" onClick={copyAddr}>
                    {copied ? "Copied!" : "Copy"}
                  </button>
                </div>
                <div className="wp-sub">
                  Network: <b>{ACTIVE_CHAIN.name}</b>
                  {" · "}
                  <a href={addrUrl(activeAddr)} target="_blank" rel="noreferrer">View on explorer ↗</a>
                </div>
              </div>

              {/* Balances */}
              <div className="wp-section">
                <div className="wp-label">Balances</div>
                <div className="wp-bal-grid">
                  <div className="wp-bal">
                    <div className="t">ETH (gas)</div>
                    <div className="v">{ethHuman == null ? "—" : ethHuman.toFixed(4)}</div>
                  </div>
                  <div className="wp-bal">
                    <div className="t">USDC (funding)</div>
                    <div className="v">{usdcHuman == null ? "—" : usdcHuman.toFixed(2)}</div>
                  </div>
                </div>
                <div className="wp-sub">
                  Need <b>ETH</b> to pay gas for every transaction;
                  need <b>USDC</b> to fund intents or receive milestone releases.
                </div>
              </div>

              {/* Faucets (testnet only) */}
              {IS_SEPOLIA && (
                <div className="wp-section wp-faucets">
                  <div className="wp-label">Testnet faucets</div>
                  <ul>
                    <li>
                      <a href="https://www.alchemy.com/faucets/base-sepolia" target="_blank" rel="noreferrer">
                        Alchemy · Base Sepolia ETH (0.1 ETH / day) ↗
                      </a>
                    </li>
                    <li>
                      <a href="https://portal.cdp.coinbase.com/products/faucet" target="_blank" rel="noreferrer">
                        Coinbase Developer · Base Sepolia ETH ↗
                      </a>
                    </li>
                    <li>
                      <a href="https://faucet.circle.com/" target="_blank" rel="noreferrer">
                        Circle · USDC faucet (10 USDC / hour, choose Base Sepolia) ↗
                      </a>
                    </li>
                  </ul>
                  <div className="wp-sub">
                    Paste the address above into each faucet form. Funds arrive
                    in ~10 seconds.
                  </div>
                </div>
              )}

            </>
          )}
        </div>
      </aside>

      <style jsx global>{`
        .wp-backdrop { position: fixed; inset: 0; background: rgba(58,36,24,0.18); opacity: 0; pointer-events: none; transition: opacity .25s ease; z-index: 8995; }
        .wp-backdrop.on { opacity: 1; pointer-events: auto; }

        .wp-panel { position: fixed; top: 0; right: 0; bottom: 0; width: 420px; max-width: 92vw; background: #fdfcf8; border-left: 1px solid rgba(58,36,24,0.20); box-shadow: -16px 0 44px rgba(58,36,24,0.14); z-index: 9000; display: flex; flex-direction: column; transform: translateX(100%); transition: transform .32s cubic-bezier(.4,0,.2,1); font-family: 'Inter', sans-serif; }
        .wp-panel.on { transform: translateX(0); }

        .wp-head { display: flex; justify-content: space-between; align-items: center; padding: 20px 24px; border-bottom: 1px solid rgba(58,36,24,0.10); }
        .wp-head h3 { margin: 0; font-family: 'Newsreader', serif; font-weight: 500; font-size: 22px; color: #2a1a10; letter-spacing: -0.01em; }
        .wp-close { width: 32px; height: 32px; border: 1px solid rgba(58,36,24,0.18); background: transparent; color: #5a3d2a; display: inline-flex; align-items: center; justify-content: center; font-size: 18px; cursor: pointer; border-radius: 50%; line-height: 1; }
        .wp-close:hover { border-color: #c2410c; color: #c2410c; }

        .wp-body { flex: 1; overflow-y: auto; padding: 18px 24px 28px; }
        .wp-empty { padding: 24px 4px; text-align: center; color: rgba(58,36,24,0.55); font-family: 'JetBrains Mono', monospace; font-size: 13px; }

        .wp-section { padding: 14px 0 18px; border-bottom: 1px dashed rgba(58,36,24,0.12); }
        .wp-section:last-child { border-bottom: none; }
        .wp-label { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: rgba(58,36,24,0.55); letter-spacing: .14em; text-transform: uppercase; margin-bottom: 10px; }

        .wp-addr { display: flex; gap: 8px; align-items: center; background: #faf3e3; border: 1px solid rgba(58,36,24,0.18); border-radius: 6px; padding: 10px 12px; }
        .wp-addr code { flex: 1; font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #2a1a10; word-break: break-all; }
        .wp-mini-btn { background: transparent; border: 1px solid rgba(58,36,24,0.20); color: #5a3d2a; padding: 4px 10px; border-radius: 4px; font-family: 'JetBrains Mono', monospace; font-size: 11px; cursor: pointer; transition: all .18s; }
        .wp-mini-btn:hover { border-color: #c2410c; color: #c2410c; }

        .wp-sub { font-size: 12px; color: rgba(58,36,24,0.55); margin-top: 8px; line-height: 1.5; }
        .wp-sub a { color: #c2410c; text-decoration: none; }
        .wp-sub a:hover { text-decoration: underline; }
        .wp-sub b { color: #2a1a10; }

        .wp-bal-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .wp-bal { background: #faf3e3; border: 1px solid rgba(58,36,24,0.18); border-radius: 6px; padding: 12px 14px; }
        .wp-bal .t { font-size: 11px; color: rgba(58,36,24,0.55); font-family: 'JetBrains Mono', monospace; letter-spacing: .08em; text-transform: uppercase; margin-bottom: 6px; }
        .wp-bal .v { font-family: 'Newsreader', serif; font-weight: 500; font-size: 22px; color: #2a1a10; letter-spacing: -0.01em; line-height: 1; }

        .wp-faucets ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
        .wp-faucets li a { font-family: 'Inter', sans-serif; font-size: 13px; color: #c2410c; text-decoration: none; padding: 6px 0; display: block; }
        .wp-faucets li a:hover { text-decoration: underline; }

        .wp-actions { display: flex; flex-direction: column; }
        .wp-btn { width: 100%; padding: 11px 14px; margin-top: 8px; background: #2a1a10; color: #faf3e3; border: 1px solid #2a1a10; border-radius: 6px; font-family: 'Inter', sans-serif; font-size: 13px; font-weight: 500; cursor: pointer; transition: all .18s; }
        .wp-btn:hover { background: #c2410c; border-color: #c2410c; }
        .wp-btn.secondary { background: transparent; color: #2a1a10; }
        .wp-btn.secondary:hover { color: #c2410c; }

      `}</style>
    </>
  );
}

"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { shortAddr, useLogout, useSession } from "@/client/hooks";
import { useAuth } from "@/client/auth";
import { useSignInModal } from "@/client/sign-in-store";
import { SignInModal } from "./SignInModal";
import { WalletPanel } from "./WalletPanel";

type SessionUser = { wallet: string | null; displayName?: string | null; email?: string | null } | undefined;

export function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const { ready, authenticated } = useAuth();
  const session = useSession();
  const logout = useLogout();

  const { isOpen: modalOpen, open: openModal, close: closeModal } = useSignInModal();
  const [menuOpen, setMenuOpen] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close the mobile menu whenever the route changes — clicking a link should
  // navigate AND collapse the menu (also belts-and-suspenders the link-click
  // handler on the .links container).
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  // Escape closes the mobile menu.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMobileOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  const on = (href: string) => (pathname === href ? "on" : "");

  // Auto-close the sign-in modal once auth completes.
  useEffect(() => {
    if (authenticated && modalOpen) closeModal();
  }, [authenticated, modalOpen, closeModal]);

  // The static landing page (public/auth-stub.js) can't mount the React
  // WalletPanel, so its "Wallet" menu item links here with `?wallet=1`.
  // Honour that param once auth state is hydrated, then strip it from the
  // URL so a refresh doesn't re-open the panel.
  useEffect(() => {
    if (!ready || !authenticated) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("wallet") === "1") {
      setWalletOpen(true);
      params.delete("wallet");
      const qs = params.toString();
      router.replace(window.location.pathname + (qs ? `?${qs}` : ""));
    }
  }, [ready, authenticated, router]);

  // Mirror auth state into the legacy localStorage keys that
  // public/auth-stub.js reads. This lets the static landing page (/index.html)
  // recognise users who signed in via the React app and show their user pill
  // instead of the Login button.
  useEffect(() => {
    if (!ready) return;
    try {
      if (authenticated) {
        const { display, source } = sessionDisplayName(session.data);
        localStorage.setItem("aurasci_auth", "1");
        localStorage.setItem("aurasci_auth_method", source.toLowerCase());
        localStorage.setItem("aurasci_handle", display);
      } else {
        localStorage.removeItem("aurasci_auth");
        localStorage.removeItem("aurasci_auth_method");
        localStorage.removeItem("aurasci_handle");
      }
    } catch { /* ignore */ }
  }, [ready, authenticated, session.data]);

  async function onLogout() {
    setMenuOpen(false);
    try {
      localStorage.removeItem("aurasci_auth");
      localStorage.removeItem("aurasci_auth_method");
      localStorage.removeItem("aurasci_handle");
    } catch { /* ignore */ }
    await logout();
    router.push("/");
  }

  return (
    <>
      <nav className={"bnav" + (mobileOpen ? " menu-open" : "")}>
        <div className="left">
          <Link className="brand" href="/">
            <img className="brand-mark" src="/logo-mark.png" alt="" />
            <span>AuraSci</span>
          </Link>
        </div>
        <button
          type="button"
          className="as-nav-burger"
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen((v) => !v)}
        >
          {mobileOpen ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          )}
        </button>
        <div
          className="links"
          onClick={(e) => {
            // Tapping a link inside the mobile panel should collapse the menu.
            // Filter on <a> so button clicks (UserPill toggle) don't close it.
            if ((e.target as HTMLElement).closest("a")) setMobileOpen(false);
          }}
        >
          <Link href="/market"      className={on("/market")}>Market</Link>
          <span className="muted" title="Coming soon">Governance</span>
          <Link href="/leaderboard" className={on("/leaderboard")}>Leaderboard</Link>

          {/* While auth state is hydrating, render nothing in the slot to avoid
              flashing the Login button at users who are already signed in. */}
          {ready && !authenticated && (
            <a
              className="as-nav-login"
              href="javascript:void(0)"
              onClick={(e) => { e.preventDefault(); openModal(); }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                <polyline points="10 17 15 12 10 7" />
                <line x1="15" y1="12" x2="3" y2="12" />
              </svg>
              <span>Login</span>
            </a>
          )}

          {ready && authenticated && (
            <UserPill
              user={session.data}
              open={menuOpen}
              setOpen={setMenuOpen}
              onLogout={onLogout}
              onOpenWallet={() => { setMenuOpen(false); setWalletOpen(true); }}
            />
          )}
        </div>
      </nav>

      <SignInModal open={modalOpen} onClose={closeModal} />
      <WalletPanel open={walletOpen} onClose={() => setWalletOpen(false)} />

      <NavStyles />
    </>
  );
}

function UserPill({ user, open, setOpen, onLogout, onOpenWallet }: {
  user: SessionUser;
  open: boolean;
  setOpen: (b: boolean) => void;
  onLogout: () => void;
  onOpenWallet: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Click outside to close
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("click", onClick); document.removeEventListener("keydown", onKey); };
  }, [open, setOpen]);

  const { display, source } = sessionDisplayName(user);
  const initial = (display.replace(/^@/, "").replace(/^0x/, "")[0] ?? "A").toUpperCase();

  return (
    <div className="as-nav-user-wrap" ref={wrapRef}>
      <button
        type="button"
        className={"as-nav-user" + (open ? " on" : "")}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(!open); }}
      >
        <span className="av">{initial}</span>
        <span className="nm">{display}</span>
        <svg className="cv" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      <div className={"as-nav-dropdown" + (open ? " on" : "")} role="menu">
        <div className="meta">Signed in via {source}</div>
        <Link href="/portfolio" onClick={() => setOpen(false)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2" /><path d="M8 21h8M12 17v4" />
          </svg>
          <span>Portfolio</span>
        </Link>
        <button type="button" onClick={onOpenWallet}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 12V8H4a2 2 0 0 1 0-4h12v4" />
            <path d="M4 6v14a2 2 0 0 0 2 2h14V6" />
            <circle cx="16" cy="14" r="1.5" />
          </svg>
          <span>Wallet</span>
        </button>
        <div className="sep" />
        <button type="button" onClick={onLogout}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          <span>Logout</span>
        </button>
      </div>
    </div>
  );
}

/** Pick the best-looking display string for the user (in priority order:
 *  display name → email local-part → wallet short addr → "Account"). */
function sessionDisplayName(user: SessionUser): { display: string; source: string } {
  if (!user) return { display: "Account", source: "Wallet" };
  if (user.displayName) return { display: user.displayName, source: "Wallet" };
  if (user.email)       return { display: user.email.split("@")[0], source: "Wallet" };
  if (user.wallet)      return { display: shortAddr(user.wallet), source: "Wallet" };
  return { display: "Account", source: "Wallet" };
}

function NavStyles() {
  return (
    <style jsx global>{`
      /* === Login pill (rust accent, matches the original auth-stub.js look) === */
      .as-nav-login { position: relative; display: inline-flex; align-items: center; gap: 8px; margin-left: 16px; padding: 0 18px 14px; text-decoration: none; cursor: pointer; font-family: 'Inter', sans-serif; font-size: 13px; font-weight: 600; letter-spacing: 0.01em; line-height: 1; color: #faf3e3; }
      .as-nav-login::before { content: ''; position: absolute; left: 0; right: 0; top: -7px; bottom: 7px; border-radius: 6px; background: #c2410c; border: 1px solid #c2410c; z-index: 0; transition: background .18s ease, border-color .18s ease, box-shadow .18s ease; }
      .as-nav-login:hover::before { background: #9a3412; border-color: #9a3412; box-shadow: 0 4px 12px rgba(154,52,18,0.22); }
      .as-nav-login:active::before { background: #7c2d12; border-color: #7c2d12; box-shadow: 0 2px 6px rgba(124,45,18,0.25); }
      .as-nav-login:focus-visible { outline: none; }
      .as-nav-login:focus-visible::before { box-shadow: 0 0 0 3px rgba(194,65,12,0.30); }
      .as-nav-login > svg, .as-nav-login > span { position: relative; z-index: 1; }
      .as-nav-login svg { display: block; flex-shrink: 0; }
      .bnav .links .as-nav-login, .bnav .links .as-nav-login:hover { color: #faf3e3 !important; border-bottom: none !important; }
      .bnav .links .as-nav-login span { color: #faf3e3; }

      /* === Logged-in user pill + dropdown === */
      .as-nav-user-wrap { position: relative; margin-left: 16px; padding: 0 0 14px; display: inline-flex; align-items: center; line-height: 1; font-family: 'Inter', sans-serif; font-size: 13px; }
      .as-nav-user { padding: 6px 12px 6px 6px; border-radius: 6px; background: transparent; border: 1px solid rgba(58,36,24,0.20); color: #2a1a10; font-size: 13px; font-weight: 500; line-height: 1; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; transition: border-color .2s, background .2s, color .2s; }
      .as-nav-user:hover, .as-nav-user.on { border-color: #c2410c; background: rgba(254,215,170,0.30); color: #c2410c; }
      .as-nav-user .av { width: 22px; height: 22px; border-radius: 50%; background: linear-gradient(135deg,#fed7aa,#fb923c); color: #7c2d12; display: inline-flex; align-items: center; justify-content: center; font-weight: 600; font-size: 11px; line-height: 1; border: 1px solid rgba(194,65,12,0.30); }
      .as-nav-user .nm { max-width: 130px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .as-nav-user .cv { opacity: .55; transition: transform .2s; }
      .as-nav-user.on .cv { transform: rotate(180deg); }

      .as-nav-dropdown { position: absolute; top: calc(100% + 8px); right: 0; min-width: 200px; background: #fdfcf8; border: 1px solid rgba(58,36,24,0.18); border-radius: 6px; box-shadow: 0 16px 36px rgba(58,36,24,0.14); padding: 6px; display: none; z-index: 9001; font-family: 'Inter', sans-serif; }
      .as-nav-dropdown.on { display: block; }
      .as-nav-dropdown::before { content: ''; position: absolute; top: -5px; right: 18px; width: 8px; height: 8px; background: #fdfcf8; border-left: 1px solid rgba(58,36,24,0.18); border-top: 1px solid rgba(58,36,24,0.18); transform: rotate(45deg); }
      .as-nav-dropdown .meta { padding: 10px 12px 8px; font-family: 'JetBrains Mono', monospace; font-size: 10px; color: rgba(58,36,24,0.55); letter-spacing: .10em; text-transform: uppercase; }
      .as-nav-dropdown .sep { height: 1px; background: rgba(58,36,24,0.10); margin: 4px 0; }
      .as-nav-dropdown a, .as-nav-dropdown button { display: flex; align-items: center; gap: 10px; width: 100%; padding: 9px 12px; border-radius: 4px; text-decoration: none; color: #2a1a10; background: transparent; border: none; cursor: pointer; font-family: 'Inter', sans-serif; font-size: 13px; font-weight: 500; text-align: left; line-height: 1.2; letter-spacing: 0; transition: background .15s, color .15s; }
      .as-nav-dropdown a:hover, .as-nav-dropdown button:hover { background: rgba(254,215,170,0.30); color: #c2410c; }
      .as-nav-dropdown svg { flex-shrink: 0; opacity: .7; }
      .as-nav-dropdown a:hover svg, .as-nav-dropdown button:hover svg { opacity: 1; }

      /* === Mobile hamburger button (hidden on desktop) === */
      .as-nav-burger { display: none; margin-left: auto; width: 36px; height: 36px; padding: 0; border: 1px solid rgba(58,36,24,0.20); border-radius: 6px; background: transparent; color: #2a1a10; cursor: pointer; align-items: center; justify-content: center; flex-shrink: 0; transition: border-color .2s, color .2s, background .2s; }
      .as-nav-burger:hover { border-color: #c2410c; color: #c2410c; background: rgba(254,215,170,0.20); }
      .as-nav-burger svg { display: block; }

      /* === Mobile layout: collapse links into a panel under the burger === */
      @media (max-width: 720px) {
        .bnav { flex-wrap: wrap; padding: 14px 18px; align-items: center; row-gap: 0; }
        .bnav .left { flex: 1 1 auto; min-width: 0; }
        .as-nav-burger { display: inline-flex; }
        .bnav .links {
          flex-basis: 100%;
          flex-direction: column;
          align-items: stretch;
          gap: 0;
          margin-top: 14px;
          padding-top: 6px;
          border-top: 1px solid rgba(58,36,24,0.12);
          display: none;
        }
        .bnav.menu-open .links { display: flex; }
        .bnav .links a, .bnav .links .muted {
          padding: 14px 4px !important;
          border-bottom: 1px solid rgba(58,36,24,0.06) !important;
        }
        .bnav .links a:hover, .bnav .links a.on {
          border-bottom-color: rgba(58,36,24,0.06) !important;
        }
        .as-nav-login { margin-left: 0 !important; padding: 14px 18px !important; align-self: flex-start; }
        .as-nav-login::before { top: 6px !important; bottom: 6px !important; }
        .as-nav-user-wrap { margin-left: 0 !important; padding: 14px 0 !important; align-self: flex-start; }
        /* Landing route's transparent nav (body:has(.lp) override in landing.css)
         * leaves the open menu panel unreadable over the hero — give it an
         * opaque cream fill + blur once expanded. */
        body:has(.lp) .bnav.menu-open {
          background: rgba(244,234,216,0.96) !important;
          -webkit-backdrop-filter: blur(10px) !important;
          backdrop-filter: blur(10px) !important;
          border-bottom-color: rgba(58,36,24,0.12) !important;
        }
      }
    `}</style>
  );
}

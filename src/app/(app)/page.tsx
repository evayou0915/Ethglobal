"use client";

/**
 * Landing page ("/") — ported from the old static bundle (public/index.html).
 *
 * Lives in the (app) route group so it automatically gets the real <Nav> +
 * wagmi <Providers> from (app)/layout.tsx — one nav everywhere, real
 * auth, no more auth-stub.js mock.
 *
 * The hero + role-pick + partner strip are injected as static HTML (so we don't
 * hand-convert ~8 inline SVGs to JSX). Styling lives in ./landing.css, scoped
 * under `.lp`. The rotating point-cloud "bust" is the original Three.js hero,
 * now bundled locally via the npm `three` package (no CDN) and torn down on
 * unmount.
 */
import { useCallback, useEffect, useRef, memo, type MouseEvent as ReactMouseEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/client/auth";
import { useSignInModal } from "@/client/sign-in-store";
import HeroBust from "./HeroBust";
import "./landing.css";

// HeroBust ('use client') statically imports `three` so the production build
// keeps a single THREE instance and the chunk always ships with this page
// (no dynamic-chunk load that could silently fail). Its effect is client-only.

// Research partners — was injected at runtime by public/partners.js; now static
// markup so nothing mutates the React-managed DOM. Two identical rows give the
// seamless marquee loop (the track animates translateX 0 → -50%).
const PARTNERS: Array<[name: string, src: string, h: number]> = [
  ["Hetu",                         "/images/partners/hetu.svg",       30],
  ["Stanford University",          "/images/partners/stanford.png",   38],
  ["University of Washington",     "/images/partners/washington.png", 38],
  ["Brigham and Women's Hospital", "/images/partners/brigham.png",    38],
  ["Princeton University",         "/images/partners/princeton.png",  38],
  ["University of Cambridge",      "/images/partners/cambridge.png",  38],
  ["McGill University",            "/images/partners/mcgill.png",     38],
];
const partnerRow = PARTNERS.map(
  ([name, src, h]) =>
    `<span class="as-partner"><img class="lg" src="${src}" alt="${name}" loading="lazy" decoding="async" style="height:${h}px"></span>`
).join("");
const PARTNERS_HTML = `
  <section class="as-partners as-partners--overlay" aria-label="Research partners and collaborators">
    <div class="as-partners-eyebrow"><span>Backed by <b>Advaita Labs</b> · in collaboration with</span></div>
    <div class="as-partners-track">
      <div class="as-partners-row">${partnerRow}</div>
      <div class="as-partners-row">${partnerRow}</div>
    </div>
  </section>`;

// Body content lifted from the bundle, minus the old <nav> (React <Nav> renders
// it) and minus the inline <script>s. CTA links repointed to the clean React
// routes (market.html → /market, onboarding-scientist.html → /onboard, the
// patron card → /market for public browsing).
const LANDING_HTML = `
<div class="vignette"></div>

<section class="hero">
  <div class="bust" id="three-bust"></div>
  <div class="bust-blur-static"></div>
  <div class="bust-blur"></div>
  <div class="bust-wash"></div>

  <span class="tag">Defining the future · scaffolding science</span>

  <h1>
    <span class="word" data-text="Open">Open</span><br>
    <span class="em word" data-text="Science">Science</span>
  </h1>

  <p class="sub">The Agent-Native Infrastructure for Open Science.</p>
  <div class="kicker">Scientists publish · AI verifies · Patrons fund · capital flows</div>

  <div class="ctas">
    <a class="btn btn-primary" href="/onboard" data-auth-gate="1">Verify as a scientist →</a>
    <a class="btn btn-ghost" href="/market">Browse the market</a>
  </div>

  <a class="scroll-cue" href="#choose-role" aria-label="Scroll to role pick">
    <span class="cue-label">scroll</span>
    <span class="cue-arrow">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
    </span>
  </a>
${PARTNERS_HTML}
</section>

<section class="role-pick">
  <div class="anchor" id="choose-role"></div>
  <div class="eyebrow">Two paths · one trust loop</div>
  <h2>Are you a <em>scientist</em> or a <em>patron</em>?</h2>
  <p class="lead">Whichever side you're on, AuraSci handles the verification, escrow, and milestone-based capital flow. Pick your starting point.</p>

  <div class="role-grid">
    <a class="role-card sci" href="/onboard" data-auth-gate="1">
      <span class="bignum">01</span>
      <span class="grid-bg"></span>
      <span class="smear"></span>
      <div class="inner">
        <div class="strip">
          <div class="ico">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6v4l5 9c.7 1.3-.3 3-1.8 3H5.8c-1.5 0-2.5-1.7-1.8-3l5-9V3z"></path><line x1="9" y1="3" x2="15" y2="3"></line></svg>
          </div>
          <div class="role-tag">For Scientists</div>
        </div>
        <h3>I'm a <em>scientist</em></h3>
        <p>Publish research intent, set milestones, submit proof of progress, and receive milestone-based patronage for breakthrough work.</p>
        <ul>
          <li><span class="num">01</span><span class="lbl">Publish intent assets</span><span class="dot"></span></li>
          <li><span class="num">02</span><span class="lbl">AI-verified milestones</span><span class="dot"></span></li>
          <li><span class="num">03</span><span class="lbl">Milestone-based funding</span><span class="dot"></span></li>
        </ul>
      </div>
      <div class="cta-bar">
        <span>Start publishing →</span>
        <span class="arr"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg></span>
      </div>
    </a>

    <a class="role-card pat" href="/market" data-auth-gate="1">
      <span class="bignum">02</span>
      <span class="grid-bg"></span>
      <span class="smear"></span>
      <div class="inner">
        <div class="strip">
          <div class="ico">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12l4 6-10 13L2 9l4-6z"></path><path d="M11 3 8 9l4 13 4-13-3-6"></path><line x1="2" y1="9" x2="22" y2="9"></line></svg>
          </div>
          <div class="role-tag">For Patrons</div>
        </div>
        <h3>I'm a <em>patron</em></h3>
        <p>Browse AI-verified research intents, provide patronage to promising science, and track milestone-based progress of funded projects.</p>
        <ul>
          <li><span class="num">01</span><span class="lbl">Browse verified research</span><span class="dot"></span></li>
          <li><span class="num">02</span><span class="lbl">Escrow-protected patronage</span><span class="dot"></span></li>
          <li><span class="num">03</span><span class="lbl">AI trust loop verification</span><span class="dot"></span></li>
        </ul>
      </div>
      <div class="cta-bar">
        <span>Explore market →</span>
        <span class="arr"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg></span>
      </div>
    </a>
  </div>
</section>

<div class="corner-bl">
  <div class="bars"><span></span><span></span><span></span><span></span><span></span></div>
  <div>Est. 2023 / AuraSci</div>
</div>
<div class="corner-br">
  <span class="blink"></span>Status · live<br><b>$420,000 USDC</b> escrowed
</div>
`;

// The static hero/role-pick/partner markup. Memoized + module-scope so it
// renders exactly ONCE: React must never re-apply this div's innerHTML, because
// HeroBust appends a <canvas> into #three-bust and the cursor effect mutates
// .bust-blur — a re-render would wipe both (that was the Vercel "no hero" bug).
// The `onClick` prop is referentially stable (see useCallback below), so this
// memo never re-renders even as auth state changes on the parent.
const LandingMarkup = memo(function LandingMarkup({
  onClick,
}: {
  onClick: (e: ReactMouseEvent<HTMLDivElement>) => void;
}) {
  return <div className="lp" onClick={onClick} dangerouslySetInnerHTML={{ __html: LANDING_HTML }} />;
});

export default function LandingPage() {
  const router = useRouter();
  const { ready, authenticated } = useAuth();
  const { open: openSignIn, isOpen: signInOpen } = useSignInModal();
  // Where to send the user once they finish signing in (set when a logged-out
  // visitor clicks a gated CTA).
  const pendingHref = useRef<string | null>(null);

  // Keep the latest auth state in a ref so the click handler can be a STABLE
  // (useCallback) function — required so <LandingMarkup> never re-renders.
  const authRef = useRef({ ready, authenticated });
  authRef.current = { ready, authenticated };

  // Gate the scientist-onboarding + role-card CTAs behind login, mirroring the
  // old auth-stub.js behaviour: a logged-out click opens the sign-in modal
  // instead of navigating; "Browse the market" stays public. Delegated onClick
  // covers the dangerouslySetInnerHTML links. Once auth completes, the
  // effect below resumes the navigation.
  const onLandingClick = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    const gate = (e.target as HTMLElement).closest<HTMLAnchorElement>("a[data-auth-gate]");
    if (!gate) return;
    if (authRef.current.ready && !authRef.current.authenticated) {
      e.preventDefault();
      pendingHref.current = gate.getAttribute("href");
      openSignIn();
    }
  }, [openSignIn]);

  // Resume the gated navigation after a successful sign-in.
  useEffect(() => {
    if (authenticated && pendingHref.current) {
      const href = pendingHref.current;
      pendingHref.current = null;
      router.push(href);
    }
  }, [authenticated, router]);

  // If the user closes the sign-in modal WITHOUT authenticating, drop the
  // pending destination so a later, unrelated login doesn't yank them to it.
  useEffect(() => {
    if (!signInOpen && !authenticated) pendingHref.current = null;
  }, [signInOpen, authenticated]);

  // The Three.js hero + cursor-blur live in <HeroBust/> (client-only, static
  // three imports) so the production bundle keeps a single THREE instance.

  return (
    <>
      <HeroBust />
      <LandingMarkup onClick={onLandingClick} />
    </>
  );
}

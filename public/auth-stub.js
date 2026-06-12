/* AuraSci · client-side auth stub
 * ------------------------------------------------------------
 * Demo-only. Persists a flag in localStorage. Logged out:
 *  · Portfolio link hidden in the nav, replaced by a prominent
 *    rust-coloured "Login" button on the far right.
 *  · Clicking any dashboard-patron link opens the same login
 *    modal instead of navigating; on success it resumes the
 *    original destination.
 * Modal supports 4 demo sign-in methods: Google, Twitter, email,
 * Connect Wallet.
 */
(function () {
  const KEY = 'aurasci_auth';
  const isAuthed = () => localStorage.getItem(KEY) === '1';

  // ---------- styles (one-shot) ----------
  function ensureStyles() {
    if (document.getElementById('as-stub-styles')) return;
    const css = `
      /* Bottom corner status widgets — globally hidden per design request. */
      .bcorner-bl,.bcorner-br,.corner-bl,.corner-br{display:none !important}

      /* Top nav: transparent by default, opaque + blurred once the page
         is scrolled. The .scrolled class is toggled by the listener below. */
      nav{background:transparent !important;
        -webkit-backdrop-filter:none !important;
        backdrop-filter:none !important;
        border-bottom:1px solid transparent !important;
        transition:background-color .25s ease, border-color .25s ease,
          backdrop-filter .25s ease, -webkit-backdrop-filter .25s ease}
      nav.scrolled{background:rgba(244,234,216,0.78) !important;
        -webkit-backdrop-filter:blur(14px) saturate(140%) !important;
        backdrop-filter:blur(14px) saturate(140%) !important;
        border-bottom:1px solid rgba(58,36,24,0.10) !important}

      /* The bundled landing's .links a:hover sets color:rust + bottom-
         border:rust on every <a> in nav .links — that paints our Login
         button text the same color as its pill bg. Override it. */
      .as-nav-login,.as-nav-login:hover{color:#faf3e3 !important;
        border-bottom:none !important}
      .as-nav-login span{color:#faf3e3}

      /* === Nav login CTA ===
         Nav links use padding-bottom:14px (for the hover underline) and no
         top padding, so their text sits flush with the top. We give the
         button line-height:1 plus a negative margin-top so its text-line
         lines up with the link text-line under align-items:center. */
      /* The Login CTA shares geometry with the surrounding nav links
         (text at top, padding-bottom:14px) so flex's align-items:center
         lines its text up with the other links exactly. The rust pill
         is rendered via ::before, positioned to extend 7px above and
         7px below the text-line — visually a button, layout-wise just
         a link. */
      .as-nav-login{position:relative;display:inline-flex;align-items:center;
        gap:8px;margin-left:16px;padding:0 18px 14px;
        text-decoration:none;cursor:pointer;
        font-family:'Inter',sans-serif;font-size:13px;
        font-weight:600;letter-spacing:0.01em;line-height:1;
        color:#faf3e3}
      .as-nav-login::before{content:'';position:absolute;
        left:0;right:0;top:-7px;bottom:7px;border-radius:6px;
        background:#c2410c;border:1px solid #c2410c;z-index:0;
        transition:background .18s ease,border-color .18s ease,box-shadow .18s ease}
      .as-nav-login:hover::before{background:#9a3412;border-color:#9a3412;
        box-shadow:0 4px 12px rgba(154,52,18,0.22)}
      .as-nav-login:active::before{background:#7c2d12;border-color:#7c2d12;
        box-shadow:0 2px 6px rgba(124,45,18,0.25)}
      .as-nav-login:focus-visible{outline:none}
      .as-nav-login:focus-visible::before{box-shadow:0 0 0 3px rgba(194,65,12,0.30)}
      .as-nav-login > svg,.as-nav-login > span{position:relative;z-index:1}
      .as-nav-login svg{display:block;flex-shrink:0}
      /* === Logged-in user pill + dropdown === */
      .as-nav-user-wrap{position:relative;margin-left:16px;
        padding:0 0 14px;display:inline-flex;align-items:center;
        line-height:1;font-family:'Inter',sans-serif;font-size:13px}
      .as-nav-user{padding:6px 12px 6px 6px;border-radius:6px;
        background:transparent;border:1px solid rgba(58,36,24,0.20);
        color:#2a1a10;font-size:13px;
        font-weight:500;line-height:1;cursor:pointer;
        display:inline-flex;align-items:center;gap:8px;
        transition:border-color .2s,background .2s,color .2s}
      .as-nav-user:hover,.as-nav-user.on{border-color:#c2410c;
        background:rgba(254,215,170,0.30);color:#c2410c}
      .as-nav-user .av{width:22px;height:22px;border-radius:50%;
        background:linear-gradient(135deg,#fed7aa,#fb923c);color:#7c2d12;
        display:inline-flex;align-items:center;justify-content:center;
        font-weight:600;font-size:11px;line-height:1;
        border:1px solid rgba(194,65,12,0.30)}
      .as-nav-user .nm{max-width:130px;overflow:hidden;
        text-overflow:ellipsis;white-space:nowrap}
      .as-nav-user .cv{opacity:.55;transition:transform .2s}
      .as-nav-user.on .cv{transform:rotate(180deg)}

      .as-nav-dropdown{position:absolute;top:calc(100% + 8px);right:0;
        min-width:200px;background:#fdfcf8;
        border:1px solid rgba(58,36,24,0.18);border-radius:6px;
        box-shadow:0 16px 36px rgba(58,36,24,0.14);
        padding:6px;display:none;z-index:9001;
        font-family:'Inter',sans-serif}
      .as-nav-dropdown.on{display:block}
      .as-nav-dropdown::before{content:'';position:absolute;top:-5px;right:18px;
        width:8px;height:8px;background:#fdfcf8;
        border-left:1px solid rgba(58,36,24,0.18);
        border-top:1px solid rgba(58,36,24,0.18);
        transform:rotate(45deg)}
      .as-nav-dropdown .meta{padding:10px 12px 8px;
        font-family:'JetBrains Mono',monospace;font-size:10px;
        color:rgba(58,36,24,0.55);letter-spacing:.10em;
        text-transform:uppercase}
      .as-nav-dropdown .sep{height:1px;background:rgba(58,36,24,0.10);margin:4px 0}
      .as-nav-dropdown a,.as-nav-dropdown button{
        display:flex;align-items:center;gap:10px;width:100%;
        padding:9px 12px;border-radius:4px;text-decoration:none;
        color:#2a1a10;background:transparent;border:none;cursor:pointer;
        font-family:'Inter',sans-serif;font-size:13px;font-weight:500;
        text-align:left;line-height:1.2;letter-spacing:0;
        transition:background .15s,color .15s}
      .as-nav-dropdown a:hover,.as-nav-dropdown button:hover{
        background:rgba(254,215,170,0.30);color:#c2410c}
      .as-nav-dropdown svg{flex-shrink:0;opacity:.7}
      .as-nav-dropdown a:hover svg,.as-nav-dropdown button:hover svg{opacity:1}

      /* === Modal === */
      .as-modal-bd{position:fixed;inset:0;z-index:9000;background:rgba(42,26,16,0.55);
        backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;
        padding:20px;opacity:0;transition:opacity .2s ease;pointer-events:none}
      .as-modal-bd.on{opacity:1;pointer-events:auto}
      .as-modal{position:relative;width:100%;max-width:440px;background:#fdfcf8;
        border:1px solid rgba(58,36,24,0.18);border-radius:8px;padding:32px 30px;
        box-shadow:0 32px 80px rgba(58,36,24,0.25);
        font-family:'Inter',sans-serif;color:#2a1a10;
        transform:translateY(8px);transition:transform .25s ease}
      .as-modal-bd.on .as-modal{transform:translateY(0)}
      .as-modal::before,.as-modal::after{content:'';position:absolute;width:14px;height:14px;
        border:1.5px solid #c2410c;pointer-events:none}
      .as-modal::before{top:-1px;left:-1px;border-right:none;border-bottom:none}
      .as-modal::after{bottom:-1px;right:-1px;border-left:none;border-top:none}
      .as-eyebrow{font-family:'JetBrains Mono',monospace;font-size:11px;color:#c2410c;
        letter-spacing:.18em;text-transform:uppercase;margin:0 0 10px;display:flex;
        align-items:center;gap:10px}
      .as-eyebrow::before{content:'';width:14px;height:1px;background:#c2410c}
      .as-modal h3{font-family:'Newsreader',serif;font-weight:500;font-size:24px;
        letter-spacing:-0.01em;margin:0 0 8px}
      .as-modal h3 em{font-style:italic;color:#c2410c}
      .as-modal .sub{font-size:13px;color:#5a3d2a;margin:0 0 22px;line-height:1.55}

      /* OAuth grid */
      .as-oauth{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px}
      .as-oauth-btn{padding:11px 12px;border-radius:6px;background:#fdfcf8;
        border:1px solid rgba(58,36,24,0.20);color:#2a1a10;font-family:'Inter',sans-serif;
        font-size:13px;font-weight:500;cursor:pointer;transition:all .2s;
        display:inline-flex;align-items:center;justify-content:center;gap:8px}
      .as-oauth-btn:hover{border-color:#c2410c;background:rgba(254,215,170,0.30);color:#c2410c}
      .as-oauth-btn svg{flex-shrink:0}

      .as-wallet-btn{width:100%;padding:11px 14px;border-radius:6px;background:#fdfcf8;
        border:1px solid rgba(58,36,24,0.22);color:#2a1a10;font-family:'Inter',sans-serif;
        font-size:13px;font-weight:500;cursor:pointer;transition:all .2s;
        display:inline-flex;align-items:center;justify-content:center;gap:8px;
        margin-bottom:14px}
      .as-wallet-btn:hover{border-color:#c2410c;background:rgba(254,215,170,0.30);color:#c2410c}

      .as-divider{font-family:'JetBrains Mono',monospace;font-size:10px;
        color:rgba(58,36,24,0.45);text-align:center;margin:6px 0 14px;letter-spacing:.18em;
        text-transform:uppercase;display:flex;align-items:center;gap:10px}
      .as-divider::before,.as-divider::after{content:'';flex:1;height:1px;
        background:rgba(58,36,24,0.12)}

      .as-field{display:block;margin-bottom:12px}
      .as-field label{display:block;font-family:'JetBrains Mono',monospace;font-size:11px;
        font-weight:500;color:rgba(58,36,24,0.55);letter-spacing:.12em;
        text-transform:uppercase;margin-bottom:6px}
      .as-field input{width:100%;padding:12px 14px;border-radius:6px;
        border:1px solid rgba(58,36,24,0.18);background:#faf3e3;
        font-family:'Inter',sans-serif;font-size:14px;color:#2a1a10;outline:none;
        transition:border-color .2s,background .2s,box-shadow .2s;box-sizing:border-box}
      .as-field input:focus{border-color:#c2410c;background:#fffaee;
        box-shadow:0 0 0 3px rgba(194,65,12,0.10)}
      .as-btn-primary{width:100%;padding:12px 16px;background:#c2410c;color:#faf3e3;
        border:none;border-radius:6px;font-family:'Inter',sans-serif;font-size:14px;
        font-weight:600;letter-spacing:0;cursor:pointer;transition:background .2s,
        box-shadow .2s;display:inline-flex;align-items:center;justify-content:center;gap:8px}
      .as-btn-primary:hover{background:#9a3412;box-shadow:0 6px 16px rgba(154,52,18,0.30)}
      .as-close{position:absolute;top:14px;right:14px;width:28px;height:28px;
        border-radius:50%;background:transparent;border:none;color:rgba(58,36,24,0.55);
        cursor:pointer;display:flex;align-items:center;justify-content:center;
        transition:color .2s,background .2s}
      .as-close:hover{color:#c2410c;background:rgba(254,215,170,0.30)}
      .as-foot{margin-top:14px;font-family:'JetBrains Mono',monospace;font-size:10px;
        color:rgba(58,36,24,0.45);letter-spacing:.06em;text-align:center}
    `;
    const style = document.createElement('style');
    style.id = 'as-stub-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ---------- modal ----------
  let modalEl = null;

  function ensureModal() {
    if (modalEl) return modalEl;
    ensureStyles();
    const wrap = document.createElement('div');
    wrap.className = 'as-modal-bd';
    wrap.innerHTML = `
      <div class="as-modal" role="dialog" aria-modal="true">
        <button class="as-close" aria-label="Close">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
        <div class="as-eyebrow">Sign in</div>
        <h3>Welcome to <em>AuraSci</em></h3>
        <p class="sub">Pick how you'd like to continue. We'll never post on your behalf.</p>

        <div class="as-oauth">
          <button class="as-oauth-btn" data-as="google" title="Sign in with Google email">
            <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"/>
              <path fill="#FF3D00" d="m6.306 14.691 6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"/>
              <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"/>
              <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"/>
            </svg>
            Google
          </button>
          <button class="as-oauth-btn" data-as="twitter" title="Sign in with X handle">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
            </svg>
            X
          </button>
        </div>

        <button class="as-wallet-btn" data-as="wallet">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="6" width="20" height="14" rx="2"/>
            <path d="M16 14a2 2 0 1 1 0-4h6"/>
          </svg>
          Connect wallet
        </button>

        <div class="as-divider">or with email</div>

        <form class="as-form" novalidate>
          <div class="as-field">
            <label>Email</label>
            <input type="email" placeholder="patron@example.com" autocomplete="email" required />
          </div>
          <button type="submit" class="as-btn-primary">
            Continue
            <span style="font-family:'JetBrains Mono',monospace">↗</span>
          </button>
        </form>

        <div class="as-foot">Demo flow — any choice signs you in. State persists in localStorage.</div>
      </div>
    `;
    document.body.appendChild(wrap);

    wrap.addEventListener('click', function (e) {
      if (e.target === wrap) closeModal();
    });
    wrap.querySelector('.as-close').addEventListener('click', closeModal);
    wrap.querySelector('.as-form').addEventListener('submit', function (e) {
      e.preventDefault();
      const v = wrap.querySelector('input[type="email"]').value.trim();
      doLogin('email', v || 'patron@aurasci.io');
    });
    wrap.querySelector('[data-as="google"]').addEventListener('click', function () {
      var email = prompt('Sign in with Google\n\nEnter your Gmail address:', '');
      if (!email) return;
      email = email.trim();
      // Basic format check — at least one @ with text on both sides
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        alert('That doesn’t look like a valid email address.');
        return;
      }
      doLogin('google', email);
    });
    wrap.querySelector('[data-as="twitter"]').addEventListener('click', function () {
      var handle = prompt('Sign in with X\n\nEnter your X (Twitter) handle (e.g. @yourname):', '@');
      if (!handle) return;
      handle = handle.trim();
      if (handle.charAt(0) !== '@') handle = '@' + handle;
      if (!/^@[A-Za-z0-9_]{1,15}$/.test(handle)) {
        alert('That doesn’t look like a valid X handle.');
        return;
      }
      doLogin('twitter', handle);
    });
    wrap.querySelector('[data-as="wallet"]').addEventListener('click', function () {
      doLogin('wallet', '0xA1f2…91Be');
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && wrap.classList.contains('on')) closeModal();
    });
    modalEl = wrap;
    return wrap;
  }

  // ─── React auth wire-up ────────────────────────────────────────────
  // The fake 4-option modal below (Google / X / Wallet / Email) is now
  // dead code — kept around because its CSS + DOM structure was leaving
  // legacy hooks for other scripts. Instead of opening it, every call site
  // hands off to the React app at /market, which carries the real wallet
  // SignInModal. The `?signin=open` query param tells the React page to
  // pop the modal automatically on mount.
  //
  // Any in-flight destination (set by interceptPatronLinks) is preserved
  // via sessionStorage so the React app can resume after sign-in.
  function openModal() {
    try {
      var dest = sessionStorage.getItem('aurasci_post_login');
      if (dest) {
        // Encode the post-login destination as a path the React app will land on
        // after sign-in completes. Strip leading slash so it's relative.
        sessionStorage.setItem('aurasci_post_login', dest);
      }
    } catch (_) {}
    window.location.href = '/market?signin=open';
  }
  function closeModal() {
    if (modalEl) modalEl.classList.remove('on');
  }

  function doLogin(method, handle) {
    localStorage.setItem(KEY, '1');
    if (method) localStorage.setItem('aurasci_auth_method', method);
    if (handle) localStorage.setItem('aurasci_handle', handle);
    closeModal();
    applyAuthState();
    const target = sessionStorage.getItem('aurasci_post_login');
    if (target) {
      sessionStorage.removeItem('aurasci_post_login');
      window.location.href = target;
    }
  }

  function doLogout() {
    localStorage.removeItem(KEY);
    localStorage.removeItem('aurasci_handle');
    localStorage.removeItem('aurasci_auth_method');
    applyAuthState();
    // The React app owns the session token, which we can't touch from this
    // static page. Hand off to /logout (a React route) which calls
    // the React logout flow and bounces back to "/".
    window.location.href = '/logout';
  }

  // ---------- helpers: pretty user name from stored handle ----------
  function getDisplayName() {
    var h = localStorage.getItem('aurasci_handle') || '';
    if (!h) return 'Account';
    if (h.indexOf('@') === 0) return h;                     // twitter @handle
    if (/^0x[0-9a-fA-F]/.test(h)) return h;                 // wallet 0x…
    if (h.indexOf('@') > 0) return h.split('@')[0];         // email → local part
    return h;
  }
  function getInitial() {
    var n = getDisplayName().replace(/^@/, '').replace(/^0x/, '');
    return (n[0] || 'A').toUpperCase();
  }
  // Mirror src/components/Nav.tsx `sessionDisplayName().source` so the dropdown
  // meta line ("Signed in via X") reads identically on the static landing
  // page and inside the React app.
  function getSourceLabel() {
    switch ((localStorage.getItem('aurasci_auth_method') || '').toLowerCase()) {
      case 'email':   return 'Email';
      case 'google':  return 'Google';
      case 'twitter': case 'x': return 'X';
      case 'wallet':  return 'Wallet';
      default:        return '—';
    }
  }

  // ---------- nav state ----------
  function applyAuthState() {
    ensureStyles();
    const authed = isAuthed();

    // Clean up legacy login twins
    document.querySelectorAll('.as-login-link').forEach(function (n) { n.remove(); });

    // Always hide the original Portfolio link in the nav (logged-in users
    // reach it via the user-menu instead). Direct `> a` only — otherwise
    // we'd also hide the Portfolio entry we put inside our own dropdown.
    document.querySelectorAll(
      '.bnav .links > a[href="dashboard-patron.html"], nav .links > a[href="dashboard-patron.html"]'
    ).forEach(function (a) {
      if (a.style.display !== 'none') a.style.display = 'none';
    });

    // For each top-nav links group, render either the Login button or the
    // user pill (with dropdown) at the far-right slot.
    document.querySelectorAll('.bnav .links, nav .links').forEach(function (linksGroup) {
      // Tear down whichever element doesn't match the desired state
      var existingLogin = linksGroup.querySelector('.as-nav-login');
      var existingUser  = linksGroup.querySelector('.as-nav-user-wrap');
      if (authed && existingLogin) existingLogin.remove();
      if (!authed && existingUser) existingUser.remove();

      if (!authed) {
        // ---- Login button ----
        var btn = linksGroup.querySelector('.as-nav-login');
        if (!btn) {
          btn = document.createElement('a');
          btn.className = 'as-nav-login';
          btn.href = 'javascript:void(0)';
          btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg><span>Login</span>';
          btn.addEventListener('click', function (e) { e.preventDefault(); openModal(); });
          linksGroup.appendChild(btn);
        }
      } else {
        // ---- User pill + dropdown ----
        var wrap = linksGroup.querySelector('.as-nav-user-wrap');
        var name = getDisplayName();
        var initial = getInitial();
        if (!wrap) {
          wrap = document.createElement('div');
          wrap.className = 'as-nav-user-wrap';
          wrap.innerHTML =
            '<button type="button" class="as-nav-user">' +
              '<span class="av"></span>' +
              '<span class="nm"></span>' +
              '<svg class="cv" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>' +
            '</button>' +
            '<div class="as-nav-dropdown" role="menu">' +
              '<div class="meta"></div>' +
              '<a href="/portfolio" data-act="portfolio">' +
                '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><path d="M8 21h8M12 17v4"/></svg>' +
                '<span>Portfolio</span>' +
              '</a>' +
              // The wallet panel lives in the React app — link there with a
              // query flag that Nav.tsx reads to auto-open the WalletPanel.
              '<a href="/market?wallet=1" data-act="wallet">' +
                '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12V8H4a2 2 0 0 1 0-4h12v4"/><path d="M4 6v14a2 2 0 0 0 2 2h14V6"/><circle cx="16" cy="14" r="1.5"/></svg>' +
                '<span>Wallet</span>' +
              '</a>' +
              '<div class="sep"></div>' +
              '<button type="button" data-act="logout">' +
                '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>' +
                '<span>Logout</span>' +
              '</button>' +
            '</div>';
          linksGroup.appendChild(wrap);

          var trigger = wrap.querySelector('.as-nav-user');
          var menu = wrap.querySelector('.as-nav-dropdown');
          trigger.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            var on = menu.classList.toggle('on');
            trigger.classList.toggle('on', on);
          });
          // Close on outside click
          document.addEventListener('click', function (e) {
            if (!wrap.contains(e.target)) {
              menu.classList.remove('on');
              trigger.classList.remove('on');
            }
          });
          // Close on Escape
          document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
              menu.classList.remove('on');
              trigger.classList.remove('on');
            }
          });
          // Logout handler
          wrap.querySelector('[data-act="logout"]').addEventListener('click', function (e) {
            e.preventDefault();
            menu.classList.remove('on');
            trigger.classList.remove('on');
            doLogout();
          });
        }
        // Refresh dynamic content — only write when changed, otherwise the
        // childList mutation re-triggers our MutationObserver and we loop.
        var avEl = wrap.querySelector('.av');
        var nmEl = wrap.querySelector('.nm');
        var mtEl = wrap.querySelector('.meta');
        var metaText = 'Signed in via ' + getSourceLabel();
        if (avEl.textContent !== initial)  avEl.textContent = initial;
        if (nmEl.textContent !== name)     nmEl.textContent = name;
        if (mtEl.textContent !== metaText) mtEl.textContent = metaText;
      }
    });
  }

  // ---------- intercept patron-route clicks while logged out ----------
  let interceptInstalled = false;
  function interceptPatronLinks() {
    if (interceptInstalled) return;
    interceptInstalled = true;
    document.addEventListener('click', function (e) {
      // Landing-page CTAs ("Verify as a scientist", "Browse the market",
      // "Start publishing →", "Explore market →") — when the user lands on
      // the static index page and clicks any of these 4 entry buttons
      // without a session, gate the click behind the sign-in modal. They
      // resume to the original destination on success via the same
      // sessionStorage handoff as the dashboard-patron path below.
      var path = window.location.pathname;
      var isLanding = path === '/' || path === '/index.html' || path === '/landing.html';
      if (isLanding && !isAuthed()) {
        // Match any <a> whose href points to a landing CTA destination.
        // Restrict to links inside hero/role-card containers so the top
        // nav links (Market / Leaderboard / etc.) stay browsable without
        // a login.
        var landingCta = e.target.closest(
          'a[href$="onboarding-scientist.html"],'
          + 'a[href$="market.html"],'
          + 'a[href$="dashboard-scientist.html"],'
          + 'a[href$="dashboard-patron.html"]'
        );
        if (landingCta) {
          var inNav = !!landingCta.closest('nav, .bnav, .nav, header nav');
          if (!inNav) {
            e.preventDefault();
            e.stopPropagation();
            sessionStorage.setItem('aurasci_post_login', landingCta.getAttribute('href'));
            openModal();
            return;
          }
        }
      }

      // Patron dashboard / portfolio links — keep gating these behind login.
      const a = e.target.closest('a[href$="dashboard-patron.html"], a[href*="dashboard-patron.html?"]');
      if (a && !isAuthed()) {
        // EXCEPTION: the home-page "I'm a patron" role-picker card is also
        // an <a href="dashboard-patron.html">, but conceptually it's the
        // PUBLIC entry into the patron flow — it should land on the Market
        // browse page, NOT prompt for login. Login is only required when
        // the user actually tries to fund or boost something.
        if (a.closest('.role-card, .entry-card, [data-role="patron"]')) {
          e.preventDefault();
          window.location.href = 'market.html';
          return;
        }
        e.preventDefault();
        sessionStorage.setItem('aurasci_post_login', a.getAttribute('href'));
        openModal();
        return;
      }
      // Funding / Boost actions on intent-detail (and anywhere else they
      // appear). Browsing the Market and reading an intent is fully open;
      // we only ask the user to sign in at the moment money or aura is
      // actually committed.
      //  · `.fund-cta`            → "Fund this research" CTA
      //  · `.heat-cta button`     → "Boost ↑" button on intent-detail
      //  · `[data-requires-auth]` → opt-in escape hatch for future surfaces
      const actionable = e.target.closest(
        '.fund-cta, .heat-cta button, [data-requires-auth]'
      );
      if (actionable && !isAuthed()) {
        e.preventDefault();
        e.stopPropagation();
        // Resume on the same page after login.
        sessionStorage.setItem('aurasci_post_login', window.location.href);
        openModal();
      }
    }, true); // capture-phase so we win against page-level handlers
  }

  // ---------- expose ----------
  window.AuraSciAuth = {
    isAuthed: isAuthed,
    login: doLogin,
    logout: doLogout,
    open: openModal
  };

  // rAF-coalesced apply so a burst of DOM mutations (the bundled landing
  // continuously animates the hero, etc.) only triggers one applyAuthState
  // per frame. Without this, applyAuthState's own DOM writes feed the
  // observer recursively and pin the main thread.
  var applyPending = false;
  function scheduleApply() {
    if (applyPending) return;
    applyPending = true;
    (window.requestAnimationFrame || function (cb) { return setTimeout(cb, 16); })(
      function () { applyPending = false; applyAuthState(); }
    );
  }

  function bootstrap() {
    applyAuthState();
    interceptPatronLinks();
    // The bundled landing swaps the entire <html> via
    // documentElement.replaceWith(...) on DOMContentLoaded, which detaches
    // any observer on <body>. Observe `document` (survives the swap) but
    // only watch childList (NOT attributes / characterData), and only for
    // 8 seconds — long enough for the bundle to render, short enough that
    // we don't keep reacting to every animation frame for the page lifetime.
    if ('MutationObserver' in window) {
      var obs = new MutationObserver(scheduleApply);
      obs.observe(document, { childList: true, subtree: true });
      setTimeout(function () { obs.disconnect(); }, 8000);
    }
    [50, 200, 600, 1500, 3000, 6000].forEach(function (ms) {
      setTimeout(applyAuthState, ms);
    });
  }

  // ---------- nav scroll-state ----------
  // Toggle a `.scrolled` class on every <nav> once the user scrolls past
  // a small threshold. CSS above keeps the nav transparent at the top of
  // the page and switches to the opaque/blurred look when scrolled.
  function initNavScroll() {
    var THRESHOLD = 8;
    function update() {
      var on = (window.scrollY || window.pageYOffset || 0) > THRESHOLD;
      var navs = document.querySelectorAll('nav');
      for (var i = 0; i < navs.length; i++) {
        navs[i].classList.toggle('scrolled', on);
      }
    }
    var ticking = false;
    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(function () { update(); ticking = false; });
    }, { passive: true });
    update();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      bootstrap();
      initNavScroll();
    });
  } else {
    bootstrap();
    initNavScroll();
  }
})();

/* AuraSci · Partner / collaborator strip
 * ---------------------------------------------------------------
 * Renders a thin, horizontally-scrolling band of research partners
 * just below the hero on the home page (and below the entry grid
 * on the standalone landing page).
 *
 * Logos are rendered as text wordmarks in a serif face so we don't
 * have to ship — and license — institutional logo art. The mark
 * dot in front of each name acts as a small visual anchor.
 */
(function () {
  if (window.__asPartnersInstalled) return;
  window.__asPartnersInstalled = true;

  // ---- partner list ----
  // Order roughly mirrors what the user asked for: Hetu first (named
  // tech partner), then the academic affiliates referenced from the
  // Advaita first-screen lineup. Logos are stored locally under
  // public/images/partners/ so we don't depend on third-party hosts.
  var PARTNERS = [
    { name: 'Hetu',                          tag: 'Tech partner', src: 'images/partners/hetu.svg',      h: 30 },
    { name: 'Stanford University',           tag: 'Research',     src: 'images/partners/stanford.png',  h: 38 },
    { name: 'University of Washington',      tag: 'Research',     src: 'images/partners/washington.png',h: 38 },
    { name: "Brigham and Women's Hospital",  tag: 'Clinical',     src: 'images/partners/brigham.png',   h: 38 },
    { name: 'Princeton University',          tag: 'Research',     src: 'images/partners/princeton.png', h: 38 },
    { name: 'University of Cambridge',       tag: 'Research',     src: 'images/partners/cambridge.png', h: 38 },
    { name: 'McGill University',             tag: 'Research',     src: 'images/partners/mcgill.png',    h: 38 }
  ];

  // ---- styles ----
  function ensureStyles() {
    if (document.getElementById('as-partners-styles')) return;
    var css = [
      /* Hide the breathing "scroll" cue under the hero — the partner
         strip now lives in that space, and we don't want competing
         signals at the bottom of the first viewport. */
      '.scroll-cue{display:none !important}',

      /* Scale up the rotating hero bust. The Three.js scene fills its
         canvas, so a CSS transform on the canvas itself enlarges the
         figure without re-rendering. transform-origin keeps the head
         centered roughly where the radial mask is anchored (50% 42%). */
      '.bust canvas{transform:scale(1.28);transform-origin:50% 42%}',
      '@media (max-width:720px){',
      '  .bust canvas{transform:scale(1.18)}',
      '}',

      /* Default-clear face area: the bundled CSS already clears the face
         on the static layer, but the cursor-tracked layer re-blurs it
         until the mouse is over it. Give the cursor layer an additional
         permanent hole around the face (50% 38%) so the area behind the
         "Open Science" headline is sharp by default. Two mask layers
         combined with mask-composite:intersect — a pixel is clear if
         EITHER hole is open there. The cursor hole still acts as an
         extra reveal that follows the mouse anywhere else. */
      '.bust-blur{',
      '  -webkit-mask-image:',
      '    radial-gradient(ellipse 360px 400px at 50% 38%,',
      '      transparent 0%, rgba(0,0,0,0.35) 60%, #000 100%),',
      '    radial-gradient(circle 240px at var(--bx,50%) var(--by,42%),',
      '      transparent 0%, rgba(0,0,0,0.65) 70%, #000 100%);',
      '  mask-image:',
      '    radial-gradient(ellipse 360px 400px at 50% 38%,',
      '      transparent 0%, rgba(0,0,0,0.35) 60%, #000 100%),',
      '    radial-gradient(circle 240px at var(--bx,50%) var(--by,42%),',
      '      transparent 0%, rgba(0,0,0,0.65) 70%, #000 100%);',
      '  -webkit-mask-composite:source-in;', /* Safari legacy */
      '  mask-composite:intersect;',          /* spec: alpha = min of layers */
      '}',

      '.as-partners{position:relative;width:100%;padding:28px 0 30px;',
      '  background:transparent;overflow:hidden;',
      '  /* Mask the edges so logos flow in/out without a coloured fade.',
      '     Using mask-image keeps it transparent over any background. */',
      '  -webkit-mask-image:linear-gradient(to right,transparent 0,',
      '    #000 9%,#000 91%,transparent 100%);',
      '  mask-image:linear-gradient(to right,transparent 0,',
      '    #000 9%,#000 91%,transparent 100%)}',
      /* Overlay variant: pin to the bottom of the hero so it shows in
         the first viewport instead of being pushed below the fold. */
      '.as-partners.as-partners--overlay{position:absolute;left:0;right:0;',
      '  bottom:0;z-index:5;padding:18px 0 22px;',
      '  background:linear-gradient(to top,rgba(244,237,226,0.85),rgba(244,237,226,0));',
      '  pointer-events:auto}',
      '.as-partners-eyebrow{display:flex;align-items:center;justify-content:center;',
      '  gap:14px;margin-bottom:16px;',
      '  font-family:"JetBrains Mono",ui-monospace,monospace;',
      '  font-size:10.5px;letter-spacing:.22em;text-transform:uppercase;',
      '  color:rgba(58,36,24,0.55)}',
      '.as-partners-eyebrow::before,.as-partners-eyebrow::after{',
      '  content:"";display:block;width:32px;height:1px;',
      '  background:rgba(58,36,24,0.20)}',
      '.as-partners-eyebrow b{color:#c2410c;font-weight:600;letter-spacing:.20em}',

      /* Marquee: two identical tracks side-by-side, both translated by
         -50% over the same period — the effect is a seamless loop. */
      '.as-partners-track{display:flex;width:max-content;',
      '  animation:asPartnersScroll 38s linear infinite;will-change:transform}',
      '.as-partners:hover .as-partners-track{animation-play-state:paused}',
      '.as-partners-row{display:flex;align-items:center;flex-shrink:0}',
      '@keyframes asPartnersScroll{',
      '  from{transform:translateX(0)}',
      '  to{transform:translateX(-50%)}}',

      /* Each partner: real logo image. The source PNGs/SVGs are white
         marks designed for a dark background, so we invert them to read
         on the cream page bg, then ease them back to neutral on hover. */
      '.as-partner{display:inline-flex;align-items:center;gap:10px;',
      '  padding:0 32px;color:rgba(58,36,24,0.62);',
      '  white-space:nowrap;line-height:1;',
      '  transition:color .25s ease}',
      '.as-partner:hover{color:#2a1a10}',
      '.as-partner .lg{height:32px;width:auto;max-width:180px;display:block;',
      '  object-fit:contain;',
      '  filter:invert(1) brightness(0.35) contrast(1.1);',
      '  opacity:.78;transition:filter .3s ease,opacity .3s ease,transform .3s ease}',
      '.as-partner:hover .lg{filter:invert(1) brightness(0.15) contrast(1.15);',
      '  opacity:1;transform:scale(1.04)}',
      '.as-partner .tg{display:none}',

      '@media (max-width:720px){',
      '  .as-partners{padding:22px 0 26px}',
      '  .as-partners.as-partners--overlay{padding:14px 0 16px}',
      '  .as-partner{padding:0 20px;gap:8px}',
      '  .as-partner .lg{height:26px;max-width:140px}',
      '  .as-partner .tg{display:none}',
      '}',

      /* Honor reduced motion: stop the loop, fall back to a centered row. */
      '@media (prefers-reduced-motion:reduce){',
      '  .as-partners-track{animation:none;width:100%;justify-content:center;',
      '    flex-wrap:wrap;gap:18px}',
      '  .as-partners-row:nth-child(2){display:none}',
      '}'
    ].join('\n');
    var s = document.createElement('style');
    s.id = 'as-partners-styles';
    s.textContent = css;
    document.head.appendChild(s);
  }

  // ---- DOM ----
  function buildRow() {
    var row = document.createElement('div');
    row.className = 'as-partners-row';
    row.setAttribute('aria-hidden', 'false');
    PARTNERS.forEach(function (p) {
      var item = document.createElement('span');
      item.className = 'as-partner';
      var h = p.h || 38;
      item.innerHTML =
        '<img class="lg" src="' + p.src + '" alt="' + p.name + '" ' +
          'loading="lazy" decoding="async" ' +
          'style="height:' + h + 'px">' +
        '<span class="tg">' + p.tag + '</span>';
      row.appendChild(item);
    });
    return row;
  }

  function buildStrip() {
    var wrap = document.createElement('section');
    wrap.className = 'as-partners';
    wrap.setAttribute('aria-label', 'Research partners and collaborators');
    wrap.innerHTML =
      '<div class="as-partners-eyebrow">' +
        '<span>Backed by <b>Advaita Labs</b> · in collaboration with</span>' +
      '</div>';
    var track = document.createElement('div');
    track.className = 'as-partners-track';
    // Two identical rows for seamless infinite scroll.
    track.appendChild(buildRow());
    track.appendChild(buildRow());
    wrap.appendChild(track);
    return wrap;
  }

  // ---- insertion ----
  // We try a few likely anchors in priority order:
  //   1. `.hero` — pin the strip to the BOTTOM of the hero with absolute
  //       positioning so it shows in the first viewport on the bundled
  //       /index.html (where the hero is full-height).
  //   2. `.entry-grid` — landing.html: drop the strip right after the
  //       Scientist / Patron card grid.
  //   3. `.role-pick` — fallback: insert before the role picker section.
  function insert() {
    if (document.querySelector('.as-partners')) return true;

    // 1) Hero overlay (preferred — keeps partners on screen 1, matching
    //    the original landing-page layout).
    var hero = document.querySelector('.hero, section.hero');
    if (hero) {
      var cs = getComputedStyle(hero);
      if (cs.position === 'static') hero.style.position = 'relative';
      var strip = buildStrip();
      strip.classList.add('as-partners--overlay');
      hero.appendChild(strip);
      return true;
    }

    // 2) Landing page entry grid
    var entryGrid = document.querySelector('.entry-grid');
    if (entryGrid && entryGrid.parentNode) {
      var strip2 = buildStrip();
      if (entryGrid.nextSibling) {
        entryGrid.parentNode.insertBefore(strip2, entryGrid.nextSibling);
      } else {
        entryGrid.parentNode.appendChild(strip2);
      }
      return true;
    }

    // 3) Fallback — before the role picker
    var rolePick = document.querySelector('.role-pick');
    if (rolePick && rolePick.parentNode) {
      var strip3 = buildStrip();
      rolePick.parentNode.insertBefore(strip3, rolePick);
      return true;
    }
    return false;
  }

  function upgradeLeaderboardNav() {
    document.querySelectorAll('nav .links span.muted, .bnav .links span.muted, .nav-link.muted, span.muted')
      .forEach(function (s) {
        var t = (s.textContent || '').trim();
        if (t === 'Leaderboard') {
          var a = document.createElement('a');
          a.href = 'leaderboard.html';
          var cls = (s.className || '').replace(/\bmuted\b/, '').trim();
          if (cls) a.className = cls;
          a.textContent = 'Leaderboard';
          s.replaceWith(a);
        }
      });
  }

  function boot() {
    ensureStyles();
    upgradeLeaderboardNav();

    if (insert()) return;

    // The bundled home page swaps DOM after JS runs, so retry briefly
    // until one of our anchors appears. Mirrors auth-stub's pattern.
    var tries = 0;
    var iv = setInterval(function () {
      tries++;
      upgradeLeaderboardNav();
      if (insert() || tries > 60) clearInterval(iv);
    }, 120);

    if ('MutationObserver' in window) {
      var obs = new MutationObserver(function () {
        upgradeLeaderboardNav();
        if (insert()) obs.disconnect();
      });
      obs.observe(document, { childList: true, subtree: true });
      setTimeout(function () { obs.disconnect(); }, 10000);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

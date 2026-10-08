/*!
 * frame-fit.js: fits the first two screens of the homepage to the window (desktop).
 *
 * 1. Page scale. Header, main and footer get one zoom factor, the largest (85% to 160%)
 *    at which the header plus the hero, at its natural height, fill the window.
 *    Everything keeps its proportions and every left edge still lines up.
 * 2. Frames. The hero fills the first screen (content centred). The studios strip,
 *    My Experience and the games strip share the second screen: their top and bottom
 *    padding stretches or tightens by the same proportion until the three fill it.
 *    If they cannot fit even with tight padding, the strips stay outside and
 *    My Experience is framed on its own.
 * 3. Short windows. The hero card shrinks as a picture and the headline steps down
 *    until the hero copy fits; My Experience gives up padding.
 * 4. Magnetic scroll. Inside the two screens one wheel gesture or key press moves one
 *    whole screen (Lenis). Momentum after a move is ignored until the wheel goes quiet.
 *    Below the second screen scrolling is free.
 *
 * Off: below 901px wide or 560px tall, on touch-only devices for the magnetic part,
 * with prefers-reduced-motion for the magnetic part, and with ?fit=off.
 * Announces every layout pass with a 'framefit' event; window.__frameFit.k is the page scale.
 * Prototype: Framing lab artifact (claude.ai), 2026-10-08.
 */
(function () {
  'use strict';
  if (new URLSearchParams(location.search).get('fit') === 'off') return;
  var root = document.documentElement;
  var $ = function (s) { return document.querySelector(s); };

  var C = {
    minW: 901, minH: 560,
    kMin: 0.85, kMax: 1.6,              // page scale range
    padMin: 0.15, padMax: 2.5,          // second screen: padding range, as a share of the natural padding
    eMax: 1.3,                          // My Experience alone: largest growth of its content
    cardMin: 0.6,                       // short windows: smallest hero card scale
    headMin: 40,                        // short windows: smallest headline size (px)
    expPadMin: 24,                      // short windows: least My Experience padding (px, both together)
    magDur: 0.9, magQuiet: 160          // magnetic move duration (s), pause before the next move (ms)
  };

  var header = $('#site-header'), main = $('main'), footer = $('.site-footer');
  var hero = $('.hero'), heroLeft = $('.hero-left'), deck = $('.hero-deck'), h1 = $('.hero-h1');
  var studios = $('.marquee:not(.marquee--games)'), games = $('.marquee--games');
  var exp = $('#consultancy'), aboutGrid = exp && exp.querySelector('.about-grid'), aboutPhoto = exp && exp.querySelector('.about-photo');
  if (!header || !main || !hero || !heroLeft || !deck || !h1 || !studios || !exp || !aboutGrid) return;
  var zoomed = [header, main, footer].filter(Boolean);

  var K = 1, state = { on: false, pair: false };
  var vis = function (el) { return el ? el.getBoundingClientRect().height : 0; };
  var px = function (n) { return n.toFixed(1) + 'px'; };

  function setK(k) { K = k; zoomed.forEach(function (el) { el.style.zoom = k === 1 ? '' : String(k); }); }

  function clearInline() {
    deck.style.transform = ''; deck.style.marginTop = ''; deck.style.transformOrigin = '';
    h1.style.fontSize = '';
    hero.style.minHeight = ''; exp.style.minHeight = '';
    exp.style.paddingTop = ''; exp.style.paddingBottom = '';
    studios.style.paddingTop = ''; studios.style.paddingBottom = '';
    if (games) { games.style.paddingTop = ''; games.style.paddingBottom = ''; }
    aboutGrid.style.zoom = '';
    if (aboutPhoto) aboutPhoto.style.maxWidth = '';
  }

  // Page scale: the largest K at which header + hero (natural height) fit the window.
  function findK(vh) {
    function fits(z) {
      setK(z);
      root.classList.add('frame-measure');
      var need = vis(header) + vis(hero);
      root.classList.remove('frame-measure');
      return need <= vh + 0.5;
    }
    if (fits(C.kMax)) return C.kMax;
    if (!fits(C.kMin)) return C.kMin;
    var lo = C.kMin, hi = C.kMax;
    for (var i = 0; i < 12; i++) { var mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid; }
    return Math.floor(lo * 1000) / 1000;
  }

  function natural() {
    root.classList.add('frame-measure');
    var hcs = getComputedStyle(hero);
    var N = {
      pads: parseFloat(hcs.paddingTop) + parseFloat(hcs.paddingBottom),
      leftH: heroLeft.offsetHeight, cardH: deck.offsetHeight
    };
    // The photo is never taller than the text beside it, so My Experience is as short as its copy.
    if (aboutPhoto && aboutGrid.children.length > 1) {
      var textH = aboutGrid.children[0].offsetHeight, ph = aboutPhoto.offsetHeight;
      if (ph > textH + 1) aboutPhoto.style.maxWidth = Math.floor(aboutPhoto.offsetWidth * textH / ph) + 'px';
    }
    var ecs = getComputedStyle(exp), scs = getComputedStyle(studios), gcs = games ? getComputedStyle(games) : null;
    N.expH = exp.offsetHeight; N.expPadT = parseFloat(ecs.paddingTop); N.expPadB = parseFloat(ecs.paddingBottom);
    N.stH = studios.offsetHeight; N.stPadT = parseFloat(scs.paddingTop); N.stPadB = parseFloat(scs.paddingBottom);
    N.gaH = games ? games.offsetHeight : 0; N.gaPadT = gcs ? parseFloat(gcs.paddingTop) : 0; N.gaPadB = gcs ? parseFloat(gcs.paddingBottom) : 0;
    root.classList.remove('frame-measure');
    return N;
  }

  function apply() {
    root.classList.remove('frame-fit', 'frame-pair');
    clearInline(); setK(1);
    var vw = root.clientWidth, vh = innerHeight;
    var on = vw >= C.minW && vh >= C.minH;
    state = { on: on, pair: false };
    if (!on) { root.style.scrollPaddingTop = ''; window.__frameFit = { k: 1, on: false }; dispatchEvent(new Event('framefit')); return; }

    setK(findK(vh));
    var hdr = header.offsetHeight;                 // page units (on screen: x K)
    var avail = vh / K - hdr;
    var N = natural();
    root.classList.add('frame-fit');

    // Second screen: studios + My Experience + games together, when they fit with tight padding.
    var pads = N.stPadT + N.stPadB + N.expPadT + N.expPadB + N.gaPadT + N.gaPadB;
    var content = N.stH + N.expH + N.gaH - pads;
    var pair = content + pads * C.padMin <= avail;
    state.pair = pair;
    root.classList.toggle('frame-pair', pair);

    // Hero: the headline steps down, then the card shrinks, until the hero fits its frame.
    var heroFrame = avail;
    if (N.leftH + N.pads > heroFrame) {
      root.classList.add('frame-measure');
      var fs = parseFloat(getComputedStyle(h1).fontSize), leftH = N.leftH;
      for (var i = 0; i < 6 && leftH + N.pads > heroFrame && fs > C.headMin; i++) {
        var h1H = h1.offsetHeight, excess = leftH + N.pads - heroFrame;
        fs = Math.max(C.headMin, fs * Math.max(0.6, (h1H - excess) / h1H) - 0.5);
        h1.style.fontSize = px(fs); leftH = heroLeft.offsetHeight;
      }
      root.classList.remove('frame-measure');
    }
    var cardK = Math.max(C.cardMin, Math.min(1, (heroFrame - N.pads) / N.cardH));
    if (cardK < 1) {
      // Scaled as a picture (no reflow), and the space it no longer uses is given back.
      deck.style.transformOrigin = '50% 100%';
      deck.style.transform = 'scale(' + cardK.toFixed(4) + ')';
      deck.style.marginTop = px(-(1 - cardK) * N.cardH);
    }
    hero.style.minHeight = px(heroFrame);

    var expFrame = avail;
    if (pair) {
      var f = Math.max(C.padMin, Math.min(C.padMax, (avail - content) / pads));
      studios.style.paddingTop = px(N.stPadT * f); studios.style.paddingBottom = px(N.stPadB * f);
      exp.style.paddingTop = px(N.expPadT * f); exp.style.paddingBottom = px(N.expPadB * f);
      if (games) { games.style.paddingTop = px(N.gaPadT * f); games.style.paddingBottom = px(N.gaPadB * f); }
      expFrame = avail - studios.offsetHeight - (games ? games.offsetHeight : 0);
    } else {
      var expPads = N.expPadT + N.expPadB, need = N.expH;
      if (need < expFrame) {
        var fitsE = function (z) { aboutGrid.style.zoom = z; return expPads + vis(aboutGrid) / K <= expFrame; };
        var e = 1;
        if (fitsE(C.eMax)) e = C.eMax;
        else { var lo = 1, hi = C.eMax; for (var j = 0; j < 10; j++) { var m = (lo + hi) / 2; if (fitsE(m)) lo = m; else hi = m; } e = lo; }
        aboutGrid.style.zoom = e > 1.001 ? String(Math.floor(e * 1000) / 1000) : '';
      } else if (need > expFrame) {
        var keep = Math.max(C.expPadMin, expPads - (need - expFrame)), kk = keep / expPads;
        exp.style.paddingTop = px(N.expPadT * kk); exp.style.paddingBottom = px(N.expPadB * kk);
      }
    }
    exp.style.minHeight = px(expFrame);
    // Anchor jumps (nav links, Lenis anchors) stop under the scaled header.
    root.style.scrollPaddingTop = vis(header) + 'px';
    window.__frameFit = { k: K, on: true, pair: pair };
    dispatchEvent(new Event('framefit'));
  }

  /* ---------- Magnetic scroll ---------- */
  var touchOnly = matchMedia('(hover: none) and (pointer: coarse)');
  var reduce = matchMedia('(prefers-reduced-motion: reduce)');
  var mag = { busy: false, armed: true, last: 0 };
  function lenis() { return window.__lenis || null; }
  function magActive() { return state.on && lenis() && !touchOnly.matches && !reduce.matches; }
  function stops() {
    var first = state.pair ? studios : exp;
    var p1 = Math.round(first.getBoundingClientRect().top + scrollY - vis(header));
    return [0, p1, Math.round(p1 + innerHeight - vis(header))];
  }
  function inZone(dir) {
    var y = scrollY, end = stops()[2];
    if (y > end + 2) return false;                 // below the two screens: free
    if (y >= end - 2 && dir > 0) return false;     // leaving them downwards: free
    return true;
  }
  function magGo(dir) {
    var y = scrollY, pts = stops(), next = null, i;
    if (dir > 0) { for (i = 0; i < pts.length; i++) if (pts[i] > y + 2) { next = pts[i]; break; } }
    else { for (i = pts.length - 1; i >= 0; i--) if (pts[i] < y - 2) { next = pts[i]; break; } }
    if (next === null) return false;
    mag.busy = true; mag.armed = false;
    lenis().scrollTo(next, { duration: C.magDur, lock: true, force: true, onComplete: function () { mag.busy = false; mag.last = performance.now(); } });
    return true;
  }
  function onVirtual(d) {
    if (!magActive()) return true;
    var e = d.event;
    if (!e || e.type !== 'wheel' || e.ctrlKey) return true;      // touch and pinch-zoom pass through
    var dy = d.deltaY;
    if (!dy) return true;
    var now = performance.now(), gap = now - mag.last;
    // The tail of a gesture that already moved a screen is swallowed, wherever it lands,
    // so trackpad momentum never carries on into Services.
    if (mag.busy || (!mag.armed && gap < C.magQuiet)) { mag.last = now; e.preventDefault(); return false; }
    mag.armed = true;
    if (!inZone(dy > 0 ? 1 : -1)) return true;
    e.preventDefault(); mag.last = now;
    if (Math.abs(dy) >= 2) magGo(dy > 0 ? 1 : -1);
    return false;
  }
  addEventListener('keydown', function (e) {
    if (!magActive() || mag.busy || e.altKey || e.ctrlKey || e.metaKey) return;
    var t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(t.tagName))) return;
    var dir = ({ ArrowDown: 1, PageDown: 1, ' ': e.shiftKey ? -1 : 1, ArrowUp: -1, PageUp: -1 })[e.key];
    if (!dir || !inZone(dir)) return;
    if (magGo(dir)) e.preventDefault();
  });
  // Links to #consultancy (nav, mobile menu) land on the second screen's first stop,
  // which is the studios strip when the three share the screen.
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href="#consultancy"]');
    if (!a || !state.on || e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault(); e.stopPropagation();
    var t = stops()[1], l = lenis();
    if (l && !reduce.matches) l.scrollTo(t, { duration: 1.2 }); else scrollTo({ top: t, behavior: reduce.matches ? 'auto' : 'smooth' });
  }, true);

  function hookLenis() {
    // smooth-scroll.js creates window.__lenis; Lenis reads options.virtualScroll on every wheel event.
    var l = lenis();
    if (l && l.options) { l.options.virtualScroll = onVirtual; return true; }
    return false;
  }

  /* ---------- Run ---------- */
  var rz, lastW = 0, lastH = 0;
  function onResize() {
    if (innerWidth === lastW && innerHeight === lastH) return;
    lastW = innerWidth; lastH = innerHeight;
    clearTimeout(rz); rz = setTimeout(apply, 100);
  }
  function start() {
    lastW = innerWidth; lastH = innerHeight;
    apply();
    if (!hookLenis()) { var tries = 0, t = setInterval(function () { if (hookLenis() || ++tries > 40) clearInterval(t); }, 100); }
    addEventListener('resize', onResize);
    // Language switches change text lengths, so the frames are measured again.
    new MutationObserver(function () { clearTimeout(rz); rz = setTimeout(apply, 60); }).observe(root, { attributes: true, attributeFilter: ['lang'] });
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(start); else addEventListener('load', start);
})();

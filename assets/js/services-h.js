/*!
 * services-h.js: Services on desktop (901px wide and up). Mobile is never touched.
 *
 * Layout (services-h.css, under a min-width: 901px media query, so it never depends on this
 * script succeeding): the heading, intro and "Sound familiar?" stay as they are and scroll
 * freely. Below them the two live panels become one horizontal section, two screens tall.
 * Its frame (the two titles + four cards) sticks under the header, and the vertical scroll
 * slides the track from the first half to the second.
 *
 * This script:
 *  - sizes the frame to the window (header, page zoom from frame-fit.js), the cards to the
 *    room under the titles, and sets the card text to the largest size (C.fsMin to C.fsMax)
 *    at which nothing overflows, so the fullest card is filled down to C.reserve;
 *  - moves the track with the scroll and turns the title of the half on screen clay;
 *  - adds a line between the two titles that fills as the page moves to the second half;
 *  - when the page switches half, animates that half's cards in from their side (the first
 *    half from the left, the second from the right), and fans the cards out a little while
 *    the track slides; arriving on the cards from above or below shows them at once;
 *  - keeps both live panels visible on desktop (the live tab script hides one with [hidden]);
 *  - makes the two titles back and forth buttons, and sends router links to the right half;
 *  - gives frame-fit.js its magnetic stops (window.__svcH.group()) and the rubber band's
 *    hold on the line (window.__svcH.band()).
 * Below 901px it restores the live tab state once and then does nothing.
 * Prototype: Services lab artifact (claude.ai), 2026-10-08 to 2026-10-12.
 */
(function () {
  'use strict';
  var root = document.documentElement;
  var box = document.getElementById('svc-h');
  if (!box) return;
  var sticky = box.querySelector('.svc-h-sticky'), titles = box.querySelector('.services-tabs');
  var header = document.getElementById('site-header'), main = document.querySelector('main');
  var tabs = Array.prototype.slice.call(box.querySelectorAll('.services-tab'));
  var cards = Array.prototype.slice.call(box.querySelectorAll('.services-panel .service'));
  var PANEL = { dev: 'tab-developers', pub: 'tab-publishers' };
  var panel = function (k) { return document.getElementById(PANEL[k]); };
  if (!sticky || !titles || !header || !main || !panel('dev') || !panel('pub')) return;
  // The line between the two titles (desktop only, services-h.css). Grey at rest, it shows a
  // switch under way: it fills in clay from the left going to the second half and from the
  // right going back, with the rubber band's steps (window.__svcH.band, from frame-fit.js) and
  // then with the slide, and once the slide arrives it fades back to grey.
  // ln: the side it fills from (1 left, -1 right), whether the rubber band holds it, the fade
  // timer, and the slide's progress at the previous update.
  var line = document.createElement('span');
  line.className = 'svc-h-line'; line.setAttribute('aria-hidden', 'true');
  line.appendChild(document.createElement('span'));
  titles.appendChild(line);
  var ln = { dir: 1, held: false, t: null, lastP: null };

  var C = {
    first: 'pub',          // half shown first, its title on the left margin ('pub' or 'dev')
    pad: 24,               // space above the titles and below the cards (page px)
    gap: 22,               // space between the titles and the cards (page px)
    cardMaxH: 640,         // tallest card (page px)
    fsMin: 0.6,            // smallest card text scale
    fsMax: 1.3,            // largest card text scale: the text grows until the fullest card is full
    reserve: 8,            // space kept free under the text of the fullest card (page px)
    fsEach: true,          // each half sizes its own text (true), or both halves share one size
    switchFx: 'cascade',   // switching half: 'cascade' (tied to the slide), 'timed' (C.enter below), or 'none'
    casDist: 220,          // cascade: how far behind its place a card starts (page px)
    casLag: 0.12,          // cascade: how much later each card starts than the one before (share of the slide)
    casFade: 0,            // cascade: opacity a card starts from (0 to 1)
    casTime: true,         // cascade: spread it over the slide's time, not its distance (see cascade())
    enter: 'side',         // timed: cards of the half switched to: 'side' (first half from the left, second from the right), 'up', or 'none'
    enterWhen: 'start',    // 'start': as the slide begins; 'mid': at its halfway point; 'arrive': when it ends (the half waits hidden until then)
    enterDist: 60,         // how far they travel (page px)
    enterDur: 450,         // each card's animation (ms)
    enterStagger: 40,      // delay between one card and the next (ms)
    spread: 0,             // while the track slides, how far apart the cards fan out (page px, 0 = off)
    lineGap: 32            // space between the line and each title (page px)
  };
  if (window.__svcConfig) Object.assign(C, window.__svcConfig);
  window.__svcConfig = C;

  var desk = matchMedia('(min-width: 901px)');
  var reduce = matchMedia('(prefers-reduced-motion: reduce)');
  var state = { on: false, frame: 0, fs: 1, cardH: 0, k: 1, active: null, p: 0 };
  var second = function () { return C.first === 'pub' ? 'dev' : 'pub'; };
  var keyOf = function (el) { var p = el && el.closest && el.closest('.services-panel'); return p ? (p.id === PANEL.pub ? 'pub' : 'dev') : null; };
  var set = function (k, v) { box.style.setProperty(k, v); };
  var px = function (n) { return n.toFixed(1) + 'px'; };
  function pageK() { var z = parseFloat(getComputedStyle(main).zoom); return z > 0 ? z : 1; }
  function lenis() { return window.__lenis || null; }

  // Both panels stay visible on desktop: remove [hidden] whenever the live script sets it.
  function unhide() { [panel('dev'), panel('pub')].forEach(function (p) { if (p.hasAttribute('hidden')) p.removeAttribute('hidden'); }); }
  new MutationObserver(function () { if (state.on) unhide(); }).observe(box, { attributes: true, attributeFilter: ['hidden'], subtree: true });

  function setActive(a) {
    if (a === state.active) return;
    state.active = a;
    tabs.forEach(function (t) {
      var on = t.getAttribute('data-tab-target') === PANEL[a];
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
      t.classList.remove('is-pulsing');
    });
  }

  /* ---------- Layout ---------- */
  function layout() {
    if (!desk.matches) { if (state.on) teardown(); return; }
    state.on = true;
    root.setAttribute('data-svc-first', C.first);
    unhide();
    var k = pageK(), hdr = header.getBoundingClientRect().height / k;   // page units
    var frame = Math.max(320, innerHeight / k - hdr);
    state.k = k; state.frame = frame;
    set('--svc-top', px(hdr));
    set('--svc-frame', px(frame));
    set('--svc-pad', px(C.pad));
    set('--svc-gap', px(C.gap));
    set('--svc-gutter', px(Math.max(0, box.getBoundingClientRect().left / k)));
    box.style.height = px(2 * frame);
    // Cards: the room under the heading and the titles (everything in the frame above the
    // track, each followed by C.gap), at most C.cardMaxH.
    var above = 0;
    Array.prototype.forEach.call(sticky.children, function (el) {
      if (!el.classList.contains('svc-h-view') && el.offsetHeight) above += el.offsetHeight + C.gap;
    });
    var cardH = Math.min(C.cardMaxH, frame - 2 * C.pad - above);
    cardH = Math.max(200, cardH);
    set('--svc-card-h', px(cardH));
    state.cardH = cardH;
    // Text: the largest scale (C.fsMin to C.fsMax) at which no card overflows, so the text
    // fills the fullest card down to C.reserve. Too tall: a card overflows, or the rows the
    // four cards share push past the panel. With C.fsEach each half finds its own scale, so
    // a half with shorter texts is not held back by the other one.
    set('--svc-reserve', px(C.reserve));
    var groupsOf = C.fsEach ? [[panel('pub')], [panel('dev')]] : [[panel('pub'), panel('dev')]];
    var fsOf = {};
    groupsOf.forEach(function (ps) {
      var els = [];
      ps.forEach(function (p) { els.push(p); els.push.apply(els, p.querySelectorAll('.service')); });
      var put = function (v) { ps.forEach(function (p) { p.style.setProperty('--svc-fs', v.toFixed(3)); }); };
      var over = function () { return els.some(function (c) { return c.scrollHeight > c.clientHeight + 1; }); };
      var lo = C.fsMin, hi = Math.max(C.fsMin, C.fsMax), fs;
      put(hi);
      if (!over()) fs = hi;
      else {
        for (var i = 0; i < 10; i++) { var mid = (lo + hi) / 2; put(mid); if (over()) hi = mid; else lo = mid; }
        fs = lo;
      }
      put(fs);
      ps.forEach(function (p) { fsOf[p === panel('pub') ? 'pub' : 'dev'] = fs; });
      if (over()) state.overflow = true;
    });
    state.overflow = !!state.overflow && cards.concat([panel('pub'), panel('dev')]).some(function (c) { return c.scrollHeight > c.clientHeight + 1; });
    state.fs = Math.min(fsOf.pub, fsOf.dev); state.fsPub = fsOf.pub; state.fsDev = fsOf.dev;
    placeLine();
    state.active = null;
    update();
    dispatchEvent(new Event('svclayout'));
  }
  // The line between the titles: centred on the page column, where its middle falls between
  // the second and the third card, and as long as the shorter side allows, C.lineGap from
  // each title. Titles change width with the language, so this runs with every layout.
  function placeLine() {
    var a = document.getElementById(C.first === 'pub' ? 'tabbtn-publishers' : 'tabbtn-developers');
    var b = document.getElementById(C.first === 'pub' ? 'tabbtn-developers' : 'tabbtn-publishers');
    if (!a || !b) return;
    var c = titles.clientWidth / 2;
    var half = Math.max(0, Math.min(c - (a.offsetLeft + a.offsetWidth), b.offsetLeft - c) - C.lineGap);
    line.style.left = px(c - half); line.style.width = px(2 * half);
  }
  // Back below 901px: the live default (Developers tab open, Publishers hidden).
  function teardown() {
    state.on = false; state.active = null;
    clearTimeout(ln.t); ln.held = false; ln.lastP = null; line.classList.remove('from-right', 'is-done');
    box.style.height = '';
    ['--svc-top', '--svc-frame', '--svc-pad', '--svc-gap', '--svc-gutter', '--svc-card-h', '--svc-fs', '--svc-reserve', '--svc-p'].forEach(function (v) { box.style.removeProperty(v); });
    [panel('pub'), panel('dev')].forEach(function (p) { p.style.removeProperty('--svc-fs'); });
    tabs.forEach(function (t) {
      var on = t.getAttribute('data-tab-target') === PANEL.dev;
      t.classList.toggle('is-active', on); t.setAttribute('aria-selected', on ? 'true' : 'false'); t.tabIndex = on ? 0 : -1;
    });
    panel('dev').removeAttribute('hidden'); panel('pub').setAttribute('hidden', '');
    dispatchEvent(new Event('svclayout'));
  }

  /* ---------- Scroll ---------- */
  // Scroll position (px) of the section's first stop: its top under the header.
  function top() { return Math.round(box.getBoundingClientRect().top + scrollY - header.getBoundingClientRect().height); }
  function frameV() { return Math.round(innerHeight - header.getBoundingClientRect().height); }
  function update() {
    if (!state.on) return;
    var p = (scrollY - top()) / frameV();
    p = Math.max(0, Math.min(1, p));
    set('--svc-p', p.toFixed(4));
    state.p = p;
    lineFollow(p);
    setActive(p >= 0.5 ? second() : C.first);
    fan(p);
    if (C.switchFx === 'cascade') cascade(p); else { cascade(null); if (C.switchFx === 'timed') switching(p); }
  }
  // The line (see ln above). drawLine fills it to f from side dir; lineDone fades the clay out
  // once a switch has arrived and then empties it unseen, so the line is grey again.
  function drawLine(dir, f) {
    clearTimeout(ln.t); line.classList.remove('is-done');
    ln.dir = dir;
    line.classList.toggle('from-right', dir < 0);
    line.firstChild.style.setProperty('--svc-fill', f.toFixed(4));
  }
  function lineDone() {
    ln.held = false;
    clearTimeout(ln.t);
    line.classList.add('is-done');
    ln.t = setTimeout(function () {
      line.classList.add('is-reset');
      line.classList.remove('is-done');
      line.firstChild.style.setProperty('--svc-fill', '0');
      void line.offsetWidth;
      line.classList.remove('is-reset');
    }, 650);
  }
  // Follows the slide: the line fills in the way the track moves and fades once it arrives at
  // the other half. While the rubber band holds it, only the arrival counts.
  function lineFollow(p) {
    var last = ln.lastP;
    ln.lastP = p;
    if (ln.held) {
      if (ln.dir > 0 ? p >= 0.999 : p <= 0.001) lineDone();
      return;
    }
    if (last === null || Math.abs(p - last) < 1e-4) return;
    if ((p >= 0.999 && last >= 0.999) || (p <= 0.001 && last <= 0.001)) return;   // settling at a half
    var dir = p > last ? 1 : -1, f = dir > 0 ? p : 1 - p;
    drawLine(dir, f);
    if (f >= 0.999) lineDone();
  }
  // Cascade: tied to the slide, so it starts with the gesture and ends with the slide, with no
  // timers. Each half's cards sit at their place when the half is on screen; as the track moves
  // away, they fall behind it one after another (C.casLag), up to C.casDist and down to
  // C.casFade opacity. Coming back plays the same in reverse: the cards land one by one,
  // the first to come into view first, the last one exactly when the slide ends.
  var cascaded = false;
  function cascade(p) {
    var on = p !== null && !reduce.matches && (p > 0.0005 && p < 0.9995);
    if (!on && !cascaded) return;
    cascaded = on;
    var ease = function (t) { return 1 - Math.pow(1 - t, 3); };
    // The slide (Lenis, smooth-scroll.js) eases out hard: it covers 90% of the distance in the
    // first quarter of its time. Read on distance, the cascade would be over before the cards
    // are on screen, so with C.casTime the progress goes back through that easing to time.
    var toTime = function (q) { return C.casTime ? Math.max(0, Math.min(1, -Math.log2(Math.max(1e-6, 1.001 - q)) / 10)) : q; };
    ['pub', 'dev'].forEach(function (k) {
      var isFirst = k === C.first, q = toTime(isFirst ? 1 - p : p), from = isFirst ? -1 : 1;
      var cs = Array.prototype.slice.call(panel(k).querySelectorAll('.service')), n = cs.length;
      cs.forEach(function (c, i) {
        if (!on) { c.style.translate = ''; c.style.opacity = ''; return; }
        var j = isFirst ? n - 1 - i : i;                 // the card that comes into view first lands first
        var span = Math.max(0.05, 1 - (n - 1) * C.casLag);
        var t = ease(Math.max(0, Math.min(1, (q - j * C.casLag) / span)));
        c.style.translate = (from * C.casDist * (1 - t)).toFixed(1) + 'px 0';
        c.style.opacity = (C.casFade + (1 - C.casFade) * t).toFixed(3);
      });
    });
  }
  // During the slide the cards fan out: each one trails the one before it by up to C.spread,
  // most at mid-slide and not at all at either half, so the arriving cards land one by one.
  var fanned = false;
  function fan(p) {
    var b = C.spread > 0 && !reduce.matches ? Math.sin(Math.PI * p) : 0;
    if (b < 0.001 && !fanned) return;
    fanned = b >= 0.001;
    [panel('pub'), panel('dev')].forEach(function (pn) {
      Array.prototype.forEach.call(pn.querySelectorAll('.service'), function (c, i) {
        c.style.translate = fanned ? (C.spread * b * i).toFixed(1) + 'px 0' : '';
      });
    });
  }

  /* ---------- Entrance ---------- */
  // Only when the page switches half: arriving on the cards from the text above or from the
  // section below shows them at once. With C.enterWhen 'start' the new half's cards come in
  // from their side as soon as the slide begins, so they land with it; 'mid' starts them at
  // the halfway point; 'arrive' keeps the half hidden (.is-waiting) until the slide ends. The first half
  // (title on the left) comes in from the left, the second from the right.
  var shown = null;                      // the half whose cards are showing; null out of view
  var lastP = null;                      // the slide's progress at the previous update
  var other = function (k) { return k === 'pub' ? 'dev' : 'pub'; };
  var animated = function () { return C.enter !== 'none' && !reduce.matches; };
  // The half that is off screen waits hidden, so its cards never flash before they come in.
  function hide(k, on) { panel(k).classList.toggle('is-waiting', !!on && animated() && C.switchFx === 'timed'); }
  function enter(k) {
    shown = k;
    hide(k, false);
    if (!animated()) return;
    var cs = Array.prototype.slice.call(panel(k).querySelectorAll('.service'));
    if (!cs[0] || !cs[0].animate) return;
    var from = k === C.first ? -1 : 1, d = C.enterDist;
    if (from > 0) cs.reverse();          // from the right, the card nearest the edge leads
    cs.forEach(function (c, i) {
      var t0 = C.enter === 'up' ? '0 ' + d + 'px' : (from * d) + 'px 0';
      var o = { duration: C.enterDur, delay: i * C.enterStagger, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'backwards' };
      // Two animations: the travel adds to the fan-out offset (composite add), the fade does not.
      c.animate([{ translate: t0 }, { translate: '0 0' }], Object.assign({ composite: 'add' }, o));
      c.animate([{ opacity: 0 }, { opacity: 1 }], o);
    });
  }
  // Called on every scroll update with the slide's progress p (0 first half, 1 second).
  function switching(p) {
    var dp = lastP === null ? 0 : p - lastP;
    lastP = p;
    if (shown === null) return;
    var rest = p <= 0.001 ? C.first : p >= 0.999 ? second() : null, target = null;
    // At rest, the half that left the screen goes back to waiting.
    if (rest && rest === shown) hide(other(shown), true);
    if (C.enterWhen === 'start') target = dp > 0.0005 ? second() : dp < -0.0005 ? C.first : null;   // the way the track is moving
    else if (C.enterWhen === 'mid') target = p >= 0.5 ? second() : C.first;
    else target = rest;
    if (target && target !== shown) enter(target);
  }
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (es) {
      if (!state.on) return;
      var e = es[es.length - 1];
      if (e.isIntersecting && shown === null) {
        // Arrived from above or below: the half on screen shows at once, the other one waits.
        var p = (scrollY - top()) / frameV();
        shown = p >= 0.5 ? second() : C.first;
        hide(shown, false); hide(other(shown), true);
      } else if (!e.isIntersecting) {
        shown = null;
        panel('pub').classList.remove('is-waiting'); panel('dev').classList.remove('is-waiting');
      }
    }, { threshold: 0 }).observe(box.querySelector('.svc-h-view'));
  }
  var raf = 0;
  addEventListener('scroll', function () { if (!raf) raf = requestAnimationFrame(function () { raf = 0; update(); }); }, { passive: true });

  // Where a half sits in the page scroll.
  function stopOf(k) { return top() + (k === second() ? frameV() : 0); }
  function go(t, instant) {
    ln.held = false;                     // the line follows this move, not a rubber band hold
    var l = lenis();
    if (l) l.scrollTo(t, instant ? { immediate: true, force: true } : { duration: reduce.matches ? 0 : 1.1, force: true });
    else scrollTo({ top: t, behavior: instant || reduce.matches ? 'auto' : 'smooth' });
  }

  /* ---------- Titles, router links, keyboard ---------- */
  // Capture phase: runs before the live tab and router scripts, which would hide a panel.
  document.addEventListener('click', function (e) {
    if (!state.on || e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
    var t = e.target.closest && e.target.closest('.services-tab');
    if (t && box.contains(t)) {
      e.preventDefault(); e.stopPropagation();
      go(stopOf(t.getAttribute('data-tab-target') === PANEL.pub ? 'pub' : 'dev'));
      return;
    }
    var a = e.target.closest && e.target.closest('a[href^="#"]');
    var el = a && a.getAttribute('href').length > 1 && document.getElementById(a.getAttribute('href').slice(1));
    if (!el || !box.contains(el)) return;
    e.preventDefault(); e.stopPropagation();
    var card = el.closest('.service');
    if (card) { card.classList.remove('is-flash'); void card.offsetWidth; card.classList.add('is-flash'); }
    go(stopOf(keyOf(el) || C.first));
  }, true);
  document.addEventListener('keydown', function (e) {
    if (!state.on) return;
    var t = e.target.closest && e.target.closest('.services-tab');
    if (!t || !box.contains(t) || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault(); e.stopPropagation();
    var k = e.key === 'ArrowLeft' ? C.first : second();
    go(stopOf(k));
    var b = tabs.filter(function (x) { return x.getAttribute('data-tab-target') === PANEL[k]; })[0];
    if (b) b.focus({ preventScroll: true });
  }, true);
  // Focus inside the half that is off screen brings that half in.
  box.addEventListener('focusin', function (e) {
    if (!state.on) return;
    var k = keyOf(e.target);
    if (!k || k === state.active) return;
    go(stopOf(k), true); update();
  });

  /* ---------- For frame-fit.js (magnetic scroll) and tuning ---------- */
  window.__svcH = {
    get on() { return state.on; },
    enter: function (k) { enter(k || state.active || C.first); },
    get shown() { return shown; },
    state: state,
    layout: layout,
    // Magnetic stops: first half, second half, end of the section.
    group: function () { if (!state.on) return null; var d = top(), f = frameV(); return [d, d + f, d + 2 * f]; },
    stopOf: stopOf,
    // Rubber band: holds the line at f (0 to 1), filled from the side of direction dir (1 to the
    // second half, from the left; -1 back, from the right), through the slide it starts until
    // that slide arrives. null lets go: the line empties back to grey.
    band: function (f, dir) {
      if (f === null) { if (ln.held) { ln.held = false; drawLine(ln.dir, 0); } return; }
      ln.held = true; drawLine(dir, f);
    }
  };

  /* ---------- Run ---------- */
  var t0 = null;
  function later(ms) { clearTimeout(t0); t0 = setTimeout(layout, ms || 60); }
  layout();
  addEventListener('framefit', function () { layout(); });                     // page zoom changed
  addEventListener('resize', function () { later(100); });
  if (desk.addEventListener) desk.addEventListener('change', function () { layout(); });
  if (document.fonts) {
    if (document.fonts.ready) document.fonts.ready.then(function () { layout(); });
    if (document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', function () { later(); });
  }
  addEventListener('load', function () { later(); });
  new MutationObserver(function () { later(); }).observe(root, { attributes: true, attributeFilter: ['lang'] });
})();

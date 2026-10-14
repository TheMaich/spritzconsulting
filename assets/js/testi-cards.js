/* Testimonials: runs the two layouts of the portrait cards in #testimonials.
   Desktop (901px and wider): marquee. The cards are copied once (aria-hidden, inert) so the
   strip loops without a seam; the strip bleeds to both window edges at any frame-fit.js page
   scale; it pauses on hover (CSS) and while the section is off screen.
   Phone (900px and narrower): deck. A straight stack, the two cards behind stepping up and to
   the right (CSS --tc-dx, --tc-dy), one card in front, that moves on every
   AUTO seconds. It pauses for a mouse hover, keyboard focus inside, the section off screen, or a
   hidden tab; a tap on the arrows does not pause it. Swipe left for the next card, right for
   the previous one. Reduced motion: no copies, no drift, no autoplay. */
(function () {
  'use strict';
  var wrap = document.querySelector('#testimonials .tc-wrap');
  if (!wrap) return;
  var track = wrap.querySelector('.tc-track');
  var dotsBox = wrap.querySelector('.tc-dots');
  var phone = matchMedia('(max-width: 900px)');
  var reduce = matchMedia('(prefers-reduced-motion: reduce)');
  var AUTO = 5;
  var cards = Array.prototype.slice.call(track.querySelectorAll('.tc'));
  var order = cards.map(function (c, i) { return i; });
  var timer = 0, hovering = false, focused = false, inView = true, busy = false;

  function layout() { return wrap.getAttribute('data-layout'); }

  /* ---------- Marquee ---------- */
  function clearClones() { Array.prototype.forEach.call(track.querySelectorAll('.tc.is-clone'), function (c) { c.remove(); }); }
  function addClones() {
    if (reduce.matches || track.querySelector('.tc.is-clone')) return;
    cards.forEach(function (c) {
      var k = c.cloneNode(true);
      k.classList.add('is-clone'); k.setAttribute('aria-hidden', 'true'); k.inert = true;
      track.appendChild(k);
    });
  }
  /* Bleed to both window edges. frame-fit.js zooms main, so lengths inside it are scaled:
     k is the ratio between the strip's on-screen width and its layout width. */
  function bleed() {
    wrap.style.marginLeft = ''; wrap.style.width = '';
    if (layout() !== 'marquee') return;
    var r = wrap.getBoundingClientRect(), k = (r.width / wrap.offsetWidth) || 1;
    var vw = document.documentElement.clientWidth;
    wrap.style.width = (vw / k) + 'px';
    wrap.style.marginLeft = (-r.left / k) + 'px';
  }

  /* ---------- Deck ---------- */
  function sizeDeck() {
    wrap.style.removeProperty('--tc-deck-h');
    var h = 0;
    cards.forEach(function (c) { c.style.height = 'auto'; h = Math.max(h, c.offsetHeight); c.style.height = ''; });
    if (h) wrap.style.setProperty('--tc-deck-h', h + 'px');
  }
  function poseFor(k) {
    var m = Math.min(k, 2);
    return 'translate(calc(' + m + ' * var(--tc-dx)), calc(' + (-m) + ' * var(--tc-dy)))';
  }
  function pose() {
    var n = order.length;
    order.forEach(function (ci, k) {
      var c = cards[ci];
      c.style.setProperty('--tc-pose', poseFor(k));
      c.style.zIndex = String(n - k);
      c.style.opacity = k > 2 ? '0' : '1';
      c.classList.toggle('is-front', k === 0);
      if (k === 0) c.removeAttribute('aria-hidden'); else c.setAttribute('aria-hidden', 'true');
      c.inert = k !== 0;
    });
    Array.prototype.forEach.call(dotsBox.children, function (d, i) {
      d.classList.toggle('is-active', i === order[0]);
      d.setAttribute('aria-current', i === order[0] ? 'true' : 'false');
    });
  }
  function clearDeck() {
    cards.forEach(function (c) {
      c.style.removeProperty('--tc-pose'); c.style.zIndex = ''; c.style.opacity = '';
      c.classList.remove('is-front', 'is-out'); c.removeAttribute('aria-hidden'); c.inert = false;
    });
    wrap.style.removeProperty('--tc-deck-h');
  }
  function step(dir) {
    if (layout() !== 'deck' || busy) return;
    if (dir > 0 && !reduce.matches) {
      busy = true;
      var f = cards[order[0]];
      f.classList.add('is-out');
      f.style.zIndex = String(order.length + 1);
      f.style.setProperty('--tc-pose', 'translate(-35%, 36px) scale(.96)');
      f.style.opacity = '0';
      setTimeout(function () { f.classList.remove('is-out'); order.push(order.shift()); pose(); busy = false; }, 180);
    } else if (dir > 0) { order.push(order.shift()); pose(); }
    else { order.unshift(order.pop()); pose(); }
  }
  function go(i) { var g = 0; while (order[0] !== i && g++ < cards.length) order.push(order.shift()); pose(); }

  function restart() {
    clearInterval(timer); timer = 0;
    if (layout() !== 'deck' || reduce.matches) return;
    timer = setInterval(function () { if (!hovering && !focused && inView && !document.hidden) step(1); }, AUTO * 1000);
  }

  /* ---------- Layout switch ---------- */
  function apply() {
    var l = phone.matches ? 'deck' : 'marquee';
    wrap.setAttribute('data-layout', l);
    if (l === 'marquee') { clearDeck(); addClones(); bleed(); }
    else { clearClones(); bleed(); sizeDeck(); pose(); }
    restart();
  }

  cards.forEach(function (c, i) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'tc-dot'; b.setAttribute('aria-label', 'Testimonial ' + (i + 1));
    b.addEventListener('click', function () { go(i); restart(); });
    dotsBox.appendChild(b);
  });
  wrap.querySelector('[data-tc-prev]').addEventListener('click', function () { step(-1); restart(); });
  wrap.querySelector('[data-tc-next]').addEventListener('click', function () { step(1); restart(); });
  wrap.addEventListener('pointerenter', function (e) { if (e.pointerType === 'mouse') hovering = true; });
  wrap.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') hovering = false; });
  wrap.addEventListener('focusin', function (e) { focused = e.target.matches(':focus-visible'); });
  wrap.addEventListener('focusout', function () { focused = false; });

  var sx = null, sy = 0;
  track.addEventListener('pointerdown', function (e) { if (layout() === 'deck') { sx = e.clientX; sy = e.clientY; } });
  track.addEventListener('pointercancel', function () { sx = null; });
  track.addEventListener('pointerup', function (e) {
    if (sx == null) return;
    var dx = e.clientX - sx, dy = e.clientY - sy; sx = null;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) { step(dx < 0 ? 1 : -1); restart(); }
  });

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (es) {
      inView = es[0].isIntersecting;
      wrap.classList.toggle('is-offscreen', !inView);
    }).observe(wrap);
  }
  /* frame-fit.js changes the page scale on resize; re-measure after it. */
  var rz = 0;
  addEventListener('resize', function () { cancelAnimationFrame(rz); rz = requestAnimationFrame(function () { bleed(); if (layout() === 'deck') sizeDeck(); }); });
  if ('ResizeObserver' in window) new ResizeObserver(function () { bleed(); }).observe(wrap.parentElement);
  phone.addEventListener('change', apply);
  reduce.addEventListener('change', function () { clearClones(); apply(); });
  apply();
})();

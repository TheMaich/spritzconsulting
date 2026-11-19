/* Steam Analysis tier cards on the phone: runs the deck, the same one as the homepage testimonial
   cards (assets/js/testi-cards.js). 900px and narrower: a straight stack, the two cards behind
   stepping up and to the right (CSS --sd-dx, --sd-dy), one card in front. It moves by tap, swipe or
   by every AUTO seconds when AUTO is set (off here); the autoplay pauses for a mouse hover, keyboard focus inside, the section off screen, an open order
   window or a hidden tab; a tap on the arrows does not pause it. Swipe left for the next card, right
   for the previous one. Reduced motion: no animation, no autoplay. Wider than 900px: nothing runs and
   the cards stay side by side.
   Each card shows its name, price, the "Made for" paragraph and its button all the time; the feature
   list opens when the reader taps the card body or its hint row, and closes on the next tap or when
   the deck moves. */
(function () {
  'use strict';
  var wrap = document.querySelector('.sd-wrap');
  if (!wrap) return;
  var track = wrap.querySelector('.sa-tiers');
  var dotsBox = wrap.querySelector('.sd-dots');
  var phone = matchMedia('(max-width: 900px)');
  var reduce = matchMedia('(prefers-reduced-motion: reduce)');
  var AUTO = 0;   /* seconds between automatic steps; 0 = off. The cards are tall and hold prices, so they wait for a tap or a swipe. */
  var cards = Array.prototype.slice.call(track.querySelectorAll('.sa-tier'));
  var order = cards.map(function (c, i) { return i; });
  var timer = 0, hovering = false, focused = false, inView = true, busy = false;

  function layout() { return wrap.getAttribute('data-layout'); }
  var LABEL_CLOSED = 'Tap the card to see what\u2019s included', LABEL_OPEN = 'Tap to hide what\u2019s included';
  var CHEV = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
  function listOf(c) { return c.querySelector('.sa-body > ul'); }
  function setOpen(c, on) {
    var b = c.querySelector('.sa-more'), ul = listOf(c);
    c.classList.toggle('is-open', on);
    if (b) { b.setAttribute('aria-expanded', on ? 'true' : 'false'); b.querySelector('.sa-more-t').textContent = on ? LABEL_OPEN : LABEL_CLOSED; }
    if (ul) ul.hidden = !on;
  }
  function closeAll() {
    var any = false;
    cards.forEach(function (c) { if (c.classList.contains('is-open')) { any = true; setOpen(c, false); } });
    return any;
  }
  function modalOpen() { return !!document.querySelector('dialog[open]'); }

  function sizeDeck() {
    wrap.style.removeProperty('--sd-deck-h');
    var h = 0;
    cards.forEach(function (c) { c.style.height = 'auto'; h = Math.max(h, c.offsetHeight); c.style.height = ''; });
    if (h) wrap.style.setProperty('--sd-deck-h', h + 'px');
  }
  function poseFor(k) {
    var m = Math.min(k, 2);
    return 'translate(calc(' + m + ' * var(--sd-dx)), calc(' + (-m) + ' * var(--sd-dy)))';
  }
  function pose() {
    var n = order.length;
    if (closeAll()) sizeDeck();
    order.forEach(function (ci, k) {
      var c = cards[ci];
      c.style.setProperty('--sd-pose', poseFor(k));
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
      c.style.removeProperty('--sd-pose'); c.style.zIndex = ''; c.style.opacity = '';
      c.classList.remove('is-front', 'is-out', 'is-open'); c.removeAttribute('aria-hidden'); c.inert = false;
      var ul = listOf(c); if (ul) ul.hidden = false;
    });
    wrap.style.removeProperty('--sd-deck-h');
  }
  function step(dir) {
    if (layout() !== 'deck' || busy) return;
    if (dir > 0 && !reduce.matches) {
      busy = true;
      var f = cards[order[0]];
      f.classList.add('is-out');
      f.style.zIndex = String(order.length + 1);
      f.style.setProperty('--sd-pose', 'translate(-35%, 36px) scale(.96)');
      f.style.opacity = '0';
      setTimeout(function () { f.classList.remove('is-out'); order.push(order.shift()); pose(); busy = false; }, 180);
    } else if (dir > 0) { order.push(order.shift()); pose(); }
    else { order.unshift(order.pop()); pose(); }
  }
  function go(i) { var g = 0; while (order[0] !== i && g++ < cards.length) order.push(order.shift()); pose(); }

  function restart() {
    clearInterval(timer); timer = 0;
    if (layout() !== 'deck' || reduce.matches || !AUTO) return;
    timer = setInterval(function () { if (!hovering && !focused && inView && !document.hidden && !modalOpen()) step(1); }, AUTO * 1000);
  }

  function apply() {
    var l = phone.matches ? 'deck' : 'grid';
    wrap.setAttribute('data-layout', l);
    if (l === 'grid') clearDeck(); else { cards.forEach(function (c) { setOpen(c, false); }); sizeDeck(); pose(); }
    restart();
  }

  cards.forEach(function (c, i) {
    var ul = listOf(c), b = document.createElement('button');
    if (!ul) return;
    ul.id = ul.id || 'sd-list-' + i;
    b.type = 'button'; b.className = 'sa-more'; b.setAttribute('aria-controls', ul.id); b.setAttribute('aria-expanded', 'false');
    b.innerHTML = '<span class="sa-more-t"></span>' + CHEV;
    b.querySelector('.sa-more-t').textContent = LABEL_CLOSED;
    ul.parentNode.insertBefore(b, ul);
  });
  var swiped = false;
  track.addEventListener('click', function (e) {
    if (layout() !== 'deck') return;
    var c = e.target.closest('.sa-tier');
    if (!c || !c.classList.contains('is-front')) return;
    if (swiped) { swiped = false; return; }
    if (e.target.closest('a, button:not(.sa-more)')) return;
    var on = !c.classList.contains('is-open');
    setOpen(c, on); sizeDeck(); wrap.classList.add('is-tapped');
  });

  var names = cards.map(function (c) { var h = c.querySelector('h3'); return h ? h.textContent.replace(/\s+/g, ' ').trim() : 'Tier'; });
  cards.forEach(function (c, i) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'sd-dot'; b.setAttribute('aria-label', 'Show ' + names[i]);
    b.addEventListener('click', function () { go(i); restart(); });
    dotsBox.appendChild(b);
  });
  wrap.querySelector('[data-sd-prev]').addEventListener('click', function () { step(-1); restart(); });
  wrap.querySelector('[data-sd-next]').addEventListener('click', function () { step(1); restart(); });
  wrap.addEventListener('pointerenter', function (e) { if (e.pointerType === 'mouse') hovering = true; });
  wrap.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') hovering = false; });
  wrap.addEventListener('focusin', function (e) { focused = e.target.matches(':focus-visible'); });
  wrap.addEventListener('focusout', function () { focused = false; });

  var sx = null, sy = 0;
  track.addEventListener('pointerdown', function (e) { swiped = false; if (layout() === 'deck') { sx = e.clientX; sy = e.clientY; } });
  track.addEventListener('pointercancel', function () { sx = null; });
  track.addEventListener('pointerup', function (e) {
    if (sx == null) return;
    var dx = e.clientX - sx, dy = e.clientY - sy; sx = null;
    if (Math.abs(dx) > 10) swiped = true;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) { step(dx < 0 ? 1 : -1); restart(); }
  });

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (es) { inView = es[0].isIntersecting; }).observe(wrap);
  }

  /* The cards change height when the fonts arrive, when the window is resized and when the prices
     load from the Worker; measure again each time. */
  var rz = 0;
  function remeasure() { cancelAnimationFrame(rz); rz = requestAnimationFrame(function () { if (layout() === 'deck') sizeDeck(); }); }
  addEventListener('resize', remeasure);
  addEventListener('load', remeasure);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(remeasure);
  if ('MutationObserver' in window) new MutationObserver(remeasure).observe(track, { childList: true, characterData: true, subtree: true });

  phone.addEventListener('change', apply);
  reduce.addEventListener('change', apply);
  apply();
})();

/* Steam Analysis order modal: the form, the card flip, the price and Express rows, and the call to the order Worker.
   Shared by /steam-analysis/ and the homepage, together with assets/css/steam-order-modal.css and
   assets/css/steam-tier-card.css. Any element with data-order="free|standard|premium" opens the modal for that tier.
   When the element sits inside a .sa-tier card, the card flips into the modal. A ?tier= deep link opens it too.
   ?promo=CODE shows a discount on the tier the code belongs to, once /api/order/promo says the code is valid.
   Needs /api/order/config, /api/order and /api/order/promo (workers/checkout). Load it with defer. */
(function () {
  /* The dialog markup lives here, so every page that loads this script gets the same modal. */
  var MARKUP = `<dialog class="sa-modal" id="order-modal" aria-labelledby="om-title" data-lenis-prevent>
  <form class="om-form" id="order-form" method="dialog" novalidate>
    <button class="om-close" type="button" aria-label="Close" data-om-close>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>
    </button>
    <span class="kicker">Order</span>
    <h2 class="om-title" id="om-title">Solo Dev Analysis</h2>
    <p class="om-price" id="om-price"></p>

    <input type="hidden" name="version" value="free">

    <div class="om-field"><label class="om-label" for="om-steam">Steam store link</label><input id="om-steam" name="steam" type="url" required inputmode="url" autocomplete="off" placeholder="https://store.steampowered.com/app/&hellip;"></div>
    <div class="om-field"><label class="om-label" for="om-email">Your email</label><input id="om-email" name="email" type="email" required autocomplete="email" placeholder="you@studio.com"></div>
    <p class="om-fine om-follow" id="om-follow" hidden>We’ll send your Solo Dev PDF, then one follow-up email with an offer. Unsubscribe anytime.</p>
    <div class="om-extra" id="om-extra" hidden>
      <div class="om-field"><label class="om-label" for="om-wl">Wishlists today (optional)</label>
        <input id="om-wl" name="wishlists" type="number" inputmode="numeric" min="0" step="1" placeholder="Enter your real count if you have it"></div>
    </div>
    <div class="om-field" id="om-notes-wrap"><label class="om-label" for="om-notes">Anything I should know (optional)</label><textarea id="om-notes" name="notes" rows="4" data-lenis-prevent></textarea></div>

    <label class="om-chk om-express" id="om-express" hidden><span class="om-express-copy"><span class="om-express-title">Express</span><span class="om-express-time" id="om-express-time"></span></span><span class="om-express-price" id="om-express-price"></span><input type="checkbox" role="switch" name="express" aria-label="Express delivery" disabled></label>
    <p class="om-total" id="om-total" hidden></p>

    <label class="om-chk" id="om-news"><input type="checkbox" name="news"><span>Send me occasional news from Spritz Consulting (optional).</span></label>

    <p class="om-err" id="om-err" role="alert" hidden></p>
    <!-- Paid tiers post to /api/order (workers/checkout). Solo Dev and an unreachable Worker show the notice below. -->
    <button class="btn sa-buy om-submit" type="submit" id="om-go"><span>Get Solo Dev Analysis</span></button>
    <p class="om-status" id="om-status" role="status" hidden>Ordering is not open yet. Nothing was sent.</p>
  </form>
</dialog>`;
  var dlg = document.getElementById('order-modal');
  if (!dlg) { document.body.insertAdjacentHTML('beforeend', MARKUP); dlg = document.getElementById('order-modal'); }
  if (!dlg || typeof dlg.showModal !== 'function') return;     /* old browsers keep the link on the button */
  var form = document.getElementById('order-form');
  var T = {
    free:     { title: 'Solo Dev Analysis',          price: 'No payment needed. Delivered within 1 day.',                                  go: 'Get Solo Dev Analysis' },
    standard: { title: 'Indie Analysis',     faster: 'Delivered in 1 business day instead of 2' },
    premium:  { title: 'Publisher Analysis', faster: 'Delivered in 2 business days instead of 3' }
  };
  /* Amounts shown for information, in the three currencies. Stripe decides which one the buyer pays in, from their
     location. /api/order/config overrides these when it answers. */
  var BASE = { standard: { eur: 99, usd: 109, gbp: 89 }, premium: { eur: 299, usd: 329, gbp: 249 } };
  var last = null;
  function track(ev, extra) {                             /* Zaraz is injected by Cloudflare; guard every call */
    try {
      if (!window.zaraz) return;
      var q = new URLSearchParams(location.search), d = { page: location.pathname }, k;
      ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach(function (n) { if (q.get(n)) d[n] = q.get(n); });
      for (k in extra) d[k] = extra[k];
      window.zaraz.track(ev, d);
    } catch (err) { /* analytics must never break the order form */ }
  }
  /* ---- Prices and Express, shown for information. Stripe chooses the currency at checkout, so the modal lists
     all three. Express shows only when the order Worker says it is on and has an amount in every currency. ---- */
  var SYMBOL = { eur: '€', usd: '$', gbp: '£' }, ORDER = ['eur', 'usd', 'gbp'];
  var cfg = null, cfgState = 'idle';                      /* idle | loading | ok | failed */
  function list(a) { return ORDER.map(function (c) { return SYMBOL[c] + a[c]; }).join(' / '); }
  function baseAmounts(v) {
    var a = cfg && cfg.amounts && cfg.amounts[v];
    return a && ORDER.every(function (c) { return Number(a[c]) > 0; }) ? a : BASE[v];
  }
  function expressAmounts(v) {
    var a = cfg && cfg.enabled && cfg.express && cfg.express[v];
    return a && ORDER.every(function (c) { return Number(a[c]) > 0; }) ? a : null;
  }
  /* A promotion code from ?promo=. It counts only after the Worker says it is valid, and only on the tier it belongs to.
     A missing, wrong or switched-off code leaves the list price in place and shows nothing. */
  var promo = null;                                       /* { code, tier, amounts } once the Worker confirmed it */
  function promoFor(v) {
    return promo && promo.tier === v && ORDER.every(function (c) { return Number(promo.amounts[c]) > 0; }) ? promo : null;
  }
  function loadPromo() {
    var code = (new URLSearchParams(location.search).get('promo') || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{3,30}$/.test(code)) return;
    fetch('/api/order/promo?code=' + encodeURIComponent(code), { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { if (j && j.valid === true && j.tier && j.amounts) promo = { code: code, tier: j.tier, amounts: j.amounts }; })
      .catch(function () { promo = null; })
      .then(renderOrder);
  }
  function renderOrder() {
    var v = form.elements.version.value, box = form.elements.express;
    if (!T[v]) return;
    var paid = (v !== 'free');
    var p = paid ? promoFor(v) : null;
    var base = paid ? (p ? p.amounts : baseAmounts(v)) : null;
    var priceEl = document.getElementById('om-price');
    if (!paid) priceEl.textContent = T[v].price;
    else if (p) {
      var was = document.createElement('del');
      was.textContent = list(baseAmounts(v));
      priceEl.textContent = '';
      priceEl.appendChild(was);
      priceEl.appendChild(document.createTextNode(' ' + list(base) + '. Code ' + p.code + ' is applied. Stripe shows the price in your currency at checkout.'));
    } else priceEl.textContent = list(base) + '. Stripe shows the price in your currency at checkout.';
    var ex = paid ? expressAmounts(v) : null;
    var row = document.getElementById('om-express'), total = document.getElementById('om-total');
    row.hidden = !ex;
    box.disabled = !ex;
    if (!ex) box.checked = false;
    else {
      document.getElementById('om-express-time').textContent = T[v].faster;
      document.getElementById('om-express-price').textContent = '+' + list(ex);
    }
    var on = !!ex && box.checked;
    total.hidden = !on;
    if (on) {
      var sum = {};
      ORDER.forEach(function (c) { sum[c] = Number(base[c]) + Number(ex[c]); });
      total.textContent = 'Total with Express: ' + list(sum);
    }
    document.querySelector('#om-go span').textContent = paid ? 'Pay with Stripe' : T[v].go;
  }
  function loadConfig() {
    if (cfgState === 'loading' || cfgState === 'ok') return;
    cfgState = 'loading';
    fetch('/api/order/config', { headers: { Accept: 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('http_' + r.status); return r.json(); })
      .then(function (j) { cfg = j; cfgState = 'ok'; })
      .catch(function () { cfg = null; cfgState = 'failed'; })
      .then(renderOrder);
  }
  var NOTE_HINT = {
    standard: 'Optional. A few details make the forecasts more accurate: your planned release (a quarter is enough), your wishlists today and the planned price in USD. Your team or anything else that helps is welcome too.',
    premium: 'Optional. A few details make the forecasts more accurate: your planned release (a quarter is enough) and the planned price in USD. Your team or anything else that helps is welcome too.'
  };
  function pick(v) {
    if (!T[v]) v = 'free';
    form.elements.version.value = v;
    var paid = (v !== 'free');
    document.getElementById('om-title').textContent = T[v].title;
    /* Free: Steam link and email only. Standard: plus one optional free-text note. Premium: the same note and an
       optional wishlist count. What used to be separate optional fields (release, wishlists, planned price) is now a
       hint inside the note, so the form stays short. */
    var prem = (v === 'premium'), std = (v === 'standard');
    document.getElementById('om-notes-wrap').hidden = !paid;
    form.elements.notes.placeholder = NOTE_HINT[v] || '';
    document.getElementById('om-news').hidden = !paid;
    document.getElementById('om-follow').hidden = paid;
    document.getElementById('om-extra').hidden = !prem;
    form.elements.notes.disabled = !paid;
    form.elements.news.disabled = !paid;
    form.elements.wishlists.disabled = !prem;
    form.elements.express.checked = false;
    renderOrder();
    if (paid) loadConfig();
  }
  form.elements.express.addEventListener('change', function () {
    renderOrder();
    /* The total and the pay button sit below the row: on a short screen, scroll just enough to keep them in view. */
    if (form.elements.express.checked) document.getElementById('om-go').scrollIntoView({ block: 'nearest', behavior: reduce.matches ? 'auto' : 'smooth' });
  });
  /* ---- Open / close: the tier card flips and warps into the modal (and back) ----
     Timing and curves follow the site: --ease (0.16, 1, 0.3, 1) for settling, an ease-in-out for the turn.
     Twelve principles at work: anticipation (the card presses in first), squash and stretch (the warp
     and its overshoot), staging (backdrop dims, the card is the only thing moving), pose to pose
     (hand-set keyframes), follow through and overlapping action (the turn overshoots, the tilt and the
     size settle at different times), slow in and slow out, arcs (it lifts toward the viewer on a curve),
     secondary action (glow ring, close button pop), timing (slower in, quicker out), exaggeration
     (full 180 degree turn, 140px lift), solid drawing (perspective and a real shadow), appeal (clay glow). */
  var EASE = 'cubic-bezier(0.16, 1, 0.3, 1)', EASE_IO = 'cubic-bezier(0.4, 0, 0.2, 1)', EASE_TURN = 'cubic-bezier(0.55, 0.05, 0.25, 1)';
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  var phone = window.matchMedia('(max-width: 768px)');          /* phones: no flip, the plain modal fade is enough */
  var canFlip = ('popover' in HTMLElement.prototype) && typeof Element.prototype.animate === 'function';
  var busy = false, card = null;

  function plain(root) {                                  /* a visual copy: no ids, links or tab stops */
    root.querySelectorAll('[id]').forEach(function (n) { n.removeAttribute('id'); });
    root.querySelectorAll('[for],[aria-describedby],[aria-labelledby],[data-order],[data-om-close]').forEach(function (n) {
      ['for', 'aria-describedby', 'aria-labelledby', 'data-order', 'data-om-close'].forEach(function (a) { n.removeAttribute(a); });
    });
    root.querySelectorAll('a,button,input,textarea,select').forEach(function (n) { n.tabIndex = -1; });
    return root;
  }
  function formCopy() {                                   /* the form as it is now, typed text included */
    var cp = plain(form.cloneNode(true));
    var a = form.querySelectorAll('input,textarea,select'), b = cp.querySelectorAll('input,textarea,select');
    for (var i = 0; i < a.length; i++) { b[i].value = a[i].value; b[i].checked = a[i].checked; }
    return cp;
  }
  function flipper(cardEl, rect, hot) {
    var fl = document.createElement('div');
    fl.className = 'om-flipper'; fl.setAttribute('popover', 'manual'); fl.setAttribute('aria-hidden', 'true');
    fl.style.cssText = 'left:' + rect.left + 'px;top:' + rect.top + 'px;width:' + rect.width + 'px;height:' + rect.height + 'px';
    var front = document.createElement('div'); front.className = 'om-face om-front';
    var cc = plain(cardEl.cloneNode(true)); cc.classList.add('om-card-copy');
    cc.style.width = cardEl.offsetWidth + 'px'; cc.style.height = cardEl.offsetHeight + 'px';
    cc.style.visibility = 'visible'; cc.style.transformOrigin = '0 0';
    cc.style.transform = 'scale(' + (rect.width / cardEl.offsetWidth) + ',' + (rect.height / cardEl.offsetHeight) + ')';
    var btn = cc.querySelector('.sa-buy'); if (btn && hot) btn.classList.add('is-hot');
    front.appendChild(cc);
    var back = document.createElement('div'); back.className = 'om-face om-back';
    var ghost = document.createElement('div'); ghost.className = 'sa-modal om-ghost';
    ghost.style.width = rect.width + 'px'; ghost.style.height = rect.height + 'px';
    ghost.appendChild(formCopy()); back.appendChild(ghost);
    var inner = document.createElement('div'); inner.className = 'om-inner'; inner.append(front, back);
    var lift = document.createElement('div'); lift.className = 'om-lift'; lift.appendChild(inner);
    var geo = document.createElement('div'); geo.className = 'om-geo'; geo.appendChild(lift);
    var glow = document.createElement('div'); glow.className = 'om-glow';
    fl.append(glow, geo);
    document.body.appendChild(fl); fl.showPopover();
    return { el: fl, geo: geo, lift: lift, inner: inner, glow: glow };
  }
  function pose(card, m) {                                /* translate + scale that put the modal box on the card */
    var dx = (card.left + card.width / 2) - (m.left + m.width / 2), dy = (card.top + card.height / 2) - (m.top + m.height / 2);
    return { dx: dx, dy: dy, sx: card.width / m.width, sy: card.height / m.height };
  }
  function run(f, kfs, ms) {
    var o = { duration: ms, fill: 'both' };
    return Promise.all([f.geo.animate(kfs.geo, o), f.lift.animate(kfs.lift, o), f.inner.animate(kfs.inner, o), f.glow.animate(kfs.glow, o)]
      .map(function (a) { return a.finished; }));
  }

  function open(v, trigger) {
    if (busy) return;
    last = trigger || null;
    restoreForm();
    pick(v);
    track('order_form_open', { tier: form.elements.version.value, source: trigger ? 'card' : 'url' });
    document.getElementById('om-status').hidden = true;
    document.getElementById('om-err').hidden = true;
    card = trigger && trigger.closest ? trigger.closest('.sa-tier') : null;
    var from = card ? card.getBoundingClientRect() : null;            /* measure before the page locks */
    document.documentElement.classList.add('om-open');
    var flip = canFlip && !reduce.matches && !phone.matches && from;
    if (flip) { dlg.classList.add('om-flip'); dlg.style.opacity = '0'; }
    dlg.showModal();
    if (!flip) return;
    busy = true;
    var to = dlg.getBoundingClientRect();
    var p = pose(from, to), f = flipper(card, to, true);
    card.style.visibility = 'hidden';
    dlg.classList.add('om-pre'); void dlg.offsetWidth; dlg.classList.remove('om-pre');   /* backdrop fades in */
    var T0 = 'translate(' + p.dx + 'px,' + p.dy + 'px)';
    var kf = {
      /* geometry: press in (anticipation), fly, overshoot (stretch), undershoot, settle */
      geo: [
        { offset: 0,    transform: T0 + ' scale(' + p.sx + ',' + p.sy + ')', easing: EASE_IO },
        { offset: 0.13, transform: T0 + ' scale(' + p.sx * 0.95 + ',' + p.sy * 0.95 + ')', easing: 'cubic-bezier(0.5, 0, 0.15, 1)' },
        { offset: 0.8,  transform: 'translate(' + p.dx * 0.012 + 'px,' + p.dy * 0.012 + 'px) scale(1.035,1.025)', easing: EASE_IO },
        { offset: 0.91, transform: 'scale(0.994,0.997)', easing: EASE },
        { offset: 1,    transform: 'none' }],
      /* arc: it rises toward the viewer on a curve and tilts around Z, then lands */
      lift: [
        { offset: 0,    transform: 'translate3d(0,0,0) rotateZ(0deg)', easing: EASE_IO },
        { offset: 0.13, transform: 'translate3d(0,6px,-12px) rotateZ(0deg)', easing: 'cubic-bezier(0.3, 0, 0.3, 1)' },
        { offset: 0.46, transform: 'translate3d(0,-46px,150px) rotateZ(-5deg)', easing: EASE_IO },
        { offset: 0.8,  transform: 'translate3d(0,-4px,24px) rotateZ(2.2deg)', easing: EASE },
        { offset: 1,    transform: 'translate3d(0,0,0) rotateZ(0deg)' }],
      /* the turn: holds during the press, overshoots past 180, settles back */
      inner: [
        { offset: 0,    transform: 'rotateY(0deg)', easing: 'linear' },
        { offset: 0.13, transform: 'rotateY(0deg)', easing: EASE_TURN },
        { offset: 0.8,  transform: 'rotateY(185deg)', easing: EASE },
        { offset: 1,    transform: 'rotateY(180deg)' }],
      glow: [
        { offset: 0,    opacity: 0, transform: 'scale(0.9)' },
        { offset: 0.5,  opacity: 0.85, transform: 'scale(1.06)', easing: EASE_IO },
        { offset: 1,    opacity: 0, transform: 'scale(1.15)' }]
    };
    run(f, kf, 820).then(function () {
      dlg.classList.add('om-landed');
      dlg.style.opacity = '';                              /* the real modal takes over, identical to the back face */
      f.el.remove(); busy = false;      /* same frame; om-flip stays until the modal closes, or its own open animation would restart */
    }, function () { f.el.remove(); dlg.style.opacity = ''; busy = false; });
  }

  function finishClose() {
    dlg.style.opacity = '';
    dlg.close(); unlock();
    dlg.classList.remove('om-leaving', 'om-landed', 'om-flip');
  }
  function close() {
    if (busy || !dlg.open) return;
    var flip = canFlip && !reduce.matches && !phone.matches && card && card.isConnected;
    if (!flip) { finishClose(); if (card) card.style.visibility = ''; return; }
    busy = true;
    var to = card.getBoundingClientRect(), from = dlg.getBoundingClientRect();
    card.style.visibility = 'hidden';
    var p = pose(to, from), f = flipper(card, from, false);
    f.inner.style.transform = 'rotateY(180deg)';
    dlg.classList.remove('om-landed'); dlg.classList.add('om-flip', 'om-leaving'); dlg.style.opacity = '0';   /* blur off first: cheap flight */
    var T1 = 'translate(' + p.dx + 'px,' + p.dy + 'px)';
    var kf = {
      geo: [
        { offset: 0,    transform: 'none', easing: 'cubic-bezier(0.5, 0, 0.2, 1)' },
        { offset: 0.88, transform: T1 + ' scale(' + p.sx * 0.985 + ',' + p.sy * 0.985 + ')', easing: EASE },
        { offset: 1,    transform: T1 + ' scale(' + p.sx + ',' + p.sy + ')' }],
      lift: [
        { offset: 0,    transform: 'translate3d(0,0,0) rotateZ(0deg)', easing: EASE_IO },
        { offset: 0.45, transform: 'translate3d(0,-26px,90px) rotateZ(3deg)', easing: EASE_IO },
        { offset: 1,    transform: 'translate3d(0,0,0) rotateZ(0deg)' }],
      inner: [
        { offset: 0,    transform: 'rotateY(180deg)', easing: EASE_TURN },
        { offset: 1,    transform: 'rotateY(0deg)' }],
      glow: [
        { offset: 0,    opacity: 0, transform: 'scale(1)' },
        { offset: 0.5,  opacity: 0.5, transform: 'scale(1.04)', easing: EASE_IO },
        { offset: 1,    opacity: 0, transform: 'scale(1.08)' }]
    };
    run(f, kf, 520).then(function () {
      card.style.visibility = '';
      card.animate([{ scale: 1.045 }, { scale: 1 }], { duration: 320, easing: 'cubic-bezier(0.34, 1.45, 0.64, 1)' });   /* lands with a small settle */
      f.el.remove(); busy = false; finishClose();
    }, function () { card.style.visibility = ''; f.el.remove(); busy = false; finishClose(); });
  }
  function unlock() { document.documentElement.classList.remove('om-open'); }
  dlg.addEventListener('cancel', function (e) { e.preventDefault(); close(); });             /* Escape */
  dlg.addEventListener('close', function () {
    unlock();
    if (card) card.style.visibility = '';
    if (last && last.focus) last.focus();
  });
  dlg.addEventListener('click', function (e) { if (e.target === dlg) close(); });             /* click on the backdrop */
  dlg.querySelector('[data-om-close]').addEventListener('click', close);
  document.querySelectorAll('[data-order]').forEach(function (a) {
    a.addEventListener('click', function (e) { e.preventDefault(); track('cta_click', { placement: 'steam_tier_card', tier: a.getAttribute('data-order') }); open(a.getAttribute('data-order'), a); });
  });
  /* Error feedback: a damped side-to-side shake (like the Mac login box on a wrong password) and two
     pulses of the design system's danger colour (--danger, the signal magenta) around the modal border. */
  var shake = null;
  function fail(msg, field) {
    var err = document.getElementById('om-err');
    err.textContent = msg; err.hidden = false;
    form.querySelectorAll('[aria-invalid]').forEach(function (n) { n.removeAttribute('aria-invalid'); });
    if (field) { field.setAttribute('aria-invalid', 'true'); field.focus(); }
    if (typeof dlg.animate !== 'function') return;
    if (shake) shake.forEach(function (a) { a.cancel(); });
    var base = 'var(--shadow-md), 0 40px 90px -30px rgba(0,0,0,.6)';
    var ring = function (px, pct) { return base + ', 0 0 0 ' + px + 'px color-mix(in srgb, var(--danger) ' + pct + '%, transparent), 0 0 38px ' + (px * 2) + 'px color-mix(in srgb, var(--danger) ' + Math.round(pct * 0.6) + '%, transparent)'; };
    var pulse = dlg.animate([
      { borderColor: 'var(--rule)', boxShadow: ring(0, 0) },
      { offset: 0.22, borderColor: 'var(--danger)', boxShadow: ring(5, 55), easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
      { offset: 0.5, borderColor: 'color-mix(in srgb, var(--danger) 45%, var(--rule))', boxShadow: ring(1, 12), easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
      { offset: 0.72, borderColor: 'var(--danger)', boxShadow: ring(4, 40), easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
      { borderColor: 'var(--rule)', boxShadow: ring(0, 0) }
    ], { duration: 1000, easing: 'ease-out' });
    shake = [pulse];
    if (!reduce.matches) {
      /* A damped spring, sampled finely and played back linearly so it never stops and starts:
         x(t) = -A * e^(-k t) * sin(2 pi f t). About 3.5 swings in 640 ms, the first one wide. */
      var N = 48, A = 15, K = 4.2, F = 3.6, pts = [];
      for (var i = 0; i <= N; i++) {
        var t = i / N;
        var x = (i === N) ? 0 : -A * Math.exp(-K * t) * Math.sin(2 * Math.PI * F * t);
        pts.push({ offset: t, translate: x.toFixed(2) + 'px 0', rotate: (x * 0.045).toFixed(3) + 'deg' });
      }
      shake.push(dlg.animate(pts, { duration: 640, easing: 'linear' }));
    }
  }
  form.querySelectorAll('input,textarea').forEach(function (n) {
    n.addEventListener('input', function () { n.removeAttribute('aria-invalid'); });
  });
  /* Solo Dev: one POST to /api/order/free. On success the form fields give way to a short confirmation, and open() brings them back. */
  var STATUS_NOTICE = document.getElementById('om-status').textContent;
  function showDone() {
    Array.prototype.forEach.call(form.children, function (n) {
      if (n.hidden || n.classList.contains('om-close') || n.classList.contains('kicker') || n.id === 'om-title' || n.id === 'om-status') return;
      n.hidden = true; n.setAttribute('data-done-hidden', '');
    });
    var st = document.getElementById('om-status');
    st.textContent = 'Done. I will send your Solo Dev PDF to your email within 1 day.';
    st.hidden = false;
  }
  function restoreForm() {
    form.querySelectorAll('[data-done-hidden]').forEach(function (n) { n.hidden = false; n.removeAttribute('data-done-hidden'); });
    document.getElementById('om-status').textContent = STATUS_NOTICE;
  }
  function submitFree(el) {
    var go = document.getElementById('om-go'), label = go.querySelector('span');
    document.getElementById('om-status').hidden = true;
    go.disabled = true; label.textContent = 'Sending…';
    function unbusy() { go.disabled = false; renderOrder(); }
    fetch('/api/order/free', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ steam: el.steam.value.trim(), email: el.email.value.trim(), page: location.pathname, referrer: document.referrer || '' })
    }).then(function (r) {
      return r.json().then(function (j) { return { status: r.status, body: j }; }, function () { return { status: r.status, body: {} }; });
    }).then(function (res) {
      if (res.status === 200 && res.body && res.body.ok) { unbusy(); showDone(); return; }
      unbusy();
      var e = res.body && res.body.error;
      if (e === 'invalid_steam_link') return fail('Use the link of your Steam store page, the one with /app/ in it.', el.steam);
      if (e === 'invalid_email') return fail('Enter a valid email address so I can send you the analysis.', el.email);
      if (e === 'email_limit') return fail('This email already received 3 Solo Dev analyses.');
      if (e === 'game_limit') return fail('This game already has a Solo Dev analysis.');
      if (e === 'daily_limit') return fail("Today's free analyses are taken. Try again tomorrow.");
      if (res.status === 429) return fail('Too many attempts. Nothing was sent. Please wait a few minutes and try again.');
      fail('Something went wrong and nothing was sent. Please try again.');
    }).catch(function () {
      unbusy();
      fail('Could not reach the order service and nothing was sent. Please try again.');
    });
  }
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var steam = form.elements.steam.value.trim();
    if (!/^https?:\/\/(store\.steampowered\.com|steamcommunity\.com)\//i.test(steam)) {
      return fail('Paste the link to your Steam store page, for example https://store.steampowered.com/app/1234567/', form.elements.steam);
    }
    if (!form.elements.email.value || !form.elements.email.validity.valid) {
      return fail('Enter a valid email address so I can send you the analysis.', form.elements.email);
    }
    var wl = form.elements.wishlists;
    if (!wl.disabled && wl.value !== '' && !(Number(wl.value) >= 0 && Number.isInteger(Number(wl.value)))) {
      return fail('Enter your wishlist count as a whole number, or leave it empty.', wl);
    }
    document.getElementById('om-err').hidden = true;
    var v = form.elements.version.value, el = form.elements;
    var express = !el.express.disabled && el.express.checked;
    track('order_form_submit', { tier: v, express: express });
    /* Solo Dev posts to /api/order/free and needs no Stripe config. A paid tier needs the config; if the Worker cannot be reached, keep the notice. */
    if (v === 'free') { submitFree(el); return; }
    if (cfgState !== 'ok') { document.getElementById('om-status').hidden = false; return; }
    document.getElementById('om-status').hidden = true;
    var go = document.getElementById('om-go'), label = go.querySelector('span');
    go.disabled = true; label.textContent = 'Opening Stripe…';
    function unbusy() { go.disabled = false; renderOrder(); }
    fetch('/api/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version: v,
        steam: el.steam.value.trim(),
        email: el.email.value.trim(),
        wishlists: el.wishlists.disabled ? '' : el.wishlists.value,
        notes: el.notes.disabled ? '' : el.notes.value.trim(),
        news: !el.news.disabled && el.news.checked,
        express: express,
        promo: promoFor(v) ? promoFor(v).code : '',
        page: location.pathname,
        referrer: document.referrer || ''
      })
    }).then(function (r) {
      return r.json().then(function (j) { return { status: r.status, body: j }; }, function () { return { status: r.status, body: {} }; });
    }).then(function (res) {
      if (res.status === 200 && res.body && res.body.url) { window.location.href = res.body.url; return; }
      unbusy();
      var e = res.body && res.body.error;
      if (res.status === 429) return fail('Too many attempts. Please wait a few minutes and try again.');
      if (e === 'express_unavailable') return fail('Express is not available right now. Untick it and try again.');
      fail('Something went wrong and nothing was charged. Please try again.');
    }).catch(function () {
      unbusy();
      fail('Could not reach the order service and nothing was charged. Please try again.');
    });
  });
  /* Back from Stripe with the browser's back button: the page may come from the cache with the button still busy. */
  window.addEventListener('pageshow', function (e) {
    if (e.persisted) { document.getElementById('om-go').disabled = false; renderOrder(); }
  });
  /* Deep link from the decks: /steam-analysis/?tier=standard or ?tier=premium (?tier=indie and ?tier=publisher work too) opens that order form.
     ?promo=CODE in the same link adds the discount of that code to its own tier. */
  loadPromo();
  var want = new URLSearchParams(location.search).get('tier');
  if (want === 'extended' || want === 'publisher') want = 'premium';
  if (want === 'indie') want = 'standard';
  if (want === 'solo' || want === 'solo-dev') want = 'free';
  if (want === 'free' || want === 'standard' || want === 'premium') { track('tier_deeplink', { tier: want }); open(want, null); }
})();

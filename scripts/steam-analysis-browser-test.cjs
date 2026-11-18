// Browser test for steam-analysis/index.html (price cards, order modal, Express).
// Needs Playwright (require('playwright')). Run from the repo root:  node scripts/steam-analysis-browser-test.cjs [screenshot folder]
// The order Worker is mocked; nothing leaves the machine.
// Stripe chooses the buyer's currency, so the page shows all three amounts for information and has no currency selector.
const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = process.argv[2] || null;
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const FULL = {
  enabled: true,
  currencies: ['eur', 'usd', 'gbp'],
  amounts: { standard: { eur: 99, usd: 109, gbp: 89 }, premium: { eur: 299, usd: 329, gbp: 249 } },
  express: { standard: { eur: 49, usd: 49, gbp: 49 }, premium: { eur: 99, usd: 99, gbp: 99 } },
};
const KILL = '*,*::before,*::after{animation:none!important;transition:none!important}[data-reveal],.blur-reveal{opacity:1!important;filter:none!important;transform:none!important}';
const PRICE_ROW = { standard: '€99 / $109 / £89', premium: '€299 / $329 / £249' };
const EXPRESS_ROW = { standard: '+€49 / $49 / £49', premium: '+€99 / $99 / £99' };
const TOTAL_ROW = { standard: 'Total with Express: €148 / $158 / £138', premium: 'Total with Express: €398 / $428 / £348' };
const FASTER = { standard: 'Delivered in 1 business day instead of 2', premium: 'Delivered in 2 business days instead of 3' };

let failed = 0;
const ok = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) failed++; };

(async () => {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  }).listen(0);
  const URL = 'http://127.0.0.1:' + server.address().port + '/steam-analysis/';
  const browser = await chromium.launch();

  async function session(name, opts, fn) {
    const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 }, opts.ctx || {}));
    const p = await ctx.newPage(), errs = [], posts = [];
    p.on('pageerror', (e) => errs.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
    await p.route('**/api/order/config', (r) => opts.config === null
      ? r.fulfill({ status: 404, body: 'nf' })
      : r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(opts.config || FULL) }));
    await p.route('**/api/order', async (r) => { posts.push(JSON.parse(r.request().postData())); await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, url: URL + '?paid=1' }) }); });
    await p.goto(URL + (opts.qs || ''));
    await p.addStyleTag({ content: KILL });
    await p.waitForTimeout(400);
    console.log('--- ' + name);
    await fn(p, posts);
    ok(errs.length === 0, 'no console errors ' + errs.join(' | '));
    await ctx.close();
  }
  const openModal = async (p, v) => { await p.evaluate((o) => { const w = document.querySelector('.sd-wrap'); if (w && w.dataset.layout === 'deck') { const i = ['free', 'standard', 'premium'].indexOf(o); const d = w.querySelectorAll('.sd-dot')[i]; if (d) d.click(); } }, v); await p.waitForTimeout(400); await p.click('[data-order="' + v + '"]'); await p.waitForSelector('#order-modal[open]'); await p.waitForTimeout(1300); await p.addStyleTag({ content: KILL }); await p.waitForTimeout(300); };
  const text = (p, sel) => p.evaluate((s) => document.querySelector(s).textContent.trim().replace(/\s+/g, ' '), sel);
  const fill = async (p) => { await p.fill('#om-steam', 'https://store.steampowered.com/app/123/x/'); await p.fill('#om-email', 'a@b.co'); await p.check('input[name=waiver]'); };

  await session('cards are informative', {}, async (p) => {
    ok(await p.evaluate(() => document.querySelectorAll('.sa-cur, [name^="cur-"], input[type=radio]').length) === 0, 'no currency selector anywhere on the page');
    const cards = await p.$$eval('.sa-tier .sa-amts', (els) => els.map((e) => e.textContent.trim().replace(/\s+/g, '')));
    ok(JSON.stringify(cards) === JSON.stringify(['Free', '€99/$109/£89', '€299/$329/£249']), 'cards list all three currencies: ' + cards.join(' | '));
    const note = await text(p, '.sa-tiers-note');
    ok(note === 'Prices appear in euros, dollars and pounds. Stripe shows the matching currency at checkout.', 'note under the cards: ' + note);
  });

  await session('modal prices, Express and totals', {}, async (p, posts) => {
    for (const tier of ['standard', 'premium']) {
      await openModal(p, tier);
      ok(await text(p, '#om-price') === PRICE_ROW[tier] + '. Stripe shows the price in your currency at checkout.', tier + ': price row ' + await text(p, '#om-price'));
      ok(await text(p, '#om-go span') === 'Pay with Stripe', tier + ': button "Pay with Stripe"');
      ok(await text(p, '#om-express-price') === EXPRESS_ROW[tier], tier + ': Express row ' + await text(p, '#om-express-price'));
      ok(await text(p, '#om-express-time') === FASTER[tier], tier + ': Express delivery text');
      ok(!(await p.isVisible('#om-total')), tier + ': no total while unticked');
      await p.click('#om-express');
      ok(await text(p, '#om-total') === TOTAL_ROW[tier], tier + ': ' + await text(p, '#om-total'));
      ok(await text(p, '#om-go span') === 'Pay with Stripe', tier + ': the button never shows one currency');
      await p.click('#om-express');
      ok(!(await p.isVisible('#om-total')), tier + ': total hides again when unticked');
      await p.keyboard.press('Escape'); await p.waitForTimeout(900);
    }
    await openModal(p, 'standard'); await p.click('#om-express'); await fill(p);
    await Promise.all([p.waitForURL(/paid=1/), p.click('#om-go')]);
    ok(posts.length === 1 && posts[0].express === true && posts[0].version === 'standard', 'POST carries express: ' + JSON.stringify(posts[0]));
    ok(!('currency' in posts[0]), 'the order carries no currency: Stripe chooses it');
  });

  const noGbpStandard = { ...FULL, express: { standard: { eur: 49, usd: 49 }, premium: FULL.express.premium } };
  await session('Express needs all three currencies', { config: noGbpStandard }, async (p) => {
    await openModal(p, 'standard');
    ok(!(await p.isVisible('#om-express')), 'Indie: no Express row when one currency has no Express amount');
    ok(await p.evaluate(() => document.querySelector('input[name=express]').disabled), 'Indie: the Express input is disabled');
    ok(await text(p, '#om-go span') === 'Pay with Stripe', 'Indie: base order still possible');
    await p.keyboard.press('Escape'); await p.waitForTimeout(900);
    await openModal(p, 'premium');
    ok(await p.isVisible('#om-express'), 'Publisher: Express row still shows');
  });
  await session('Express off', { config: { ...FULL, enabled: false, express: {} } }, async (p) => {
    await openModal(p, 'premium');
    ok(!(await p.isVisible('#om-express')), 'no Express row when Express is off');
    ok(await text(p, '#om-price') === PRICE_ROW.premium + '. Stripe shows the price in your currency at checkout.', 'tier amounts still show');
  });
  await session('Worker unreachable', { config: null }, async (p, posts) => {
    await openModal(p, 'standard');
    ok(await text(p, '#om-price') === PRICE_ROW.standard + '. Stripe shows the price in your currency at checkout.', 'built-in amounts show when the config call fails');
    ok(!(await p.isVisible('#om-express')), 'no Express row');
    await fill(p); await p.click('#om-go'); await p.waitForTimeout(300);
    ok(await p.isVisible('#om-status') && posts.length === 0, 'notice shown and nothing sent');
  });
  await session('Solo Dev', {}, async (p) => {
    await openModal(p, 'free');
    ok(!(await p.isVisible('#om-express')) && !(await p.isVisible('#om-total')), 'no Express row and no total');
    ok(await text(p, '#om-price') === 'No payment needed. Delivered within 1 day.', 'free text unchanged');
    ok(await text(p, '#om-go span') === 'Get Solo Dev Analysis', 'free button unchanged');
  });

  const clayOf = (p) => p.evaluate(() => { const t = document.createElement('i'); t.style.color = 'var(--clay)'; document.body.appendChild(t); const c = getComputedStyle(t).color; t.remove(); return c; });
  await session('Express switch', {}, async (p) => {
    await openModal(p, 'standard');
    const sw = p.locator('input[name=express]');
    ok(await sw.getAttribute('role') === 'switch', 'the Express control is a switch');
    ok(await p.evaluate(() => getComputedStyle(document.querySelector('input[name=express]')).appearance === 'none'), 'native checkbox drawn as a switch');
    const clay = await clayOf(p);
    const off = await p.evaluate(() => getComputedStyle(document.querySelector('input[name=express]')).backgroundColor);
    ok(off !== clay, 'off track is not clay (' + off + ')');
    await p.click('#om-express'); await p.waitForTimeout(250);
    const on = await p.evaluate(() => getComputedStyle(document.querySelector('input[name=express]')).backgroundColor);
    ok(on === clay, 'on track is clay: ' + on + ' = ' + clay);
    const knob = await p.evaluate(() => getComputedStyle(document.querySelector('input[name=express]'), '::after').transform);
    ok(/matrix\(1, 0, 0, 1, 18, 0\)/.test(knob), 'the knob moves to the right when on: ' + knob);
    const box = await sw.boundingBox();
    ok(Math.abs(box.width - 46) < 1 && Math.abs(box.height - 28) < 1, 'switch is 46 x 28: ' + Math.round(box.width) + ' x ' + Math.round(box.height));
    await p.click('#om-express'); await p.waitForTimeout(250);
    ok(!(await sw.isChecked()), 'a second click turns it off');
    await p.focus('input[name=express]'); await p.keyboard.press('Space'); await p.waitForTimeout(150);
    ok(await sw.isChecked(), 'the Space key toggles it');
  });
  await session('switch motion', {}, async (p) => {
    await openModal(p, 'standard');
    await p.evaluate(() => { document.querySelectorAll('style').forEach((s) => { if (s.textContent.indexOf('animation:none!important') >= 0) s.remove(); }); });
    ok(await p.evaluate(() => getComputedStyle(document.querySelector('input[name=express]')).transitionDuration.split(',').every((d) => d.trim() === '0.18s')), 'switch transitions last 180ms');
    ok(await p.evaluate(() => getComputedStyle(document.querySelector('input[name=express]'), '::after').transitionDuration.split(',').every((d) => d.trim() === '0.18s')), 'knob transitions last 180ms');
    const box = await p.locator('input[name=express]').boundingBox();
    await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await p.mouse.down(); await p.waitForTimeout(350);
    const t = await p.evaluate(() => getComputedStyle(document.querySelector('input[name=express]')).transform);
    await p.mouse.up();
    ok(/matrix\(0\.94/.test(t), ':active scales the switch to 0.94, got ' + t);
  });
  await session('checkbox rows', { ctx: { reducedMotion: 'reduce' } }, async (p) => {
    await p.evaluate(() => { document.querySelectorAll('style').forEach((s) => { if (s.textContent.indexOf('animation:none!important') >= 0) s.remove(); }); });
    ok(await p.evaluate(() => getComputedStyle(document.querySelector('#om-news')).transitionDuration.split(',').every((d) => d.trim() === '0s')), 'newsletter checkbox row has no transition under reduced motion');
  });
  await session('switch under reduced motion', { ctx: { reducedMotion: 'reduce' } }, async (p) => {
    await openModal(p, 'standard');
    await p.evaluate(() => { document.querySelectorAll('style').forEach((s) => { if (s.textContent.indexOf('animation:none!important') >= 0) s.remove(); }); });
    ok(await p.evaluate(() => getComputedStyle(document.querySelector('input[name=express]')).transitionDuration.split(',').every((d) => d.trim() === '0s')), 'no switch transition under reduced motion');
    ok(await p.evaluate(() => getComputedStyle(document.querySelector('input[name=express]'), '::after').transitionDuration.split(',').every((d) => d.trim() === '0s')), 'no knob transition under reduced motion');
    ok(await p.evaluate(() => getComputedStyle(document.querySelector('#om-express')).transitionDuration.split(',').every((d) => d.trim() === '0s')), 'no row transition under reduced motion');
  });

  /* Sample gallery: slides of a Publisher Analysis, under the three tier cards. They are for looking at only. */
  await session('sample gallery, desktop', { config: null }, async (p) => {
    const order = await p.evaluate(() => [...document.querySelectorAll('main > section')].map((s) => s.id).join(','));
    ok(/versions,sample,faq/.test(order), 'the sample sits right under the tier cards: ' + order);
    const slides = await p.$$eval('.sa-reel:not([aria-hidden]) .sa-slide img', (els) => els.map((e) => ({ alt: !!e.alt, w: e.getAttribute('width'), h: e.getAttribute('height'), lazy: e.loading })));
    ok(slides.length >= 10 && slides.every((s) => s.alt && s.w && s.h && s.lazy === 'lazy'), slides.length + ' slides, each with alt text, size and lazy loading');
    ok(await p.evaluate(() => document.querySelectorAll('.sa-reel[aria-hidden="true"]').length) === 0, 'the loop copy is not made until the gallery is near');
    await p.evaluate(() => document.getElementById('sample').scrollIntoView()); await p.waitForTimeout(1500);
    ok(await p.evaluate(() => document.querySelectorAll('.sa-reel[aria-hidden="true"]').length) === 1 && await p.evaluate(() => getComputedStyle(document.querySelector('.sa-reel[aria-hidden="true"]')).display) === 'none', 'the loop copy exists once the gallery is near, and stays hidden on desktop');
    const mid = Math.floor(slides.length / 2) - 1;
    const top = (i) => p.evaluate((n) => document.querySelectorAll('.sa-reel:not([aria-hidden]) .sa-slide')[n].getBoundingClientRect().top, i);
    const rect = (i) => p.evaluate((n) => { const r = document.querySelectorAll('.sa-reel:not([aria-hidden]) .sa-slide')[n].getBoundingClientRect(); return { w: r.width, h: r.height }; }, i);
    const before = [await top(mid), await top(0)];
    const restRect = await rect(mid);
    /* A slide covers most of the next one, so only its right strip can be pointed at. */
    const strip = async (i) => { const b = await (await p.$$('.sa-reel:not([aria-hidden]) .sa-slide'))[i].boundingBox(); return { x: b.x + b.width - 8, y: b.y + b.height / 2 }; };
    const pt = await strip(mid);
    await p.mouse.move(pt.x, pt.y); await p.waitForTimeout(600);
    const after = [await top(mid), await top(0)];
    const hoverRect = await rect(mid);
    ok(hoverRect.w > restRect.w * 1.3, 'the hovered slide grows (' + Math.round(restRect.w) + ' to ' + Math.round(hoverRect.w) + ' px wide)');
    ok(Math.abs(hoverRect.w / hoverRect.h - 16 / 9) < 0.12, 'the hovered slide is straight, 16 by 9 (ratio ' + (hoverRect.w / hoverRect.h).toFixed(2) + ')');
    ok(restRect.w / restRect.h < 16 / 9 - 0.2, 'a slide at rest is tilted (ratio ' + (restRect.w / restRect.h).toFixed(2) + ')');
    ok(after[0] < before[0] - 10, 'hover lifts the hovered slide (' + Math.round(before[0]) + ' to ' + Math.round(after[0]) + ')');
    ok(after[1] >= before[1] - 1, 'hover does not lift the others (' + Math.round(before[1]) + ' to ' + Math.round(after[1]) + ')');
    await p.waitForTimeout(500);
    ok(Math.abs((await top(mid)) - after[0]) < 1.5, 'the lifted slide stays put, no flicker');
    await p.mouse.click(pt.x, pt.y); await p.waitForTimeout(400);
    ok(await p.evaluate(() => !document.querySelector('dialog[open]')), 'a click on a slide opens nothing');
    ok(await p.evaluate(() => !document.getElementById('sa-lightbox') && !document.querySelector('.sa-gallery a, .sa-gallery button')), 'the slides are not links or buttons, and there is no viewer');
    ok(await p.evaluate(() => getComputedStyle(document.querySelector('.sa-slide')).cursor !== 'zoom-in'), 'the pointer does not suggest zooming');
    ok(await p.evaluate(() => !/full size/i.test(document.getElementById('sample').textContent)), 'the text no longer says to open a slide full size');
    ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), 'no horizontal overflow');
  });
  await session('sample gallery, phone', { ctx: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }, config: null }, async (p) => {
    await p.evaluate(() => document.getElementById('sample').scrollIntoView()); await p.waitForTimeout(800);
    const info = await p.evaluate(() => { const g = document.querySelector('.sa-gallery'), t = g.querySelector('.sa-track'); return { marquee: g.classList.contains('is-marquee'), reels: g.querySelectorAll('.sa-reel').length, trackW: Math.round(t.getBoundingClientRect().width), hidden: g.querySelector('.sa-reel[aria-hidden="true"]') && getComputedStyle(g.querySelector('.sa-reel[aria-hidden="true"]')).display, over: document.documentElement.scrollWidth > innerWidth + 1 }; });
    ok(info.marquee && info.reels === 2 && info.trackW > 800 && info.hidden === 'flex', 'the phone strip loops, two copies side by side: ' + JSON.stringify({ reels: info.reels, trackWidth: info.trackW }));
    ok(!info.over, 'no horizontal overflow on the phone');
    await p.evaluate(() => document.querySelector('.sa-gallery .sa-slide').click()); await p.waitForTimeout(300);
    ok(await p.evaluate(() => !document.querySelector('dialog[open]')), 'a tap on a slide opens nothing on the phone');
  });
  await session('sample gallery, reduced motion', { ctx: { reducedMotion: 'reduce' }, config: null }, async (p) => {
    const info = await p.evaluate(() => { const g = document.querySelector('.sa-gallery'); return { marquee: g.classList.contains('is-marquee'), reels: g.querySelectorAll('.sa-reel').length, anim: getComputedStyle(document.querySelector('.sa-slide')).animationName }; });
    ok(!info.marquee && info.reels === 1, 'no loop with reduced motion: a plain strip');
    ok(info.anim === 'none', 'no entrance animation with reduced motion');
  });

  for (const vp of [{ w: 1280, h: 900 }, { w: 390, h: 844 }]) {
    await session('layout ' + vp.w + 'px', { ctx: { viewport: { width: vp.w, height: vp.h } } }, async (p) => {
      const inside = await p.evaluate(() => [...document.querySelectorAll('.sa-tier')].map((t) => {
        const r = t.getBoundingClientRect(), a = t.querySelector('.sa-amts').getBoundingClientRect(), b = t.querySelector('.sa-buy').getBoundingClientRect(), h = t.querySelector('h3');
        return a.left >= r.left - 1 && a.right <= r.right + 1 && b.left >= r.left && b.right <= r.right && h.scrollWidth <= h.clientWidth + 1;
      }));
      ok(inside.every(Boolean), 'prices, titles and buttons stay inside the cards');
      ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), 'no horizontal overflow');
      const ys = await p.$$eval('.sa-price', (els) => els.map((e) => Math.round(e.getBoundingClientRect().bottom - e.closest('.sa-tier').getBoundingClientRect().top)));
      if (vp.w >= 1000) ok(Math.max(...ys) - Math.min(...ys) <= 1, 'price separators aligned ' + ys);
      const amtsWide = await p.$$eval('.sa-tier .sa-amts', (els) => els.map((e) => e.scrollWidth <= e.parentElement.clientWidth + 1));
      ok(amtsWide.every(Boolean), 'the three amounts fit on one line in every card');
      if (SHOTS) { await p.evaluate(() => document.getElementById('versions').scrollIntoView()); await p.waitForTimeout(250); await p.screenshot({ path: path.join(SHOTS, 'cards-' + vp.w + '.png') }); }
      for (const tier of ['standard', 'premium']) {
        await openModal(p, tier); await p.click('#om-express'); await p.waitForTimeout(300);
        const geo = await p.evaluate(() => { const d = document.getElementById('order-modal').getBoundingClientRect(), vh = innerHeight; const ok2 = (s) => { const x = document.querySelector(s).getBoundingClientRect(); return x.top >= Math.max(0, d.top) - 1 && x.bottom <= Math.min(vh, d.bottom) + 1 && x.left >= d.left - 1 && x.right <= d.right + 1; }; return { express: ok2('#om-express'), sw: ok2('input[name=express]'), total: ok2('#om-total'), go: ok2('#om-go') }; });
        ok(geo.express && geo.sw && geo.total && geo.go, vp.w + 'px ' + tier + ': Express row, switch, total and pay button fully visible ' + JSON.stringify(geo));
        const wrap = await p.evaluate(() => { const t = document.getElementById('om-total'); return t.scrollWidth <= t.clientWidth + 1; });
        ok(wrap, vp.w + 'px ' + tier + ': the total line is not cut off');
        const copyW = await p.evaluate(() => document.getElementById('om-express-copy') ? 0 : document.querySelector('.om-express-copy').getBoundingClientRect().width);
        ok(copyW >= 180, vp.w + 'px ' + tier + ': the Express delivery text keeps a readable width (' + Math.round(copyW) + 'px)');
        if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'modal-' + tier + '-' + vp.w + '.png') });
        await p.keyboard.press('Escape'); await p.waitForTimeout(900);
      }
    });
  }

  // Tier cards: a deck on the phone (like the homepage testimonials), side by side on wide screens
  await session('tier deck phone', { ctx: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } }, async (p) => {
    await p.evaluate(() => document.getElementById('versions').scrollIntoView()); await p.waitForTimeout(400);
    const front = () => p.evaluate(() => [...document.querySelectorAll('.sa-tier')].map((c) => c.classList.contains('is-front')));
    const st = () => p.evaluate(() => ({ h: [...document.querySelectorAll('.sa-tier')].map((c) => Math.round(c.getBoundingClientRect().height)), inert: [...document.querySelectorAll('.sa-tier')].map((c) => c.inert), wide: document.documentElement.scrollWidth > innerWidth, layout: document.querySelector('.sd-wrap').dataset.layout }));
    let s = await st();
    ok(s.layout === 'deck', 'phone: the tier cards are a deck');
    ok(s.h.every((h) => h === s.h[0]), 'phone: the three cards share one height');
    ok(s.inert.join() === 'false,true,true' && !s.wide, 'phone: only the front card is active, no sideways scroll');
    ok((await front()).join() === 'true,false,false', 'phone: Solo Dev is in front');
    await p.click('[data-sd-next]'); await p.waitForTimeout(500);
    ok((await front()).join() === 'false,true,false', 'phone: next arrow brings Indie to the front');
    await p.click('.sd-dot:nth-child(3)'); await p.waitForTimeout(400);
    ok((await front()).join() === 'false,false,true', 'phone: a dot brings Publisher to the front');
    await p.click('[data-sd-prev]'); await p.waitForTimeout(400);
    ok((await front()).join() === 'false,true,false', 'phone: previous arrow steps back');
  });
  await session('tier cards wide', { ctx: { viewport: { width: 1280, height: 900 } } }, async (p) => {
    const d = await p.evaluate(() => ({ layout: document.querySelector('.sd-wrap').dataset.layout, pos: [...document.querySelectorAll('.sa-tier')].map((c) => getComputedStyle(c).position), inert: [...document.querySelectorAll('.sa-tier')].some((c) => c.inert), tops: [...document.querySelectorAll('.sa-tier')].map((c) => Math.round(c.getBoundingClientRect().top)), ctl: getComputedStyle(document.querySelector('.sd-controls')).display }));
    ok(d.layout === 'grid' && d.pos.every((x) => x === 'relative') && !d.inert && d.ctl === 'none', 'wide: three plain cards, no arrows');
    ok(d.tops[0] === d.tops[1] && d.tops[1] === d.tops[2], 'wide: the cards sit side by side');
  });

  await browser.close(); server.close();
  console.log(failed ? failed + ' FAILED' : 'ALL OK');
  process.exit(failed ? 1 : 0);
})();

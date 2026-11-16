// Browser test for steam-analysis/index.html (currency selector, Express, order modal).
// Needs Playwright (require('playwright')). Run from the repo root:  node scripts/steam-analysis-browser-test.cjs
// The order Worker is mocked; nothing leaves the machine. Screenshots go to the folder given as the first argument.
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
  amounts: { eur: { standard: 99, premium: 299 }, usd: { standard: 109, premium: 329 }, gbp: { standard: 89, premium: 249 } },
  express: { eur: { standard: 49, premium: 99 }, usd: { standard: 54, premium: 109 }, gbp: { standard: 44, premium: 82 } },
};
const KILL = '*,*::before,*::after{animation:none!important;transition:none!important}[data-reveal],.blur-reveal{opacity:1!important;filter:none!important;transform:none!important}';
const SYM = { eur: '€', usd: '$', gbp: '£' };
const TOTAL = { standard: { eur: 148, usd: 163, gbp: 133 }, premium: { eur: 398, usd: 438, gbp: 331 } };
const BASE = { standard: { eur: 99, usd: 109, gbp: 89 }, premium: { eur: 299, usd: 329, gbp: 249 } };
const EXPR = { standard: { eur: 49, usd: 54, gbp: 44 }, premium: { eur: 99, usd: 109, gbp: 82 } };

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
    if (opts.init) await ctx.addInitScript(opts.init);
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
  const openModal = async (p, v) => { await p.click('[data-order="' + v + '"]'); await p.waitForSelector('#order-modal[open]'); await p.waitForTimeout(1300); await p.addStyleTag({ content: KILL }); await p.waitForTimeout(300); };
  const pickPage = async (p, cur) => { await p.click('.sa-cur-row label:has(input[value="' + cur + '"])'); await p.waitForTimeout(100); };
  const text = (p, sel) => p.evaluate((s) => document.querySelector(s).textContent.trim().replace(/\s+/g, ' '), sel);
  const visibleAmounts = (p) => p.$$eval('.sa-tier .sa-amts.is-multi', (els) => els.map((e) => [...e.children].filter((c) => c.getAttribute('data-cur') && getComputedStyle(c).display !== 'none').map((c) => c.textContent.trim()).join('')));
  const sepsHidden = (p) => p.$$eval('.sa-tier .sa-amts.is-multi .sep', (els) => els.every((e) => getComputedStyle(e).display === 'none'));

  // 1. Default and the three cards in each currency
  await session('cards and selector', {}, async (p) => {
    ok(await p.evaluate(() => document.querySelector('.sa-cur-row input[value="eur"]').checked), 'EUR is the default');
    ok(JSON.stringify(await visibleAmounts(p)) === JSON.stringify(['€99', '€299']), 'EUR cards show €99 and €299, ' + JSON.stringify(await visibleAmounts(p)));
    ok(await sepsHidden(p), 'separators are hidden when one currency shows');
    ok(await text(p, '.sa-tier.free .sa-amts') === 'Free', 'Solo Dev still reads Free');
    for (const c of ['usd', 'gbp', 'eur']) {
      await pickPage(p, c);
      const got = await visibleAmounts(p);
      const want = [SYM[c] + BASE.standard[c], SYM[c] + BASE.premium[c]];
      ok(JSON.stringify(got) === JSON.stringify(want), c + ' cards show ' + want.join(' and ') + ', got ' + got.join(' and '));
    }
    ok(await p.evaluate(() => document.documentElement.getAttribute('data-currency')) === 'eur', 'data-currency follows the choice');
    // keyboard: arrow keys move between options
    await p.focus('.sa-cur-row input[value="eur"]'); await p.keyboard.press('ArrowRight');
    ok(await p.evaluate(() => document.querySelector('.sa-cur-row input[value="usd"]').checked), 'arrow key moves to USD');
    ok(JSON.stringify(await visibleAmounts(p)) === JSON.stringify(['$109', '$329']), 'cards follow the keyboard choice');
  });

  // 2. Remembered choice, and storage that throws
  await session('remembered choice', {}, async (p) => {
    await pickPage(p, 'gbp');
    await p.reload(); await p.waitForTimeout(400);
    ok(await p.evaluate(() => document.querySelector('.sa-cur-row input[value="gbp"]').checked), 'GBP is still selected after a reload');
    ok(JSON.stringify(await visibleAmounts(p)) === JSON.stringify(['£89', '£249']), 'cards show the remembered currency');
  });
  await session('storage blocked', { init: () => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } }); } }, async (p) => {
    ok(JSON.stringify(await visibleAmounts(p)) === JSON.stringify(['€99', '€299']), 'page works in EUR when localStorage throws');
    await pickPage(p, 'usd');
    ok(JSON.stringify(await visibleAmounts(p)) === JSON.stringify(['$109', '$329']), 'the selector still works when localStorage throws');
  });

  // 3. Modal: every tier, currency and Express state
  await session('modal prices, Express and totals', { init: () => localStorage.clear() }, async (p, posts) => {
    for (const tier of ['standard', 'premium']) {
      for (const c of ['eur', 'usd', 'gbp']) {
        await pickPage(p, c);
        await openModal(p, tier);
        const modalCur = await p.evaluate(() => document.querySelector('#om-cur input:checked').value);
        ok(modalCur === c, tier + '/' + c + ': modal selector shows ' + c);
        ok(await text(p, '#om-price') === SYM[c] + BASE[tier][c] + '. Pay at the start with Stripe.', tier + '/' + c + ': price row ' + await text(p, '#om-price'));
        ok(await text(p, '#om-go span') === 'Pay ' + SYM[c] + BASE[tier][c] + ' with Stripe', tier + '/' + c + ': button without Express');
        ok(await text(p, '#om-express-price') === '+' + SYM[c] + EXPR[tier][c], tier + '/' + c + ': Express row amount');
        ok(await text(p, '#om-express-time') === (tier === 'standard' ? 'Delivered in 1 business day instead of 2' : 'Delivered in 2 business days instead of 3'), tier + '/' + c + ': Express delivery text');
        ok(!(await p.isVisible('#om-total')), tier + '/' + c + ': no total while unticked');
        await p.click('#om-express');
        ok(await text(p, '#om-total') === 'Total with Express: ' + SYM[c] + TOTAL[tier][c], tier + '/' + c + ': total ' + await text(p, '#om-total'));
        ok(await text(p, '#om-go span') === 'Pay ' + SYM[c] + TOTAL[tier][c] + ' with Stripe', tier + '/' + c + ': button ' + await text(p, '#om-go span'));
        await p.keyboard.press('Escape'); await p.waitForTimeout(900);
      }
    }
    // submit payload follows the chosen currency and Express
    await pickPage(p, 'usd'); await openModal(p, 'standard'); await p.click('#om-express');
    await p.fill('#om-steam', 'https://store.steampowered.com/app/123/x/'); await p.fill('#om-email', 'a@b.co'); await p.check('input[name=waiver]');
    await Promise.all([p.waitForURL(/paid=1/), p.click('#om-go')]);
    ok(posts.length === 1 && posts[0].currency === 'usd' && posts[0].express === true && posts[0].version === 'standard', 'POST carries usd and express: ' + JSON.stringify(posts[0]));
  });

  // 4. Changing the currency inside the modal
  await session('currency changed inside the modal', { init: () => localStorage.clear() }, async (p) => {
    await openModal(p, 'premium'); await p.click('#om-express');
    ok(await text(p, '#om-total') === 'Total with Express: €398', 'EUR total first');
    await p.click('#om-cur label:has(input[value="gbp"])'); await p.waitForTimeout(150);
    ok(await text(p, '#om-total') === 'Total with Express: £331', 'GBP total after switching in the modal: ' + await text(p, '#om-total'));
    ok(await text(p, '#om-go span') === 'Pay £331 with Stripe', 'button follows');
    ok(await p.evaluate(() => document.querySelector('.sa-cur-row input[value="gbp"]').checked), 'the page selector follows the modal');
    ok(await p.evaluate(() => document.querySelector('#om-express input, input[name=express]').checked), 'Express stays ticked when the new currency has Express');
  });

  // 5. A currency without an Express amount
  const noGbp = { ...FULL, express: { eur: FULL.express.eur, usd: FULL.express.usd } };
  await session('currency without Express', { init: () => localStorage.clear(), config: noGbp }, async (p) => {
    await pickPage(p, 'gbp'); await openModal(p, 'standard');
    ok(!(await p.isVisible('#om-express')), 'GBP without Express amount: no Express row');
    ok(!(await p.isVisible('#om-total')), 'no total line');
    ok(await text(p, '#om-go span') === 'Pay £89 with Stripe', 'button shows the base price: ' + await text(p, '#om-go span'));
    ok(await p.evaluate(() => document.querySelector('input[name=express]').disabled), 'the Express input is disabled');
    await p.click('#om-cur label:has(input[value="eur"])'); await p.waitForTimeout(150);
    ok(await p.isVisible('#om-express'), 'switching to EUR brings the Express row back');
    await p.click('#om-express');
    await p.click('#om-cur label:has(input[value="gbp"])'); await p.waitForTimeout(150);
    ok(!(await p.isVisible('#om-express')) && !(await p.evaluate(() => document.querySelector('input[name=express]').checked)), 'switching to GBP hides Express and unticks it');
  });
  await session('Express off', { init: () => localStorage.clear(), config: { ...FULL, enabled: false, express: {} } }, async (p) => {
    await pickPage(p, 'usd'); await openModal(p, 'premium');
    ok(!(await p.isVisible('#om-express')), 'no Express row when Express is off');
    ok(await text(p, '#om-go span') === 'Pay $329 with Stripe', 'USD base price on the button');
  });
  await session('Worker unreachable', { init: () => localStorage.clear(), config: null }, async (p, posts) => {
    await pickPage(p, 'usd'); await openModal(p, 'standard');
    ok(await text(p, '#om-price') === '$109. Pay at the start with Stripe.', 'built-in amounts show when the config call fails');
    ok(!(await p.isVisible('#om-express')), 'no Express row');
    await p.fill('#om-steam', 'https://store.steampowered.com/app/123/x/'); await p.fill('#om-email', 'a@b.co'); await p.check('input[name=waiver]'); await p.click('#om-go'); await p.waitForTimeout(300);
    ok(await p.isVisible('#om-status') && posts.length === 0, 'notice shown and nothing sent');
  });

  // 6. Solo Dev has no currency and no Express
  await session('Solo Dev', { init: () => localStorage.clear() }, async (p) => {
    await openModal(p, 'free');
    ok(!(await p.isVisible('#om-cur')), 'no currency selector for Solo Dev');
    ok(!(await p.isVisible('#om-express')) && !(await p.isVisible('#om-total')), 'no Express row and no total');
    ok(await text(p, '#om-price') === 'No payment needed. Delivered within 1 day.', 'free text unchanged');
  });

  // 7. Motion: 180ms hover, :active scale, reduced motion
  await session('motion', { init: () => localStorage.clear() }, async (p) => {
    await p.evaluate(() => { document.querySelectorAll('style').forEach((s) => { if (s.textContent.indexOf('animation:none!important') >= 0) s.remove(); }); });
    ok(await p.evaluate(() => getComputedStyle(document.querySelector('.sa-cur-row span')).transitionDuration.split(',').every((d) => d.trim() === '0.18s')), 'selector transitions last 180ms');
    const box = await p.locator('.sa-cur-row label:has(input[value="usd"])').boundingBox();
    await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await p.mouse.down(); await p.waitForTimeout(350);
    const t = await p.evaluate(() => getComputedStyle(document.querySelector('.sa-cur-row label:has(input[value="usd"]) span')).transform);
    await p.mouse.up();
    ok(/matrix\(0\.94/.test(t), ':active scales the option to 0.94, got ' + t);
  });
  await session('reduced motion', { ctx: { reducedMotion: 'reduce' }, init: () => localStorage.clear() }, async (p) => {
    await p.evaluate(() => { document.querySelectorAll('style').forEach((s) => { if (s.textContent.indexOf('animation:none!important') >= 0) s.remove(); }); });
    ok(await p.evaluate(() => getComputedStyle(document.querySelector('.sa-cur-row span')).transitionDuration.split(',').every((d) => d.trim() === '0s')), 'no transition under reduced motion');
    const box = await p.locator('.sa-cur-row label:has(input[value="usd"])').boundingBox();
    await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await p.mouse.down(); await p.waitForTimeout(200);
    const t = await p.evaluate(() => getComputedStyle(document.querySelector('.sa-cur-row label:has(input[value="usd"]) span')).transform);
    await p.mouse.up();
    ok(t === 'none', 'no :active scale under reduced motion, got ' + t);
  });

  // 8. Layout, mobile, screenshots (animations off)
  for (const vp of [{ w: 1280, h: 900 }, { w: 390, h: 844 }]) {
    await session('layout ' + vp.w + 'px', { ctx: { viewport: { width: vp.w, height: vp.h } }, init: () => localStorage.clear() }, async (p) => {
      for (const c of ['eur', 'usd', 'gbp']) {
        await pickPage(p, c);
        const bad = await p.evaluate(() => [...document.querySelectorAll('.sa-tier')].map((t) => {
          const r = t.getBoundingClientRect(), a = t.querySelector('.sa-amts').getBoundingClientRect(), b = t.querySelector('.sa-buy').getBoundingClientRect(), h = t.querySelector('h3');
          return a.left >= r.left - 1 && a.right <= r.right + 1 && b.left >= r.left && b.right <= r.right && h.scrollWidth <= h.clientWidth + 1;
        }));
        ok(bad.every(Boolean), c + ': prices, titles and buttons stay inside the cards');
        ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), c + ': no horizontal overflow');
        const ys = await p.$$eval('.sa-price', (els) => els.map((e) => Math.round(e.getBoundingClientRect().bottom - e.closest('.sa-tier').getBoundingClientRect().top)));
        if (vp.w >= 1000) ok(Math.max(...ys) - Math.min(...ys) <= 1, c + ': price separators aligned ' + ys);
      }
      await pickPage(p, 'usd');
      if (SHOTS) {
        await p.evaluate(() => document.getElementById('versions').scrollIntoView()); await p.waitForTimeout(250);
        await p.screenshot({ path: path.join(SHOTS, 'cards-usd-' + vp.w + '.png') });
      }
      await openModal(p, 'standard'); await p.click('#om-express'); await p.waitForTimeout(300);
      const geo = await p.evaluate(() => { const d = document.getElementById('order-modal').getBoundingClientRect(), vh = innerHeight; const r = (s) => document.querySelector(s).getBoundingClientRect(); const inside = (x) => x.top >= Math.max(0, d.top) - 1 && x.bottom <= Math.min(vh, d.bottom) + 1 && x.left >= d.left && x.right <= d.right; return { cur: inside(r('#om-cur')), total: inside(r('#om-total')), go: inside(r('#om-go')), express: inside(r('#om-express')) }; });
      ok(geo.total && geo.go && geo.express, vp.w + 'px modal: Express row, total and pay button are fully visible ' + JSON.stringify(geo));
      if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'modal-indie-usd-' + vp.w + '.png') });
      await p.evaluate(() => { const m = document.getElementById('order-modal'); m.scrollTop = 0; }); await p.waitForTimeout(200);
      const top = await p.evaluate(() => { const d = document.getElementById('order-modal').getBoundingClientRect(), c = document.getElementById('om-cur').getBoundingClientRect(); return c.left >= d.left && c.right <= d.right && c.top >= d.top; });
      ok(top, vp.w + 'px modal: the currency selector fits inside the modal');
      if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'modal-top-' + vp.w + '.png') });
      await p.keyboard.press('Escape'); await p.waitForTimeout(800);
      await openModal(p, 'premium'); await p.click('#om-cur label:has(input[value="gbp"])'); await p.click('#om-express'); await p.waitForTimeout(300);
      if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'modal-publisher-gbp-' + vp.w + '.png') });
    });
  }

  await browser.close(); server.close();
  console.log(failed ? failed + ' FAILED' : 'ALL OK');
  process.exit(failed ? 1 : 0);
})();

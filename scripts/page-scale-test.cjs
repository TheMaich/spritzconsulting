/* Checks that /steam-analysis/ gets the same page scale as the homepage (assets/js/page-scale.js against
   assets/js/frame-fit.js) at a set of window sizes, and that the scaled page stays inside the window.
   Run it after changing the homepage hero, then regenerate the table if it fails:
     node scripts/page-scale-test.cjs
     node scripts/measure-home-scale.cjs */
const { chromium } = require('playwright');
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
const server = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
}).listen(0);
let failed = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) failed++; };
const SIZES = [[1024, 768], [1191, 909], [1251, 912], [1280, 720], [1366, 768], [1440, 900], [1536, 864], [1600, 900], [1920, 1080], [2560, 1440], [1700, 1000], [1300, 1100]];
(async () => {
  const browser = await chromium.launch();
  const base = 'http://127.0.0.1:' + server.address().port;
  for (const [w, h] of SIZES) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const home = await ctx.newPage(), steam = await ctx.newPage();
    await steam.route('**/api/order/config', (r) => r.fulfill({ status: 404, body: 'nf' }));
    await home.goto(base + '/'); await steam.goto(base + '/steam-analysis/');
    await home.waitForTimeout(2800); await steam.waitForTimeout(1200);
    const kh = await home.evaluate(() => window.__frameFit && window.__frameFit.k);
    const ks = await steam.evaluate(() => window.__pageScale && window.__pageScale.k);
    ok(typeof kh === 'number' && typeof ks === 'number' && Math.abs(kh - ks) <= 0.02, w + 'x' + h + ': homepage scale ' + kh + ', Steam page scale ' + ks);
    const m = await steam.evaluate(() => ({ wide: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1, hdr: Math.round(document.getElementById('site-header').getBoundingClientRect().height), shown: !document.documentElement.classList.contains('ff-wait') }));
    const hh = await home.evaluate(() => Math.round(document.getElementById('site-header').getBoundingClientRect().height));
    ok(!m.wide && m.shown, w + 'x' + h + ': the Steam page does not scroll sideways and is shown');
    ok(Math.abs(m.hdr - hh) <= 2, w + 'x' + h + ': header height ' + m.hdr + ' against ' + hh + ' on the homepage');
    // the sample gallery, which uses vw, stays inside the window
    await steam.evaluate(() => document.getElementById('sample').scrollIntoView()); await steam.waitForTimeout(1200);
    const g = await steam.evaluate(() => { const r = document.querySelector('.sa-reel').getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right), innerWidth]; });
    ok(g[0] >= -1 && g[1] <= g[2] + 1, w + 'x' + h + ': the gallery stays inside the window ' + g.join(' / '));
    await ctx.close();
  }
  // below the limits nothing is scaled
  for (const [w, h] of [[800, 900], [1280, 500]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } }), p = await ctx.newPage();
    await p.route('**/api/order/config', (r) => r.fulfill({ status: 404, body: 'nf' }));
    await p.goto(base + '/steam-analysis/'); await p.waitForTimeout(800);
    ok(await p.evaluate(() => window.__pageScale && window.__pageScale.k === 1 && !document.documentElement.classList.contains('ff-wait') && document.querySelector('main').style.zoom === ''), w + 'x' + h + ': not scaled');
    await ctx.close();
  }
  await browser.close(); server.close();
  console.log(failed ? failed + ' FAILED' : 'ALL OK'); process.exit(failed ? 1 : 0);
})();

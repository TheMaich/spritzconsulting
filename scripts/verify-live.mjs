// Usage: node scripts/verify-live.mjs [baseUrl] [--resolve <ip>]   (default $VERIFY_BASE_URL or https://spritzconsulting.com; --resolve pins the host to one IP, e.g. GitHub Pages 185.199.108.153, to check the origin past Cloudflare)
//
// Checks every sitemap URL plus /, /about/ and /resources/ on the live site: status, head tags,
// robots, breadcrumbs, About in the header or footer, "Updated" dates, images, and links to the private tools
// index or to noindex pages. Then checks sitemap.xml itself. Prints a pass/fail table and exits 1
// on any failure. No dependencies (Node 18+). Plain URLs only: Cloudflare ignores query strings.

import https from 'node:https';
import http from 'node:http';

const args = process.argv.slice(2);
const ri = args.indexOf('--resolve');
const PIN = ri >= 0 ? args.splice(ri, 2)[1] : null;
const BASE = (args[0] || process.env.VERIFY_BASE_URL || 'https://spritzconsulting.com').replace(/\/$/, '');
const HOST = new URL(BASE).host;
const TOOLS_INDEX = '/resources/tools/';

// ---------- fetching ----------
function get(url, redirects = 3) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const lib = u.protocol === 'http:' ? http : https;
    const opts = { method: 'GET', headers: { 'user-agent': 'spritz-verify-live/1.0', accept: '*/*' }, timeout: 20000 };
    // Pinned origin checks: GitHub Pages answers with its own certificate, not one for the
    // custom domain, so certificate checks are off for these requests only.
    if (PIN && u.host === HOST) { opts.lookup = (h, o, cb) => (o && o.all ? cb(null, [{ address: PIN, family: 4 }]) : cb(null, PIN, 4)); opts.rejectUnauthorized = false; }
    const req = lib.request(u, opts, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        return resolve(get(new URL(res.headers.location, u).href, redirects - 1));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => resolve({ status: 0, headers: {}, body: '', error: e.message }));
    req.end();
  });
}
const memo = new Map();
const fetchOnce = (url) => { if (!memo.has(url)) memo.set(url, get(url)); return memo.get(url); };
async function pool(items, n, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

// ---------- parsing ----------
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i')); return m ? decode(m[2] ?? m[3]) : null; };
const metaTags = (html) => html.match(/<meta\b[^>]*>/gi) || [];
function meta(html, key) {
  for (const t of metaTags(html)) if ((attr(t, 'name') || attr(t, 'property') || '').toLowerCase() === key) return attr(t, 'content');
  return null;
}
const linkRel = (html, rel) => { for (const t of html.match(/<link\b[^>]*>/gi) || []) if ((attr(t, 'rel') || '').toLowerCase() === rel) return attr(t, 'href'); return null; };
const title = (html) => { const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i); return m ? decode(m[1].trim()) : null; };
const toPath = (href, pageUrl) => { try { const u = new URL(href, pageUrl); return u.host === HOST ? u.pathname : null; } catch { return null; } };
const abs = (href, pageUrl) => { try { return new URL(href, pageUrl).href; } catch { return null; } };
const isNoindex = (html) => /noindex/i.test(meta(html, 'robots') || '');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// ---------- page checks ----------
const COLS = ['status', 'title', 'desc', 'canon', 'og', 'twitter', 'robots', 'crumbs', 'about', 'updated', 'images', 'links', 'gfonts'];

async function checkPage(path) {
  const url = BASE + path;
  const r = await fetchOnce(url);
  const res = { path, ok: {}, why: {}, html: r.body, updated: null };
  const set = (k, pass, why) => { res.ok[k] = pass; if (!pass) res.why[k] = why; };
  set('status', r.status === 200, `HTTP ${r.status || r.error}`);
  if (r.status !== 200) { for (const k of COLS.slice(1)) res.ok[k] = null; return res; }
  const h = r.body;

  const t = title(h); set('title', !!t && t.length <= 70, t ? `${t.length} chars` : 'missing');
  const d = meta(h, 'description'); set('desc', !!d, 'missing');
  const canon = linkRel(h, 'canonical');
  const want = 'https://spritzconsulting.com' + path;
  set('canon', canon === want, `canonical=${canon}`);
  set('og', !!meta(h, 'og:title') && !!meta(h, 'og:image'), 'og:title or og:image missing');
  const tw = ['twitter:card', 'twitter:title', 'twitter:description', 'twitter:image'].filter((k) => !meta(h, k));
  set('twitter', tw.length === 0, `missing ${tw.join(', ')}`);
  set('robots', !isNoindex(h), `robots=${meta(h, 'robots')}`);

  const crumbVisible = /<nav[^>]*class="[^"]*\bcrumbs\b/i.test(h), crumbLd = /"BreadcrumbList"/.test(h);
  if (path === '/') set('crumbs', true);
  else if (path === '/about/' || path === '/resources/') set('crumbs', crumbLd, 'no BreadcrumbList JSON-LD');
  else set('crumbs', crumbVisible && crumbLd, `visible=${crumbVisible} json-ld=${crumbLd}`);

  const chrome = (h.match(/<header[\s\S]*?<\/header>/i) || [''])[0] + (h.match(/<footer[\s\S]*?<\/footer>/i) || [''])[0];
  // The About page does not link to itself
  set('about', path === '/about/' || /href="(https:\/\/spritzconsulting\.com)?\/about\/"/.test(chrome), 'no /about/ link in the header or footer');

  // "Updated" must be a real date: <time datetime="YYYY-MM-DD">D Month YYYY</time>
  const ups = [...h.matchAll(/Updated\s*(?:<[^>]+>\s*)*([^<]{0,40})/g)];
  if (!ups.length) set('updated', true);
  else {
    const m = h.match(/Updated\s*(?:<(?!time)[^>]+>\s*)*<time datetime="(\d{4}-\d{2}-\d{2})">(\d{1,2}) ([A-Z][a-z]+) (\d{4})<\/time>/);
    let pass = false, why = `"Updated ${ups[0][1].trim()}" is not a <time datetime> date`;
    if (m) {
      const [y, mo, da] = m[1].split('-').map(Number);
      pass = MONTHS[mo - 1] === m[3] && da === Number(m[2]) && y === Number(m[4]);
      why = `datetime ${m[1]} does not match "${m[2]} ${m[3]} ${m[4]}"`;
      res.updated = m[1];
    }
    set('updated', pass, why);
  }

  const imgs = [...h.matchAll(/<img\b[^>]*>/gi)].map((m) => attr(m[0], 'src')).filter((s) => s && !s.startsWith('data:'));
  const ogs = ['og:image', 'twitter:image'].map((k) => meta(h, k)).filter(Boolean);
  const targets = [...new Set([...imgs, ...ogs].map((s) => abs(s, url)).filter(Boolean))];
  const bad = (await pool(targets, 6, async (u) => [u, (await fetchOnce(u)).status])).filter(([, s]) => s !== 200);
  set('images', bad.length === 0, bad.map(([u, s]) => `${s} ${u.replace(BASE, '')}`).join('; '));
  set('gfonts', !/fonts\.(googleapis|gstatic)\.com/.test(h), 'page still loads Google Fonts');

  res.links = [...new Set([...h.matchAll(/<a\b[^>]*>/gi)].map((m) => toPath(attr(m[0], 'href') || '', url)).filter(Boolean))];
  return res;
}

// ---------- main ----------
const failures = [];
const sm = await fetchOnce(BASE + '/sitemap.xml');
const xml = sm.status === 200 ? sm.body : '';
const entries = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => ({
  loc: (m[1].match(/<loc>([^<]+)<\/loc>/) || [])[1],
  lastmod: (m[1].match(/<lastmod>([^<]+)<\/lastmod>/) || [])[1] || null
}));
const smPaths = entries.map((e) => new URL(e.loc).pathname);
const paths = [...new Set(['/', '/about/', '/resources/', ...smPaths])];
const pages = await pool(paths, 4, checkPage);

// Links: never to the tools index; never to a noindex page (fetched to read its robots meta).
const checked = new Map(pages.map((p) => [p.path, p]));
const linked = [...new Set(pages.flatMap((p) => p.links || []))].filter((l) => /\.html$|\/$/.test(l));
const noindex = new Set();
await pool(linked.filter((l) => !checked.has(l)), 6, async (l) => { const r = await fetchOnce(BASE + l); if (r.status === 200 && isNoindex(r.body)) noindex.add(l); });
for (const p of pages) {
  if (!p.links) continue;
  const bad = p.links.filter((l) => l === TOOLS_INDEX || noindex.has(l));
  p.ok.links = bad.length === 0;
  if (bad.length) p.why.links = `links to ${bad.join(', ')}`;
}

// Table
const mark = (v) => (v === true ? 'ok' : v === false ? 'FAIL' : '-');
const w = Math.max(...paths.map((p) => p.length));
console.log(`\nverify-live: ${BASE}${PIN ? ` (pinned to ${PIN})` : ''}\n`);
console.log('page'.padEnd(w) + '  ' + COLS.map((c) => c.padEnd(7)).join(' '));
for (const p of pages) {
  console.log(p.path.padEnd(w) + '  ' + COLS.map((c) => mark(p.ok[c]).padEnd(7)).join(' '));
  for (const [k, why] of Object.entries(p.why)) failures.push(`${p.path}  ${k}: ${why}`);
}

// Sitemap checks
const smRows = [];
const smCheck = (name, pass, why) => { smRows.push([name, pass]); if (!pass) failures.push(`sitemap.xml  ${name}: ${why}`); };
smCheck('reachable', sm.status === 200, `HTTP ${sm.status}`);
smCheck('no changefreq/priority', !/<changefreq>|<priority>/.test(xml), 'changefreq or priority present');
smCheck('/about/ listed', smPaths.includes('/about/'), 'missing /about/');
smCheck('no tools index', !smPaths.includes(TOOLS_INDEX), 'lists /resources/tools/');
const smNoindex = smPaths.filter((p) => checked.get(p) && checked.get(p).ok.robots === false);
smCheck('no noindex URLs', smNoindex.length === 0, smNoindex.join(', '));
const smBad = smPaths.filter((p) => checked.get(p) && checked.get(p).ok.status === false);
smCheck('all URLs 200', smBad.length === 0, smBad.join(', '));
const stale = entries.filter((e) => { const p = checked.get(new URL(e.loc).pathname); return p && p.updated && e.lastmod && e.lastmod.slice(0, 10) < p.updated; })
  .map((e) => `${new URL(e.loc).pathname} lastmod ${e.lastmod} < Updated ${checked.get(new URL(e.loc).pathname).updated}`);
smCheck('lastmod >= visible Updated', stale.length === 0, stale.join('; '));
console.log('\nsitemap.xml');
for (const [n, pass] of smRows) console.log('  ' + n.padEnd(28) + mark(pass));

if (failures.length) { console.log(`\n${failures.length} failure(s):`); for (const f of failures) console.log('  - ' + f); process.exit(1); }
console.log('\nAll checks passed.');

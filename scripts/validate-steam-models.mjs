#!/usr/bin/env node
/*
 * Back-test the Steam calculators against real launches.
 *
 *   node scripts/validate-steam-models.mjs [cases.csv] [--write-status]
 *
 * CSV: scripts/validation/steam-validation-cases.csv (ships EMPTY: header row only).
 * Columns:
 *   game                          name (free text)
 *   genre_bucket                  deep | casual | unsure
 *   page_open_date, launch_date   YYYY-MM-DD (needed to measure page age and horizons)
 *   price_usd, early_access       launch price; early_access = Y or N
 *   followers_at_page_open        followers the day the page opened (usually 0)
 *   followers_90d_pre, followers_30d_pre, followers_at_launch
 *   launch_wishlists              wishlists on launch day
 *   week1_units, month1_units     actual units sold
 *   projection_made_before_launch Y only if the projection below was written down BEFORE launch
 *   projection_low/base/high      that recorded projection, in launch wishlists
 *
 * What is tested (all with the live model in assets/js/steam-models.js):
 *   1. Follower trajectory: from the T-90 and T-30 snapshots, is followers_at_launch inside the low-high band?
 *   2. Wishlists: low/base/high launch wishlists from those followers, vs launch_wishlists.
 *   3. Sales: Week 1 band (low case to 10x median, the published range) fed with the ACTUAL launch wishlists,
 *      plus the actual/median ratio. Month 1 vs the 1.23-1.47 range applied to actual Week 1.
 *   4. Your recorded pre-launch projection band vs launch_wishlists (blind rows only).
 *
 * A row counts as "blind" only if projection_made_before_launch = Y AND the recorded projection is filled in.
 * --write-status stores the blind row count in assets/js/steam-models.js; the pages show a
 * "not yet validated" notice until it reaches the required count (15).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const modelPath = path.join(root, 'assets', 'js', 'steam-models.js');
const SM = createRequire(import.meta.url)(modelPath);

const args = process.argv.slice(2);
const writeStatus = args.includes('--write-status');
const csvPath = args.find(a => !a.startsWith('--')) || path.join(here, 'validation', 'steam-validation-cases.csv');

function parseCsv(text) {
  const rows = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); rows.push(row); row = []; cur = '';
    } else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim() !== ''));
}
const num = v => (v === undefined || v === null || String(v).trim() === '' || !isFinite(+v)) ? null : +v;
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const inBand = (x, lo, hi) => x !== null && x >= lo && x <= hi;

const table = parseCsv(fs.readFileSync(csvPath, 'utf8'));
const header = (table.shift() || []).map(h => h.trim());
const cases = table.map(r => Object.fromEntries(header.map((h, i) => [h, (r[i] || '').trim()])));

const mk = () => ({ n: 0, hit: 0 });
const stats = { rows: cases.length, blind: 0, fol: mk(), wl: mk(), wlBlind: mk(), wk1: mk(), mo1: mk(), rec: mk(), ratios: [] };
const tally = (o, ok) => { o.n++; if (ok) o.hit++; };

for (const c of cases) {
  const bucket = ['deep', 'casual', 'unsure'].includes(c.genre_bucket) ? c.genre_bucket : 'unsure';
  const launch = c.launch_date, open = c.page_open_date;
  const f0 = num(c.followers_at_launch), wl = num(c.launch_wishlists);
  const start = num(c.followers_at_page_open) || 0;
  const blind = c.projection_made_before_launch.toUpperCase() === 'Y' && num(c.projection_base) !== null && wl !== null;
  if (blind) stats.blind++;

  for (const [horizon, snap] of [[90, num(c.followers_90d_pre)], [30, num(c.followers_30d_pre)]]) {
    if (snap === null || !launch || !open) continue;
    const daysSinceOpen = Math.max(0, days(open, launch) - horizon);
    // target 0: the wishlist target must not leak into the tier choice
    const res = SM.projectLaunch({ current: snap, startFollowers: start, daysSinceOpen, daysToLaunch: horizon, last30: null, spikes: [], bucket, target: 0 });
    if (!res.valid) continue;
    const sc = res.scenarios;
    if (f0 !== null) tally(stats.fol, inBand(f0, sc.low.followers, sc.high.followers));
    if (wl !== null) {
      const hit = inBand(wl, sc.low.wishlists, sc.high.wishlists);
      tally(stats.wl, hit);
      if (blind) tally(stats.wlBlind, hit);
    }
  }

  const w1 = num(c.week1_units), m1 = num(c.month1_units);
  if (wl !== null && w1 !== null) {
    const fs_ = SM.forecastSales({ wishlists: wl, price: num(c.price_usd) || 0, launchType: c.early_access.toUpperCase() === 'Y' ? 'ea' : 'full' });
    tally(stats.wk1, inBand(w1, fs_.lowCase, fs_.week1 * 10));
    if (fs_.week1 > 0) stats.ratios.push(w1 / fs_.week1);
    if (m1 !== null) tally(stats.mo1, inBand(m1, w1 * SM.SALES.monthLow, w1 * SM.SALES.monthHigh));
  }
  if (blind) {
    const lo = num(c.projection_low), hi = num(c.projection_high);
    if (lo !== null && hi !== null) tally(stats.rec, inBand(wl, lo, hi));
  }
}

const pct = o => o.n ? `${o.hit}/${o.n} (${Math.round(100 * o.hit / o.n)}%)` : 'no data';
const med = a => {
  if (!a.length) return null;
  const b = [...a].sort((x, y) => x - y), m = b.length >> 1;
  return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
};

console.log(`Cases file: ${path.relative(root, csvPath)}`);
console.log(`Rows: ${stats.rows}   Blind pre-launch rows: ${stats.blind} / ${SM.VALIDATION.required} required`);
console.log('');
console.log(`Followers at launch inside low-high band (T-90 and T-30 runs):      ${pct(stats.fol)}`);
console.log(`Launch wishlists inside low-high band, all runs (2 per row):        ${pct(stats.wl)}`);
console.log(`Launch wishlists inside low-high band, blind runs only:             ${pct(stats.wlBlind)}`);
console.log(`Week 1 units inside low case to 10x median (given real wishlists):  ${pct(stats.wk1)}`);
console.log(`  median actual / model Week 1 median: ${med(stats.ratios) === null ? 'no data' : med(stats.ratios).toFixed(2) + 'x'}`);
console.log(`Month 1 units inside Week 1 x 1.23-1.47 (given real Week 1):        ${pct(stats.mo1)}`);
console.log(`Your recorded pre-launch band vs launch wishlists (blind rows):     ${pct(stats.rec)}`);
console.log('');
if (stats.blind < SM.VALIDATION.required) {
  console.log(`NOT YET VALIDATED: ${stats.blind} blind rows, ${SM.VALIDATION.required} needed. Do not read the shares above as an error band.`);
} else {
  console.log('Enough blind rows for a first check. Read the shares above, with the sample size, as the first evidence about the bands.');
}

if (writeStatus) {
  let src = fs.readFileSync(modelPath, 'utf8');
  const re = /var VALIDATION = \{ blindRows: \d+, required: \d+ \};( \/\/ VALIDATION-STATUS-LINE)/;
  if (!re.test(src)) { console.error('Could not find the VALIDATION line in steam-models.js'); process.exit(1); }
  src = src.replace(re, `var VALIDATION = { blindRows: ${stats.blind}, required: ${SM.VALIDATION.required} };$1`);
  fs.writeFileSync(modelPath, src);
  console.log(`Wrote blindRows = ${stats.blind} to assets/js/steam-models.js`);
}

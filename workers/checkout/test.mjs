// Run with: node test.mjs   (no dependencies; Stripe is mocked)
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { dueDate, addBusinessDays } from './business-days.js';
import worker from './worker.js';

let failed = 0;
function test(name, fn) {
  return Promise.resolve().then(fn).then(
    () => console.log('ok   ' + name),
    (err) => { failed++; console.log('FAIL ' + name + '\n     ' + (err && err.message)); }
  );
}

// Rome is UTC+1 in winter (CET) and UTC+2 in summer (CEST).
const rome = (iso) => new Date(iso);

// ---- business days ---------------------------------------------------------------------
await test('paid Monday 10:00, Express Indie (1 day) is due Tuesday', () => {
  const r = dueDate(rome('2026-11-16T10:00:00+01:00'), 1);
  assert.deepEqual([r.start, r.due, r.approx], ['2026-11-16', '2026-11-17', false]);
});
await test('paid Monday 10:00, standard Indie (2 days) is due Wednesday', () => {
  assert.equal(dueDate(rome('2026-11-16T10:00:00+01:00'), 2).due, '2026-11-18');
});
await test('paid Monday 12:00 sharp still counts as before the cutoff', () => {
  assert.equal(dueDate(rome('2026-11-16T12:00:00+01:00'), 1).start, '2026-11-16');
});
await test('paid Monday 12:01 counts from Tuesday as day 0', () => {
  const r = dueDate(rome('2026-11-16T12:01:00+01:00'), 1);
  assert.deepEqual([r.start, r.due], ['2026-11-17', '2026-11-18']);
});
await test('paid Friday 13:00 counts from Monday', () => {
  const r = dueDate(rome('2026-11-13T13:00:00+01:00'), 2);
  assert.deepEqual([r.start, r.due], ['2026-11-16', '2026-11-18']);
});
await test('paid on Saturday counts from Monday', () => {
  assert.equal(dueDate(rome('2026-11-14T09:00:00+01:00'), 1).start, '2026-11-16');
});
await test('Italian holidays are skipped (Mon 7 Dec 2026 -> Tue 8 Dec is a holiday)', () => {
  assert.equal(addBusinessDays('2026-12-07', 1), '2026-12-09');
});
await test('Easter Monday 2026 (6 Apr) is skipped', () => {
  assert.equal(addBusinessDays('2026-04-03', 1), '2026-04-07');
});
await test('Easter Monday 2027 (29 Mar) is skipped', () => {
  assert.equal(addBusinessDays('2027-03-26', 1), '2027-03-30');
});
await test('Christmas week 2026: 24 Dec + 1 -> 28 Dec (25 Fri and 26 Sat are holidays)', () => {
  assert.equal(addBusinessDays('2026-12-24', 1), '2026-12-28');
});
await test('summer time: 11:30 CEST is before the cutoff, 12:30 CEST is after', () => {
  assert.equal(dueDate(rome('2026-07-06T11:30:00+02:00'), 1).start, '2026-07-06');
  assert.equal(dueDate(rome('2026-07-06T12:30:00+02:00'), 1).start, '2026-07-07');
});
await test('2028 is outside the list: weekends only and approx is true', () => {
  const r = dueDate(rome('2028-01-04T10:00:00+01:00'), 2);
  assert.equal(r.approx, true);
});

// ---- Worker ----------------------------------------------------------------------------
const kv = new Map();
const KV = {
  async get(k) { return kv.has(k) ? kv.get(k) : null; },
  async put(k, v) { kv.set(k, v); },
  async delete(k) { kv.delete(k); },
};
const baseEnv = {
  CONTACT_SUBMISSIONS: KV,
  STRIPE_SECRET_KEY: 'sk_test_x',
  STRIPE_WEBHOOK_SECRET: 'whsec_test',
  EXPRESS_ENABLED: 'true',
  PRICES: { standard: 'price_std', premium: 'price_prem' },
  EXPRESS_PRICES: { eur: { standard: 'price_x_std', premium: 'price_x_prem' }, usd: {}, gbp: {} },
  EXPRESS_AMOUNTS: { eur: { standard: 49, premium: 99 }, usd: {}, gbp: {} },
};
let stripeCalls = [];
globalThis.fetch = async (url, init) => {
  stripeCalls.push({ url, params: new URLSearchParams(init.body) });
  return new Response(JSON.stringify({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' }), { status: 200 });
};
const call = (path, init, env = baseEnv) => worker.fetch(new Request('https://spritzconsulting.com' + path, init), env);
const post = (body, env) => call('/api/order', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'https://spritzconsulting.com', 'CF-Connecting-IP': '1.2.3.' + Math.floor(Math.random() * 250) },
  body: JSON.stringify(body),
}, env);
const order = (extra) => ({
  version: 'standard', steam: 'https://store.steampowered.com/app/1/', email: 'a@b.co', waiver: true, currency: 'eur', ...extra,
});

await test('config: Express on, EUR only', async () => {
  const j = await (await call('/api/order/config', { method: 'GET' })).json();
  assert.deepEqual(j, { enabled: true, express: { eur: { standard: 49, premium: 99 } } });
});
await test('config: EXPRESS_ENABLED false hides everything', async () => {
  const j = await (await call('/api/order/config', { method: 'GET' }, { ...baseEnv, EXPRESS_ENABLED: 'false' })).json();
  assert.deepEqual(j, { enabled: false, express: {} });
});
await test('order without Express: one line item', async () => {
  stripeCalls = [];
  const r = await post(order());
  assert.equal(r.status, 200);
  const p = stripeCalls[0].params;
  assert.equal(p.get('line_items[0][price]'), 'price_std');
  assert.equal(p.get('line_items[1][price]'), null);
  assert.equal(p.get('currency'), 'eur');
  assert.equal(p.get('metadata[express]'), 'false');
  assert.equal(p.get('metadata[game_url]'), 'https://store.steampowered.com/app/1/');
});
await test('order with Express: two line items, quantity 1 each, Express never replaces the base', async () => {
  stripeCalls = [];
  const r = await post(order({ version: 'premium', express: true }));
  assert.equal(r.status, 200);
  const p = stripeCalls[0].params;
  assert.equal(p.get('line_items[0][price]'), 'price_prem');
  assert.equal(p.get('line_items[1][price]'), 'price_x_prem');
  assert.equal(p.get('line_items[0][quantity]'), '1');
  assert.equal(p.get('line_items[1][quantity]'), '1');
  assert.equal(p.get('metadata[tier]'), 'premium');
  assert.equal(p.get('metadata[express]'), 'true');
});
await test('Express in USD (no Express price) falls back to EUR', async () => {
  stripeCalls = [];
  await post(order({ express: true, currency: 'usd' }));
  assert.equal(stripeCalls[0].params.get('currency'), 'eur');
});
await test('base order in USD keeps USD', async () => {
  stripeCalls = [];
  await post(order({ currency: 'usd' }));
  assert.equal(stripeCalls[0].params.get('currency'), 'usd');
});
await test('unknown currency is rejected', async () => {
  assert.equal((await post(order({ currency: 'jpy' }))).status, 422);
});
await test('Express refused when EXPRESS_ENABLED is false', async () => {
  const r = await post(order({ express: true }), { ...baseEnv, EXPRESS_ENABLED: 'false' });
  assert.equal(r.status, 422);
  assert.equal((await r.json()).error, 'express_unavailable');
});
await test('Solo Dev is not handled here', async () => {
  assert.equal((await post(order({ version: 'free' }))).status, 422);
});
await test('missing waiver is rejected', async () => {
  assert.equal((await post(order({ waiver: false }))).status, 422);
});
await test('bad Steam link and bad email are rejected', async () => {
  assert.equal((await post(order({ steam: 'https://example.com/x' }))).status, 422);
  assert.equal((await post(order({ email: 'nope' }))).status, 422);
});
await test('foreign origin is refused', async () => {
  const r = await call('/api/order', { method: 'POST', headers: { Origin: 'https://evil.example' }, body: '{}' });
  assert.equal(r.status, 403);
});

// ---- webhook ---------------------------------------------------------------------------
function signed(body, secret = baseEnv.STRIPE_WEBHOOK_SECRET, t = Math.floor(Date.now() / 1000)) {
  const sig = crypto.createHmac('sha256', secret).update(t + '.' + body).digest('hex');
  return { 'Stripe-Signature': 't=' + t + ',v1=' + sig };
}
let paidOrderId;
await test('webhook: bad signature is refused', async () => {
  const body = '{}';
  const r = await call('/api/order/webhook', { method: 'POST', headers: signed(body, 'wrong'), body });
  assert.equal(r.status, 400);
});
await test('webhook: paid session stores due_date (Express Indie, paid Monday 10:00 Rome)', async () => {
  stripeCalls = [];
  await post(order({ express: true }));
  const key = [...kv.keys()].filter((k) => /^order:[0-9a-f-]{36}$/.test(k)).pop();
  paidOrderId = key.slice(6);
  const created = Math.floor(new Date('2026-11-16T10:00:00+01:00').getTime() / 1000);
  const event = { id: 'evt_1', type: 'checkout.session.completed', created, data: { object: {
    id: 'cs_test_1', payment_status: 'paid', metadata: { order_id: paidOrderId, tier: 'standard', express: 'true' }, amount_total: 14800, currency: 'eur' } } };
  const body = JSON.stringify(event);
  const r = await call('/api/order/webhook', { method: 'POST', headers: signed(body), body });
  assert.equal(r.status, 200);
  const rec = JSON.parse(kv.get('order:' + paidOrderId));
  assert.equal(rec.status, 'paid');
  assert.equal(rec.due_date, '2026-11-17');
  assert.equal(rec.businessDays, 1);
  assert.equal(rec.amountTotal, 14800);
  assert.ok(kv.has('order:paid:cs_test_1'));
});
await test('webhook: the same session twice is a duplicate and changes nothing', async () => {
  const before = kv.get('order:' + paidOrderId);
  const created = Math.floor(new Date('2026-11-20T10:00:00+01:00').getTime() / 1000);
  const event = { type: 'checkout.session.completed', created, data: { object: { id: 'cs_test_1', payment_status: 'paid', metadata: { order_id: paidOrderId, tier: 'standard', express: 'true' } } } };
  const body = JSON.stringify(event);
  const r = await call('/api/order/webhook', { method: 'POST', headers: signed(body), body });
  assert.equal((await r.json()).duplicate, true);
  assert.equal(kv.get('order:' + paidOrderId), before);
});
await test('webhook: unpaid session is ignored', async () => {
  const body = JSON.stringify({ type: 'checkout.session.completed', created: 1, data: { object: { id: 'cs_x', payment_status: 'unpaid', metadata: {} } } });
  const r = await call('/api/order/webhook', { method: 'POST', headers: signed(body), body });
  assert.equal((await r.json()).ignored, true);
  assert.equal(kv.has('order:paid:cs_x'), false);
});
await test('webhook: old timestamp is refused', async () => {
  const body = '{}';
  const r = await call('/api/order/webhook', { method: 'POST', headers: signed(body, undefined, Math.floor(Date.now() / 1000) - 3600), body });
  assert.equal(r.status, 400);
});
await test('Stripe failure removes the pending record and returns 502', async () => {
  const saved = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { type: 'invalid_request_error', message: 'x' } }), { status: 400 });
  const records = () => [...kv.keys()].filter((k) => /^order:[0-9a-f-]{36}$/.test(k)).length;
  const n = records();
  const r = await post(order());
  globalThis.fetch = saved;
  assert.equal(r.status, 502);
  assert.equal(records(), n, 'pending record removed');
});

console.log(failed ? '\n' + failed + ' failed' : '\nall passed');
process.exit(failed ? 1 : 0);

// Run with: node test.mjs   (no dependencies; Stripe is mocked)
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dueDate, addBusinessDays } from './business-days.js';
import worker from './worker.js';

// Rebuild the single-file Worker so it is tested as it will be pasted into the dashboard.
execFileSync(process.execPath, [fileURLToPath(new URL('./build-single.mjs', import.meta.url))], { stdio: 'pipe' });
const { default: workerSingle } = await import('./worker.single.js');

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

async function workerSuite(label, worker) {
  // ---- Worker ----------------------------------------------------------------------------
  const kv = new Map();
  const kvTtl = new Map();
  const KV = {
    async get(k) { return kv.has(k) ? kv.get(k) : null; },
    async put(k, v, opts) { kv.set(k, v); kvTtl.set(k, opts && opts.expirationTtl); },
    async delete(k) { kv.delete(k); },
  };
  const baseEnv = {
    CONTACT_SUBMISSIONS: KV,
    STRIPE_SECRET_KEY: 'sk_test_x',
    STRIPE_WEBHOOK_SECRET: 'whsec_test',
    EXPRESS_ENABLED: 'true',
    PRICES: { standard: 'price_std', premium: 'price_prem' },
    // The same Express price id repeats under every currency, because one Stripe price carries all three.
    EXPRESS_PRICES: {
      eur: { standard: 'price_x_std', premium: 'price_x_prem' },
      usd: { standard: 'price_x_std', premium: 'price_x_prem' },
      gbp: { standard: 'price_x_std', premium: 'price_x_prem' },
    },
    PRICE_AMOUNTS: {
      eur: { standard: 99, premium: 299 }, usd: { standard: 109, premium: 329 }, gbp: { standard: 89, premium: 249 },
    },
    PROMOS: {
      SOLODEV20: { tier: 'standard', coupon: 'V7V7n4Fm', active: true, amounts: { eur: 79, usd: 87, gbp: 71 } },
      SOLODEV10: { tier: 'premium', coupon: 'yZBBORrT', active: true, amounts: { eur: 269, usd: 296, gbp: 224 } },
    },
    EXPRESS_AMOUNTS: {
      eur: { standard: 49, premium: 99 }, usd: { standard: 49, premium: 99 }, gbp: { standard: 49, premium: 99 },
    },
    INDIE_PUBLISHER_COUPON_ID: 'cpn_indie',
  };
  const FULL_CONFIG = {
    enabled: true,
    currencies: ['eur', 'usd', 'gbp'],
    amounts: { standard: { eur: 99, usd: 109, gbp: 89 }, premium: { eur: 299, usd: 329, gbp: 249 } },
    express: { standard: { eur: 49, usd: 49, gbp: 49 }, premium: { eur: 99, usd: 99, gbp: 99 } },
  };
  // Mocked Stripe API: Checkout sessions, and the promotion code list that the Worker reads for INDIE- codes.
  let stripeCalls = [];
  const stripePromoCodes = new Map();   // code -> Stripe promotion code object
  let promoLookupStatus = 200;
  // Mocked notification script (NOTIFY_URL): every call is recorded here, apart from the Stripe calls.
  const NOTIFY_URL = 'https://script.google.com/macros/s/TESTSCRIPTID/exec';
  const NOTIFY_SECRET = 'SECRET-notify-12345';
  let notifyCalls = [];
  let notifyMode = 200;   // an HTTP status, or 'throw' for a network failure
  globalThis.fetch = async (url, init = {}) => {
    const href = String(url);
    if (href.startsWith(NOTIFY_URL)) {
      notifyCalls.push({ url: href, init, body: JSON.parse(init.body) });
      if (notifyMode === 'throw') throw new Error('network down ' + NOTIFY_URL + ' ' + NOTIFY_SECRET);
      return new Response('ok', { status: notifyMode });
    }
    stripeCalls.push({ url: href, method: init.method || 'GET', auth: (init.headers || {}).Authorization, params: new URLSearchParams(init.body || '') });
    if (href.startsWith('https://api.stripe.com/v1/promotion_codes')) {
      if (promoLookupStatus !== 200) return new Response(JSON.stringify({ error: { type: 'invalid_request_error', message: 'x' } }), { status: promoLookupStatus });
      const q = new URL(href).searchParams;
      const wanted = (q.get('code') || '').toUpperCase();
      const data = [...stripePromoCodes.values()].filter((p) => p.code.toUpperCase() === wanted && (q.get('active') !== 'true' || p.active));
      return new Response(JSON.stringify({ object: 'list', data }), { status: 200 });
    }
    if (href.startsWith('https://api.stripe.com/v1/coupons')) {
      if ((init.method || 'GET') === 'DELETE') return new Response(JSON.stringify({ id: href.split('/').pop(), deleted: true }), { status: 200 });
      if (couponStatus !== 200) return new Response(JSON.stringify({ error: { type: 'invalid_request_error', message: 'coupon refused' } }), { status: couponStatus });
      return new Response(JSON.stringify({ id: 'cpn_order_' + (++couponSeq) }), { status: 200 });
    }
    return new Response(JSON.stringify({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' }), { status: 200 });
  };
  let couponStatus = 200;
  let couponSeq = 0;
  const lookups = () => stripeCalls.filter((c) => c.url.startsWith('https://api.stripe.com/v1/promotion_codes'));
  const checkoutCall = () => stripeCalls.filter((c) => c.url === 'https://api.stripe.com/v1/checkout/sessions').pop();
  // The context collects what the Worker hands to waitUntil, and every call waits for it, like the runtime does.
  const call = async (path, init, env = baseEnv) => {
    const pending = [];
    const res = await worker.fetch(new Request('https://spritzconsulting.com' + path, init), env, { waitUntil: (p) => pending.push(p) });
    await Promise.all(pending);
    return res;
  };
  let ipSeq = 0;   // a fresh IP per order, so the order rate limit (5 per 10 minutes per IP) never gets in the way
  const post = (body, env) => call('/api/order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://spritzconsulting.com', 'CF-Connecting-IP': '1.2.3.' + (ipSeq++ % 250) },
    body: JSON.stringify(body),
  }, env);
  const order = (extra) => ({
    version: 'standard', steam: 'https://store.steampowered.com/app/1/', email: 'a@b.co', waiver: true, currency: 'eur', ...extra,
  });

  await test(label + ' ' + 'config: tier and Express amounts in all three currencies, per tier', async () => {
    const j = await (await call('/api/order/config', { method: 'GET' })).json();
    assert.deepEqual(j, FULL_CONFIG);
  });
  await test(label + ' ' + 'config: EXPRESS_ENABLED false hides Express but keeps the tier amounts', async () => {
    const j = await (await call('/api/order/config', { method: 'GET' }, { ...baseEnv, EXPRESS_ENABLED: 'false' })).json();
    assert.deepEqual(j, { enabled: false, currencies: ['eur', 'usd', 'gbp'], amounts: FULL_CONFIG.amounts, express: {} });
  });
  await test(label + ' ' + 'config: Express is off for a tier when one currency has no Express amount', async () => {
    const env = { ...baseEnv, EXPRESS_AMOUNTS: { eur: { standard: 49, premium: 99 }, usd: { standard: 49, premium: 99 }, gbp: { standard: 49 } } };
    const j = await (await call('/api/order/config', { method: 'GET' }, env)).json();
    assert.deepEqual(j.express, { standard: FULL_CONFIG.express.standard });
  });
  await test(label + ' ' + 'config: Express is off when the price id differs between currencies', async () => {
    const env = { ...baseEnv, EXPRESS_PRICES: { ...baseEnv.EXPRESS_PRICES, gbp: { standard: 'price_other', premium: 'price_x_prem' } } };
    const j = await (await call('/api/order/config', { method: 'GET' }, env)).json();
    assert.deepEqual(j.express, { premium: FULL_CONFIG.express.premium });
  });
  await test(label + ' ' + 'order without Express: one line item', async () => {
    stripeCalls = [];
    const r = await post(order());
    assert.equal(r.status, 200);
    const p = stripeCalls[0].params;
    assert.equal(p.get('line_items[0][price]'), 'price_std');
    assert.equal(p.get('line_items[1][price]'), null);
    assert.equal(p.get('currency'), null, 'no currency is sent: Stripe chooses it');
    assert.equal(p.get('metadata[currency]'), null);
    assert.equal(p.get('customer_email'), 'a@b.co');
    assert.equal(p.get('metadata[express]'), 'false');
  assert.equal(p.get('success_url'), 'https://spritzconsulting.com/steam-analysis/?paid=1&plan=standard');
    assert.equal(p.get('metadata[game_url]'), 'https://store.steampowered.com/app/1/');
  });
  await test(label + ' ' + 'order with Express: two line items, quantity 1 each, Express never replaces the base', async () => {
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
  assert.equal(p.get('success_url'), 'https://spritzconsulting.com/steam-analysis/?paid=1&plan=premium&express=1');
  });
  for (const tier of ['standard', 'premium']) {
    for (const withExpress of [false, true]) {
      await test(label + ' ' + tier + (withExpress ? ' with Express' : ' without Express') + ': line items, no currency sent, record without currency', async () => {
        stripeCalls = [];
        const r = await post(order({ version: tier, express: withExpress }));
        assert.equal(r.status, 200);
        const p = stripeCalls[0].params;
        assert.equal(p.get('currency'), null);
        assert.equal(p.get('line_items[0][price]'), tier === 'standard' ? 'price_std' : 'price_prem');
        assert.equal(p.get('line_items[0][quantity]'), '1');
        assert.equal(p.get('line_items[1][price]'), withExpress ? (tier === 'standard' ? 'price_x_std' : 'price_x_prem') : null);
        if (withExpress) assert.equal(p.get('line_items[1][quantity]'), '1');
        const key = [...kv.keys()].filter((k) => /^order:[0-9a-f-]{36}$/.test(k)).pop();
        const rec = JSON.parse(kv.get(key));
        assert.equal(rec.express, withExpress);
        assert.equal('currency' in rec, false);
      });
    }
  }
  await test(label + ' ' + 'a currency in the payload is ignored, whatever it says', async () => {
    for (const asked of ['usd', 'GBP', 'jpy', 5, {}, null]) {
      stripeCalls = [];
      const r = await post(order({ currency: asked }));
      assert.equal(r.status, 200, 'currency ' + JSON.stringify(asked));
      assert.equal(stripeCalls[0].params.get('currency'), null);
    }
  });
  await test(label + ' ' + 'totals follow the price table (Indie 148/158/138, Publisher 398/428/348)', async () => {
    const t = (tier, cur) => baseEnv.PRICE_AMOUNTS[cur][tier] + baseEnv.EXPRESS_AMOUNTS[cur][tier];
    assert.deepEqual(['eur', 'usd', 'gbp'].map((c) => t('standard', c)), [148, 158, 138]);
    assert.deepEqual(['eur', 'usd', 'gbp'].map((c) => t('premium', c)), [398, 428, 348]);
  });
  await test(label + ' ' + 'Express is refused when one currency has no Express amount, with no Stripe call and no record', async () => {
    const env = { ...baseEnv, EXPRESS_AMOUNTS: { eur: { standard: 49, premium: 99 }, usd: {}, gbp: { standard: 44, premium: 82 } } };
    stripeCalls = [];
    const before = [...kv.keys()].filter((k) => /^order:[0-9a-f-]{36}$/.test(k)).length;
    const r = await post(order({ express: true }), env);
    assert.equal(r.status, 422);
    assert.equal((await r.json()).error, 'express_unavailable');
    assert.equal(stripeCalls.length, 0);
    assert.equal([...kv.keys()].filter((k) => /^order:[0-9a-f-]{36}$/.test(k)).length, before);
  });
  await test(label + ' ' + 'Express is refused when the price id is missing in one currency', async () => {
    const env = { ...baseEnv, EXPRESS_PRICES: { eur: { standard: 'price_x_std', premium: 'price_x_prem' }, usd: {}, gbp: {} } };
    assert.equal((await post(order({ express: true }), env)).status, 422);
  });
  await test(label + ' ' + 'a base order still works when Express is not priced everywhere', async () => {
    const env = { ...baseEnv, EXPRESS_AMOUNTS: { eur: { standard: 49, premium: 99 }, usd: {}, gbp: {} } };
    stripeCalls = [];
    assert.equal((await post(order(), env)).status, 200);
    assert.equal(stripeCalls[0].params.get('line_items[1][price]'), null);
  });
  await test(label + ' ' + 'flat Express prices {standard, premium} apply to every currency', async () => {
    const env = { ...baseEnv, EXPRESS_PRICES: { standard: 'price_x_std', premium: 'price_x_prem' } };
    stripeCalls = [];
    assert.equal((await post(order({ express: true }), env)).status, 200);
    assert.equal(stripeCalls[0].params.get('line_items[1][price]'), 'price_x_std');
  });
  await test(label + ' ' + 'Express refused when EXPRESS_ENABLED is false', async () => {
    const r = await post(order({ express: true }), { ...baseEnv, EXPRESS_ENABLED: 'false' });
    assert.equal(r.status, 422);
    assert.equal((await r.json()).error, 'express_unavailable');
  });
  await test(label + ' ' + 'Solo Dev is not handled here', async () => {
    assert.equal((await post(order({ version: 'free' }))).status, 422);
  });
  await test(label + ' ' + 'missing waiver is rejected', async () => {
    assert.equal((await post(order({ waiver: false }))).status, 422);
  });
  await test(label + ' ' + 'bad Steam link and bad email are rejected', async () => {
    assert.equal((await post(order({ steam: 'https://example.com/x' }))).status, 422);
    assert.equal((await post(order({ email: 'nope' }))).status, 422);
  });
  await test(label + ' ' + 'foreign origin is refused', async () => {
    const r = await call('/api/order', { method: 'POST', headers: { Origin: 'https://evil.example' }, body: '{}' });
    assert.equal(r.status, 403);
  });

  // ---- webhook ---------------------------------------------------------------------------
  function signed(body, secret = baseEnv.STRIPE_WEBHOOK_SECRET, t = Math.floor(Date.now() / 1000)) {
    const sig = crypto.createHmac('sha256', secret).update(t + '.' + body).digest('hex');
    return { 'Stripe-Signature': 't=' + t + ',v1=' + sig };
  }
  let paidOrderId;
  await test(label + ' ' + 'webhook: bad signature is refused', async () => {
    const body = '{}';
    const r = await call('/api/order/webhook', { method: 'POST', headers: signed(body, 'wrong'), body });
    assert.equal(r.status, 400);
  });
  await test(label + ' ' + 'webhook: paid session stores due_date (Express Indie, paid Monday 10:00 Rome)', async () => {
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
  await test(label + ' ' + 'webhook: the record stores the currency Stripe used and checks the total (Publisher with Express paid in GBP, 348)', async () => {
    stripeCalls = [];
    await post(order({ version: 'premium', express: true }));
    const key = [...kv.keys()].filter((k) => /^order:[0-9a-f-]{36}$/.test(k)).pop();
    const id = key.slice(6);
    const created = Math.floor(new Date('2026-11-17T10:00:00+01:00').getTime() / 1000);
    const mk = (sid, oid, tier, express, total, cur) => JSON.stringify({ type: 'checkout.session.completed', created, data: { object: {
      id: sid, payment_status: 'paid', metadata: { order_id: oid, tier, express }, amount_total: total, currency: cur } } });
    const good = mk('cs_gbp_1', id, 'premium', 'true', 34800, 'gbp');
    assert.equal((await call('/api/order/webhook', { method: 'POST', headers: signed(good), body: good })).status, 200);
    let rec = JSON.parse(kv.get(key));
    assert.deepEqual([rec.paidCurrency, rec.amountTotal, rec.expectedTotal, rec.amountMatches], ['gbp', 34800, 34800, true]);
    assert.equal(rec.businessDays, 2);
    // The same order paid in USD would be 42800; the other currencies check against their own amounts.
    await post(order({ version: 'premium', express: true }));
    const k2 = [...kv.keys()].filter((k) => /^order:[0-9a-f-]{36}$/.test(k)).pop();
    const usd = mk('cs_usd_1', k2.slice(6), 'premium', 'true', 42800, 'usd');
    await call('/api/order/webhook', { method: 'POST', headers: signed(usd), body: usd });
    rec = JSON.parse(kv.get(k2));
    assert.deepEqual([rec.paidCurrency, rec.expectedTotal, rec.amountMatches], ['usd', 42800, true]);
    // A paid total that differs from the expected one is flagged, never rejected.
    await post(order({ version: 'standard' }));
    const k3 = [...kv.keys()].filter((k) => /^order:[0-9a-f-]{36}$/.test(k)).pop();
    const odd = mk('cs_eur_1', k3.slice(6), 'standard', 'false', 12345, 'eur');
    assert.equal((await call('/api/order/webhook', { method: 'POST', headers: signed(odd), body: odd })).status, 200);
    rec = JSON.parse(kv.get(k3));
    assert.deepEqual([rec.status, rec.expectedTotal, rec.amountMatches], ['paid', 9900, false]);
    // A currency with no configured amount leaves the check empty instead of failing.
    await post(order({ version: 'standard' }));
    const k4 = [...kv.keys()].filter((k) => /^order:[0-9a-f-]{36}$/.test(k)).pop();
    const jpy = mk('cs_jpy_1', k4.slice(6), 'standard', 'false', 15000, 'jpy');
    assert.equal((await call('/api/order/webhook', { method: 'POST', headers: signed(jpy), body: jpy })).status, 200);
    rec = JSON.parse(kv.get(k4));
    assert.deepEqual([rec.paidCurrency, rec.expectedTotal, rec.amountMatches], ['jpy', null, null]);
  });
  await test(label + ' ' + 'webhook: the same session twice is a duplicate and changes nothing', async () => {
    const before = kv.get('order:' + paidOrderId);
    const created = Math.floor(new Date('2026-11-20T10:00:00+01:00').getTime() / 1000);
    const event = { type: 'checkout.session.completed', created, data: { object: { id: 'cs_test_1', payment_status: 'paid', metadata: { order_id: paidOrderId, tier: 'standard', express: 'true' } } } };
    const body = JSON.stringify(event);
    const r = await call('/api/order/webhook', { method: 'POST', headers: signed(body), body });
    assert.equal((await r.json()).duplicate, true);
    assert.equal(kv.get('order:' + paidOrderId), before);
  });
  await test(label + ' ' + 'webhook: unpaid session is ignored', async () => {
    const body = JSON.stringify({ type: 'checkout.session.completed', created: 1, data: { object: { id: 'cs_x', payment_status: 'unpaid', metadata: {} } } });
    const r = await call('/api/order/webhook', { method: 'POST', headers: signed(body), body });
    assert.equal((await r.json()).ignored, true);
    assert.equal(kv.has('order:paid:cs_x'), false);
  });
  await test(label + ' ' + 'webhook: old timestamp is refused', async () => {
    const body = '{}';
    const r = await call('/api/order/webhook', { method: 'POST', headers: signed(body, undefined, Math.floor(Date.now() / 1000) - 3600), body });
    assert.equal(r.status, 400);
  });
  await test(label + ' ' + 'Stripe failure removes the pending record and returns 502', async () => {
    const saved = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ error: { type: 'invalid_request_error', message: 'x' } }), { status: 400 });
    const records = () => [...kv.keys()].filter((k) => /^order:[0-9a-f-]{36}$/.test(k)).length;
    const n = records();
    const r = await post(order());
    globalThis.fetch = saved;
    assert.equal(r.status, 502);
    assert.equal(records(), n, 'pending record removed');
  });

  // ---- promotion codes and the promo endpoint -----------------------------------------------
  const records = () => [...kv.keys()].filter((k) => /^order:[0-9a-f-]{36}$/.test(k));
  const lastRecord = () => { const k = records().pop(); return { key: k, id: k.slice(6), rec: JSON.parse(kv.get(k)) }; };
  const created = Math.floor(new Date('2026-11-17T10:00:00+01:00').getTime() / 1000);
  let sessionSeq = 0;
  async function pay(id, tier, express, total, cur, extra = {}) {
    const sid = 'cs_promo_' + (++sessionSeq);
    const body = JSON.stringify({ type: 'checkout.session.completed', created, data: { object: {
      id: sid, payment_status: 'paid', metadata: { order_id: id, tier, express: String(express), ...(extra.meta || {}) },
      amount_total: total, currency: cur, ...(extra.session || {}) } } });
    const r = await call('/api/order/webhook', { method: 'POST', headers: signed(body), body });
    assert.equal(r.status, 200);
    return { sid, body, rec: JSON.parse(kv.get('order:' + id)) };
  }
  const promoGet = (code, ip = '9.9.9.' + Math.floor(Math.random() * 250), env = baseEnv) => call('/api/order/promo' + (code === undefined ? '' : '?code=' + encodeURIComponent(code)), {
    method: 'GET', headers: { Origin: 'https://spritzconsulting.com', 'CF-Connecting-IP': ip } }, env);

  await test(label + ' ' + 'a valid code sends its coupon, the code and a cancel URL that keeps the promo', async () => {
    stripeCalls = [];
    assert.equal((await post(order({ promo: 'SOLODEV20' }))).status, 200);
    const p = stripeCalls[0].params;
    assert.equal(p.get('discounts[0][coupon]'), 'V7V7n4Fm');
    assert.equal(p.get('metadata[promo]'), 'SOLODEV20');
    assert.equal(p.get('cancel_url'), 'https://spritzconsulting.com/steam-analysis/?tier=standard&promo=SOLODEV20');
    assert.equal('promo' in lastRecord().rec, false, 'the pending record holds no promo: the webhook records it, and only with a discount');
    stripeCalls = [];
    assert.equal((await post(order({ version: 'premium', promo: ' solodev10 ' }))).status, 200);
    assert.equal(stripeCalls[0].params.get('discounts[0][coupon]'), 'yZBBORrT');
    assert.equal(lookups().length, 0, 'a PROMOS code never reaches the Stripe promotion code API');
  });
  await test(label + ' ' + 'a bad, empty, disabled or wrong-tier code is ignored: list price, no coupon, no error', async () => {
    const off = { ...baseEnv, PROMOS: { ...baseEnv.PROMOS, SOLODEV20: { ...baseEnv.PROMOS.SOLODEV20, active: false } } };
    const cases = [
      [order({ promo: 'NOPE123' }), baseEnv],
      [order({ promo: '' }), baseEnv],
      [order({ promo: '<script>' }), baseEnv],
      [order({ promo: 'SOLODEV20', version: 'premium' }), baseEnv],
      [order({ promo: 'SOLODEV10', version: 'standard' }), baseEnv],
      [order({ promo: 'SOLODEV20' }), off],
      [order({ promo: 'SOLODEV20' }), { ...baseEnv, PROMOS: undefined }],
    ];
    for (const [body, env] of cases) {
      stripeCalls = [];
      const r = await post(body, env);
      assert.equal(r.status, 200, JSON.stringify(body.promo) + ' ' + body.version);
      assert.equal(stripeCalls[0].params.get('discounts[0][coupon]'), null);
      assert.equal(stripeCalls[0].params.get('metadata[promo]'), null);
      assert.equal('promo' in lastRecord().rec, false);
    }
  });
  await test(label + ' ' + 'Express never carries a discount: one coupon on the order, two plain line items', async () => {
    stripeCalls = [];
    assert.equal((await post(order({ promo: 'SOLODEV20', express: true }))).status, 200);
    const p = stripeCalls[0].params;
    assert.equal(p.get('line_items[0][price]'), 'price_std');
    assert.equal(p.get('line_items[1][price]'), 'price_x_std');
    assert.equal(p.get('discounts[0][coupon]'), 'V7V7n4Fm');
    assert.equal(p.get('discounts[1][coupon]'), null);
    assert.deepEqual([...p.keys()].filter((k) => k.startsWith('line_items[1]')), ['line_items[1][price]', 'line_items[1][quantity]']);
  });
  await test(label + ' ' + 'amountMatches is true in EUR, USD and GBP, with and without Express, for both promotions', async () => {
    const table = [
      ['standard', 'SOLODEV20', { eur: 79, usd: 87, gbp: 71 }, 49],
      ['premium', 'SOLODEV10', { eur: 269, usd: 296, gbp: 224 }, 99],
    ];
    const seen = [];
    for (const [tier, code, amounts, extra] of table) {
      for (const cur of ['eur', 'usd', 'gbp']) {
        for (const express of [false, true]) {
          await post(order({ version: tier, promo: code, express }));
          const { id } = lastRecord();
          const total = (amounts[cur] + (express ? extra : 0)) * 100;
          const { rec } = await pay(id, tier, express, total, cur, { meta: { promo: code }, session: { total_details: { amount_discount: 2000 } } });
          assert.deepEqual([rec.expectedTotal, rec.amountMatches, rec.discountApplied, rec.promo], [total, true, true, code], tier + ' ' + cur + ' ' + express);
          if (express) seen.push(total / 100);
        }
      }
    }
    // Totals with Express in the brief: Indie 128/136/120, Publisher 368/395/323.
    assert.deepEqual(seen, [128, 136, 120, 368, 395, 323]);
  });
  await test(label + ' ' + 'a promotion paid without a discount records no promo and no discountApplied: the expected total is the list total', async () => {
    for (const total_details of [{ amount_discount: 0 }, undefined]) {
      await post(order({ promo: 'SOLODEV20' }));
      const { id } = lastRecord();
      const { rec } = await pay(id, 'standard', false, 9900, 'eur', { meta: { promo: 'SOLODEV20' }, session: { total_details } });
      assert.equal('promo' in rec, false);
      assert.equal('discountApplied' in rec, false);
      assert.deepEqual([rec.amountMatches, rec.expectedTotal, rec.listTotal], [true, 9900, 9900]);
    }
  });
  await test(label + ' ' + 'an order without a promotion records list totals and no promo keys', async () => {
    await post(order({ express: true }));
    const { id } = lastRecord();
    const { rec } = await pay(id, 'standard', true, 14800, 'eur');
    assert.equal('promo' in rec, false);
    assert.equal('discountApplied' in rec, false);
    assert.deepEqual([rec.listTotal, rec.amountMatches], [14800, true]);
  });
  await test(label + ' ' + 'a repeated webhook for a promotion order changes nothing', async () => {
    await post(order({ promo: 'SOLODEV20', steam: 'https://store.steampowered.com/app/555/', email: 'dup@x.co' }));
    const { id } = lastRecord();
    const first = await pay(id, 'standard', false, 7900, 'eur', { meta: { promo: 'SOLODEV20' }, session: { total_details: { amount_discount: 2000 } } });
    const snap = () => JSON.stringify([...kv.entries()].filter(([k]) => k.startsWith('order:') && !k.startsWith('order:rl')));
    const before = snap();
    const r = await call('/api/order/webhook', { method: 'POST', headers: signed(first.body), body: first.body });
    assert.equal((await r.json()).duplicate, true);
    assert.equal(snap(), before);
  });
  await test(label + ' ' + 'promo endpoint: valid, invalid, disabled and missing codes', async () => {
    let j = await (await promoGet('solodev20')).json();
    assert.deepEqual(j, { valid: true, tier: 'standard', amounts: { eur: 79, usd: 87, gbp: 71 } });
    j = await (await promoGet('SOLODEV10')).json();
    assert.deepEqual(j, { valid: true, tier: 'premium', amounts: { eur: 269, usd: 296, gbp: 224 } });
    for (const code of ['NOPE', '', undefined, 'a b', 'x'.repeat(80)]) {
      const r = await promoGet(code);
      assert.equal(r.status, 200);
      assert.deepEqual(await r.json(), { valid: false });
    }
    const off = { ...baseEnv, PROMOS: { ...baseEnv.PROMOS, SOLODEV20: { ...baseEnv.PROMOS.SOLODEV20, active: false } } };
    const r = await promoGet('SOLODEV20', undefined, off);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { valid: false });
    const none = await promoGet('SOLODEV20', undefined, { ...baseEnv, PROMOS: undefined });
    assert.deepEqual([none.status, await none.json()], [200, { valid: false }]);
  });
  await test(label + ' ' + 'promo endpoint: rate limited per IP, separate from the order limit', async () => {
    const ip = '8.8.8.8';
    for (let i = 0; i < 20; i++) assert.equal((await promoGet('SOLODEV20', ip)).status, 200);
    assert.equal((await promoGet('SOLODEV20', ip)).status, 429);
    const r = await call('/api/order', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://spritzconsulting.com', 'CF-Connecting-IP': ip }, body: JSON.stringify(order()) });
    assert.equal(r.status, 200);
  });
  await test(label + ' ' + 'promo endpoint: foreign origin and POST are refused', async () => {
    assert.equal((await call('/api/order/promo?code=SOLODEV20', { method: 'GET', headers: { Origin: 'https://evil.example' } })).status, 403);
    assert.equal((await call('/api/order/promo', { method: 'POST' })).status, 405);
  });

  // ---- INDIE- one-time codes, with a mocked Stripe promotion code API ---------------------------
  const indiePromo = (code, over = {}) => ({
    id: 'promo_' + code.toLowerCase().replace(/[^a-z0-9]/g, ''), object: 'promotion_code', code, active: true,
    max_redemptions: 1, times_redeemed: 0,
    promotion: { type: 'coupon', coupon: { id: 'cpn_indie', object: 'coupon', valid: true } },
    ...over,
  });
  const addPromo = (code, over) => { const p = indiePromo(code, over); stripePromoCodes.set(code, p); return p; };
  const INDIE_AMOUNTS = { eur: 190, usd: 209, gbp: 158 };

  await test(label + ' ' + 'INDIE: a valid code is looked up in Stripe and the session uses discounts[0][promotion_code]', async () => {
    stripePromoCodes.clear();
    const p = addPromo('INDIE-AB12CD34');
    stripeCalls = [];
    assert.equal((await post(order({ version: 'premium', promo: ' indie-ab12cd34 ' }))).status, 200);
    assert.equal(lookups().length, 1);
    const l = lookups()[0];
    const u = new URL(l.url);
    assert.equal(l.method, 'GET');
    assert.equal(l.auth, 'Bearer sk_test_x');
    assert.equal(u.searchParams.get('code'), 'INDIE-AB12CD34');
    assert.equal(u.searchParams.get('active'), 'true');
    assert.equal(u.searchParams.get('expand[]'), 'data.promotion.coupon');
    const c = checkoutCall();
    assert.equal(c.params.get('discounts[0][promotion_code]'), p.id);
    assert.equal(c.params.get('discounts[0][coupon]'), null);
    assert.equal(c.params.get('metadata[promo]'), 'INDIE-AB12CD34');
    assert.equal(c.params.get('line_items[0][price]'), 'price_prem');
    assert.equal(c.params.get('cancel_url'), 'https://spritzconsulting.com/steam-analysis/?tier=premium&promo=INDIE-AB12CD34');
    assert.equal('promo' in lastRecord().rec, false);
  });
  await test(label + ' ' + 'INDIE: the promo endpoint answers valid with the discounted Publisher totals', async () => {
    stripePromoCodes.clear();
    addPromo('INDIE-AB12CD34');
    assert.deepEqual(await (await promoGet('indie-ab12cd34')).json(), { valid: true, tier: 'premium', amounts: INDIE_AMOUNTS });
  });
  await test(label + ' ' + 'INDIE: the coupon may be a plain id or the legacy coupon field', async () => {
    stripePromoCodes.clear();
    addPromo('INDIE-STRING01', { promotion: { type: 'coupon', coupon: 'cpn_indie' } });
    addPromo('INDIE-LEGACY01', { promotion: undefined, coupon: { id: 'cpn_indie', valid: true } });
    for (const code of ['INDIE-LEGACY01']) {
      assert.deepEqual(await (await promoGet(code)).json(), { valid: true, tier: 'premium', amounts: INDIE_AMOUNTS }, code);
    }
    // a plain id carries no validity flag: it is accepted, because the id itself was checked
    assert.deepEqual(await (await promoGet('INDIE-STRING01')).json(), { valid: true, tier: 'premium', amounts: INDIE_AMOUNTS });
  });
  await test(label + ' ' + 'INDIE: a used, unknown, inactive or wrongly built code is ignored: full price, no discount, no error', async () => {
    stripePromoCodes.clear();
    addPromo('INDIE-USED0001', { times_redeemed: 1 });
    addPromo('INDIE-OFF00001', { active: false });
    addPromo('INDIE-NOLIMIT1', { max_redemptions: null });
    addPromo('INDIE-OTHERCPN', { promotion: { type: 'coupon', coupon: { id: 'cpn_other', valid: true } } });
    addPromo('INDIE-DEADCPN1', { promotion: { type: 'coupon', coupon: { id: 'cpn_indie', valid: false } } });
    for (const code of ['INDIE-USED0001', 'INDIE-OFF00001', 'INDIE-NOLIMIT1', 'INDIE-OTHERCPN', 'INDIE-DEADCPN1', 'INDIE-NOSUCH01']) {
      stripeCalls = [];
      const r = await post(order({ version: 'premium', promo: code }));
      assert.equal(r.status, 200, code);
      const c = checkoutCall();
      assert.equal(c.params.get('discounts[0][promotion_code]'), null, code);
      assert.equal(c.params.get('discounts[0][coupon]'), null, code);
      assert.equal(c.params.get('metadata[promo]'), null, code);
      assert.equal(c.params.get('line_items[0][price]'), 'price_prem', code);
      assert.deepEqual(await (await promoGet(code)).json(), { valid: false }, code);
    }
  });
  await test(label + ' ' + 'INDIE: a Stripe error on the lookup charges the full price and shows no discount', async () => {
    stripePromoCodes.clear();
    addPromo('INDIE-AB12CD34');
    promoLookupStatus = 500;
    try {
      stripeCalls = [];
      assert.equal((await post(order({ version: 'premium', promo: 'INDIE-AB12CD34' }))).status, 200);
      assert.equal(checkoutCall().params.get('discounts[0][promotion_code]'), null);
      assert.deepEqual(await (await promoGet('INDIE-AB12CD34')).json(), { valid: false });
    } finally { promoLookupStatus = 200; }
  });
  await test(label + ' ' + 'INDIE: a code without the INDIE- prefix never reaches the Stripe promotion code API', async () => {
    stripePromoCodes.clear();
    for (const code of ['WELCOME-1234', 'INDIE1234', 'XINDIE-AB12CD34', 'INDIE-', 'indie_ab12cd34', 'SOLODEV30']) {
      addPromo(code);
      stripeCalls = [];
      assert.equal((await post(order({ version: 'premium', promo: code }))).status, 200, code);
      assert.equal(checkoutCall().params.get('discounts[0][promotion_code]'), null, code);
      assert.equal(checkoutCall().params.get('discounts[0][coupon]'), null, code);
      assert.deepEqual(await (await promoGet(code)).json(), { valid: false }, code);
      assert.equal(lookups().length, 0, code);
    }
  });
  await test(label + ' ' + 'INDIE: the wrong tier is ignored with no Stripe lookup (Indie order, valid code)', async () => {
    stripePromoCodes.clear();
    addPromo('INDIE-AB12CD34');
    stripeCalls = [];
    assert.equal((await post(order({ version: 'standard', promo: 'INDIE-AB12CD34' }))).status, 200);
    assert.equal(lookups().length, 0);
    const c = checkoutCall();
    assert.equal(c.params.get('discounts[0][promotion_code]'), null);
    assert.equal(c.params.get('line_items[0][price]'), 'price_std');
  });
  await test(label + ' ' + 'INDIE: a missing or placeholder coupon id in the env disables every INDIE- code with no lookup', async () => {
    stripePromoCodes.clear();
    addPromo('INDIE-AB12CD34');
    for (const id of [undefined, '', 'REPLACE_WITH_COUPON_ID']) {
      stripeCalls = [];
      const env = { ...baseEnv, INDIE_PUBLISHER_COUPON_ID: id };
      assert.equal((await post(order({ version: 'premium', promo: 'INDIE-AB12CD34' }), env)).status, 200);
      assert.equal(checkoutCall().params.get('discounts[0][promotion_code]'), null, String(id));
      assert.equal(lookups().length, 0, String(id));
    }
  });
  await test(label + ' ' + 'INDIE: Express is never discounted: two plain line items, one promotion code, and the Express supplement is added', async () => {
    stripePromoCodes.clear();
    const p = addPromo('INDIE-AB12CD34');
    stripeCalls = [];
    assert.equal((await post(order({ version: 'premium', promo: 'INDIE-AB12CD34', express: true }))).status, 200);
    const c = checkoutCall();
    assert.equal(c.params.get('line_items[0][price]'), 'price_prem');
    assert.equal(c.params.get('line_items[1][price]'), 'price_x_prem');
    assert.equal(c.params.get('line_items[0][quantity]'), '1');
    assert.equal(c.params.get('line_items[1][quantity]'), '1');
    assert.equal(c.params.get('discounts[0][promotion_code]'), p.id);
    assert.equal(c.params.get('discounts[1][promotion_code]'), null);
    assert.equal(c.params.get('discounts[0][coupon]'), null);
  });
  await test(label + ' ' + 'INDIE: webhook totals are 190/209/158 without Express and 289/308/257 with Express, and the promo is recorded', async () => {
    stripePromoCodes.clear();
    addPromo('INDIE-AB12CD34');
    const cases = [
      [false, 'eur', 19000, 10900], [false, 'usd', 20900, 12000], [false, 'gbp', 15800, 9100],
      [true, 'eur', 28900, 10900], [true, 'usd', 30800, 12000], [true, 'gbp', 25700, 9100],
    ];
    for (const [express, cur, total, off] of cases) {
      await post(order({ version: 'premium', promo: 'INDIE-AB12CD34', express }));
      const { id } = lastRecord();
      const { rec } = await pay(id, 'premium', express, total, cur, { meta: { promo: 'INDIE-AB12CD34' }, session: { total_details: { amount_discount: off } } });
      assert.deepEqual([rec.expectedTotal, rec.amountMatches, rec.discountApplied, rec.promo], [total, true, true, 'INDIE-AB12CD34'], cur + ' ' + express);
    }
  });
  await test(label + ' ' + 'INDIE: promo and discountApplied are recorded only when amount_discount is above 0', async () => {
    stripePromoCodes.clear();
    for (const total_details of [{ amount_discount: 0 }, undefined, {}]) {
      await post(order({ version: 'premium', promo: 'INDIE-AB12CD34' }));
      const { id } = lastRecord();
      const { rec } = await pay(id, 'premium', false, 29900, 'eur', { meta: { promo: 'INDIE-AB12CD34' }, session: { total_details } });
      assert.equal('promo' in rec, false);
      assert.equal('discountApplied' in rec, false);
      assert.deepEqual([rec.expectedTotal, rec.listTotal, rec.amountMatches], [29900, 29900, true]);
    }
  });
  await test(label + ' ' + 'INDIE: promo rate limit is 20 checks per 10 minutes per IP, then 429 with no extra Stripe lookup', async () => {
    stripePromoCodes.clear();
    addPromo('INDIE-AB12CD34');
    const ip = '7.7.7.7';
    stripeCalls = [];
    for (let i = 0; i < 20; i++) assert.equal((await promoGet('INDIE-AB12CD34', ip)).status, 200, 'check ' + (i + 1));
    assert.equal(lookups().length, 20);
    assert.equal((await promoGet('INDIE-AB12CD34', ip)).status, 429);
    assert.equal(lookups().length, 20, 'a rate limited check does not call Stripe');
    assert.equal(kvTtl.get('order:rlp:' + ip), 600);
    // another IP has its own counter
    assert.equal((await promoGet('INDIE-AB12CD34', '7.7.7.8')).status, 200);
    // the order limit is a separate counter
    const r = await call('/api/order', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://spritzconsulting.com', 'CF-Connecting-IP': ip }, body: JSON.stringify(order({ version: 'premium', promo: 'INDIE-AB12CD34' })) });
    assert.equal(r.status, 200);
  });

  await test(label + ' ' + 'dashboard variables given as JSON text work like objects', async () => {
    const textEnv = { ...baseEnv, PRICES: JSON.stringify(baseEnv.PRICES), EXPRESS_PRICES: JSON.stringify(baseEnv.EXPRESS_PRICES), PRICE_AMOUNTS: JSON.stringify(baseEnv.PRICE_AMOUNTS), EXPRESS_AMOUNTS: JSON.stringify(baseEnv.EXPRESS_AMOUNTS), PROMOS: JSON.stringify(baseEnv.PROMOS) };
    const cfg = await (await call('/api/order/config', { method: 'GET' }, textEnv)).json();
    assert.deepEqual(cfg, FULL_CONFIG);
    stripeCalls = [];
    const r = await post(order({ express: true }), textEnv);
    assert.equal(r.status, 200);
    assert.equal(stripeCalls[0].params.get('line_items[0][price]'), 'price_std');
    assert.equal(stripeCalls[0].params.get('line_items[1][price]'), 'price_x_std');
  });
  // ---- PRICE_PERCENT_OFF: one global discount, one coupon per order ------------------------------
  const couponCalls = () => stripeCalls.filter((c) => c.url === 'https://api.stripe.com/v1/coupons' && c.method === 'POST');
  const deleteCalls = () => stripeCalls.filter((c) => c.method === 'DELETE');
  const pctEnv = (p, extra) => ({ ...baseEnv, PRICE_PERCENT_OFF: p, ...extra });
  const orderKeys = () => [...kv.keys()].filter((k) => /^order:[0-9a-f-]{36}$/.test(k));
  const CENTS = (a, b, c) => ({ eur: a, usd: b, gbp: c });
  // [label, order body, list total in cents, final total in cents at 99 percent]
  const TABLE99 = [
    ['Indie', { version: 'standard' }, CENTS(9900, 10900, 8900), CENTS(99, 109, 89)],
    ['Indie + Express', { version: 'standard', express: true }, CENTS(14800, 15800, 13800), CENTS(148, 158, 138)],
    ['Indie + SOLODEV20', { version: 'standard', promo: 'SOLODEV20' }, CENTS(9900, 10900, 8900), CENTS(79, 87, 71)],
    ['Indie + SOLODEV20 + Express', { version: 'standard', promo: 'SOLODEV20', express: true }, CENTS(14800, 15800, 13800), CENTS(128, 136, 120)],
    ['Publisher', { version: 'premium' }, CENTS(29900, 32900, 24900), CENTS(299, 329, 249)],
    ['Publisher + Express', { version: 'premium', express: true }, CENTS(39800, 42800, 34800), CENTS(398, 428, 348)],
    ['Publisher + SOLODEV10', { version: 'premium', promo: 'SOLODEV10' }, CENTS(29900, 32900, 24900), CENTS(269, 296, 224)],
    ['Publisher + SOLODEV10 + Express', { version: 'premium', promo: 'SOLODEV10', express: true }, CENTS(39800, 42800, 34800), CENTS(368, 395, 323)],
    ['Publisher + INDIE-', { version: 'premium', promo: 'INDIE-TABLE001' }, CENTS(29900, 32900, 24900), CENTS(190, 209, 158)],
    ['Publisher + INDIE- + Express', { version: 'premium', promo: 'INDIE-TABLE001', express: true }, CENTS(39800, 42800, 34800), CENTS(289, 308, 257)],
  ];
  for (const [name, body, list, final] of TABLE99) {
    await test(label + ' ' + 'percent 99: ' + name + ' makes one coupon worth list minus ' + final.eur + '/' + final.usd + '/' + final.gbp + ' cents', async () => {
      stripePromoCodes.clear();
      const p = addPromo('INDIE-TABLE001');
      stripeCalls = [];
      couponStatus = 200;
      const r = await post(order(body), pctEnv(99));
      assert.equal(r.status, 200);
      const cc = couponCalls();
      assert.equal(cc.length, 1);
      const cp = cc[0].params;
      assert.equal(cp.get('currency'), 'eur');
      assert.equal(cp.get('amount_off'), String(list.eur - final.eur));
      assert.equal(cp.get('currency_options[usd][amount_off]'), String(list.usd - final.usd));
      assert.equal(cp.get('currency_options[gbp][amount_off]'), String(list.gbp - final.gbp));
      assert.equal(cp.get('max_redemptions'), '1');
      assert.equal(cp.get('duration'), 'once');
      assert.ok(Number(cp.get('redeem_by')) > Date.now() / 1000 + 24 * 3600);
      const c = checkoutCall().params;
      assert.equal(c.get('discounts[0][coupon]'), 'cpn_order_' + couponSeq);
      assert.equal(c.get('discounts[0][promotion_code]'), null);
      assert.equal(c.get('discounts[1][coupon]'), null);
      assert.equal(c.get('metadata[percent_off]'), '99');
      assert.equal(c.get('metadata[coupon_id]'), 'cpn_order_' + couponSeq);
      assert.equal(c.get('line_items[0][price]'), body.version === 'premium' ? 'price_prem' : 'price_std');
      assert.equal(c.get('metadata[express]'), body.express ? 'true' : 'false');
      if (body.promo) assert.equal(c.get('metadata[promo]'), body.promo);
      if (body.promo && body.promo.startsWith('INDIE-')) assert.equal(c.get('metadata[promo_id]'), p.id);
    });
  }
  await test(label + ' ' + 'percent 50: Publisher with Express costs half (398 becomes 199 / 214 / 174)', async () => {
    stripeCalls = [];
    assert.equal((await post(order({ version: 'premium', express: true }), pctEnv(50))).status, 200);
    const cp = couponCalls()[0].params;
    assert.equal(cp.get('amount_off'), '19900');
    assert.equal(cp.get('currency_options[usd][amount_off]'), '21400');
    assert.equal(cp.get('currency_options[gbp][amount_off]'), '17400');
  });
  await test(label + ' ' + 'percent 0, empty or missing: no coupon is made and the session is as before', async () => {
    for (const v of [0, '0', '', undefined]) {
      stripeCalls = [];
      assert.equal((await post(order({ version: 'premium', promo: 'SOLODEV10' }), pctEnv(v))).status, 200);
      assert.equal(couponCalls().length, 0);
      assert.equal(checkoutCall().params.get('discounts[0][coupon]'), 'yZBBORrT');
      assert.equal(checkoutCall().params.get('metadata[percent_off]'), null);
    }
  });
  await test(label + ' ' + 'percent: values that are not whole numbers from 0 to 100 count as 0', async () => {
    for (const v of [-5, 101, 12.5, 'abc', '1e1x']) {
      stripeCalls = [];
      assert.equal((await post(order({ version: 'standard' }), pctEnv(v))).status, 200, String(v));
      assert.equal(couponCalls().length, 0, String(v));
      assert.equal(checkoutCall().params.get('discounts[0][coupon]'), null, String(v));
    }
  });
  await test(label + ' ' + 'percent above 50 with a live key needs ALLOW_DEEP_DISCOUNT', async () => {
    const live = { STRIPE_SECRET_KEY: 'sk_live_x' };
    stripeCalls = [];
    assert.equal((await post(order({ version: 'standard' }), pctEnv(99, live))).status, 200);
    assert.equal(couponCalls().length, 0);
    assert.equal(checkoutCall().params.get('discounts[0][coupon]'), null);
    stripeCalls = [];
    assert.equal((await post(order({ version: 'standard' }), pctEnv(99, { ...live, ALLOW_DEEP_DISCOUNT: 'true' }))).status, 200);
    assert.equal(couponCalls().length, 1);
    stripeCalls = [];
    assert.equal((await post(order({ version: 'standard' }), pctEnv(50, live))).status, 200);
    assert.equal(couponCalls().length, 1);   // 50 or less needs no permission
    stripeCalls = [];
    assert.equal((await post(order({ version: 'standard' }), pctEnv(99, { STRIPE_SECRET_KEY: 'rk_test_x' }))).status, 200);
    assert.equal(couponCalls().length, 1);   // a restricted test key counts as a test key
  });
  await test(label + ' ' + 'percent: a total under the Stripe minimum is refused with 422 amount_too_low, nothing stored', async () => {
    const tiny = { PRICE_AMOUNTS: { eur: { standard: 40, premium: 299 }, usd: { standard: 109, premium: 329 }, gbp: { standard: 89, premium: 249 } } };
    const before = orderKeys().length;
    stripeCalls = [];
    const r = await post(order({ version: 'standard' }), pctEnv(99, tiny));
    assert.equal(r.status, 422);
    assert.equal((await r.json()).error, 'amount_too_low');
    assert.equal(stripeCalls.length, 0);
    assert.equal(orderKeys().length, before);
  });
  await test(label + ' ' + 'percent: a missing list amount refuses the order with 500 not_configured', async () => {
    const noUsd = { PRICE_AMOUNTS: { eur: { standard: 99, premium: 299 }, gbp: { standard: 89, premium: 249 } } };
    stripeCalls = [];
    const r = await post(order({ version: 'standard' }), pctEnv(99, noUsd));
    assert.equal(r.status, 500);
    assert.equal(stripeCalls.length, 0);
  });
  await test(label + ' ' + 'percent: if Stripe refuses the coupon the order fails with 502 and no session or record is left', async () => {
    const before = orderKeys().length;
    stripeCalls = [];
    couponStatus = 400;
    try {
      const r = await post(order({ version: 'premium' }), pctEnv(99));
      assert.equal(r.status, 502);
      assert.equal((await r.json()).error, 'checkout_failed');
      assert.equal(checkoutCall(), undefined);
      assert.equal(orderKeys().length, before);
    } finally { couponStatus = 200; }
  });
  await test(label + ' ' + 'percent: if the session fails after the coupon was made, the coupon is deleted', async () => {
    const realFetch = globalThis.fetch;
    stripeCalls = [];
    globalThis.fetch = async (url, init = {}) => {
      if (String(url) === 'https://api.stripe.com/v1/checkout/sessions') {
        stripeCalls.push({ url: String(url), method: init.method || 'GET', params: new URLSearchParams(init.body || '') });
        return new Response(JSON.stringify({ error: { type: 'invalid_request_error', message: 'x' } }), { status: 400 });
      }
      return realFetch(url, init);
    };
    try {
      const r = await post(order({ version: 'premium' }), pctEnv(99));
      assert.equal(r.status, 502);
      assert.equal(deleteCalls().length, 1);
      assert.equal(deleteCalls()[0].url, 'https://api.stripe.com/v1/coupons/cpn_order_' + couponSeq);
    } finally { globalThis.fetch = realFetch; }
  });
  await test(label + ' ' + 'percent: config shows the discounted amounts, the percentage and the list amounts', async () => {
    const j = await (await call('/api/order/config', { method: 'GET' }, pctEnv(99))).json();
    assert.equal(j.percentOff, 99);
    assert.deepEqual(j.amounts.standard, { eur: 0.99, usd: 1.09, gbp: 0.89 });
    assert.deepEqual(j.amounts.premium, { eur: 2.99, usd: 3.29, gbp: 2.49 });
    assert.deepEqual(j.express.standard, { eur: 0.49, usd: 0.49, gbp: 0.49 });
    assert.deepEqual(j.express.premium, { eur: 0.99, usd: 0.99, gbp: 0.99 });
    assert.deepEqual(j.listAmounts, FULL_CONFIG.amounts);
    assert.deepEqual(j.listExpress, FULL_CONFIG.express);
    const off = await (await call('/api/order/config', { method: 'GET' }, pctEnv(0))).json();
    assert.deepEqual(off, FULL_CONFIG);   // no new fields when the discount is off
  });
  await test(label + ' ' + 'percent: /api/order/promo shows the code price after the percentage', async () => {
    const r = await call('/api/order/promo?code=SOLODEV10', { method: 'GET', headers: { 'CF-Connecting-IP': '9.9.9.9' } }, pctEnv(50));
    assert.deepEqual(await r.json(), { valid: true, tier: 'premium', amounts: { eur: 134.5, usd: 148, gbp: 112 }, listAmounts: { eur: 269, usd: 296, gbp: 224 }, percentOff: 50 });
  });
  await test(label + ' ' + 'percent: INDIE_PUBLISHER_AMOUNTS variable replaces the default amounts, and a broken one falls back', async () => {
    stripePromoCodes.clear();
    addPromo('INDIE-VAR00001');
    const r1 = await call('/api/order/promo?code=INDIE-VAR00001', { method: 'GET', headers: { 'CF-Connecting-IP': '9.9.9.8' } }, { ...baseEnv, INDIE_PUBLISHER_AMOUNTS: JSON.stringify({ eur: 180, usd: 199, gbp: 150 }) });
    assert.deepEqual((await r1.json()).amounts, { eur: 180, usd: 199, gbp: 150 });
    const r2 = await call('/api/order/promo?code=INDIE-VAR00001', { method: 'GET', headers: { 'CF-Connecting-IP': '9.9.9.7' } }, { ...baseEnv, INDIE_PUBLISHER_AMOUNTS: '{"eur":180}' });
    assert.deepEqual((await r2.json()).amounts, { eur: 190, usd: 209, gbp: 158 });
  });
  await test(label + ' ' + 'percent webhook: an INDIE- order is checked at the discounted total, the code is switched off and the coupon deleted', async () => {
    stripePromoCodes.clear();
    const p = addPromo('INDIE-HOOK0001');
    stripeCalls = [];
    assert.equal((await post(order({ version: 'premium', express: true, promo: 'INDIE-HOOK0001' }), pctEnv(99))).status, 200);
    const id = orderKeys().pop().slice(6);
    const couponId = 'cpn_order_' + couponSeq;
    const created = Math.floor(new Date('2026-11-17T10:00:00+01:00').getTime() / 1000);
    const ev = JSON.stringify({ type: 'checkout.session.completed', created, data: { object: {
      id: 'cs_pct_1', payment_status: 'paid', amount_total: 289, currency: 'eur', total_details: { amount_discount: 39511 },
      metadata: { order_id: id, tier: 'premium', express: 'true', promo: 'INDIE-HOOK0001', promo_id: p.id, percent_off: '99', coupon_id: couponId } } } });
    stripeCalls = [];
    assert.equal((await call('/api/order/webhook', { method: 'POST', headers: signed(ev), body: ev })).status, 200);
    const rec = JSON.parse(kv.get('order:' + id));
    assert.deepEqual([rec.percentOff, rec.promo, rec.discountApplied, rec.expectedTotal, rec.amountMatches, rec.listTotal], [99, 'INDIE-HOOK0001', true, 289, true, 39800]);
    const off = stripeCalls.find((c) => c.method === 'POST' && c.url === 'https://api.stripe.com/v1/promotion_codes/' + p.id);
    assert.ok(off, 'promotion code switched off');
    assert.equal(off.params.get('active'), 'false');
    assert.ok(stripeCalls.find((c) => c.method === 'DELETE' && c.url === 'https://api.stripe.com/v1/coupons/' + couponId), 'coupon deleted');
    // Stripe may send the event twice: the second delivery does nothing more.
    stripeCalls = [];
    const again = await call('/api/order/webhook', { method: 'POST', headers: signed(ev), body: ev });
    assert.equal((await again.json()).duplicate, true);
    assert.equal(stripeCalls.length, 0);
  });
  await test(label + ' ' + 'percent webhook: a percentage without a code is recorded and the total is checked (Indie in GBP at 99 percent)', async () => {
    stripeCalls = [];
    assert.equal((await post(order({ version: 'standard' }), pctEnv(99))).status, 200);
    const id = orderKeys().pop().slice(6);
    const couponId = 'cpn_order_' + couponSeq;
    const created = Math.floor(new Date('2026-11-17T10:00:00+01:00').getTime() / 1000);
    const mk = (sid, total) => JSON.stringify({ type: 'checkout.session.completed', created, data: { object: {
      id: sid, payment_status: 'paid', amount_total: total, currency: 'gbp', total_details: { amount_discount: 8811 },
      metadata: { order_id: id, tier: 'standard', express: 'false', percent_off: '99', coupon_id: couponId } } } });
    const good = mk('cs_pct_2', 89);
    assert.equal((await call('/api/order/webhook', { method: 'POST', headers: signed(good), body: good })).status, 200);
    let rec = JSON.parse(kv.get('order:' + id));
    assert.deepEqual([rec.percentOff, rec.promo, rec.expectedTotal, rec.amountMatches], [99, undefined, 89, true]);
    const bad = mk('cs_pct_3', 8900);   // the full price paid by mistake
    assert.equal((await call('/api/order/webhook', { method: 'POST', headers: signed(bad), body: bad })).status, 200);
    rec = JSON.parse(kv.get('order:' + id));
    assert.equal(rec.amountMatches, false);
  });

  // ---- Solo Dev (free): POST /api/order/free ---------------------------------------------
  const resetFree = () => { for (const k of [...kv.keys()]) if (k.startsWith('free:') || k.startsWith('order:rlf:') || k.startsWith('order:')) { kv.delete(k); kvTtl.delete(k); } stripeCalls = []; };
  let freeIp = 0;
  const freePost = (body, ip, env) => call('/api/order/free', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://spritzconsulting.com', 'CF-Connecting-IP': ip || ('7.7.' + (freeIp >> 8) + '.' + (freeIp++ & 255)) },
    body: JSON.stringify(body),
  }, env);
  const free = (n, extra) => ({ steam: 'https://store.steampowered.com/app/' + n + '/', email: 'dev' + n + '@studio.co', page: '/steam-analysis/', referrer: '', ...extra });
  const freeKeys = () => [...kv.keys()].filter((k) => k.startsWith('free:'));
  const freeRecords = () => [...kv.entries()].filter(([k]) => k.startsWith('order:') && !k.startsWith('order:rl') && !k.startsWith('order:paid:')).map(([, v]) => JSON.parse(v));
  const today = () => new Date().toISOString().slice(0, 10);

  await test(label + ' ' + 'free: success stores the order and the three counters, and makes no Stripe call', async () => {
    resetFree();
    const r = await freePost(free(1234, { email: '  Raw.Email@Example.com ' }));
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true });
    assert.deepEqual(stripeCalls, [], 'stripeCalls stays empty');
    const recs = freeRecords();
    assert.equal(recs.length, 1);
    const rec = recs[0];
    assert.deepEqual([rec.status, rec.tier, rec.appId, rec.email, rec.steam, rec.page], ['free_new', 'free', '1234', 'Raw.Email@Example.com', 'https://store.steampowered.com/app/1234/', '/steam-analysis/']);
    for (const f of ['id', 'createdAt', 'referrer', 'ip', 'country']) assert.ok(f in rec, f);
    assert.equal(kvTtl.get('order:' + rec.id), 30 * 24 * 3600);
    const code = crypto.createHash('sha256').update('raw.email@example.com').digest('hex');
    assert.deepEqual(freeKeys().sort(), ['free:app:1234', 'free:day:' + today(), 'free:email:' + code].sort());
    assert.deepEqual([kv.get('free:email:' + code), kv.get('free:app:1234'), kv.get('free:day:' + today())], ['1', '1', '1']);
    assert.deepEqual([kvTtl.get('free:email:' + code), kvTtl.get('free:app:1234'), kvTtl.get('free:day:' + today())], [365 * 86400, 365 * 86400, 2 * 86400]);
  });
  await test(label + ' ' + 'free: the raw email never appears in a free:* key or value', async () => {
    resetFree();
    await freePost(free(2001, { email: 'Secret.Name@Example.com' }));
    for (const [k, v] of kv.entries()) {
      if (!k.startsWith('free:')) continue;
      assert.equal(k.toLowerCase().includes('secret'), false, k);
      assert.equal(k.toLowerCase().includes('example'), false, k);
      assert.equal(String(v).includes('@'), false, k);
    }
  });
  await test(label + ' ' + 'free: the 4th order with the same email returns 409 email_limit, and counts nothing', async () => {
    resetFree();
    for (const n of [3001, 3002, 3003]) assert.equal((await freePost(free(n, { email: 'same@studio.co' }))).status, 200);
    const r = await freePost(free(3004, { email: 'SAME@Studio.co' }));   // case does not matter
    assert.deepEqual([r.status, await r.json()], [409, { ok: false, error: 'email_limit' }]);
    assert.equal(kv.has('free:app:3004'), false);
    assert.equal(kv.get('free:day:' + today()), '3');
    assert.equal(freeRecords().length, 3);
    assert.deepEqual(stripeCalls, []);
  });
  await test(label + ' ' + 'free: a second order for the same Steam app id returns 409 game_limit', async () => {
    resetFree();
    assert.equal((await freePost(free(4001, { email: 'a@studio.co' }))).status, 200);
    const r = await freePost({ ...free(4001, { email: 'b@studio.co' }), steam: 'https://steamcommunity.com/app/4001/' });
    assert.deepEqual([r.status, await r.json()], [409, { ok: false, error: 'game_limit' }]);
    assert.equal(freeRecords().length, 1);
    assert.equal(kv.get('free:day:' + today()), '1');
  });
  await test(label + ' ' + 'free: the 6th order of the UTC day returns 429 daily_limit', async () => {
    resetFree();
    for (let n = 5001; n <= 5005; n++) assert.equal((await freePost(free(n))).status, 200);
    const r = await freePost(free(5006));
    assert.deepEqual([r.status, await r.json()], [429, { ok: false, error: 'daily_limit' }]);
    assert.equal(freeRecords().length, 5);
    assert.equal(kv.get('free:day:' + today()), '5');
  });
  await test(label + ' ' + 'free: a link without an app id returns 422 invalid_steam_link and stores nothing', async () => {
    resetFree();
    for (const steam of ['https://steamcommunity.com/id/someone', 'https://steamcommunity.com/', 'https://store.steampowered.com/', 'https://store.steampowered.com/app/', 'https://store.steampowered.com/app/abc/', 'https://evil.example/app/123/', 'nope', '']) {
      const r = await freePost(free(6001, { steam }));
      assert.deepEqual([r.status, (await r.json()).error], [422, 'invalid_steam_link'], steam);
    }
    const bad = await freePost(free(6002, { email: 'not-an-email' }));
    assert.deepEqual([bad.status, (await bad.json()).error], [422, 'invalid_email']);
    assert.deepEqual([freeKeys(), freeRecords().length, stripeCalls], [[], 0, []]);
  });
  await test(label + ' ' + 'free: an app id link on steamcommunity.com and one without a trailing slash are accepted', async () => {
    resetFree();
    assert.equal((await freePost(free(7001, { steam: 'https://steamcommunity.com/app/7001' }))).status, 200);
    assert.equal((await freePost(free(7002, { steam: 'https://store.steampowered.com/app/7002/Some_Game/?l=english' }))).status, 200);
    assert.deepEqual(freeRecords().map((x) => x.appId).sort(), ['7001', '7002']);
  });
  await test(label + ' ' + 'free: per-IP limit is 5 per 600 seconds with its own prefix, then 429 rate_limited', async () => {
    resetFree();
    const ip = '9.9.9.9';
    for (let n = 8001; n <= 8005; n++) assert.equal((await freePost(free(n), ip)).status, 200);
    const r = await freePost(free(8006), ip);
    assert.deepEqual([r.status, (await r.json()).error], [429, 'rate_limited']);
    assert.equal(kvTtl.get('order:rlf:' + ip), 600);
    assert.equal(kv.has('order:rl:' + ip), false, 'the paid counter is untouched');
    assert.equal(freeRecords().length, 5);
  });
  await test(label + ' ' + 'free: foreign origin 403, GET 405, OPTIONS 204, bad JSON 400', async () => {
    resetFree();
    assert.equal((await call('/api/order/free', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: JSON.stringify(free(9001)) })).status, 403);
    assert.equal((await call('/api/order/free', { method: 'GET' })).status, 405);
    assert.equal((await call('/api/order/free', { method: 'OPTIONS', headers: { Origin: 'https://spritzconsulting.com' } })).status, 204);
    assert.equal((await call('/api/order/free', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://spritzconsulting.com' }, body: '{' })).status, 400);
    assert.deepEqual([freeKeys(), freeRecords().length], [[], 0]);
  });
  await test(label + ' ' + 'free: POST /api/order still refuses the free tier with 422 invalid_tier', async () => {
    resetFree();
    const r = await post(order({ version: 'free' }));
    assert.deepEqual([r.status, (await r.json()).error], [422, 'invalid_tier']);
    assert.deepEqual([freeKeys(), stripeCalls], [[], []]);
  });

  // ---- Notification email through the Apps Script web app --------------------------------
  const notifyEnv = { ...baseEnv, NOTIFY_URL, NOTIFY_SECRET, NOTIFY_TO: 'owner@example.com' };
  const logsDuring = async (fn) => {
    const saved = console.log; const out = [];
    console.log = (...a) => out.push(a.join(' '));
    try { await fn(); } finally { console.log = saved; }
    return out;
  };
  const resetNotify = () => { resetFree(); notifyCalls = []; notifyMode = 200; };
  // Starts a paid order and prepares its paid webhook. hook() delivers it.
  async function paidWith(env, extra = {}, sid = 'cs_nt_1', total = 14800, cur = 'eur') {
    const r = await post(order({ steam: 'https://store.steampowered.com/app/4242/', email: 'buyer@studio.co', quarter: '2027-Q2', wishlists: 5000, price: 19.99, notes: 'Line one\nLine two', news: true, waiver: true, page: '/steam-analysis/', ...extra }), env);
    assert.equal(r.status, 200);
    const id = lastRecord().id;
    const body = JSON.stringify({ type: 'checkout.session.completed', created, data: { object: { id: sid, payment_status: 'paid', metadata: { order_id: id, tier: extra.version || 'standard', express: String(extra.express === true) }, amount_total: total, currency: cur } } });
    return { id, sid, body, hook: (e = env) => call('/api/order/webhook', { method: 'POST', headers: signed(body), body }, e) };
  }

  await test(label + ' ' + 'notify: a free order sends one email with replyTo and the Steam link, and no IP address', async () => {
    resetNotify();
    const r = await freePost(free(1234, { email: 'dev@studio.co', referrer: '' }), '5.6.7.8', notifyEnv);
    assert.equal(r.status, 200);
    assert.equal(notifyCalls.length, 1);
    const c = notifyCalls[0];
    assert.deepEqual([c.url, c.init.method, c.init.redirect], [NOTIFY_URL, 'POST', 'follow']);
    assert.deepEqual([c.body.secret, c.body.to, c.body.replyTo, c.body.subject], [NOTIFY_SECRET, 'owner@example.com', 'dev@studio.co', 'New Solo Dev order: app 1234']);
    const lines = c.body.body.split('\n');
    assert.ok(lines.includes('Steam link:') && lines.includes('https://store.steampowered.com/app/1234/'), 'the Steam link has its own line');
    assert.ok(lines.includes('App id: 1234') && lines.includes('Customer email: dev@studio.co') && lines.includes('Referrer: -') && lines.includes('Page: /steam-analysis/'));
    assert.equal(c.body.body.includes('5.6.7.8'), false, 'no IP address');
    assert.equal(c.body.body.includes('Order id: ' + freeRecords()[0].id), true);
    assert.deepEqual(stripeCalls, [], 'no Stripe call');
  });
  await test(label + ' ' + 'notify: a paid order sends one email from the webhook, with amount and notes, and none when it is only started', async () => {
    resetNotify();
    const p = await paidWith(notifyEnv, { express: true });
    assert.equal(notifyCalls.length, 0, 'no email when the order is only started');
    assert.equal((await p.hook()).status, 200);
    assert.equal(notifyCalls.length, 1);
    const c = notifyCalls[0];
    assert.deepEqual([c.body.replyTo, c.body.subject], ['buyer@studio.co', 'New Indie order paid: app 4242 + Express']);
    const text = c.body.body, lines = text.split('\n');
    for (const l of ['Tier: Indie', 'Express: Yes', 'Quarter: 2027-Q2', 'Wishlists: 5000', 'Planned price: 19.99', 'Notes: Line one Line two', 'Newsletter consent: Yes', 'Waiver: Yes', 'Promo code: -',
      'Amount paid: 148.00 EUR', 'Currency: EUR', 'Expected total: 148.00 EUR', 'Matches expected total: Yes', 'Due date: 2026-11-18', 'Stripe session id: cs_nt_1', 'App id: 4242']) assert.ok(lines.includes(l), l);
    assert.ok(lines.includes('Steam link:') && lines.includes('https://store.steampowered.com/app/4242/'));
    assert.equal(/1\.2\.3\./.test(text), false, 'no IP address');
    assert.deepEqual(stripeCalls.filter((x) => x.url.startsWith(NOTIFY_URL)), [], 'the notice is not a Stripe call');
  });
  await test(label + ' ' + 'notify: the Publisher subject has no Express suffix when Express is off', async () => {
    resetNotify();
    const p = await paidWith(notifyEnv, { version: 'premium' }, 'cs_nt_2', 29900);
    await p.hook();
    assert.equal(notifyCalls.length, 1);
    assert.equal(notifyCalls[0].body.subject, 'New Publisher order paid: app 4242');
  });
  await test(label + ' ' + 'notify: a second webhook for the same session sends no second email', async () => {
    resetNotify();
    const p = await paidWith(notifyEnv, {}, 'cs_nt_3', 9900);
    await p.hook();
    const again = await p.hook();
    assert.equal((await again.json()).duplicate, true);
    assert.equal(notifyCalls.length, 1);
  });
  await test(label + ' ' + 'notify: missing variables send nothing, log once at most, and the order still succeeds', async () => {
    resetNotify();
    let skipLogs = 0, n = 0;
    for (const missing of ['NOTIFY_URL', 'NOTIFY_SECRET', 'NOTIFY_TO']) {
      const env = { ...notifyEnv, [missing]: undefined };
      const logs = await logsDuring(async () => {
        const f = await freePost(free(9100 + n), undefined, env);
        assert.deepEqual([f.status, (await f.json()).ok], [200, true], missing);
        const p = await paidWith(env, {}, 'cs_nt_m' + n, 9900);
        assert.equal((await p.hook()).status, 200);
        assert.equal(JSON.parse(kv.get('order:' + p.id)).status, 'paid');
      });
      n++;
      skipLogs += logs.filter((l) => l.startsWith('notification email skipped')).length;
    }
    assert.equal(notifyCalls.length, 0);
    assert.ok(skipLogs <= 1, 'logged at most once, got ' + skipLogs);
  });
  await test(label + ' ' + 'notify: a 500 or a network error from the script changes nothing in the responses, and the log has no URL or secret', async () => {
    resetNotify();
    const all = [];
    for (const mode of [500, 'throw']) {
      notifyMode = mode;
      const k = mode === 500 ? 0 : 1;
      all.push(...await logsDuring(async () => {
        const f = await freePost(free(9200 + k), undefined, notifyEnv);
        assert.deepEqual([f.status, await f.json()], [200, { ok: true }], String(mode));
        const p = await paidWith(notifyEnv, {}, 'cs_nt_e' + k, 9900);
        const h = await p.hook();
        assert.deepEqual([h.status, (await h.json()).ok], [200, true], String(mode));
        assert.equal(JSON.parse(kv.get('order:' + p.id)).status, 'paid');
      }));
    }
    assert.ok(notifyCalls.length >= 4, 'each order tried to send');
    assert.ok(all.some((l) => l === 'notification email failed: status 500'), 'the status code is logged');
    for (const l of all) {
      assert.equal(l.includes(NOTIFY_SECRET) || l.includes('TESTSCRIPTID') || l.includes('script.google.com') || l.includes('owner@example.com'), false, l);
    }
  });
  await test(label + ' ' + 'notify: a free order refused by a limit sends no email', async () => {
    resetNotify();
    await freePost(free(9300), undefined, notifyEnv);
    notifyCalls = [];
    const r = await freePost(free(9300, { email: 'other@studio.co' }), undefined, notifyEnv);
    assert.equal(r.status, 409);
    assert.equal(notifyCalls.length, 0);
    resetFree();
  });

}

await workerSuite('source:', worker);
await workerSuite('single:', workerSingle);

await test('worker.single.js has no import or named export left', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('./worker.single.js', import.meta.url), 'utf8');
  assert.equal(/^import /m.test(src), false);
  assert.equal((src.match(/^export /gm) || []).length, 1);   // only "export default"
});

console.log(failed ? '\n' + failed + ' failed' : '\nall passed');
process.exit(failed ? 1 : 0);

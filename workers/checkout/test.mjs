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
  };
  const FULL_CONFIG = {
    enabled: true,
    currencies: ['eur', 'usd', 'gbp'],
    amounts: { standard: { eur: 99, usd: 109, gbp: 89 }, premium: { eur: 299, usd: 329, gbp: 249 } },
    express: { standard: { eur: 49, usd: 49, gbp: 49 }, premium: { eur: 99, usd: 99, gbp: 99 } },
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
    assert.equal(lastRecord().rec.promo, 'SOLODEV20');
    stripeCalls = [];
    assert.equal((await post(order({ version: 'premium', promo: ' solodev10 ' }))).status, 200);
    assert.equal(stripeCalls[0].params.get('discounts[0][coupon]'), 'yZBBORrT');
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
      assert.equal(lastRecord().rec.promo, '');
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
          const { rec } = await pay(id, tier, express, total, cur, { session: { total_details: { amount_discount: 2000 } } });
          assert.deepEqual([rec.expectedTotal, rec.amountMatches, rec.discountApplied], [total, true, true], tier + ' ' + cur + ' ' + express);
          if (express) seen.push(total / 100);
        }
      }
    }
    // Totals with Express in the brief: Indie 128/136/120, Publisher 368/395/323.
    assert.deepEqual(seen, [128, 136, 120, 368, 395, 323]);
  });
  await test(label + ' ' + 'a promotion paid without a discount is dropped from the record: no promo, discountApplied or listTotal, list total expected', async () => {
    await post(order({ promo: 'SOLODEV20' }));
    const { id } = lastRecord();
    const { rec } = await pay(id, 'standard', false, 9900, 'eur', { session: { total_details: { amount_discount: 0 } } });
    assert.deepEqual([rec.promo, rec.discountApplied, rec.listTotal, rec.amountMatches, rec.expectedTotal], [undefined, undefined, undefined, true, 9900]);
  });
  await test(label + ' ' + 'an order without a promotion records no promo fields', async () => {
    await post(order({ express: true }));
    const { id } = lastRecord();
    const { rec } = await pay(id, 'standard', true, 14800, 'eur');
    assert.deepEqual([rec.promo, rec.discountApplied, rec.listTotal, rec.amountMatches], [undefined, undefined, undefined, true]);
  });
  await test(label + ' ' + 'a repeated webhook for a promotion order changes nothing', async () => {
    await post(order({ promo: 'SOLODEV20', steam: 'https://store.steampowered.com/app/555/', email: 'dup@x.co' }));
    const { id } = lastRecord();
    const first = await pay(id, 'standard', false, 7900, 'eur', { session: { total_details: { amount_discount: 2000 } } });
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

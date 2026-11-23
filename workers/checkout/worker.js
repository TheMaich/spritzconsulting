/**
 * Spritz Consulting order Worker (Steam Analysis, Indie and Publisher tiers).
 *
 *   GET  /api/order/config   what the order modal may offer (Express on or off, Express amounts)
 *   POST /api/order          validate the order, store it, create a Stripe Checkout session
 *   POST /api/order/webhook  Stripe tells us the session was paid: mark it paid, compute due_date
 *   GET  /api/order/promo    is a promotion code valid (and for which tier and amounts)
 *   POST /api/order/free     Solo Dev (free): validate, apply the free limits, store the order, no Stripe
 *
 * - One Checkout session with two line items: the tier price and, when asked for, the Express
 *   price (quantity 1 each). Express never replaces the base price.
 * - Stripe chooses the currency. Every price carries EUR, USD and GBP, and the Worker sends no
 *   currency to Checkout, so Stripe shows the buyer's local one. The amounts on the page are only
 *   information. The currency Stripe used and the paid total are recorded when the payment arrives,
 *   and the total is checked against the configured amounts (amountMatches).
 * - Express needs a price and an amount in all three currencies. If one is missing, Express is off
 *   for that tier, because Stripe could pick the missing one for a buyer.
 * - Orders live in the CONTACT_SUBMISSIONS KV namespace under the "order:" prefix and are
 *   deleted after 30 days, as the order form promises.
 * - Promotion codes (PROMOS) map a code to one tier, one Stripe coupon and the discounted amounts. The coupon is
 *   sent as discounts[0][coupon] on that tier's order only. It never touches the Express line, because the coupon
 *   is limited to the tier's product in Stripe. A code on the wrong tier is ignored without an error.
 * - Indie to Publisher codes start with INDIE- and are one-time promotion codes made by hand in Stripe on the coupon
 *   "Indie Publisher". Only these codes are looked up in Stripe (GET /v1/promotion_codes); every other code is checked
 *   against PROMOS and never reaches Stripe. The lookup must return an active code on the coupon in
 *   INDIE_PUBLISHER_COUPON_ID with times_redeemed below max_redemptions, and the order must be Publisher. The session
 *   then sends discounts[0][promotion_code]. Anything else is ignored silently and charges the full price.
 * - Global discount: PRICE_PERCENT_OFF (whole percent, default 0). Above 0 the Worker works out the final total per currency
 *   (the code price first, then the percentage, Express included) and makes ONE coupon for the order with an amount per
 *   currency, because Stripe Checkout takes one discount per session. The coupon lives 25 hours; the webhook deletes it
 *   after payment and switches an INDIE- code off (Stripe does not count that redemption in this mode). Above 50 it needs a
 *   test key or ALLOW_DEEP_DISCOUNT=true. With 0 the Worker behaves as described above and makes no coupon.
 * - Solo Dev (free) uses POST /api/order/free. It has no Stripe call, no waiver and no price. Limits: 3 orders per email,
 *   1 per Steam app id, 5 per UTC day in total, and 5 per IP per 10 minutes (own counter, prefix order:rlf:). The counters
 *   are free:email:<sha256 of the lowercased email>, free:app:<app id> and free:day:<YYYY-MM-DD>. The raw email is never
 *   part of a counter key. Delivery is manual: read the orders from KV (status "free_new").
 * - No tax settings are sent to Stripe: tax behaviour stays as configured on the prices.
 * - No notification email yet; read orders from KV (see README).
 */

import { dueDate } from './business-days.js';

const ALLOWED_ORIGINS = [
  'https://spritzconsulting.com',
  'https://www.spritzconsulting.com',
];

const CURRENCIES = ['eur', 'usd', 'gbp'];

// Business days of work per tier, normal and with Express.
const TIERS = {
  standard: { days: 2, expressDays: 1 },
  premium: { days: 3, expressDays: 2 },
};

// Indie to Publisher codes (INDIE-...): Publisher only. The discounted Publisher amounts in whole units
// (list 299 / 329 / 249). Express is added on top at its list amount.
const INDIE_PREFIX = 'INDIE-';
const INDIE_TIER = 'premium';
// Default amounts; the variable INDIE_PUBLISHER_AMOUNTS ({ eur, usd, gbp }) overrides them (see indieAmounts).
const INDIE_PUBLISHER_AMOUNTS = { eur: 190, usd: 209, gbp: 158 };

// PRICE_PERCENT_OFF lowers every price by the same percentage (0 = prices as decided, 99 = test prices, 50 = a promotion).
// Above DEEP_DISCOUNT_LIMIT it only works with a test key or with ALLOW_DEEP_DISCOUNT set to "true".
const DEEP_DISCOUNT_LIMIT = 50;
const COUPON_LIFETIME_SECONDS = 25 * 60 * 60;
// Smallest amount Stripe charges, in cents.
const MIN_CHARGE_CENTS = { eur: 50, usd: 50, gbp: 30 };

const ORDER_TTL_SECONDS = 30 * 24 * 60 * 60;
const RATE_WINDOW_SECONDS = 600;
const ORDERS_PER_WINDOW = 5;
const PROMO_CHECKS_PER_WINDOW = 20;
const WEBHOOK_TOLERANCE_SECONDS = 300;
// Solo Dev (free) limits. The email and game counters live for a year, the day counter for two days.
const FREE_PER_EMAIL = 3;
const FREE_PER_GAME = 1;
const FREE_PER_DAY = 5;
const FREE_COUNTER_TTL_SECONDS = 365 * 24 * 60 * 60;
const FREE_DAY_TTL_SECONDS = 2 * 24 * 60 * 60;
const FREE_ORDERS_PER_WINDOW = 5;
const MAX_FIELD_LENGTH = 200;
const MAX_NOTES_LENGTH = 1000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STEAM_RE = /^https?:\/\/(store\.steampowered\.com|steamcommunity\.com)\//i;
const PROMO_RE = /^[A-Z0-9-]{3,30}$/;
const QUARTER_RE = /^(released|undecided|\d{4}-Q[1-4])$/;

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(status, body, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...corsHeaders(origin),
    },
  });
}

function clip(value, max) {
  return String(value == null ? '' : value).slice(0, max).trim();
}

// ---- Express configuration -------------------------------------------------------------

// Variables set in the dashboard can arrive as JSON text instead of objects. Accept both.
function asObject(value) {
  if (typeof value === 'string') {
    try { return JSON.parse(value) || {}; } catch (err) { return {}; }
  }
  return value && typeof value === 'object' ? value : {};
}

// Indie to Publisher amounts: the variable INDIE_PUBLISHER_AMOUNTS, or the defaults when it is missing or incomplete.
function indieAmounts(env) {
  const obj = asObject(env.INDIE_PUBLISHER_AMOUNTS);
  const out = {};
  for (const currency of CURRENCIES) {
    const n = Number(obj[currency]);
    if (!(n > 0)) return { ...INDIE_PUBLISHER_AMOUNTS };
    out[currency] = n;
  }
  return out;
}

// The global discount in whole percent, 0 to 100. Anything else, or a deep discount without permission, counts as 0.
function percentOff(env) {
  const raw = env.PRICE_PERCENT_OFF;
  if (raw === undefined || raw === null || String(raw).trim() === '') return 0;
  const n = Number(String(raw).trim());
  if (!Number.isInteger(n) || n < 0 || n > 100) {
    console.log('PRICE_PERCENT_OFF ignored: not a whole number from 0 to 100');
    return 0;
  }
  if (n > DEEP_DISCOUNT_LIMIT) {
    const testKey = /^(sk|rk)_test_/.test(String(env.STRIPE_SECRET_KEY || ''));
    if (!testKey && String(env.ALLOW_DEEP_DISCOUNT).toLowerCase() !== 'true') {
      console.log('PRICE_PERCENT_OFF above ' + DEEP_DISCOUNT_LIMIT + ' ignored: needs a test key or ALLOW_DEEP_DISCOUNT');
      return 0;
    }
  }
  return n;
}

// An amount in whole units after the percentage, to the cent: applyPercent(299, 99) is 2.99.
function applyPercent(value, pct) {
  return Math.round(Math.round(value * 100) * (100 - pct) / 100) / 100;
}

function expressEnabled(env) {
  return String(env.EXPRESS_ENABLED).toLowerCase() === 'true';
}

// Price ids per currency. A Stripe price can carry every currency, so the same id may repeat under
// "eur", "usd" and "gbp"; a flat {standard, premium} object is accepted too and applies to all three.
function pricesFor(value, currency) {
  const obj = asObject(value);
  if (obj[currency]) return obj[currency];
  return obj.standard || obj.premium ? obj : {};
}

// Amounts shown on the page, in whole currency units: { eur: { standard, premium }, usd: {...}, gbp: {...} }.
function amountFor(value, tier, currency) {
  const n = Number(((asObject(value)[currency]) || {})[tier]);
  return n > 0 ? n : null;
}

// Amounts of one tier in every currency, { eur, usd, gbp }, or null when one of them is missing.
function amountsOfTier(value, tier) {
  const out = {};
  for (const currency of CURRENCIES) {
    const n = amountFor(value, tier, currency);
    if (!n) return null;
    out[currency] = n;
  }
  return out;
}

// Express for a tier, or null. Stripe picks the buyer's currency, so Express must be priced in all three:
// the same price id and an amount for each currency. Otherwise Express is off for that tier.
function expressFor(env, tier) {
  if (!expressEnabled(env)) return null;
  const amounts = amountsOfTier(env.EXPRESS_AMOUNTS, tier);
  if (!amounts) return null;
  const ids = CURRENCIES.map((currency) => pricesFor(env.EXPRESS_PRICES, currency)[tier]);
  if (!ids[0] || ids.some((id) => id !== ids[0])) return null;
  return { priceId: ids[0], amounts };
}

// What the order modal may show: the tier amounts and, where Express is ready, the Express amounts.
function publicConfig(env) {
  const amounts = {};
  const express = {};
  for (const tier of Object.keys(TIERS)) {
    const base = amountsOfTier(env.PRICE_AMOUNTS, tier);
    if (base) amounts[tier] = base;
    const e = expressFor(env, tier);
    if (e) express[tier] = e.amounts;
  }
  const pct = percentOff(env);
  if (!pct) return { enabled: expressEnabled(env), currencies: CURRENCIES, amounts, express };
  // With a global discount the amounts are the discounted ones; the list amounts stay available.
  const cut = (tree) => {
    const out = {};
    for (const tier of Object.keys(tree)) {
      out[tier] = {};
      for (const currency of CURRENCIES) out[tier][currency] = applyPercent(tree[tier][currency], pct);
    }
    return out;
  };
  return { enabled: expressEnabled(env), currencies: CURRENCIES, amounts: cut(amounts), express: cut(express), percentOff: pct, listAmounts: amounts, listExpress: express };
}

// ---- Promotion codes --------------------------------------------------------------------

// PROMOS: { CODE: { tier: "standard"|"premium", coupon: "<Stripe coupon id>", active: true, amounts: { eur, usd, gbp } } }.
// "indie" and "publisher" are accepted as names of the two tiers. Express is never part of a promotion.
const TIER_ALIASES = { indie: 'standard', publisher: 'premium' };

function normalizeCode(value) {
  const code = clip(value, 40).toUpperCase();
  return PROMO_RE.test(code) ? code : '';
}

// The promotion for a code and tier, or null: missing, unknown, switched off, wrong tier or incomplete amounts.
function findPromo(env, code, tier) {
  const key = normalizeCode(code);
  if (!key) return null;
  const entry = asObject(env.PROMOS)[key];
  if (!entry || typeof entry !== 'object' || entry.active === false || entry.active === 'false') return null;
  const promoTier = TIER_ALIASES[entry.tier] || entry.tier;
  if (!TIERS[promoTier] || promoTier !== tier || !entry.coupon) return null;
  const amounts = {};
  for (const currency of CURRENCIES) {
    const n = Number((entry.amounts || {})[currency]);
    if (!(n > 0)) return null;
    amounts[currency] = n;
  }
  return { code: key, tier: promoTier, coupon: String(entry.coupon), amounts };
}

// Same, when the caller does not know the tier yet (the /api/order/promo endpoint).
function findPromoAnyTier(env, code) {
  const key = normalizeCode(code);
  const entry = key ? asObject(env.PROMOS)[key] : null;
  if (!entry || typeof entry !== 'object') return null;
  return findPromo(env, key, TIER_ALIASES[entry.tier] || entry.tier);
}

function isIndieCode(key) {
  return key.length > INDIE_PREFIX.length && key.startsWith(INDIE_PREFIX);
}

// The coupon of a Stripe promotion code. Newer API versions put it under promotion.coupon, older ones under coupon.
// It is an id, or an object when it was expanded.
function couponOf(promotionCode) {
  const raw = (promotionCode.promotion && promotionCode.promotion.coupon) || promotionCode.coupon;
  if (raw && typeof raw === 'object') return { id: String(raw.id || ''), valid: raw.valid !== false };
  return { id: raw ? String(raw) : '', valid: true };
}

// An INDIE- code that Stripe confirms, or null. Null for: no INDIE- prefix, a tier other than Publisher, no coupon id in
// INDIE_PUBLISHER_COUPON_ID, an unknown or inactive code, another coupon, a used-up code, a code that is not limited to
// one use, or any Stripe error. The caller charges the full price and says nothing. No other code ever reaches Stripe.
async function findIndiePromo(env, code, tier) {
  const key = normalizeCode(code);
  const couponId = String(env.INDIE_PUBLISHER_COUPON_ID || '').trim();
  if (!isIndieCode(key) || tier !== INDIE_TIER) return null;
  if (!couponId || couponId.startsWith('REPLACE') || !env.STRIPE_SECRET_KEY) return null;
  try {
    const url = 'https://api.stripe.com/v1/promotion_codes?code=' + encodeURIComponent(key) + '&active=true&limit=1&expand[]=data.promotion.coupon';
    const response = await fetch(url, { method: 'GET', headers: { Authorization: 'Bearer ' + env.STRIPE_SECRET_KEY } });
    if (!response.ok) {
      console.log('indie code lookup failed: stripe_' + response.status);
      return null;
    }
    const list = await response.json();
    const found = list && Array.isArray(list.data) ? list.data[0] : null;
    if (!found || found.active === false || String(found.code || '').toUpperCase() !== key) return null;
    const coupon = couponOf(found);
    if (coupon.id !== couponId || !coupon.valid) return null;
    const max = Number(found.max_redemptions);
    const used = Number(found.times_redeemed || 0);
    if (!(max >= 1) || !(used < max)) return null;
    return { code: key, tier: INDIE_TIER, promotionCode: String(found.id), amounts: indieAmounts(env) };
  } catch (err) {
    console.log('indie code lookup failed: ' + (err && err.message));
    return null;
  }
}

// The promotion for a code and tier: an INDIE- code is checked in Stripe, any other code in PROMOS (no Stripe call).
async function resolvePromo(env, code, tier) {
  const key = normalizeCode(code);
  if (!key) return null;
  return isIndieCode(key) ? findIndiePromo(env, key, tier) : findPromo(env, key, tier);
}

// Same, when the tier is not known yet (the /api/order/promo endpoint).
async function resolvePromoAnyTier(env, code) {
  const key = normalizeCode(code);
  if (!key) return null;
  return isIndieCode(key) ? findIndiePromo(env, key, INDIE_TIER) : findPromoAnyTier(env, key);
}

// The promotion that discounted a paid session, to work out the expected total. An INDIE- code was checked in Stripe
// when the session was created, so the webhook makes no second lookup.
function paidPromo(env, code, tier) {
  const key = normalizeCode(code);
  if (!key) return null;
  if (isIndieCode(key)) return tier === INDIE_TIER ? { code: key, tier, amounts: indieAmounts(env) } : null;
  return findPromo(env, key, tier);
}

// Total the customer should pay in the currency Stripe used, in the smallest unit, or null when it is not configured.
// With a promotion the base is the discounted amount; Express is added at its list amount.
function expectedTotal(env, tier, express, currency, promo, pct = 0) {
  const base = promo ? Number(promo.amounts[currency]) : amountFor(env.PRICE_AMOUNTS, tier, currency);
  if (!base) return null;
  let cents = Math.round(base * 100);
  if (express) {
    const extra = amountFor(env.EXPRESS_AMOUNTS, tier, currency);
    if (!extra) return null;
    cents = Math.round((base + extra) * 100);
  }
  return pct ? Math.round(cents * (100 - pct) / 100) : cents;
}

// With a global discount: per currency, in cents, the list total (no code, no percentage), the final total and the
// difference, or null when a list amount is missing. The code price comes first, then the percentage; Express is included.
function priceBreakdown(env, tier, express, promo, pct) {
  const out = {};
  for (const currency of CURRENCIES) {
    const list = expectedTotal(env, tier, !!express, currency, null, 0);
    const final = expectedTotal(env, tier, !!express, currency, promo, pct);
    if (list == null || final == null) return null;
    out[currency] = { list, final, discount: list - final };
  }
  return out;
}

// ---- Rate limit (same shape as contact-form, own key prefix) ---------------------------

async function checkRateLimit(env, ip, prefix = 'order:rl:', limit = ORDERS_PER_WINDOW) {
  const key = prefix + ip;
  const current = parseInt((await env.CONTACT_SUBMISSIONS.get(key)) || '0', 10);
  if (current >= limit) return false;
  await env.CONTACT_SUBMISSIONS.put(key, String(current + 1), { expirationTtl: RATE_WINDOW_SECONDS });
  return true;
}

// ---- Stripe ------------------------------------------------------------------------------

// Stripe Checkout takes one discount per session, so a global percentage and a code price become one coupon made
// for this order: one amount per currency, one redemption, gone after 25 hours. Returns the coupon id.
async function createOrderCoupon(env, orderId, breakdown) {
  const params = new URLSearchParams();
  params.set('duration', 'once');
  params.set('max_redemptions', '1');
  params.set('redeem_by', String(Math.floor(Date.now() / 1000) + COUPON_LIFETIME_SECONDS));
  params.set('name', 'Order ' + orderId.slice(0, 8));
  params.set('currency', 'eur');
  params.set('amount_off', String(breakdown.eur.discount));
  params.set('currency_options[usd][amount_off]', String(breakdown.usd.discount));
  params.set('currency_options[gbp][amount_off]', String(breakdown.gbp.discount));
  const response = await fetch('https://api.stripe.com/v1/coupons', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + env.STRIPE_SECRET_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const text = await response.text();
  let coupon = null;
  try { coupon = JSON.parse(text); } catch (err) { /* not JSON */ }
  if (!response.ok || !coupon || !coupon.id) {
    const detail = coupon && coupon.error ? (coupon.error.code || coupon.error.type) + ': ' + coupon.error.message : text.slice(0, 200);
    throw new Error('stripe_coupon_' + response.status + ' ' + detail);
  }
  return String(coupon.id);
}

// Best effort: a failure only goes to the log.
async function stripeCleanup(env, method, path, body) {
  try {
    const response = await fetch('https://api.stripe.com/v1/' + path, {
      method,
      headers: { Authorization: 'Bearer ' + env.STRIPE_SECRET_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!response.ok) console.log('stripe cleanup failed: ' + method + ' ' + path + ' ' + response.status);
  } catch (err) {
    console.log('stripe cleanup failed: ' + method + ' ' + path + ' ' + (err && err.message));
  }
}

async function createCheckoutSession(env, order, lines, origin, promo, orderCoupon, pct) {
  const params = new URLSearchParams();
  params.set('mode', 'payment');
  lines.forEach((priceId, i) => {
    params.set('line_items[' + i + '][price]', priceId);
    params.set('line_items[' + i + '][quantity]', '1');
  });
  params.set('customer_email', order.email);
  params.set('client_reference_id', order.id);
  params.set('metadata[order_id]', order.id);
  params.set('metadata[game_url]', clip(order.steam, 500));
  params.set('metadata[tier]', order.tier);
  params.set('metadata[express]', order.express ? 'true' : 'false');
  if (orderCoupon) {
    // Global discount: one coupon made for this order covers the code price and the percentage. The webhook deletes it,
    // and switches an INDIE- code off, once the payment arrives.
    params.set('discounts[0][coupon]', orderCoupon);
    params.set('metadata[coupon_id]', orderCoupon);
    params.set('metadata[percent_off]', String(pct));
    if (promo) {
      params.set('metadata[promo]', promo.code);
      if (promo.promotionCode) params.set('metadata[promo_id]', promo.promotionCode);
    }
  } else if (promo) {
    // The coupon is limited to the tier's product in Stripe, so the Express line is never discounted.
    // An INDIE- code goes in as its promotion code (which Stripe counts as one redemption); a PROMOS code goes in as its coupon.
    if (promo.promotionCode) params.set('discounts[0][promotion_code]', promo.promotionCode);
    else params.set('discounts[0][coupon]', promo.coupon);
    params.set('metadata[promo]', promo.code);
  }
  params.set('payment_intent_data[metadata][order_id]', order.id);
  // The page reads plan and express to say how soon the analysis arrives. It uses "plan", not "tier", because ?tier= opens the order form.
  params.set('success_url', origin + '/steam-analysis/?paid=1&plan=' + order.tier + (order.express ? '&express=1' : ''));
  params.set('cancel_url', origin + '/steam-analysis/?tier=' + order.tier + (promo ? '&promo=' + encodeURIComponent(promo.code) : ''));

  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + env.STRIPE_SECRET_KEY,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  const text = await response.text();
  let session = null;
  try { session = JSON.parse(text); } catch (err) { /* not JSON */ }
  if (!response.ok || !session || !session.url) {
    const detail = session && session.error ? (session.error.code || session.error.type) + ': ' + session.error.message : text.slice(0, 200);
    throw new Error('stripe_' + response.status + ' ' + detail);
  }
  return session;
}

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Stripe-Signature: t=<unix>,v1=<hmac sha256 of "<t>.<raw body>">[,v1=...]
async function verifyStripeSignature(rawBody, header, secret, nowSeconds) {
  if (!header || !secret) return false;
  const parts = header.split(',').map((p) => p.trim().split('='));
  const t = (parts.find((p) => p[0] === 't') || [])[1];
  const signatures = parts.filter((p) => p[0] === 'v1').map((p) => p[1]);
  if (!t || !signatures.length) return false;
  if (Math.abs(nowSeconds - Number(t)) > WEBHOOK_TOLERANCE_SECONDS) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = toHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(t + '.' + rawBody)));
  return signatures.some((s) => safeEqual(s, expected));
}

// ---- Routes ------------------------------------------------------------------------------

async function handleOrder(request, env) {
  const origin = request.headers.get('Origin') || '';
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return json(403, { ok: false, error: 'origin_not_allowed' }, origin);
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json(400, { ok: false, error: 'invalid_json' }, origin);
  }

  const tier = clip(body.version, 20);
  if (!TIERS[tier]) return json(422, { ok: false, error: 'invalid_tier' }, origin);

  const steam = clip(body.steam, 500);
  if (!STEAM_RE.test(steam)) return json(422, { ok: false, error: 'invalid_steam_link' }, origin);
  const email = clip(body.email, MAX_FIELD_LENGTH);
  if (!EMAIL_RE.test(email)) return json(422, { ok: false, error: 'invalid_email' }, origin);
  if (body.waiver !== true) return json(422, { ok: false, error: 'waiver_required' }, origin);

  const quarter = clip(body.quarter, 20);
  if (quarter && !QUARTER_RE.test(quarter)) return json(422, { ok: false, error: 'invalid_quarter' }, origin);
  let wishlists = null;
  if (body.wishlists !== '' && body.wishlists != null) {
    wishlists = Number(body.wishlists);
    if (!Number.isInteger(wishlists) || wishlists < 0 || wishlists > 1e9) return json(422, { ok: false, error: 'invalid_wishlists' }, origin);
  }
  let price = null;
  if (body.price !== '' && body.price != null) {
    price = Number(body.price);
    if (!(price > 0 && price < 1000)) return json(422, { ok: false, error: 'invalid_price' }, origin);
  }

  // Express is for Indie and Publisher only, and only where it is switched on and priced in every currency.
  // A currency in the payload is ignored: Stripe chooses it at checkout.
  const express = body.express === true ? expressFor(env, tier) : null;
  if (body.express === true && !express) return json(422, { ok: false, error: 'express_unavailable' }, origin);

  const basePrice = asObject(env.PRICES)[tier];
  if (!basePrice || !env.STRIPE_SECRET_KEY) {
    console.log('order not configured: missing price id or STRIPE_SECRET_KEY');
    return json(500, { ok: false, error: 'not_configured' }, origin);
  }

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!(await checkRateLimit(env, ip))) return json(429, { ok: false, error: 'rate_limited' }, origin);

  // A promotion code that is unknown, switched off, used up or for another tier is ignored: the order goes through at list price.
  // Only an INDIE- code on a Publisher order is looked up in Stripe.
  const promo = await resolvePromo(env, body.promo, tier);

  // Global discount: work out the totals now. A missing amount, or a total under what Stripe charges, stops the order here.
  const pct = percentOff(env);
  let breakdown = null;
  if (pct > 0) {
    breakdown = priceBreakdown(env, tier, !!express, promo, pct);
    if (!breakdown) {
      console.log('order not configured: a list amount is missing for the global discount');
      return json(500, { ok: false, error: 'not_configured' }, origin);
    }
    for (const currency of CURRENCIES) {
      if (breakdown[currency].final < MIN_CHARGE_CENTS[currency] || breakdown[currency].discount <= 0) {
        console.log('order refused: the discounted total is under the Stripe minimum or has no discount in ' + currency);
        return json(422, { ok: false, error: 'amount_too_low' }, origin);
      }
    }
  }

  const id = crypto.randomUUID();
  const key = 'order:' + id;
  const order = {
    id,
    createdAt: new Date().toISOString(),
    status: 'pending',
    tier,
    express: !!express,
    steam,
    email,
    quarter,
    wishlists,
    price,
    notes: tier === 'standard' ? clip(body.notes, MAX_NOTES_LENGTH) : '',
    news: body.news === true,
    waiver: true,
    page: clip(body.page, 500),
    referrer: clip(body.referrer, 500),
    ip,
    country: (request.cf && request.cf.country) || '',
  };
  await env.CONTACT_SUBMISSIONS.put(key, JSON.stringify(order), { expirationTtl: ORDER_TTL_SECONDS });

  const lines = [basePrice];
  if (express) lines.push(express.priceId);
  const successOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  let orderCoupon = '';
  try {
    if (breakdown) orderCoupon = await createOrderCoupon(env, id, breakdown);
    const session = await createCheckoutSession(env, order, lines, successOrigin, promo, orderCoupon, pct);
    order.stripeSessionId = session.id;
    await env.CONTACT_SUBMISSIONS.put(key, JSON.stringify(order), { expirationTtl: ORDER_TTL_SECONDS });
    return json(200, { ok: true, url: session.url }, origin);
  } catch (err) {
    console.log('checkout session failed: ' + (err && err.message));
    if (orderCoupon) await stripeCleanup(env, 'DELETE', 'coupons/' + encodeURIComponent(orderCoupon));
    await env.CONTACT_SUBMISSIONS.delete(key);
    return json(502, { ok: false, error: 'checkout_failed' }, origin);
  }
}

// The numeric app id of a Steam link of the form /app/<id>/, or '' when the link has none.
function steamAppId(link) {
  let url;
  try { url = new URL(link); } catch (err) { return ''; }
  const match = /^\/app\/(\d{1,10})(?:\/|$)/.exec(url.pathname);
  return match ? match[1] : '';
}

// A one-way code of an email address (SHA-256 of the lowercased, trimmed address, in hex). Counter keys use it, never the address.
async function emailCode(email) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email.trim().toLowerCase()));
  return toHex(digest);
}

async function readCount(env, key) {
  return parseInt((await env.CONTACT_SUBMISSIONS.get(key)) || '0', 10) || 0;
}

// POST /api/order/free: Solo Dev. Order of checks: validation, per-IP limit, email limit, game limit, daily limit.
// The counters go up only after the order is stored.
async function handleFreeOrder(request, env) {
  const origin = request.headers.get('Origin') || '';
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return json(403, { ok: false, error: 'origin_not_allowed' }, origin);
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json(400, { ok: false, error: 'invalid_json' }, origin);
  }

  const steam = clip(body.steam, 500);
  const appId = STEAM_RE.test(steam) ? steamAppId(steam) : '';
  if (!appId) return json(422, { ok: false, error: 'invalid_steam_link' }, origin);
  const email = clip(body.email, MAX_FIELD_LENGTH);
  if (!EMAIL_RE.test(email)) return json(422, { ok: false, error: 'invalid_email' }, origin);

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!(await checkRateLimit(env, ip, 'order:rlf:', FREE_ORDERS_PER_WINDOW))) return json(429, { ok: false, error: 'rate_limited' }, origin);

  const emailKey = 'free:email:' + (await emailCode(email));
  const appKey = 'free:app:' + appId;
  const dayKey = 'free:day:' + new Date().toISOString().slice(0, 10);
  const [emailCount, appCount, dayCount] = await Promise.all([readCount(env, emailKey), readCount(env, appKey), readCount(env, dayKey)]);
  if (emailCount >= FREE_PER_EMAIL) return json(409, { ok: false, error: 'email_limit' }, origin);
  if (appCount >= FREE_PER_GAME) return json(409, { ok: false, error: 'game_limit' }, origin);
  if (dayCount >= FREE_PER_DAY) return json(429, { ok: false, error: 'daily_limit' }, origin);

  const id = crypto.randomUUID();
  const order = {
    id,
    createdAt: new Date().toISOString(),
    status: 'free_new',
    tier: 'free',
    steam,
    appId,
    email,
    page: clip(body.page, 500),
    referrer: clip(body.referrer, 500),
    ip,
    country: (request.cf && request.cf.country) || '',
  };
  await env.CONTACT_SUBMISSIONS.put('order:' + id, JSON.stringify(order), { expirationTtl: ORDER_TTL_SECONDS });
  await env.CONTACT_SUBMISSIONS.put(emailKey, String(emailCount + 1), { expirationTtl: FREE_COUNTER_TTL_SECONDS });
  await env.CONTACT_SUBMISSIONS.put(appKey, String(appCount + 1), { expirationTtl: FREE_COUNTER_TTL_SECONDS });
  await env.CONTACT_SUBMISSIONS.put(dayKey, String(dayCount + 1), { expirationTtl: FREE_DAY_TTL_SECONDS });
  return json(200, { ok: true }, origin);
}

// GET /api/order/promo?code=XYZ: lets the order page show the discount. Missing, wrong or disabled answers valid false.
async function handlePromo(request, env) {
  const origin = request.headers.get('Origin') || '';
  if (origin && !ALLOWED_ORIGINS.includes(origin)) return json(403, { ok: false, error: 'origin_not_allowed' }, origin);
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!(await checkRateLimit(env, ip, 'order:rlp:', PROMO_CHECKS_PER_WINDOW))) return json(429, { ok: false, error: 'rate_limited' }, origin);
  const promo = await resolvePromoAnyTier(env, new URL(request.url).searchParams.get('code'));
  if (!promo) return json(200, { valid: false }, origin);
  const pct = percentOff(env);
  if (!pct) return json(200, { valid: true, tier: promo.tier, amounts: promo.amounts }, origin);
  const cut = {};
  for (const currency of CURRENCIES) cut[currency] = applyPercent(promo.amounts[currency], pct);
  return json(200, { valid: true, tier: promo.tier, amounts: cut, listAmounts: promo.amounts, percentOff: pct }, origin);
}

async function handleWebhook(request, env) {
  const raw = await request.text();
  const valid = await verifyStripeSignature(raw, request.headers.get('Stripe-Signature'), env.STRIPE_WEBHOOK_SECRET, Math.floor(Date.now() / 1000));
  if (!valid) return json(400, { ok: false, error: 'bad_signature' }, '');

  let event;
  try {
    event = JSON.parse(raw);
  } catch (err) {
    return json(400, { ok: false, error: 'invalid_json' }, '');
  }

  const session = event && event.data && event.data.object;
  if (!event || event.type !== 'checkout.session.completed' || !session || session.payment_status !== 'paid') {
    return json(200, { ok: true, ignored: true }, '');
  }

  // Idempotent on the Checkout session id: Stripe may deliver the same event more than once.
  const paidKey = 'order:paid:' + session.id;
  if (await env.CONTACT_SUBMISSIONS.get(paidKey)) return json(200, { ok: true, duplicate: true }, '');

  const meta = session.metadata || {};
  const orderId = meta.order_id || session.client_reference_id;
  if (!orderId) {
    console.log('paid session without order id: ' + session.id);
    return json(200, { ok: true, ignored: true }, '');
  }
  const key = 'order:' + orderId;
  let order = null;
  try { order = JSON.parse((await env.CONTACT_SUBMISSIONS.get(key)) || 'null'); } catch (err) { /* damaged record */ }
  if (!order) {
    // The record is gone or was never saved: rebuild what we can from the session.
    order = {
      id: orderId,
      tier: meta.tier || '',
      express: meta.express === 'true',
      steam: meta.game_url || '',
      email: (session.customer_details && session.customer_details.email) || session.customer_email || '',
      rebuilt: true,
    };
  }

  const tier = TIERS[order.tier];
  const paidAt = new Date((event.created || Math.floor(Date.now() / 1000)) * 1000);
  const days = tier ? (order.express ? tier.expressDays : tier.days) : null;
  const due = days == null ? null : dueDate(paidAt, days);

  order.status = 'paid';
  order.paidAt = paidAt.toISOString();
  order.stripeSessionId = session.id;
  order.amountTotal = session.amount_total;
  order.paidCurrency = session.currency;
  // A promotion is recorded only when Stripe took money off (total_details.amount_discount above 0). The code comes from the
  // session metadata; an order saved by an earlier version of the Worker carries it in the record instead.
  const promoCode = String(meta.promo || order.promo || '');
  const pct = Number.isInteger(Number(meta.percent_off)) && Number(meta.percent_off) > 0 && Number(meta.percent_off) <= 100 ? Number(meta.percent_off) : 0;
  delete order.percentOff;
  if (pct) order.percentOff = pct;
  const discount = Number(session.total_details && session.total_details.amount_discount);
  const discounted = !!promoCode && discount > 0;
  delete order.promo;
  delete order.discountApplied;
  if (discounted) {
    order.promo = promoCode;
    order.discountApplied = true;
  } else if (promoCode) {
    console.log('a promotion code was sent but the session has no discount: ' + session.id);
  }
  // Stripe chose the currency, so the expected total is worked out now, from the currency it used.
  // With a discount the base is the discounted amount (it counts only while the code still maps to this tier); without one it is the list amount.
  const promo = discounted ? paidPromo(env, promoCode, order.tier) : null;
  order.expectedTotal = expectedTotal(env, order.tier, !!order.express, session.currency, promo, pct);
  order.amountMatches = typeof order.expectedTotal === 'number' ? session.amount_total === order.expectedTotal : null;
  if (order.amountMatches === false) console.log('paid amount differs from the expected total: ' + session.id);
  order.listTotal = expectedTotal(env, order.tier, !!order.express, session.currency, null);
  order.businessDays = days;
  order.due_date = due ? due.due : null;
  order.due_start_date = due ? due.start : null;
  order.due_date_approx = due ? due.approx : null;

  await env.CONTACT_SUBMISSIONS.put(key, JSON.stringify(order), { expirationTtl: ORDER_TTL_SECONDS });
  await env.CONTACT_SUBMISSIONS.put(paidKey, paidAt.toISOString(), { expirationTtl: ORDER_TTL_SECONDS });

  // Global discount cleanup, after the record is safe. An INDIE- code is not redeemed by Stripe in this mode (the order
  // coupon carried the discount), so it is switched off here. The order coupon is deleted; the discount already applied stays.
  if (meta.promo_id && promoCode.startsWith(INDIE_PREFIX)) {
    await stripeCleanup(env, 'POST', 'promotion_codes/' + encodeURIComponent(meta.promo_id), 'active=false');
  }
  if (meta.coupon_id) await stripeCleanup(env, 'DELETE', 'coupons/' + encodeURIComponent(meta.coupon_id));
  return json(200, { ok: true }, '');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '');
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (path === '/api/order/webhook') {
      if (request.method !== 'POST') return json(405, { ok: false, error: 'method_not_allowed' }, origin);
      return handleWebhook(request, env);
    }
    if (path === '/api/order/config') {
      if (request.method !== 'GET') return json(405, { ok: false, error: 'method_not_allowed' }, origin);
      if (origin && !ALLOWED_ORIGINS.includes(origin)) return json(403, { ok: false, error: 'origin_not_allowed' }, origin);
      return json(200, publicConfig(env), origin);
    }
    if (path === '/api/order/promo') {
      if (request.method !== 'GET') return json(405, { ok: false, error: 'method_not_allowed' }, origin);
      return handlePromo(request, env);
    }
    if (path === '/api/order/free') {
      if (request.method !== 'POST') return json(405, { ok: false, error: 'method_not_allowed' }, origin);
      return handleFreeOrder(request, env);
    }
    if (path === '/api/order') {
      if (request.method !== 'POST') return json(405, { ok: false, error: 'method_not_allowed' }, origin);
      return handleOrder(request, env);
    }
    return json(404, { ok: false, error: 'not_found' }, origin);
  },
};

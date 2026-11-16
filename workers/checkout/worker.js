/**
 * Spritz Consulting order Worker (Steam Analysis, Indie and Publisher tiers).
 *
 *   GET  /api/order/config   what the order modal may offer (Express on or off, Express amounts)
 *   POST /api/order          validate the order, store it, create a Stripe Checkout session
 *   POST /api/order/webhook  Stripe tells us the session was paid: mark it paid, compute due_date
 *
 * - One Checkout session with two line items: the tier price and, when asked for, the Express
 *   price (quantity 1 each). Express never replaces the base price.
 * - The page is the source of the currency. The Worker only checks it against an allowed list.
 *   If Express is requested in a currency that has no Express price, the whole session falls
 *   back to EUR.
 * - Orders live in the CONTACT_SUBMISSIONS KV namespace under the "order:" prefix and are
 *   deleted after 30 days, as the order form promises.
 * - Solo Dev (free) does not go through this Worker.
 * - No tax settings are sent to Stripe: tax behaviour stays as configured on the prices.
 * - No notification email yet; read orders from KV (see README).
 */

import { dueDate } from './business-days.js';

const ALLOWED_ORIGINS = [
  'https://spritzconsulting.com',
  'https://www.spritzconsulting.com',
];

const CURRENCIES = ['eur', 'usd', 'gbp'];
const DEFAULT_CURRENCY = 'eur';

// Business days of work per tier, normal and with Express.
const TIERS = {
  standard: { days: 2, expressDays: 1 },
  premium: { days: 3, expressDays: 2 },
};

const ORDER_TTL_SECONDS = 30 * 24 * 60 * 60;
const RATE_WINDOW_SECONDS = 600;
const ORDERS_PER_WINDOW = 5;
const WEBHOOK_TOLERANCE_SECONDS = 300;
const MAX_FIELD_LENGTH = 200;
const MAX_NOTES_LENGTH = 1000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STEAM_RE = /^https?:\/\/(store\.steampowered\.com|steamcommunity\.com)\//i;
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

function expressEnabled(env) {
  return String(env.EXPRESS_ENABLED).toLowerCase() === 'true';
}

// Express for a tier in a currency, or null when it is off or has no price or no amount there.
function expressFor(env, tier, currency) {
  if (!expressEnabled(env)) return null;
  const prices = asObject(env.EXPRESS_PRICES)[currency] || {};
  const amounts = asObject(env.EXPRESS_AMOUNTS)[currency] || {};
  const priceId = prices[tier];
  const amount = Number(amounts[tier]);
  if (!priceId || !(amount > 0)) return null;
  return { priceId, amount };
}

function publicConfig(env) {
  const express = {};
  for (const currency of CURRENCIES) {
    for (const tier of Object.keys(TIERS)) {
      const e = expressFor(env, tier, currency);
      if (e) {
        express[currency] = express[currency] || {};
        express[currency][tier] = e.amount;
      }
    }
  }
  return { enabled: expressEnabled(env), express };
}

// ---- Rate limit (same shape as contact-form, own key prefix) ---------------------------

async function checkRateLimit(env, ip) {
  const key = 'order:rl:' + ip;
  const current = parseInt((await env.CONTACT_SUBMISSIONS.get(key)) || '0', 10);
  if (current >= ORDERS_PER_WINDOW) return false;
  await env.CONTACT_SUBMISSIONS.put(key, String(current + 1), { expirationTtl: RATE_WINDOW_SECONDS });
  return true;
}

// ---- Stripe ------------------------------------------------------------------------------

async function createCheckoutSession(env, order, lines, currency, origin) {
  const params = new URLSearchParams();
  params.set('mode', 'payment');
  lines.forEach((priceId, i) => {
    params.set('line_items[' + i + '][price]', priceId);
    params.set('line_items[' + i + '][quantity]', '1');
  });
  params.set('currency', currency);
  params.set('customer_email', order.email);
  params.set('client_reference_id', order.id);
  params.set('metadata[order_id]', order.id);
  params.set('metadata[game_url]', clip(order.steam, 500));
  params.set('metadata[tier]', order.tier);
  params.set('metadata[express]', order.express ? 'true' : 'false');
  params.set('metadata[currency]', currency);
  params.set('payment_intent_data[metadata][order_id]', order.id);
  // The page reads plan and express to say how soon the analysis arrives. It uses "plan", not "tier", because ?tier= opens the order form.
  params.set('success_url', origin + '/steam-analysis/?paid=1&plan=' + order.tier + (order.express ? '&express=1' : ''));
  params.set('cancel_url', origin + '/steam-analysis/?tier=' + order.tier);

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

  // The page names the currency; we only accept values from the allowed list.
  let currency = body.currency == null || body.currency === '' ? DEFAULT_CURRENCY : clip(body.currency, 3).toLowerCase();
  if (!CURRENCIES.includes(currency)) return json(422, { ok: false, error: 'invalid_currency' }, origin);

  // Express is for Indie and Publisher only, and only when it is switched on and priced.
  const wantsExpress = body.express === true;
  let express = null;
  if (wantsExpress) {
    express = expressFor(env, tier, currency);
    if (!express) {
      currency = DEFAULT_CURRENCY;                       // no Express price in that currency: fall back to EUR
      express = expressFor(env, tier, currency);
    }
    if (!express) return json(422, { ok: false, error: 'express_unavailable' }, origin);
  }

  const basePrice = asObject(env.PRICES)[tier];
  if (!basePrice || !env.STRIPE_SECRET_KEY) {
    console.log('order not configured: missing price id or STRIPE_SECRET_KEY');
    return json(500, { ok: false, error: 'not_configured' }, origin);
  }

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!(await checkRateLimit(env, ip))) return json(429, { ok: false, error: 'rate_limited' }, origin);

  const id = crypto.randomUUID();
  const key = 'order:' + id;
  const order = {
    id,
    createdAt: new Date().toISOString(),
    status: 'pending',
    tier,
    express: !!express,
    currency,
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
  try {
    const session = await createCheckoutSession(env, order, lines, currency, successOrigin);
    order.stripeSessionId = session.id;
    await env.CONTACT_SUBMISSIONS.put(key, JSON.stringify(order), { expirationTtl: ORDER_TTL_SECONDS });
    return json(200, { ok: true, url: session.url }, origin);
  } catch (err) {
    console.log('checkout session failed: ' + (err && err.message));
    await env.CONTACT_SUBMISSIONS.delete(key);
    return json(502, { ok: false, error: 'checkout_failed' }, origin);
  }
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
      currency: meta.currency || session.currency || '',
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
  order.businessDays = days;
  order.due_date = due ? due.due : null;
  order.due_start_date = due ? due.start : null;
  order.due_date_approx = due ? due.approx : null;

  await env.CONTACT_SUBMISSIONS.put(key, JSON.stringify(order), { expirationTtl: ORDER_TTL_SECONDS });
  await env.CONTACT_SUBMISSIONS.put(paidKey, paidAt.toISOString(), { expirationTtl: ORDER_TTL_SECONDS });
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
    if (path === '/api/order') {
      if (request.method !== 'POST') return json(405, { ok: false, error: 'method_not_allowed' }, origin);
      return handleOrder(request, env);
    }
    return json(404, { ok: false, error: 'not_found' }, origin);
  },
};

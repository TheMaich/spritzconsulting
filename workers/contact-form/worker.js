/**
 * Spritz Consulting contact form backend.
 *
 * POST /api/contact
 * Body: JSON { name?, company?, email, message, page?, referrer?, website? }
 *
 * - Validates email and message server side.
 * - Persists every valid submission to the CONTACT_SUBMISSIONS KV namespace.
 * - Honeypot: the hidden "website" field must stay empty. Bots that fill it
 *   get a fake 200 so they stop retrying, and nothing is stored.
 * - Rate limit: max SUBMISSIONS_PER_WINDOW per IP per RATE_WINDOW_SECONDS,
 *   tracked in the same KV namespace under rl: keys with a TTL.
 * - Notification email: sent through Cloudflare Email Routing when the
 *   NOTIFY send_email binding is configured (free tier, first party,
 *   requires Email Routing enabled on the zone; see README). If the binding
 *   is absent or sending fails, the submission still lands in KV.
 * - CORS: only the production origins may POST.
 */

const ALLOWED_ORIGINS = [
  'https://spritzconsulting.com',
  'https://www.spritzconsulting.com',
];

const NOTIFY_TO = 'michele@spritzconsulting.com';
const NOTIFY_FROM = 'contact-form@spritzconsulting.com';

const RATE_WINDOW_SECONDS = 600;
const SUBMISSIONS_PER_WINDOW = 5;
const MAX_FIELD_LENGTH = 200;
const MAX_MESSAGE_LENGTH = 5000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
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
      ...corsHeaders(origin),
    },
  });
}

function clip(value, max) {
  return String(value == null ? '' : value).slice(0, max).trim();
}

async function checkRateLimit(env, ip) {
  const key = 'rl:' + ip;
  const current = parseInt((await env.CONTACT_SUBMISSIONS.get(key)) || '0', 10);
  if (current >= SUBMISSIONS_PER_WINDOW) return false;
  // Two coarse KV ops per request keep this cheap; the TTL resets the window.
  await env.CONTACT_SUBMISSIONS.put(key, String(current + 1), {
    expirationTtl: RATE_WINDOW_SECONDS,
  });
  return true;
}

function buildNotificationMime(submission) {
  const lines = [
    'Name: ' + (submission.name || '(empty)'),
    'Company: ' + (submission.company || '(empty)'),
    'Email: ' + submission.email,
    'Page: ' + (submission.page || '(unknown)'),
    'Referrer: ' + (submission.referrer || '(none)'),
    'Received: ' + submission.receivedAt,
    '',
    submission.message,
  ];
  const headers = [
    'From: Spritz Contact Form <' + NOTIFY_FROM + '>',
    'To: ' + NOTIFY_TO,
    'Reply-To: ' + submission.email,
    'Subject: New contact form submission',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Message-ID: <' + submission.key + '@spritzconsulting.com>',
    'Date: ' + new Date(submission.receivedAt).toUTCString(),
  ];
  return headers.join('\r\n') + '\r\n\r\n' + lines.join('\n');
}

async function sendNotification(env, submission) {
  if (!env.NOTIFY) return;
  try {
    const { EmailMessage } = await import('cloudflare:email');
    const raw = buildNotificationMime(submission);
    const message = new EmailMessage(NOTIFY_FROM, NOTIFY_TO, raw);
    await env.NOTIFY.send(message);
  } catch (err) {
    // KV already holds the submission; a failed notification is acceptable.
    console.log('notification email failed: ' + (err && err.message));
  }
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (request.method !== 'POST') {
      return json(405, { ok: false, error: 'method_not_allowed' }, origin);
    }
    if (origin && !ALLOWED_ORIGINS.includes(origin)) {
      return json(403, { ok: false, error: 'origin_not_allowed' }, origin);
    }

    let body;
    try {
      body = await request.json();
    } catch (err) {
      return json(400, { ok: false, error: 'invalid_json' }, origin);
    }

    // Honeypot: silently accept and drop.
    if (clip(body.website, 50)) {
      return json(200, { ok: true }, origin);
    }

    const email = clip(body.email, MAX_FIELD_LENGTH);
    const message = clip(body.message, MAX_MESSAGE_LENGTH);
    if (!EMAIL_RE.test(email)) {
      return json(422, { ok: false, error: 'invalid_email' }, origin);
    }
    if (!message) {
      return json(422, { ok: false, error: 'empty_message' }, origin);
    }

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (!(await checkRateLimit(env, ip))) {
      return json(429, { ok: false, error: 'rate_limited' }, origin);
    }

    const receivedAt = new Date().toISOString();
    const key = 'submission:' + receivedAt + ':' + crypto.randomUUID();
    const submission = {
      key,
      receivedAt,
      name: clip(body.name, MAX_FIELD_LENGTH),
      company: clip(body.company, MAX_FIELD_LENGTH),
      email,
      message,
      page: clip(body.page, 500),
      referrer: clip(body.referrer, 500),
      ip,
      country: (request.cf && request.cf.country) || '',
    };

    await env.CONTACT_SUBMISSIONS.put(key, JSON.stringify(submission));
    ctx.waitUntil(sendNotification(env, submission));

    return json(200, { ok: true }, origin);
  },
};

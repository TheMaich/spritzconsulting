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
 * - Notification email: sent through a Google Apps Script web app (notify.gs)
 *   that mails the owner from their Google account. The submission is saved to
 *   KV first and the visitor always gets a success once it is saved; a failed
 *   notification is logged and marked notified:false on the stored record.
 * - CORS: only the production origins may POST.
 */

const ALLOWED_ORIGINS = [
  'https://spritzconsulting.com',
  'https://www.spritzconsulting.com',
];


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

function buildNotificationText(submission) {
  return [
    'Name: ' + (submission.name || '(empty)'),
    'Company: ' + (submission.company || '(empty)'),
    'Email: ' + submission.email,
    'Page: ' + (submission.page || '(unknown)'),
    'Referrer: ' + (submission.referrer || '(none)'),
    'Received: ' + submission.receivedAt,
    '',
    submission.message,
  ].join('\n');
}

// Throws on any delivery failure so the caller can log it. KV already holds
// the submission before this runs, so a failure never loses the lead.
//
// Delivery goes through a Google Apps Script web app (workers/contact-form/
// notify.gs) that sends the mail from the owner's Google account. The Worker
// calls it with NOTIFY_WEBHOOK_URL and proves itself with NOTIFY_SECRET. The
// script sets reply-to to the visitor's address.
async function sendNotification(env, submission) {
  if (!env.NOTIFY_WEBHOOK_URL || !env.NOTIFY_SECRET) {
    throw new Error('notify_config_missing');
  }
  const response = await fetch(env.NOTIFY_WEBHOOK_URL, {
    method: 'POST',
    redirect: 'follow', // Apps Script answers POSTs through a 302
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      secret: env.NOTIFY_SECRET,
      email: submission.email,
      subject: 'New contact form submission',
      text: buildNotificationText(submission),
    }),
  });
  const detail = await response.text();
  let result = null;
  try { result = JSON.parse(detail); } catch (err) { /* not JSON */ }
  if (!response.ok || !result || result.ok !== true) {
    throw new Error('notify_failed_' + response.status + ': ' + detail.slice(0, 200));
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

    // KV first: the lead is durably captured regardless of email outcome.
    await env.CONTACT_SUBMISSIONS.put(key, JSON.stringify(submission));

    // The lead is already safe in KV, so the visitor always gets a success.
    // If the notification fails, record that on the stored submission and log
    // it; unsent leads are the ones with "notified": false.
    try {
      await sendNotification(env, submission);
      submission.notified = true;
    } catch (err) {
      console.log('notification email failed: ' + (err && err.message));
      submission.notified = false;
      submission.notifyError = String(err && err.message).slice(0, 200);
    }
    await env.CONTACT_SUBMISSIONS.put(key, JSON.stringify(submission));

    return json(200, { ok: true }, origin);
  },
};

/**
 * Google Apps Script web app: emails a contact-form submission to the inbox.
 *
 * The Cloudflare Worker (worker.js) POSTs JSON here after it has saved the
 * submission to KV. This script runs as the Google account that owns it and
 * sends the mail with MailApp, so no third-party email service is needed.
 *
 * Setup: script.google.com > New project > paste this file > replace
 * SHARED_SECRET with the value that goes into the Worker secret NOTIFY_SECRET
 * > Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone).
 * Quota: MailApp allows about 100 recipients per day on a free Google account.
 */
var SHARED_SECRET = 'REPLACE_WITH_SHARED_SECRET';
var NOTIFY_TO = 'hello@spritzconsulting.com';

function reply_(body) {
  return ContentService.createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return reply_({ ok: false, error: 'invalid_json' });
  }
  if (!SHARED_SECRET || data.secret !== SHARED_SECRET) {
    return reply_({ ok: false, error: 'unauthorized' });
  }
  var email = String(data.email || '');
  var options = {
    to: NOTIFY_TO,
    subject: String(data.subject || 'New contact form submission'),
    body: String(data.text || ''),
    name: 'Spritz Contact Form'
  };
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    options.replyTo = email;
  }
  MailApp.sendEmail(options);
  return reply_({ ok: true });
}

// GET returns a harmless status so the deployment URL can be checked in a browser.
function doGet() {
  return reply_({ ok: true, service: 'spritz-contact-notify' });
}

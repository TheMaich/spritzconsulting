# Spritz contact form Worker

Backend for the contact form on spritzconsulting.com. Accepts a JSON POST,
validates it, stores it in Workers KV, and emails a notification through the
Google Apps Script web app.

## Endpoint

`POST /api/contact` with JSON body:

```json
{
  "name": "optional",
  "company": "optional",
  "email": "required, validated",
  "message": "required, non empty",
  "page": "optional, path the form was on",
  "referrer": "optional, document.referrer",
  "website": "honeypot, must stay empty"
}
```

Responses: `200 {ok:true}` on success, `422` on invalid email or empty
message, `429` when rate limited (5 submissions per IP per 10 minutes),
`403` for foreign origins.

## Deploy steps

All commands run from this folder (`workers/contact-form/`).

1. Log in once:

   ```
   npx wrangler login
   ```

2. Create the KV namespace and copy its id:

   ```
   npx wrangler kv namespace create CONTACT_SUBMISSIONS
   ```

   Paste the returned id into `wrangler.toml` replacing
   `REPLACE_WITH_NAMESPACE_ID`.

3. Deploy:

   ```
   npx wrangler deploy
   ```

   The routes in `wrangler.toml` bind the Worker to
   `spritzconsulting.com/api/contact` and the `www` variant. Both patterns
   deploy automatically as long as the zone lives in the same Cloudflare
   account. To verify: Cloudflare dashboard, Workers & Pages, the
   `spritz-contact-form` Worker, Settings, Domains & Routes.

4. Test:

   ```
   curl -X POST https://spritzconsulting.com/api/contact \
     -H "Content-Type: application/json" \
     -H "Origin: https://spritzconsulting.com" \
     -d "{\"email\":\"test@example.com\",\"message\":\"hello\",\"page\":\"/\"}"
   ```

   Expect `{"ok":true}`.

## Reading submissions

```
npx wrangler kv key list --binding CONTACT_SUBMISSIONS --remote
npx wrangler kv key get "<key>" --binding CONTACT_SUBMISSIONS --remote
```

Keys look like `submission:2026-07-18T10:00:00.000Z:<uuid>` and sort by
timestamp. `rl:` keys are rate-limit counters and expire on their own.

## Email notification (Google Apps Script)

The Worker saves every submission to KV, then calls a Google Apps Script web
app (`notify.gs`) that emails the owner from their Google account. No third
party email service and no DNS changes are needed, and Gmail keeps receiving
normal mail.

The visitor always sees success once the submission is in KV. If the email
step fails, the stored record gets `"notified": false` and a `notifyError`, and
the failure is logged. Check KV for records with `notified` false after any
outage.

One-time setup:

1. script.google.com > New project > paste `notify.gs`, set `SHARED_SECRET`.
2. Deploy > New deployment > Web app, Execute as: Me, Who has access: Anyone.
   Authorise the mail permission when asked. Copy the `/exec` URL.
3. Set the two Worker secrets (never commit them):

   ```
   npx wrangler secret put NOTIFY_WEBHOOK_URL
   npx wrangler secret put NOTIFY_SECRET
   ```

4. `npx wrangler deploy`, then submit the form once and confirm the email lands.

Limit: a free Google account sends about 100 recipients per day via MailApp.

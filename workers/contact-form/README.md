# Spritz contact form Worker

Backend for the contact form on spritzconsulting.com. Accepts a JSON POST,
validates it, stores it in Workers KV, and optionally emails a notification
through Cloudflare Email Routing.

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

## Email notification (required, free, first party)

The Worker sends a notification to hello@spritzconsulting.com through
Cloudflare Email Routing, and a zone routing rule forwards hello@ to the
personal inbox (michele@spritzconsulting.com). No third-party service and no
signup. Notification is REQUIRED: if the send fails, or the `NOTIFY` binding is
missing, the Worker returns `502 {"ok":false,"error":"notification_failed"}`
instead of a silent 200. The submission is still written to KV first, so no lead
is lost even on a 502; it stays recoverable with the read commands above.

One-time setup on the zone (needed before `wrangler deploy` succeeds and mail
arrives):

1. Cloudflare dashboard, the spritzconsulting.com zone, Email, Email
   Routing: enable it and follow the DNS prompts (MX + SPF records).
2. Set `hello@spritzconsulting.com` as the send_email destination and verify it
   (Cloudflare sends a confirmation email that must be clicked), then add a
   routing rule forwarding `hello@` -> `michele@spritzconsulting.com` so the
   notification reaches the personal inbox.
3. The `[[send_email]]` block in `wrangler.toml` is already active.
4. `npx wrangler deploy`.

Note: before deploying, replace `REPLACE_WITH_NAMESPACE_ID` in `wrangler.toml`
with the live `CONTACT_SUBMISSIONS` namespace id (run
`npx wrangler kv namespace list`), or the deploy binds an empty KV namespace.

# Spritz checkout Worker

Order backend for the Steam Analysis page, Indie and Publisher tiers. Solo Dev (free) does not use it.

| Route | What it does |
| --- | --- |
| `GET /api/order/config` | Tells the order modal whether Express is on and what it costs per currency. |
| `POST /api/order` | Validates the order, stores it in KV, creates a Stripe Checkout session, returns `{ url }`. |
| `POST /api/order/webhook` | Stripe calls it when the session is paid. Marks the order paid and stores `due_date`. |

The Worker is named `checkout`. `contact-form` is untouched and keeps `/api/contact`.

## Routes to add on the zone (already in `wrangler.toml`)

- `spritzconsulting.com/api/order*`
- `www.spritzconsulting.com/api/order*`

Zone: `spritzconsulting.com`. The cache rules already skip anything under `/api/`
(see `cloudflare-html-cache.md`), so nothing else changes there.

## Deploy

From this folder:

1. `npx wrangler secret put STRIPE_SECRET_KEY`. A restricted key with only **Checkout Sessions: Write**.
2. `npx wrangler secret put STRIPE_WEBHOOK_SECRET`. The signing secret (`whsec_...`) of the endpoint in step 4.
3. `npx wrangler deploy`
4. In Stripe, add a webhook endpoint `https://spritzconsulting.com/api/order/webhook` listening to
   `checkout.session.completed`. Test mode and live mode each have their own endpoint and secret.

## Configuration (`wrangler.toml`, `[vars]`)

- `PRICES`: the Stripe price ids of the two tiers. They are the **sandbox** ids today. Swap for the live ids.
- `EXPRESS_PRICES`: the Express add-on price ids per currency. Only EUR is planned; `usd` and `gbp` are empty.
  A currency with no Express price never shows Express, and an Express order in it falls back to EUR.
- `EXPRESS_AMOUNTS`: the Express amounts the page shows, in whole units. Keep them equal to the Stripe prices.
- `EXPRESS_ENABLED`: `"false"` by default. With it off the page hides the Express row and the Worker refuses Express.

To open Express: create the two Express products in Stripe, paste their price ids into `EXPRESS_PRICES.eur`,
set `EXPRESS_ENABLED = "true"`, deploy.

## What the Worker stores

Keys in the `CONTACT_SUBMISSIONS` namespace, all with a 30 day expiry (the order form promises deletion after 30 days):

- `order:<uuid>`: the order (tier, express, currency, Steam link, email, optional fields, status, and after payment
  `paidAt`, `due_date`, `due_start_date`, `due_date_approx`, `amountTotal`).
- `order:paid:<checkout session id>`: marks a session as processed, so a repeated Stripe delivery changes nothing.
- `order:rl:<ip>`: rate limit, 5 orders per IP per 10 minutes.

```
npx wrangler kv key list --binding CONTACT_SUBMISSIONS --prefix order: --remote
npx wrangler kv key get "order:<uuid>" --binding CONTACT_SUBMISSIONS --remote
```

There is **no notification email yet**. Check KV for `status: "paid"` records until the mail service exists.

## Delivery date

`business-days.js` holds `addBusinessDays` and `dueDate`. Business days are Monday to Friday except the Italian public
holidays, hard-coded for 2026 and 2027. A payment up to 12:00 Europe/Rome on a business day counts from that day (day 0);
after 12:00, or on a weekend or holiday, from the next business day. Indie is 2 business days (1 with Express),
Publisher 3 (2 with Express). The list ends with 2027: after that the helper skips weekends only and sets
`due_date_approx: true`. Add the 2028 holidays before the end of 2027.

## Single file for the Cloudflare dashboard

`node build-single.mjs` writes `worker.single.js`: `worker.js` and `business-days.js` in one file, with no imports.
Paste it into the dashboard editor. The dashboard does not read `wrangler.toml`, so there you also set by hand:
the KV binding `CONTACT_SUBMISSIONS`, the variables `EXPRESS_ENABLED`, `PRICES`, `EXPRESS_PRICES` and `EXPRESS_AMOUNTS`
(the last three as JSON), the two secrets, and the two routes. Edit `worker.js` or `business-days.js`, never the single file.

## Tests

`node test.mjs` rebuilds the single file, then runs the business-day cases and the Worker, source and single file, with a mocked Stripe and KV. No dependencies.

## Tax

The Worker sends no tax settings to Stripe. Tax behaviour is whatever each Stripe price carries.

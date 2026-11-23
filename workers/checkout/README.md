# Spritz checkout Worker

Order backend for the Steam Analysis page. Indie and Publisher use `POST /api/order`. Solo Dev (free) uses `POST /api/order/free`.

| Route | What it does |
| --- | --- |
| `GET /api/order/config` | Tells the order modal the tier amounts and, where Express is on and priced in every currency, the Express amounts. Both are per tier and per currency, for display only. |
| `POST /api/order` | Validates the order, stores it in KV, creates a Stripe Checkout session, returns `{ url }`. |
| `POST /api/order/webhook` | Stripe calls it when the session is paid. Marks the order paid and stores `due_date`. |
| `POST /api/order/free` | Solo Dev. Validates the Steam link (it needs `/app/<id>/`) and the email, applies the free limits, stores the order, returns `{ ok: true }`. No Stripe, no waiver, no price. See "Solo Dev (free) orders". |
| `GET /api/order/promo?code=` | Says whether a promotion code is valid: `{ valid, tier, amounts }`. A missing, wrong, used or switched-off code answers `{ valid: false }` with status 200. An `INDIE-` code is checked in Stripe (see "Indie to Publisher codes"); any other code is checked against `PROMOS` and never reaches Stripe. Rate limited per IP (20 per 10 minutes, own counter, also for `INDIE-` codes, because each check is a Stripe call). |

The Worker is named `checkout`. `contact-form` is untouched and keeps `/api/contact`.

## Routes to add on the zone (already in `wrangler.toml`)

- `spritzconsulting.com/api/order*`
- `www.spritzconsulting.com/api/order*`

Zone: `spritzconsulting.com`. The cache rules already skip anything under `/api/`
(see `cloudflare-html-cache.md`), so nothing else changes there.

## Deploy

From this folder:

1. `npx wrangler secret put STRIPE_SECRET_KEY`. A restricted key with **Checkout Sessions: Write**, **Promotion Codes: Read** and
   **Coupons: Read**. The last two are for the `INDIE-` code lookup. Without them Stripe answers 403, the lookup fails and every
   `INDIE-` code is silently ignored (the buyer pays the full price).
2. `npx wrangler secret put STRIPE_WEBHOOK_SECRET`. The signing secret (`whsec_...`) of the endpoint in step 4.
3. `npx wrangler deploy`
4. In Stripe, add a webhook endpoint `https://spritzconsulting.com/api/order/webhook` listening to
   `checkout.session.completed`. Test mode and live mode each have their own endpoint and secret.

## Configuration (`wrangler.toml`, `[vars]`)

- `PRICES`: the Stripe price ids of the two tiers. They are the **sandbox** ids today. Swap for the live ids.
- `EXPRESS_PRICES`: the Express add-on price ids per currency (`eur`, `usd`, `gbp`). A Stripe price can carry all
  three currencies, so the same id repeats under each key. A flat `{standard, premium}` object also works and applies
  to every currency. A tier with an empty or different entry in any currency has no Express.
- `PRICE_AMOUNTS`: the tier amounts the page shows, per currency, in whole units. Keep them equal to the Stripe prices.
  The Worker reads them for `/api/order/config` and, when a payment arrives, to check the paid total in the currency
  Stripe used (`expectedTotal` and `amountMatches` in the KV record).
- `EXPRESS_AMOUNTS`: the Express amounts the page shows, per currency, in whole units. Keep them equal to the Stripe prices.
- Currency: **Stripe chooses it.** Every price carries EUR, USD and GBP and the Worker sends no `currency` to Checkout,
  so Stripe shows the buyer's local currency. A currency in the order payload is ignored. The page shows the three
  amounts for information only.
- Express needs the same price id and an amount in **all three** currencies. If one is missing, Express is off for that
  tier (the page hides the row and the Worker answers 422 `express_unavailable`), because Stripe could pick the missing one.
- `PROMOS`: promotion codes. Each code maps to one tier (`standard` = Indie, `premium` = Publisher), one Stripe coupon id, the
  discounted tier amounts per currency and `active`. The order sends `discounts[0][coupon]` only when the code belongs to the
  requested tier; a code for another tier, an unknown or an inactive code is ignored without an error. The coupons must be limited
  to the tier's own product in Stripe, so the Express line is never discounted. `SOLODEV20` is Indie (79 / 87 / 71 against 99 / 109 / 89),
  `SOLODEV10` is Publisher (269 / 296 / 224 against 299 / 329 / 249). Express is added at its list amount to the discounted base.
- `INDIE_PUBLISHER_COUPON_ID`: the id of the Stripe coupon "Indie Publisher". The repo holds the placeholder `REPLACE_WITH_COUPON_ID`:
  paste the real id from Stripe dashboard > Product catalogue > Coupons > Indie Publisher > Details > ID. While it starts with `REPLACE`,
  every `INDIE-` code is ignored. Sandbox and live have different coupons, so the live id replaces it at go-live.
- `EXPRESS_ENABLED`: `"false"` by default. With it off the page hides the Express row and the Worker refuses Express.

To open Express: create the two Express products in Stripe, paste their price ids into `EXPRESS_PRICES.eur`,
set `EXPRESS_ENABLED = "true"`, deploy.

## What the Worker stores

Keys in the `CONTACT_SUBMISSIONS` namespace. Order records expire after 30 days (the order form promises deletion after 30 days). The Solo Dev counters have their own expiry, described in "Solo Dev (free) orders" below:

- `order:<uuid>`: the order (tier, express, Steam link, email, optional fields, status, and after payment
  `paidAt`, `due_date`, `due_start_date`, `due_date_approx`, `amountTotal`, `paidCurrency` (the currency Stripe used), `expectedTotal` and `amountMatches`, plus `listTotal` (the total at list price)). `promo` and `discountApplied` are written only when Stripe took money off (`total_details.amount_discount` above 0); otherwise neither key exists, and `expectedTotal` is the list total.
- `order:paid:<checkout session id>`: marks a session as processed, so a repeated Stripe delivery changes nothing.
- `order:rl:<ip>`: rate limit, 5 orders per IP per 10 minutes.

```
npx wrangler kv key list --binding CONTACT_SUBMISSIONS --prefix order: --remote
npx wrangler kv key get "order:<uuid>" --binding CONTACT_SUBMISSIONS --remote
```

There is **no notification email yet**. Check KV for `status: "paid"` records (and `status: "free_new"` for Solo Dev) until the mail service exists.

## Solo Dev (free) orders

`POST /api/order/free` takes `{ steam, email, page, referrer }`. The checks run in this order, and the first one that fails answers:

1. Validation: the Steam link must be on `store.steampowered.com` or `steamcommunity.com` and contain `/app/<id>/`, otherwise 422 `invalid_steam_link`. The email must be valid, otherwise 422 `invalid_email`.
2. Per-IP limit: 5 orders per IP per 600 seconds, counter `order:rlf:<ip>`, otherwise 429 `rate_limited`.
3. Email limit: 3 orders per email, otherwise 409 `email_limit`.
4. Game limit: 1 order per Steam app id, otherwise 409 `game_limit`.
5. Daily limit: 5 orders per UTC day in total, otherwise 429 `daily_limit`.

Keys in `CONTACT_SUBMISSIONS`:

- `order:<uuid>`: the order, 30 day expiry. Fields: `id`, `createdAt`, `status` (`free_new`), `tier` (`free`), `steam`, `appId`, `email`, `page`, `referrer`, `ip`, `country`.
- `free:email:<sha256>`: counter, 365 day expiry. The code is the SHA-256 (hex) of the lowercased, trimmed email. The raw email is never part of a key.
- `free:app:<app id>`: counter, 365 day expiry.
- `free:day:<YYYY-MM-DD>`: counter for that UTC day, 2 day expiry.
- `order:rlf:<ip>`: per-IP limit, 600 second expiry.

The counters go up only after the order is stored. Each new order resets the 365 day expiry of its email and game counters, so the one-way codes live for 12 months after the last free order. The privacy page says the same. Delivery is manual: list the `order:` keys, read the ones with `status: "free_new"`, send the PDF within 1 day.

To compute an email code by hand: `printf '%s' 'name@example.com' | sha256sum`.

## Indie to Publisher codes (one code per order)

An `INDIE-` code gives a buyer who already holds an Indie analysis the Publisher analysis at **190 EUR / 209 USD / 158 GBP**
(list 299 / 329 / 249). Express is never discounted: it is added at its list amount (Publisher with Express is
289 / 308 / 257). Each code works once. You create the codes by hand in Stripe. Test mode and live mode each need their own coupon.

**Once: create the coupon "Indie Publisher"**

1. Stripe dashboard, switch to the right mode (the Sandbox banner on top in test mode). Open **Product catalogue** (Catalogo prodotti), tab **Coupons**, button **Create coupon** (Crea coupon).
2. Name: `Indie Publisher`. Type: **Fixed amount discount** (Importo scontato fisso). Amount **109.00 EUR**. Use **Add amount for other currencies** and add **120.00 USD** and **91.00 GBP**.
3. Duration: **Once** (Una sola volta).
4. Tick **Apply to specific products** (Prodotti idonei) and select **Publisher Analysis** only. Do not select Indie Analysis or either Express product.
5. Leave the redemption limit and the expiry date of the coupon empty: the limit lives on each code. Click **Create coupon**.
6. Open the new coupon. Under **Details**, copy the coupon **ID**. Paste it in `wrangler.toml` as `INDIE_PUBLISHER_COUPON_ID`
   (replacing `REPLACE_WITH_COUPON_ID`) and add the same value as a plain text variable `INDIE_PUBLISHER_COUPON_ID` in the Cloudflare dashboard
   (Workers & Pages > checkout > Settings > Variables and secrets). Deploy as usual.

**For every order: create one code**

1. Open the coupon **Indie Publisher**. In the **Promotion codes** (Codici promozionali) box click **New code** (the plus button).
2. Code: `INDIE-` followed by 8 random capital letters or digits, for example `INDIE-K7M2Q9XA`. Use only A to Z, 0 to 9 and the one hyphen after `INDIE-`. The Worker upper-cases what the buyer types.
3. Open **Additional options** (Opzioni aggiuntive). Tick **Limit the total number of times this code can be redeemed** and enter **1**. This is what makes the code one-time. A code with no limit is refused by the Worker.
4. Leave **Active** on, and leave the other limits empty (first-time order only off, no minimum amount). An expiry date is optional.
5. Click **Create code**. Send the code to the buyer. They type it in the promo field of the Publisher order form.
6. After the payment Stripe shows the code as redeemed 1 of 1, and the Worker ignores it from then on. The order record in KV carries `promo` and `discountApplied: true`.

The Worker accepts a code only when all of these hold: it starts with `INDIE-`, it is active, its coupon id equals `INDIE_PUBLISHER_COUPON_ID`,
the order is Publisher, and `times_redeemed` is below `max_redemptions`. A wrong, used or wrong-tier code is ignored without an error and the buyer pays the full price.

## Global discount (PRICE_PERCENT_OFF)

One variable lowers every price by the same percentage: 0 gives the prices as decided, 99 gives test prices (Indie 0.99 EUR,
Publisher 2.99 EUR, Indie with Express 1.48 EUR), 50 runs a promotion.

- Above 0 the Worker works out the final total for each currency: the price of the code (SOLODEV20, SOLODEV10, INDIE-) first,
  then the percentage, with Express included. It makes one coupon for that order (amount off per currency, one redemption,
  gone after 25 hours) and sends it as the only discount, because Checkout takes one discount per session.
- The Stripe key needs Coupons Write. With an INDIE- code it also needs Promotion codes Write: the Worker switches the code
  off when the payment arrives, because Stripe does not count the redemption in this mode.
- Above 50 the value only works with a test key (sk_test_ or rk_test_) or with the variable ALLOW_DEEP_DISCOUNT set to "true".
  Set that variable on purpose for live tests and remove it after. Without permission the Worker ignores the value and logs it.
- A total under what Stripe charges (0.50 EUR, 0.50 USD, 0.30 GBP) gives 422 `amount_too_low`.
- `GET /api/order/config` and `GET /api/order/promo` show the discounted amounts, `percentOff` and the list amounts. Read
  `percentOff` from the public config to see that the variable is back to 0.
- The paid record stores `percentOff`, and `amountMatches` checks the paid total against the discounted amount.
- A race exists: two orders with the same INDIE- code, both started before the first payment, can both pay the discount.
  The code is switched off at the first payment.
- INDIE_PUBLISHER_AMOUNTS (JSON, whole units) replaces the built-in 190 / 209 / 158.

## Delivery date

`business-days.js` holds `addBusinessDays` and `dueDate`. Business days are Monday to Friday except the Italian public
holidays, hard-coded for 2026 and 2027. A payment up to 12:00 Europe/Rome on a business day counts from that day (day 0);
after 12:00, or on a weekend or holiday, from the next business day. Indie is 2 business days (1 with Express),
Publisher 3 (2 with Express). The list ends with 2027: after that the helper skips weekends only and sets
`due_date_approx: true`. Add the 2028 holidays before the end of 2027.

## Single file for the Cloudflare dashboard

`node build-single.mjs` writes `worker.single.js`: `worker.js` and `business-days.js` in one file, with no imports.
Paste it into the dashboard editor. The dashboard does not read `wrangler.toml`, so there you also set by hand:
the KV binding `CONTACT_SUBMISSIONS`, the variables `EXPRESS_ENABLED`, `PRICES`, `EXPRESS_PRICES`, `PRICE_AMOUNTS`, `EXPRESS_AMOUNTS`
and `PROMOS` (all but `EXPRESS_ENABLED` as JSON), the plain text variable `INDIE_PUBLISHER_COUPON_ID`, the two secrets, and the two routes. Edit `worker.js` or `business-days.js`, never the single file.

## Tests

`node test.mjs` rebuilds the single file, then runs the business-day cases and the Worker, source and single file, with a mocked Stripe and KV. No dependencies.

## Tax

The Worker sends no tax settings to Stripe. Tax behaviour is whatever each Stripe price carries.

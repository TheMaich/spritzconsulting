# Spritz edge cache Worker (fallback)

Caches static HTML at the Cloudflare edge for 2 hours. This exists as a
fallback for SPR-46. **Prefer the cache rule** described in
`docs/cloudflare-html-cache.md` — it achieves the same result with no Worker
invocations and no code to maintain. Do not run both.

## What it caches

- `*.html` and directory index URLs (`/`, `/resources/`, `/resources/tools/`)
- GET and HEAD only
- Only `200` responses with a `text/html` content type

Everything else, including `/api/contact` (the `spritz-contact-form` Worker),
passes through untouched.

Query strings are stripped from the cache key, so `?utm_source=...` variants
share one cached object.

## Deploy

From this folder:

```
npx wrangler login
npx wrangler deploy
```

The zone-wide route means this Worker sees every request to the site. If
`spritz-contact-form` is deployed, confirm its more specific
`/api/contact` route still wins after deploying, and that the contact form
still submits.

## Verify

```sh
curl -sSI https://spritzconsulting.com/resources/ip-ownership.html | grep -iE 'cf-cache-status|x-spritz-edge-cache'
curl -sSI https://spritzconsulting.com/resources/ip-ownership.html | grep -iE 'cf-cache-status|x-spritz-edge-cache'
curl -sSI https://spritzconsulting.com/api/contact | grep -i x-spritz-edge-cache
```

Second HTML hit should show `x-spritz-edge-cache: HIT`. The `/api/contact`
check should show no `x-spritz-edge-cache` header at all.

## Rollback

```
npx wrangler delete spritz-edge-cache
```

Cached objects expire on their own within 2 hours; purge the zone cache in the
dashboard if you need it immediate.

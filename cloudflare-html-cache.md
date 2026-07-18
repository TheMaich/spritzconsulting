# Cloudflare edge cache for HTML (spritzconsulting.com)

SPR-46 / SPR-43 item 5.

## Problem

`cf-cache-status: DYNAMIC` on static HTML, 5.74% cache hit rate. Cloudflare
does not cache `text/html` by default on any plan; the origin (GitHub Pages)
serves fully static files, so every HTML request is a needless origin trip.

## What to match

Matching only `*.html` is not enough. The site serves directory index URLs
too (`/`, `/resources/`, `/resources/tools/`), which are static HTML with no
`.html` suffix. The rule below covers both and excludes the one dynamic path.

Excluded: `/api/contact` (the `spritz-contact-form` Worker route). Cache rules
apply to GET/HEAD only, so the POST endpoint is already safe, but the
exclusion keeps intent explicit.

## Settings

- Edge TTL: **2 hours**, "Override origin"
- Browser TTL: **respect origin** (GitHub Pages sends `max-age=600`)
- Cache eligibility: **Eligible for cache**
- Query string handling: **ignore** query strings (no server-rendered
  variation; keeps UTM params from fragmenting the cache)

2h edge TTL is deliberately short: a deploy to GitHub Pages does not purge
Cloudflare, so 2h is the worst-case staleness window. Pair it with a purge on
deploy if that is too long (see "Purge on deploy" below).

## Option A — dashboard (fastest)

Cloudflare dashboard → **spritzconsulting.com** → Caching → Cache Rules →
Create rule.

- Rule name: `Cache static HTML`
- Expression — use the "Edit expression" text box and paste:

```
(http.host contains "spritzconsulting.com"
 and not starts_with(http.request.uri.path, "/api/")
 and (ends_with(http.request.uri.path, ".html")
      or ends_with(http.request.uri.path, "/")))
```

- Then: Cache eligibility = **Eligible for cache**
- Edge TTL = **Override origin** → `2 hours`
- Browser TTL = **Respect origin TTLs**
- Query string handling under Cache Key = **Ignore query string**

Deploy the rule. Verify with the checks below.

## Option B — API token (if Miki prefers to delegate)

Scoped token needed: **Zone → Cache Rules → Edit** on zone
`spritzconsulting.com` only. Nothing else. Create at
https://dash.cloudflare.com/profile/api-tokens with the "Create Custom Token"
flow.

With `CF_API_TOKEN` and `CF_ZONE_ID` set, this creates the rule:

```sh
curl -X PUT \
  "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/rulesets/phases/http_request_cache_settings/entrypoint" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "rules": [
      {
        "description": "Cache static HTML",
        "expression": "(http.host contains \"spritzconsulting.com\" and not starts_with(http.request.uri.path, \"/api/\") and (ends_with(http.request.uri.path, \".html\") or ends_with(http.request.uri.path, \"/\")))",
        "action": "set_cache_settings",
        "action_parameters": {
          "cache": true,
          "edge_ttl": { "mode": "override_origin", "default": 7200 },
          "browser_ttl": { "mode": "respect_origin" },
          "cache_key": {
            "ignore_query_strings_order": true,
            "custom_key": { "query_string": { "exclude": "*" } }
          }
        }
      }
    ]
  }'
```

`PUT` on the entrypoint **replaces the whole cache ruleset** for the zone. Run
the GET first and confirm the rule list is empty (or merge into it) before
running the PUT:

```sh
curl -s "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/rulesets/phases/http_request_cache_settings/entrypoint" \
  -H "Authorization: Bearer $CF_API_TOKEN"
```

Zone id is on the zone Overview page, bottom right.

## Option C — Workers fallback

Only if dashboard cache rules are unavailable or unwanted. See
`workers/edge-cache/`. It is strictly worse than a cache rule (costs a Worker
invocation per request, more moving parts) and is included only because
SPR-46 named it as an alternative. Do not deploy both.

## Verification

After the rule is live:

```sh
# First hit warms the cache, second should say HIT.
curl -sSI https://spritzconsulting.com/resources/ip-ownership.html | grep -i cf-cache-status
curl -sSI https://spritzconsulting.com/resources/ip-ownership.html | grep -i cf-cache-status

# Directory index URL, the case a bare *.html rule would miss.
curl -sSI https://spritzconsulting.com/resources/tools/ | grep -i cf-cache-status

# The Worker endpoint must NOT be cached.
curl -sSI https://spritzconsulting.com/api/contact | grep -i cf-cache-status
```

Expected: `HIT` on the second HTML hit and on the directory URL after warming;
`DYNAMIC` (or no HIT) on `/api/contact`.

Then re-check the hit rate in Cloudflare → Analytics → Caching after 24h. The
5.74% baseline should move well above 50% once HTML is cacheable.

## Purge on deploy

Because edge TTL overrides the origin, a GitHub Pages deploy is invisible to
Cloudflare for up to 2h. If that matters, add a purge step to the deploy with
a token scoped to **Zone → Cache Purge → Purge**:

```sh
curl -X POST "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/purge_cache" \
  -H "Authorization: Bearer $CF_PURGE_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"purge_everything":true}'
```

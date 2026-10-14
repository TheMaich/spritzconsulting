# Deploy

`main` is published by GitHub Pages (the built-in `pages-build-deployment` workflow) and served
through Cloudflare at https://spritzconsulting.com. Cloudflare caches pages at the edge, so a new
build is not visible everywhere until that cache is purged. Cache policy: `docs/cloudflare-cache-rules.md`.

## Purge and verify workflow

`.github/workflows/purge-and-verify.yml` runs after every successful GitHub Pages build, and on
demand (Actions → "Purge cache and verify live site" → Run workflow, or
`gh workflow run purge-and-verify.yml`).

1. **purge**: purges the whole Cloudflare zone (`purge_everything`; the site is small) through the
   Cloudflare API and checks the `success` field of the reply. If either secret below is missing it
   logs a warning and skips the purge, without failing.
2. **verify**: waits 60 seconds, then runs `node scripts/verify-live.mjs https://spritzconsulting.com`.
   On a failure it retries up to 5 times, 60 seconds apart, then fails the run. The pass/fail
   table is in the job log.

The workflow only has `contents: read` permission.

## Secrets

Settings → Secrets and variables → Actions → New repository secret:

- `CLOUDFLARE_API_TOKEN`: a Cloudflare API token with one permission, **Zone > Cache Purge > Purge**,
  and Zone Resources limited to **spritzconsulting.com only**. Nothing else.
- `CLOUDFLARE_ZONE_ID`: the zone ID shown on the spritzconsulting.com Overview page in Cloudflare.

Never put either value in the repo, a commit message or an issue.

## Checking by hand

- Live site: `node scripts/verify-live.mjs`
- Origin, past Cloudflare: `node scripts/verify-live.mjs https://spritzconsulting.com --resolve 185.199.108.153`
- Query strings are not part of Cloudflare's cache key, so `?cb=` does not bypass the cache; trust
  the content and the `cf-cache-status`, `age` and `cf-ray` headers instead.

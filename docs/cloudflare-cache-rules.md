# Cloudflare cache rules for spritzconsulting.com

GitHub Pages ignores `_headers` (that file is a Cloudflare Pages / Netlify feature) and sends
`Cache-Control: max-age=600` on every file, whatever the repo says. So the cache policy below
cannot live in the repo: it has to be set in the Cloudflare dashboard. This page is the record of
what those rules should be. It replaces the draft `_headers` file and supersedes the 2-hour HTML
rule in `cloudflare-html-cache.md`.

Measured on 14 Oct 2026, before these rules: HTML was cached at the edge for 2 hours (cache rule)
and Cloudflare rewrote the browser TTL to `max-age=345600` (4 days) on HTML, CSS, JS, fonts and
images, so a purge did not reach browsers that already had a page.

## Intended policy

| Path | Browser (`Cache-Control`) | Edge |
|---|---|---|
| `/`, `/*.html`, directory URLs (`/*/`) | `public, max-age=0, must-revalidate` | 5 minutes |
| `/sitemap.xml` | `public, max-age=0, must-revalidate` | 5 minutes |
| `/robots.txt` | `public, max-age=3600` | default |
| `/assets/fonts/*` | `public, max-age=31536000, immutable` (new face = new file name) | 1 month |
| `/assets/css/*`, `/assets/js/*` | `public, max-age=86400, stale-while-revalidate=604800` | 1 day |
| `/assets/vendor/*` | `public, max-age=2592000` | 1 month |
| `/assets/*.png`, `*.webp`, `*.jpg`, `/assets-2/*` | `public, max-age=604800` (names are not fingerprinted) | 1 month |

CSS and JS are not `immutable`: most references carry `?v=`, but some do not (`lenis`,
`smooth-scroll.js`), so a long browser TTL would pin old code.

## Cloudflare dashboard setup

Dashboard → spritzconsulting.com:

- [ ] **Caching → Configuration → Browser Cache TTL: "Respect Existing Headers".**
      Without this Cloudflare keeps rewriting browser TTLs to 4 days.
- [ ] **Caching → Cache Rules → Rule 1, HTML and sitemap.**
      Match: URL path equals `/`, or ends with `.html`, or ends with `/`, or equals `/sitemap.xml`
      (and does not start with `/api/`).
      Cache eligibility: Eligible for cache. Edge TTL: 5 minutes (or "Respect origin").
      Browser TTL: Respect origin.
- [ ] **Rule 2, assets and fonts.** Match: URL path starts with `/assets/` or `/assets-2/`.
      Edge TTL: 1 month. Browser TTL: 1 week.
- [ ] **Rule 3, CSS and JS.** Match: URL path ends with `.css` or `.js`.
      Edge TTL: 1 day. Browser TTL: 1 day.
      Place it **after** Rule 2: CSS and JS also match `/assets/`, and when several rules set the
      same value the later rule wins.
- [ ] Disable or delete the old `Cache static HTML` rule (2-hour edge TTL) once Rule 1 is live.
- [ ] Purge on deploy: `.github/workflows/purge-and-verify.yml` purges the zone after every
      GitHub Pages build (see `docs/deploy.md`).

## Verifying

- **Query strings are NOT part of the cache key** for HTML (the cache rule ignores them), so
  `?cb=…` cache-busting does not work: `/page?a=1` returns the same cached copy, with the same
  `age`, as `/page`. Verify by content (`node scripts/verify-live.mjs`), not by query string.
- **Cloudflare caches per data center.** One location can serve the fresh page while another
  still serves a stale copy until its TTL runs out or the zone is purged. A check from one place
  is not proof for everyone; compare with the `cf-ray` suffix (the data center code) and the
  `age` and `cf-cache-status` headers.
- Origin check past Cloudflare:
  `node scripts/verify-live.mjs https://spritzconsulting.com --resolve 185.199.108.153`.

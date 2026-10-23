# Google Search Console setup for spritzconsulting.com

Note: this overlaps issue SPR-9. Check SPR-9 before starting so the work is
not done twice.

The site is prepared: robots.txt allows everything under /resources/,
sitemap.xml lists all resource URLs and is referenced from robots.txt.

## Verify ownership (HTML tag method)

1. Go to https://search.google.com/search-console and sign in with the
   Google account that should own the property.
2. Click the property dropdown, top left, then "Add property".
3. Choose the "URL prefix" tile and enter `https://spritzconsulting.com`.
   The URL prefix method is what the HTML tag supports. The "Domain" tile
   needs a DNS TXT record instead; if you prefer that, add the TXT record
   at the DNS host and skip steps 4 to 6.
4. In the verification panel, open "Other verification methods" and pick
   "HTML tag". Copy the `content` value from the meta tag Google shows.
5. In `index.html`, add the meta tag Google shows right after the
   `<meta name="robots" ...>` line in the `<head>`.
6. Commit, push, wait for the deploy to go live, then click "Verify" in
   Search Console.

## Submit the sitemap

1. In Search Console, pick the spritzconsulting.com property.
2. Left sidebar: "Sitemaps".
3. Under "Add a new sitemap", enter `sitemap.xml` and click "Submit".
4. Status should read "Success" within a few minutes. Google then crawls
   on its own schedule; new pages typically appear in the Pages report
   within days, not hours.

## After verification

- Left sidebar "Pages" shows what is indexed and why pages are excluded.
- "Performance" shows queries and clicks once data accumulates, usually
  after 2 to 3 days.
- The two noindex tool pages (tools index, console physical release
  planner) and the draft folder are excluded on purpose. They will show
  as "Excluded by noindex tag". That is expected.

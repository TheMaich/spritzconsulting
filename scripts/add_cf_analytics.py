#!/usr/bin/env python3
"""Insert the Cloudflare Web Analytics beacon before </head> in every page.

Only needed if Cloudflare's automatic injection for the proxied zone is not
available or does not show up in the served HTML. Try the dashboard toggle
first, verify with scripts/check_site.py, and only run this if the beacon is
missing.

Usage:
    python scripts/add_cf_analytics.py <beacon-token>
    python scripts/add_cf_analytics.py --remove

Idempotent: running it twice does not duplicate the tag. Re-running with a
different token replaces the existing one.
"""

from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
# _drafts pages are not published and are not in the sitemap.
SKIP_PARTS = {".git", "graphify-out", "_drafts"}

BEACON_RE = re.compile(
    r"[ \t]*<script defer src=\"https://static\.cloudflareinsights\.com/beacon\.min\.js\"[^>]*></script>\n?"
)


def snippet(token: str) -> str:
    return (
        '<script defer src="https://static.cloudflareinsights.com/beacon.min.js" '
        f"data-cf-beacon='{{\"token\": \"{token}\"}}'></script>\n"
    )


def pages() -> list[pathlib.Path]:
    out = []
    for path in ROOT.rglob("*.html"):
        if SKIP_PARTS & set(path.relative_to(ROOT).parts):
            continue
        if path.suffix != ".html" or path.name.endswith(".bak"):
            continue
        out.append(path)
    return sorted(out)


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2

    arg = sys.argv[1]
    remove = arg == "--remove"
    if not remove and not re.fullmatch(r"[0-9a-f]{32,}", arg):
        print(f"Refusing to run: '{arg}' does not look like a Cloudflare beacon token.")
        print("Copy the token out of the data-cf-beacon attribute Cloudflare shows you.")
        return 2

    changed = 0
    skipped = 0
    for path in pages():
        text = path.read_text(encoding="utf-8")
        if "</head>" not in text:
            print(f"SKIP  {path.relative_to(ROOT)} (no </head>)")
            skipped += 1
            continue

        stripped = BEACON_RE.sub("", text)
        new = stripped if remove else stripped.replace("</head>", snippet(arg) + "</head>", 1)

        if new == text:
            print(f"OK    {path.relative_to(ROOT)} (already correct)")
            continue

        path.write_text(new, encoding="utf-8")
        print(f"WROTE {path.relative_to(ROOT)}")
        changed += 1

    print(f"\n{changed} file(s) changed, {skipped} skipped.")
    print("Next: commit, push, wait for the Pages build, then purge the Cloudflare cache.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

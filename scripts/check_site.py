#!/usr/bin/env python3
"""Pre-merge safety check for the static site.

Checks, over every .html file in the repo:
  1. internal links resolve to a real file on disk
  2. sitemap.xml entries resolve to a real file on disk
  3. every page in the repo is reachable from at least one other page (orphan check)
  4. basic HTML sanity: single <html>/<head>/<body>, balanced <main>

Exit code 1 if any hard failure. Run from the repo root:
    python scripts/check_site.py
"""

import os
import re
import sys
import xml.etree.ElementTree as ET
from urllib.parse import urlparse, unquote

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE_HOST = "spritzconsulting.com"
SKIP_DIRS = {".git", "assets-raw", "graphify-out", "node_modules", ".agents", "docs", "scripts"}

HREF_RE = re.compile(r"""(?:href|src)\s*=\s*["']([^"']+)["']""", re.I)


def html_files():
    out = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for f in filenames:
            if f.endswith(".html") and not f.endswith(".bak"):
                out.append(os.path.join(dirpath, f))
    return sorted(out)


def rel(path):
    return os.path.relpath(path, ROOT).replace("\\", "/")


def resolve(link, from_file):
    """Map a link to a repo-relative path, or None if it is not an internal page link."""
    link = link.strip()
    if not link or link.startswith(("#", "mailto:", "tel:", "javascript:", "data:")):
        return None
    p = urlparse(link)
    if p.scheme in ("http", "https"):
        if p.netloc.replace("www.", "") != SITE_HOST:
            return None  # external, not our problem
        target = p.path
    elif p.scheme:
        return None
    else:
        target = p.path
    if not target:
        return None
    target = unquote(target)
    if target.startswith("/"):
        candidate = os.path.join(ROOT, target.lstrip("/"))
    else:
        candidate = os.path.join(os.path.dirname(from_file), target)
    candidate = os.path.normpath(candidate)
    if candidate.endswith(os.sep) or target.endswith("/"):
        candidate = os.path.join(candidate, "index.html")
    return candidate


def main():
    files = html_files()
    on_disk = {os.path.normpath(f) for f in files}
    broken = []
    linked_to = set()

    for f in files:
        try:
            text = open(f, encoding="utf-8").read()
        except UnicodeDecodeError:
            text = open(f, encoding="utf-8", errors="replace").read()

        for raw in HREF_RE.findall(text):
            target = resolve(raw, f)
            if target is None:
                continue
            if target.endswith(".html"):
                if target in on_disk:
                    if os.path.normpath(target) != os.path.normpath(f):
                        linked_to.add(os.path.normpath(target))
                else:
                    broken.append((rel(f), raw))
            elif not os.path.exists(target):
                broken.append((rel(f), raw))

        # HTML sanity
        for tag in ("html", "head", "body"):
            n = len(re.findall(r"<%s[\s>]" % tag, text, re.I))
            if n != 1:
                broken.append((rel(f), "malformed: %d <%s> tags" % (n, tag)))
        if len(re.findall(r"<main[\s>]", text, re.I)) != len(
            re.findall(r"</main>", text, re.I)
        ):
            broken.append((rel(f), "malformed: unbalanced <main>"))

    # sitemap
    sitemap_missing = []
    sitemap_path = os.path.join(ROOT, "sitemap.xml")
    sitemap_urls = []
    if os.path.exists(sitemap_path):
        ns = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}
        tree = ET.parse(sitemap_path)
        for loc in tree.getroot().iter("{http://www.sitemaps.org/schemas/sitemap/0.9}loc"):
            url = (loc.text or "").strip()
            sitemap_urls.append(url)
            target = resolve(url, sitemap_path)
            if target and not os.path.exists(target):
                sitemap_missing.append(url)

    orphans = [
        rel(f)
        for f in files
        if os.path.normpath(f) not in linked_to
        and rel(f) not in ("index.html",)
        and not rel(f).endswith("/index.html")
    ]

    print("pages scanned:        %d" % len(files))
    print("sitemap entries:      %d" % len(sitemap_urls))
    print("broken internal links: %d" % len(broken))
    for f, l in broken:
        print("   BROKEN  %s -> %s" % (f, l))
    print("sitemap 404s:          %d" % len(sitemap_missing))
    for u in sitemap_missing:
        print("   MISSING %s" % u)
    print("orphan pages:          %d" % len(orphans))
    for o in orphans:
        print("   ORPHAN  %s" % o)

    hard_fail = bool(broken) or bool(sitemap_missing)
    print("\nRESULT: %s" % ("FAIL" if hard_fail else "PASS"))
    return 1 if hard_fail else 0


if __name__ == "__main__":
    sys.exit(main())

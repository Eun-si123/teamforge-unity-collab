#!/usr/bin/env python3
"""Advertise generated TeamForge RSS/Atom feeds in Pages HTML and semantic sitemap."""

from __future__ import annotations

import argparse
from pathlib import Path

BASE_URL = "https://eun-si123.github.io/teamforge-unity-collab/"
HEAD_START = "<!-- teamforge-update-feeds:start -->"
HEAD_END = "<!-- teamforge-update-feeds:end -->"
SITEMAP_START = "<!-- teamforge-update-feeds:start -->"
SITEMAP_END = "<!-- teamforge-update-feeds:end -->"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("site_root", type=Path)
    return parser.parse_args()


def remove_marker_block(text: str, start: str, end: str) -> str:
    while start in text and end in text:
        before, remainder = text.split(start, 1)
        _, after = remainder.split(end, 1)
        text = before + after
    return text


def main() -> None:
    args = parse_args()
    site_root = args.site_root.resolve()
    index_path = site_root / "index.html"
    sitemap_path = site_root / "sitemap.md"
    atom_path = site_root / "feed.atom"
    rss_path = site_root / "feed.xml"

    for target in (index_path, sitemap_path, atom_path, rss_path):
        if not target.is_file() or target.stat().st_size == 0:
            raise SystemExit(f"update-feed discovery requires generated output: {target.name}")

    homepage = index_path.read_text(encoding="utf-8")
    homepage = remove_marker_block(homepage, HEAD_START, HEAD_END)
    if "</head>" not in homepage:
        raise SystemExit("generated homepage is missing </head>")

    head_block = f'''{HEAD_START}
  <link rel="alternate" type="application/atom+xml" href="{BASE_URL}feed.atom" title="TeamForge project updates (Atom)">
  <link rel="alternate" type="application/rss+xml" href="{BASE_URL}feed.xml" title="TeamForge project updates (RSS)">
{HEAD_END}'''
    homepage = homepage.replace("</head>", head_block + "\n</head>", 1)

    # The generated project-facts section already has a machine-readable action
    # row. Add one visible feed entry there without introducing another section.
    action_anchor = f'<a class="btn" href="{BASE_URL}llms-full.txt">Full AI context</a>'
    feed_action = (
        action_anchor
        + f'\n          <a class="btn" href="{BASE_URL}feed.atom">Update feed</a>'
    )
    if action_anchor not in homepage:
        raise SystemExit("generated homepage feed action anchor changed unexpectedly")
    homepage = homepage.replace(action_anchor, feed_action, 1)
    index_path.write_text(homepage, encoding="utf-8")

    sitemap = sitemap_path.read_text(encoding="utf-8")
    sitemap = remove_marker_block(sitemap, SITEMAP_START, SITEMAP_END).rstrip() + "\n\n"
    sitemap += f'''{SITEMAP_START}
## Update feeds

- [Atom feed]({BASE_URL}feed.atom): Newest-first canonical project/release/status/discovery changes derived from Git first-parent history.
- [RSS 2.0 feed]({BASE_URL}feed.xml): RSS representation of the same update entries for readers and crawlers that prefer RSS.

The feeds are generated outputs, not a second changelog. Each item links to the exact GitHub commit and only current-facing canonical source paths are eligible; historical phase/work-state notes are intentionally excluded from feed selection.
{SITEMAP_END}
'''
    sitemap_path.write_text(sitemap, encoding="utf-8")

    print("Advertised TeamForge RSS/Atom feeds in homepage autodiscovery and semantic sitemap.")


if __name__ == "__main__":
    main()

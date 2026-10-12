#!/usr/bin/env python3
"""Select changed, indexable HTML URLs for the post-deployment IndexNow notification.

The sitemap builder owns the source-to-HTML-route mapping. Comparing with the
previous successful Pages deployment (not just HEAD^) avoids missing commits
when pushes or deployments overlap.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]

# Changes to shared rendering/navigation affect every indexable HTML page.
# Preview-only locales remain excluded by the sitemap locale registry.
SHARED_HTML_SOURCES = frozenset({
    ".github/workflows/pages.yml",
    "scripts/add-update-feed-discovery.py",
    "scripts/build-agent-web.py",
    "scripts/build_homepage_locales.py",
    "scripts/doc_markdown.py",
    "scripts/llms_v2.py",
    "scripts/render_doc_pages.py",
    "site/doc-diagrams.js",
    "site/locale-picker.js",
    "site/site-navigation.js",
    "site/theme-toggle.js",
    "site/i18n/locales.json",
    "site/robots.txt",
})


def load_sitemap_builder():
    path = Path(__file__).with_name("build-sitemap.py")
    spec = importlib.util.spec_from_file_location("teamforge_indexnow_sitemap", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot import sitemap builder: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def select_html_urls(changed_paths: set[str], *, all_pages: bool = False) -> list[str]:
    """Route changed repository paths to indexable HTML URLs only."""
    sitemap = load_sitemap_builder()
    registry = sitemap.load_registry(REPO_ROOT)
    entries = (
        sitemap.homepage_entries(registry)
        + sitemap.localized_document_entries(registry)
        + sitemap.STATIC_ENTRIES
    )
    changed = {path.replace("\\", "/") for path in changed_paths}
    shared_change = bool(changed & SHARED_HTML_SOURCES) or any(
        path.startswith("site/") and path.lower().endswith(
            (".css", ".svg", ".png", ".jpg", ".jpeg", ".webp")
        )
        for path in changed
    )
    return sorted({
        sitemap.BASE_URL + relative
        for relative, sources in entries
        if relative.endswith("/")  # exclude XML, TXT, JSON, Markdown, and feeds
        and (
            all_pages
            or shared_change
            or (sources is not None and bool(changed.intersection(sources)))
        )
    })


def changed_paths_between(base: str, head: str) -> set[str]:
    if not base or not head:
        raise ValueError("both base and head commits are required")
    output = subprocess.check_output(
        ["git", "diff", "--no-renames", "--name-only",
         "--diff-filter=ACDMRT", base, head, "--"],
        cwd=REPO_ROOT,
        text=True,
    )
    return {line for line in output.splitlines() if line}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", help="Previous successful Pages deployment SHA")
    parser.add_argument("--head", help="Current successful Pages deployment SHA")
    parser.add_argument("--all", action="store_true", help="Bootstrap without an earlier deployment")
    args = parser.parse_args()
    if args.all:
        if args.base or args.head:
            parser.error("--all cannot be combined with --base/--head")
        urls = select_html_urls(set(), all_pages=True)
    else:
        if not args.base or not args.head:
            parser.error("--base and --head are required unless --all is used")
        urls = select_html_urls(changed_paths_between(args.base, args.head))
    print(json.dumps(urls, indent=2))


if __name__ == "__main__":
    main()

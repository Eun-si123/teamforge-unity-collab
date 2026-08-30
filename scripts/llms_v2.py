#!/usr/bin/env python3
"""Apply llms.txt v2 discovery links and Markdown mirrors to TeamForge Pages."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

BASE_URL = "https://eun-si123.github.io/teamforge-unity-collab/"
HEAD_START = "<!-- teamforge-llms-v2:start -->"
HEAD_END = "<!-- teamforge-llms-v2:end -->"
SEMANTIC_SITEMAP_ALTERNATE = (
    f'<link rel="alternate" type="text/markdown" href="{BASE_URL}sitemap.md" '
    'title="TeamForge semantic sitemap">'
)
SEMANTIC_SITEMAP_RELATED = (
    f'<link rel="related" type="text/markdown" href="{BASE_URL}sitemap.md" '
    'title="TeamForge semantic sitemap">'
)

DEFAULT_PAGE_SOURCES = {
    "": "readme.txt",
    "status/": "status.txt",
    "how-it-works/": "how-it-works.txt",
    "architecture/": "architecture-overview.txt",
    "source/": "source.txt",
    "test-lab/": "test-lab.txt",
    "engineering/": "engineering-guide.txt",
    "documentation/": "documentation-guide.txt",
    "changelog/": "changelog.txt",
    "security/": "security.txt",
}

LLMS_LINK_RE = re.compile(
    r"^- \[[^\]]+\]\(([^)]+)\)(?:: .+)?$"
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("repo_root", type=Path)
    parser.add_argument("site_root", type=Path)
    parser.add_argument(
        "--check",
        action="store_true",
        help="Verify v2 mirrors/discovery without modifying generated files.",
    )
    return parser.parse_args()


def remove_marker_block(text: str) -> str:
    while HEAD_START in text and HEAD_END in text:
        before, remainder = text.split(HEAD_START, 1)
        _, after = remainder.split(HEAD_END, 1)
        text = before + after
    return text


def load_registry(repo_root: Path) -> dict[str, object]:
    path = repo_root / "site/i18n/locales.json"
    if not path.is_file():
        raise RuntimeError(f"missing locale registry: {path}")
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or not isinstance(data.get("locales"), list):
        raise RuntimeError("site/i18n/locales.json has an invalid structure")
    return data


def page_source_map(repo_root: Path, site_root: Path) -> dict[str, str]:
    """Return generated HTML route -> generated Markdown-source mirror."""
    sources = dict(DEFAULT_PAGE_SOURCES)
    registry = load_registry(repo_root)
    default_locale = str(registry.get("defaultLocale") or "en")

    for raw_locale in registry["locales"]:
        if not isinstance(raw_locale, dict) or not bool(raw_locale.get("publish", False)):
            continue

        code = str(raw_locale.get("code") or "")
        locale_path = str(raw_locale.get("path") or "")
        if code and code != default_locale and locale_path:
            homepage_source = f"readme.{code}.txt"
            if (site_root / homepage_source).is_file():
                sources[locale_path] = homepage_source

        documents = raw_locale.get("documents") or {}
        if not isinstance(documents, dict):
            raise RuntimeError(f"locale {code or '<unknown>'} documents must be an object")

        for source_route, raw_spec in documents.items():
            if not isinstance(raw_spec, dict):
                raise RuntimeError(
                    f"locale {code or '<unknown>'} document {source_route!r} must be an object"
                )
            route = str(raw_spec.get("path") or "")
            source = str(raw_spec.get("source") or "")
            if not route or not route.endswith("/") or route.startswith("/"):
                raise RuntimeError(
                    f"locale {code or '<unknown>'} has invalid document route: {route!r}"
                )
            if not source:
                raise RuntimeError(
                    f"locale {code or '<unknown>'} document {source_route!r} has no source"
                )
            sources[route] = source

    return sources


def mirror_path(site_root: Path, route: str) -> Path:
    return site_root / route / "index.md" if route else site_root / "index.md"


def html_path(site_root: Path, route: str) -> Path:
    return site_root / route / "index.html" if route else site_root / "index.html"


def build_mirrors(
    repo_root: Path,
    site_root: Path,
    *,
    check_only: bool,
) -> dict[str, str]:
    """Build Markdown page variants and return HTML-relative-path -> Markdown URL."""
    alternate_by_html: dict[str, str] = {}

    for route, source_name in page_source_map(repo_root, site_root).items():
        source = site_root / source_name
        html = html_path(site_root, route)
        destination = mirror_path(site_root, route)

        if not source.is_file() or source.stat().st_size == 0:
            raise RuntimeError(f"llms.txt v2 source mirror is missing: {source_name}")
        if not html.is_file() or html.stat().st_size == 0:
            raise RuntimeError(
                f"llms.txt v2 HTML page is missing for route {route or '/'}: {html}"
            )

        content = source.read_text(encoding="utf-8")
        if check_only:
            if not destination.is_file():
                raise RuntimeError(f"llms.txt v2 Markdown mirror is missing: {destination}")
            if destination.read_text(encoding="utf-8") != content:
                raise RuntimeError(
                    f"llms.txt v2 Markdown mirror drifted from {source_name}: {destination}"
                )
        else:
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_text(content, encoding="utf-8")

        html_relative = html.relative_to(site_root).as_posix()
        alternate_by_html[html_relative] = BASE_URL + route + "index.md"

    return alternate_by_html


def head_block(markdown_url: str | None) -> str:
    lines = [
        HEAD_START,
        f'  <link rel="describedby" href="{BASE_URL}llms.txt">',
    ]
    if markdown_url is not None:
        lines.append(
            f'  <link rel="alternate" type="text/markdown" href="{markdown_url}">'
        )
    lines.append(HEAD_END)
    return "\n".join(lines)


def apply_html_discovery(
    site_root: Path,
    alternate_by_html: dict[str, str],
    *,
    check_only: bool,
) -> int:
    touched = 0
    for path in sorted(site_root.rglob("*.html")):
        text = path.read_text(encoding="utf-8")
        if "</head>" not in text:
            continue

        relative = path.relative_to(site_root).as_posix()
        markdown_url = alternate_by_html.get(relative)
        expected = head_block(markdown_url)

        if check_only:
            if expected not in text:
                raise RuntimeError(
                    f"llms.txt v2 discovery links are missing or stale in {relative}"
                )
            if markdown_url and SEMANTIC_SITEMAP_ALTERNATE in text:
                raise RuntimeError(
                    f"{relative} still advertises sitemap.md as the page's Markdown alternate"
                )
        else:
            text = remove_marker_block(text)
            # Before v2, the homepage advertised the semantic sitemap as a Markdown
            # alternate. Keep it discoverable, but do not let agents mistake it for
            # the Markdown representation of the current page.
            text = text.replace(
                SEMANTIC_SITEMAP_ALTERNATE,
                SEMANTIC_SITEMAP_RELATED,
            )
            text = text.replace("</head>", expected + "\n</head>", 1)
            path.write_text(text, encoding="utf-8")

        touched += 1

    if touched == 0:
        raise RuntimeError("llms.txt v2 discovery found no HTML pages")
    return touched


def validate_llms_structure(site_root: Path) -> int:
    path = site_root / "llms.txt"
    if not path.is_file() or path.stat().st_size == 0:
        raise RuntimeError("generated site is missing llms.txt")

    text = path.read_text(encoding="utf-8-sig")
    lines = text.splitlines()
    nonblank = [idx for idx, line in enumerate(lines) if line.strip()]
    if not nonblank:
        raise RuntimeError("llms.txt is empty")

    first = nonblank[0]
    if not lines[first].startswith("# ") or lines[first].startswith("## "):
        raise RuntimeError("llms.txt v2 must start with a single H1")

    h1_count = 0
    first_h2: int | None = None
    for idx, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith("# "):
            h1_count += 1
            if idx != first:
                raise RuntimeError("llms.txt v2 permits only the initial H1")
        if stripped.startswith("###"):
            raise RuntimeError(
                f"llms.txt v2 H2 file-list sections must not contain H3+ headings: line {idx + 1}"
            )
        if stripped.startswith("## ") and first_h2 is None:
            first_h2 = idx

    if h1_count != 1:
        raise RuntimeError(f"llms.txt v2 requires exactly one H1, found {h1_count}")

    summary_idx = next(
        (idx for idx in nonblank if idx > first),
        None,
    )
    if summary_idx is None or not lines[summary_idx].lstrip().startswith("> "):
        raise RuntimeError("llms.txt v2 should place a blockquote summary after the H1")

    if first_h2 is None:
        raise RuntimeError("llms.txt v2 requires at least one H2 file-list section")

    section_name: str | None = None
    section_links = 0
    total_links = 0
    internal_links: list[str] = []

    for idx in range(first_h2, len(lines)):
        stripped = lines[idx].strip()
        if not stripped:
            continue
        if stripped.startswith("## "):
            if section_name is not None and section_links == 0:
                raise RuntimeError(f"llms.txt v2 section has no links: {section_name}")
            section_name = stripped[3:].strip()
            section_links = 0
            continue
        match = LLMS_LINK_RE.match(stripped)
        if match is None:
            raise RuntimeError(
                "llms.txt v2 H2 sections may contain only Markdown file-list bullets; "
                f"line {idx + 1}: {stripped!r}"
            )
        section_links += 1
        total_links += 1
        target = match.group(1)
        if target.startswith(BASE_URL):
            internal_links.append(target)

    if section_name is not None and section_links == 0:
        raise RuntimeError(f"llms.txt v2 section has no links: {section_name}")

    for url in internal_links:
        relative = url[len(BASE_URL):].split("#", 1)[0].split("?", 1)[0]
        target = site_root / relative
        if not target.is_file():
            raise RuntimeError(f"llms.txt points to missing generated resource: {url}")

    return total_links


def apply_llms_v2(
    repo_root: Path,
    site_root: Path,
    *,
    check_only: bool = False,
) -> tuple[int, int, int]:
    repo_root = repo_root.resolve()
    site_root = site_root.resolve()

    alternate_by_html = build_mirrors(
        repo_root,
        site_root,
        check_only=check_only,
    )
    html_count = apply_html_discovery(
        site_root,
        alternate_by_html,
        check_only=check_only,
    )
    link_count = validate_llms_structure(site_root)
    return len(alternate_by_html), html_count, link_count


def main() -> None:
    args = parse_args()
    mirrors, html_pages, llms_links = apply_llms_v2(
        args.repo_root,
        args.site_root,
        check_only=args.check,
    )
    verb = "Verified" if args.check else "Applied"
    print(
        f"{verb} llms.txt v2 compatibility: "
        f"{mirrors} Markdown mirrors, {html_pages} HTML discovery pages, "
        f"{llms_links} llms.txt resource links."
    )


if __name__ == "__main__":
    main()

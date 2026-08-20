#!/usr/bin/env python3
"""Generate TeamForge sitemap.xml with source-aware lastmod values."""

from __future__ import annotations

import argparse
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.parse import urlparse

BASE_URL = "https://eun-si123.github.io/teamforge-unity-collab/"
NS = "http://www.sitemaps.org/schemas/sitemap/0.9"

# None means the output is regenerated from the current repository snapshot itself.
# Otherwise lastmod is the newest commit date among the canonical source paths.
ENTRIES: tuple[tuple[str, tuple[str, ...] | None], ...] = (
    ("", None),
    ("status/", ("docs/STATUS.md",)),
    ("architecture/", ("docs/architecture.md",)),
    ("source/", ("docs/SOURCE.md",)),
    ("changelog/", ("CHANGELOG.md", "unity-package/com.eunsung.teamforge/CHANGELOG.md")),
    ("security/", (".github/SECURITY.md",)),
    ("sitemap.md", None),
    ("project.json", None),
    ("release-contract.json", ("release-contract.json",)),
    ("repository-manifest.json", None),
    ("llms.txt", ("llms.txt",)),
    (
        "llms-full.txt",
        (
            "release-contract.json",
            "README.md",
            "docs/STATUS.md",
            "CODEMAP.md",
            "docs/architecture.md",
            "CHANGELOG.md",
            "unity-package/com.eunsung.teamforge/CHANGELOG.md",
            "docs/ROADMAP.md",
            "docs/SOURCE.md",
            "docs/AI_COMMENT_AUDIT.md",
            "docs/AI_DISCOVERY.md",
            "docs/architecture-decisions.md",
            ".github/SECURITY.md",
            ".github/CONTRIBUTING.md",
            ".github/SUPPORT.md",
            "unity-package/com.eunsung.teamforge/README.md",
            "server/README.md",
            "project-peer/README.md",
            "launcher/README.md",
        ),
    ),
    ("readme.txt", ("README.md",)),
    ("status.txt", ("docs/STATUS.md",)),
    ("changelog.txt", ("CHANGELOG.md", "unity-package/com.eunsung.teamforge/CHANGELOG.md")),
    ("codemap.txt", ("CODEMAP.md",)),
    ("source.txt", ("docs/SOURCE.md",)),
    ("architecture-overview.txt", ("docs/architecture.md",)),
    ("architecture.txt", ("docs/architecture-decisions.md",)),
    ("security.txt", (".github/SECURITY.md",)),
    ("ai-discovery.txt", ("docs/AI_DISCOVERY.md",)),
    ("comment-audit.txt", ("docs/AI_COMMENT_AUDIT.md",)),
    ("roadmap.txt", ("docs/ROADMAP.md",)),
    ("contributing.txt", (".github/CONTRIBUTING.md",)),
    ("support.txt", (".github/SUPPORT.md",)),
    ("modules/unity-package.txt", ("unity-package/com.eunsung.teamforge/README.md",)),
    ("modules/server.txt", ("server/README.md",)),
    ("modules/project-peer.txt", ("project-peer/README.md",)),
    ("modules/launcher.txt", ("launcher/README.md",)),
    ("history/phases/index.txt", ("docs/phases",)),
    ("history/work-state/index.txt", ("docs/work-state",)),
    ("readme.ko.txt", ("README.ko.md",)),
    ("status.ko.txt", ("docs/STATUS.ko.md",)),
    ("roadmap.ko.txt", ("docs/ROADMAP.ko.md",)),
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("repo_root", type=Path)
    parser.add_argument("site_root", type=Path)
    return parser.parse_args()


def git_output(repo_root: Path, *args: str) -> str:
    return subprocess.check_output(
        ["git", *args],
        cwd=repo_root,
        text=True,
        stderr=subprocess.STDOUT,
    ).strip()


def head_date(repo_root: Path) -> str:
    value = git_output(repo_root, "show", "-s", "--format=%cs", "HEAD")
    if not value:
        raise RuntimeError("could not resolve current commit date")
    return value


def source_date(repo_root: Path, source: str) -> str:
    target = repo_root / source
    if not target.exists():
        raise RuntimeError(f"sitemap source path does not exist: {source}")
    value = git_output(repo_root, "log", "-1", "--format=%cs", "--", source)
    if not value:
        raise RuntimeError(
            f"could not resolve git history for sitemap source {source}; "
            "the Pages checkout must include repository history"
        )
    return value


def latest_source_date(repo_root: Path, sources: tuple[str, ...] | None, current: str) -> str:
    if sources is None:
        return current
    return max(source_date(repo_root, source) for source in sources)


def output_target(site_root: Path, relative_url: str) -> Path:
    if not relative_url:
        return site_root / "index.html"
    if relative_url.endswith("/"):
        return site_root / relative_url / "index.html"
    return site_root / relative_url


def main() -> None:
    args = parse_args()
    repo_root = args.repo_root.resolve()
    site_root = args.site_root.resolve()
    current = head_date(repo_root)

    seen: set[str] = set()
    ET.register_namespace("", NS)
    urlset = ET.Element(ET.QName(NS, "urlset"))

    for relative, sources in ENTRIES:
        url = BASE_URL + relative
        if url in seen:
            raise RuntimeError(f"duplicate sitemap URL: {url}")
        seen.add(url)

        target = output_target(site_root, relative)
        if not target.is_file() or target.stat().st_size == 0:
            raise RuntimeError(f"sitemap target is missing/empty: {target}")

        item = ET.SubElement(urlset, ET.QName(NS, "url"))
        ET.SubElement(item, ET.QName(NS, "loc")).text = url
        ET.SubElement(item, ET.QName(NS, "lastmod")).text = latest_source_date(
            repo_root, sources, current
        )

    sitemap_path = site_root / "sitemap.xml"
    tree = ET.ElementTree(urlset)
    ET.indent(tree, space="  ")
    tree.write(sitemap_path, encoding="utf-8", xml_declaration=True)

    parsed = urlparse(BASE_URL)
    if not parsed.path.endswith("/") or parsed.path == "/":
        raise RuntimeError("expected TeamForge to use a GitHub Pages project-site base path")

    print(f"Generated sitemap.xml with {len(ENTRIES)} source-aware URLs.")


if __name__ == "__main__":
    main()

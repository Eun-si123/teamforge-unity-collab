#!/usr/bin/env python3
"""Generate TeamForge sitemap.xml with source-aware lastmod values."""

from __future__ import annotations

import argparse
import json
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.parse import urlparse

from verify_localized_doc_revisions import verify_localized_doc_revisions

BASE_URL = "https://eun-si123.github.io/teamforge-unity-collab/"
NS = "http://www.sitemaps.org/schemas/sitemap/0.9"
REGISTRY_PATH = Path("site/i18n/locales.json")

# Homepage URLs are discovered from the locale registry so publishing another
# indexable locale does not require editing the sitemap implementation.
COMMON_HOMEPAGE_SOURCES: tuple[str, ...] = (
    "site/index.html",
    "site/i18n/locales.json",
    "scripts/build-agent-web.py",
    "site/editor-demo-v2.js",
    "site/theme-toggle.js",
    "site/editor-demo-v4.js",
    "release-contract.json",
    "docs/STATUS.md",
)

# None means the output is regenerated from the current repository snapshot itself.
# Otherwise lastmod is the newest commit date among the canonical source paths.
# Localized documentation routes are intentionally not listed here; they come
# from site/i18n/locales.json via localized_document_entries().
STATIC_ENTRIES: tuple[tuple[str, tuple[str, ...] | None], ...] = (
    ("status/", ("docs/STATUS.md",)),
    ("how-it-works/", ("docs/HOW_IT_WORKS.md",)),
    ("architecture/", ("docs/architecture.md",)),
    ("source/", ("docs/SOURCE.md",)),
    ("test-lab/", ("docs/TEST_LAB.md", "test-lab.json")),
    ("engineering/", ("docs/ENGINEERING_GUIDE.md", "quality-gates.json")),
    ("documentation/", ("docs/DOCUMENTATION_GUIDE.md",)),
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
            "docs/HOW_IT_WORKS.md",
            "CODEMAP.md",
            "docs/architecture.md",
            "CHANGELOG.md",
            "unity-package/com.eunsung.teamforge/CHANGELOG.md",
            "docs/ROADMAP.md",
            "docs/SOURCE.md",
            "docs/ENGINEERING_GUIDE.md",
            "docs/DOCUMENTATION_GUIDE.md",
            "docs/TEST_LAB.md",
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
    ("how-it-works.txt", ("docs/HOW_IT_WORKS.md",)),
    ("changelog.txt", ("CHANGELOG.md", "unity-package/com.eunsung.teamforge/CHANGELOG.md")),
    ("codemap.txt", ("CODEMAP.md",)),
    ("source.txt", ("docs/SOURCE.md",)),
    ("test-lab.txt", ("docs/TEST_LAB.md", "test-lab.json")),
    ("engineering-guide.txt", ("docs/ENGINEERING_GUIDE.md", "quality-gates.json")),
    ("documentation-guide.txt", ("docs/DOCUMENTATION_GUIDE.md",)),
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
    ("how-it-works.ko.txt", ("docs/HOW_IT_WORKS.ko.md",)),
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


def load_registry(repo_root: Path) -> dict[str, object]:
    registry_file = repo_root / REGISTRY_PATH
    if not registry_file.is_file():
        raise RuntimeError(f"missing locale registry for sitemap: {REGISTRY_PATH}")
    registry = json.loads(registry_file.read_text(encoding="utf-8"))
    if registry.get("schemaVersion") != 1:
        raise RuntimeError("unsupported locale registry schema for sitemap")
    raw_locales = registry.get("locales")
    if not isinstance(raw_locales, list) or not raw_locales:
        raise RuntimeError("locale registry has no locales for sitemap")
    return registry


def published_indexable_locales(registry: dict[str, object]) -> list[dict[str, object]]:
    values: list[dict[str, object]] = []
    for locale in registry["locales"]:
        if not isinstance(locale, dict):
            raise RuntimeError("locale registry entries must be objects")
        if not locale.get("publish", True) or not locale.get("indexable", True):
            continue
        values.append(locale)
    return values


def homepage_entries(
    registry: dict[str, object],
) -> tuple[tuple[str, tuple[str, ...]], ...]:
    entries: list[tuple[str, tuple[str, ...]]] = []
    for locale in published_indexable_locales(registry):
        relative = str(locale.get("path") or "")
        sources = list(COMMON_HOMEPAGE_SOURCES)
        manifest = str(locale.get("homepageManifest") or "")
        if manifest:
            sources.append(manifest)
            sources.append("site/editor-demo-localize.js")
        entries.append((relative, tuple(dict.fromkeys(sources))))
    return tuple(entries)


def localized_document_entries(
    registry: dict[str, object],
) -> tuple[tuple[str, tuple[str, ...]], ...]:
    """Discover real, indexable localized document routes from the locale registry."""
    default_code = str(registry.get("defaultLocale") or "")
    entries: list[tuple[str, tuple[str, ...]]] = []
    for locale in published_indexable_locales(registry):
        if str(locale.get("code") or "") == default_code:
            continue
        documents = locale.get("documents") or {}
        if not isinstance(documents, dict):
            raise RuntimeError(f"locale {locale.get('code')} documents must be an object")
        for route, spec in documents.items():
            if not isinstance(route, str) or not route.endswith("/") or route.startswith("/"):
                raise RuntimeError(f"locale {locale.get('code')} has invalid document route: {route!r}")
            if not isinstance(spec, dict):
                raise RuntimeError(f"locale {locale.get('code')} document {route} must be an object")
            path = str(spec.get("path") or "")
            repo_source = str(spec.get("repoSource") or "")
            source_repo_source = str(spec.get("sourceRepoSource") or "")
            if not path or path.startswith("/") or not path.endswith("/"):
                raise RuntimeError(
                    f"locale {locale.get('code')} document {route} has invalid path: {path!r}"
                )
            if not repo_source:
                raise RuntimeError(
                    f"locale {locale.get('code')} document {route} is missing repoSource"
                )
            sources = [repo_source]
            # The generated page can change when its canonical English source moves
            # ahead because the renderer emits translation-freshness state/notices.
            if source_repo_source:
                sources.append(source_repo_source)
            entries.append((path, tuple(dict.fromkeys(sources))))
    return tuple(entries)


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
    registry = load_registry(repo_root)
    reviewed = verify_localized_doc_revisions(repo_root, registry)
    entries = (
        homepage_entries(registry)
        + localized_document_entries(registry)
        + STATIC_ENTRIES
    )

    seen: set[str] = set()
    ET.register_namespace("", NS)
    urlset = ET.Element(ET.QName(NS, "urlset"))

    for relative, sources in entries:
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

    print(
        f"Generated sitemap.xml with {len(entries)} source-aware URLs; "
        f"verified {reviewed} localized document review pin(s)."
    )


if __name__ == "__main__":
    main()

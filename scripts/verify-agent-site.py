#!/usr/bin/env python3
"""Fail CI when TeamForge agent/search discovery outputs drift or link to missing files."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import xml.etree.ElementTree as ET
from datetime import date
from pathlib import Path
from urllib.parse import urlparse

BASE_URL = "https://eun-si123.github.io/teamforge-unity-collab/"
SOCIAL_IMAGE_URL = BASE_URL + "assets/teamforge-social-preview.jpg"
SITEMAP_NS = "http://www.sitemaps.org/schemas/sitemap/0.9"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("repo_root", type=Path)
    parser.add_argument("site_root", type=Path)
    return parser.parse_args()


def local_target(site_root: Path, url: str) -> Path | None:
    if not url.startswith(BASE_URL):
        return None
    relative = url[len(BASE_URL):].split("#", 1)[0].split("?", 1)[0]
    if not relative:
        relative = "index.html"
    elif relative.endswith("/"):
        relative += "index.html"
    return site_root / relative


def require_url(site_root: Path, url: str, source: str) -> None:
    target = local_target(site_root, url)
    if target is None:
        return
    if not target.is_file() or target.stat().st_size == 0:
        raise SystemExit(f"{source} references missing/empty generated target: {url}")


def flatten_urls(value: object) -> list[str]:
    urls: list[str] = []
    if isinstance(value, str) and value.startswith(("http://", "https://")):
        urls.append(value)
    elif isinstance(value, dict):
        for child in value.values():
            urls.extend(flatten_urls(child))
    elif isinstance(value, list):
        for child in value:
            urls.extend(flatten_urls(child))
    return urls


def git_paths(repo_root: Path) -> list[str]:
    proc = subprocess.run(
        ["git", "ls-files", "-z"],
        cwd=repo_root,
        check=True,
        stdout=subprocess.PIPE,
    )
    return sorted(p.decode("utf-8") for p in proc.stdout.split(b"\0") if p)


def verify_html_links(site_root: Path, relative: str) -> None:
    html_text = (site_root / relative).read_text(encoding="utf-8")
    if "<main" not in html_text or 'name="robots" content="index,follow' not in html_text:
        raise SystemExit(f"generated HTML page is missing expected semantic/search markup: {relative}")
    for url in re.findall(r'(?:href|src)="(https?://[^"]+)"', html_text):
        require_url(site_root, url, relative)


def verify_homepage_search_copy(site_root: Path, project: dict[str, object]) -> None:
    homepage = (site_root / "index.html").read_text(encoding="utf-8")
    expected_title = "<title>TeamForge — Open-source real-time collaboration for the Unity Editor</title>"
    expected_h1 = (
        '<h1><span class="gradient">Real-time collaboration</span><br>'
        'for the Unity Editor.</h1>'
    )
    expected_slogan = "<strong>Build together. Stay in sync.</strong>"
    social_alt = "TeamForge — open-source real-time collaboration for the Unity Editor"
    social_tags = (
        f'<meta property="og:image" content="{SOCIAL_IMAGE_URL}">',
        '<meta property="og:image:type" content="image/jpeg">',
        '<meta property="og:image:width" content="640">',
        '<meta property="og:image:height" content="320">',
        f'<meta property="og:image:alt" content="{social_alt}">',
        f'<meta name="twitter:image" content="{SOCIAL_IMAGE_URL}">',
        f'<meta name="twitter:image:alt" content="{social_alt}">',
    )

    if expected_title not in homepage:
        raise SystemExit("homepage title no longer states the primary Unity collaboration topic")
    if homepage.count("<h1") != 1 or expected_h1 not in homepage:
        raise SystemExit("homepage must have one search-intent H1 for real-time Unity Editor collaboration")
    if expected_slogan not in homepage:
        raise SystemExit("homepage lost the Build together / Stay in sync slogan")
    for tag in social_tags:
        if tag not in homepage:
            raise SystemExit(f"homepage is missing social preview metadata: {tag}")
    if 'property="og:image" content="https://raw.githubusercontent.com/' in homepage:
        raise SystemExit("homepage og:image must use the deployed static social preview, not a raw GitHub demo")
    require_url(site_root, SOCIAL_IMAGE_URL, "homepage social preview")

    for relative in (
        "status/",
        "how-it-works/",
        "architecture/",
        "source/",
        "test-lab/",
        "changelog/",
        "security/",
    ):
        if f'href="{BASE_URL}{relative}"' not in homepage:
            raise SystemExit(f"homepage is missing crawlable HTML documentation link: {relative}")

    release_id = str(project.get("releaseId") or "")
    release_state = str(project.get("releaseState") or "")
    if not release_id or release_id not in homepage:
        raise SystemExit("homepage does not expose the current release ID as visible text")
    if not release_state or release_state not in homepage:
        raise SystemExit("homepage does not expose the current release-candidate state as visible text")
    if f'href="{BASE_URL}release-contract.json"' not in homepage:
        raise SystemExit("homepage is missing the current release-contract.json link")
    if "TeamForge release ID" not in homepage or "Release candidate state" not in homepage:
        raise SystemExit("homepage JSON-LD is missing release identity properties")


def verify_sitemap(site_root: Path) -> int:
    sitemap_path = site_root / "sitemap.xml"
    root = ET.parse(sitemap_path).getroot()
    expected_root = f"{{{SITEMAP_NS}}}urlset"
    if root.tag != expected_root:
        raise SystemExit(f"sitemap.xml has unexpected root element: {root.tag}")

    priority_tag = f"{{{SITEMAP_NS}}}priority"
    if root.findall(f".//{priority_tag}"):
        raise SystemExit("sitemap.xml must not emit ignored <priority> metadata")

    loc_tag = f"{{{SITEMAP_NS}}}loc"
    lastmod_tag = f"{{{SITEMAP_NS}}}lastmod"
    urls: dict[str, str] = {}
    for item in root.findall(f"{{{SITEMAP_NS}}}url"):
        loc = (item.findtext(loc_tag) or "").strip()
        lastmod = (item.findtext(lastmod_tag) or "").strip()
        if not loc.startswith(BASE_URL):
            raise SystemExit(f"sitemap.xml contains an out-of-scope URL: {loc}")
        if loc in urls:
            raise SystemExit(f"sitemap.xml contains a duplicate URL: {loc}")
        try:
            date.fromisoformat(lastmod)
        except ValueError as exc:
            raise SystemExit(f"sitemap.xml has invalid lastmod for {loc}: {lastmod}") from exc
        require_url(site_root, loc, "sitemap.xml")
        urls[loc] = lastmod

    required_urls = {
        BASE_URL + "status/",
        BASE_URL + "how-it-works/",
        BASE_URL + "architecture/",
        BASE_URL + "source/",
        BASE_URL + "test-lab/",
        BASE_URL + "engineering/",
        BASE_URL + "documentation/",
        BASE_URL + "changelog/",
        BASE_URL + "security/",
        BASE_URL + "release-contract.json",
    }
    missing_urls = sorted(required_urls - urls.keys())
    if missing_urls:
        raise SystemExit(f"sitemap.xml is missing required current resources: {missing_urls}")

    same_source_pairs = (
        ("status/", "status.txt"),
        ("how-it-works/", "how-it-works.txt"),
        ("architecture/", "architecture-overview.txt"),
        ("source/", "source.txt"),
        ("test-lab/", "test-lab.txt"),
        ("engineering/", "engineering-guide.txt"),
        ("documentation/", "documentation-guide.txt"),
        ("changelog/", "changelog.txt"),
        ("security/", "security.txt"),
    )
    for html_path, text_path in same_source_pairs:
        html_url = BASE_URL + html_path
        text_url = BASE_URL + text_path
        if urls.get(html_url) != urls.get(text_url):
            raise SystemExit(
                f"sitemap lastmod drift for shared canonical source: {html_path} vs {text_path}"
            )

    return len(urls)


def verify_release_identity(
    repo_root: Path,
    site_root: Path,
    project: dict[str, object],
) -> None:
    repository_release = json.loads((repo_root / "release-contract.json").read_text(encoding="utf-8"))
    deployed_release = json.loads((site_root / "release-contract.json").read_text(encoding="utf-8"))
    if deployed_release != repository_release:
        raise SystemExit("deployed release-contract.json differs from the source-controlled release contract")

    expected_fields = {
        "version": repository_release.get("productVersion"),
        "releaseId": repository_release.get("releaseId"),
        "workPackage": repository_release.get("workPackage"),
        "releaseState": repository_release.get("status"),
        "target": repository_release.get("target"),
        "protocols": repository_release.get("protocols"),
        "testedUnityEditor": (repository_release.get("unity") or {}).get("testedEditor"),
        "bundledNodeVersion": (repository_release.get("node") or {}).get("version"),
    }
    for key, expected in expected_fields.items():
        if project.get(key) != expected:
            raise SystemExit(
                f"project.json release identity drift for {key}: expected {expected!r}, got {project.get(key)!r}"
            )

    if project.get("schemaVersion") != 6:
        raise SystemExit("project.json schemaVersion must remain 6; additive documentation routes do not require a schema break")

    documentation = project.get("documentation")
    if not isinstance(documentation, dict):
        raise SystemExit("project.json documentation must be an object")
    if documentation.get("releaseContract") != BASE_URL + "release-contract.json":
        raise SystemExit("project.json does not expose the canonical Pages release-contract URL")
    required_doc_routes = {
        "howItWorks": "how-it-works.txt",
        "engineeringGuide": "engineering-guide.txt",
        "documentationGuide": "documentation-guide.txt",
        "testLab": "test-lab.txt",
        "howItWorksHtml": "how-it-works/",
        "engineeringGuideHtml": "engineering/",
        "documentationGuideHtml": "documentation/",
        "testLabHtml": "test-lab/",
    }
    for key, suffix in required_doc_routes.items():
        expected = BASE_URL + suffix
        if documentation.get(key) != expected:
            raise SystemExit(
                f"project.json documentation route drift for {key}: expected {expected!r}, got {documentation.get(key)!r}"
            )


def main() -> None:
    args = parse_args()
    repo_root = args.repo_root.resolve()
    site_root = args.site_root.resolve()

    html_docs = [
        "status/index.html",
        "how-it-works/index.html",
        "architecture/index.html",
        "source/index.html",
        "test-lab/index.html",
        "engineering/index.html",
        "documentation/index.html",
        "changelog/index.html",
        "security/index.html",
    ]
    required = [
        "index.html",
        "assets/teamforge-social-preview.jpg",
        "llms.txt",
        "llms-full.txt",
        "project.json",
        "release-contract.json",
        "repository-manifest.json",
        "sitemap.xml",
        "sitemap.md",
        "readme.txt",
        "readme.ko.txt",
        "status.txt",
        "status.ko.txt",
        "how-it-works.txt",
        "how-it-works.ko.txt",
        "codemap.txt",
        "source.txt",
        "test-lab.txt",
        "engineering-guide.txt",
        "documentation-guide.txt",
        "changelog.txt",
        "security.txt",
        "ai-discovery.txt",
        "comment-audit.txt",
        "modules/unity-package.txt",
        "modules/server.txt",
        "modules/project-peer.txt",
        "modules/launcher.txt",
        *html_docs,
    ]
    for relative in required:
        target = site_root / relative
        if not target.is_file() or target.stat().st_size == 0:
            raise SystemExit(f"required generated output missing/empty: {relative}")

    project = json.loads((site_root / "project.json").read_text(encoding="utf-8"))
    manifest = json.loads((site_root / "repository-manifest.json").read_text(encoding="utf-8"))
    verify_release_identity(repo_root, site_root, project)

    if project.get("sourceCommit") != manifest.get("sourceCommit"):
        raise SystemExit("project.json and repository-manifest.json sourceCommit disagree")

    tracked = git_paths(repo_root)
    manifest_paths = [entry.get("path") for entry in manifest.get("files", [])]
    if len(manifest_paths) != len(set(manifest_paths)):
        raise SystemExit("repository-manifest.json contains duplicate paths")
    if manifest_paths != tracked:
        missing = sorted(set(tracked) - set(manifest_paths))[:10]
        extra = sorted(set(manifest_paths) - set(tracked))[:10]
        raise SystemExit(f"repository manifest drift: missing={missing} extra={extra}")
    if manifest.get("fileCount") != len(tracked):
        raise SystemExit("repository-manifest.json fileCount is incorrect")

    for url in flatten_urls(project.get("documentation", {})):
        require_url(site_root, url, "project.json documentation")
    for url in flatten_urls(project.get("localizedDocumentation", {})):
        require_url(site_root, url, "project.json localizedDocumentation")
    for url in flatten_urls(project.get("modules", {})):
        require_url(site_root, url, "project.json modules")

    sitemap_md = (site_root / "sitemap.md").read_text(encoding="utf-8")
    for url in re.findall(r"\]\((https?://[^)]+)\)", sitemap_md):
        require_url(site_root, url, "sitemap.md")
    for value in (
        str(project.get("version") or ""),
        str(project.get("releaseId") or ""),
        str(project.get("releaseState") or ""),
    ):
        if not value or value not in sitemap_md:
            raise SystemExit(f"sitemap.md is missing current project/release identity value: {value!r}")
    for label in ("How it works", "Test Lab", "Engineering guide", "Documentation guide"):
        if label not in sitemap_md:
            raise SystemExit(f"sitemap.md is missing propagated current documentation route: {label}")

    verify_html_links(site_root, "index.html")
    verify_homepage_search_copy(site_root, project)
    for relative in html_docs:
        verify_html_links(site_root, relative)

    sitemap_url_count = verify_sitemap(site_root)

    llms = (site_root / "llms.txt").read_text(encoding="utf-8")
    for needle in (
        "repository-manifest.json",
        "project.json",
        "release-contract.json",
        "sitemap.md",
        "CODEMAP.md",
        "docs/SOURCE.md",
        "docs/HOW_IT_WORKS.md",
        "docs/ENGINEERING_GUIDE.md",
        "docs/DOCUMENTATION_GUIDE.md",
        "docs/TEST_LAB.md",
    ):
        if needle not in llms:
            raise SystemExit(f"llms.txt is missing required discovery reference: {needle}")

    parsed = urlparse(BASE_URL)
    if parsed.path == "/":
        raise SystemExit("expected a project-site base path for this verifier")

    print(
        f"Verified agent site: {len(required)} required outputs, "
        f"{len(tracked)} tracked repository files, {sitemap_url_count} sitemap URLs, "
        "release identity, propagated canonical docs, generated HTML docs, homepage search copy, "
        "social preview metadata, and internal links."
    )


if __name__ == "__main__":
    main()

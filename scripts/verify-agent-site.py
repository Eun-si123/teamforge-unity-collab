#!/usr/bin/env python3
"""Fail CI when TeamForge agent/search discovery outputs drift or link to missing files."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from pathlib import Path
from urllib.parse import urlparse

BASE_URL = "https://eun-si123.github.io/teamforge-unity-collab/"


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


def main() -> None:
    args = parse_args()
    repo_root = args.repo_root.resolve()
    site_root = args.site_root.resolve()

    html_docs = [
        "status/index.html",
        "architecture/index.html",
        "source/index.html",
        "changelog/index.html",
        "security/index.html",
    ]
    required = [
        "index.html",
        "llms.txt",
        "llms-full.txt",
        "project.json",
        "repository-manifest.json",
        "sitemap.xml",
        "sitemap.md",
        "readme.txt",
        "status.txt",
        "codemap.txt",
        "source.txt",
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

    verify_html_links(site_root, "index.html")
    for relative in html_docs:
        verify_html_links(site_root, relative)

    llms = (site_root / "llms.txt").read_text(encoding="utf-8")
    for needle in (
        "repository-manifest.json",
        "project.json",
        "sitemap.md",
        "CODEMAP.md",
        "docs/SOURCE.md",
    ):
        if needle not in llms:
            raise SystemExit(f"llms.txt is missing required discovery reference: {needle}")

    parsed = urlparse(BASE_URL)
    if parsed.path == "/":
        raise SystemExit("expected a project-site base path for this verifier")

    print(
        f"Verified agent site: {len(required)} required outputs, "
        f"{len(tracked)} tracked repository files, generated HTML docs, and internal links."
    )


if __name__ == "__main__":
    main()

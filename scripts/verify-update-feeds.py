#!/usr/bin/env python3
"""Verify generated TeamForge RSS/Atom feeds against canonical Git history."""

from __future__ import annotations

import argparse
import importlib.util
import subprocess
import xml.etree.ElementTree as ET
from datetime import datetime
from email.utils import parsedate_to_datetime
from pathlib import Path


def load_feed_builder():
    builder_path = Path(__file__).with_name("build-update-feeds.py")
    spec = importlib.util.spec_from_file_location("teamforge_build_update_feeds", builder_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"could not load update-feed builder: {builder_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_builder = load_feed_builder()
ATOM_NS = _builder.ATOM_NS
ATOM_URL = _builder.ATOM_URL
BASE_URL = _builder.BASE_URL
FEED_SOURCE_PATHS = _builder.FEED_SOURCE_PATHS
MAX_ENTRIES = _builder.MAX_ENTRIES
RSS_URL = _builder.RSS_URL


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


def expected_commits(repo_root: Path) -> list[str]:
    output = git_output(
        repo_root,
        "log",
        "--first-parent",
        f"--max-count={MAX_ENTRIES}",
        "--format=%H",
        "--",
        *FEED_SOURCE_PATHS,
    )
    commits = [line.strip() for line in output.splitlines() if line.strip()]
    if not commits:
        raise SystemExit("no canonical update-feed commits found in Git history")
    return commits


def atom_entries(site_root: Path) -> tuple[list[str], list[datetime]]:
    root = ET.parse(site_root / "feed.atom").getroot()
    ns = {"atom": ATOM_NS}
    if root.tag != f"{{{ATOM_NS}}}feed":
        raise SystemExit(f"feed.atom has unexpected root: {root.tag}")

    self_links = [
        node.attrib.get("href")
        for node in root.findall("atom:link", ns)
        if node.attrib.get("rel") == "self"
    ]
    if self_links != [ATOM_URL]:
        raise SystemExit(f"feed.atom self link mismatch: {self_links}")

    alternate_links = [
        node.attrib.get("href")
        for node in root.findall("atom:link", ns)
        if node.attrib.get("rel") == "alternate"
    ]
    if BASE_URL not in alternate_links:
        raise SystemExit("feed.atom does not expose the TeamForge website as alternate")

    commits: list[str] = []
    dates: list[datetime] = []
    for entry in root.findall("atom:entry", ns):
        url = (entry.findtext("atom:id", default="", namespaces=ns) or "").strip()
        prefix = "https://github.com/Eun-si123/teamforge-unity-collab/commit/"
        if not url.startswith(prefix):
            raise SystemExit(f"feed.atom entry id is not a canonical commit URL: {url}")
        commit = url[len(prefix):]
        if len(commit) != 40:
            raise SystemExit(f"feed.atom entry has invalid commit SHA: {commit}")
        title = (entry.findtext("atom:title", default="", namespaces=ns) or "").strip()
        summary = (entry.findtext("atom:summary", default="", namespaces=ns) or "").strip()
        updated = (entry.findtext("atom:updated", default="", namespaces=ns) or "").strip()
        if not title or not summary or not updated:
            raise SystemExit(f"feed.atom entry is incomplete for {commit}")
        parsed = datetime.fromisoformat(updated)
        if parsed.tzinfo is None:
            raise SystemExit(f"feed.atom entry timestamp lacks timezone: {updated}")
        commits.append(commit)
        dates.append(parsed)

    return commits, dates


def rss_entries(site_root: Path) -> tuple[list[str], list[datetime]]:
    root = ET.parse(site_root / "feed.xml").getroot()
    if root.tag != "rss" or root.attrib.get("version") != "2.0":
        raise SystemExit("feed.xml must be an RSS 2.0 document")
    channel = root.find("channel")
    if channel is None:
        raise SystemExit("feed.xml is missing channel")

    atom_self = channel.find(f"{{{ATOM_NS}}}link")
    if (
        atom_self is None
        or atom_self.attrib.get("href") != RSS_URL
        or atom_self.attrib.get("rel") != "self"
        or atom_self.attrib.get("type") != "application/rss+xml"
    ):
        raise SystemExit("feed.xml is missing its canonical atom:self link")

    if (channel.findtext("link") or "").strip() != BASE_URL:
        raise SystemExit("feed.xml channel link must point to the TeamForge website")

    commits: list[str] = []
    dates: list[datetime] = []
    prefix = "https://github.com/Eun-si123/teamforge-unity-collab/commit/"
    for item in channel.findall("item"):
        link = (item.findtext("link") or "").strip()
        guid = (item.findtext("guid") or "").strip()
        title = (item.findtext("title") or "").strip()
        description = (item.findtext("description") or "").strip()
        pub_date = (item.findtext("pubDate") or "").strip()
        if not link.startswith(prefix) or guid != link:
            raise SystemExit(f"feed.xml item does not use one canonical commit URL: {link} / {guid}")
        commit = link[len(prefix):]
        if len(commit) != 40:
            raise SystemExit(f"feed.xml item has invalid commit SHA: {commit}")
        if not title or not description or not pub_date:
            raise SystemExit(f"feed.xml item is incomplete for {commit}")
        parsed = parsedate_to_datetime(pub_date)
        if parsed.tzinfo is None:
            raise SystemExit(f"feed.xml item timestamp lacks timezone: {pub_date}")
        commits.append(commit)
        dates.append(parsed)

    return commits, dates


def assert_descending(values: list[datetime], label: str) -> None:
    if not values:
        raise SystemExit(f"{label} contains no entries")
    if len(values) > MAX_ENTRIES:
        raise SystemExit(f"{label} contains more than {MAX_ENTRIES} entries")
    if values != sorted(values, reverse=True):
        raise SystemExit(f"{label} entries are not newest-first")


def main() -> None:
    args = parse_args()
    repo_root = args.repo_root.resolve()
    site_root = args.site_root.resolve()

    for relative in ("feed.atom", "feed.xml"):
        target = site_root / relative
        if not target.is_file() or target.stat().st_size == 0:
            raise SystemExit(f"required generated update feed missing/empty: {relative}")

    expected = expected_commits(repo_root)
    atom_commits, atom_dates = atom_entries(site_root)
    rss_commits, rss_dates = rss_entries(site_root)

    assert_descending(atom_dates, "feed.atom")
    assert_descending(rss_dates, "feed.xml")

    if atom_commits != expected:
        raise SystemExit(
            f"feed.atom Git-history drift: expected {expected[:3]}..., got {atom_commits[:3]}..."
        )
    if rss_commits != expected:
        raise SystemExit(
            f"feed.xml Git-history drift: expected {expected[:3]}..., got {rss_commits[:3]}..."
        )
    if atom_commits != rss_commits:
        raise SystemExit("RSS and Atom feeds do not expose the same update entries")

    # Compare timestamps by instant; RSS uses RFC 2822 while Atom uses RFC 3339.
    for atom_date, rss_date in zip(atom_dates, rss_dates, strict=True):
        if atom_date.timestamp() != rss_date.timestamp():
            raise SystemExit("RSS and Atom timestamps disagree for the same update entry")

    print(
        f"Verified TeamForge update feeds: {len(expected)} entries, newest {expected[0][:12]}, "
        "RSS/Atom parity and canonical Git-history freshness."
    )


if __name__ == "__main__":
    main()

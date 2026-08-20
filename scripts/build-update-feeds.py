#!/usr/bin/env python3
"""Generate TeamForge RSS 2.0 and Atom 1.0 feeds from canonical Git history.

The feeds are discovery/freshness outputs, not a second hand-maintained changelog.
Only commits that touch current project/release/discovery documents are included.
"""

from __future__ import annotations

import argparse
import subprocess
import xml.etree.ElementTree as ET
from datetime import datetime
from email.utils import format_datetime
from pathlib import Path

BASE_URL = "https://eun-si123.github.io/teamforge-unity-collab/"
REPOSITORY_URL = "https://github.com/Eun-si123/teamforge-unity-collab"
ATOM_URL = BASE_URL + "feed.atom"
RSS_URL = BASE_URL + "feed.xml"
MAX_ENTRIES = 20

# Keep this set small and current-facing. Historical phase/work-state notes are
# intentionally excluded so an old evidence update cannot look like current
# release state merely because it appeared recently in Git history.
FEED_SOURCE_PATHS: tuple[str, ...] = (
    "README.md",
    "README.ko.md",
    "CHANGELOG.md",
    "release-contract.json",
    "docs/STATUS.md",
    "docs/STATUS.ko.md",
    "docs/known-issues.md",
    "docs/ROADMAP.md",
    "docs/ROADMAP.ko.md",
    "docs/architecture.md",
    "docs/AI_DISCOVERY.md",
    ".github/SECURITY.md",
    "unity-package/com.eunsung.teamforge/CHANGELOG.md",
)

ATOM_NS = "http://www.w3.org/2005/Atom"


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


def relevant_commits(repo_root: Path) -> list[str]:
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
        raise RuntimeError(
            "no update-feed commits were found; Pages checkout must include repository history"
        )
    return commits


def changed_feed_paths(repo_root: Path, commit: str) -> list[str]:
    lineage = git_output(repo_root, "rev-list", "--parents", "-n", "1", commit).split()
    if not lineage or lineage[0] != commit:
        raise RuntimeError(f"could not resolve commit lineage for {commit}")

    if len(lineage) >= 2:
        output = git_output(
            repo_root,
            "diff",
            "--name-only",
            lineage[1],
            commit,
            "--",
            *FEED_SOURCE_PATHS,
        )
    else:
        output = git_output(
            repo_root,
            "show",
            "--pretty=format:",
            "--name-only",
            commit,
            "--",
            *FEED_SOURCE_PATHS,
        )

    changed = sorted({line.strip() for line in output.splitlines() if line.strip()})
    if not changed:
        # git log selected this commit because at least one feed source changed.
        # Treat disagreement as a build error instead of emitting misleading feed data.
        raise RuntimeError(f"feed commit {commit} has no resolvable relevant changed paths")
    return changed


def commit_record(repo_root: Path, commit: str) -> dict[str, object]:
    subject = git_output(repo_root, "show", "-s", "--format=%s", commit)
    timestamp = git_output(repo_root, "show", "-s", "--format=%cI", commit)
    parsed = datetime.fromisoformat(timestamp)
    if parsed.tzinfo is None:
        raise RuntimeError(f"commit timestamp lacks timezone: {commit} {timestamp}")
    paths = changed_feed_paths(repo_root, commit)
    return {
        "sha": commit,
        "subject": subject or commit[:12],
        "timestamp": timestamp,
        "datetime": parsed,
        "paths": paths,
        "url": f"{REPOSITORY_URL}/commit/{commit}",
    }


def summary_text(record: dict[str, object]) -> str:
    paths = [str(item) for item in record["paths"]]
    return "Canonical TeamForge update. Relevant files: " + ", ".join(paths)


def indent_and_write(root: ET.Element, destination: Path) -> None:
    tree = ET.ElementTree(root)
    ET.indent(tree, space="  ")
    tree.write(destination, encoding="utf-8", xml_declaration=True)
    if not destination.is_file() or destination.stat().st_size == 0:
        raise RuntimeError(f"failed to generate non-empty feed: {destination}")


def build_atom(records: list[dict[str, object]], site_root: Path) -> None:
    ET.register_namespace("", ATOM_NS)
    feed = ET.Element(ET.QName(ATOM_NS, "feed"))
    ET.SubElement(feed, ET.QName(ATOM_NS, "id")).text = ATOM_URL
    ET.SubElement(feed, ET.QName(ATOM_NS, "title")).text = "TeamForge project updates"
    ET.SubElement(feed, ET.QName(ATOM_NS, "subtitle")).text = (
        "Current release, status, roadmap, security, and discovery changes for TeamForge."
    )
    ET.SubElement(
        feed,
        ET.QName(ATOM_NS, "link"),
        {"rel": "self", "type": "application/atom+xml", "href": ATOM_URL},
    )
    ET.SubElement(
        feed,
        ET.QName(ATOM_NS, "link"),
        {"rel": "alternate", "type": "text/html", "href": BASE_URL},
    )
    ET.SubElement(feed, ET.QName(ATOM_NS, "updated")).text = str(records[0]["timestamp"])
    author = ET.SubElement(feed, ET.QName(ATOM_NS, "author"))
    ET.SubElement(author, ET.QName(ATOM_NS, "name")).text = "TeamForge contributors"
    ET.SubElement(feed, ET.QName(ATOM_NS, "generator")).text = "TeamForge Pages"

    for record in records:
        entry = ET.SubElement(feed, ET.QName(ATOM_NS, "entry"))
        ET.SubElement(entry, ET.QName(ATOM_NS, "id")).text = str(record["url"])
        ET.SubElement(entry, ET.QName(ATOM_NS, "title")).text = str(record["subject"])
        ET.SubElement(entry, ET.QName(ATOM_NS, "updated")).text = str(record["timestamp"])
        ET.SubElement(
            entry,
            ET.QName(ATOM_NS, "link"),
            {"rel": "alternate", "type": "text/html", "href": str(record["url"])},
        )
        ET.SubElement(entry, ET.QName(ATOM_NS, "summary"), {"type": "text"}).text = summary_text(record)

    indent_and_write(feed, site_root / "feed.atom")


def build_rss(records: list[dict[str, object]], site_root: Path) -> None:
    ET.register_namespace("atom", ATOM_NS)
    rss = ET.Element("rss", {"version": "2.0"})
    channel = ET.SubElement(rss, "channel")
    ET.SubElement(channel, "title").text = "TeamForge project updates"
    ET.SubElement(channel, "link").text = BASE_URL
    ET.SubElement(channel, "description").text = (
        "Current release, status, roadmap, security, and discovery changes for TeamForge."
    )
    ET.SubElement(channel, "language").text = "en"
    ET.SubElement(channel, "lastBuildDate").text = format_datetime(record_datetime(records[0]))
    ET.SubElement(
        channel,
        ET.QName(ATOM_NS, "link"),
        {"href": RSS_URL, "rel": "self", "type": "application/rss+xml"},
    )

    for record in records:
        item = ET.SubElement(channel, "item")
        ET.SubElement(item, "title").text = str(record["subject"])
        ET.SubElement(item, "link").text = str(record["url"])
        ET.SubElement(item, "guid", {"isPermaLink": "true"}).text = str(record["url"])
        ET.SubElement(item, "pubDate").text = format_datetime(record_datetime(record))
        ET.SubElement(item, "description").text = summary_text(record)

    indent_and_write(rss, site_root / "feed.xml")


def record_datetime(record: dict[str, object]) -> datetime:
    value = record.get("datetime")
    if not isinstance(value, datetime) or value.tzinfo is None:
        raise RuntimeError("feed record has no timezone-aware datetime")
    return value


def main() -> None:
    args = parse_args()
    repo_root = args.repo_root.resolve()
    site_root = args.site_root.resolve()
    if not (repo_root / ".git").exists():
        raise SystemExit("update-feed generation requires a Git checkout with history")
    if not site_root.is_dir():
        raise SystemExit("site output directory does not exist")

    missing = [path for path in FEED_SOURCE_PATHS if not (repo_root / path).exists()]
    if missing:
        raise SystemExit(f"update-feed canonical source paths are missing: {missing}")

    records = [commit_record(repo_root, commit) for commit in relevant_commits(repo_root)]
    build_atom(records, site_root)
    build_rss(records, site_root)
    print(f"Generated Atom and RSS feeds with {len(records)} canonical update entries.")


if __name__ == "__main__":
    main()

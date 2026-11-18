#!/usr/bin/env python3
"""Read-only Git delta since the last edit of STATUS. Not runtime or field verification."""
import argparse
import json
import os
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
AREAS = {
    "server": ("server/",),
    "project-peer": ("project-peer/",),
    "launcher": ("launcher/",),
    "unity-package": ("unity-package/",),
    "release-contract": ("release-contract.json", "builds/published-candidate.json"),
}
PATHS = tuple(path for values in AREAS.values() for path in values)


def git(root: Path, *args: str) -> str:
    result = subprocess.run(["git", *args], cwd=root, text=True, capture_output=True, timeout=15, check=True)
    return result.stdout.strip()


def report(root: Path) -> dict:
    try:
        status_line = git(root, "log", "-1", "--format=%H%x09%cI", "--", "docs/STATUS.md")
    except subprocess.CalledProcessError as e:
        raise ValueError("No tracked docs/STATUS.md revision; source freshness is unknown.") from e
    match = re.fullmatch(r"([0-9a-f]{40})\t([^\s]+)", status_line)
    if not match:
        raise ValueError("No tracked docs/STATUS.md revision; source freshness is unknown.")
    status_commit, edited_at = match.groups()
    head = git(root, "rev-parse", "HEAD")
    git(root, "merge-base", "--is-ancestor", status_commit, head)
    changed = git(root, "diff", "--name-only", status_commit, head, "--", *PATHS)
    files = changed.splitlines() if changed else []
    by_area = {
        area: sum(any(f == path or f.startswith(path) for path in paths) for f in files)
        for area, paths in AREAS.items()
    }
    commits = int(git(root, "rev-list", "--count", status_commit + ".." + head, "--", *PATHS))
    return {
        "head": head,
        "statusCommit": status_commit,
        "statusEditedAt": edited_at,
        "sourceCommits": commits,
        "changedFiles": len(files),
        "byArea": by_area,
        "state": "SOURCE_ADVANCED" if commits else "NO_TRACKED_SOURCE_COMMITS",
    }


def markdown(data: dict) -> str:
    area_text = " / ".join(name + ": " + str(n) for name, n in data["byArea"].items())
    note = (
        "Inspect current source, tests, PRs and CI before claiming new functionality. "
        "Dated release and physical two-PC evidence never advance automatically."
        if data["sourceCommits"]
        else "No tracked source commits followed this STATUS edit. "
             "This does not verify runtime behavior, release readiness or physical tests."
    )
    return "\n".join([
        "## TeamForge source changes since the last STATUS edit",
        "",
        "- Checkout HEAD: " + data["head"],
        "- Last STATUS edit: " + data["statusCommit"] + " (" + data["statusEditedAt"] + ")",
        "- Source commits since STATUS edit: **" + str(data["sourceCommits"]) + "**",
        "- Changed tracked paths (net): **" + str(data["changedFiles"]) + "**",
        "- Areas: " + area_text,
        "- Classification: **" + data["state"] + "**",
        "",
        note,
        "",
        "Read-only Git history signal, NOT Unity/Windows/field validation and NOT automatic document approval.",
        "",
    ])


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", type=Path, default=ROOT)
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--summary", action="store_true")
    args = parser.parse_args()
    try:
        data = report(args.repo_root.resolve())
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, ValueError, OSError) as e:
        print("Unable to determine source/status delta (unknown, not current): " + str(e), file=__import__("sys").stderr)
        return 1
    text = json.dumps(data, indent=2) if args.json else markdown(data)
    print(text)
    if args.summary and os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as f:
            f.write(markdown(data) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

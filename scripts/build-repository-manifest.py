#!/usr/bin/env python3
"""Generate a complete machine-readable inventory of tracked TeamForge repository files.

The manifest is intentionally an index, not a bulk source mirror. It lets agents discover
all tracked files, their exact blob identity, category, and canonical GitHub URL without
forcing every historical report or source file into llms-full.txt.
"""

from __future__ import annotations

import argparse
import json
import subprocess
from collections import Counter
from pathlib import Path
from urllib.parse import quote

REPOSITORY_URL = "https://github.com/Eun-si123/teamforge-unity-collab"

SOURCE_EXTENSIONS = {
    ".cs", ".mjs", ".js", ".py", ".xaml", ".cmd", ".ps1", ".sh", ".bat",
}
CONFIG_EXTENSIONS = {
    ".json", ".yml", ".yaml", ".xml", ".toml", ".props", ".targets", ".csproj", ".sln",
}
TEXT_EXTENSIONS = SOURCE_EXTENSIONS | CONFIG_EXTENSIONS | {
    ".md", ".txt", ".html", ".css", ".gitignore",
}
CURRENT_DOCS = {
    "README.md",
    "README.ko.md",
    "release-contract.json",
    "builds/README.md",
    "docs/STATUS.md",
    "docs/STATUS.ko.md",
    "docs/ROADMAP.md",
    "docs/ROADMAP.ko.md",
    "CHANGELOG.md",
    "CODEMAP.md",
    ".github/CONTRIBUTING.md",
    ".github/SECURITY.md",
    ".github/SUPPORT.md",
    ".github/CODE_OF_CONDUCT.md",
    "AUTHORS.md",
    "NOTICE",
    "docs/SOURCE.md",
    "docs/AI_COMMENT_AUDIT.md",
    "docs/AI_DISCOVERY.md",
    "docs/architecture.md",
    "docs/architecture-decisions.md",
    "unity-package/com.eunsung.teamforge/README.md",
    "unity-package/com.eunsung.teamforge/CHANGELOG.md",
    "server/README.md",
    "project-peer/README.md",
    "launcher/README.md",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("repo_root", type=Path)
    parser.add_argument("site_root", type=Path)
    return parser.parse_args()


def classify(path: str) -> str:
    lower = path.lower()
    suffix = Path(path).suffix.lower()

    if "/tests/" in f"/{lower}/" or "/test/" in f"/{lower}/" or "tests.cs" in lower or lower.endswith(".test.mjs"):
        return "test"
    if path in CURRENT_DOCS:
        return "documentation-current"
    if lower.startswith("docs/phases/") or lower.startswith("docs/work-state/"):
        return "documentation-history"
    if lower.startswith("docs/") and (
        "phase-" in lower
        or "changed-files" in lower
        or "report" in lower
        or "evidence" in lower
        or lower.startswith("docs/decisions/")
    ):
        return "documentation-history"
    if suffix == ".md" or Path(path).name in {"LICENSE", "NOTICE"}:
        return "documentation-other"
    if lower.startswith(".github/"):
        return "automation"
    if suffix in SOURCE_EXTENSIONS:
        return "source"
    if suffix in CONFIG_EXTENSIONS or Path(path).name in {"package-lock.json", "package.json", ".gitignore"}:
        return "configuration"
    return "asset-or-other"


def is_text_candidate(path: str) -> bool:
    name = Path(path).name
    suffix = Path(path).suffix.lower()
    return suffix in TEXT_EXTENSIONS or name in {"LICENSE", "NOTICE", ".gitignore"}


def tracked_entries(repo_root: Path) -> list[tuple[str, str]]:
    proc = subprocess.run(
        ["git", "ls-files", "-s", "-z"],
        cwd=repo_root,
        check=True,
        stdout=subprocess.PIPE,
    )
    entries: list[tuple[str, str]] = []
    for raw in proc.stdout.split(b"\0"):
        if not raw:
            continue
        metadata, path_bytes = raw.split(b"\t", 1)
        _mode, blob_sha, _stage = metadata.decode("utf-8").split(" ", 2)
        entries.append((path_bytes.decode("utf-8"), blob_sha))
    return sorted(entries)


def main() -> None:
    args = parse_args()
    repo_root = args.repo_root.resolve()
    site_root = args.site_root.resolve()
    project_path = site_root / "project.json"
    if not project_path.is_file():
        raise SystemExit("project.json must exist before building repository-manifest.json")

    project = json.loads(project_path.read_text(encoding="utf-8"))
    source_commit = str(project.get("sourceCommit") or "")
    generated_at = str(project.get("generatedAt") or "")
    if not source_commit or not generated_at:
        raise SystemExit("project.json is missing sourceCommit/generatedAt")

    files = []
    categories: Counter[str] = Counter()
    for path, blob_sha in tracked_entries(repo_root):
        absolute = repo_root / path
        try:
            byte_size = absolute.lstat().st_size
        except FileNotFoundError as exc:
            raise SystemExit(f"tracked path is missing from checkout: {path}") from exc
        category = classify(path)
        categories[category] += 1
        quoted_path = quote(path, safe="/")
        files.append(
            {
                "path": path,
                "blobSha": blob_sha,
                "bytes": byte_size,
                "category": category,
                "textCandidate": is_text_candidate(path),
                "githubUrl": f"{REPOSITORY_URL}/blob/{source_commit}/{quoted_path}",
            }
        )

    manifest = {
        "schemaVersion": 1,
        "name": "TeamForge repository manifest",
        "description": (
            "Complete inventory of every git-tracked file in the source commit. "
            "Use this for discovery; current facts still follow llms.txt evidence precedence."
        ),
        "repository": REPOSITORY_URL,
        "sourceCommit": source_commit,
        "generatedAt": generated_at,
        "fileCount": len(files),
        "categoryCounts": dict(sorted(categories.items())),
        "files": files,
    }
    (site_root / "repository-manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Fail closed when text shipped to public GitHub Pages contains likely secret keys.

Source-tree Gitleaks remains a separate check. This inspects the *generated*
site that is actually uploaded. No credential contents appear in findings.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

TEXT_SUFFIXES = {".html", ".htm", ".js", ".mjs", ".css", ".json", ".txt",
                 ".xml", ".md", ".svg", ".webmanifest", ".atom"}
MAX_FILE = 64 * 1024 * 1024
MAX_TOTAL = 512 * 1024 * 1024
MAX_COUNT = 20000
SIGNATURES = (
    ("OpenAI private token", re.compile(rb"\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}\b")),
    ("Stripe private token", re.compile(rb"\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}\b")),
    ("GitHub private token", re.compile(rb"\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b")),
    ("Resend private token", re.compile(rb"\bre_[A-Za-z0-9]{30,}\b")),
    ("AWS access key", re.compile(rb"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b")),
    ("PEM private key", re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----")),
)


class ArtifactError(Exception):
    """Public site inspection could not complete safely."""


def inspect_site(root: Path) -> list[tuple[str, str]]:
    if not root.is_dir() or root.is_symlink():
        raise ArtifactError("generated site directory missing or unsafe")
    results = []
    total = count = 0
    for item in root.rglob("*"):
        count += 1
        if count > MAX_COUNT:
            raise ArtifactError("generated site exceeds file-count limit")
        if item.is_symlink():
            raise ArtifactError("generated site contains a symlink")
        if not item.is_file() or item.suffix.lower() not in TEXT_SUFFIXES:
            continue
        size = item.stat().st_size
        total += size
        if size > MAX_FILE or total > MAX_TOTAL:
            raise ArtifactError("generated site exceeds text inspection limits")
        data = item.read_bytes()
        label = item.relative_to(root).as_posix()
        for name, pattern in SIGNATURES:
            if pattern.search(data):
                results.append((label, name))
    return results


def main(args: list[str]) -> int:
    if len(args) != 2:
        print("Usage: verify_published_secrets.py SITE_DIRECTORY", file=sys.stderr)
        return 2
    try:
        findings = inspect_site(Path(args[1]))
    except (ArtifactError, OSError) as exc:
        print("Public site credential check could not complete: " + str(exc), file=sys.stderr)
        return 2
    for path, kind in findings:
        print(f"Blocked potential credential ({kind}) in {path!r}", file=sys.stderr)
    if findings:
        print(f"Blocked {len(findings)} potential published credential(s).", file=sys.stderr)
        return 1
    print("Generated public site credential signature scan passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))

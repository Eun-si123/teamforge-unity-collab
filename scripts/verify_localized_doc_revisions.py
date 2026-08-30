#!/usr/bin/env python3
"""Verify exact English-source review pins for published localized documents."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from pathlib import Path

REGISTRY_PATH = Path("site/i18n/locales.json")
BLOB_RE = re.compile(r"^[0-9a-f]{40}$")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("repo_root", nargs="?", type=Path, default=Path("."))
    return parser.parse_args()


def git_blob(repo_root: Path, relative: str) -> str:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", f"HEAD:{relative}"],
            cwd=repo_root,
            text=True,
            stderr=subprocess.STDOUT,
        ).strip()
    except subprocess.CalledProcessError as exc:
        detail = (exc.output or "").strip()
        raise RuntimeError(f"cannot resolve Git blob for {relative}: {detail}") from exc


def load_registry(repo_root: Path) -> dict[str, object]:
    path = repo_root / REGISTRY_PATH
    if not path.is_file():
        raise RuntimeError(f"missing locale registry: {REGISTRY_PATH}")
    registry = json.loads(path.read_text(encoding="utf-8"))
    if registry.get("schemaVersion") != 1:
        raise RuntimeError("unsupported locale registry schema")
    locale_entries = registry.get("locales")
    if not isinstance(locale_entries, list) or not locale_entries:
        raise RuntimeError("locale registry must contain locales")
    return registry


def verify_localized_doc_revisions(
    repo_root: Path,
    registry: dict[str, object] | None = None,
) -> int:
    """Return the number of localized documents whose exact source pin was verified."""
    repo_root = repo_root.resolve()
    registry = registry or load_registry(repo_root)
    default_code = str(registry.get("defaultLocale") or "")
    checked = 0

    for locale in registry["locales"]:
        if not isinstance(locale, dict):
            raise RuntimeError("locale registry entries must be objects")
        code = str(locale.get("code") or "")
        if not code or code == default_code or locale.get("publish", True) is False:
            continue

        documents = locale.get("documents") or {}
        if not isinstance(documents, dict):
            raise RuntimeError(f"locale {code} documents must be an object")

        for route, spec in documents.items():
            if not isinstance(route, str) or not route.endswith("/") or route.startswith("/"):
                raise RuntimeError(f"locale {code} has invalid document route: {route!r}")
            if not isinstance(spec, dict):
                raise RuntimeError(f"locale {code} document {route} must be an object")

            localized_source = str(spec.get("repoSource") or "")
            english_source = str(spec.get("sourceRepoSource") or "")
            reviewed_blob = str(spec.get("reviewedSourceBlob") or "")
            if not localized_source or not english_source:
                raise RuntimeError(
                    f"locale {code} document {route} must declare repoSource and sourceRepoSource"
                )
            if not (repo_root / localized_source).is_file():
                raise RuntimeError(
                    f"locale {code} document {route} localized source is missing: {localized_source}"
                )
            if not (repo_root / english_source).is_file():
                raise RuntimeError(
                    f"locale {code} document {route} canonical source is missing: {english_source}"
                )
            if not BLOB_RE.fullmatch(reviewed_blob):
                raise RuntimeError(
                    f"locale {code} document {route} must declare a 40-character lowercase "
                    "reviewedSourceBlob after semantic review"
                )

            actual_blob = git_blob(repo_root, english_source)
            if actual_blob != reviewed_blob:
                raise RuntimeError(
                    f"locale {code} document {route} requires translation review because "
                    f"{english_source} changed: reviewed {reviewed_blob}, current {actual_blob}"
                )
            checked += 1

    return checked


def main() -> None:
    args = parse_args()
    checked = verify_localized_doc_revisions(args.repo_root)
    print(f"Verified {checked} localized document reviewed-source pin(s).")


if __name__ == "__main__":
    main()

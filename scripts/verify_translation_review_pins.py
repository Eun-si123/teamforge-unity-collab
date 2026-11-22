#!/usr/bin/env python3
"""Fail early when published translation review pins no longer match local sources.

Run as part of ordinary npm test, before the slower Project Peer and Pages jobs.
Reuse the exact validators that the public Pages build uses instead of
maintaining a second, potentially weaker interpretation of review freshness.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from build_homepage_locales import load_manifest, load_registry, locales
from verify_localized_doc_revisions import verify_localized_doc_revisions


def verify_reviewed_sources(repo_root: Path) -> tuple[int, int]:
    root = repo_root.resolve()
    registry = load_registry(root)

    # A published long-form translation must match the exact reviewed English
    # source bytes, even if the English change was documentation-only.
    documents = verify_localized_doc_revisions(root, registry)

    # Some published locales have homepages but no translated STATUS route.
    # They still pin STATUS and other UI/source copy, so document-only checks
    # cannot catch all failures seen in the GitHub Pages build.
    homepages = 0
    default = str(registry["defaultLocale"])
    for locale in locales(registry, published_only=True):
        if str(locale["code"]) == default:
            continue
        load_manifest(root, locale)
        homepages += 1
    return documents, homepages


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("repo_root", nargs="?", type=Path, default=Path("."))
    args = parser.parse_args()
    documents, homepages = verify_reviewed_sources(args.repo_root)
    print(f"Translation freshness PASS: {documents} localized document pins, "
          f"{homepages} published homepage manifests.")


if __name__ == "__main__":
    main()

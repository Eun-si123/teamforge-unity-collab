#!/usr/bin/env python3
"""Verify TeamForge translation packet structure and source invariants."""

from __future__ import annotations

import argparse
import json
import re
import zipfile
from pathlib import Path
from typing import Any

REQUIRED_FILES = {
    "README.md",
    "TRANSLATION_BRIEF.md",
    "GLOSSARY_DRAFT.json",
    "HOMEPAGE_SOURCE.en.json",
    "EDITOR_DEMO_SOURCE.en.json",
    "OUTPUT_INSTRUCTIONS.md",
    "REVIEW_CHECKLIST.md",
    "SOURCE_MANIFEST.json",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("packet", type=Path)
    parser.add_argument("--expected-locale", required=True)
    return parser.parse_args()


def read_json(archive: zipfile.ZipFile, name: str) -> dict[str, Any]:
    data = json.loads(archive.read(name).decode("utf-8"))
    if not isinstance(data, dict):
        raise RuntimeError(f"expected JSON object: {name}")
    return data


def verify(packet: Path, expected_locale: str) -> None:
    if not packet.is_file():
        raise RuntimeError(f"packet not found: {packet}")

    expected_root = f"TeamForge-translation-packet-{expected_locale}/"
    with zipfile.ZipFile(packet) as archive:
        names = set(archive.namelist())
        roots = {name.split("/", 1)[0] for name in names if "/" in name}
        if roots != {expected_root.rstrip("/")}:
            raise RuntimeError(f"unexpected packet roots: {sorted(roots)}")
        present = {name[len(expected_root):] for name in names if name.startswith(expected_root) and not name.endswith("/")}
        missing = REQUIRED_FILES - present
        extra = present - REQUIRED_FILES
        if missing or extra:
            raise RuntimeError(f"packet file mismatch; missing={sorted(missing)} extra={sorted(extra)}")

        manifest = read_json(archive, expected_root + "SOURCE_MANIFEST.json")
        homepage = read_json(archive, expected_root + "HOMEPAGE_SOURCE.en.json")
        demo = read_json(archive, expected_root + "EDITOR_DEMO_SOURCE.en.json")
        glossary = read_json(archive, expected_root + "GLOSSARY_DRAFT.json")

        if manifest.get("schemaVersion") != 1 or manifest.get("canonicalLocale") != "en":
            raise RuntimeError("unsupported source manifest schema/canonical locale")
        if manifest.get("targetLocale") != expected_locale:
            raise RuntimeError("source manifest target locale mismatch")
        if not re.fullmatch(r"[0-9a-f]{40}", str(manifest.get("sourceRevision", ""))):
            raise RuntimeError("sourceRevision must be a full Git SHA-1")
        fingerprints = manifest.get("sourceFingerprints")
        if not isinstance(fingerprints, dict):
            raise RuntimeError("sourceFingerprints missing")
        if fingerprints.get("homepage") != homepage.get("fingerprint"):
            raise RuntimeError("homepage fingerprint mismatch")
        if fingerprints.get("editorDemo") != demo.get("fingerprint"):
            raise RuntimeError("editor demo fingerprint mismatch")

        if homepage.get("schemaVersion") != 1 or homepage.get("sourceLocale") != "en":
            raise RuntimeError("unsupported homepage source schema")
        anchors = homepage.get("anchors")
        if not isinstance(anchors, list) or not anchors:
            raise RuntimeError("homepage source anchors are empty")
        for entry in anchors:
            if not isinstance(entry, dict) or not entry.get("id") or not isinstance(entry.get("source"), str):
                raise RuntimeError("invalid homepage anchor")
            if "target" in entry:
                raise RuntimeError("source packet must not contain translated homepage targets")

        if demo.get("schemaVersion") != 1 or demo.get("sourceLocale") != "en":
            raise RuntimeError("unsupported editor demo source schema")
        exact = demo.get("exact")
        attributes = demo.get("attributes")
        patterns = demo.get("patterns")
        if not isinstance(exact, dict) or not exact:
            raise RuntimeError("editor demo exact source inventory is empty")
        if not isinstance(attributes, dict) or not isinstance(patterns, list):
            raise RuntimeError("editor demo source inventory types are invalid")
        if any(source != value for source, value in exact.items()):
            raise RuntimeError("editor demo exact values must remain canonical English source strings")
        if any(source != value for source, value in attributes.items()):
            raise RuntimeError("editor demo attribute values must remain canonical English source strings")
        for entry in patterns:
            if not isinstance(entry, dict) or not isinstance(entry.get("source"), str):
                raise RuntimeError("invalid editor demo pattern")
            if entry.get("template") is not None:
                raise RuntimeError("source packet runtime pattern templates must be empty")
            placeholders = entry.get("requiredPlaceholders")
            if not isinstance(placeholders, list):
                raise RuntimeError("runtime pattern requiredPlaceholders must be an array")

        if glossary.get("schemaVersion") != 1 or glossary.get("sourceLocale") != "en":
            raise RuntimeError("unsupported glossary schema")
        if glossary.get("targetLocale") != expected_locale:
            raise RuntimeError("glossary target locale mismatch")
        terms = glossary.get("terms")
        if not isinstance(terms, list) or not terms:
            raise RuntimeError("glossary terms are empty")
        if any(isinstance(item, dict) and item.get("target") is not None for item in terms):
            raise RuntimeError("draft glossary must not contain pre-filled target translations")

        brief = archive.read(expected_root + "TRANSLATION_BRIEF.md").decode("utf-8")
        checklist = archive.read(expected_root + "REVIEW_CHECKLIST.md").decode("utf-8")
        required_boundary_markers = (
            "early public preview",
            "FIELD BLOCKED",
            "Direct reachability",
            "no WebRTC",
            "no ICE",
            "no built-in STUN",
            "no built-in TURN",
            "no general relay",
            "no automatic NAT traversal",
        )
        combined = brief + "\n" + checklist
        for marker in required_boundary_markers:
            if marker.lower() not in combined.lower():
                raise RuntimeError(f"required product-boundary marker missing from review materials: {marker}")

    print(f"Translation packet verified: {packet}")


def main() -> int:
    args = parse_args()
    verify(args.packet, args.expected_locale)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

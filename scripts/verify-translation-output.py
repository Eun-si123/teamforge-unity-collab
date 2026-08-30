#!/usr/bin/env python3
"""Verify and optionally normalize LLM-produced TeamForge translation outputs.

The verifier never trusts machine-readable source fields emitted by a translation model.
Homepage anchors are matched by stable IDs against the canonical Qwen/source profile.
Target-only homepage output is preferred. Legacy outputs that repeat `source` are accepted
only when byte-identical, unless --repair-homepage-source is explicitly requested.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
from pathlib import Path
from typing import Any


class VerificationError(RuntimeError):
    pass


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, required=True, help="Qwen/source profile directory")
    parser.add_argument("--homepage", type=Path, required=True, help="LLM homepage output JSON")
    parser.add_argument("--demo", type=Path, required=True, help="LLM editor-demo output JSON")
    parser.add_argument("--glossary", type=Path, required=True, help="LLM glossary review JSON")
    parser.add_argument("--notes", type=Path, help="Optional translation notes Markdown")
    parser.add_argument("--expected-locale", required=True)
    parser.add_argument(
        "--repair-homepage-source",
        action="store_true",
        help="Repair legacy homepage source fields from canonical English instead of failing on source drift",
    )
    parser.add_argument(
        "--normalized-output-dir",
        type=Path,
        help="Write canonicalized review outputs and TRANSLATION_OUTPUT_VALIDATION.json here",
    )
    return parser.parse_args()


def read_json(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise VerificationError(f"file not found: {path}")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise VerificationError(f"invalid JSON {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise VerificationError(f"expected JSON object: {path}")
    return data


def require_nonempty_string(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise VerificationError(f"{label} must be a non-empty string")
    return value


def source_files(source_dir: Path) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any], dict[str, Any]]:
    homepage = read_json(source_dir / "HOMEPAGE_SOURCE.en.json")
    demo = read_json(source_dir / "EDITOR_DEMO_SOURCE.en.json")
    glossary = read_json(source_dir / "GLOSSARY_DRAFT.json")
    manifest = read_json(source_dir / "SOURCE_MANIFEST.json")
    return homepage, demo, glossary, manifest


def validate_source_profile(
    homepage: dict[str, Any],
    demo: dict[str, Any],
    glossary: dict[str, Any],
    manifest: dict[str, Any],
    locale: str,
) -> None:
    if homepage.get("schemaVersion") != 1 or homepage.get("sourceLocale") != "en":
        raise VerificationError("unsupported canonical homepage source schema")
    if demo.get("schemaVersion") != 1 or demo.get("sourceLocale") != "en":
        raise VerificationError("unsupported canonical demo source schema")
    if glossary.get("schemaVersion") != 1 or glossary.get("sourceLocale") != "en":
        raise VerificationError("unsupported canonical glossary source schema")
    if glossary.get("targetLocale") != locale:
        raise VerificationError("canonical glossary target locale mismatch")
    if manifest.get("schemaVersion") != 1 or manifest.get("canonicalLocale") != "en":
        raise VerificationError("unsupported source manifest schema")
    if manifest.get("targetLocale") != locale:
        raise VerificationError("source manifest target locale mismatch")
    fingerprints = manifest.get("sourceFingerprints")
    if not isinstance(fingerprints, dict):
        raise VerificationError("source manifest fingerprints missing")
    if fingerprints.get("homepage") != homepage.get("fingerprint"):
        raise VerificationError("canonical homepage fingerprint mismatch")
    if fingerprints.get("editorDemo") != demo.get("fingerprint"):
        raise VerificationError("canonical editor-demo fingerprint mismatch")


def validate_homepage(
    source: dict[str, Any],
    candidate: dict[str, Any],
    locale: str,
    repair_source: bool,
) -> tuple[dict[str, Any], dict[str, Any]]:
    if candidate.get("schemaVersion") != 1:
        raise VerificationError("homepage output schemaVersion must be 1")
    if candidate.get("sourceLocale") != "en":
        raise VerificationError("homepage output sourceLocale must remain en")
    if candidate.get("targetLocale") != locale:
        raise VerificationError("homepage output targetLocale mismatch")
    if candidate.get("target") not in {"homepage", "homepage-targets"}:
        raise VerificationError("homepage output target must be homepage or homepage-targets")

    source_metadata = source.get("metadata")
    candidate_metadata = candidate.get("metadata")
    if not isinstance(source_metadata, dict) or not isinstance(candidate_metadata, dict):
        raise VerificationError("homepage metadata must be objects")
    if set(candidate_metadata) != set(source_metadata):
        raise VerificationError(
            f"homepage metadata keys changed: expected={sorted(source_metadata)} got={sorted(candidate_metadata)}"
        )
    normalized_metadata: dict[str, str] = {}
    for key in source_metadata:
        normalized_metadata[key] = require_nonempty_string(candidate_metadata.get(key), f"homepage metadata {key}")

    source_anchors = source.get("anchors")
    candidate_anchors = candidate.get("anchors")
    if not isinstance(source_anchors, list) or not source_anchors:
        raise VerificationError("canonical homepage anchors missing")
    if not isinstance(candidate_anchors, list) or not candidate_anchors:
        raise VerificationError("homepage output anchors missing")

    canonical_by_id: dict[str, dict[str, Any]] = {}
    for entry in source_anchors:
        if not isinstance(entry, dict):
            raise VerificationError("invalid canonical homepage anchor")
        anchor_id = require_nonempty_string(entry.get("id"), "canonical homepage anchor id")
        if anchor_id in canonical_by_id:
            raise VerificationError(f"duplicate canonical homepage anchor id: {anchor_id}")
        require_nonempty_string(entry.get("source"), f"canonical source {anchor_id}")
        canonical_by_id[anchor_id] = entry

    candidate_by_id: dict[str, dict[str, Any]] = {}
    source_drift: list[dict[str, Any]] = []
    for entry in candidate_anchors:
        if not isinstance(entry, dict):
            raise VerificationError("invalid homepage output anchor")
        anchor_id = require_nonempty_string(entry.get("id"), "homepage output anchor id")
        if anchor_id in candidate_by_id:
            raise VerificationError(f"duplicate homepage output anchor id: {anchor_id}")
        candidate_by_id[anchor_id] = entry

    missing = sorted(set(canonical_by_id) - set(candidate_by_id))
    extra = sorted(set(candidate_by_id) - set(canonical_by_id))
    if missing or extra:
        raise VerificationError(f"homepage anchor IDs changed; missing={missing} extra={extra}")

    normalized_anchors: list[dict[str, Any]] = []
    for source_entry in source_anchors:
        anchor_id = source_entry["id"]
        candidate_entry = candidate_by_id[anchor_id]
        target = require_nonempty_string(candidate_entry.get("target"), f"homepage target {anchor_id}")

        if "source" in candidate_entry and candidate_entry.get("source") != source_entry["source"]:
            source_drift.append(
                {
                    "id": anchor_id,
                    "canonicalLength": len(source_entry["source"]),
                    "candidateLength": len(str(candidate_entry.get("source", ""))),
                }
            )

        for field in ("expectedCount", "inventoryReferences"):
            if field in candidate_entry and candidate_entry.get(field) != source_entry.get(field):
                raise VerificationError(f"homepage machine field changed for {anchor_id}: {field}")

        normalized_anchors.append(
            {
                "id": anchor_id,
                "source": source_entry["source"],
                "target": target,
                "expectedCount": source_entry.get("expectedCount"),
                "inventoryReferences": source_entry.get("inventoryReferences", []),
            }
        )

    if candidate.get("fingerprint") is not None and candidate.get("fingerprint") != source.get("fingerprint"):
        raise VerificationError("homepage source fingerprint changed")

    if source_drift and not repair_source:
        sample = ", ".join(item["id"] for item in source_drift[:5])
        raise VerificationError(
            f"homepage source drift detected in {len(source_drift)} anchors; first IDs: {sample}. "
            "Use target-only output or pass --repair-homepage-source for an explicit canonical repair."
        )

    normalized = {
        "schemaVersion": 1,
        "sourceLocale": "en",
        "targetLocale": locale,
        "target": "homepage",
        "canonicalSource": source.get("canonicalSource"),
        "rule": source.get("rule"),
        "metadata": normalized_metadata,
        "anchors": normalized_anchors,
        "fingerprint": source.get("fingerprint"),
    }
    report = {
        "anchorCount": len(normalized_anchors),
        "sourceDriftCount": len(source_drift),
        "sourceDrift": source_drift,
        "sourceRepairApplied": bool(source_drift and repair_source),
        "inputMode": "legacy-full" if any("source" in item for item in candidate_anchors) else "target-only",
    }
    return normalized, report


def validate_demo(source: dict[str, Any], candidate: dict[str, Any], locale: str) -> dict[str, Any]:
    if candidate.get("schemaVersion") != 1 or candidate.get("locale") != locale:
        raise VerificationError("editor-demo schema/locale mismatch")
    if candidate.get("target") != "editor-demo":
        raise VerificationError("editor-demo target mismatch")

    normalized: dict[str, Any] = {
        "schemaVersion": 1,
        "locale": locale,
        "target": "editor-demo",
        "inventoryReference": source.get("inventoryReference"),
        "inventoryReferencePolicy": source.get("inventoryReferencePolicy"),
    }

    for section in ("exact", "attributes"):
        source_map = source.get(section)
        candidate_map = candidate.get(section)
        if not isinstance(source_map, dict) or not isinstance(candidate_map, dict):
            raise VerificationError(f"editor-demo {section} must be objects")
        if set(candidate_map) != set(source_map):
            raise VerificationError(f"editor-demo {section} source keys changed")
        normalized[section] = {
            key: require_nonempty_string(candidate_map[key], f"editor-demo {section} target {key!r}")
            for key in source_map
        }

    source_terms = source.get("terms")
    candidate_terms = candidate.get("terms")
    if not isinstance(source_terms, dict) or not isinstance(candidate_terms, dict):
        raise VerificationError("editor-demo terms must be objects")
    if set(candidate_terms) != set(source_terms):
        raise VerificationError("editor-demo term groups changed")
    normalized_terms: dict[str, dict[str, str]] = {}
    for group, source_group in source_terms.items():
        candidate_group = candidate_terms.get(group)
        if not isinstance(source_group, dict) or not isinstance(candidate_group, dict):
            raise VerificationError(f"editor-demo term group invalid: {group}")
        if set(candidate_group) != set(source_group):
            raise VerificationError(f"editor-demo term keys changed: {group}")
        normalized_terms[group] = {
            key: require_nonempty_string(candidate_group[key], f"editor-demo term {group}.{key}")
            for key in source_group
        }
    normalized["terms"] = normalized_terms

    source_patterns = source.get("patterns")
    candidate_patterns = candidate.get("patterns")
    if not isinstance(source_patterns, list) or not isinstance(candidate_patterns, list):
        raise VerificationError("editor-demo patterns must be arrays")
    if len(source_patterns) != len(candidate_patterns):
        raise VerificationError("editor-demo pattern count changed")

    normalized_patterns: list[dict[str, Any]] = []
    for index, (source_entry, candidate_entry) in enumerate(zip(source_patterns, candidate_patterns, strict=True)):
        if not isinstance(source_entry, dict) or not isinstance(candidate_entry, dict):
            raise VerificationError(f"editor-demo pattern {index} invalid")
        if candidate_entry.get("source") != source_entry.get("source"):
            raise VerificationError(f"editor-demo regex source changed at pattern {index}")
        if candidate_entry.get("requiredPlaceholders") != source_entry.get("requiredPlaceholders"):
            raise VerificationError(f"editor-demo requiredPlaceholders changed at pattern {index}")
        if candidate_entry.get("mapGroups", {}) != source_entry.get("mapGroups", {}):
            raise VerificationError(f"editor-demo mapGroups changed at pattern {index}")
        template = require_nonempty_string(candidate_entry.get("template"), f"editor-demo template {index}")
        for placeholder in source_entry.get("requiredPlaceholders", []):
            token = "{" + str(placeholder) + "}"
            if token not in template:
                raise VerificationError(f"editor-demo template {index} missing placeholder {token}")
        normalized_patterns.append(
            {
                "source": source_entry["source"],
                "template": template,
                "requiredPlaceholders": source_entry.get("requiredPlaceholders", []),
                "mapGroups": source_entry.get("mapGroups", {}),
            }
        )
    normalized["patterns"] = normalized_patterns

    if candidate.get("fingerprint") is not None and candidate.get("fingerprint") != source.get("fingerprint"):
        raise VerificationError("editor-demo source fingerprint changed")
    normalized["fingerprint"] = source.get("fingerprint")
    return normalized


def validate_glossary(source: dict[str, Any], candidate: dict[str, Any], locale: str) -> dict[str, Any]:
    if candidate.get("schemaVersion") != 1 or candidate.get("sourceLocale") != "en":
        raise VerificationError("glossary output schema/sourceLocale mismatch")
    if candidate.get("targetLocale") != locale:
        raise VerificationError("glossary output target locale mismatch")
    if candidate.get("status") != "draft":
        raise VerificationError("glossary output must remain draft")

    source_terms = source.get("terms")
    candidate_terms = candidate.get("terms")
    if not isinstance(source_terms, list) or not isinstance(candidate_terms, list):
        raise VerificationError("glossary terms must be arrays")
    if len(source_terms) != len(candidate_terms):
        raise VerificationError("glossary term count changed")

    source_by_term: dict[str, dict[str, Any]] = {}
    for item in source_terms:
        if not isinstance(item, dict):
            raise VerificationError("invalid canonical glossary term")
        term = require_nonempty_string(item.get("source"), "canonical glossary source term")
        source_by_term[term] = item

    candidate_by_term: dict[str, dict[str, Any]] = {}
    for item in candidate_terms:
        if not isinstance(item, dict):
            raise VerificationError("invalid glossary output term")
        term = require_nonempty_string(item.get("source"), "glossary output source term")
        if term in candidate_by_term:
            raise VerificationError(f"duplicate glossary source term: {term}")
        candidate_by_term[term] = item

    if set(candidate_by_term) != set(source_by_term):
        raise VerificationError("glossary source terms changed")

    normalized_terms: list[dict[str, Any]] = []
    for source_item in source_terms:
        term = source_item["source"]
        candidate_item = candidate_by_term[term]
        for field in ("policy", "note"):
            if candidate_item.get(field) != source_item.get(field):
                raise VerificationError(f"glossary machine/source field changed for {term}: {field}")
        target = require_nonempty_string(candidate_item.get("target"), f"glossary target {term}")
        normalized_terms.append(
            {
                "source": term,
                "policy": source_item.get("policy"),
                "target": target,
                "note": source_item.get("note"),
            }
        )

    return {
        "schemaVersion": 1,
        "sourceLocale": "en",
        "targetLocale": locale,
        "status": "draft",
        "terms": normalized_terms,
    }


def write_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def verify(args: argparse.Namespace) -> dict[str, Any]:
    source_homepage, source_demo, source_glossary, manifest = source_files(args.source_dir)
    validate_source_profile(source_homepage, source_demo, source_glossary, manifest, args.expected_locale)

    candidate_homepage = read_json(args.homepage)
    candidate_demo = read_json(args.demo)
    candidate_glossary = read_json(args.glossary)

    homepage, homepage_report = validate_homepage(
        source_homepage,
        candidate_homepage,
        args.expected_locale,
        args.repair_homepage_source,
    )
    demo = validate_demo(source_demo, candidate_demo, args.expected_locale)
    glossary = validate_glossary(source_glossary, candidate_glossary, args.expected_locale)

    report: dict[str, Any] = {
        "schemaVersion": 1,
        "locale": args.expected_locale,
        "sourceRevision": manifest.get("sourceRevision"),
        "sourceFingerprints": manifest.get("sourceFingerprints"),
        "homepage": homepage_report,
        "editorDemo": {
            "exactCount": len(demo["exact"]),
            "attributeCount": len(demo["attributes"]),
            "patternCount": len(demo["patterns"]),
        },
        "glossary": {"termCount": len(glossary["terms"])},
        "status": "verified-draft",
    }

    if args.notes is not None and not args.notes.is_file():
        raise VerificationError(f"translation notes not found: {args.notes}")

    if args.normalized_output_dir is not None:
        output_dir = args.normalized_output_dir
        output_dir.mkdir(parents=True, exist_ok=True)
        write_json(output_dir / f"homepage.{args.expected_locale}.json", homepage)
        write_json(output_dir / f"editor-demo.{args.expected_locale}.json", demo)
        write_json(output_dir / f"glossary.{args.expected_locale}.review.json", glossary)
        if args.notes is not None:
            shutil.copyfile(args.notes, output_dir / f"translation-notes.{args.expected_locale}.md")
        write_json(output_dir / "TRANSLATION_OUTPUT_VALIDATION.json", report)

    print(
        "Translation output verified: "
        f"locale={args.expected_locale} homepage={homepage_report['anchorCount']} "
        f"sourceDrift={homepage_report['sourceDriftCount']} demoPatterns={len(demo['patterns'])} "
        f"glossaryTerms={len(glossary['terms'])}"
    )
    return report


def main() -> int:
    args = parse_args()
    try:
        verify(args)
    except VerificationError as exc:
        raise SystemExit(f"translation output verification failed: {exc}") from exc
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

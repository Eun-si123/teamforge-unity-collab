#!/usr/bin/env python3
"""Verify TeamForge long-form document translation packet invariants."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import zipfile
from pathlib import Path
from typing import Any

PACKET_FILES = {
    "QWEN_DOC_TRANSLATION_BRIEF.md",
    "GLOSSARY_DRAFT.json",
    "STATUS_SOURCE.en.md",
    "HOW_IT_WORKS_SOURCE.en.md",
    "SOURCE_MANIFEST.json",
}
EXPECTED_DOCUMENTS = {
    "status": ("docs/STATUS.md", "STATUS_SOURCE.en.md", "STATUS"),
    "howItWorks": ("docs/HOW_IT_WORKS.md", "HOW_IT_WORKS_SOURCE.en.md", "HOW_IT_WORKS"),
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("packet", type=Path)
    parser.add_argument("--expected-locale", required=True)
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=None,
        help="Optional repository checkout; when supplied, prove packet bytes/blob IDs match current canonical sources",
    )
    return parser.parse_args()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_json(archive: zipfile.ZipFile, name: str) -> dict[str, Any]:
    value = json.loads(archive.read(name).decode("utf-8"))
    if not isinstance(value, dict):
        raise RuntimeError(f"expected JSON object: {name}")
    return value


def git_output(root: Path, *args: str) -> str:
    return subprocess.check_output(["git", *args], cwd=root, text=True).strip()


def verify(packet: Path, locale: str, repo_root: Path | None) -> None:
    if not packet.is_file():
        raise RuntimeError(f"packet not found: {packet}")

    expected_root = f"TeamForge-doc-translation-packet-{locale}/"
    with zipfile.ZipFile(packet) as archive:
        names = set(archive.namelist())
        roots = {name.split("/", 1)[0] for name in names if "/" in name}
        if roots != {expected_root.rstrip("/")}:
            raise RuntimeError(f"unexpected packet roots: {sorted(roots)}")

        present = {
            name[len(expected_root):]
            for name in names
            if name.startswith(expected_root) and not name.endswith("/")
        }
        missing = PACKET_FILES - present
        extra = present - PACKET_FILES
        if missing or extra:
            raise RuntimeError(f"packet file mismatch; missing={sorted(missing)} extra={sorted(extra)}")

        manifest = read_json(archive, expected_root + "SOURCE_MANIFEST.json")
        glossary = read_json(archive, expected_root + "GLOSSARY_DRAFT.json")
        brief = archive.read(expected_root + "QWEN_DOC_TRANSLATION_BRIEF.md").decode("utf-8")

        if manifest.get("schemaVersion") != 1 or manifest.get("canonicalLocale") != "en":
            raise RuntimeError("unsupported document packet schema/canonical locale")
        if manifest.get("targetLocale") != locale:
            raise RuntimeError("document packet target locale mismatch")
        source_revision = str(manifest.get("sourceRevision") or "")
        if not re.fullmatch(r"[0-9a-f]{40}", source_revision):
            raise RuntimeError("sourceRevision must be a full lowercase Git SHA-1")

        policy = manifest.get("translationPolicy")
        if not isinstance(policy, dict):
            raise RuntimeError("translationPolicy missing")
        if policy.get("englishOnlyCanonicalSemanticSource") is not True:
            raise RuntimeError("packet must declare English as the only canonical semantic source")
        if policy.get("existingTranslationsSemanticSource") is not False:
            raise RuntimeError("packet must reject existing translations as semantic sources")
        if policy.get("independentReviewRequiredBeforePublication") is not True:
            raise RuntimeError("packet must require independent review before publication")

        expected_outputs = {
            f"STATUS.{locale}.md",
            f"HOW_IT_WORKS.{locale}.md",
            f"glossary.{locale}.review.json",
            f"translation-notes.{locale}.md",
        }
        if set(manifest.get("expectedOutputs") or []) != expected_outputs:
            raise RuntimeError("expected output contract mismatch")

        documents = manifest.get("documents")
        if not isinstance(documents, list) or len(documents) != len(EXPECTED_DOCUMENTS):
            raise RuntimeError("document provenance list must contain exactly STATUS and HOW_IT_WORKS")

        by_id: dict[str, dict[str, Any]] = {}
        for item in documents:
            if not isinstance(item, dict) or not isinstance(item.get("id"), str):
                raise RuntimeError("invalid document provenance entry")
            doc_id = item["id"]
            if doc_id in by_id:
                raise RuntimeError(f"duplicate document provenance id: {doc_id}")
            by_id[doc_id] = item

        if set(by_id) != set(EXPECTED_DOCUMENTS):
            raise RuntimeError(f"unexpected document IDs: {sorted(by_id)}")

        for doc_id, (source_path, packet_file, output_stem) in EXPECTED_DOCUMENTS.items():
            item = by_id[doc_id]
            if item.get("sourcePath") != source_path:
                raise RuntimeError(f"{doc_id}: sourcePath mismatch")
            if item.get("packetFile") != packet_file:
                raise RuntimeError(f"{doc_id}: packetFile mismatch")
            if item.get("expectedOutput") != f"{output_stem}.{locale}.md":
                raise RuntimeError(f"{doc_id}: expectedOutput mismatch")
            blob_sha = str(item.get("blobSha") or "")
            sha256 = str(item.get("sha256") or "")
            if not re.fullmatch(r"[0-9a-f]{40}", blob_sha):
                raise RuntimeError(f"{doc_id}: blobSha must be a full lowercase Git SHA-1")
            if not re.fullmatch(r"[0-9a-f]{64}", sha256):
                raise RuntimeError(f"{doc_id}: sha256 must be lowercase hex")

            packet_bytes = archive.read(expected_root + packet_file)
            if len(packet_bytes) != item.get("bytes"):
                raise RuntimeError(f"{doc_id}: byte-count mismatch")
            if sha256_bytes(packet_bytes) != sha256:
                raise RuntimeError(f"{doc_id}: packet SHA-256 mismatch")

            if repo_root is not None:
                root = repo_root.resolve()
                canonical = root / source_path
                if not canonical.is_file():
                    raise RuntimeError(f"{doc_id}: canonical source missing from checkout: {source_path}")
                canonical_bytes = canonical.read_bytes()
                if packet_bytes != canonical_bytes:
                    raise RuntimeError(f"{doc_id}: packet bytes differ from current canonical source")
                current_blob = git_output(root, "hash-object", source_path)
                if current_blob != blob_sha:
                    raise RuntimeError(
                        f"{doc_id}: recorded reviewed-source blob {blob_sha} does not match current source blob {current_blob}"
                    )
                if sha256_bytes(canonical_bytes) != sha256:
                    raise RuntimeError(f"{doc_id}: manifest SHA-256 differs from current canonical source")

        if glossary.get("schemaVersion") != 1 or glossary.get("sourceLocale") != "en":
            raise RuntimeError("unsupported glossary schema/source locale")
        if glossary.get("targetLocale") != locale:
            raise RuntimeError("glossary target locale mismatch")
        terms = glossary.get("terms")
        if not isinstance(terms, list) or not terms:
            raise RuntimeError("glossary terms are empty")
        if any(not isinstance(item, dict) or item.get("target") is not None for item in terms):
            raise RuntimeError("draft glossary terms must be objects with null target values")

        required_markers = (
            "English is the only canonical semantic source",
            "FIELD BLOCKED",
            "direct reachability",
            "no WebRTC transport",
            "no ICE negotiation",
            "no built-in STUN",
            "no built-in TURN",
            "no general relay transport",
            "no automatic Internet NAT traversal",
            "source CI evidence",
            "packaged-artifact evidence",
            "reviewedSourceBlob",
            f"STATUS.{locale}.md",
            f"HOW_IT_WORKS.{locale}.md",
        )
        for marker in required_markers:
            if marker.lower() not in brief.lower():
                raise RuntimeError(f"required review/output marker missing from brief: {marker}")

    print(f"Long-form document translation packet verified: {packet}")


def main() -> int:
    args = parse_args()
    verify(args.packet, args.expected_locale, args.repo_root)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

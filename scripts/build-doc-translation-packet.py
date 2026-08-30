#!/usr/bin/env python3
"""Build a five-file LLM translation packet for TeamForge long-form documentation.

The packet contains only canonical English source documents plus review instructions,
terminology guidance, and exact source provenance. Existing localized documents are
never included as semantic translation sources.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import zipfile
from pathlib import Path
from typing import Any

PACKET_SCHEMA = 1
SOURCE_LOCALE = "en"
PACKET_FILES = (
    "QWEN_DOC_TRANSLATION_BRIEF.md",
    "GLOSSARY_DRAFT.json",
    "STATUS_SOURCE.en.md",
    "HOW_IT_WORKS_SOURCE.en.md",
    "SOURCE_MANIFEST.json",
)
DOCUMENTS = (
    {
        "id": "status",
        "source": "docs/STATUS.md",
        "packetFile": "STATUS_SOURCE.en.md",
        "outputStem": "STATUS",
    },
    {
        "id": "howItWorks",
        "source": "docs/HOW_IT_WORKS.md",
        "packetFile": "HOW_IT_WORKS_SOURCE.en.md",
        "outputStem": "HOW_IT_WORKS",
    },
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--locale", required=True, help="BCP 47 target locale, for example zh-Hans")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("dist-doc-translation"),
        help="Parent directory for generated packet directory and ZIP",
    )
    parser.add_argument(
        "--allow-unregistered",
        action="store_true",
        help="Allow a draft-only locale that is not present in site/i18n/locales.json",
    )
    return parser.parse_args()


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def read_json(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise RuntimeError(f"expected JSON object: {path}")
    return data


def git_output(root: Path, *args: str) -> str:
    return subprocess.check_output(["git", *args], cwd=root, text=True).strip()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def registry_locale(registry: dict[str, Any], code: str) -> dict[str, Any] | None:
    locales = registry.get("locales")
    if not isinstance(locales, list):
        raise RuntimeError("site/i18n/locales.json locales must be an array")
    for item in locales:
        if isinstance(item, dict) and item.get("code") == code:
            return item
    return None


def target_metadata(registry: dict[str, Any], code: str, allow_unregistered: bool) -> dict[str, Any]:
    locale = registry_locale(registry, code)
    if locale is not None:
        return {
            "code": code,
            "registered": True,
            "label": locale.get("label"),
            "htmlLang": locale.get("htmlLang"),
            "hreflang": locale.get("hreflang"),
            "direction": locale.get("direction", "ltr"),
            "lifecycle": locale.get("lifecycle"),
            "publish": bool(locale.get("publish", True)),
            "indexable": bool(locale.get("indexable", True)),
        }
    if not allow_unregistered:
        raise RuntimeError(
            f"target locale {code!r} is not registered in site/i18n/locales.json; "
            "register it first or pass --allow-unregistered for a draft-only packet"
        )
    if not re.fullmatch(r"[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*", code):
        raise RuntimeError(f"target locale does not look like a BCP 47 language tag: {code!r}")
    return {
        "code": code,
        "registered": False,
        "label": code,
        "htmlLang": code,
        "hreflang": None,
        "direction": "unknown",
        "lifecycle": "unregistered-draft",
        "publish": False,
        "indexable": False,
    }


def glossary_payload(locale: str) -> dict[str, Any]:
    entries = (
        ("TeamForge", "never", "Product name; never translate or transliterate."),
        ("Unity Editor", "official-locale-term", "Use established Unity terminology where appropriate."),
        ("Scene", "contextual", "Unity Scene concept."),
        ("Hierarchy", "contextual", "Unity Hierarchy window/object structure."),
        ("Transform", "contextual", "Unity Transform component/state."),
        ("Prefab", "contextual", "Unity Prefab concept."),
        ("Host", "contextual", "Collaboration host; not automatically a generic web server."),
        ("Guest", "contextual", "Participating collaboration user/client."),
        ("Project Peer", "contextual", "TeamForge project-transfer role/component."),
        ("Session Authority", "contextual", "Server authority over live collaboration session state."),
        ("Project Coordinator", "contextual", "Server role coordinating signed project metadata."),
        ("authority", "contextual", "Software/network authority over accepted shared state."),
        ("lock / lease", "contextual", "Authority-controlled editing lock and expiring lease."),
        ("replay / idempotency", "contextual", "Retry/replay safety for operations."),
        ("Baseline", "contextual", "Published/verifiable project baseline."),
        ("Publisher", "contextual", "Identity that publishes a project baseline."),
        ("Seed", "contextual", "Peer that provides project payload/chunks."),
        ("Staging", "contextual", "Pre-activation managed project area."),
        ("Active Project", "contextual", "Verified activated project revision."),
        ("Collaboration Invite", "contextual", "Signed TeamForge collaboration invitation."),
        ("P2P", "preserve", "Keep P2P; explanatory prose may add a localized equivalent."),
        ("WebSocket", "preserve", "Protocol/technology name."),
        ("Direct HTTP", "preserve", "Current direct project payload transport."),
        ("direct reachability", "required-meaning", "Peers currently need direct network reachability for direct transfer."),
        ("relay", "contextual", "Network relay; current TeamForge has no general relay transport."),
        ("NAT traversal", "contextual", "Current TeamForge has no automatic Internet NAT traversal."),
        ("early public preview", "required-meaning", "Must remain clearly experimental/pre-release."),
        ("FIELD BLOCKED", "preserve-status", "Exact release/evidence state; do not weaken or reinterpret."),
        ("packaged candidate", "contextual", "Exact built artifact candidate, distinct from current source."),
        ("artifact", "contextual", "Exact distributable/evidence object; preserve hashes and filenames."),
        ("current source", "contextual", "Current repository source, which may differ from an older packaged candidate."),
    )
    return {
        "schemaVersion": PACKET_SCHEMA,
        "sourceLocale": SOURCE_LOCALE,
        "targetLocale": locale,
        "status": "draft",
        "terms": [
            {"source": source, "policy": policy, "target": None, "note": note}
            for source, policy, note in entries
        ],
    }


def brief(locale: str, source_revision: str, documents: list[dict[str, Any]]) -> str:
    status_blob = next(item["blobSha"] for item in documents if item["id"] == "status")
    how_blob = next(item["blobSha"] for item in documents if item["id"] == "howItWorks")
    return f"""# TeamForge Qwen Long-form Documentation Translation Brief

Target locale: `{locale}`
Canonical source locale: `en`
Source revision: `{source_revision}`

Read **all five packet files** before translating. English is the only canonical semantic source.
Existing Korean or other translations are intentionally absent from this packet and must not be used as a semantic source.

## Required outputs

Return exactly these four files:

1. `STATUS.{locale}.md`
2. `HOW_IT_WORKS.{locale}.md`
3. `glossary.{locale}.review.json`
4. `translation-notes.{locale}.md`

Do not add explanatory prose outside those files.

## Exact reviewed-source provenance

The two English sources in this packet are exact repository bytes. Their Git blob IDs are:

- `docs/STATUS.md` → `{status_blob}`
- `docs/HOW_IT_WORKS.md` → `{how_blob}`

If these translations later pass independent semantic review, those exact blob IDs are the values that should be recorded as `reviewedSourceBlob` for the corresponding localized documents. Do not invent, shorten, or replace them.

## Product and evidence boundaries — MUST PRESERVE

- TeamForge is an **early public preview**, not a general production-ready release.
- Preserve the exact **FIELD BLOCKED** release-readiness state where the English source uses it.
- Do not turn source CI evidence into packaged-artifact evidence.
- Do not imply an older packaged candidate contains later current-source changes.
- Realtime collaboration authority goes through the TeamForge Server.
- Normal project payload bytes move directly between Project Peers.
- The TeamForge Server is not the normal project-file relay.
- Direct Project Peer transfer currently requires **direct reachability**.
- Current direct transfer fits same-PC, reachable LAN, or managed-VPN environments.
- There is **no WebRTC transport**, **no ICE negotiation**, **no built-in STUN**, **no built-in TURN**, **no general relay transport**, and **no automatic Internet NAT traversal**.
- Durable downloaded project state does not imply durable realtime authority/session history.
- Diagnostics/support bundles are observational artifacts, not recovery authority.
- Unknown or ambiguous state should remain fail-closed where the English source says so.

Never strengthen reliability, security, production-readiness, networking, recovery, or feature-support claims.

## Translation rules

Translate for a mainland Simplified Chinese software-developer audience while preserving technical precision.
Use natural Chinese prose rather than word-for-word English syntax, but never change the meaning or evidence level.

Preserve exactly unless the surrounding English source explicitly presents the item as user-facing prose:

- `TeamForge`
- URLs and link destinations
- issue/PR numbers
- version numbers, release IDs, hashes, ports, protocol versions
- filenames and repository paths
- code identifiers, class names, method names, environment variables, commands
- inline-code tokens
- table structure and factual values

Markdown structure should remain semantically equivalent. Keep headings, warnings, lists, tables, links, and fenced blocks in the same logical order.

### Fenced code and diagrams

- Preserve code/command snippets exactly.
- Mermaid/text diagrams may translate **visible explanatory labels only** when this can be done without changing node IDs, arrows, syntax, identifiers, ports, protocols, or technical tokens.
- If a diagram label is ambiguous, preserve the English label and note it in `translation-notes.{locale}.md` instead of risking broken syntax.

### Links

Keep every Markdown link destination exactly unchanged. Link text may be localized when it is natural-language UI/document text.

## Glossary

Fill `GLOSSARY_DRAFT.json` into `glossary.{locale}.review.json` without changing source terms, policies, or notes. Add target terms and flag uncertainty in the notes file rather than guessing.

## Review notes

`translation-notes.{locale}.md` must include:

- uncertain or disputed terminology;
- any English phrase intentionally preserved;
- any diagram/code block intentionally left untranslated for structural safety;
- any sentence whose semantic equivalence needs independent review;
- confirmation that `FIELD BLOCKED`, direct reachability, source-vs-package evidence boundaries, and absent NAT traversal/relay capabilities were preserved.

## Final self-check

Before returning the four files, compare each translated section back against the English source and confirm:

- no section was omitted;
- no limitation or warning was weakened;
- no planned feature became implemented;
- no source evidence became package evidence;
- no link destination, hash, version, port, identifier, or filename changed;
- `TeamForge` remained unchanged;
- Chinese is natural enough for a technical reader rather than mechanically literal.
"""


def build_packet(root: Path, locale: str, output_dir: Path, allow_unregistered: bool) -> tuple[Path, Path]:
    registry = read_json(root / "site/i18n/locales.json")
    if registry.get("schemaVersion") != 1 or registry.get("defaultLocale") != SOURCE_LOCALE:
        raise RuntimeError("unsupported locale registry schema/default locale")
    target = target_metadata(registry, locale, allow_unregistered)

    source_revision = git_output(root, "rev-parse", "HEAD")
    source_revision_date = git_output(root, "show", "-s", "--format=%cI", source_revision)
    if not re.fullmatch(r"[0-9a-f]{40}", source_revision):
        raise RuntimeError("source revision is not a full Git SHA-1")

    document_records: list[dict[str, Any]] = []
    for spec in DOCUMENTS:
        source_path = root / spec["source"]
        if not source_path.is_file():
            raise RuntimeError(f"canonical document is missing: {spec['source']}")
        payload = source_path.read_bytes()
        document_records.append(
            {
                "id": spec["id"],
                "sourcePath": spec["source"],
                "packetFile": spec["packetFile"],
                "expectedOutput": f"{spec['outputStem']}.{locale}.md",
                "blobSha": git_output(root, "hash-object", spec["source"]),
                "sha256": sha256_bytes(payload),
                "bytes": len(payload),
            }
        )

    output_dir = output_dir if output_dir.is_absolute() else root / output_dir
    packet_root = output_dir / f"TeamForge-doc-translation-packet-{locale}"
    packet_zip = output_dir / f"TeamForge-doc-translation-packet-{locale}.zip"
    if packet_root.exists():
        shutil.rmtree(packet_root)
    packet_root.mkdir(parents=True, exist_ok=True)
    if packet_zip.exists():
        packet_zip.unlink()

    for spec in DOCUMENTS:
        shutil.copyfile(root / spec["source"], packet_root / spec["packetFile"])

    (packet_root / "GLOSSARY_DRAFT.json").write_text(
        json.dumps(glossary_payload(locale), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (packet_root / "QWEN_DOC_TRANSLATION_BRIEF.md").write_text(
        brief(locale, source_revision, document_records),
        encoding="utf-8",
    )

    manifest = {
        "schemaVersion": PACKET_SCHEMA,
        "canonicalLocale": SOURCE_LOCALE,
        "targetLocale": locale,
        "target": target,
        "sourceRevision": source_revision,
        "sourceRevisionDate": source_revision_date,
        "documents": document_records,
        "translationPolicy": {
            "englishOnlyCanonicalSemanticSource": True,
            "existingTranslationsSemanticSource": False,
            "independentReviewRequiredBeforePublication": True,
            "reviewedSourceBlobAfterApproval": "Use each document's blobSha exactly.",
        },
        "expectedOutputs": [
            f"STATUS.{locale}.md",
            f"HOW_IT_WORKS.{locale}.md",
            f"glossary.{locale}.review.json",
            f"translation-notes.{locale}.md",
        ],
    }
    (packet_root / "SOURCE_MANIFEST.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    actual = {path.name for path in packet_root.iterdir() if path.is_file()}
    expected = set(PACKET_FILES)
    if actual != expected:
        raise RuntimeError(f"document packet must contain exactly five files; expected={expected} actual={actual}")

    with zipfile.ZipFile(packet_zip, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name in PACKET_FILES:
            archive.write(packet_root / name, arcname=f"{packet_root.name}/{name}")

    print(packet_root)
    print(packet_zip)
    return packet_root, packet_zip


def main() -> int:
    args = parse_args()
    build_packet(repo_root(), args.locale, args.output_dir, args.allow_unregistered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

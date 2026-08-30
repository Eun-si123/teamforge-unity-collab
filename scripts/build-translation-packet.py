#!/usr/bin/env python3
"""Build an LLM-ready TeamForge translation packet from canonical English sources.

The packet intentionally contains no translated strings from existing locales. Existing
locale manifests/bundles may be used only as inventories of English source anchors,
attributes, and runtime patterns.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import subprocess
import tempfile
import zipfile
from pathlib import Path
from typing import Any

PACKET_SCHEMA = 1
SOURCE_LOCALE = "en"
REQUIRED_FILES = (
    "README.md",
    "TRANSLATION_BRIEF.md",
    "GLOSSARY_DRAFT.json",
    "HOMEPAGE_SOURCE.en.json",
    "EDITOR_DEMO_SOURCE.en.json",
    "OUTPUT_INSTRUCTIONS.md",
    "REVIEW_CHECKLIST.md",
    "SOURCE_MANIFEST.json",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--locale", required=True, help="BCP 47 target locale, for example zh-Hans")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("dist"),
        help="Directory for the generated ZIP (default: dist)",
    )
    parser.add_argument(
        "--allow-unregistered",
        action="store_true",
        help="Allow a target locale not yet present in site/i18n/locales.json",
    )
    return parser.parse_args()


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def read_json(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise RuntimeError(f"expected JSON object: {path}")
    return data


def canonical_json(data: Any) -> bytes:
    return json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def git_output(root: Path, *args: str) -> str:
    return subprocess.check_output(["git", *args], cwd=root, text=True).strip()


def git_revision(root: Path) -> tuple[str, str]:
    commit = git_output(root, "rev-parse", "HEAD")
    commit_date = git_output(root, "show", "-s", "--format=%cI", commit)
    return commit, commit_date


def git_blob_sha(root: Path, relative_path: str) -> str:
    return git_output(root, "hash-object", relative_path)


def registry_locale(registry: dict[str, Any], code: str) -> dict[str, Any] | None:
    locales = registry.get("locales")
    if not isinstance(locales, list):
        raise RuntimeError("site/i18n/locales.json locales must be an array")
    for item in locales:
        if isinstance(item, dict) and item.get("code") == code:
            return item
    return None


def validate_target_locale(registry: dict[str, Any], code: str, allow_unregistered: bool) -> dict[str, Any]:
    item = registry_locale(registry, code)
    if item is not None:
        return {
            "code": code,
            "registered": True,
            "htmlLang": item.get("htmlLang"),
            "hreflang": item.get("hreflang"),
            "direction": item.get("direction", "ltr"),
            "lifecycle": item.get("lifecycle"),
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
        "htmlLang": code,
        "hreflang": None,
        "direction": "unknown",
        "lifecycle": "unregistered-draft",
    }


def extract_metadata(index_html: str) -> dict[str, str]:
    def one(pattern: str, label: str) -> str:
        match = re.search(pattern, index_html, flags=re.IGNORECASE | re.DOTALL)
        if not match:
            raise RuntimeError(f"could not extract homepage metadata: {label}")
        return html.unescape(match.group(1).strip())

    return {
        "title": one(r"<title>(.*?)</title>", "title"),
        "description": one(r'<meta\s+name="description"\s+content="([^"]*)"', "description"),
        "ogTitle": one(r'<meta\s+property="og:title"\s+content="([^"]*)"', "og:title"),
        "ogDescription": one(r'<meta\s+property="og:description"\s+content="([^"]*)"', "og:description"),
    }


def homepage_inventory(root: Path, registry: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    """Collect exact English homepage anchors without copying any translated target text."""

    index_path = root / "site/index.html"
    index_html = index_path.read_text(encoding="utf-8")
    manifests: list[str] = []
    anchors: dict[str, dict[str, Any]] = {}

    for locale in registry.get("locales", []):
        if not isinstance(locale, dict):
            continue
        manifest_rel = locale.get("homepageManifest")
        if not manifest_rel:
            continue
        manifest_rel = str(manifest_rel)
        manifest = read_json(root / manifest_rel)
        replacements = manifest.get("replacements")
        if not isinstance(replacements, list):
            raise RuntimeError(f"{manifest_rel}: replacements must be an array")
        manifests.append(manifest_rel)
        for replacement in replacements:
            if not isinstance(replacement, dict) or not isinstance(replacement.get("source"), str):
                raise RuntimeError(f"{manifest_rel}: every replacement needs a string source")
            source = replacement["source"]
            digest = sha256_bytes(source.encode("utf-8"))[:16]
            record = anchors.setdefault(
                digest,
                {
                    "id": f"homepage.anchor.{digest}",
                    "source": source,
                    "expectedCount": int(replacement.get("count", 0) or 0) or None,
                    "inventoryReferences": [],
                },
            )
            record["inventoryReferences"].append(manifest_rel)

    if not anchors:
        raise RuntimeError("no homepage source anchors found in registered locale manifests")

    ordered = sorted(anchors.values(), key=lambda item: item["id"])
    payload = {
        "schemaVersion": PACKET_SCHEMA,
        "sourceLocale": SOURCE_LOCALE,
        "target": "homepage",
        "canonicalSource": "site/index.html plus finalized English source anchors tracked by locale manifests",
        "rule": "Translate only user-visible natural-language content. Preserve markup, attributes, URLs, identifiers, and source anchors exactly where required by the output schema.",
        "metadata": extract_metadata(index_html),
        "anchors": ordered,
    }
    payload["fingerprint"] = sha256_bytes(canonical_json({"metadata": payload["metadata"], "anchors": ordered}))
    return payload, sorted(set(manifests))


def named_groups(pattern: str) -> list[str]:
    return sorted(set(re.findall(r"\(\?<([A-Za-z][A-Za-z0-9_-]*)>", pattern)))


def runtime_inventory(root: Path, registry: dict[str, Any]) -> tuple[dict[str, Any], str]:
    """Build an English runtime source bundle from English keys/regex only.

    Existing translated values/templates are deliberately discarded.
    """

    reference_rel: str | None = None
    reference: dict[str, Any] | None = None
    for locale in registry.get("locales", []):
        if not isinstance(locale, dict):
            continue
        candidate = locale.get("runtimeTranslation")
        if candidate:
            reference_rel = f"site/{candidate}" if not str(candidate).startswith("site/") else str(candidate)
            reference = read_json(root / reference_rel)
            break
    if reference_rel is None or reference is None:
        raise RuntimeError("no runtimeTranslation bundle is registered; cannot derive demo source inventory")

    exact_raw = reference.get("exact") or {}
    attributes_raw = reference.get("attributes") or {}
    terms_raw = reference.get("terms") or {}
    patterns_raw = reference.get("patterns") or []
    if not isinstance(exact_raw, dict) or not isinstance(attributes_raw, dict):
        raise RuntimeError(f"{reference_rel}: exact/attributes must be objects")
    if not isinstance(terms_raw, dict) or not isinstance(patterns_raw, list):
        raise RuntimeError(f"{reference_rel}: terms/patterns have invalid types")

    exact = {str(source): str(source) for source in exact_raw.keys()}
    attributes = {str(source): str(source) for source in attributes_raw.keys()}
    terms: dict[str, dict[str, str]] = {}
    for group, values in terms_raw.items():
        if not isinstance(values, dict):
            raise RuntimeError(f"{reference_rel}: term group {group!r} must be an object")
        terms[str(group)] = {str(key): str(key) for key in values.keys()}

    patterns: list[dict[str, Any]] = []
    for entry in patterns_raw:
        if not isinstance(entry, dict) or not isinstance(entry.get("source"), str):
            raise RuntimeError(f"{reference_rel}: runtime pattern needs a string source")
        pattern = entry["source"]
        patterns.append(
            {
                "source": pattern,
                "template": None,
                "requiredPlaceholders": named_groups(pattern),
                "mapGroups": entry.get("mapGroups", {}),
            }
        )

    payload = {
        "schemaVersion": PACKET_SCHEMA,
        "sourceLocale": SOURCE_LOCALE,
        "target": "editor-demo",
        "inventoryReference": reference_rel,
        "inventoryReferencePolicy": "Only English object keys and source regex patterns were copied. Existing translated values/templates were not copied.",
        "exact": exact,
        "attributes": attributes,
        "terms": terms,
        "patterns": patterns,
    }
    payload["fingerprint"] = sha256_bytes(
        canonical_json({"exact": exact, "attributes": attributes, "terms": terms, "patterns": patterns})
    )
    return payload, reference_rel


def glossary_payload(locale: str) -> dict[str, Any]:
    entries = [
        ("TeamForge", "never", "Product name."),
        ("Unity Editor", "official-locale-term", "Use Unity's official target-locale terminology where appropriate."),
        ("P2P", "preserve", "Keep P2P; explanatory prose may add a localized equivalent."),
        ("WebSocket", "preserve", "Protocol/technology name."),
        ("Host", "contextual", "Collaboration session host, not automatically a generic web server."),
        ("Guest", "contextual", "Participating collaboration client/user."),
        ("Peer", "contextual", "Network/collaboration peer."),
        ("Project Peer", "contextual", "TeamForge role/component involved in direct project transfer."),
        ("realtime authority", "contextual", "Authority over realtime collaboration state; use software/network meaning."),
        ("Presence", "contextual", "Connected-participant awareness and collaboration state."),
        ("Lock", "contextual", "Object/edit collaboration lock."),
        ("Baseline", "contextual", "Published project baseline."),
        ("Bootstrap", "contextual", "Initial project acquisition/setup flow; not the Bootstrap CSS framework."),
        ("Publisher", "contextual", "Peer/user that publishes a project baseline."),
        ("Seed", "contextual", "Peer providing project payload/chunks."),
        ("Resume", "contextual", "Continue an interrupted project transfer."),
        ("Relay", "contextual", "Network relay; current TeamForge does not provide a general relay transport."),
        ("direct reachability", "required-meaning", "Peers currently need direct network reachability for direct Project Peer transfer."),
        ("early public preview", "required-meaning", "Must remain clearly experimental/pre-release."),
        ("FIELD BLOCKED", "preserve-status", "Evidence/release state; never weaken to warning or partial success."),
    ]
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


def translation_brief(locale: str) -> str:
    return f"""# TeamForge Translation Brief\n\nTarget locale: `{locale}`\n\n## Canonical source\n\nEnglish is the only canonical semantic source for this translation run. Existing TeamForge translations may be used only to understand file/schema structure. Never translate an existing translation into `{locale}` when an English source string exists.\n\n## Product\n\nTeamForge is an open-source real-time collaboration project for the Unity Editor. Preserve the exact technical meaning and current evidence/release boundaries.\n\n## Current boundaries that must not be strengthened\n\n- TeamForge is an **early public preview**, not a general production-ready release.\n- Preserve **FIELD BLOCKED** wherever the canonical source uses that status.\n- Realtime collaboration currently uses TeamForge Server authority.\n- Project payload transfer can use **direct Project Peer P2P transfer**.\n- **Direct reachability is currently required** for direct peer transfer.\n- There is currently **no WebRTC transport**.\n- There is currently **no ICE negotiation**.\n- There is currently **no built-in STUN support**.\n- There is currently **no built-in TURN support**.\n- There is currently **no general relay transport**.\n- There is currently **no automatic NAT traversal**.\n\nDo not translate wording in a way that implies any missing capability already exists.\n\n## Priority\n\n1. Preserve technical meaning.\n2. Preserve limitations, evidence states, and release boundaries.\n3. Use terminology natural to software developers in the target locale.\n4. Follow `GLOSSARY_DRAFT.json`; flag ambiguous terms instead of silently guessing.\n5. Prefer clear technical language over stronger marketing language.\n\n## Never translate or mutate\n\n- `TeamForge`\n- URLs and file paths\n- JSON keys\n- code, commands, environment variables, identifiers\n- version numbers, hashes, protocol identifiers\n- placeholders such as `{{name}}`, `{{owner}}`, `{{version}}`, `{{editor}}`, `{{property}}`\n- regular-expression source patterns\n\nHTML fragments in homepage anchors may contain translatable visible text. Preserve their tags, attributes, URLs, IDs, and other machine-readable structure exactly while translating only user-visible natural-language content.\n"""


def output_instructions(locale: str, registered: bool) -> str:
    state = "registered" if registered else "UNREGISTERED DRAFT"
    return f"""# Output Instructions\n\nTarget locale: `{locale}` ({state})\n\nProduce these draft files:\n\n1. `homepage.{locale}.json`\n2. `editor-demo.{locale}.json`\n3. `glossary.{locale}.review.json`\n4. `translation-notes.{locale}.md`\n\n## Homepage output\n\nUse `HOMEPAGE_SOURCE.en.json`. Keep each anchor's `source` value byte-for-byte unchanged. Add a `target` containing the full translated replacement fragment. Preserve HTML structure, URLs, IDs, attribute names, technical identifiers, and any non-user-visible syntax. Metadata values may be translated, but metadata keys must not change.\n\n## Demo output\n\nUse `EDITOR_DEMO_SOURCE.en.json`.\n\n- Keep `schemaVersion: 1`.\n- Set `locale` to `{locale}`.\n- In `exact` and `attributes`, preserve each English source key and translate only its value.\n- In `terms`, preserve group/key structure and translate values.\n- In `patterns`, preserve each `source` regex exactly and create a localized `template`. Every name listed in `requiredPlaceholders` must appear in the template exactly as `{{name}}`. Preserve `mapGroups`.\n\n## General rules\n\n- Return valid UTF-8 JSON.\n- Do not rename keys.\n- Do not translate URLs, code, commands, paths, identifiers, versions, hashes, or regex patterns.\n- Do not omit limitations or add product capabilities.\n- Record ambiguous technical terminology in `translation-notes.{locale}.md`.\n- Treat all generated translations as **DRAFT** until independent review is complete.\n"""


def review_checklist() -> str:
    return """# TeamForge Localization Review Checklist\n\n## Meaning\n\n- [ ] No canonical English meaning is omitted.\n- [ ] No new product capability or guarantee is introduced.\n- [ ] No technical limitation is removed or weakened.\n- [ ] Numbers, versions, protocol names, identifiers, and evidence states are unchanged.\n\n## Networking\n\n- [ ] Direct Project Peer P2P is not translated as working across arbitrary networks.\n- [ ] The direct-reachability requirement is preserved.\n- [ ] No WebRTC support is implied.\n- [ ] No ICE support is implied.\n- [ ] No built-in STUN support is implied.\n- [ ] No built-in TURN support is implied.\n- [ ] No general relay is implied.\n- [ ] No automatic NAT traversal is implied.\n\n## Release / evidence\n\n- [ ] `early public preview` remains clearly pre-release.\n- [ ] `FIELD BLOCKED` remains blocked wherever present.\n- [ ] Experimental behavior is not described as guaranteed or production-ready.\n- [ ] PASS / FAIL / INCOMPLETE / BLOCKED semantics remain distinct.\n\n## Terminology\n\n- [ ] TeamForge is unchanged.\n- [ ] Unity terminology follows official/local developer usage where practical.\n- [ ] Host / Guest / Peer / Project Peer are contextually distinct.\n- [ ] Authority is translated in the software/network sense.\n- [ ] Bootstrap is not confused with the web UI framework.\n\n## Structure\n\n- [ ] JSON keys are unchanged.\n- [ ] Placeholders are unchanged and complete.\n- [ ] Regex source patterns are unchanged.\n- [ ] URLs, file paths, code, commands, versions, and hashes are unchanged.\n- [ ] Homepage HTML structure is preserved inside replacement fragments.\n\n## UI quality\n\n- [ ] Buttons and labels are concise.\n- [ ] Wording is natural for native software developers.\n- [ ] Intentionally retained English technical terms are consistent.\n- [ ] No accidental untranslated prose remains.\n"""


def readme(locale: str, registered: bool) -> str:
    mode = "registered locale" if registered else "unregistered draft locale"
    return f"""# TeamForge Translation Packet — {locale}\n\nThis packet is an LLM-ready translation input generated from the TeamForge repository for `{locale}` ({mode}).\n\nStart with `TRANSLATION_BRIEF.md`, then provide the JSON source files and `GLOSSARY_DRAFT.json` to the translation model. `OUTPUT_INSTRUCTIONS.md` defines the required outputs, and `REVIEW_CHECKLIST.md` is intended for a separate reviewer/verifier.\n\n## Important trust rule\n\nEnglish is canonical. Existing localized TeamForge files are not semantic translation sources. The builder may inspect their schemas to discover maintained English source anchors and runtime source patterns, but translated target strings are deliberately excluded from this packet.\n\n## Suggested model flow\n\n1. Translation model: create the four draft outputs listed in `OUTPUT_INSTRUCTIONS.md`.\n2. Native-language/technical reviewer: correct naturalness and terminology without changing product claims.\n3. Independent semantic verifier: compare the final target against canonical English and flag only omissions, additions, claim drift, terminology mistakes, or structural damage.\n4. TeamForge CI/review: import only reviewed outputs; keep preview locales non-indexable until the publication gate is satisfied.\n\n`SOURCE_MANIFEST.json` records the exact repository revision, source-file hashes, and extracted-source fingerprints used for this packet.\n"""


def source_manifest(
    root: Path,
    locale: str,
    target: dict[str, Any],
    homepage: dict[str, Any],
    demo: dict[str, Any],
    homepage_refs: list[str],
    runtime_ref: str,
) -> dict[str, Any]:
    revision, revision_date = git_revision(root)
    source_paths = [
        "site/index.html",
        "site/i18n/locales.json",
        *homepage_refs,
        runtime_ref,
        "docs/STATUS.md",
        "docs/HOW_IT_WORKS.md",
        "release-contract.json",
    ]
    unique_paths = sorted(set(source_paths))
    files: dict[str, dict[str, str]] = {}
    for relative in unique_paths:
        path = root / relative
        if not path.exists():
            raise RuntimeError(f"translation packet source file missing: {relative}")
        files[relative] = {
            "gitBlob": git_blob_sha(root, relative),
            "sha256": sha256_file(path),
        }
    return {
        "schemaVersion": PACKET_SCHEMA,
        "project": "TeamForge",
        "canonicalLocale": SOURCE_LOCALE,
        "targetLocale": locale,
        "targetRegistration": target,
        "status": "draft",
        "sourceRevision": revision,
        "sourceRevisionDate": revision_date,
        "sourceFingerprints": {
            "homepage": homepage["fingerprint"],
            "editorDemo": demo["fingerprint"],
        },
        "sourceFiles": files,
        "translationPolicy": {
            "englishCanonical": True,
            "existingTranslationsSemanticSource": False,
            "preservePlaceholders": True,
            "preserveTechnicalLimitations": True,
            "translationApisRequiredForBuild": False,
        },
        "provenance": {
            "translator": None,
            "reviewer": None,
            "semanticVerifier": None,
        },
    }


def write_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def build_packet(root: Path, locale: str, output_dir: Path, allow_unregistered: bool) -> Path:
    registry = read_json(root / "site/i18n/locales.json")
    if registry.get("schemaVersion") != 1 or registry.get("defaultLocale") != SOURCE_LOCALE:
        raise RuntimeError("unsupported locale registry or canonical locale")
    target = validate_target_locale(registry, locale, allow_unregistered)
    homepage, homepage_refs = homepage_inventory(root, registry)
    demo, runtime_ref = runtime_inventory(root, registry)
    manifest = source_manifest(root, locale, target, homepage, demo, homepage_refs, runtime_ref)

    packet_name = f"TeamForge-translation-packet-{locale}"
    output_dir = output_dir if output_dir.is_absolute() else root / output_dir
    output_dir.mkdir(parents=True, exist_ok=True)
    zip_path = output_dir / f"{packet_name}.zip"

    with tempfile.TemporaryDirectory(prefix="teamforge-translation-") as tmp:
        packet_dir = Path(tmp) / packet_name
        packet_dir.mkdir()
        (packet_dir / "README.md").write_text(readme(locale, bool(target["registered"])), encoding="utf-8")
        (packet_dir / "TRANSLATION_BRIEF.md").write_text(translation_brief(locale), encoding="utf-8")
        write_json(packet_dir / "GLOSSARY_DRAFT.json", glossary_payload(locale))
        write_json(packet_dir / "HOMEPAGE_SOURCE.en.json", homepage)
        write_json(packet_dir / "EDITOR_DEMO_SOURCE.en.json", demo)
        (packet_dir / "OUTPUT_INSTRUCTIONS.md").write_text(
            output_instructions(locale, bool(target["registered"])), encoding="utf-8"
        )
        (packet_dir / "REVIEW_CHECKLIST.md").write_text(review_checklist(), encoding="utf-8")
        write_json(packet_dir / "SOURCE_MANIFEST.json", manifest)

        missing = [name for name in REQUIRED_FILES if not (packet_dir / name).is_file()]
        if missing:
            raise RuntimeError(f"translation packet is incomplete: {missing}")

        with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for path in sorted(packet_dir.iterdir()):
                archive.write(path, arcname=f"{packet_name}/{path.name}")

    print(zip_path)
    return zip_path


def main() -> int:
    args = parse_args()
    build_packet(repo_root(), args.locale, args.output_dir, args.allow_unregistered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Build a Qwen-web-friendly five-file TeamForge translation input profile.

The canonical translation packet remains the source of truth. This adapter builds and
verifies that packet first, then repackages its inputs into exactly five .md/.json files
so web UIs with a five-file upload limit do not need to accept ZIP files.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

QWEN_FILES = (
    "QWEN_TRANSLATION_BRIEF.md",
    "GLOSSARY_DRAFT.json",
    "HOMEPAGE_SOURCE.en.json",
    "EDITOR_DEMO_SOURCE.en.json",
    "SOURCE_MANIFEST.json",
)

MERGED_GUIDES = (
    "TRANSLATION_BRIEF.md",
    "OUTPUT_INSTRUCTIONS.md",
    "REVIEW_CHECKLIST.md",
    "README.md",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--locale", required=True, help="BCP 47 target locale, for example zh-Hans")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("dist-qwen"),
        help="Parent directory for the generated five-file profile (default: dist-qwen)",
    )
    parser.add_argument(
        "--allow-unregistered",
        action="store_true",
        help="Forward draft-only unregistered locale permission to the canonical packet builder",
    )
    return parser.parse_args()


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def run(command: list[str], *, cwd: Path) -> None:
    subprocess.run(command, cwd=cwd, check=True)


def build_verified_canonical_packet(root: Path, locale: str, work_dir: Path, allow_unregistered: bool) -> Path:
    canonical_dir = work_dir / "canonical"
    command = [
        sys.executable,
        str(root / "scripts/build-translation-packet.py"),
        "--locale",
        locale,
        "--output-dir",
        str(canonical_dir),
    ]
    if allow_unregistered:
        command.append("--allow-unregistered")
    run(command, cwd=root)

    packet = canonical_dir / f"TeamForge-translation-packet-{locale}.zip"
    if not packet.is_file():
        raise RuntimeError(f"canonical translation packet was not created: {packet}")

    run(
        [
            sys.executable,
            str(root / "scripts/verify-translation-packet.py"),
            str(packet),
            "--expected-locale",
            locale,
        ],
        cwd=root,
    )
    return packet


def qwen_output_override(locale: str) -> str:
    return f"""## Qwen delivery-profile output override — MUST FOLLOW

This section supersedes the embedded canonical guide's legacy **Homepage output** paragraph.
It exists because chat models can accidentally reformat supposedly immutable HTML/source strings.

For the homepage, do **not** copy or reproduce any `source`, `expectedCount`, or
`inventoryReferences` fields from `HOMEPAGE_SOURCE.en.json`.

Produce `homepage.{locale}.targets.json` with this shape:

```json
{{
  "schemaVersion": 1,
  "sourceLocale": "en",
  "targetLocale": "{locale}",
  "target": "homepage-targets",
  "fingerprint": "COPY HOMEPAGE_SOURCE.en.json fingerprint EXACTLY",
  "metadata": {{
    "title": "translated value",
    "description": "translated value",
    "ogTitle": "translated value",
    "ogDescription": "translated value"
  }},
  "anchors": [
    {{"id": "homepage.anchor....", "target": "translated full replacement fragment"}}
  ]
}}
```

Rules:

- Copy each anchor `id` exactly once and in the same order.
- Translate only into `target`; never emit an anchor `source` field.
- Copy the homepage `fingerprint` exactly. It identifies the canonical English source inventory.
- Preserve machine-readable HTML structure inside each translated `target` fragment.
- The TeamForge verifier/import step will reattach canonical English `source` values by anchor ID.
- The other required outputs remain `editor-demo.{locale}.json`,
  `glossary.{locale}.review.json`, and `translation-notes.{locale}.md` as described below.

If an embedded instruction below asks you to repeat homepage `source` values, this Qwen-specific
override wins. Do not reproduce the homepage source strings.
"""


def merge_guides(source_dir: Path, locale: str) -> str:
    sections = [
        "# TeamForge Qwen Translation Brief",
        "",
        f"Target locale: `{locale}`",
        "",
        "This is the Qwen web five-file delivery profile. Read all five uploaded files before translating.",
        "English is the only canonical semantic source. The sections below merge the canonical packet's",
        "translation brief, output contract, review checklist, and packet README so no instruction file is lost",
        "because of the five-file upload limit.",
        "",
        "Do not treat `SOURCE_MANIFEST.json` as text to translate; it is provenance and source-integrity metadata.",
        "",
        qwen_output_override(locale).strip(),
    ]
    for name in MERGED_GUIDES:
        path = source_dir / name
        if not path.is_file():
            raise RuntimeError(f"canonical packet guide missing: {name}")
        sections.extend(
            [
                "",
                "---",
                "",
                f"## Embedded canonical guide: `{name}`",
                "",
                path.read_text(encoding="utf-8").strip(),
            ]
        )
    return "\n".join(sections).rstrip() + "\n"


def build_profile(root: Path, locale: str, output_dir: Path, allow_unregistered: bool) -> Path:
    output_dir = output_dir if output_dir.is_absolute() else root / output_dir
    profile_dir = output_dir / f"TeamForge-Qwen-{locale}"

    if profile_dir.exists():
        shutil.rmtree(profile_dir)
    profile_dir.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="teamforge-qwen-profile-") as tmp:
        work_dir = Path(tmp)
        packet = build_verified_canonical_packet(root, locale, work_dir, allow_unregistered)
        extracted = work_dir / "extracted"
        with zipfile.ZipFile(packet) as archive:
            archive.extractall(extracted)

        source_dir = extracted / f"TeamForge-translation-packet-{locale}"
        if not source_dir.is_dir():
            raise RuntimeError(f"canonical packet root missing after extraction: {source_dir}")

        (profile_dir / "QWEN_TRANSLATION_BRIEF.md").write_text(
            merge_guides(source_dir, locale), encoding="utf-8"
        )
        for name in (
            "GLOSSARY_DRAFT.json",
            "HOMEPAGE_SOURCE.en.json",
            "EDITOR_DEMO_SOURCE.en.json",
            "SOURCE_MANIFEST.json",
        ):
            shutil.copyfile(source_dir / name, profile_dir / name)

    actual = tuple(sorted(path.name for path in profile_dir.iterdir() if path.is_file()))
    expected = tuple(sorted(QWEN_FILES))
    if actual != expected:
        raise RuntimeError(f"Qwen profile must contain exactly five files; expected {expected}, got {actual}")

    print(profile_dir)
    return profile_dir


def main() -> int:
    args = parse_args()
    build_profile(repo_root(), args.locale, args.output_dir, args.allow_unregistered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

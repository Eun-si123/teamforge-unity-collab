from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import zipfile

REPOSITORY = os.environ["GITHUB_REPOSITORY"]
TAG = "v0.5.1-prealpha-wp5.1"
ASSET_NAMES = (
    "Unity-TeamForge-0.5.1-WP5.1-path-resilience-final-candidate-win-x64.zip",
    "Unity-TeamForge-0.5.1-WP5.1-path-resilience-final-win-x64.zip",
    "Unity-TeamForge-0.5.1-WP5.1-path-resilience-win-x64.zip",
)
ROOT = "Unity-TeamForge-0.5.1-WP5.1/"
TARGETS = (
    "project-peer/test/cli-policy.test.mjs",
    "project-peer/test/wp51-path-resilience-static.test.mjs",
)
MANIFEST = "release-manifest.json"
# Avoid retaining the machine-local username as a searchable literal in this one-shot helper.
old_user = bytes((69, 117, 110)).decode("ascii")
OLD_PREFIX = f"C:\\\\Users\\\\{old_user}\\\\"
NEW_PREFIX = "C:\\\\Users\\\\Dev\\\\"


def run(*args: str, capture: bool = False) -> str:
    completed = subprocess.run(
        args,
        check=True,
        text=True,
        stdout=subprocess.PIPE if capture else None,
    )
    return completed.stdout if capture else ""


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sanitize_archive(archive: Path) -> str:
    with zipfile.ZipFile(archive, "r") as source:
        infos = source.infolist()
        payloads: dict[str, bytes] = {}
        for relative in TARGETS:
            member = ROOT + relative
            text = source.read(member).decode("utf-8")
            if OLD_PREFIX in text:
                text = text.replace(OLD_PREFIX, NEW_PREFIX)
            elif NEW_PREFIX not in text:
                raise RuntimeError(f"Expected path fixture was not found in {archive.name}:{relative}")
            if OLD_PREFIX in text or NEW_PREFIX not in text:
                raise RuntimeError(f"Path sanitization failed in {archive.name}:{relative}")
            payloads[member] = text.encode("utf-8")

        manifest_member = ROOT + MANIFEST
        manifest = json.loads(source.read(manifest_member).decode("utf-8"))
        records = {record["path"]: record for record in manifest["files"]}
        for relative in TARGETS:
            data = payloads[ROOT + relative]
            records[relative]["size"] = len(data)
            records[relative]["sha256"] = sha256(data)
        payloads[manifest_member] = (
            json.dumps(manifest, indent=2, ensure_ascii=False) + "\n"
        ).encode("utf-8")

        with tempfile.NamedTemporaryFile(
            prefix=archive.stem + "-", suffix=".zip", dir=archive.parent, delete=False
        ) as temporary:
            temp_path = Path(temporary.name)
        try:
            with zipfile.ZipFile(temp_path, "w") as destination:
                for info in infos:
                    data = payloads.get(info.filename)
                    if data is None:
                        with source.open(info, "r") as reader, destination.open(info, "w") as writer:
                            shutil.copyfileobj(reader, writer, length=1024 * 1024)
                    else:
                        destination.writestr(info, data)
            temp_path.replace(archive)
        except Exception:
            temp_path.unlink(missing_ok=True)
            raise

    verify_archive(archive)
    return sha256(archive.read_bytes())


def verify_archive(archive: Path) -> None:
    with zipfile.ZipFile(archive, "r") as source:
        manifest = json.loads(source.read(ROOT + MANIFEST).decode("utf-8"))
        records = {record["path"]: record for record in manifest["files"]}
        for relative in TARGETS:
            data = source.read(ROOT + relative)
            text = data.decode("utf-8")
            if OLD_PREFIX in text or NEW_PREFIX not in text:
                raise RuntimeError(f"Private path fixture remains in {archive.name}:{relative}")
            record = records[relative]
            if record["size"] != len(data) or record["sha256"] != sha256(data):
                raise RuntimeError(f"Embedded release manifest mismatch in {archive.name}:{relative}")


def update_release_notes(hashes: dict[str, str]) -> None:
    body = run(
        "gh", "release", "view", TAG,
        "--repo", REPOSITORY,
        "--json", "body",
        "--jq", ".body",
        capture=True,
    )
    marker = "## Privacy-sanitized asset hashes"
    if marker in body:
        body = body.split(marker, 1)[0].rstrip() + "\n"
    old_candidate_sha = "4C5750124B6420338DF4BA7D8548CA95EF13A1E16CD0A001FED202A12884210C"
    body = body.replace(old_candidate_sha, hashes[ASSET_NAMES[0]].upper())
    body += (
        "\n## Privacy-sanitized asset hashes\n\n"
        "The three attached WP5.1 archives were repacked on 2026-08-19 only to replace "
        "machine-local Windows user-path fixtures with the same-length generic placeholder "
        "`C:\\Users\\Dev\\...`. The affected embedded `release-manifest.json` file hashes "
        "were regenerated. Product code, release identity, and the current/superseded "
        "classification are unchanged. Previous whole-archive SHA-256 values no longer apply "
        "to these repacked assets.\n\n"
    )
    for name in ASSET_NAMES:
        body += f"- `{name}` — SHA-256 `{hashes[name].upper()}`\n"
    notes = Path("release-body-sanitized.md")
    notes.write_text(body, encoding="utf-8")
    run("gh", "release", "edit", TAG, "--repo", REPOSITORY, "--notes-file", str(notes))


def create_result_issue(hashes: dict[str, str]) -> str:
    lines = [
        "The three WP5.1 release assets were privacy-sanitized successfully.",
        "",
        "Machine-local Windows user-path fixtures were replaced with the same-length generic "
        "placeholder `C:\\Users\\Dev\\...`; affected embedded `release-manifest.json` hashes "
        "were regenerated.",
        "",
        "```text",
    ]
    lines.extend(f"{hashes[name]}  {name}" for name in ASSET_NAMES)
    lines.extend([
        "```",
        "",
        f"Release tag: `{TAG}`",
        f"Workflow source commit: `{os.environ['GITHUB_SHA']}`",
    ])
    result_file = Path("sanitize-result.md")
    result_file.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return run(
        "gh", "issue", "create",
        "--repo", REPOSITORY,
        "--title", "WP5.1 release asset privacy sanitization result",
        "--body-file", str(result_file),
        capture=True,
    ).strip()


def retarget_clean_tag(issue_url: str) -> str:
    run("git", "config", "user.name", "github-actions[bot]")
    run("git", "config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com")
    run(
        "git", "rm",
        ".github/workflows/wp51-sanitize-release-assets.yml",
        "scripts/wp51-sanitize-release-assets.py",
    )
    run("git", "commit", "-m", "chore: remove one-shot WP5.1 release sanitizer from tagged source")
    clean_sha = run("git", "rev-parse", "HEAD", capture=True).strip()
    run("git", "tag", "-f", TAG, clean_sha)
    run("git", "push", "origin", f"refs/tags/{TAG}", "--force")
    run(
        "gh", "issue", "comment", issue_url,
        "--repo", REPOSITORY,
        "--body",
        f"Release tag `{TAG}` was retargeted to clean source commit `{clean_sha}`, which contains "
        "the privacy-redacted path fixtures and excludes the one-shot sanitizer files.",
    )
    return clean_sha


def main() -> None:
    assets = Path("assets")
    assets.mkdir(exist_ok=True)
    run(
        "gh", "release", "download", TAG,
        "--repo", REPOSITORY,
        "--pattern", "Unity-TeamForge-0.5.1-WP5.1-path-resilience*-win-x64.zip",
        "--dir", str(assets),
    )
    archives = [assets / name for name in ASSET_NAMES]
    missing = [path.name for path in archives if not path.is_file()]
    if missing:
        raise RuntimeError(f"Missing expected release assets: {missing}")

    hashes = {archive.name: sanitize_archive(archive) for archive in archives}
    for archive in archives:
        run("gh", "release", "upload", TAG, str(archive), "--clobber", "--repo", REPOSITORY)
    update_release_notes(hashes)
    issue_url = create_result_issue(hashes)
    clean_sha = retarget_clean_tag(issue_url)

    print("WP5.1 privacy sanitization complete")
    for name in ASSET_NAMES:
        print(f"{hashes[name]}  {name}")
    print(f"clean_tag_commit={clean_sha}")


if __name__ == "__main__":
    main()

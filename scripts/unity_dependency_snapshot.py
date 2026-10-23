#!/usr/bin/env python3
"""Submit Unity UPM manifest dependencies, without claiming Unity Editor resolution.

The project has no committed Packages/packages-lock.json. Without that lock,
version fields from manifest.json are requested versions, NOT verified resolved
ones. Supported generic purls are inventory-only: GitHub advisory coverage for
UPM is not equivalent to npm or NuGet vulnerability coverage.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen


MANIFEST = Path("unity-project/Packages/manifest.json")
LOCK = Path("unity-project/Packages/packages-lock.json")
NAME = re.compile(r"^[a-z0-9][a-z0-9._-]*$")
VERSION = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9_.-]+)?$")


def read_json(path: Path) -> dict:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path}: expected JSON object")
    return value


def purl(name: str, version: str) -> str:
    if not NAME.fullmatch(name) or not VERSION.fullmatch(version):
        raise ValueError(f"Unversioned or unsupported UPM package: {name!r} @ {version!r}")
    return f"pkg:generic/{quote(name, safe='._-')}@{quote(version, safe='._-')}"


def manifest_entry(root: Path, name: str, requested: str) -> tuple[str, str]:
    """Return version and origin; do not guess versions for Git/URL references."""
    if requested.startswith("file:"):
        source = (root / MANIFEST.parent / requested[5:]).resolve()
        # Local workspaces are allowed only when they are inside this checkout.
        if not source.is_relative_to(root.resolve()):
            raise ValueError(f"{name}: local package escapes repository")
        meta = read_json(source / "package.json")
        if meta.get("name") != name:
            raise ValueError(f"{name}: local package.json name does not match")
        version = meta.get("version")
        if not isinstance(version, str):
            raise ValueError(f"{name}: local package missing version")
        return version, "local-workspace"
    if not VERSION.fullmatch(requested):
        raise ValueError(f"{name}: unhandled UPM version source {requested!r}; refusing incomplete graph")
    return requested, "manifest-declaration-unresolved"


def read_upm(root: Path) -> tuple[dict, dict]:
    manifest = read_json(root / MANIFEST)
    requested = manifest.get("dependencies")
    if not isinstance(requested, dict):
        raise ValueError("Unity manifest.dependencies must be an object")
    if not requested:
        raise ValueError("Unity manifest has no dependencies: unexpected for TeamForge")
    if any(not isinstance(k, str) or not isinstance(v, str) for k, v in requested.items()):
        raise ValueError("Unity manifest dependencies must be name/string pairs")

    lock_path = root / LOCK
    lock = read_json(lock_path) if lock_path.exists() else None
    locked = lock.get("dependencies") if lock else None
    if lock and not isinstance(locked, dict):
        raise ValueError("Unity packages-lock.dependencies must be an object")
    if lock:
        missing = set(requested) - set(locked)
        if missing:
            raise ValueError(f"Unity lock missing direct packages: {sorted(missing)}")

    resolved = {}
    versions = {}
    origins = {}
    for name, spec in requested.items():
        version, origin = manifest_entry(root, name, spec)
        versions[name], origins[name] = version, origin

    if lock:
        for name, record in locked.items():
            if not isinstance(name, str) or not isinstance(record, dict):
                raise ValueError(f"Malformed lock dependency: {name!r}")
            version = record.get("version")
            if name in requested and origins[name] == "local-workspace":
                # Local file references in Unity's lock can be a path rather
                # than a version. Use the checked-in local package.json.
                continue
            if not isinstance(version, str):
                raise ValueError(f"Lock package missing version: {name}")
            if not VERSION.fullmatch(version):
                raise ValueError(f"Unsupported lock version for {name}: {version!r}")
            versions[name] = version
            origins[name] = f"unity-lock:{record.get('source', 'unknown')}"
    for name in sorted(versions):
        url = purl(name, versions[name])
        record = {
            "package_url": url,
            "relationship": "direct" if name in requested else "indirect",
            "scope": "development" if name.startswith("com.unity.test-") else "runtime",
            "metadata": {"version_evidence": origins[name]},
        }
        if lock and name in locked:
            children = locked[name].get("dependencies", {})
            if not isinstance(children, dict):
                raise ValueError(f"Lock dependencies malformed for {name}")
            unknown = set(children) - set(versions)
            if unknown:
                raise ValueError(f"Lock missing transitive children of {name}: {sorted(unknown)}")
            record["dependencies"] = sorted(children)
        resolved[name] = record
    evidence = {
        "coverage": "unity-lock-resolved" if lock else "manifest-declarations-only",
        "lockfile_present": bool(lock),
        "declared_direct": len(requested),
        "listed_total": len(resolved),
    }
    return resolved, evidence


def make_snapshot(root: Path, repo: str, sha: str, ref: str, run_id: str) -> tuple[dict, dict]:
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise ValueError("Expected real 40-character Git commit SHA")
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo):
        raise ValueError("Invalid repository")
    if ref != "refs/heads/main":
        raise ValueError("Only trusted main commits can be submitted")
    resolved, evidence = read_upm(root)
    source = str(LOCK if evidence["lockfile_present"] else MANIFEST)
    snapshot = {
        "version": 0,
        "sha": sha,
        "ref": ref,
        "job": {
            "id": str(run_id),
            "correlator": "unity-upm-declarations",
            "html_url": f"https://github.com/{repo}/actions/runs/{run_id}",
        },
        "detector": {
            "name": "teamforge-unity-upm-manifest",
            "version": "1.0.0",
            "url": f"https://github.com/{repo}/blob/main/scripts/unity_dependency_snapshot.py",
        },
        "scanned": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "manifests": {
            str(MANIFEST): {
                "name": str(MANIFEST),
                "file": {
                    "source_location": str(MANIFEST),
                    "metadata": {"evidence": evidence["coverage"]},
                },
                "resolved": resolved,
            }
        },
    }
    return snapshot, evidence


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--submit", action="store_true", help="Submit to repository dependency graph")
    parser.add_argument("--root", default=".")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    repo = os.environ.get("GITHUB_REPOSITORY", "Eun-si123/teamforge-unity-collab")
    sha = os.environ.get("GITHUB_SHA", "0" * 40)
    ref = os.environ.get("GITHUB_REF", "refs/heads/main")
    run_id = os.environ.get("GITHUB_RUN_ID", "local-validation")
    snapshot, evidence = make_snapshot(root, repo, sha, ref, run_id)
    print("Unity package inventory: " + json.dumps(evidence, sort_keys=True), flush=True)
    if not evidence["lockfile_present"]:
        print("WARNING: Unity packages-lock.json is absent. This snapshot records "
              "DECLARED direct versions only; Unity Editor transitive packages and "
              "resolved versions remain unverified.", flush=True)
    if not args.submit:
        print("DRY RUN: no dependency submission or external changes")
        return 0

    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        raise ValueError("GITHUB_TOKEN is required for submission")
    endpoint = f"https://api.github.com/repos/{repo}/dependency-graph/snapshots"
    data = json.dumps(snapshot, separators=(",", ":")).encode("utf-8")
    req = Request(
        endpoint,
        data=data,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
            "User-Agent": "teamforge-upm-snapshot",
        },
        method="POST",
    )
    try:
        with urlopen(req, timeout=30) as response:
            reply = json.load(response)
            if response.status != 201 or reply.get("result") != "SUCCESS":
                raise RuntimeError("Dependency submission did not report SUCCESS")
            print("GitHub accepted Unity UPM dependency inventory")
    except (HTTPError, URLError) as exc:
        raise RuntimeError(f"GitHub dependency submission failed: {exc}") from exc
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, OSError, json.JSONDecodeError, RuntimeError) as exc:
        print(f"::error::{exc}", file=sys.stderr)
        sys.exit(1)

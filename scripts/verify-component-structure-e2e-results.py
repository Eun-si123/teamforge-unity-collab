#!/usr/bin/env python3
"""Require real Collider lifecycle execution, distinct from property/model tests."""
import argparse
import json
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET

TEST = ("EunSung.TeamForge.Tests.TeamForgeColliderStructureE2ETests."
        "RealServer_ColliderAddEditSaveReopenRemoveAndReconnect")
CHECKS = ("logicalAddRemove", "multipleSameType", "propertyEdit",
          "saveReopenBinding", "conditionalUndoRedo", "reconnectRecovery",
          "pendingAckLossRecovery")


def read_bounded(file: Path, maximum: int) -> bytes:
    if file.is_symlink() or not file.is_file():
        raise ValueError("Missing nonredirected lifecycle evidence: " + file.name)
    with file.open("rb") as stream:
        data = stream.read(maximum + 1)
    if not data or len(data) > maximum:
        raise ValueError("Invalid lifecycle evidence size: " + file.name)
    return data


def unique_fields(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate lifecycle evidence field")
        result[key] = value
    return result


def read_object(file: Path):
    result = json.loads(read_bounded(file, 16384), object_pairs_hook=unique_fields)
    if not isinstance(result, dict):
        raise ValueError("Lifecycle evidence must be a JSON object")
    return result


def verify(results: Path, evidence: Path, source_sha: str) -> None:
    if not re.fullmatch(r"[0-9a-f]{40}", source_sha):
        raise ValueError("An exact tested source SHA is required")
    raw = read_bounded(results, 16 * 1024 * 1024)
    if b"<!DOCTYPE" in raw.upper() or b"<!ENTITY" in raw.upper():
        raise ValueError("Disallowed NUnit XML declaration")
    root = ET.fromstring(raw)
    all_cases = list(root.iter("test-case"))
    cases = [case for case in all_cases if case.get("fullname") == TEST]
    if (root.tag != "test-run" or len(cases) != 1 or
            cases[0].get("result") != "Passed" or root.get("failed") != "0" or
            root.get("inconclusive") != "0" or
            root.get("total") != str(len(all_cases))):
        raise ValueError("The actual production Collider lifecycle Unity case did not pass exactly once")
    editor = read_object(evidence / "result.json")
    peer = read_object(evidence / "fixture-result.json")
    remote = read_object(evidence / "peer-result.json")
    if (editor.get("passed") is not True or peer.get("passed") is not True or
            type(editor.get("editorCount")) is not int or editor["editorCount"] != 1 or
            type(editor.get("nodePeerCount")) is not int or editor["nodePeerCount"] != 1 or
            any(editor.get(check) is not True for check in CHECKS) or
            editor.get("sourceSha") != source_sha or peer.get("sourceSha") != source_sha or
            not isinstance(editor.get("unityVersion"), str) or
            not editor["unityVersion"] or len(editor["unityVersion"]) > 64 or
            editor["unityVersion"] != peer.get("unityVersion") or
            peer.get("evidenceClass") != "one-unity-editor-plus-node-peer" or
            peer.get("remoteCommitted") is not True or remote.get("remoteCommitted") is not True):
        raise ValueError("Collider lifecycle Editor/peer evidence is incomplete or inconsistent")
    print("PASS: production Collider add/edit/save-reopen/remove, conditional Undo/Redo "
          "and ACK-loss/reconnect; one Unity Editor + Node peer, not multi-Editor field evidence")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--results", type=Path, required=True)
    parser.add_argument("--evidence", type=Path, required=True)
    parser.add_argument("--source-sha", required=True)
    args = parser.parse_args()
    try:
        verify(args.results, args.evidence, args.source_sha)
    except (OSError, ValueError, ET.ParseError) as error:
        print("Collider lifecycle E2E evidence refused: " + str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Require this run's real Collider Editor test and Node peer completion."""
import argparse
import json
from pathlib import Path
import sys
import xml.etree.ElementTree as ET

TEST = ("EunSung.TeamForge.Tests.TeamForgeColliderLiveE2ETests."
        "RealServer_ContinuousColliderUndoRemoteApplyAndReconnectRecovery")


def read_bounded(file: Path, maximum: int) -> bytes:
    if file.is_symlink() or not file.is_file():
        raise ValueError("Missing nonredirected Collider evidence file: " + file.name)
    with file.open("rb") as stream:
        data = stream.read(maximum + 1)
    if not data or len(data) > maximum:
        raise ValueError("Invalid Collider evidence size: " + file.name)
    return data


def verify(results: Path, evidence: Path, source_sha: str) -> None:
    raw = read_bounded(results, 16 * 1024 * 1024)
    if b"<!DOCTYPE" in raw.upper() or b"<!ENTITY" in raw.upper():
        raise ValueError("Disallowed NUnit XML declaration")
    root = ET.fromstring(raw)
    all_cases = list(root.iter("test-case"))
    cases = [case for case in all_cases if case.get("fullname") == TEST]
    if (root.tag != "test-run" or len(cases) != 1 or cases[0].get("result") != "Passed" or
            root.get("failed") != "0" or root.get("inconclusive") != "0" or
            root.get("total") != str(len(all_cases))):
        raise ValueError("Actual production Collider Unity test did not execute and pass exactly once")
    editor = json.loads(read_bounded(evidence / "result.json", 16384))
    peer = json.loads(read_bounded(evidence / "fixture-result.json", 16384))
    remote = json.loads(read_bounded(evidence / "peer-result.json", 16384))
    if (editor.get("passed") is not True or editor.get("editorCount") != 1 or
            editor.get("nodePeerCount") != 1 or not editor.get("unityVersion") or
            any(editor.get(check) is not True for check in (
                "continuousEdit", "conditionalUndoRedo", "remoteApply", "nativeUndoConflict",
                "pendingAckLossRecovery", "reconnectRecovery")) or
            peer.get("passed") is not True or peer.get("remoteCommitted") is not True or
            peer.get("evidenceClass") != "one-unity-editor-plus-node-peer" or
            peer.get("sourceSha") != source_sha or not source_sha or
            peer.get("unityVersion") != editor.get("unityVersion") or
            remote.get("remoteCommitted") is not True):
        raise ValueError("Collider Editor/peer evidence is incomplete or inconsistent")
    print("PASS: production Collider roundtrip, conditional Undo/Redo and reconnect; "
          "one Unity Editor + Node peer (not two-Editor field evidence)")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--results", type=Path, required=True)
    parser.add_argument("--evidence", type=Path, required=True)
    parser.add_argument("--source-sha", required=True)
    args = parser.parse_args()
    try:
        verify(args.results, args.evidence, args.source_sha)
    except (OSError, ValueError, ET.ParseError) as error:
        print("Collider E2E evidence refused: " + str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

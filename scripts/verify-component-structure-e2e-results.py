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
PRIMITIVE_CHECKS = ("primitiveCreate", "primitiveRemoteApply", "primitiveColliderEdit",
                    "primitiveReconnectDelete")
UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")


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


def verify_durable_reparent(evidence, editor, peer, source_sha, restart, renamed):
    before = read_object(evidence / "durable-reparent-ready.json")
    moved = read_object(evidence / "durable-reparent-result.json")
    if (any(row.get("durableReparentVerified") is not True for row in (editor, peer, moved)) or
            any(row.get("sourceSha") != source_sha or row.get("authorityEpoch") != restart["newEpoch"] or
                row.get("durableSessionId") != restart["durableSessionId"] for row in (before, moved)) or
            not isinstance(restart.get("sphereObjectId"), str) or
            not re.fullmatch(r"tf:[0-9a-f]{32}", restart["sphereObjectId"]) or
            before.get("objectId") != restart["sphereObjectId"] or moved.get("objectId") != before.get("objectId") or
            before.get("parentObjectId") != "" or moved.get("parentObjectId") != restart["cubeObjectId"] or
            type(moved.get("siblingIndex")) is not int or moved["siblingIndex"] != 0 or
            before.get("localPosition") != {"x": -3, "y": 2, "z": 1} or
            moved.get("localPosition") != {"x": 0.25, "y": 0.5, "z": 0.75} or
            moved.get("localRotation") != {"x": 0, "y": 0, "z": 0, "w": 1} or
            moved.get("localScale") != {"x": 1, "y": 1, "z": 1} or
            not isinstance(moved.get("operationId"), str) or not 1 <= len(moved["operationId"]) <= 128 or
            type(before.get("serverRevision")) is not int or before["serverRevision"] < renamed["serverRevision"] or
            any(type(before.get(key)) is not int or not 0 <= before[key] <= before["serverRevision"]
                for key in ("hierarchyRevision", "transformRevision")) or
            type(moved.get("serverRevision")) is not int or moved["serverRevision"] <= before["serverRevision"]):
        raise ValueError("Reviewed reparent restart evidence is missing or inconsistent")
    print("PASS: durable placement archive survived restart and submitted a same-Scene reparent under a fresh child lease")
    return moved


def verify_durable_sibling(evidence, editor, peer, source_sha, restart, renamed, reparented):
    before = read_object(evidence / "durable-sibling-ready.json")
    after = read_object(evidence / "durable-sibling-result.json")
    owner, cube, sphere = renamed["objectId"], restart["cubeObjectId"], restart["sphereObjectId"]
    if (any(row.get("durableSiblingVerified") is not True for row in (editor, peer, after)) or
            any(row.get("sourceSha") != source_sha or row.get("authorityEpoch") != restart["newEpoch"] or
                row.get("durableSessionId") != restart["durableSessionId"] or row.get("objectId") != owner or
                row.get("parentObjectId") != "" for row in (before, after)) or
            before.get("order") != [owner, cube, sphere] or after.get("order") != [cube, sphere, owner] or
            after.get("transformUnchanged") is not True or
            type(before.get("serverRevision")) is not int or before["serverRevision"] <= reparented["serverRevision"] or
            type(before.get("hierarchyRevision")) is not int or not 0 <= before["hierarchyRevision"] <= before["serverRevision"] or
            type(after.get("serverRevision")) is not int or after["serverRevision"] != before["serverRevision"] + 1 or
            type(after.get("hierarchyRevision")) is not int or after["hierarchyRevision"] != after["serverRevision"] or
            not isinstance(after.get("operationId"), str) or not 1 <= len(after["operationId"]) <= 128):
        raise ValueError("Reviewed sibling reconnect evidence is missing or inconsistent")
    print("PASS: sibling order survived save and reconnect and a reviewed move committed without changing Transform state")


def verify(results: Path, evidence: Path, source_sha: str, require_primitive: bool = False,
           require_durable: bool = False, require_durable_transform: bool = False,
           require_durable_hierarchy: bool = False, require_durable_reparent: bool = False,
           require_durable_sibling: bool = False) -> None:
    require_durable_reparent = require_durable_reparent or require_durable_sibling
    require_durable_hierarchy = require_durable_hierarchy or require_durable_reparent
    require_durable_transform = require_durable_transform or require_durable_hierarchy
    require_durable = require_durable or require_durable_transform
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
    if require_primitive or require_durable:
        if (any(editor.get(check) is not True for check in PRIMITIVE_CHECKS) or
                peer.get("primitiveVerified") is not True):
            raise ValueError("Shared primitive Editor creation, remote apply, edit or reconnect/delete evidence is missing")
        print("PASS: shared Cube/Sphere built-in visuals, Collider edits, rejoin and atomic deletion")
    if require_durable:
        restart = read_object(evidence / "durable-restart-result.json")
        resubmit = read_object(evidence / "durable-resubmit-result.json")
        if (editor.get("durableRestartVerified") is not True or peer.get("durableRestartVerified") is not True or
                restart.get("durableRestartVerified") is not True or
                restart.get("sourceSha") != source_sha or
                any(not isinstance(restart.get(key), str) or not UUID.fullmatch(restart[key])
                    for key in ("oldEpoch", "newEpoch", "durableSessionId")) or
                restart["oldEpoch"] == restart["newEpoch"] or
                type(restart.get("serverRevision")) is not int or restart["serverRevision"] < 1 or
                not isinstance(restart.get("sphereComponentId"), str) or
                not re.fullmatch(r"tf:c:[0-9a-f]{32}", restart["sphereComponentId"]) or
                resubmit.get("durableResubmitVerified") is not True or resubmit.get("sourceSha") != source_sha or
                resubmit.get("authorityEpoch") != restart["newEpoch"] or
                resubmit.get("componentId") != restart["sphereComponentId"] or resubmit.get("value") != 2.5 or
                type(resubmit.get("serverRevision")) is not int or resubmit["serverRevision"] <= restart["serverRevision"]):
            raise ValueError("Durable Session restart evidence is missing or inconsistent")
        print("PASS: Coordinator restart restored exact primitive and Collider state and preserved a reviewed offline edit")
        if require_durable_transform:
            transform = read_object(evidence / "durable-transform-result.json")
            if (editor.get("durableTransformVerified") is not True or peer.get("durableTransformVerified") is not True or
                    transform.get("durableTransformVerified") is not True or transform.get("sourceSha") != source_sha or
                    transform.get("authorityEpoch") != restart["newEpoch"] or
                    transform.get("durableSessionId") != restart["durableSessionId"] or
                    not isinstance(restart.get("cubeObjectId"), str) or not re.fullmatch(r"tf:[0-9a-f]{32}", restart["cubeObjectId"]) or
                    transform.get("objectId") != restart["cubeObjectId"] or
                    transform.get("localPosition") != {"x": 6, "y": 1, "z": -2} or
                    transform.get("localScale") != {"x": 1.5, "y": 2, "z": 0.75} or
                    type(transform.get("serverRevision")) is not int or transform["serverRevision"] <= resubmit["serverRevision"]):
                raise ValueError("Reviewed Transform restart evidence is missing or inconsistent")
            print("PASS: durable Transform archive survived restart and submitted a reviewed pose under a fresh lease")
            if require_durable_hierarchy:
                before = read_object(evidence / "durable-hierarchy-ready.json")
                renamed = read_object(evidence / "durable-hierarchy-result.json")
                if (editor.get("durableHierarchyVerified") is not True or peer.get("durableHierarchyVerified") is not True or
                        renamed.get("durableHierarchyVerified") is not True or
                        any(item.get("sourceSha") != source_sha or item.get("authorityEpoch") != restart["newEpoch"] or
                            item.get("durableSessionId") != restart["durableSessionId"] for item in (before, renamed)) or
                        not isinstance(before.get("objectId"), str) or
                        not re.fullmatch(r"GlobalObjectId_V1-2-[0-9a-f]{32}-[1-9][0-9]{0,19}-0", before["objectId"]) or
                        renamed.get("objectId") != before["objectId"] or
                        before.get("name") != "M2 authoritative owner before Collider join" or
                        renamed.get("name") != "M4 reviewed local Hierarchy name" or
                        not isinstance(renamed.get("operationId"), str) or not renamed["operationId"] or
                        len(renamed["operationId"]) > 128 or
                        type(before.get("serverRevision")) is not int or before["serverRevision"] < transform["serverRevision"] or
                        type(before.get("hierarchyRevision")) is not int or not 0 <= before["hierarchyRevision"] <= before["serverRevision"] or
                        type(renamed.get("serverRevision")) is not int or renamed["serverRevision"] <= before["serverRevision"]):
                    raise ValueError("Reviewed Hierarchy restart evidence is missing or inconsistent")
                print("PASS: durable Hierarchy archive survived restart and submitted one reviewed rename under a fresh lease")
                if require_durable_reparent:
                    reparented = verify_durable_reparent(evidence, editor, peer, source_sha, restart, renamed)
                    if require_durable_sibling:
                        verify_durable_sibling(evidence, editor, peer, source_sha, restart, renamed, reparented)
    print("PASS: production Collider add/edit/save-reopen/remove, conditional Undo/Redo "
          "and ACK-loss/reconnect; one Unity Editor + Node peer, not multi-Editor field evidence")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--results", type=Path, required=True)
    parser.add_argument("--evidence", type=Path, required=True)
    parser.add_argument("--source-sha", required=True)
    parser.add_argument("--require-primitive", action="store_true")
    parser.add_argument("--require-durable", action="store_true")
    parser.add_argument("--require-durable-transform", action="store_true")
    parser.add_argument("--require-durable-hierarchy", action="store_true")
    parser.add_argument("--require-durable-reparent", action="store_true")
    parser.add_argument("--require-durable-sibling", action="store_true")
    args = parser.parse_args()
    try:
        verify(args.results, args.evidence, args.source_sha, args.require_primitive, args.require_durable,
               args.require_durable_transform, args.require_durable_hierarchy, args.require_durable_reparent,
               args.require_durable_sibling)
    except (OSError, ValueError, ET.ParseError) as error:
        print("Collider lifecycle E2E evidence refused: " + str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

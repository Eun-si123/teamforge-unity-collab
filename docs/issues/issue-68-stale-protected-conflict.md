# Issue #68 — Stale ProtectedConflict remains after remote authoritative updates

## Summary

A Transform Sync correctness issue was identified where a peer that attempted to modify an object owned by another peer can enter a protected conflict state that does not automatically recover after the lock owner continues making valid authoritative changes.

Related GitHub issue: #74

## Reproduction

1. Peer B acquires the Transform lock for an object.
2. Peer A repeatedly attempts to move the same object through Unity SceneView/Gizmo input.
3. Peer A receives a Transform rejection.
4. Peer A enters ProtectedConflict state.
5. Peer B continues moving the object normally.

## Observed behavior

Expected:

- Peer B remains the authoritative owner.
- Peer A should recover once the authoritative state has converged, or clearly remain blocked only while an unresolved local edit exists.

Actual:

- Peer B continues modifying the object successfully.
- Peer A continues receiving conflict warnings whenever B's authoritative Transform updates arrive.
- Peer A requires disconnect/reconnect to clear the state.

## Current flow

Rejected local Transform:

```
Transform update
    ↓
server rejection
    ↓
ProtectedConflictKeys.Add(object)
    ↓
_syncBlocked = true
```

Later remote authoritative updates:

```
Peer B Transform update
    ↓
Peer A receives transform_applied
    ↓
ProtectedConflictKeys already contains object
    ↓
warning continues
```

## Suspected cause

The ProtectedConflict lifecycle currently has a strong fail-closed behavior but lacks a safe recovery path after authoritative remote convergence.

The system protects against silently overwriting local rejected edits, but the conflict state can become stale.

## Proposed direction

Add controlled recovery:

- Detect authoritative convergence from a valid remote Transform update.
- Confirm the local editor is not actively modifying the object.
- Clear stale ProtectedConflict state.
- Restore local observed/confirmed Transform state from authoritative data.

Do not clear conflicts while the local user is still actively editing.

## Classification

- Area: Unity Editor Transform Sync
- Type: Correctness / state lifecycle
- Severity: Medium

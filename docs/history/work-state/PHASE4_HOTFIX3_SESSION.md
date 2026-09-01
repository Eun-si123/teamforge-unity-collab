# Phase 4 v0.5.0 Hotfix3 session

Date: 2026-08-08 (Asia/Seoul)
Unity target: `6000.3.21f1`
Scope: fix selected newly-created logical objects failing to enter Phase 2 Transform tracking after authoritative Phase 4 create acknowledgement.

## User field evidence

- Two Editors connected to the same 0.5.0 session.
- Presence: 2 members; RTT active.
- `TF_Create_Test` appeared in both Hierarchies.
- Hierarchy status reached revision 2 / `rename_object`, 5 objects, 0 conflicts.
- Same object Transform diverged between Editors.
- Creator Editor showed `Object is not in the clean Scene baseline...`; other Editor could show `Lock owned.`

## Root cause

The selection event for a newly-created GameObject occurs before authoritative `create_object` acceptance. `BeginTrackingSelection` correctly rejects the object while it is absent from the Transform baseline. `ApplyHierarchyAuthoritativeState` later added it to the baseline but did not retry selection tracking.

## Implementation

- Re-arm the exact active single selection when an authoritative hierarchy state newly matches it and no Transform object is currently tracked.
- Use active Transform connection state to decide whether re-arm should immediately request a lock.
- Preserve the server-approved create Transform as last observed/confirmed/lock-request state when a newer local Transform exists, keeping the local delta dirty and sendable after lock acquisition.
- Added Unity EditMode regression source and repository validator assertions.

## Automated evidence

- Root `npm test`: Server 49/49 PASS, Project Peer 62/62 PASS, validator PASS.
- Unity Hotfix3 compile/EditMode: pending user field rerun.

## Next exact gate

Expected EditMode count: 71. Then reproduce Create -> immediate selected-object move without deselect/reconnect. Both Editors must converge and creator must no longer remain on the clean-baseline warning.

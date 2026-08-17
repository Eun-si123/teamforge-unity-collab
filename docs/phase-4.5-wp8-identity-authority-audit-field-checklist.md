# Phase 4.5 WP8 Identity / Authority Audit Field Checklist

Candidate: `Unity-TeamForge-Phase4.5-WP8-identity-authority-rearm-rootcause-hotfix-candidate.zip`  
Unity: `6000.3.21f1`  
Initial status: **NOT RUN**  
Closure status until every required row passes: **BLOCKED**

Verify the adjacent `.sha256` sidecar before extraction. Extract into a new directory; do not overlay the blocked WP8 Closure or earlier saved-Transform hotfix. Record date/time, candidate SHA-256, A/B/C project roots, endpoint, Project ID, Session ID and sanitized server source hash.

## 1. Compile and EditMode gate

- [ ] Unity opens with zero TeamForge compile errors.
- [ ] Run `ReconnectRevokesPriorLogicalIdentityAndWaitsForHierarchySnapshot` independently; PASS.
- [ ] Run `HierarchyConfirmationEstablishesCurrentLogicalSelectionIdentity` independently; PASS.
- [ ] Run `AuthoritativeConfirmationAutomaticallyRearmsSelectedTransform` independently; PASS.
- [ ] Run `AutomaticRearmRequestsLockWithCurrentCanonicalLogicalIdentity` independently; PASS.
- [ ] Repeat the automatic re-arm and Lock tests at least three times; every run PASS.
- [ ] Run `StaleLogicalTransformCreatesAnIsolatedProtectedConflictWithoutHidingRearmRootCause` independently; PASS.
- [ ] Run `AuthoritativeHierarchyCreateRearmsSelectedTransformTrackingAndPreservesPendingDelta` independently; PASS.
- [ ] Repeat that test at least three times; every run PASS.
- [ ] Run the complete `TeamForgeIdentityAuthorityAuditTests` class; all cases PASS.
- [ ] Run the complete `TeamForgeTransformModelTests` class; all cases PASS.
- [ ] EditMode Run All reports exactly `123/123`, failed 0, skipped 0.
- [ ] No result from a different ZIP/project root is recorded as candidate evidence.

## 2. Cache-asymmetric saved Presence gate

Prepare A as the original Project. Exercise Hierarchy identity so A may retain `Library/TeamForge/hierarchy-ids-v1.json`. Recreate B/C through the standard Test Lab; their copied source must exclude `Library`.

- [ ] A selects the saved root: B and C show A's remote wireframe/label.
- [ ] B selects the same saved root: A and C show B's remote wireframe/label.
- [ ] Repeat A -> B and B -> A on a saved child whose saved parent also has an A-side logical alias.
- [ ] Re-select after deselect and after Scene close/open; results remain direction-independent.
- [ ] Record the exact object/parent names only as test labels, never as identity evidence.

## 3. Saved Transform and Lock parity

- [ ] A edits saved root Position/Rotation/Scale; B/C receive it after A obtains the Lock.
- [ ] B edits the same saved root; A/C receive it after B obtains the Lock.
- [ ] Repeat both directions for the saved child with the aliased saved parent.
- [ ] Lock owner/status, release and post-release acquisition are correct in both directions.
- [ ] No dirty-Scene/baseline warning is bypassed. A deliberate divergent dirty Scene still fails closed.

## 4. Runtime logical object parity

- [ ] A creates a runtime GameObject; B/C receive exactly one logical object, then Presence and Transform work.
- [ ] B creates a runtime GameObject; A/C receive exactly one logical object, then Presence and Transform work.
- [ ] Rename, reparent, reorder and delete are verified once with A as actor and once with B as actor.
- [ ] Delete does not resurrect the object and clears exact matching remote selection/Lock state.
- [ ] Do not expect MeshFilter, MeshRenderer, Collider, material, prefab or serialized Component synchronization; that remains out of scope.

## 5. reconnect and Late Join

- [ ] Keep a saved object selected, disconnect/reconnect A, and confirm Presence is re-emitted under the current canonical identity.
- [ ] No Lock request is sent under a stale prior-session `tf:` identity before the new authority snapshot confirms it.
- [ ] After confirmation, saved and runtime objects can obtain Locks and send Transform updates normally.
- [ ] Join C late. C receives Hierarchy before Transform, resolves current Presence selections, and sees the latest revision/Locks without duplicates.
- [ ] Repeat actor/observer roles so A and B labels do not determine the outcome.

## 6. Project minimum smoke

- [ ] Publish a baseline with the existing Project Peer CLI.
- [ ] Generate/use the existing signed Invite and join from another Project root.
- [ ] Sync through Direct HTTP and verify descriptor/manifest/chunk/final hashes and atomic activation.
- [ ] Confirm Project payload bytes do not pass through the TeamForge Server.

## 7. Project UUID diagnostic

The message `Rejected Project Coordinator message: A non-empty Project registry requires a Project UUID.` is not accepted as a normal transient. If it appears with a new timestamp:

- [ ] Record UTC timestamp, endpoint, Unity project root and exact candidate SHA.
- [ ] Record the running Server cwd/source hash.
- [ ] Capture the sanitized `project_registry_snapshot` shape; redact transfer tokens and credentials.
- [ ] Mark the field gate FAIL and retain evidence. Do not suppress the warning or infer a UUID from a peer/Baseline.

## Result

- Unity EditMode: PASS / FAIL / NOT RUN
- Saved Presence identity directions: PASS / FAIL / NOT RUN
- Saved Transform/Lock directions: PASS / FAIL / NOT RUN
- Runtime Hierarchy/Presence/Transform/Lock: PASS / FAIL / NOT RUN
- reconnect/Late Join: PASS / FAIL / NOT RUN
- Project Publish/Invite/Sync: PASS / FAIL / NOT RUN
- Project UUID warning observed: YES / NO
- Overall field gate: PASS / FAIL / NOT RUN

Tester/date/notes:

# TeamForge Phase 4 v0.5.0 Manual Test Checklist

Use the exact packaged candidate and Unity `6000.3.21f1`. Do not reuse a dirty test Scene when a step requires a clean saved baseline. Preserve the Phase 3 closure artifact separately.

## A. Artifact / compile gate

- [ ] Candidate ZIP SHA-256 matches its sidecar.
- [ ] Extract to a new short Windows path.
- [ ] `npm ci`, root tests, smoke and validator pass on the extracted candidate.
- [ ] Unity project opens with Console Compile Error 0.
- [ ] EditMode `Run All` reports Failed 0, including `TeamForgeHierarchyModelTests`.
- [ ] `Window > TeamForge > Collaboration` opens and shows `Hierarchy Sync`.

## B. Two-Editor setup

Use two copies of the same clean saved Project/Scene and the same Project ID + Session ID. Use different TeamForge user identities.

- [ ] Both Editors connect; Presence shows 2 members and RTT updates.
- [ ] Open the same saved `SampleScene` in both Editors.
- [ ] Existing Phase 2 Transform + Lock still works before hierarchy edits.
- [ ] Hierarchy status is enabled/ready and no conflict is shown.

## C. Create

In Editor A:

- [ ] Create a new empty GameObject under the Scene root.
- [ ] Name it `Created-A` and give it a non-default local position.
- [ ] Editor B receives exactly one object with the same name, parent, sibling position and local transform.
- [ ] Rename or move the new object after creation; both Editors continue referring to the same object rather than producing duplicates.

## D. Rename

- [ ] A renames `Created-A` to `Created-Renamed`.
- [ ] B receives the rename.
- [ ] A then renames to a duplicate name already used by another GameObject; identity remains distinct and both Editors converge.

## E. Reparent

Create saved/known parents `Parent-A` and `Parent-B` if needed.

- [ ] A reparents the shared created object under `Parent-A`; B matches.
- [ ] B reparents it under `Parent-B`; A matches.
- [ ] Local Transform remains the transmitted authoritative local value after reparent.
- [ ] Attempting a parent cycle is rejected/reverted and both Editors remain on the previous valid hierarchy.

## F. Sibling order

Create at least three siblings.

- [ ] Move one shared object to first sibling position in A; B matches exact order.
- [ ] Move it to last in B; A matches.
- [ ] No duplicate sibling index or random oscillation occurs.

## G. Delete / tombstone

Create a parent with a created child.

- [ ] Select the child on Editor B so Presence advertises the selection.
- [ ] Editor A deletes the parent.
- [ ] Parent and child disappear on B.
- [ ] B's stale remote Presence selection for the deleted identity is cleared.
- [ ] Deleted identity does not reappear from a late Transform/hierarchy update.

## H. Lock conflict

- [ ] B acquires a lock on a hierarchy target; A structural edit of that target is rejected/reverted.
- [ ] B locks a destination parent; A create/reparent into that parent is rejected/reverted.
- [ ] B locks a descendant; A subtree delete containing that descendant is rejected/reverted.
- [ ] Release the lock; the same operation can then succeed at the current revision.

## I. Revision conflict

Generate two near-simultaneous structural edits from A and B from the same visible hierarchy revision.

- [ ] Exactly one authoritative operation wins first.
- [ ] The stale operation receives hierarchy conflict/rejection rather than silent last-write-wins.
- [ ] Both Editors converge after the conflict path.

## J. Late join

- [ ] With A/B already containing created/renamed/reparented/reordered objects, open Editor C from the same compatible baseline.
- [ ] C receives Presence, then hierarchy snapshot, then Transform snapshot without duplicate hierarchy objects.
- [ ] C matches current names, parents, sibling order and transforms.
- [ ] Deleted/tombstoned objects do not appear.

## K. Fail-closed contexts

- [ ] Unsaved/dirty incompatible first Scene snapshot is not silently overwritten.
- [ ] Prefab Stage / unsupported Prefab structural edit is blocked or not synchronized with a clear diagnostic.
- [ ] Cross-Scene reparent is blocked or not synchronized with a clear diagnostic.
- [ ] A clean Project baseline that does not match an already-live logical-ID hierarchy session fails closed instead of duplicating objects.

## L. Older-client authority guard

If a Phase 2-only client fixture is available:

- [ ] It can still connect/Presence as supported.
- [ ] It cannot acquire Transform/Lock authority for a Scene already authoritative under Phase 4 hierarchy.
- [ ] Phase 4 clients remain healthy.

## M. Phase 3 regression

- [ ] Publish Preview and explicit Publish work.
- [ ] Signed Invite -> fresh Receiver Sync -> fingerprint approval -> `state: Complete`.
- [ ] Active contains Assets/Packages/ProjectSettings and TeamForge package; no token/Owner key/`.env`.
- [ ] Short-path Active opens with Console Error 0 and TeamForge connects/RTT updates.
- [ ] Seed offline wording does not break realtime collaboration.
- [ ] Resume, Seed failover and Abort/port rebind remain functional in the focused regression or automated evidence.

## N. Final regression

- [ ] Presence, Selection, Frame Selection and Go to Camera pass.
- [ ] Bidirectional Transform Sync passes.
- [ ] Basic Lock acquire/release/conflict passes.
- [ ] Server health/logs show hierarchy metadata counts but no Project payload storage/relay.
- [ ] No Bearer token/private key/invite secret appears in evidence logs.
- [ ] No Critical/High unresolved regression remains.

Only after these checks should Phase 4 be marked complete. Phase 5 is a separate decision and must not start automatically.

## Hotfix3 targeted create-to-Transform regression

- [ ] Unity 6000.3.21f1 compiles the exact Hotfix3 package with no TeamForge compile errors.
- [ ] EditMode `Run All` reports 71/71 PASS.
- [ ] Editor A creates a new empty GameObject and leaves it selected; Editor B receives the same logical object.
- [ ] Without deselecting/reconnecting, A changes Position/Rotation/Scale after create acknowledgement.
- [ ] A no longer remains on `Object is not in the clean Scene baseline`; lock/Transform tracking activates automatically.
- [ ] B converges to A's Transform.
- [ ] No hierarchy conflict, transform rejection, duplicate object, or identity resurrection is observed.

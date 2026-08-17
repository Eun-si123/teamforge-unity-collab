# TeamForge Phase 4.5 Field Closure Checklist

Candidate: `Unity-TeamForge-Phase4.5-WP8-identity-authority-rearm-rootcause-hotfix-candidate.zip`  
Required Unity: `6000.3.21f1`  
Field result before execution: **NOT RUN**

The prior Closure, saved-Transform, identity/authority audit and reconciliation ZIPs are **BLOCKED** and must not be used to close the phase. Use only the exact root-cause hotfix ZIP and verify its adjacent SHA-256 sidecar. This checklist is user field evidence; automated/static/Node results do not mark any item below PASS. Run the focused [identity/authority audit checklist](phase-4.5-wp8-identity-authority-audit-field-checklist.md) as part of this gate.

## 1. Evidence header

- Tester:
- Date/time and timezone:
- Candidate SHA-256:
- Windows/OS versions for A, B and C:
- Unity version shown by each Editor:
- Node version for Server and Project Peer:
- Network topology: same PC / LAN / VPN / other:
- Server address and realtime path, with credentials omitted:
- Project ID / Session ID, with secrets omitted:
- Clean saved Scene path and Scene GUID:
- A/B/C user names and stable IDs, with tokens omitted:

## 2. Artifact and process preparation

- [ ] SHA-256 of the downloaded ZIP exactly matches the sidecar.
- [ ] Extract the ZIP to a new short path. Do not overlay WP7 or another working tree.
- [ ] Preserve the WP7 rollback ZIP, Unity Projects, `TeamForgeProjects` and Owner key backup separately.
- [ ] Run `npm.cmd --prefix server ci` and `npm.cmd --prefix project-peer ci`.
- [ ] Run Server/Project Peer tests, checks, smoke and `node scripts/validate-repository.mjs`; record exact counts.
- [ ] Open the included Unity validation project in `6000.3.21f1`; Console has zero TeamForge compile errors.
- [ ] EditMode Run All reports exactly `123/123`, failed 0, skipped 0.
- [ ] Prepare A, B and C from the same clean saved Project/Scene baseline. Use distinct TeamForge user identities and the same Project ID + Session ID.
- [ ] Ensure there is no unsaved work in A/B/C before the initial authoritative snapshot.

## 3. A/B connection and Presence

- [ ] Start the TeamForge Server from the Closure candidate.
- [ ] Connect A, then B. Both reach Connected and show the same negotiated capabilities.
- [ ] A and B each show exactly two distinct members; no duplicate identity appears.
- [ ] Select a saved GameObject in A. B shows A's name/color and the remote selection wireframe.
- [ ] Clear A's selection. B clears the remote selection without Scene mutation.
- [ ] Move A's Scene camera. B's Presence entry updates and `Go to Camera` reaches the expected view.
- [ ] Presence-only changes do not create Scene dirty state or a normal Undo item.

## 4. Bidirectional Transform and Lock

Use one saved baseline root object, one saved parent and one saved child. Ensure A has exercised Hierarchy identity before clone creation so A may retain `Library/TeamForge/hierarchy-ids-v1.json`; B/C must be fresh Test Lab clones whose copied source excludes `Library`.

- [ ] A selects the saved root, acquires its Lock and changes local Position, Rotation and Scale.
- [ ] B converges to the same local values and shared Session Revision.
- [ ] While A still owns the Lock, B cannot acquire/write the target; any attempted local edit is rejected/reconciled without divergence.
- [ ] A releases/deselects. B then acquires the Lock and changes the Transform.
- [ ] A converges to B's values. Remote apply marks the Scene dirty but does not add a normal user Undo step that can resurrect stale authority.
- [ ] Repeat A→B and B→A on the saved child whose saved parent also has a `tf:` alias in A; no parent-baseline warning or tracking refusal occurs.
- [ ] Move the saved child locally in A, then attempt a B edit. A must first have sent/acquired authority for its own edit; record any silent overwrite or missing Lock request as FAIL.
- [ ] Disconnecting the Lock owner or waiting beyond the lease releases the Lock and permits the other Editor to acquire it.

## 5. Hierarchy Create/Rename/Reparent/Delete

Use saved parents `Parent-A` and `Parent-B`.

- [ ] In A, create an empty GameObject under `Parent-A`, name it `Created-A`, and set a non-default local Transform.
- [ ] B receives exactly one object with the same identity, parent, sibling placement and local Transform.
- [ ] A renames it to `Created-Renamed`; B receives the rename without changing its Transform.
- [ ] In B, reparent it under `Parent-B`; A matches the parent, sibling order and authoritative local Transform.
- [ ] Reorder at least three siblings in A and then B; both converge and do not oscillate.
- [ ] Hold a relevant target/parent/descendant Lock in B and attempt the corresponding A structural edit; it is rejected/reverted until the Lock is released.
- [ ] Select a child remotely, then delete its parent subtree in A. B removes the full subtree and clears stale Presence selection.
- [ ] A stale or replayed update does not resurrect the deleted identity.

## 6. C Late Join

Perform this after A/B have completed at least one Transform, Create, Rename, Reparent, Reorder and Delete.

- [ ] Start C from the same compatible clean baseline and connect it to the same Project/Session.
- [ ] C receives Presence, then authoritative Hierarchy, then Transform/Lock state; no duplicate GameObject is created.
- [ ] C matches current names, parents, sibling order, local Transforms, Revision and active Locks.
- [ ] Deleted/tombstoned objects are absent.
- [ ] A and B each show C once; disconnecting/reconnecting C does not leave a stale duplicate.
- [ ] A new edit from C converges to A and B, and an edit from A converges back to C.

## 7. Project Publish / Invite / Sync minimum smoke

Use a disposable Project copy and short managed roots. Do not put Bearer tokens or private keys in command history, screenshots or logs.

1. From Unity A, export the existing secret-free `teamforge-project-peer.launch.json` for the current Project.
2. Start Publish/Seed from the Closure candidate. Example:

```powershell
node project-peer/src/cli.mjs publish `
  --launch-settings "C:\TF-A\Project\teamforge-project-peer.launch.json" `
  --host 0.0.0.0 --port 5091 `
  --endpoint "http://<A-IP>:5091/teamforge-transfer/v1"
```

Review the deterministic diff and type `PUBLISH`. Keep the Seed process running.

3. In another terminal using the same managed root, create the signed Invite:

```powershell
node project-peer/src/cli.mjs invite create `
  --managed-root "C:\TF-A\Managed" `
  --project-id "<PROJECT-ID>" --session "<SESSION-ID>" `
  --server "http://<SERVER>:5080" `
  --output "C:\TF-Evidence\teamforge-project-invite.json"
```

4. On a fresh receiver root, sync and approve only the complete Publisher fingerprint shown by the trusted Owner channel:

```powershell
node project-peer/src/cli.mjs sync `
  --managed-root "C:\TF-B\Managed" `
  --invite "C:\TF-Evidence\teamforge-project-invite.json"
```

- [ ] Publish is acknowledged at exactly the next Baseline revision and Seed announces the same Descriptor/Manifest identity.
- [ ] Invite validates the Project UUID, Owner pin and signature.
- [ ] Receiver shows the exact Publisher fingerprint and does not activate before explicit approval.
- [ ] Descriptor, Manifest, inventory and Chunk requests use the direct Project Peer endpoint; the TeamForge Server carries metadata only.
- [ ] Sync reaches `Complete`, Active is immutable, and the atomic Current pointer selects the new revision.
- [ ] Active contains the expected Unity `Assets`, `Packages` and `ProjectSettings` content and excludes tokens, private Owner keys, `.env`, caches and the secret-free source descriptor from the Manifest.
- [ ] Opening the Active Project in Unity produces zero TeamForge compile errors and the expected Project identity/status.
- [ ] Existing Active/User Project data remains intact if a deliberate verification or approval failure is induced.

## 8. Fail-closed and log review

- [ ] A dirty incompatible initial Scene is not silently overwritten.
- [ ] Unsupported Prefab/additive/cross-scene structural work is blocked or remains unsynchronized with a clear diagnostic.
- [ ] Server restart demonstrates the documented in-memory Authority/Coordinator loss; no persistence is claimed.
- [ ] No WebRTC/ICE/STUN/TURN/relay/fallback route appears in logs or UI.
- [ ] Server logs and disk contain no Project payload files.
- [ ] Evidence contains no Bearer token, transfer token, Owner private key or raw secret.

## 9. Result record

Record each failure with exact reproduction order, Editor role, timestamp, relevant sanitized log excerpt and whether all Editors reconverged.

- A/B/C connection and Late Join: PASS / FAIL / NOT RUN
- Presence: PASS / FAIL / NOT RUN
- Transform bidirectional: PASS / FAIL / NOT RUN
- Lock: PASS / FAIL / NOT RUN
- Hierarchy Create/Rename/Reparent/Delete: PASS / FAIL / NOT RUN
- Project Publish/Invite/Sync smoke: PASS / FAIL / NOT RUN
- Security/log review: PASS / FAIL / NOT RUN
- Overall Phase 4.5 field closure: PASS / FAIL / NOT RUN
- Tester signature/approval:

Do not mark overall PASS if any required row is FAIL or NOT RUN. Phase 5 remains a separate decision even after field PASS.

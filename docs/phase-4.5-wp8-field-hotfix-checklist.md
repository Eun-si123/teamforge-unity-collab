# Phase 4.5 WP8 Saved Transform Identity Hotfix — Field Checklist

Candidate: `Unity-TeamForge-Phase4.5-WP8-field-hotfix-saved-transform-identity.zip`  
Required Unity: `6000.3.21f1`  
Initial result: **NOT RUN**  
Closure state until completion: **BLOCKED**

Use the exact candidate and adjacent SHA-256 sidecar. Do not reuse the blocked `Unity-TeamForge-Phase4.5-closure.zip`, and do not infer field PASS from the automated 106/106 result.

## Evidence header

- Tester:
- Date/time and timezone:
- Candidate SHA-256:
- A/B/C project paths:
- Scene asset path and GUID:
- Saved root / saved parent / saved child names:
- Sanitized Session ID:

## Controlled identity-cache setup

- [ ] Extract the candidate to a new path and verify SHA-256.
- [ ] Use A as the original clean saved Unity Project.
- [ ] In A, connect once or perform the existing Hierarchy workflow needed to populate `Library/TeamForge/hierarchy-ids-v1.json` for the saved root, parent and child. Do not copy or publish this file.
- [ ] Save and close the Scene cleanly, then create B/C through Standard Test Lab.
- [ ] Confirm Test Lab regenerated both clones and excluded their `Library` directories.
- [ ] Do not copy A's `Library`, `Temp`, `Logs` or `UserSettings` into B/C.

## Saved root and saved-parent child

- [ ] Connect A, then B, using distinct user identities and the same Project/Session.
- [ ] A selects the saved root, obtains its Lock and changes Position, Rotation and Scale; B converges.
- [ ] B obtains the root Lock after A releases it, changes Transform; A converges.
- [ ] A selects the saved child whose saved parent also has an A-local logical alias, obtains its Lock and changes Transform; B converges with no baseline/parent warning.
- [ ] B obtains the child Lock after A releases it, changes Transform; A converges.
- [ ] Move the saved child locally in A, then attempt B's edit while A owns the Lock. B is rejected/reconciled; A's value is not silently lost because A failed to send.
- [ ] Logs show A emitted the expected Lock/Transform activity and do not show `Object is not in the clean Scene baseline` or `Parent differs from the clean Scene baseline` for these saved objects.

## Persistence, clone recreation and logical-object parity

- [ ] Close and restart A, reconnect, and repeat saved root plus saved-child A→B Transform.
- [ ] Delete only the disposable Test Lab clone folders, regenerate B/C, and repeat A→B and B→A.
- [ ] During the session, create a new logical object in A under an allowed saved parent; B receives it and A→B Transform still works.
- [ ] Bring C online late. C receives the runtime-created object and current saved-object Transforms without duplicates or identity warnings.
- [ ] C can edit one authorized target and A/B converge.

## Safety and compatibility

- [ ] Begin with an intentionally dirty incompatible Scene in a disposable run; snapshot application remains fail-closed and does not overwrite the unsaved divergence.
- [ ] Presence and Hierarchy Create/Rename/Reparent/Delete remain functional.
- [ ] Project Publish/Invite/Sync minimum smoke passes through Server WebSocket metadata plus direct Project Peer HTTP payload transfer.
- [ ] No wire-schema, Protocol version, route, WebRTC/ICE/STUN/TURN/Relay/fallback or Phase 5 behavior appears.

## Result record

- Saved root A→B / B→A: PASS / FAIL / NOT RUN
- Saved child with saved-parent alias A→B / B→A: PASS / FAIL / NOT RUN
- Lock and no silent overwrite: PASS / FAIL / NOT RUN
- A restart: PASS / FAIL / NOT RUN
- Test Lab clone regeneration: PASS / FAIL / NOT RUN
- Runtime-created logical object: PASS / FAIL / NOT RUN
- C Late Join: PASS / FAIL / NOT RUN
- Dirty Scene fail-closed: PASS / FAIL / NOT RUN
- Presence / Hierarchy: PASS / FAIL / NOT RUN
- Project Publish/Invite/Sync: PASS / FAIL / NOT RUN
- Overall hotfix field gate: PASS / FAIL / NOT RUN
- Tester approval:

Do not mark overall PASS while any required row is FAIL or NOT RUN. After this focused checklist, complete the full [Phase 4.5 field closure checklist](phase-4.5-field-closure-checklist.md). Phase 5 remains a separate decision.

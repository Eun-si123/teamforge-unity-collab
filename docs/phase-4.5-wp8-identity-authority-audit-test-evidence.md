# Phase 4.5 WP8 Identity / Authority Audit Test Evidence

Date: 2026-08-11 (Asia/Seoul)  
Candidate: `Unity-TeamForge-Phase4.5-WP8-identity-authority-audit-candidate.zip`  
Field status: **NOT RUN / BLOCKED**

## Failing-first boundary

`TeamForgeIdentityAuthorityAuditTests.cs` was added before the product-source correction. Its saved Presence cache matrix requires the sender to emit the saved Global ID even when a persisted `tf:` alias exists; the previous implementation selected that alias and therefore contradicts the assertion.

An actual Unity red run was attempted three times in Unity `6000.3.21f1`, but the Editor stopped before compilation/Test Runner execution with licensing IPC initialization failures including `Connection to channel LicenseClient-Eun refused` and `Licensing is not yet initialized`. No result XML was produced. Therefore the failing-before Unity execution is **NOT RUN**, not a claimed FAIL/PASS. The previous field-hotfix candidate's `106/106 PASS` remains historical evidence only.

## Current-source automated evidence

| Gate | Result | Evidence boundary |
| --- | --- | --- |
| Unity EditMode | **NOT RUN** | Unity licensing prevented Test Runner start; exact expected count is `117` |
| Unity Editor assembly static compile | **PASS** | Unity `6000.3.21f1` Roslyn response/reference surface compiled product and EditMode test assemblies with exit code 0 |
| Server suite | **72/72 PASS** | Full `npm.cmd test` |
| Project Peer suite | **73/73 PASS** | Full `npm.cmd test` |
| Server syntax | **PASS** | `npm.cmd run check` |
| Project Peer syntax | **PASS** | 38 modules checked |
| Server smoke | **PASS** | health, legacy Hello/Pong, Presence, Transform/Lock and Project snapshot |
| Direct Transfer smoke | **PASS** | descriptor/manifest/inventory/payload verified; `serverRelayUsed=false` |
| Repository validator | **PASS** | Phase 4.5 identity/layer/protocol/safety invariants |
| Fresh archive install/test/check/smoke/validator | **PASS** | Exact candidate extracted to a new directory and repeated without source-tree dependencies |

Input/current parity: 312 input files versus 319 candidate files, with 25 intended changed/added paths. `server/src`, all `project-peer` files, both Protocol v1 documents and `TeamForgeProtocol.cs` are byte-identical.

Expected Unity count derives from the previously verified 106 cases plus 10 new identity-authority NUnit cases (four parameterized cache cases and six single cases) plus one Project UUID characterization case: `106 + 10 + 1 = 117`.

Static compilation is not represented as a Unity Test Runner result. Likewise, Node and validator PASS do not represent multi-Editor A/B/C evidence.

## Added regression/characterization coverage

- all four saved-object Library cache combinations, both directions;
- saved parent/child Global canonical family across Presence, Transform baseline and Hierarchy parent capture;
- runtime logical identity retained after save and authoritative baseline `Upsert`;
- Presence recanonicalization when current-session identity changes;
- persisted-only logical Presence resolution rejected until current authority binds it;
- reconnect cannot send a Lock under a prior-session logical identity;
- current-session logical child/parent rejection cannot fall back to a split saved Global key;
- stale inbound logical Transform cannot resolve through a prior-epoch persisted alias;
- Hierarchy-capable reconnect waits for snapshot readiness, then resumes under the confirmed logical key;
- pre-snapshot Global and partially-bound logical Transform/Lock snapshots cannot mutate Scene, Revision or Locks;
- a current logical object rejects an inbound split Global Transform;
- a new logical parent cannot cause a stale-key Lock/Transform before exact parent validation;
- a selected-child reparent operation pending in Hierarchy cannot be bypassed through the manual Lock API;
- additive Scene Presence routing identifies the selected object's Scene;
- empty versus UUID-bound Project registry snapshots, including Baseline/peer mismatch rejection;
- Server directional state/effect symmetry for Presence, Transform, Lock, Hierarchy, Late Join and reconnect.

## Manual evidence still required

The candidate is not closed until the user runs Unity EditMode `117/117` and the focused multi-Editor checklist. Do not convert the results above into A/B/C, reconnect, or Project Publish/Invite/Sync PASS evidence.

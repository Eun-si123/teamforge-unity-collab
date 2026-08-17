# Phase 4.5 WP8 Identity / Authority Test Reconciliation Hotfix Report

Date: 2026-08-11 (Asia/Seoul)  
Status: implementation and available automated gates complete; Unity rerun and A/B/C field gate **NOT RUN**, Phase 4.5 Closure **BLOCKED**

## Exact input

- Archive: `Unity-TeamForge-Phase4.5-WP8-identity-authority-audit-candidate.zip`
- SHA-256: `F8A4FAD7CA2F02959AD5E6B9DD52148DDC56BEC09CE394CC0CE12757C08E650D`
- Input files: 319

The input archive and its sidecar were verified before extraction. They were not overwritten. This hotfix creates a separate candidate and sidecar.

## Subsequent evidence correction

This report records the reconciliation candidate as it was produced. A later user-run full suite against that exact candidate reached **116/117 PASS** and reproduced the first failure even after the fixture explicitly installed the Selection and Authority state. The earlier label “under-specified reflection fixture” is therefore superseded.

The follow-up root-cause audit proved a narrower test-harness defect: the same mega-test directly invoked private inbound Transform application after revoking the current logical authority. That non-production call created a durable protected-conflict key, and the test then reused the contaminated state for its re-arm assertion. The actual message entrypoint rejects Transform/Lock authority messages before the Hierarchy snapshot is ready, so production ordering does not create this transition. The corrected analysis, focused tests and typed test seam are recorded in [phase-4.5-wp8-identity-authority-rearm-rootcause-hotfix-report.md](phase-4.5-wp8-identity-authority-rearm-rootcause-hotfix-report.md). This correction does not invalidate the historical `117` count or verification results recorded below for the reconciliation artifact.

## User-observed failing evidence

Unity `6000.3.21f1` EditMode Test Runner was run by the user against the exact input candidate. Two tests failed:

1. `TeamForgeIdentityAuthorityAuditTests.ReconnectDoesNotSendLockUnderUnconfirmedPriorLogicalIdentity`: expected the confirmed logical `tf:` ID after authoritative re-arm, but `SelectedObjectId` remained empty.
2. `TeamForgeTransformModelTests.AuthoritativeHierarchyCreateRearmsSelectedTransformTrackingAndPreservesPendingDelta`: expected a clean-baseline status before the newly-introduced Hierarchy snapshot gate, but received `Waiting for the authoritative Hierarchy snapshot before Transform tracking.`

These are field execution results supplied by the user. Local Unity batch reproduction and post-fix runs did not reach Test Runner execution because Unity Licensing IPC did not initialize; no result XML was produced. Local Unity execution is therefore **NOT RUN**, not PASS or FAIL.

## Classification

### FAIL 1: under-specified reflection fixture

`ApplyHierarchyAuthoritativeState()` automatically retries tracking only when the active selection is the same object and the actual GameObject selection contains exactly one object. The old fixture assigned only `Selection.activeGameObject`; it did not establish or assert `Selection.gameObjects.Length == 1`. It also left Hierarchy `_wasConnected`, Authority View state, pending Hierarchy operation, connection epoch and prior Transform tracking partly ambient.

No product re-arm invariant violation was established. The fixture now:

- installs the target through `Selection.objects` and `Selection.activeGameObject` while `SnapshotReady == false`;
- asserts the active object and exact one-element `Selection.gameObjects` array immediately before authoritative apply;
- explicitly asserts Connection state/capabilities/ID, Authority View, Transform and Hierarchy `_wasConnected`, `SnapshotReady`, pending operation, identity epoch and current-session logical membership;
- proves reconnect clears the prior logical authority and sends no Lock before the Hierarchy snapshot;
- confirms current authority with `BindLogical`, invokes only the production authoritative apply path, and verifies automatic re-arm plus a Lock request using the exact current logical ID;
- never calls `BeginTrackingSelection()` after authoritative apply.

### FAIL 2: stale expectation plus ambient connected state

The new product invariant intentionally checks a connected Hierarchy-capable session's `SnapshotReady` before baseline membership. The old test did not construct Authority/Hierarchy state, so a real connected Editor could legitimately stop at the snapshot gate while the test expected the earlier baseline message.

The reconciled test now verifies the ordered state machine explicitly:

1. selected runtime object, connected Transform + Hierarchy capabilities, `SnapshotReady == false`;
2. tracking is empty and reports the authoritative-Hierarchy wait;
3. `SnapshotReady == true`, but the logical object is absent from the Transform authority baseline, so tracking remains fail-closed;
4. production `ApplyHierarchyAuthoritativeState()` installs the logical baseline and automatically re-arms selection;
5. the pending local Transform delta remains dirty relative to the authoritative create Transform;
6. the emitted Lock request uses the logical ID.

The concrete pre-authority status after the snapshot becomes ready is `Save the Scene before synchronizing this object.` because a current logical ID rejected by the exact baseline is not allowed to fall back to a saved Global ID. The test also asserts the missing baseline entry directly. This preserves the clean-baseline rejection without weakening canonicalization.

## Test isolation

A test-only `TeamForgeSharedEditorStateScope` snapshots and restores every shared state mutated by these two tests:

- raw Selection array and active object;
- Connection transport, state, capabilities, connection ID and message counter;
- Authority View revision and Lock registry;
- Hierarchy `_wasConnected`, `SnapshotReady` and pending operation;
- Transform connection and full selected-object tracking state;
- Transform operation/conflict/blocked collections;
- Transform baseline and its `SessionState` serialization;
- connection identity epoch and current-session logical-ID set.

Selection restoration uses the production selection-lock suppression scope and restores the captured Transform fields last, preventing a restoration callback from sending a Lock or replacing the captured state. Tests do not rely on method order or a previously connected Editor.

## Product and protocol parity

There are **no product/runtime source changes**. All files under Unity `Editor/`, `server/src/` and `project-peer/` are byte-identical to the exact input. Protocol v1, Project Transfer v1, wire schema, snapshot ordering, identity/authority gates, Revision, Lock, Hierarchy, Tombstone, dirty-Scene protection and transport behavior are unchanged.

## Official documentation reviewed

- Unity `Selection.activeGameObject`: identifies the active GameObject shown in the Inspector; it does not describe the complete selection array.  
  https://docs.unity3d.com/6000.3/Documentation/ScriptReference/Selection-activeGameObject.html
- Unity `Selection.gameObjects`: returns the actual GameObject selection.  
  https://docs.unity3d.com/6000.3/Documentation/ScriptReference/Selection-gameObjects.html
- Unity `Selection.objects`: exposes and permits assignment of the actual unfiltered selection. This is used to install a deterministic one-object fixture.  
  https://docs.unity3d.com/6000.3/Documentation/ScriptReference/Selection-objects.html
- Unity `Selection.selectionChanged`: states that the callback is triggered when selection changes, but defines no ordering guarantee relative to other Editor callbacks. The tests therefore assert state rather than depending on callback timing.  
  https://docs.unity3d.com/6000.3/Documentation/ScriptReference/Selection-selectionChanged.html
- Unity Test Framework EditMode tests: `UnityTest` execution advances through the `EditorApplication.update` loop, while ordinary NUnit tests do not implicitly wait for a later Editor frame.  
  https://docs.unity3d.com/Packages/com.unity.test-framework@2.0/manual/edit-mode-vs-play-mode-tests.html
- Unity `GlobalObjectId`: remains the saved authoring identity; no name/path/Selection inference was introduced.  
  https://docs.unity3d.com/6000.3/Documentation/ScriptReference/GlobalObjectId.html
- Unity `InitializeOnLoad`: static initialization occurs at Editor load and script/domain reload, so static services can pre-exist an individual test and must be isolated explicitly.  
  https://docs.unity3d.com/6000.3/Documentation/ScriptReference/InitializeOnLoadAttribute.html
- Microsoft C# events guidance: publishers retain subscribers until unsubscribe and event subscribers run when the publisher raises the event. This supports explicit static-event state isolation instead of assuming a pristine process.  
  https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/events/how-to-subscribe-to-and-unsubscribe-from-events

## Verification

| Gate | Result |
| --- | --- |
| User input-candidate Unity run | **FAIL**, two named tests; user field evidence |
| Local failing-before Unity run | **NOT RUN**; Licensing IPC blocked Test Runner, no XML |
| Reconnect test, independent/repeated | **NOT RUN**; same Licensing IPC blocker |
| Re-arm test, independent/repeated | **NOT RUN**; same Licensing IPC blocker |
| Both test classes | **NOT RUN**; same Licensing IPC blocker |
| Full Unity EditMode suite | **NOT RUN**, expected `117` |
| Unity `6000.3.21f1` Roslyn product/test compile surface | **PASS** |
| Server | **72/72 PASS** |
| Project Peer | **73/73 PASS** |
| Server / Project Peer syntax checks | **PASS** |
| Server smoke / Direct Transfer smoke | **PASS** |
| Repository validator | **PASS** |
| Fresh archive file/hash parity | **PASS**; 321/321 files, SHA-256 mismatches 0 |
| Fresh archive Unity Roslyn product/test compile | **PASS** |
| Fresh archive Server / Project Peer | **72/72 PASS; 73/73 PASS** |
| Fresh archive syntax/smoke/validator | **PASS** |

The final ZIP digest is recorded in the adjacent sidecar and final handoff. Static compile and Node results are not substituted for Unity Test Runner or multi-Editor field evidence.

## Historical rerun instruction — superseded

The following was the reconciliation candidate's original handoff instruction and is retained only as historical evidence. **Do not use that candidate or its `117/117` count to close Phase 4.5.** The active rerun target is the separately named root-cause hotfix candidate with expected `123/123`, as specified in [phase-4.5-wp8-identity-authority-rearm-rootcause-hotfix-report.md](phase-4.5-wp8-identity-authority-rearm-rootcause-hotfix-report.md).

Use the separate reconciliation candidate and run, in order:

1. each of the two formerly failing tests independently;
2. each test repeatedly;
3. `TeamForgeIdentityAuthorityAuditTests` as a class;
4. `TeamForgeTransformModelTests` as a class;
5. full EditMode Run All, expected `117/117`;
6. the existing A/B/C identity/authority field checklist.

Phase 4.5 Closure remains **BLOCKED** until the exact reconciliation candidate passes Unity and the A/B/C field gate. Phase 5 and additional networking or synchronization work remain out of scope.

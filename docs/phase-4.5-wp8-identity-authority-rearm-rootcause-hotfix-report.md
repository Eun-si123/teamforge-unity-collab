# Phase 4.5 WP8 Identity / Authority Re-arm Root Cause Hotfix Report

Date: 2026-08-11 (Asia/Seoul)  
Status: implementation and available automated gates complete; Unity Test Runner and A/B/C field gate **NOT RUN**, Phase 4.5 Closure **BLOCKED**

## Exact input and evidence boundary

- Input archive: `Unity-TeamForge-Phase4.5-WP8-identity-authority-test-reconciliation-hotfix-candidate.zip`
- Input SHA-256: `B2DAC04C72F7D0F048158A09208A1699F3C40E148DE85F9D43E70DBC271E55B5`
- Input files: 321
- User field evidence for this exact input: Unity `6000.3.21f1` EditMode **116/117 PASS**, with only `TeamForgeIdentityAuthorityAuditTests.ReconnectDoesNotSendLockUnderUnconfirmedPriorLogicalIdentity` failing because the expected current `tf:` ID was empty.

The archive and adjacent sidecar were verified before extraction and were not overwritten. This hotfix produces a separately named candidate. Local Unity batch execution did not reach Test Runner execution because Licensing IPC did not initialize; no XML was produced. Every local Unity Test Runner row in this report is therefore **NOT RUN**, never inferred from static compilation or Node tests.

## Root cause proof

The previous classification “under-specified reflection fixture” was not retained as fact. The fixture's exact transition sequence and every re-arm guard were audited again.

The sole deterministic cause was state contamination inside one reflection-heavy mega-test:

1. The test revoked the prior logical ID from the current connection epoch.
2. It then bypassed the normal message entrypoint and invoked private `ApplyAuthoritativeTransform()` directly with that unconfirmed `tf:` ID.
3. The product correctly rejected the logical ID and inserted `(sceneId, logicalId)` into `ProtectedConflictKeys`.
4. The test subsequently called `BindLogical()` and installed authoritative Hierarchy state, but a newly confirmed identity does not erase an unresolved protected conflict.
5. `ApplyHierarchyAuthoritativeState()` matched the exact selected object, upserted the logical Transform baseline, removed the Hierarchy-block key and invoked the production automatic re-arm path.
6. Selection, Scene, current-session logical ID, baseline, canonical parent, snapshot-ready and pending-operation checks all passed. `BeginTrackingSelection()` then rejected at the intended protected-conflict guard, so `SelectedObjectId` remained empty.

This is not the normal production sequence. The real Transform message entrypoint rejects all Transform/Lock authority messages while a negotiated Hierarchy snapshot is not ready. The real Hierarchy snapshot/live paths perform authority update, object resolution/materialization and `BindLogical()` before marking the snapshot ready and calling Transform authoritative apply. The test's direct private apply created a transition that those production entrypoints do not permit.

Clearing `ProtectedConflictKeys` during Hierarchy confirmation would make the old mega-test green but would weaken dirty/conflict fail-closed behavior. No such change was made.

## Focused invariant tests

The contaminated mega-test was replaced by seven focused tests with independent state scopes:

- `ReconnectRevokesPriorLogicalIdentityAndWaitsForHierarchySnapshot`
- `HierarchyConfirmationEstablishesCurrentLogicalSelectionIdentity`
- `AuthoritativeConfirmationAutomaticallyRearmsSelectedTransform`
- `AutomaticRearmRequestsLockWithCurrentCanonicalLogicalIdentity`
- `StaleLogicalTransformCreatesAnIsolatedProtectedConflictWithoutHidingRearmRootCause`
- `CurrentLogicalAuthorityRejectsGlobalTransformAndAcceptsExactLogicalTransform`
- `PendingLogicalParentChangeCannotSendLockOrTransformUnderStaleIdentity`

The re-arm path now models the production order exactly:

`previous epoch revoked -> snapshot wait -> Hierarchy authority registry update -> object resolution -> BindLogical -> SnapshotReady -> ApplyHierarchyAuthoritativeState -> automatic re-arm -> Lock`

No test calls `BeginTrackingSelection()` after authoritative apply. Stale inbound Transform coverage enters through the actual message entrypoint. The protected-conflict case ends in its own isolated scope and is not reused by the successful re-arm case.

Replacing one old test with seven focused tests adds six cases. The expected full EditMode count is therefore **123**, from the user's `117`-test reconciliation baseline plus six.

## Minimal testability seam

An internal `TeamForgeTransformSelectionResolution` value and `TeamForgeTransformSelectionRejection` enum now expose the existing selection decision as:

- canonical Scene ID;
- canonical object ID;
- canonical parent ID;
- typed rejection reason.

`ResolveTransformSelectionIdentity()` preserves the former guard order and performs the same baseline, parent, Hierarchy, protected-conflict and snapshot checks. `BeginTrackingSelection()` consumes the typed result and maps every rejection to the existing status text and side effects. `MatchesAuthoritativeSelection()` expresses the exact re-arm match without requiring the tests to inspect private state. The test assembly receives internal access through `InternalsVisibleTo`; no public/static API was added.

This is a testability refactor in Unity Editor product source, not a behavior change. Protocol v1, Project Transfer v1, message ordering, wire schemas, Authority/Revision/Lock/Hierarchy/Tombstone semantics, public APIs and UI status text are unchanged.

## Canonical identity rules reverified

- A saved Scene object uses `GlobalObjectId` as its default persistent baseline identity.
- A persisted `Library/TeamForge` `tf:` alias alone is a local cache fact, not current authority.
- Only a logical ID confirmed in the current connection identity epoch can be canonical.
- Once current authority confirms a logical ID, rejecting its exact baseline cannot silently fall back to Global and split Server keys.
- Reconnect starts a new identity epoch and revokes authority granted by the preceding epoch.
- Parent identity uses the same rules; saved parent aliases cannot independently grant authority.
- The Hierarchy snapshot gate, clean Scene baseline, parent validation, dirty Scene fail-closed behavior, Lock authority, Revision and Tombstone protections remain mandatory.

## Official documentation reviewed and implementation impact

- [Unity GlobalObjectId](https://docs.unity3d.com/6000.3/Documentation/ScriptReference/GlobalObjectId.html): a project-scoped authoring identity that is stable across Editor sessions for saved objects; Scene objects require a saved Scene and resolution requires that Scene to be loaded. It remains the saved baseline key.
- [Unity Selection.activeGameObject](https://docs.unity3d.com/6000.3/Documentation/ScriptReference/Selection-activeGameObject.html), [Selection.gameObjects](https://docs.unity3d.com/6000.3/Documentation/ScriptReference/Selection-gameObjects.html) and [Selection.objects](https://docs.unity3d.com/6000.3/Documentation/ScriptReference/Selection-objects.html): active selection and the actual selection array are distinct surfaces. Fixtures install and assert an exact one-object selection.
- [Unity Selection.selectionChanged](https://docs.unity3d.com/6000.3/Documentation/ScriptReference/Selection-selectionChanged.html): documents that a callback occurs when selection changes, but does not promise synchronous timing, subscriber order or a callback for same-value assignment. The tests do not rely on those unstated guarantees.
- [Unity Selection.entityIds](https://docs.unity3d.com/6000.3/Documentation/ScriptReference/Selection-entityIds.html) and [Unity 6.3 upgrade guide](https://docs.unity3d.com/6000.3/Documentation/Manual/UpgradeGuideUnity63.html): `EntityId` is used as an Editor object/selection handle; the reviewed sources do not establish it as a saved collaboration identity, so it does not replace `GlobalObjectId` or current-epoch authority.
- [Unity Test Framework EditMode versus PlayMode](https://docs.unity3d.com/Packages/com.unity.test-framework@2.0/manual/edit-mode-vs-play-mode-tests.html): an EditMode `UnityTest` advances through Editor update yields, while ordinary NUnit tests should not assume an implicit later update. The focused tests assert synchronous production calls rather than inventing callback timing.
- [Unity domain reloading](https://docs.unity3d.com/6000.3/Documentation/Manual/domain-reloading.html), [AssemblyReloadEvents](https://docs.unity3d.com/6000.3/Documentation/ScriptReference/AssemblyReloadEvents.html) and [InitializeOnLoad](https://docs.unity3d.com/6000.3/Documentation/ScriptReference/InitializeOnLoadAttribute.html): static Editor state can pre-exist tests and reload boundaries do not provide per-test isolation. Each focused scenario snapshots/restores the shared Selection, connection, authority, hierarchy, transform, baseline and identity-epoch state it mutates.
- [Microsoft C# `internal`](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/internal) and [InternalsVisibleToAttribute](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.compilerservices.internalsvisibletoattribute): the decision seam stays internal and is exposed only to the Editor test assembly, avoiding a new public API.

The state scope also restores the Hierarchy scan-scheduled flag. Scenario construction performs its own exception cleanup, and teardown marks the fake connection/Hierarchy/Transform services disconnected before replacing the temporary Scene. This prevents Scene callbacks or a constructor assertion failure from leaking ambient state into the next EditMode test.

## Verification

| Gate | Result |
| --- | --- |
| User run of exact input | **116/117 PASS; 1 FAIL**; field evidence supplied by the user |
| Each new formerly-failing invariant test independently | **NOT RUN**; Licensing IPC blocked Test Runner before execution |
| Repeated focused tests | **NOT RUN**; same blocker |
| `TeamForgeIdentityAuthorityAuditTests` class | **NOT RUN**; same blocker |
| `TeamForgeTransformModelTests` class | **NOT RUN**; same blocker |
| Full Unity EditMode suite | **NOT RUN**, expected `123` |
| Unity `6000.3.21f1` Roslyn product/test compile surface | **PASS** |
| Server | **72/72 PASS** |
| Project Peer | **73/73 PASS** |
| Server / Project Peer syntax checks | **PASS** |
| Server smoke / Direct Transfer smoke | **PASS** |
| Repository validator | **PASS** |
| Exact final fresh archive file/hash parity | **PASS**; 325/325 files, SHA-256 mismatches 0 |
| Fresh archive Unity Roslyn product/test compile | **PASS** |
| Fresh archive Server / Project Peer | **72/72 PASS; 73/73 PASS** |
| Fresh archive syntax/smoke/validator | **PASS** |

Static compile and Node results are not substituted for Unity Test Runner or multi-Editor field evidence.

## Required user rerun

Against `Unity-TeamForge-Phase4.5-WP8-identity-authority-rearm-rootcause-hotfix-candidate.zip`:

1. run each of the seven focused Identity/Authority tests independently;
2. repeat the automatic re-arm and exact logical Lock tests at least three times;
3. run `TeamForgeIdentityAuthorityAuditTests` as a class;
4. run `TeamForgeTransformModelTests` as a class;
5. run EditMode Run All, expected exactly `123/123`, failed 0, skipped 0;
6. run the existing A/B/C identity/authority and Project Publish/Invite/Sync field checklist.

Phase 4.5 Closure remains **BLOCKED** until that exact candidate passes the Unity and field gates. Phase 5, WebRTC, Component Sync and all new product features remain out of scope.

# M1–M5 native Unity collaboration integration — 2026-11-22

This is a **source-development checkpoint**, not evidence that the next package or two physical Windows Editors passed. Current release readiness remains `FIELD_BLOCKED`.

## Intended user behavior

Use Unity's ordinary Hierarchy/Inspector/Scene workflows. Do not require `GameObject > TeamForge > Create Shared Cube` to create a built-in Cube/Sphere or `Collider Collaboration > Add shared ...` to add a default Collider. TeamForge should reuse Unity's own native objects and its existing signed Project, server authority, revision, lock, component catalog, and recovery infrastructure.

## Source integration in this branch

- The normal **owned** Host Coordinator receives the *already approved* Project Peer managed root. M1 property sync, M2 structure sync, M3 built-in primitive templates, and M4 SQLite durable Session storage are enabled for that Host without separately configuring three feature flags or a database path. Existing/externally managed Coordinators are **not** reconfigured.
- Lifecycle reuse rejects changing the approved managed root/database of an already-live owned Coordinator. SQLite's existing secure-path checks and signed Scene admission are unchanged.
- The Unity client offers supported property/structure/primitive capabilities by default. Unsupported render pipelines continue M1/M2 but cannot offer exact built-in M3 primitives.
- The Collider service joins a signed saved Scene automatically when the connection and Project pin are ready, with a bounded pin poll; automatic admission failure never auto-submits the recovery inbox. Other Scene/lineage conflicts still require review.
- A single exact **default native** BoxCollider/SphereCollider added using Unity's normal Inspector/Undo path on a selected, locked, already joined non-Prefab object is proposed through the existing authenticated M2 command. Its original native instance is adopted only if the accepted catalog has the exact logical ID and the observed native instance/properties and owner remain unchanged. Multi-add bursts, altered/unknown components, and unsafe cases remain local. No Unity-native component is silently destroyed or duplicated *by the native-origin adoption path*.
- The existing explicit shared commands remain as narrow recovery/developer fallback while native operations are expanded; the opt-in UI controls are removed from the ordinary Collider window.

## Boundaries not yet solved

- General native **Collider removal** in the ordinary Inspector and native non-default component edits require a separate exact deletion/Undo/reconciliation contract. The existing explicit `Remove shared Component` still works for the supported M2 catalog.
- Native M3 integration only recognizes exact engine-owned default Cube/Sphere shapes. Generic imported Prefab, FBX, Material and Asset creation/update after a Guest joined are not yet real-time shared; their signed initial Project transfer already exists.
- M5 has an implemented Host checkpoint preview in `main`, but Guest review/refresh PR #578 is **not merged** while trust-pin/Active activation consistency remains unresolved. No shortcut around Publisher trust, verified chunks, immutable Active or conflict review is allowed.
- A Scene change may preserve an earlier Scene's unconfirmed edits, so auto-join cannot silently discard its state. Cross-Scene collaboration belongs to M6.
- Source Node tests do not prove Unity Editor native input ordering. The amended Unity M2 EditMode E2E must run on an actual Editor, followed by packaging and two-Windows-Editor field evidence.

## Validation

- `npm run validate`: PASS.
- `npm --prefix server test`: 445 passed, 0 failed.
- `npm --prefix project-peer test`: 588 passed, 0 failed, 6 platform skips.
- Focused Host Orchestrator / Lifecycle tests: 30 passed, 0 failed. They include a real Coordinator capability handshake, managed-root reuse refusal, and source Host bootstrap.
- Unity Editor test execution in this checkout: **NOT RUN** (no Unity Editor executable available).

Do not merge until the native M2 Editor E2E and whole Unity regression checks validate the new exact-instance adoption path; do not report the legacy M5 PR as completed without fixing its trust/Active activation issue.

## Native M2 identity-safety follow-up

- A single native Inspector Collider add now waits up to 15 seconds for the selected GameObject's **existing** asynchronous shared lock before it is classified as local-only; no new lock protocol or guessed authority is introduced. An unresolved lock leaves the original Component untouched.
- If the original Inspector Component is changed or deleted before its signed add acknowledgement, the reconciliation refuses to materialize a second Collider for that exact logical operation. The source remains local for explicit conflict review.
- Authenticated topology preflight and the final pre-apply check reject an **unbound default native Collider of the same exact type** when a missing authoritative logical Collider would otherwise be materialized as a duplicate. Explicit custom local Colliders remain distinguishable and are not silently adopted as shared.
- Two new Editor-only regression tests check preflight conflict and the race where a native default is added after preflight but before application; they must pass Unity CI before merge.

## Edit-intent lock acquisition (same M2 source branch)

The native Inspector addition is itself an edit intent. If a user selected the owner only for navigation (without automatically taking a lease), the already-existing `TeamForgeTransformSyncService.RequestSelectedLock()` is invoked **once** for that exact newly observed native Collider. The operation waits for the ordinary Coordinator lease and then uses the existing M2 authority command. An external/denied lock leaves the original Unity Component local; no distinct lock protocol or inferred override is introduced.

The amended Unity + Node Peer E2E explicitly suppresses selection-only lock acquisition before performing the native Undo Add Component and verifies the original Unity Collider is adopted after lease and server acceptance. This new case is **authored, not yet executed in a local Unity Editor**; the CI result must be checked before merge.

## Exact native Inspector Collider removal (follow-up)

- The normal Unity Inspector Remove Component / Undo path now detects **only a previously observed, exactly bound live native Collider**, after its original `EntityId` has disappeared from Unity. It requires the same saved Scene, exact owner, selected GameObject and an already owned Coordinator lease. A missing name/index/type alone never authorizes a deletion.
- The operation reuses M2's `remove_component` request, exact logical ID, component revision, lock, acknowledgement and conditional Undo. The originating native Component is already absent; remote peers still remove their verified matching native Component through the existing topology transaction. Neither the sender nor its peers guess a sibling identity.
- The preflight for an accepted tombstone verifies that **every other Component identity on the owner's original native object is unchanged** since the local removal was sent. If the user restores/deletes/adds another Component before the acknowledgement, it pauses with preserved recovery instead of destroying the new work.
- Missing identities without the exact native witness/lease remain explicit recovery, as before. A pending original native removal or saved remove intent prevents recovery snapshots from silently rematerializing the missing Collider; discarding the recovery inbox explicitly allows a new verified snapshot.
- The real Unity + Node Peer M2 Editor E2E now uses `Undo.DestroyObjectImmediate` on the exact shared BoxCollider, verifies its signed tombstone and that a same-type sibling survives, and exercises existing conditional shared Undo/Redo. **New Editor execution still required.**

## Remove obsolete end-user opt-in persistence

M1/M2/M3 feature offers are now enabled by default **independent of historical `SessionState` flags**. Those flags existed only for experimental development and could silently strand a user after removing the opt-in UI. Tests still have disconnected-process scoped capability toggles, but they no longer persist across Unity assembly reload or future Editor use. Negotiation with the actual Host and signed Scene admission remains authoritative; unsupported capability does not become a fabricated operation.

## CI-reproduced rapid native Add Component selection race (2026-11-22)

- On PR #607 commit `990c947`, real Unity 6000.3.21f1 Editor E2E reported 704 passed / 1 failed / 3 skipped: the quick `Selection.activeGameObject` then `Undo.AddComponent<BoxCollider>` was missed and signed catalog remained at one Component. Evidence: [Actions job 137104130633](https://github.com/Eun-si123/teamforge-unity-collab/actions/runs/44988451950/job/137104130633). A Node-only PASS was not sufficient.
- Root cause: `Selection.selectionChanged` can run after the Inspector add. The first observer previously marked the already-added Collider as part of the old membership.
- The fix captures the **full native Collider membership per exactly verified, signed owner** as soon as the authoritative M2 snapshot is applied, rather than reconstructing the before-image from a potentially late selection callback. Unverified owners do not invent a before-image; their current Components remain local. Unambiguous observed/declined/expired additions update their local membership baseline. The full exact Editor+Node E2E must pass on the fixed head before any merge.

## Bounded native owner membership and unverified-selection guard

The rapid Inspector add fix must not turn `Selection.selectionChanged` into a global object-retention cache. Snapshot-backed owner memberships are retained **only** for owners with an exact live signed M2 Component witness. Selecting ordinary/nonadmitted Unity objects uses the existing ephemeral selected-object observation; neither the owner nor its Components enter the persistent dictionary. New and rejected native Components update that cache only when the owner already has verified membership. The Unity NUnit regression `UnverifiedSelectionNeverGrowsTheSignedColliderOwnerCache` asserts this while exercising an ordinary BoxCollider and the actual selection observer. No newly selected unverified object gains network authority.

## Saved empty owners and concurrent snapshot observation (implementation checkpoint)

- A valid signed Scene can contain an existing GameObject with **zero** Box/SphereColliders. Capturing only the M2 Component catalog misses that owner. On first verified Scene/epoch admission, the Editor now captures a bounded (up to 8,192 hierarchy nodes) pre-add native membership for exact, non-Prefab saved Scene owners, including an empty Collider set. After this, Unity's ordinary Inspector Add Component is detected even if `selectionChanged` runs after the click.
- Subsequent authoritative snapshots **reuse the first verified before-image** instead of re-enumerating each previously admitted owner's local Colliders, so an added Collider awaiting a lock/ACK is not silently treated as old when an unrelated peer edit arrives. Only newly accepted exact Component identities are appended. Switching signed Scene, Project/Session or epoch resets the cache.
- When a Scene exceeds the bounded scan, unobserved owners remain local-only; no guessed Component identity or unauthorized write is issued. Existing Prefab instances continue to use signed Project transfer until real-time external asset support exists.
- New Unity NUnit test `SavedOwnerWithoutColliderRetainsPreAddMembershipAcrossRepeatedServerSnapshots` exercises a saved initially empty owner, late selection, native `Undo.AddComponent<SphereCollider>` and an unrelated repeated snapshot. Authored for later Unity Editor batch verification; **not run or promoted on this checkpoint**.

## Lost-receipt origin retirement

An Inspector-created Collider can have a lost M2 acknowledgement. When the existing bounded operation retries are exhausted, `StructureRecovery` retains the exact original intent. A **later verified authoritative snapshot** is the point at which an unaccepted native origin can be retired from the in-memory add slot, without deleting the original Collider or inventing a new Component ID. This removes a permanent UI blockage: the user can add other ordinary Colliders while reviewing the first recovery item. If the exact M2 add is still pending, origin retirement is prohibited. The new Editor NUnit `NativeAddWithLostReceiptDoesNotBlockFutureInspectorAddsAfterVerifiedSnapshot` covers both boundaries; **not run for this development checkpoint**.

## Native Add Component held by a foreign or delayed lock

An ordinary Inspector-added Collider is an edit intent, **not** proof of ownership. When the selected GameObject's lease is absent, request it through the already-existing Transform authority path at most once per observation/selection attempt. The original native Collider remains untouched. After 15 seconds, publish only one local status warning; **do not consume the observed Collider as if it were accepted**. If the exact owner later acquires its legitimate lock, the same default native instance can still be proposed through M2. Deselect/reselect or reconnect permits a fresh bounded attempt. This replaces the prior behavior that permanently classified a transiently blocked Collider as a local-only baseline, forcing users into the manual shared-add menu. No foreign lock is bypassed, no extra lock protocol is introduced, and Editor/physical-peer evidence remains pending.

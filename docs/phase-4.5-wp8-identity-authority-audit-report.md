# Phase 4.5 WP8 Comprehensive Identity / Authority Audit Report

Date: 2026-08-11 (Asia/Seoul)  
Product: `0.5.0`  
Unity: `6000.3.21f1`  
Status: implementation and automated package gates complete; Unity/multi-Editor field gate **NOT RUN**, Closure **BLOCKED**

## Scope and input

This work audits and corrects only confirmed Phase 4.5 identity-contract defects. It does not begin Phase 5, Component Sync, another network route, WebRTC, Protocol v2 or WP9.

Exact input:

- `Unity-TeamForge-Phase4.5-WP8-field-hotfix-saved-transform-identity.zip`
- SHA-256 `53D624AC05634001EFBCBD3207F4EB7EA7579F2D8E92973E734823508A48A32D`
- 312 source entries

The input and prior WP8 artifacts remain unchanged. This audit produces the separate `Unity-TeamForge-Phase4.5-WP8-identity-authority-audit-candidate.zip` and adjacent SHA-256 sidecar.

Exact source parity comparison found 25 intended changed/added paths and no deletion: 6 Unity product C# files, 4 Unity test/meta files, 2 Server test files, the validator and 12 documents. `server/src`, the complete `project-peer` tree, both Protocol v1 documents and Unity protocol source have zero byte differences from the 312-entry input.

## Field facts and confirmed root cause

The earlier saved-Transform hotfix is retained. User field evidence confirms saved A -> B Transform, B -> A Transform and runtime-created Transform now work.

The new Presence asymmetry was confirmed in source:

1. A retained `Library/TeamForge/hierarchy-ids-v1.json` with a saved Global-to-`tf:` alias.
2. `TeamForgePresenceService.CaptureSample()` called `TryGetCollaborativeObjectId()`.
3. The previous resolver preferred the persisted local logical alias over the saved Global ID.
4. A therefore transmitted `tf:`. A Library-less B clone had no mapping that could resolve it.
5. B transmitted the saved Global ID, which A could resolve through Unity, producing the observed A -> B failure and B -> A success.

The Server intentionally treats `(sceneId, objectId)` as exact strings and has no alias-equivalence protocol. The defect was the Unity producer promoting a local cache hint, not WebSocket ordering or Project Transfer.

## Other actual defects found and corrected

- Presence cached its selected ID across current-authority identity changes. It now invalidates selected/resolved caches when the connection identity epoch or logical binding changes.
- Transform `SessionState` could retain a prior-session logical baseline key. A new connection now revokes current-session logical authority, so selection cannot request a Lock under a stale `tf:` key before the new Hierarchy snapshot confirms it.
- A current-session logical object rejected by a consumer baseline could fall back to its saved Global ID, splitting Hierarchy from Lock/Transform under two exact keys. That condition now fails closed, including for the parent.
- Inbound Transform could resolve a prior-epoch logical alias through the persisted cache. Logical snapshot/live Transform now requires current-epoch confirmation before object resolution or mutation.
- A rejected/not-yet-ready Hierarchy snapshot did not gate the following Transform snapshot/live/Lock authority messages. Hierarchy-capable connections now reject that entire authority stream until `SnapshotReady`, including Revision/Lock mutation.
- A current logical object could still accept an inbound Global Transform through a dual/stale baseline, and a local/pending parent change could reach an automatic or manual Lock request before safe parent confirmation. Inbound object identity must now equal the current canonical key; every Lock request/renewal revalidates, selected-object pending Hierarchy operations block Lock requests, and Hierarchy changes force the next validation immediately.
- Presence could combine the active Scene ID with a selected object from another loaded additive Scene. When a selection ID is sent, Scene routing now describes the selected object's Scene.
- Live Hierarchy capture could reuse a persisted-only alias. It now reuses only a current-session logical identity; otherwise it uses existing authoritative Global identity or creates a new logical identity for a true runtime object.
- Registry replacement now removes conflicting reverse/live mappings so one Global/live object does not retain multiple current logical bindings.

## Items investigated but not changed

- The previous saved-Transform canonicalization is correct: exact logical baseline membership can win for an authoritative runtime object; otherwise the saved object and parent use Global baseline keys. Baseline membership, parent match and dirty-Scene fail-closed checks remain in force.
- WP2 Session Authority, WP3 Project Coordinator, WP4 Authority View, WP5 Strategy/Factory, WP6 Transfer Source and WP7 Policy/Profile do not own Scene identity canonicalization and showed no product-source violation requiring edits.
- Server and Project Peer product/runtime source remain byte-identical to the input.
- Component/serialized property/prefab/material synchronization remains an explicit Phase 4 limitation and was not implemented.

## Project UUID warning audit

`Rejected Project Coordinator message: A non-empty Project registry requires a Project UUID.` is emitted only for an invalid snapshot with empty top-level UUID and a non-null Baseline or non-empty peer registry. The legal initial transient is `projectUuid=""`, `baseline=null`, `peers=[]` and is accepted.

Current Coordinator transitions create Project UUID/Baseline before publishing a peer and construct snapshots synchronously from one registry state. The current Server host and Unity FIFO dispatch preserve the existing ordered frame path. The warning therefore is not classified as a normal transient and was not suppressed. Characterization now freezes empty, fully UUID-bound, Baseline-mismatch, peer-mismatch and same-user supersede shapes. If the warning recurs, exact timestamp, running Server provenance and a credential-redacted raw snapshot are required; no UUID is inferred from another field.

## Implemented identity contract

- Saved clean Scene object and saved parent: valid saved `GlobalObjectId` by default.
- Runtime object: authoritative `tf:` only after the current connection's Hierarchy authority binds it.
- Persisted `Library` alias: local resolution hint only; never sufficient authority.
- `EntityId`: local live-object lookup only; never persisted or transmitted as canonical identity.
- Consumer-specific baseline membership is still required after common canonicalization.
- On connection replacement/reconnect, current-session logical authority is cleared and rebuilt from the new authoritative state.
- Hierarchy-capable Transform/Lock tracking waits for the new Hierarchy snapshot. A rejected current logical key never falls back to a different saved Global key.
- Inbound Transform/Lock authority messages are ignored until that snapshot is ready; after readiness, the resolved object's canonical key must exactly equal the wire key.
- No name, Hierarchy path or sibling-index identity inference exists.

The full consumer-by-consumer contract is in [the identity matrix](phase-4.5-wp8-identity-contract-matrix.md).

## Official research and implementation impact

| Official source | Confirmed behavior and implementation impact |
| --- | --- |
| [Unity 6.3 GlobalObjectId](https://docs.unity3d.com/6000.3/Documentation/ScriptReference/GlobalObjectId.html) | A project-scoped stable authoring ID for saved objects. Saved Scene objects use it as the default canonical wire key. |
| [GetGlobalObjectIdSlow](https://docs.unity3d.com/6000.3/Documentation/ScriptReference/GlobalObjectId.GetGlobalObjectIdSlow.html) and [global resolver](https://docs.unity3d.com/6000.3/Documentation/ScriptReference/GlobalObjectId.GlobalObjectIdentifierToObjectSlow.html) | Default/null or unresolved IDs fail closed; the fix does not invent a name/path fallback. |
| [Unity Asset metadata](https://docs.unity3d.com/6000.3/Documentation/Manual/AssetMetadata.html) | Scene asset identity includes `.meta` GUID state. A Test Lab copy with Scene/meta but no Library may retain saved identity while losing local alias cache. That cross-project result is treated as a tested project workflow, not a claim of global cross-project uniqueness. |
| [Unity importing assets](https://docs.unity3d.com/6000.3/Documentation/Manual/ImportingAssets.html) and [Asset Database contents](https://docs.unity3d.com/6000.3/Documentation/Manual/asset-database-contents.html) | `Library` is regenerable local cache. `Library/TeamForge` cannot grant protocol authority. |
| [Object.GetInstanceID](https://docs.unity3d.com/6000.3/Documentation/ScriptReference/Object.GetInstanceID.html), [Object.GetEntityId](https://docs.unity3d.com/6000.3/Documentation/ScriptReference/Object.GetEntityId.html) and [EntityIdToObject](https://docs.unity3d.com/6000.3/Documentation/ScriptReference/Resources.EntityIdToObject.html) | Entity/instance identifiers remain process-local lookup handles, not saved/wire identity. |
| [Unity SessionState](https://docs.unity3d.com/6000.3/Documentation/ScriptReference/SessionState.html) | It survives assembly reload but not Editor exit and is not cross-process authority. Prior-session logical baseline state must be revalidated on reconnect. |
| [AssemblyReloadEvents](https://docs.unity3d.com/6000.3/Documentation/ScriptReference/AssemblyReloadEvents.html), [domain reload](https://docs.unity3d.com/6000.3/Documentation/Manual/domain-reloading.html) and [InitializeOnLoad](https://docs.unity3d.com/6000.3/Documentation/ScriptReference/InitializeOnLoadAttribute.html) | Static maps/event subscriptions are transient and reloadable. Correctness does not depend on a particular static-constructor callback order. |
| [Selection.selectionChanged](https://docs.unity3d.com/6000.3/Documentation/ScriptReference/Selection-selectionChanged.html) and [hierarchyChanged](https://docs.unity3d.com/6000.3/Documentation/ScriptReference/EditorApplication-hierarchyChanged.html) | Callbacks invalidate caches, but actual send paths still revalidate canonical/baseline state; callback ordering is not authority. |
| [Unity Scene isDirty](https://docs.unity3d.com/6000.3/Documentation/ScriptReference/SceneManagement.Scene-isDirty.html) and [SaveScene](https://docs.unity3d.com/6000.3/Documentation/ScriptReference/SceneManagement.EditorSceneManager.SaveScene.html) | The fix does not auto-save or bypass dirty Scene protection to obtain an identity. |
| [Unity Editor command-line arguments](https://docs.unity3d.com/6000.3/Documentation/Manual/EditorCommandLineArguments.html) | Multi-Editor validation continues to use separate project roots rather than opening one project path concurrently. |
| [Microsoft static constructors](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/classes-and-structs/static-constructors) and [event subscription](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/events/how-to-subscribe-to-and-unsubscribe-from-events) | Static initialization is domain-scoped and event references persist until unsubscribed. The fix uses the existing named/static lifecycle and makes identity changes idempotent instead of adding blocking initialization. |
| [RFC 6455 WebSocket](https://www.rfc-editor.org/rfc/rfc6455) | Existing ordered message transport remains unchanged; the Project UUID diagnostic is not hidden as an assumed reorder transient. |

## Failing-first and test evidence

The saved Presence/cache matrix and reconnect tests were added before the product edit. The prior code's alias-first branch contradicts their required Global ID. Actual Unity red execution could not start because Unity licensing IPC was not initialized; no XML exists, so no executed red result is claimed.

Current automated results:

- Unity EditMode: **NOT RUN**, expected `117`.
- Unity product and EditMode assemblies: static compile **PASS** with the Unity `6000.3.21f1` compiler/reference surface.
- Server: **72/72 PASS**.
- Project Peer: **73/73 PASS**.
- Server/Project Peer syntax and smoke: **PASS**.
- repository validator: **PASS**.
- exact fresh archive install/test/check/smoke/validator: **PASS**.

Detailed provenance is in [the automated evidence report](phase-4.5-wp8-identity-authority-audit-test-evidence.md). Static compile is not a Unity Test Runner PASS, and none of these results is multi-Editor field evidence.

## Safety and protocol parity

The correction does not remove or weaken clean baseline membership, parent validation, dirty Scene/local unsaved work protection, Lock/Revision authority, Tombstones, Project UUID/signatures, content hashes, path containment, verified Staging or atomic activation. Persisted aliases have less authority than before.

Realtime Protocol v1, Project Transfer v1, Manifest schema 1, capability/snapshot ordering, error codes, message fields and all active routes are unchanged. The only active realtime route remains Server WebSocket; the only Project payload route remains project-peer Direct HTTP.

## Remaining limitations and field gate

- Component Sync, serialized properties, prefab/material synchronization and general Asset Sync remain unimplemented.
- A fresh clone containing a previously saved runtime logical object but no compatible binding cannot safely infer that identity; it fails closed rather than matching by name/path.
- Server/Coordinator authority remains memory-only; Phase 5 recovery is not started.
- The Project UUID warning needs raw field provenance if it recurs.
- Unity `117/117`, A/B/C saved Presence, saved Transform/Lock, runtime logical operations, reconnect/Late Join and Project Publish/Invite/Sync are still user-run checks.

Use [the focused field checklist](phase-4.5-wp8-identity-authority-audit-field-checklist.md). Phase 4.5 Closure remains **BLOCKED** until that exact candidate passes. No additional implementation is authorized by this report.

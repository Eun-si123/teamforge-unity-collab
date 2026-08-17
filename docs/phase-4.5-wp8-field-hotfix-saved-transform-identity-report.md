# Phase 4.5 WP8 Field Hotfix — Saved Transform Identity

Date: 2026-08-11 (Asia/Seoul)  
Product: `0.5.0`  
Scope: saved-baseline Transform identity asymmetry only  
Closure state: **BLOCKED — exact A/B/C multi-editor revalidation NOT RUN**

## Exact input and output boundary

The exact input is the preserved `Unity-TeamForge-Phase4.5-closure.zip`, SHA-256 `859D0806238A588187D76A14E4575CE04E2E1348CFA7DB4F6CF68CEA2571987D`, with 309 source entries. It is not overwritten.

The new candidate is `Unity-TeamForge-Phase4.5-WP8-field-hotfix-saved-transform-identity.zip`. Its SHA-256 is stored beside the archive because embedding the final hash would change the archive.

No Phase 5 or new architecture feature is included. Realtime Protocol v1, Project Transfer v1, all wire schemas, Server and Project Peer runtime behavior remain unchanged.

## Field symptom and confirmed root cause

The original A Editor can retain `GlobalObjectId` ↔ `tf:` bindings in `Library/TeamForge/hierarchy-ids-v1.json`. Test Lab explicitly excludes `Library`, so regenerated B/C clones do not inherit that local cache.

Before the fix:

1. `RegisterCleanScene()` captured saved clean objects and their parents under `GlobalObjectId` keys.
2. `BeginTrackingSelection()` used the identity registry's preferred collaborative ID. A retained alias therefore produced `tf:...`, while B/C produced `GlobalObjectId...`.
3. A then performed strict `Baseline.Contains(tf:...)` and parent matching against a baseline containing only Global IDs. Tracking stopped before Lock request or Transform update.
4. B could still send the Global ID. A resolved and applied that authoritative update, explaining the observed B→A success and overwrite of A's unsent local value.

The same mismatch applied to a saved parent: a child could be canonicalized as Global while parent validation supplied a local logical alias, or both child and parent could use aliases absent from the clean Transform baseline.

New Hierarchy-created objects behaved differently because `ApplyHierarchyAuthoritativeState()` calls `Baseline.Upsert(sceneId, logicalObjectId, logicalParentId)`. Once authority has explicitly inserted those logical keys, Transform tracking has a matching logical baseline entry. That path remains unchanged and is now an explicit canonicalization rule instead of an accidental cache-dependent result.

## Failing regression first

`SavedBaselineLogicalAliasesCanonicalizeForTrackingLockAndTransform` was added before the product fix. Against the unmodified defect, Unity `6000.3.21f1` EditMode produced **106 total, 105 passed, 1 failed**. The new test failed because the saved aliased child was not tracked (`SelectedObjectId` was empty instead of its saved Global ID).

The test covers:

- saved parent and child with valid Global IDs;
- clean Transform baseline captured under Global IDs;
- clone-like state without a `Library` alias resolving to Global ID;
- A-like persisted logical aliases on both child and parent;
- actual selection tracking choosing the baseline-canonical IDs;
- actual `lock_request` and `transform_update` payloads using the saved Global ID;
- existing runtime-created logical-object re-arm test preserving the authoritative logical identity after `Upsert`.

## Minimal fix

`TeamForgeObjectBaselineRegistry` now resolves an object in this order:

1. Use its logical ID only if that exact logical ID is already present in the Transform baseline, which means Hierarchy authority explicitly supplied it.
2. Otherwise use the saved `GlobalObjectId` when available.
3. Fall back to a logical ID only when no saved Global ID is available; all existing baseline membership checks still decide whether tracking is permitted.

The same resolver is used for parents. Local selection, continuing tracked-target validation and remote authoritative Transform parent validation now share this rule.

The fix does not remove or weaken `Baseline.Contains`, `MatchesParent`, saved-scene requirements, dirty-Scene protection, Prefab/unsupported-context guards, Lock ownership or Revision checks. It does not infer identity from names or Hierarchy paths.

## Internet research and implementation impact

Official documentation and primary references were checked before implementation:

| Source | Implementation impact |
| --- | --- |
| [Unity 6.3 `GlobalObjectId`](https://docs.unity3d.com/6000.3/Documentation/ScriptReference/GlobalObjectId.html) and [`GetGlobalObjectIdSlow`](https://docs.unity3d.com/6000.3/Documentation/ScriptReference/GlobalObjectId.GetGlobalObjectIdSlow.html) | Confirmed project-scoped saved-object identity and failure behavior. Clean saved baseline capture remains Global-ID based; no name/path inference was introduced. |
| [Unity 6.3 `Object.GetEntityId`](https://docs.unity3d.com/6000.3/Documentation/ScriptReference/Object.GetEntityId.html) and [`Resources.EntityIdToObject`](https://docs.unity3d.com/6000.3/Documentation/ScriptReference/Resources.EntityIdToObject.html) | Confirmed that local object resolution is an Editor/process lookup concern distinct from persistent cross-session Global identity; no EntityId was put on the wire. |
| [Unity 6.3 `SessionState`](https://docs.unity3d.com/6000.3/Documentation/ScriptReference/SessionState.html) | Confirmed SessionState survives assembly reload but is cleared when Unity exits. The bug cannot be safely solved by moving persisted aliases into SessionState. |
| [Unity 6.3 `AssemblyReloadEvents`](https://docs.unity3d.com/6000.3/Documentation/ScriptReference/AssemblyReloadEvents.html) | Confirmed assembly-reload callbacks are lifecycle hooks, not a stable saved-object identity source. Existing reconnect/reload behavior was retained. |
| [Unity 6.3 project upgrade guidance](https://docs.unity3d.com/6000.3/Documentation/Manual/upgrade-project.html) | Reinforced that `Library` is local generated project state. Test Lab's explicit exclusion is treated as a supported, reproducible cache asymmetry rather than a clone defect. |
| [Microsoft `IDictionary<TKey,TValue>.TryGetValue`](https://learn.microsoft.com/en-us/dotnet/api/system.collections.generic.idictionary-2.trygetvalue) | Supported exact-key alias/baseline membership checks. Canonicalization is based on explicit dictionary membership, not heuristic object names or paths. |

## Automated verification

| Gate | Working source | Exact final fresh archive |
| --- | --- | --- |
| Unity `6000.3.21f1` EditMode | **106/106 PASS** | **NOT RUN**: Unity licensing IPC/entitlement initialization prevented Test Runner start; expected count `106` |
| Server tests | **70/70 PASS** | **70/70 PASS** |
| Project Peer tests | **73/73 PASS** | **73/73 PASS** |
| Server check + smoke | **PASS** | **PASS** |
| Project Peer check + Direct Transfer smoke | **PASS** | **PASS** |
| Repository validator | **PASS**: 312 files, 51 C# sources, Protocol v1 | **PASS**: 312 source entries before generated dependencies/import artifacts |
| Archive entry/difference verification | N/A | **PASS**: exact intended changed-file set; no generated cache/dependency content |

The source Unity result is actual command-line Editor execution, not a static compilation claim. Later repeat attempts produced no result XML because Unity's licensing IPC repeatedly timed out; with the Hub stopped, Unity exited `198` with no valid entitlement. Those attempts and the fresh archive are **not** reported as PASS. A/B/C multi-editor interaction is a separate field gate.

## Parity and safety result

- Server and Project Peer trees are byte-identical to the blocked WP8 input.
- `docs/protocol-v1.md`, `docs/protocol-project-transfer-v1.md`, package manifests and wire models are unchanged.
- The only Unity C# differences are the Transform baseline model, Transform service and its EditMode regression test.
- Existing runtime-created authoritative logical identity remains selected after Hierarchy `Upsert`.
- Saved child and saved parent aliases canonicalize to the strict clean Global-ID baseline.
- Dirty Scene fail-closed behavior and all safety validation remain enabled.

## Remaining field gate and risk

The exact A/B/C multi-editor field test is **NOT RUN** and no PASS is claimed. The user must verify A-original/B/C-clone saved root and saved-child transforms in both directions, Lock behavior, Editor restart, Test Lab regeneration, runtime-created logical objects, late join and minimum Project Publish/Invite/Sync smoke using [the hotfix checklist](phase-4.5-wp8-field-hotfix-checklist.md).

Residual risk is limited to Unity Editor lifecycle/order behavior that an EditMode process cannot fully reproduce: pre-existing real-world `Library` mappings, three simultaneous Editors, reconnect timing and interactive Selection callbacks. Closure remains **BLOCKED** until those checks pass.

## Stop boundary

No WP8 expansion, Phase 5, Component Sync, WebRTC, Profile, route, fallback or Protocol v2 work was started.

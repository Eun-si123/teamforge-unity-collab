# Phase 4.5 WP8 Identity Contract and Canonicalization Matrix

Date: 2026-08-11 (Asia/Seoul)  
Status: implemented; field closure remains **BLOCKED**

## Canonical representations

| Representation | Meaning | May select a wire ID? |
| --- | --- | --- |
| Saved `GlobalObjectId` | Stable project-scoped authoring identity for a saved, loaded Scene object | Yes. It is the default canonical identity for a saved clean baseline object and saved parent. |
| Authoritative logical `tf:` ID | Runtime identity explicitly bound by the current connection's Hierarchy authority | Yes, but only for the current connection identity epoch and only where the exact authority/baseline key is accepted. |
| Persisted local alias | `GlobalObjectId <-> tf:` hint in `Library/TeamForge/hierarchy-ids-v1.json` | No. It may help local resolution, but cannot grant authority or change a saved wire identity by itself. |
| `EntityId` | Current Editor-process handle used to find a live Unity object | No. Local lookup only. |
| legacy Instance ID | Current-process/transient capture key | No. It is not persisted and is never a protocol identity. |
| name, hierarchy path, sibling index | Mutable presentation/structure | Never. No identity is inferred from these values. |

The common selection rule is: use a current-session logical ID when current Hierarchy authority confirms it and the consumer accepts the exact key. If that logical ID exists but the consumer's exact baseline rejects it, fail closed; never fall back to a second Global server key. Only an object with no current-session logical identity may use a valid saved `GlobalObjectId`. There is no name/path fallback.

## Consumer matrix

| Consumer or transition | Canonical identity rule | Authority / validation boundary | Failure behavior |
| --- | --- | --- | --- |
| Presence selected object | Current-session `tf:`; otherwise saved Global | Shared `TeamForgeObjectIdentity` canonicalizer | Omit selection if no safe identity exists |
| Presence Scene routing | Scene GUID/name of the selected object when selection is present | Saved selected Scene | Omit selection or use active Scene only when no selected ID is sent |
| Presence remote resolution | Global resolves through Unity; logical resolves only after current-session binding | Current Hierarchy identity epoch | Ignore unresolved or persisted-only logical selection |
| Transform selected/tracked object | Shared canonicalizer plus exact clean/authoritative Transform baseline membership; wait for Hierarchy snapshot when that capability is negotiated | Transform baseline and current Hierarchy snapshot | Do not track, request Lock, or send update |
| Transform parent | Same canonicalizer as the child plus exact parent match | Transform baseline parent entry | Reject/fail closed; never guess parent |
| Lock request/renew/release | Exact currently tracked Scene/object key; request/renew revalidates object and parent, selected-object pending Hierarchy blocks requests, and Hierarchy changes force the next check | Server Session Authority and local Authority View | No Lock message for untracked, pending, stale or parent-mismatched identity |
| Hierarchy clean seed | Saved Global only | Clean saved Scene and stable Global identity | Reject seed before mutation |
| Hierarchy live capture | Existing authoritative Global; otherwise current-session logical; otherwise create a new logical ID | Current Hierarchy authority registry | Never reuse a persisted-only alias as a new authority key |
| Hierarchy parent capture | Parent key from the same capture identity map | Exact parent/object relation | Reject missing/cross-Scene/unsafe relation |
| snapshot materialization | Resolve exact saved Global or bind exact authoritative logical ID | Ordered Hierarchy snapshot before Transform snapshot | Reject incompatible state; do not fabricate a match |
| live authoritative apply | Bind/apply the exact accepted object and parent IDs | Revision, Lock, Tombstone and dirty-Scene guards | Reject stale/conflicting/unsafe operation |
| runtime-created object | Current-session authoritative logical ID remains canonical, including after a later Scene save | Hierarchy authority plus baseline `Upsert` | Wait for authority before Presence/Transform/Lock |
| saved Scene object | Saved Global unless the current authority explicitly owns an accepted logical key | Saved clean baseline | Fail closed if Global is absent or baseline does not contain it |
| reconnect / connection replacement | Clear current-session logical authority; persisted aliases remain hints only; Hierarchy-capable Transform tracking waits for snapshot readiness | New `connectionId` epoch and new snapshots | No stale logical or Global-fallback Lock/Transform before confirmation |
| Late Join | Hierarchy materializes/binds logical identity before Transform/Lock application; all inbound Transform/Lock authority waits for `SnapshotReady`, then Transform requires exact canonical wire/object equality | Protocol v1 snapshot order | Reject inconsistent/stale logical or split Global state; do not reorder messages |
| delete / Tombstone | Exact authoritative Scene/object key | Session Authority Tombstone and subtree rules | Prevent resurrection; clear exact matching Presence/Lock state |

## Directional/cache matrix

The Unity regression fixture covers all four saved-object cache states and both directions inside each case:

| Sender cache | Receiver cache | A -> B | B -> A | Required saved wire identity |
| --- | --- | --- | --- | --- |
| present | absent | resolve | resolve | Global |
| absent | present | resolve | resolve | Global |
| present | present | resolve | resolve | Global |
| absent | absent | resolve | resolve | Global |

The Server characterization repeats Presence, Transform, Lock, rename, reparent, reorder, delete, Late Join and reconnect with either editor as actor and compares normalized state, revision, message order and effect-recipient roles.

## WP2-WP7 authority audit

| Boundary | Audit result |
| --- | --- |
| WP2 Session Authority | Correctly treats `(sceneId, objectId)` as exact opaque keys. Alias equivalence belongs at the Unity producer, not in server authority. |
| WP3 Project Coordinator | Project UUID/Baseline/peer snapshots are atomically empty or fully UUID-bound. It is independent of Scene object identity. |
| WP4 Authority View | Correctly observes Revision, Locks, capabilities and `connectionId`; it neither resolves objects nor persists authority. |
| WP5 Strategy/Factory | Creates the one legacy WebSocket route and has no object/Project identity rewrite. |
| WP6 Transfer Source | Descriptor/Manifest/Inventory/Chunk contract is independent of Scene identity. Direct HTTP remains the sole real adapter. |
| WP7 Policy/Profile | Has no identity, signature, hash, path or authority disable flag. Legacy defaults remain unchanged. |

Protocol v1, Project Transfer v1 and all wire schemas remain unchanged.

# WP6 signed stored Unity Scene ↔ Publisher-approved Collider values — 2026-11-09

## Material gap closed

PR #518 established that a current, registered Publisher's Ed25519-signed,
complete same-Session Collider observation and a real Project Peer
reconstructed signed .unity/.meta Scene originate from the same Project
Baseline and Scene GUID. Its positive result *does not prove any Collider
values actually appear in those bytes*; tests deliberately used a Scene
containing no Colliders. The next required, meaningfully distinct step is to
check values *inside* the verified signed stored Scene instead of accepting
a matching file digest or a Publisher's self-asserted observation.

This one-commit Draft PR stacks directly on #518, which also depends on
the independent signed Project Peer #511 and the Server #509–#517 chain.
Do not modify or auto-merge parents, and do not treat this as a live WP6
network write, actual Unity Editor attestation or shipped release.

## Implementation

- `scripts/wp6-signed-collider-value-bridge.mjs` first calls #518's
  cross-Project/Session authority check and the actual signed Project
  Peer Scene source verifier, using a CURRENT server-owned Owner key,
  Baseline/manifest/descriptor hashes and signed .unity/.meta bytes.
- For only a **small** saved text Scene (<=16 MiB, <=2048 stored chunks),
  reconstruct actual immutable signed contents via the existing
  `ChunkStore.prototype.read` opened-inode, size and SHA-256-verified
  method. Recompute the entire SHA-256 and ensure it equals the already
  independently authenticated signed Scene file hash. Never read a
  mutable working-copy file or trust a peer-supplied hash.
- `scripts/wp6-signed-collider-values.mjs` is a restricted standalone
  UTF-8 Unity text Scene document parser, aligned with Editor-side
  #513's supported Collider YAML subset. It requires Unity text
  header, valid bounded document class IDs (including 10-digit
  SceneRoots), signed 64-bit local fileIDs matched to unsigned
  `GlobalObjectId.targetObjectId`, unique document IDs,
  explicit non-Prefab GameObject owners, owner `m_Component`
  references, and exact BoxCollider/SphereCollider type + identity.
- Require a **complete** allowlisted Collider set and exactly three
  supported property paths per Collider: `m_IsTrigger` boolean,
  `m_Center` vector3 and `m_Size` vector3 or `m_Radius` float.
  Compare finite bounded float32 values to the actual serialized
  field bytes, distinguishing two same-type Colliders by fileID.
- Fail closed for missing/extra Collider docs, owner or ID mismatch,
  duplicate docs/properties, malformed or binary input,
  nonfinite/negative/out-of-bounds values, PrefabInstance or
  nonzero Prefab provenance, unsupported document forms,
  oversized files/lines and changed stored chunks.
- Bound one comparison to <=16 MiB Scene bytes, <=65,536 Unity
  documents, <=512 supported Colliders, <=16,384 chars/line and
  <=2048 chunks. Parser takes no network input or filesystem path.
- After the extra asynchronous stored-chunk reads and comparison,
  rerun #518's actual signed Source + realtime/Publisher validation,
  comparing the complete Project/Scene/source/manifest and original
  signed observation fingerprints again. A changed Session revision,
  Project epoch or Scene source causes rejection.
- Return only an immutable positive
  `signed_stored_scene_collider_values_match_approved_snapshot_offline`
  summary, with `serializedValuesVerified:true` and explicit
  `editorApplyVerified:false` and `networkWriteAuthorized:false`.

## Security and product boundaries

This is **offline** Server/Project Peer cross-check research. It now
proves that the *specific approved* Collider values correspond to the
*specific signed stored Scene bytes* (within the narrow accepted YAML
grammar). **It still cannot prove that a real Unity Editor has loaded
those exact bytes, preserved those values, or applied any remote
operation.** The server-private prepared snapshots are supplied by
integration fixtures; a real Editor-origin signed and authenticated
current Scene/value handoff is NOT implemented. Do not use an ordinary
peer's JSON or hash as such evidence.

No WebSocket handler, source or property write, active Session commit,
Editor Undo application, saved Scene mutation, durable receiver ACK,
live feature toggle, release artifact or migration is added. The
independent Unity #513/#514 strict witness and local Undo behavior must
be connected across an authenticated transport *only after* the live
trust model and repair/reconnect tests are designed and verified.

## Validation and rollback

Real ephemeral Ed25519 Owner/Publisher signed Project Peer fixtures,
real stored Scene chunks and an actual registered Coordinator and
SessionAuthority prove a complete 2-Collider matching case and
refuse a signed Scene with no Colliders; 14+ negative serialized
cases cover changed trigger, size, radius, owner, references, missing
or duplicated Collider, Prefab, malformed YAML/numeric values, wrong
type; source chunk tampering, forged Publisher signature, stale Session
and private snapshot lookalikes. Pure parser tests cover negative
signed fileIDs/unsigned GlobalObjectId mapping, float drift,
binary/oversized/partial inputs. Execute all focused and full
Server suites, Project Peer source tests and repository gates,
then monitor exact-head GitHub CI. These are not real Unity
Editor/Windows Host+Guest tests or field-ready proof.

Revert the single commit to remove the helpers and tests (no existing
runtime path imports them). No persistent service state is affected.

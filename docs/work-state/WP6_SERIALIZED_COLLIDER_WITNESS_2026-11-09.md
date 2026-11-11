# WP6 serialized saved Scene Collider value witness — 2026-11-09

## Problem and intended next Phase result

PR #511 gives the Project Peer a signed Manifest-to-Scene/.meta
**stored byte provenance** check. Stacked Editor PR #506 captures
exact saved Scene Component identity, #507 builds the complete
allowlisted Collider inventory, and #512 checks its loaded active
Scene identity and saved Scene/.meta hashes before/after capture.
These checks alone do **not** show that `SerializedProperty`
values observed in Unity are actually those serialized in the
published saved Scene. A clean Scene may still be stale after an
external disk modification. This PR addresses the **narrow
Collider serialized-value correspondence**, without authorizing
writing or pretending it is a general Unity YAML parser.

## Trust boundary and implementation

- Stack a single source-only commit onto #512 (which depends on
  #507 → #506). Keep independent signed Project Peer #511 and
  Server #509–#510 unchanged. No main merge, feature enablement,
  Session packet or release manifest change.
- Pure C# bounded parser `TeamForgeWp6YamlColliderWitness` for
  *canonical* Unity text YAML documents: class IDs 1, 65, 135
  (GameObject, BoxCollider, SphereCollider); strictly typed,
  finite and bounded trigger/center/size/radius values. Require
  exact component and owning GameObject local 64-bit fileIDs,
  the owner's m_Component reference and no extra/missing
  allowlisted Collider docs. Same-type Colliders are distinguished.
- Reject unsupported headers, duplicate fileIDs or properties,
  malformed/unknown serialized value formats, wrong owner/type,
  unsupported PrefabInstance documents or nonzero Prefab
  inheritance fields, missing/extra direct Collider docs.
  This is a deliberate fail-closed restricted grammar, not
  best-effort Unity YAML deserialization.
- Bound UTF-8 serialized text to 16 MiB, 65,536 YAML documents,
  512 direct supported Collider documents and 16,384 characters
  per line. Non-text/binary, large and Prefab-heavy Scenes are
  explicitly unsupported. Smaller Projects may qualify; there
  is no broad size or compatibility claim.
- Editor adapter `TeamForgeWp6SerializedSceneWitness.TryCapture`
  requires #512's exact active clean saved source hash/GUID
  capture, rejects redirected parent directories, reads strict
  UTF-8 bounded Scene bytes, matches all observed values,
  recaptures the source file hashes/Scene/values again and
  returns only a read-only local source + Collider count.
- **No** SaveScene/OpenScene/reimport/Undo/Editor UI/Scene writes,
  no socket messages, no signed Publisher approval in the
  Editor, no component transaction/revision grant, no
  persistent state or Player runtime code.

## Evidence, negative cases and risk

High-risk source provenance/serialized-value boundary; **source-only**
prototype with no deployment. Pure C# parser is independently
compilable without Unity Engine assemblies; run on mini-PC via
a temporary .NET harness for actual execution of canonical
sample and malformed-data cases. In Unity NUnit EditMode tests
require that a *real saved Unity 6 text Scene* with 2 same-type
BoxColliders and a SphereCollider matches exact values, including
a tiny center offset; verify no Undo/dirty change. Verify
malformed/missing/extra Collider and owner, wrong
trigger/size/radius, Prefab/format refusal, oversized input,
external Scene file change, and unsaved Editor rejection.

Source/docs/engineering/workflow checks and Roslyn syntax are
additional gates, but do **not** count as actual Unity Editor
compilation or Unity NUnit execution. GitHub Unity CI is
still required; physical two-PC Inspector and rollback/replay
testing are not applicable because writing is not enabled.

The actual upstream expected Project/Scene hashes **must** come
from independently trusted/current Project Peer + Coordinator
source checks (#511); caller input here is an *expectation*,
not automatically verified signing provenance. A concurrently
modified saved file or Unity Editor reimport might evade the
bounded before/after observations in unusual circumstances.
Do not enable live property writes or claim broad Scene
serialization provenance. Never equate this isolated local
witness with Server approval or verified Live Session.

## Rollback and next dependency

Revert this one stacked commit to remove the helper/test/docs.
There is no persistent state to migrate or clean. Next: an
authenticated source-proof handoff from Project Peer to the
Editor and an explicit Server-owned, revision/lock-fenced
Inspector transaction with stale/replay/reconnect rejection,
Undo and two-Editor real-world evidence. The product remains
FIELD_BLOCKED until existing release gates independently pass.

## 2026-11-09 Unity CI format evidence and follow-up

The first exact-head Unity Editor workflow for #513 compiled but **failed
1/531 EditMode test cases**: the actual saved Unity Scene's YAML had
an unrelated empty `m_EditorClassIdentifier:` scalar. Commit
`b2f67ac` allows such empty ancillary scalars while rejecting empty
required Collider properties and duplicate fields. A subsequent CI
retry still failed the same Scene-value test with
`WP6 Unity Scene YAML document identity or Prefab is unsupported`.
This points to the prior overly restrictive document header
parser rather than the Collider shape. The follow-up now accepts
bounded **signed 64-bit** Scene fileIDs (converted to the matching
`GlobalObjectId.targetObjectId` unsigned bits) and standard Unity 6
10-digit document class IDs such as `1660057539` for SceneRoots.
It continues to reject oversized IDs, PrefabInstance documents,
invalid/duplicate IDs and unsupported numeric values.

Independent pure .NET 10 execution verified both forms alongside
the original valid and malformed cases. No claim is made that this
fix passed actual Unity Editor yet: the new **exact commit CI**
must prove it before depending on the YAML witness or enabling
the local Undo prototype #514.

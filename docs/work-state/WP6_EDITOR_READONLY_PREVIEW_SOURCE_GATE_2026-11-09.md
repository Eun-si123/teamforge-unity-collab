# WP6 Editor read-only WebSocket preview: saved-source gate — 2026-11-09

## Goal and minimum safe scope

The supported TeamForge Editor Test Lab already offers an **explicit**
two-sided, off-by-default `component_recovery_preview_request` over
the real realtime WebSocket. The Server's corresponding optional
handler checks the actual negotiated Hierarchy member and only
reports a metadata-only read of an already prepared local fixture;
it never seeds or writes any Unity data. However, the Test Lab
button previously sent a request after only checking that the
active Scene had a non-empty saved path and a plausible GUID.
A dirty Editor, outdated/mismatched on-disk Scene, or cached
AssetDatabase GUID for a rewritten `.meta` was not stopped
locally even though WP6's strict read-only saved Collider witness
already existed separately in draft PR #513.

This branch starts from #514's Editor-side #506/#507/#512/#513
read-only identity/inventory/source/value checks and local
Undo-only prototype. It does **not** depend on the independent
Server source-gated simulation #520 for runtime behavior.
No Server dispatch, Project Peer manifest, protocol/message
field, feature flag, release binary, actual Component mutation,
undo operation or persisted settings change is included.

## Implementation and invariants

- `TeamForgeWp6PreviewSourceGate.TryCaptureForReadOnlyPreview`
  checks a canonical requested saved Scene GUID; the exact
  active loaded Scene must be clean, saved and have matching
  GUID. Before doing a potentially large baseline SHA-256,
  require bounded <=16 MiB regular Scene file, nonredirected
  source directories, and <=64 KiB regular `.meta` file.
- Read the actual on-disk UTF-8 metadata bytes, not merely
  AssetDatabase's GUID cache: require **exactly one**
  canonical, unindented `guid: <expected>` field and reject
  rewritten, missing or duplicate metadata GUID values.
  Bound the read and ensure stream byte count is stable.
- Hash the current active Scene source via the existing
  `TeamForgeBaselineFingerprint` and verify saved path/
  file/meta hashes and clean Scene inventory with
  `TeamForgeWp6SerializedSceneWitness.TryCapture`. It
  parses actual bounded Unity text YAML and requires each
  direct BoxCollider/SphereCollider GlobalObjectId and
  allowed typed values to match currently loaded Inspector
  SerializedProperties exactly. It re-observes Scene and
  saved files after comparison to reject edits during read.
- Only after this complete local check succeeds does the
  existing `RequestComponentRecoveryPreview` construct
  a request ID, pending request and unchanged six-field
  metadata-only WebSocket request. The actual Test Lab
  view explains the source check and the UNVERIFIED
  Publisher/live Editor application boundary.
- Local preflight failure sends **nothing**, does not create
  an outstanding request or permit a network/Unity write.
  No arbitrary network Collider values or claimed hashes
  enter the request. No automatic saved Scene changes,
  Undo, reimport, broadcast, reconnect or remote recovery.

## Security assumptions and limits

The source/metadata observation is **local consistency
evidence**, NOT Publisher-signed Project provenance,
not a Server-issued lock/revision grant, not a cryptographic
Editor-origin acknowledgment and not a trusted remote
Inspector operation. A client can still lie about what
its Editor loaded; the Server does not even receive
source/value evidence on this old read-only request.
#520's signed stored Scene data is verified separately
in an offline monorepo test fixture and has NOT been
joined with this live Test Lab connection. Therefore
neither the Test Lab status nor a matching recovery
fingerprint is a complete or confirmed synchronization
receipt. The existing remote Inspector write remains
disabled and release remains FIELD_BLOCKED.

## Verification, negative cases, rollback

New NUnit EditMode tests create actual saved Unity Scenes
with two supported Colliders, verify exact local witness
and unchanged dirty/Undo state, and reject a different
or malformed GUID, dirty Scene, externally inserted
unrecognized YAML document, wrong/repeated on-disk
metadata GUID even while the cached AssetDatabase GUID
is unchanged. Add C# syntax parsing and repository
source/docs/engineering/workflow checks. GitHub Unity
NUnit tests must independently compile and execute this
exact head; local syntax checks cannot substitute.

Rollback is one source-only commit reverting the preflight,
two .cs + .meta files and the Test Lab documentation.
No migration, Server restart, public endpoint, secrets or
runtime feature activation are required. For a later WP6
phase, add an authenticated Publisher-bound Project
source and Editor post-apply proof to the live Session
before enabling any cross-Editor Collider mutation.

# WP6 signed Scene file source verification (Project Peer) — 2026-11-09

## Purpose, system boundary and observed gap

Host orchestration already compares its realtime join-code Scene
SHA-256 with the exact approved Project Manifest file entry. Do not
duplicate that Host path or treat the join code as signed evidence.
The Server's experimental Publisher approval PR #510 cryptographically
binds a *prepared Collider observation* to an Owner-authorized Publisher
but does not attest to the actual Unity Scene file contents. The missing
Project Peer source-to-identity prerequisite is verifying that one
specific saved Scene file **and its .meta GUID** genuinely belong to
the signed approved Project Manifest, and that their published bytes
can still be reconstructed from the verified content-addressed cache.

## Scope and authority

- Independent source-only PR from current main. Does not change or
  overwrite stacked Server WP6 PRs #509–#510, Unity WP6 #506–#508,
  read-only remote preview #346–#348 or any other working tree.
- `verifyWp6PublishedSceneSource` takes one signed Project publication,
  and `expectedBaseline` with exact projectId, projectUuid,
  baselineRevision, manifestHash, descriptorHash and ownerKeyId.
  **The expected pin must be obtained from the current server-owned
  Project Coordinator registry, not from a peer or the publication
  being verified.** It is inert, bounded and exact-keyed.
- Reuse Project Peer's `validateDescriptor` (signed Baseline and
  delegated Publisher authorization), `validateManifest` (canonical
  manifest hash/paths/chunks) and `ChunkStore.read` (hash/size/regular
  opened-inode checks). Select a canonical `Assets/**/*.unity`
  path and require its matching `.unity.meta` in the signed Manifest.
- Stream-verify every source Scene chunk without concatenating file
  bytes (128 MiB hard cap, 2048 chunks), verify bounded 64 KiB .meta
  content bytes/hash and strictly parse its unique canonical nonzero
  Unity GUID. Refuse missing, duplicate, corrupt, wrong-ID/role or
  mismatched Scene metadata. Diagnostics contain no absolute paths or
  private local filesystem details.
- Return only immutable signed source identity: Project UUID/revision,
  manifest/descriptor hashes, Scene relative path/GUID, Scene/.meta
  hashes and verified Scene file length. No asset payload, properties,
  credentials or trusted write grant is returned.

## Explicitly NOT proven

1. This verifier reads **immutable published content-addressed chunks**.
   It is not a current working-project file watcher or Unity open-Scene
   inspector. A working Scene may have changed since the publication.
2. Unity Scene may be binary or serialized YAML; this helper does **not**
   parse GameObjects/Components/Inspector values, check missing Scene
   Components, or establish that the Editor is currently displaying
   the verified bytes. File provenance is not observation provenance.
3. The Coordinator pin must be independently trustworthy. Calling
   this offline helper with a pin copied from a malicious publication
   is insufficient Owner/Publisher authentication.
4. There is no HTTP/WS request, Active Project activation, Scene write,
   Undo, Session mutation, new ability to sign, runtime feature toggle
   or release claim. The Phase 5.1 field-blocked candidate is unchanged.

## Risk, test plan and recovery

High-risk signature/hash/path trust surface, but the new API is
disconnected and read-only. Verify: signed real manifest with Scene +
.meta, correct GUID, multi-chunk Scene reconstruction, an absent/edited
.meta, duplicate GUID, malformed UTF-8, invalid path/foreign GUID,
wrong Project/Owner/Publisher hash/revision, tampered manifest,
corrupt/missing stored chunks, post-publication working source drift,
resource limits and untrusted store/approval getter tricks.

Use focused and whole Project Peer suites, Node syntax, repository
source/docs/engineering/workflow gates and GitHub head CI. These do
not substitute Unity Editor semantic/Scene interpretation tests or
physical 2-PC field evidence. Failed checks have no cleanup/rollback
state because the verifier creates no files and does not change
persistent store metadata. A single-commit revert removes the API.

## Next dependency

Build an **Editor-side** bridge that captures an actually loaded,
clean Scene's exact stable GUID + saved-file digest before/after the
bounded Collider inventory without writing it, proves Source/Editor
baseline identity, and distinguishes a locally edited/externally
modified/loaded stale Scene. Actual Scene-serialized-component value
correspondence needs a separate Unity-based verification, not a
standalone hash comparison. Then join that evidence with #510's
Publisher-approved observation under the same Project/Session
revision, explicit lock/undo/reject/reconnect gates before allowing
one property write.

# WP6 Project Peer signed Active Scene source CLI — 2026-11-09

## Motivation

WP6 #519–#520 verify actual signed Scene bytes against a
Publisher-approved Collider snapshot in offline fixture tests.
#521–#524 separately test and guard the existing real
opt-in, read-only Editor↔Server preview. The sidecar currently
has no accessible read-only report of exactly which signed
Scene bytes are activated and available for Editor comparison.
This change adds a local-only signed Active-file source report,
not a new network or Inspector write capability.

## CLI and contract

  node project-peer/src/cli.mjs wp6-scene-source --managed-root PATH --project-uuid UUID --scene-path Assets/Scenes/Main.unity --scene-guid 32_LOWERCASE_HEX

The Project Peer must already have an owner/publisher-approved,
activated signed Baseline. The command does not initialize
peer-client.json or connect to the realtime Server. Output:
projectId, projectUuid, signed Baseline revision, manifestHash,
descriptorHash, Owner/Publisher key IDs, Scene GUID and path,
re-read Scene/.meta SHA-256 and byte count. It declares
manifestMembershipVerified and signedActiveFileBytesVerified
true, while inspectorValuesVerified,
currentServerSessionVerified, editorApplyVerified and
networkWriteAuthorized are explicitly false.

## Checks

1. Call ManagedProjectStore.validatedCurrent to verify the
   Active pointer, signed Descriptor and Publisher delegation,
   canonical Manifest, Project Peer version, Unity descriptor
   and previously activated trust/persistence. A random
   self-signed publication is not automatically trusted.
2. Require one canonical Assets/.../*.unity relative path
   and exactly one signed Manifest entry for it plus .meta;
   both must be assets with positive sizes <=16 MiB/64 KiB.
3. Reject redirected directory ancestors and symlink files.
   Read with pinned read-only file handles, check inode and
   size before reads and stable identity/time afterward.
   Compare actual bytes' SHA-256 against signed Manifest
   fileHash, never arbitrary caller-supplied hashes.
4. Require strict UTF-8 Unity text Scene YAML signature and
   reject binary/control content; read .meta and check exactly
   one canonical unindented matching 32-character Scene GUID.
5. Revalidate the signed Active pointer/descriptor and both
   file hashes after asynchronous reads, failing closed if
   the Baseline or file changes in-flight.
6. Return a frozen redacted local report. Never expose raw
   Scene bytes, private keys, absolute paths or active
   source handles.

## Remaining trust boundaries

This is a **local Active Project file-origin check**:
it inherits the earlier Project Peer trust approval and
does not compare itself to a current authenticated Server
Session or prove a Unity Editor loaded these source bytes.
It does not inspect live Collider property values, remote
Undo, an ACK or a successfully applied property. The
output JSON is not cryptographically signed and must NOT
be accepted from arbitrary clients as proof. Any live
server↔sidecar↔Editor binding requires an independently
authenticated transport contract and two-Editor testing
before enabling Inspector writes.

## Verification and rollback

Use signed real ManagedProjectStore temporary fixtures to
check good CLI output, no identity creation or file writes,
wrong path and GUID, no Active Project, binary Scene,
tampered metadata, forged .meta GUID, Active Scene hash
damage, redirected links, and Baseline change in-flight.
Run full Project Peer, source/docs/engineering/workflow
validation, plus GitHub exact-head CI. This Draft can be
reverted with one commit, no release/service/config changes.

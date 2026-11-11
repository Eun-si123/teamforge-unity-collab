# WP6 signed Scene source and Publisher observation cross-check — 2026-11-09

## Why this bridge exists

PR #511 independently verifies one Owner/Publisher-signed Project Manifest
against actual content-addressed .unity and .meta file bytes and the Unity
Scene GUID. The Server PR chain #509–#517 independently verifies a complete
saved-Scene Collider observation signed by the currently registered
Publisher, authenticated active Project Coordinator and realtime Session.
Neither proof by itself establishes they refer to the same **current**
Project Baseline or saved Scene; a peer-supplied file hash is not a
substitute for reading signed stored bytes.

This branch intentionally **combines** the independent draft PR #511
with draft #517 in a review-only integration branch, without modifying
the original PR branches or creating any live socket endpoint. The merge
commit is a dependency for one new small module and actual cross-subsystem
test file. The base PR is #517; #511 should be reviewed/merged separately
before merging this integration branch to avoid duplicate history.

## Implemented cross-boundary guarantee

- A test-only monorepo entrypoint in
  `scripts/wp6-source-approval-bridge.mjs` first checks a **genuine
  Server-owned current Project Coordinator + realtime Session**, exact
  registered Publisher Editor and private-registry-prepared complete
  Collider observation with the existing Ed25519 Publisher approval
  validator. It never reads an untrusted peer's Owner pin.
- Derive the expected exact Project ID, UUID, revision, manifest hash,
  descriptor hash and Owner key ID from the actual registered Project
  Baseline. Compare the Publisher-approved Scene GUID and approval
  Baseline to those exact current registry values.
- Call the **actual** Project Peer #511 verifier, which rechecks the
  Owner/Publisher signature, whole canonical Manifest, .unity and .meta
  content-addressed chunks and whole-file hashes, and the expected
  saved Scene GUID. No codepath trusts a caller-supplied source-proof
  object or assumes a file digest proves actual bytes.
- This step performs asynchronous filesystem IO. After IO, re-run the
  Server Publisher/Session/complete-observation verifier, re-read the
  current registered Project Baseline and compare it to the original
  pinned state. A Publisher rotation, connection replacement, unrelated
  Session operation or changed observation makes the cross-check fail.
- Return a frozen, bounded identity summary with Scene path/GUID,
  actual signed Scene and metadata file SHA-256, exact Project/
  Baseline/realtime revision, and the Publisher's signed identity and
  property fingerprints.

## Mandatory trust limit / no silent upgrade

The positive result is deliberately called
`signed_scene_bytes_and_publisher_observation_same_baseline_values_unverified`.
It proves the **same signed Project Baseline and saved Scene identity**
were referenced by two independently verified sources. It does **NOT**
prove the Publisher-approved Inspector values were parsed from the
actual signed Scene bytes. For example, tests deliberately use a real
signed Scene file containing no Collider documents along with a
Publisher-approved Collider observation: the bridge reports the
explicitly **unverified** status rather than claiming a successful
serialized-value match. The Unity #513 strict serialized Scene YAML
witness must supply that missing value correspondence, with an
authenticated, Editor-origin handoff to the server.

This module lives under `scripts/`, is used only by server integration
tests within a full monorepo checkout, and is **not imported by the
standalone Server package or production app**. No WebSocket, wire
protocol, transfer endpoint, active ledger, Unity Scene write, Undo,
ACK, migration, release version or runtime feature flag changes.
No localhost API keys or private signatures are persisted. A future
production design must decide how Project Peer provenance is sent
over an authenticated channel and how the Editor proves actual
serialized-value correspondence, instead of blindly importing this
test-only helper into the deployed server.

## Risk, tests, rollout and rollback

Sensitive cryptographic/project-source trust boundary; no live effect.
Use actual ephemeral Ed25519 identity keys and a real signed Project
Peer Manifest/descriptor/store plus registered Project Coordinator and
SessionAuthority: verify normal same-project/same-Scene path, wrong
Scene GUID, another signed Project with a different Owner, modified
metadata GUID, damaged stored Scene chunk, malformed Publisher
approval, wrong Session revision, superseded connection, tampered
registered Baseline, and a deterministic in-flight revision change
between file reads and the final authority recheck. All rejections
must leave shared Session operations and revision unchanged.

Run the 6 cross-bridge tests, Project Peer source tests, full Server
suite, repository source/docs/engineering/workflow validators and
exact GitHub commit CI. This is **not** an end-to-end physical
two-Editor Inspector sync, a complete value/Undo test, or release.
Rollback by reverting the single integration code change plus the
merge dependency, without data migration or service restart.

# WP6 Publisher-bound local ledger lifecycle — 2026-11-09

## Decision and dependency

PR #509 introduced exact, complete (not sparse) server-side
saved Scene Collider property observation validation. PR #510
binds this prepared observation to the **current** signed
Owner/Publisher Project Baseline and one active authenticated
Editor connection, without proving Scene serialized file bytes.
The existing server transaction simulation can commit a
single allowlisted property with shared revision, lock and
replay checks, but does not retain a Publisher/Project Baseline
pin across subsequent commits. Publishing a new Project
Baseline while an old local ledger remains seeded could let a
caller inadvertently continue the wrong experimental epoch.

This PR adds the **smallest coherent lifecycle bridge**
above #510, keeping the existing code's public contract and
unmodified network dispatch. The Unity read-only/Undo branch
#506/#507/#512/#513/#514 and independent Project Peer #511
are separate. No source-only prototype changes product runtime
capabilities or the selected FIELD_BLOCKED release.

## In scope

- Only a private, same-Session **in-memory** simulator handle,
  created after independently re-verifying Publisher approval,
  both Server registries and a complete Collider snapshot.
- Once-only seed of the existing local transactional ledger.
  Before every local read/commit, reverify the exact originally
  registered Project+realtime Editor, matching signed baseline
  revision, manifest and descriptor, Owner and Publisher keys
  and signature, current Session and ledger revision.
- On Project baseline/Publisher pin rotation, revoked
  authorization, replaced member or external Session revision:
  **retire** the preview and require a new observation.
  Never silently rebase a stale ledger onto new project bytes.
- Allow the existing server transaction to own all writes,
  lock expiry, typed allowlist, shared revision, replay
  classification and Server-authored `applied` record.
  Return `sceneBytesAttested: false` explicitly; never treat
  a client provided applied record as a valid operation.
- Rejections do not increment the Session revision or write
  operation history. Retirement does not rollback already
  committed Session operations, because doing so would
  silently conflict with other collaboration events.
- No persistence, active websocket route, new protocol field,
  migration, Unity Scene write, Editor Undo, or release artifact.

## High-risk boundary / blind spots

This is source-only local research. **A Publisher signature can
approve fabricated Collider values.** The current successful
approval proves that one registered key signed those exact
observations, *not* that they came from a verified Project Peer
signed .unity file (#511) or a current Unity serialized-value
witness (#513). A local handle is not a capability; the
same-process imports of generic prototype transaction APIs
are intentionally still possible for old tests. No durable
Session epoch, reconnect, authenticated Editor operation
delivery, trusted Project source handoff or cross-Editor Undo
exists. Do **not** connect this preview to a production path
without separately solving those boundaries.

## Evidence and rollback

Unit/integration tests use genuine Owner/Publisher ephemeral
Ed25519 signatures and the real Project Coordinator and
SessionAuthority registration. Exercise complete Publisher
setup, exact immutable applied receipts, matching replay and
conflicting ID, wrong/forged handle and approval, Project
baseline rotation, delegated Publisher revocation, member
replacement and old replay, unrelated Session revision,
missing/expired lock, stale operation, incomplete Collider
and explicit retirement with unchanged history. Run focused
and full server suites, Node source checks, public source/
engineering/docs/workflow gates and exact GitHub CI. These
do not substitute real Unity Editor, signed Scene byte
attestation or two-PC field tests.

Rollback is one stacked commit revert and does not migrate or
reinitialize a running product Session. There are no active
network handlers referencing the new helper. Next WP6 work
should focus on a real source-to-Session authority binding,
then a carefully reviewed authenticated applied-receipt
delivery with live Editor reconciliation, Undo and reconnect.

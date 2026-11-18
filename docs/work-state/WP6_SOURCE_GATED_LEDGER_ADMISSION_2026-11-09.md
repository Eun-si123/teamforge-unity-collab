# WP6 signed stored Collider values → local server ledger admission — 2026-11-09

## Objective and dependency

PR #519 independently verifies a current server-registered Publisher's
Ed25519-signed, complete Collider observation against the **actual** saved
.unity contents of a signed Project Peer baseline. PR #515+ separately
supports an in-memory Publisher-approved server transaction simulator
with session revision, per-object lock, replay protection, next-recipient
delivery and full receiver-state comparison. The earlier local simulator
allows a Publisher-approved observation to seed a ledger *without*
rechecking the signed Scene's serialized values.

This PR adds a **new, explicit offline-only call path** in
`scripts/wp6-source-gated-local-ledger.mjs`, stacked only on #519.
It does not delete or change the older #515 experimental entrypoints,
and it is not a new live Server/Editor protocol.

## Exact admission contract

`beginWp6SourceGatedColliderLedgerForLocalTest(args)`:

1. Calls #519's complete signed Project Peer source/content and active
   Project Coordinator/SessionAuthority verification on real stored Scene
   chunks, Project Owner/Publisher keys, exact Scene GUID and complete
   supported BoxCollider/SphereCollider serialized values.
2. Requires explicit `serializedValuesVerified:true` plus
   `editorApplyVerified:false` / `networkWriteAuthorized:false`.
   Rejects an empty/altered Scene, wrong Owner/Publisher signature, damaged
   chunk or rotated Project/Session Baseline before seeding anything.
3. Immediately, **without another await**, calls the existing
   Publisher-bound seed. This performs the current Project, Publisher,
   Session and prepared-observation checks again, closing an ordinary
   asynchronous authority-rotation gap. Assert matching Scene/revision/
   Component count and retire on any unexpected disagreement.
4. Returns an unforgeable WeakMap-backed frozen handle bound to the
   underlying ledger (which is never exposed to callers of this new API).
   Clones/structural lookalikes cannot commit.

Bounded test-only operations delegate to existing server components:
`commitWp6SourceGatedColliderLedgerForLocalTest` still owns its shared
Session revision, precise property allowlist, per-object lock TTL,
conflicting-ID/refusal and exact server-created applied record. Optional
read/delivery/reconciliation functions reuse #516/#517 with current
registered recipient checks. An incorrect user cursor or stale *request*
does not delete a healthy Publisher ledger (DoS resistance); an actual
Project Baseline/owner/member/session epoch invalidation retires it.
There is no receiver ACK, automatic client retry, source mutation or
implicit Scene save.

## Hard trust boundary

The source proof records **storedSceneValuesCheckedAtAdmission**. After
the first server-created change the in-memory ledger is expected to
differ from the original saved Scene bytes; this status is not a
continuous equality attestation. An adversarial actor with direct
same-process access to the **older** local seed APIs can still call them
without this new gate, so this experiment is **not a production security
boundary** until runtime routing actually restricts admission.

The signed stored Source check proves only Publisher-approved values
match actual **published saved file bytes**. It does not establish
that a running Unity Editor has loaded those exact values, that a
receiver applied the new operation, or that the Editor has a current
Undo/lock/revision state. No client token, WebSocket handler, wire
message, Editor apply, Undo call, durable ACK, deployment or release
code was introduced. The forthcoming production path requires
authenticated Editor-origin *post-apply* evidence and a deliberate
two-Editor conflict/reconnect repair protocol; do not simply wire
this test helper into arbitrary network JSON.

## Tests, negative cases and rollback

Real signed stored Project Peer test fixtures and live in-memory
Project Coordinator/SessionAuthority exercise:

- admissible exact text Scene/Publisher values → one local ledger;
  immutable unforgeable handle; explicit retirement;
- genuine signed but empty/altered Collider Scene and corrupted stored
  chunk → **no ledger seed, no history and no revision change**;
- exact Component-owner lock, stale revision, matching replay,
  conflicting operation ID, server-produced applied record;
- wrong cloned handle and out-of-range recipient cursor cannot
  mutate shared history or retire a valid Publisher ledger;
- signed Baseline rotation and in-flight revision mutation reject and
  demand a new source/observation;
- **two registered Editor connections**: ordered local delivery,
  exact complete receiver observation mismatch and local match,
  neither accepted as authenticated Editor ACK.

Run the integrated 20-case suite, full Server/Component/Project Peer
source suites, Node syntax/source/docs/engineering/workflow validation
and exact-head GitHub CI. No physical two-PC Unity Scene/Undo success
is implied by these in-memory tests.

Rollback is one separate stacked PR commit and removal of its only
test imports. No live Session state, network configuration, release
artifact or persisted database is changed.

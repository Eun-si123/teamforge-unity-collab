# WP6 Publisher-bound next-applied delivery cursor (local-only) — 2026-11-09

## Design decision

PR #515 attaches existing server-owned Property transactions to
a complete Publisher-approved local Collider observation, pinned
to an authenticated live Project Coordinator/SessionAuthority
Editor and a still-valid signed Owner/Publisher Project Baseline.
It can create exact `component_property_applied` records but the
separate Viewer/Guest receive side does not yet have a bounded,
order-aware, authority-checked way to inspect those records.
Simply broadcasting a plausible `applied` JSON from a client
would bypass server operation provenance and silently skip
unobserved intervening revisions.

This one-commit PR stacks above #515, retains disconnected
source-only behavior and does NOT introduce WebSocket routes,
Session dispatch handlers, negotiation, Unity writes, persistence,
migration, release features or authenticated ACKs.

## Recipient delivery contract

- Only a genuine live registered recipient *connection object*
  present in the actual Project Coordinator and realtime
  SessionAuthority registries, in exactly the original Publisher
  ledger's Project and Session, with the negotiated Project
  Transfer and Hierarchy capabilities, is eligible to inspect
  the local result. Never use a username, copied connection
  record or peer-supplied `applied` JSON as authorization.
- `inspectPublisherApprovedColliderNextDeliveryForLocalTest`
  rechecks #515's exact Publisher Baseline/owner/delegation
  signature, original member registration, realtime Session
  and ledger revision on every call. Epoch rotation, original
  connection supersede or stale Session retires the preview.
- Store only records emitted by the existing synchronous
  server-owned transaction (bounded to 256 entries). Preserve
  the literal frozen `applied` object identity in the actual
  Session operation history. A history substitution or lost
  record cannot become a fabricated delivery.
- Require a safe integer `knownRevision` between the exact
  Publisher-approved starting revision and current Session
  revision. Emit at most one next contiguous operation for
  `knownRevision+1` (max 8 KiB), or report an explicit
  resnapshot-needed gap. Never skip a Hierarchy/Transform
  revision, forge a catch-up operation, claim a peer applied
  a write, or rebroadcast values without admission checks.
- A cursor equal to current revision only yields a
  `publisher_bound_local_delivery_current_unverified`
  *observation*. A client can trivially claim that revision;
  it is **not** a remote ACK, saved-Scene hash or permission
  to issue another edit. Actual delivery needs authenticated
  opt-in transport, trusted Editor Source/Scene proof,
  post-apply Unity reconciliation and hard repair/Undo gates.

## Verification and negative cases

- Real registered Publisher and second registered Project peer
  in Server integration fixtures; read initial cursor,
  then commit 1 and 2 ordered exact Component operations.
- Matching server history pointers, immutable output and exact
  recipient-specific identifiers; no acknowledgement or
  Session mutation merely from reading.
- Deny forged/cloned/proxied/getter-bearing peer objects,
  wrong session, missing capability, replaced recipient, bad
  cursor (NaN, float, future/old/string, negative), forged
  history rows and rotated Publisher Baseline; require
  `resnapshot_required` for unfillable revisions.
- Run focus and full Server suites, syntax/source/docs/
  engineering/workflow gates and exact GitHub head CI.
  Test suite results are not a two-PC Unity application test
  or a verified project-file mapping.

## Rollback and remaining work

Revert one stacked commit. There are no network dispatchers,
persistent ledger schemas or existing product behavior to
restore. Only after exact signed Project/.unity/Editor
serialized-value evidence (#511–#513) is securely bound to
the authenticated live Session should WP6 introduce an
opt-in applied-result wire message. Its receipt must be
verified *after* Unity applies the change and its Undo
state/Scene revision are checked, with explicit handling for
disconnect, changed Baseline, lost locks, interleaved Scene
operations, replay collisions, and actual Editor conflicts.

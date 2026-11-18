# WP6 full Collider receiver observation reconciliation (offline) — 2026-11-09

## Why this next Phase slice

The server's #516 opt-in LOCAL-ONLY delivery reader now selects at
most one exact contiguous server-authored applied operation for a
registered recipient. But a peer's `knownRevision` is self-reported,
not an acknowledged Unity Inspector outcome. Simply advancing a
receiver cursor when a message is read would create silent divergence
after rejection, Undo, Scene reload or lost packet. The next useful
piece is a strict *whole allowlisted Scene* comparison before
designing a real authenticated post-apply receipt.

This work stacks exactly one source/test/doc commit atop #516. All
#509–#515 work remains unmodified; the feature is **disconnected** and
does not add a WebSocket message, Unity Editor callback, persistence,
any actual reception cursor mutation or release capability.

## Implementation

- Export `inspectPublisherApprovedColliderReceiverObservationForLocalTest`
  within the existing Publisher-bound local ledger. The function
  reuses #516's current Project+Session-recipient membership/epoch
  check; every call must still see the current signed Project
  Publisher/Owner baseline and authoritative ledger.
- A purported recipient snapshot must be **genuinely locally prepared**
  through the private same-Session identity/property registries.
  Run #509's whole complete saved-Scene BoxCollider/SphereCollider
  validator: exact GUID, 3 typed fields per supported Collider,
  <=512 Components, canonical IDs, current Hierarchy owners,
  safe typed values, no stale revision or missing observations.
- Compare the entire ledger's exact Scene/owner/Component/type/
  property/value-kind keys and actual booleans/floats/vector3
  values, without accepting a client-provided digest as a shortcut.
  A missing observation fails whole-snapshot validation, changed
  values yield `publisher_bound_local_receiver_diverged_unverified`,
  a mismatch count and explicit `manual_reconcile_required`.
  Neither case is silently repaired or used to overwrite Scene data.
- A perfect match yields a stable SHA-256 of the **server-owned**
  ledger context and status
  `publisher_bound_local_receiver_observation_matches_unverified`,
  with `editorApplyVerified: false`,
  `sceneBytesAttested: false`. No comparison call modifies the
  Session, Server operation history, locks, snapshots, or any
  receiver cursor.
- No actual Unity serialized Source witness is passed across
  this boundary. Any same-process test could manufacture a
  prepared snapshot with matching data. A remote client can
  lie about having received or applied bytes. This method
  MUST NOT be treated as a cryptographic Editor receipt, a
  production ACK, delivery guarantee or new trust capability.

## Evidence and next dependency

Test initial exact-match observation, two consecutive server-owned
commits followed by matching full-state observation, one-property
drift, incomplete snapshot, stale Session revision, forged/private
registry clone, unregistered member and Publisher Baseline
rotation. Require unchanged shared Session history on read.

Run full Node Server suite and all source/docs/engineering/workflow
gates on the exact branch. No Unity semantic compile, two-PC
network test, actual Editor post-apply proof or packaged release
validation is claimed.

Revert one commit to roll back; no live state or migration.
Next significant WP6 work should build an authenticated, bounded
Editor-origin source/Scene-value witness and real read-only
acknowledgment flow with explicit **unverified**/confirmed
states, followed only later by carefully gated live writes and
Undo/reconnect recovery.

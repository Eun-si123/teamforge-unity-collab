# M2 reservation-only authenticated WebSocket gate — 2026-11-16

## Problem and bounded outcome

The existing M2 structure ledger and local Unity add/remove pilot did not
share a trustworthy, joined-Editor authorization entry point. A caller could
simulate a reservation without a real authenticated Server Session or an
actual signed Project Scene. This change connects the **preflight reservation
receipt** to the real M1 WebSocket membership/Scene/lease state, without
misrepresenting it as committed structural collaboration.

## Scope and risk

High risk: realtime membership, signed source admission, Server lock, epoch,
revision and replay. Files: Server collaboration/router, real WebSocket tests
and Server operator documentation. This is a source-only, stacked Draft
above the M2 local saved-ID branch. It does not alter default launch
configuration, Unity Editor code, deployed r10, actual Project files,
signed baseline, Session revision or release readiness.

## Invariants

- **Both** trusted application option and explicit client Hello capability
  are required. Otherwise the reservation message is rejected; the existing
  `componentStructureSyncEnabled` bit must remain false.
- Signed stored Project/Scene value verification occurs through existing M1
  admission, and the exact connection must have joined its current epoch.
- Only that connection's current unexpired GameObject lease is sufficient.
  A different member, a lost lock, or stale Session revision must be refused.
- The reservation deduplicates only identical operation IDs/intents from
  its **original authenticated connection**. Transferring the GameObject
  lease or reconnecting with the same user ID must not transfer its receipt.
  Every reserved ID is fenced against M1 property, Transform and Hierarchy
  commands in the same Session, regardless of bounded applied history; an
  unrelated later structural operation still requires a new authenticated
  signed snapshot. It does not change the common Session revision or mutate
  admitted M1 property values.
- The response cannot be mistaken for a committed/applied/saved edit. Unity
  `RequireComponent` policy and sibling non-Collider dependencies remain
  **unverified**, and no arbitrary network payload may become a Unity
  mutation command.

## Negative cases and test evidence

Real WebSocket tests cover unnegotiated server, missing client opt-in,
missing lease, a different authenticated member, missing/invalid type policy,
replayed operation, cross-connection replay after lock transfer, reconnect
using **the same** userId on a new connection while another Editor preserves
the live Session, operation-ID collisions with M1 property, Transform and
Hierarchy commands, another reservation requiring resnapshot, malformed
input, lease released before a replay, and accepted M1 property changes
that invalidate the original source revision.
The existing signed-source join path is reused rather than bypassed.
All other M1 WebSocket tests run in the same focused suite.

No direct Unity operation is routed from this endpoint. No actual two-Editor,
same-process Editor lifecycle, packaged ZIP, or physical LAN evidence is
claimed by these tests. Revisit type dependency attestations, lock ordering,
logical/saved identity reconciliation, conflict/Undo and durable reconnect
before enabling actual structure synchronization.

## Rollout and rollback

No environment variable or default config enables it. The only path to
enable the pilot is a trusted direct `createTeamForgeServer` option in
an isolated harness plus the explicit Hello opt-in. Removing the Server
message branch and its focused helper fully reverts it; persistent migration
is not needed. Follow current M1/M2 source branches and retain all existing
field-release blockers.

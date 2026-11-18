# WP6 live read-only Project/Scene one-time challenge — 2026-11-10

## Scope and motivation

#525 created a Project Peer-local proof of previously approved signed
Active Scene file bytes, #526 a Unity Editor local comparison and
#527 direct pinned local Project Peer process execution. None
authenticates Project Peer evidence to a **current, live**
Server Project/Session/Editor connection. This PR adds the
**first live Server-origin challenge primitive**. It explicitly
DOES NOT connect Project Peer to this nonce, sign any new
Scene attestation or enable remote Inspector writes.

This is a narrow, default-off source-only WebSocket extension:
no old client must change or opt in, and legacy protocol v1
messages remain compatible. The same existing Server
`enableComponentRecoveryPreview:true` and opted-in Editor
`supportsComponentRecoveryPreview:true` are required,
plus both registered Project Transfer and Hierarchy.

## Challenge contract

1. Issue: exact 4-field
   `component_source_challenge_request` message with
   protocolVersion=1, bounded requestId and canonical,
   nonzero lowercase 32-hex Unity Scene GUID.
2. Current signed Project verification reuses
   `inspectCurrentSignedProjectForRecoveryPreview`, which
   checks the **real** ProjectCoordinator and SessionAuthority
   registration/connection identity plus live Owner/Publisher
   Ed25519 signed Baseline/delegation. No actor-supplied
   Project claim is used as authority.
3. Server creates a cryptographically random 32-byte
   nonce, TTL 15000ms, bound to exact connection object,
   Project ID, Session ID and current realtime Session
   revision, Connection ID, signed Project
   UUID/revision, Manifest/Descriptor hash, Owner and
   Publisher key identities, delegation, Baseline signature
   and requested Scene GUID. It permits one outstanding
   request per connection in WeakMap state, with no
   persistence or global incremental registry.
4. Echo: exact 5-field
   `component_source_challenge_echo` with original
   Scene GUID and 64-char lowercase nonce. Server
   immediately consumes the pending nonce, checks
   expiry, re-verifies current signed Project and
   authority, compares the complete pinned epoch, then
   constant-time checks the nonce. A replay, mismatching
   connection/Scene/Session/Baseline or wrong nonce fails.
5. Server sends an explicitly **UNVERIFIED** echo
   result, `same_connection_challenge_echo_unverified`,
   never an Editor application ACK, signed Scene proof,
   source attestation or Collider authorization.
   All response types include `sceneBytesAttested:false`,
   `editorApplyVerified:false`, and
   `networkWriteAuthorized:false`.
6. Protocol rejections are correlated `error` messages
   and do not disconnect otherwise healthy Presence/
   Transform collaborations. The existing Component
   Inspector write handler remains absent.

## Tests and threats

Real, running WebSocket tests verify server/client opt-in,
signed Baseline publication, nonce issuance and valid one-time
echo, duplicate outstanding refusal, replay prevention,
unknown extra fields, other authenticated socket's
inability to echo the first socket's nonce, continued
Ping and rejection of unsupported Component writes.

Signed ProjectCoordinatorCore + SessionAuthority integration
tests verify real Ed25519 signed Baselines, rotation,
tampered signature, cloned/replaced connections, wrong
Scene, wrong nonce, expired nonce (using controlled
clock), advanced realtime Session revision, invalid
identifiers, and zero Scene/Component
operation mutations. Full Server and repository policy
checks run before publishing this Draft.

## Explicit limits

This stage **does not** validate that the signed Project
Manifest contains the claimed Scene, that the Project
Peer responds using its genuine local storage, or that
the Editor loaded and applied a given Collider value.
Echoing the nonce is trivial for the requesting socket.
It proves at most ownership of the live socket at two
points in time with unchanged pinned metadata, not a
trusted Publisher/Project Peer source claim. A future
authenticated challenge-signature or protected IPC
proof plus Server verification against approved
Manifest and Editor post-apply evidence is required.
Do not use this result as a Scene source attestation
or as a predicate for Inspector writes.

The current Unity Editor Test Lab (#527) **does not yet
initiate this challenge**. This source-only protocol
foundation is isolated behind opt-in and can be
reverted in one stacked commit. No Service restart,
migration, private key, new port, production release
or default-on behavior. Product 0.5.1 remains FIELD_BLOCKED.

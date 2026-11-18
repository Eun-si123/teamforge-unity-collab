# WP6 Unity Editor live Server Scene nonce probe — 2026-11-10

## Integration and constraints

WP6 #528 implements a default-off Server-origin
256-bit one-time freshness challenge bound to current
signed Owner/Publisher Baseline, Project, Session
revision, exact Editor connection and Scene GUID.
This stacked PR implements explicit issue and echo
in the actual Unity Test Lab using the *same already
negotiated* read-only WP6 Hello opt-in. It is not
remote cryptographic Project Peer source evidence
and cannot authorize Inspector synchronization.

## Real Editor flow

1. When connected with WP6 read-only opt-in,
   require the current matching Project Coordinator
   signed Baseline metadata and a clean, exact
   saved Scene to loaded BoxCollider/SphereCollider
   SerializedProperty/YAML witness. Pin Scene
   and .meta SHA-256, Project/Publisher identity,
   connection and Session metadata locally.
2. Create a correlated one-time request with
   4 exact wire fields, including canonical
   nonzero lowercase Scene GUID. No source hash,
   Collider property or signed certificate
   is sent over this initial message.
3. Check received nonce response against
   original request, canonical nonce, Scene,
   Project UUID/Baseline/Manifest/Descriptor
   hash, unsupported authority flags false,
   and 15s local timeout.
4. Reverify the whole current saved Scene,
   Collider witness and Project pin before
   automatically echoing the nonce once,
   on the same current WebSocket connection.
5. Validate the correlated Server echo result
   and re-observe Project and Scene once more.
   Success is SERVER NONCE ECHO ONLY, never
   Editor applied, Publisher source verified,
   Component lock or reconciliation ACK.
6. On disconnect/reconnect or assembly
   reload, reset all pending nonce state.
   Reject duplicate requests, mismatched
   Scene/source/Publisher changes, malformed
   responses and unauthorized messages.
   Expired correlated replies are ignored;
   a valid late result during the expiry
   frame is scoped TIMEOUT, not a global
   Presence/Transform disconnect.
7. Expected correlated Server rejections
   become REFUSED diagnostics. No async
   retransmit, persistence, background
   retries, additional service or
   production auto opt-in.

## Test scope, trust limit

New Unity NUnit state-machine tests cover
the correct one-time handshake, forged
nonce/status/fields, counterfeit authority
flags, Project/Scene mismatch, timeout,
refusal, replay and Reset. The tests are
source-authored and require independent
exact-head GitHub Unity EditMode execution
before being considered semantically
verified. Local Roslyn parsing and repository
checks are weaker than real Unity execution.

A malicious or merely ordinary script with
access to the same authenticated socket
can echo a nonce. This is not a genuine
Project Peer signed Active file inclusion
proof nor proof of the Editor loaded state
to the Server. Actual cross-machine
source attestation must verify a nonce-
bound signed/approved Project Peer source
and an Editor post-apply observation,
with no client hash accepted on its own.
No remote Inspector writes, Undo/rollback
or Server Scene mutation are introduced.
TeamForge 0.5.1 remains FIELD_BLOCKED.

Rollback this single stacked Editor-only
source/test/documentation commit. No
migration, secret, new API endpoint or
release artifact.

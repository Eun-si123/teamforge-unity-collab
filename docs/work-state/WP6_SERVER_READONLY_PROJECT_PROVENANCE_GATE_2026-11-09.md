# WP6 server-side signed Project gate for real opt-in read-only preview — 2026-11-09

## Problem and design

Existing Unity Editor WP6 test-only read-only `component_recovery_preview_request`
is negotiated only when both ends opt in. Draft PRs #521/#522 added
strict saved Scene/Collider and Project registry checks in the Unity Editor
before sending and after receiving. But the *real Server WebSocket
handler* still only checked its realtime Session/Hierarchy membership
before showing locally prepared Component metadata. Another raw
WebSocket client could request that optional route without being a
registered Project Transfer client or using the CURRENT signed Project
Owner/Publisher Baseline. Client-side checks do not provide a server
security boundary.

This Draft PR stacks atop #522, and does not add a new protocol,
Inspector write, client-supplied seed, or a change to default OFF state.
It closes that independently enforceable Server read-only admission
gap with the existing server-owned Project Coordinator and realtime
SessionAuthority, not the peer's self-reported metadata.

## Implementation

- A small isolated `server/src/component-recovery-project-gate.mjs`
  helper called from the **actual** WebSocket dispatch of
  `component_recovery_preview_request`, after its strict six-field
  wire schema check but BEFORE reading Component history.
- Require the exact *same server-created connection object*
  currently registered in the Project Coordinator's Project/
  Session record AND in SessionAuthority's current realtime
  Hierarchy member, with negotiated Project Transfer and
  Hierarchy and canonical project/session key. Cloned, replaced,
  unregistered, mismatched Session or unsupported clients fail.
- Require a published current Project registry with matching
  Project ID/UUID and Owner public key+pin, supported
  Unity/package/protocol versions. Re-verify the complete
  stored Owner/Publisher **Ed25519 signed descriptor** using
  the existing Server `verifyProjectDescriptor`: current
  Manifest hash, descriptor hash, owner/publisher key IDs,
  signature and any delegated Publisher authorization.
- The signed Baseline check is not a substitute for actual
  Project Peer stored Scene chunk SHA-256 verification and
  the full Editor SerializedProperty source check. The
  helper deliberately returns `sceneBytesAttested:false`,
  `editorApplyVerified:false`,
  `networkWriteAuthorized:false`. No caller-supplied
  Project identifier/hashes/approval are used as an
  authorization token.
- Refused read-only previews return only
  `component_recovery_project_membership_required` or
  `component_recovery_signed_baseline_required`,
  preserving the originating `requestId`, without severing
  an otherwise healthy Presence/Transform Session, mutating
  any Component/Scene state or creating an ACK. The
  normal authenticated Local Component transaction remains
  intentionally unseeded in production.

## Verification plan, limitations and rollback

- Real Node WebSocket integration tests require explicit
  server and Editor opt-in, signed Owner Baseline publication,
  registered Project Transfer and Hierarchy Session. Unpublished
  Baseline, forged signature, request with no Project Transfer,
  missing Scene and unseeded Component ledger must reject
  without fabricated values. Ping after rejection works.
- Pure authority integration tests use real registered
  ProjectCoordinatorCore, SessionAuthority and ephemeral
  Ed25519 keys; exercise accepted Baseline rotation,
  wrong Project/Session, replaced/clone members,
  disabled capabilities, tampered Manifest/signature,
  owner/public key pin and Publisher delegation.
- Run full Server suite, syntax/source/docs/engineering/
  workflow tests and GitHub exact-head CI. A passing
  server-level test is **not** a real Unity Editor post-apply
  witness, a full Project-file source inclusion proof or
  two-PC Inspector sync. Local no-seed refusal remains
  expected once the signed Project gate passes.
- Rollback is a single stacked source/test/doc commit;
  no persistent migration, runtime Server restart, new
  wire message, secret, Unity Scene mutation, default
  opt-in change or release change. TeamForge 0.5.1 remains
  FIELD_BLOCKED.

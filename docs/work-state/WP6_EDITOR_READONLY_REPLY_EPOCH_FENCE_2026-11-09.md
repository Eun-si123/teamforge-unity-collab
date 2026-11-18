# WP6 Editor read-only recovery response: Project/Scene epoch fence — 2026-11-09

## Motivation

WP6 draft PR #521 makes the *real, Test-Lab-only* Unity Editor
`component_recovery_preview_request` require a clean, bounded
saved-Scene Collider source/SerializedProperty witness **before
sending**. Its successful metadata-only reply previously could
still be cached after a Scene was edited, changed on disk or
a different Project Baseline replaced the old one while the
WebSocket request was in flight. A Scene GUID and an old
Server fingerprint were not sufficient to establish current
Publisher Project/Editor consistency.

This PR stacks on #521 and changes only the existing opt-in
Unity Editor read-only path. It does not import the separately
developed #520 test-only signed Scene server seed, introduce
wire fields, enable writes or alter default collaboration.

## Implemented

- A small immutable `ProjectPin` from the *current connected*
  `TeamForgeProjectService.Registry.Baseline` plus the
  already loaded local `TeamForgeProjectDescriptor`. The
  Test Lab requires accepted Project Transfer, a received
  Server Project Registry snapshot and Project bootstrap
  state `Ready` or `BaselineAvailableNoSeed`. The
  descriptor and current registry baseline must have equal
  UUID, nonzero revision, full Manifest/Descriptor SHA-256,
  compatible Unity/TeamForge/protocol versions.
- Pin exact connection ID, Project and Session IDs,
  baseline UUID/revision/hashes, Owner/Publisher key IDs
  AND public key bytes, delegation and Baseline signature
  metadata, publication connection and timestamp.
  A late reply on an old Project/Publisher epoch fails
  even when the Scene GUID stays the same.
- The old cached server revision/fingerprint can be reused
  only if both *current saved Scene and meta* hashes match
  AND that Project pin is identical to the pin from the
  last accepted response.
- After verifying the existing response schema, request ID,
  Scene GUID and explicit bounded metadata, but BEFORE
  caching: repeat the same Project-pin capture, entire
  saved Scene/metadata and live loaded Editor
  SerializedProperty witness, and compare these to the
  original pending pins. A changed/dirty Scene, modified
  Project descriptor/baseline, closed/replaced connection,
  or rotated publisher makes the reply **STALE**.
- STALE clears all local pending and cached WP6 metadata
  and leaves the normal realtime WebSocket, Presence,
  Transform, Unity Scene, Undo and shared Session state
  untouched. Never automatically resend or claim applied
  Inspector state. A structurally invalid/unsolicited
  protocol reply still follows the existing security
  disconnect behavior. A correlated but stale valid reply
  is **not** a protocol attack.
- On refusal/timeout, clear pending Project pin; on normal
  disconnect/reload clear all pending/cached pins, retaining
  the existing off-by-default feature negotiation.
  Only read-only metadata is transmitted; no source hashes
  or Inspector values ever leave the Editor through
  the preexisting six-field wire request.

## Non-goals / trust limit

A received Project Registry Baseline was validated and
published on the authenticated realtime Server connection
but a malicious remote peer still cannot be trusted merely
because the Editor compares strings. This **does not perform
an independent client-side Ed25519 signature verification**
of the Project Baseline, and does not prove the currently
loaded saved Scene bytes belong to the signed Manifest.
It is a useful metadata consistency fence, *not* a trusted
client-to-server Publisher/Scene proof, source attestation
or remote Editor post-apply ACK. An external connection
could still send forged observations; the runtime Server
must never seed Inspector state from such a message.

No WebSocket changes, Component/Inspector writes, automated
Undo, persistence, release artifact or production feature
activation are made. The Default WP6 sync stage remains
unavailable and TeamForge release remains FIELD_BLOCKED.

## Tests / rollback

Add NUnit EditMode tests for exact Project-pin equality,
Publisher/Owner/Connection/Session or baseline rotation,
local descriptor mismatch, and a correlated Server reply
when no current Project/source pin is present: that result
must be `STALE`, not a connected-session failure or
false unchanged state, and all cached/pending metadata
must be cleared. #521 already tests actual Unity saved
Scene, dirty Scene, YAML tamper and forged metadata GUID.
Run C# syntax parser, repo source/docs/engineering/
workflow checks; exact head GitHub Unity NUnit & CI
must independently run. Local syntax-only verification
does NOT count as Editor/runtime pass.

Rollback: single stacked commit. No migration or live
server restart, no external wire contract difference.

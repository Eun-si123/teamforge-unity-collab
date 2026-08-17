# Current project state — 0.5.1 WP5 Diagnostics & Recovery UX

Status: **FIELD BLOCKED**

WP5 layers beginner-facing error explanations, stable codes, redacted current-
run diagnostics, and state-driven safe actions over the WP4.1 existing-Guest
refresh/rejoin candidate. It does not alter the transfer, trust, activation,
realtime, or authority contracts.

Current invariants:

- Realtime Protocol v1.
- Project Transfer Protocol v1.
- Project Manifest Schema v1.
- TeamForge Server WebSocket is the sole realtime authority route.
- Project payloads use direct HTTP between Project Peers.
- No WebRTC, ICE/STUN/TURN, relay, NAT traversal, discovery, or automatic
  fallback.
- Normal Host/Guest paths use bundled Runtime and do not require system
  Node/npm.
- Changed Project UUID, changed Owner, and tampered invites fail before the
  stored binding changes; changed Publisher uses explicit trust.
- Successful Baseline refresh preserves immutable Active revisions and moves
  `current.json` only after staging and verification; failure preserves the
  previous Active.
- Arbitrary component/serialized-property synchronization remains a Known
  Limitation and is not part of WP5.
- Safe offline opening of a previous independently verified Active never creates
  a realtime handoff and never bypasses Scene baseline validation.
- Diagnostic history is memory-only and bounded; access codes, tokens, private
  keys, Authorization values, and caller-supplied secrets are redacted.

Automated release evidence belongs to `Release-Integrity-Audit.md` and
`executable-smoke-results.md`. Historical PASS/CLOSED statements under
`docs/` apply only to their recorded artifact.

The current closure remains **BLOCKED**. The WP5 items in
`Windows-Field-Test-Checklist-WP5.md` are NOT RUN, and the formal WP4.1 two-PC
items remain deferred. Unity EditMode without a result XML is not PASS. Unity
6000.3.22f1 rebaseline, code signing, Docker, macOS, and Linux remain separate
follow-ups.

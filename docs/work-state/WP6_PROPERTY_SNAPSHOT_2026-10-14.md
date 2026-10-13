# WP6 bounded property snapshot and target lookup — 2026-10-14

Historical change plan; the task PR owns live commit/check status. Current live
capabilities remain in STATUS. This is independent of the property replay PR.

## Problem, outcome and scope

Single property candidates already validate exact identity/type/path/value/range.
There is no aggregate property snapshot contract for late join or rejection
recovery: repeated paths, total bytes and target-only value selection remain
unspecified. Extend the existing property foundation with a disconnected bounded
immutable snapshot and lookup of one exact Scene/object/Component/path/kind.

This advances WP6 issue #241's snapshot/recovery prerequisites. It does not seed
Session property authority, send messages, accept a capability or apply Unity
state. Values and type metadata are prototype test data supplied by a trusted
local caller, not authenticated runtime proof or client-provided authority.

## State ownership, invariants and risk

- High semantic risk, contained to pre-wire data preparation. Keep value/range
  policy in the existing property module; avoid a new wire/dispatch abstraction.
- Only a same-Session prepared identity baseline may prepare a property snapshot.
  Require current revision/Scene, authoritative owner and exact configured policy.
- Snapshot envelope and property records have exact fields. Reject duplicate
  Component/path identities even if values differ; never keep the last entry.
- Enforce both explicit count policy and prototype hard ceilings: 2,048 property
  records and 256 KiB canonical UTF-8 bytes, including envelope/value bytes. A
  caller cannot disable the ceiling by requesting a larger policy.
- Freeze and clone records/typed values; canonical order yields the same
  fingerprint for reordered equivalent input. Preserve false and numeric zero.
- Target lookup accepts only a locally prepared same-Session snapshot at current
  revision and revalidates current owner/policy. It returns one frozen property
  candidate, not a complete snapshot, repair ACK, commit grant or Scene write.
- Foreign/lookalike/stale baselines, removed owners, unknown target/type/kind,
  malformed values/ranges and extra fields fail closed without mutation.

## Validation, recovery and documentation

Focused tests: count/UTF-8 boundaries, duplicate and reordered records, missing/
foreign/changed identity, stale revision, malformed shapes, immutable values,
target-only output and current-policy revalidation. Run full Node tests, real
smoke, syntax and repository/docs/privacy/maintainability gates; remote Node
22/24, Windows and existing Unity integration regression when triggered.

No live repair/integration, exact package or physical two-PC result is implied.
Failure preserves all existing state; future negotiated live code needs atomic
commit, authentic seeding, targeted Unity rejection/Undo and reconnect handling.
Update as-built architecture and contributor module README; review CODEMAP and
STATUS boundaries. No new current canonical document or field-gate change.

## Initial checkpoint

Base: `7644ce5025188905edb57539b4d2da8d22e9f032`; branch:
`feat/wp6-property-snapshot-20261014`. Only this plan exists initially. Next:
implement the two inert APIs and focused falsifiable tests before claiming any
prepared snapshot or target lookup validated.

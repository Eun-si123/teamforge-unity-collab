# TeamForge P1: post-ACK signed source audit, fail-closed — 2026-11-24

**Scope:** Draft PR #620. Product status remains `FIELD_BLOCKED`, with no live M4→M5 migration or Guest Active/Host/SQLite pointer write permitted.

## Why

The new opt-in Unity Editor pause and two-or-more-Editor ACK gate can prove only a momentary transport observation, not the integrity of staged Project files. A signed M5 Descriptor is also replayable and does not prove current Publisher private-key possession. Even after the last Editor ACK, a missing Prefab/FBX `.meta` file, changed Scene, duplicate GUID or damaged chunk must block the future transition.

## Changes

- `server/src/project-transition-paused-source-preflight.mjs` adds a **read-only, in-process-only** post-ACK check. It uses the existing, mature `loadStoredPublication`, `auditSignedCandidateContents`, `auditSignedAssetGuids`, and `previewRetainedM4SourceChanges` paths from the Project Peer and server. Nothing accepts untrusted filesystem paths from a client. Both old approved M4 and staged owner-signed M5 candidate are selected by exact UUID, revision, signed Manifest hash and Descriptor hash; source SHA-256 is calculated by reconstructing every signed file from bounded, hash-checked chunks. Audit budgets apply and `resource_limit` can never be mistaken for a verified source.
- Admission requires **all** exact Editor ACKs from a current, unexpired online pause plus a valid Owner-signed next-revision Descriptor. Metadata-only matching is not enough. The source scan also verifies Unity imported Asset `.meta` GUID validity/uniqueness, missing metadata for changes, original Scene and Prefab drift and code/Package source changes.
- A before/after read-only M4 Session/Component/SQLite checkpoint capture, approved Host pointer reread, Coordinator baseline identity check, same online pause ticket check and candidate Manifest reread prevent a previously successful scan from being reported after a disconnect, cancellation, Session update, Publisher replacement or approved source switch.
- Only one active audit for each Project may run in-process; other Projects remain independent. There is no externally callable WebSocket initiation, no publish and no new permissions. Every audit response explicitly returns `commitPermitted:false`, including failure, blocked source, fully verified source and state races.
- The last Unity EditMode run on prior commit `9cf2721` compiled and executed **733 tests: 729 pass, 1 fail, 3 ignored**. A single newly introduced NUnit assertion incorrectly expected backslash-escaped quotes in Unity `JsonUtility.ToJson` output, despite the actual valid JSON containing regular quotes. Corrected the 3 literal expectations in `TeamForgeEditorPauseGateTests.cs` rather than changing correct wire serialization.

## Coverage and limits

Added real WebSocket/in-process integration regressions in `server/test/primitive-collaboration.test.mjs` for: all-Editor readiness before audit, refusal of mutated Owner Descriptor, missing FBX `.meta`, restored valid GUID, full stored content hashes, corrupted staged asset bytes, cancellation after previous audit, and **cancellation while asynchronous verification is in flight**. These cases never change the old approved Baseline. These tests do not simulate live Unity Studio, OS file-system writers or a physical two-PC configuration.

**Validated on Ubuntu Mini PC, Node 24:** Server suite **495 PASS / 0 FAIL**, cross-Phase **157 PASS / 0 FAIL**, Project Peer **651 PASS / 0 FAIL / 6 environment SKIP** (657 total); test sets overlap. Host/Seed smoke, server syntax, engineering policy, docs, 29 workflow checks and public-source validation all PASS. One edited C# NUnit file parsed by Roslyn with zero syntax errors. This does *not* replace Unity EditMode CI execution: prior Unity CI found the literal expectation failure, and the fix must be verified in the newly triggered CI jobs.

The new audit remains a *read-only snapshot*. It cannot lock out other processes that edit stored assets after the scan. A future actual commit must acquire durable Host↔SQLite↔Guest write fencing, recheck the exact source bytes, complete the fresh Publisher possession challenge and recover atomically from interruption. The entire M4→M5 release remains blocked until Unity EditMode CI, Windows 2-PC collaboration, crash/rollback and packaged release tests have independent proof.

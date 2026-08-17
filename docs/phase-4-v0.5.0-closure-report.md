# TeamForge Phase 4 v0.5.0 Closure Report

Date: 2026-08-10 (Asia/Seoul)

Closure scope: Phase 4 / UX Pass 4 baseline freeze only. Phase 4.5 refactoring, Authority Core extraction, new interfaces, WebRTC, `project-peer` removal and Phase 5 are not included.

## Frozen source candidate

| Field | Value |
| --- | --- |
| Filename | `Unity-TeamForge-Phase4-v0.5.0-uxpass4-candidate.zip` |
| SHA-256 | `ED27CC23459B15AB90337A7DF181996D469A2DC33F252EE49125814256521AE7` |
| Archived files | 255 |
| Product | `0.5.0` |
| Unity target | `6000.3.21f1` |
| Realtime Protocol | `1` |
| Transfer Protocol | `1` |

The supplied archive was preserved as the immutable input. WP0 was performed on a separate extracted working copy.

## Field evidence

The following results were supplied by the user from actual Unity execution against the exact candidate identified above. They are accepted as field evidence; Codex did not launch Unity during WP0.

| Gate | Result | Evidence classification |
| --- | --- | --- |
| Unity 6.3 LTS Editor | `6000.3.21f1` | User field environment |
| EditMode Test Runner | **94/94 PASS** | User-provided exact-candidate field evidence |
| A/B/C Late Join | **PASS** | User-provided exact-candidate field evidence |
| UX Pass 4 Language | **PASS** | User-provided exact-candidate field evidence |
| UX Pass 4 Tooltip | **PASS** | User-provided exact-candidate field evidence |
| UX Pass 4 Invite basic UX | **PASS** | User-provided exact-candidate field evidence |

The earlier `91/91` result belongs to UX Pass 2 Hotfix2. UX Pass 4 added three EditMode regressions. The later exact-candidate `94/94 PASS` closes the evidence mismatch; it is not merely an expected count.

## WP0 documentation corrections

1. Updated the UX Pass 4 report from an expected 94 count to exact-candidate user field evidence of `94/94 PASS`.
2. Replaced the Phase 3-only Architecture overview with the current Phase 0–4 implementation, including Hierarchy, Tombstone/conflict, shared Session Revision and Project Transfer boundaries.
3. Corrected Project Transfer capability/snapshot documentation to match the actual Protocol v1 order:

   `hello_ack → presence_snapshot → hierarchy_snapshot → transform_snapshot → project_registry_snapshot`

   Unnegotiated snapshots remain omitted, and a Presence-free Standalone Project Peer receives `hello_ack → project_registry_snapshot`.
4. Updated current-state/evidence ledgers without rewriting earlier stage-specific history.
5. Added this Closure report and a documentation-only changed-file list.

## Contract freeze

WP0 does not change:

- Protocol v1 version, message schemas, field meanings, error meanings, ordering behavior or capability gates;
- Presence, Transform, Hierarchy, Lock, Revision, Tombstone or conflict runtime behavior;
- Project Coordinator semantics;
- Manifest, Chunk, Resume, Hash, Staging, Trust or Activation behavior;
- Project UUID, signed Project Invite or `TF1…` realtime invite formats;
- `project-peer`, WebSocket transport or bootstrap/activation code.

No product source file was edited. No Phase 4.5 implementation or Phase 5 work was started.

## WP0 execution evidence

| Check | Result |
| --- | --- |
| Original candidate SHA-256 | **PASS** — exact value recorded above |
| Product-source difference from supplied candidate | **PASS** — no product source changes; documentation-only set listed separately |
| Repository validator | **PASS** — `257 files, 43 C# sources, protocol v1` (`npm.cmd run validate`, WP0 environment) |
| Unity Test Runner executed by WP0 | **NOT RUN** — user field evidence used |
| A/B/C executed by WP0 | **NOT RUN** — user field evidence used |
| Full Node test suites executed by WP0 | **NOT RUN** — not requested and installed dependency trees are absent |

## Closure artifact

The new archive is named `Unity-TeamForge-Phase4-v0.5.0-closure.zip`. Its SHA-256 is published beside the archive in `Unity-TeamForge-Phase4-v0.5.0-closure.zip.sha256` after the final repository validation and packaging step. The archive cannot contain its own final hash without changing that hash.

## Outcome

Phase 4 / UX Pass 4 is frozen as the rollback and compatibility baseline for future Phase 4.5 work. Work stops after WP0 delivery; this report does not authorize implementation to continue.

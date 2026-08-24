# Known issues — 0.5.1 WP5.1 current candidate

Release identity: `0.5.1-wp5.1-path-resilience`  
Status: **FIELD BLOCKED**  
Last reviewed: 2026-08-25 (Asia/Seoul)

This file lists current candidate limitations, active field bugs, and missing validation. Historical issue/report files retain the state of their exact recorded artifacts and are not current instructions.

## Active field blockers

| Item | Status | Release effect |
| --- | --- | --- |
| #67 — saved Guest Scene reconnect (`guest_handoff_mismatch`) | OPEN / field reproduced | Unsaved Guest restart/rejoin works, but saving collaborative Scene changes the disk hash and blocks same-session reconnect. Release reconnect/recovery gate remains open. |
| #68 — rapid Transform / lock protected conflict | OPEN / field reproduced | Rapid repeated manipulation can leave the Guest refusing later remote Transform updates; UI lock/conflict state has also disagreed with the internal protected-conflict path. Draft PR #72's first synthetic chaos lane did not reproduce the physical failure. |
| #69 — force-ending Launcher during receive | OPEN / field reproduced | Abrupt termination during `Receiving` can surface an unhandled CLR application-error dialog. Interruption/resume must remain recoverable without an unhandled UI/process failure. |
| #70 — Windows Firewall cannot resolve bundled Node path for Seed rule | OPEN / field reproduced | Coordinator fixed-port access can be allowed, but dynamic Seed ports plus an unresolvable program path make repeatable LAN onboarding fragile across Host restarts. |
| #71 — execution alias rejected by Guest handoff | OPEN / field reproduced | Path-resilience can select a short execution alias, but Editor handoff still requires exact canonical Active-path string equality and can reject the verified Guest bootstrap. |

## Current positive two-PC evidence

| Item | Status | Meaning |
| --- | --- | --- |
| Host → Invite → fresh Guest → transfer → trust → Active Project → realtime | FIELD PASS recorded | The basic physical two-PC fresh-Guest path has positive evidence. This does not close the active bugs above or replace an exact post-fix candidate rerun. |
| Presence / bidirectional Transform / normal lock contention / supported Same-Scene Hierarchy operations | FIELD PASS recorded | Core realtime collaboration worked in the recorded run before the later failure cases were exercised. |
| Unsaved Guest exit → Launcher reopen → authoritative snapshot recovery | FIELD PASS recorded | Reconnect infrastructure can restore current session state when the on-disk Scene still matches the original verified baseline. This specifically narrows #67 to persisted/saved Scene handling. |
| Coordinator network interruption → retry → reconnect | FIELD PASS recorded | Temporarily blocking Guest → Coordinator TCP/5080 caused disconnect/retry and automatic recovery after the block was removed, without restarting Unity. This is not the same as persistent server/session restart recovery. |

## Remaining validation / platform limitations

| Item | Status | Release effect |
| --- | --- | --- |
| Exact post-fix two-PC candidate closure | Required before closure | Rerun the intended candidate after active blockers are fixed; do not infer closure from the earlier successful baseline run. |
| Exact-candidate fresh-install / fresh-project workflow | Required before closure | Validate normal user-facing setup rather than only development or previously prepared workspaces. |
| Full host/server/seed/process-loss matrix | Partial | Coordinator network interruption/reconnect has positive evidence, but process restart/host loss/seed loss and safe new-session behavior remain to be checked. |
| Unity `6000.3.21f1` Compile/EditMode on exact release candidate | Use retained exact evidence only | Must not be inferred from Node/static tests or an older artifact. |
| Newer Unity `6000.3` patch rebaseline | Separate follow-up | Do not call a newer patch supported/validated until it is installed and tested against the candidate. |
| Launcher Authenticode signature | NOT SIGNED | Verify distribution channel and exact candidate SHA-256; SmartScreen reputation/signing remains a gap. |
| Docker/Compose | NOT RUN as a current release gate | Source/server option only; not the normal bundled Host path. |
| macOS/Linux Launcher | NOT PACKAGED / NOT RUN | Current packaged candidate is Windows x64 only. |
| Arbitrarily deep Windows paths | Unsupported | Use the managed/short path strategy; the release path budget is finite. |
| Path-resilience fallback outside managed policy | Unsupported | Short-workspace handling must not bypass containment, runtime integrity, trust, activation, or Unity handoff validation. |
| Untrusted public-internet exposure | Unsupported | Shared access code is intended for trusted LAN/VPN/team environments. |
| Server restart persistence | Not implemented | Current authority/session state is memory-resident. A server restart is expected to lose the old Session/Lock/Hierarchy/Transform authority state; current testing should verify clean disconnect/fail-closed/new-session recovery rather than old-state persistence. |
| WebRTC/NAT traversal/relay | Not implemented | Direct peer reachability is still required. |
| Persistent diagnostic/recovery history across runs | Not implemented | Diagnostic history is bounded and current-run only. |
| Arbitrary Component/`SerializedProperty` synchronization | Known limitation | General Component/Inspector synchronization is not a supported current workflow. |
| General Prefab/Asset synchronization | Known limitation | Outside the current supported same-Scene collaboration subset. |

## Version wording rule

Do not use phrases such as “the current/latest Unity patch” as durable repository facts unless they are tied to a dated review. Unity patch availability changes independently of TeamForge.

The durable compatibility claim is the one in `release-contract.json`: the package line is `6000.3`, and the recorded candidate test Editor is `6000.3.21f1`. A different patch needs its own validation evidence.

## Historical fixes already incorporated

The previous 0.5.0 candidate's long release root, ambiguous invite actions, loopback advertising, obsolete validator, and dead packaged npm scripts were fixed or removed during the 0.5.1 lineage. WP5 added diagnostics/recovery UX, and WP5.1 added path-resilience/automatic-short-workspace handling.

Those statements describe implementation history, not field closure. Current readiness is governed by [STATUS.md](STATUS.md), exact candidate identity by [`../release-contract.json`](../release-contract.json), and packaged artifact classification by [`../builds/README.md`](../builds/README.md).

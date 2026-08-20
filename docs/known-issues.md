# Known issues — 0.5.1 WP5.1 current candidate

Release identity: `0.5.1-wp5.1-path-resilience`  
Status: **FIELD BLOCKED**

This file lists current candidate limitations and missing validation. Historical issue/report files retain the state of their exact recorded artifacts and are not current instructions.

| Item | Status | Release effect |
| --- | --- | --- |
| Prior exact two-PC Host → fresh Guest run | FIELD PASS reported for an earlier candidate | Useful historical bootstrap evidence, but not a substitute for executing the exact current WP5.1 candidate field gate |
| Exact current-candidate two-PC Host → fresh Guest workflow | Required before closure | WP5.1 remains FIELD BLOCKED until current artifact validation is recorded |
| Existing Guest same-session/revision refresh/rejoin workflow | Validation incomplete for current release lineage | Do not infer a current PASS from earlier source/static tests |
| WP5 diagnostics/recovery field workflow | Validation incomplete for current release lineage | WP5/WP5.1 remain FIELD BLOCKED where manual behavior has not been rerun on the exact candidate |
| Unity `6000.3.21f1` Compile/EditMode on exact candidate | Use current retained evidence only | Must not be inferred from Node/static tests or an older candidate report |
| Newer Unity `6000.3` patch rebaseline | Separate follow-up | Do not call a newer patch supported/validated until it is installed and tested against the candidate |
| Launcher Authenticode signature | NOT SIGNED | Verify distribution channel and exact candidate SHA-256; SmartScreen reputation/signing remains a gap |
| Docker/Compose | NOT RUN as a current release gate | Source/server option only; not the normal bundled Host path |
| macOS/Linux Launcher | NOT PACKAGED / NOT RUN | Current packaged candidate is Windows x64 only |
| Arbitrarily deep Windows paths | Unsupported | Use the managed/short path strategy; the release path budget is finite |
| Path-resilience fallback outside managed policy | Unsupported | Short-workspace handling must not bypass containment, runtime integrity, trust, activation, or Unity handoff validation |
| Untrusted public-internet exposure | Unsupported | Shared access code is intended for trusted LAN/VPN/team environments |
| Server restart persistence | Not implemented | Persistent authority/session recovery remains future work |
| WebRTC/NAT traversal/relay | Not implemented | Direct peer reachability is still required |
| Persistent diagnostic/recovery history across runs | Not implemented | Diagnostic history is bounded and current-run only |
| Arbitrary Component/`SerializedProperty` synchronization | Known limitation | General Component/Inspector synchronization is not a supported current workflow |
| General Prefab/Asset synchronization | Known limitation | Outside the current supported same-Scene collaboration subset |

## Version wording rule

Do not use phrases such as “the current/latest Unity patch” as durable repository facts unless they are tied to a dated review. Unity patch availability changes independently of TeamForge.

The durable compatibility claim is the one in `release-contract.json`: the package line is `6000.3`, and the recorded candidate test Editor is `6000.3.21f1`. A different patch needs its own validation evidence.

## Historical fixes already incorporated

The previous 0.5.0 candidate's long release root, ambiguous invite actions, loopback advertising, obsolete validator, and dead packaged npm scripts were fixed or removed during the 0.5.1 lineage. WP5 added diagnostics/recovery UX, and WP5.1 added path-resilience/automatic-short-workspace handling.

Those statements describe implementation history, not field closure. Current readiness is governed by [STATUS.md](STATUS.md), exact candidate identity by [`../release-contract.json`](../release-contract.json), and packaged artifact classification by [`../builds/README.md`](../builds/README.md).

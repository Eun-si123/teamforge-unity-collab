# Known issues — 0.5.1 WP5 Diagnostics & Recovery UX

| Item | Status | Release effect |
| --- | --- | --- |
| Prior exact two-PC Host → fresh Guest run | FIELD PASS reported by tester | Prior bootstrap prerequisite satisfied; evidence is not a new WP4.1 execution |
| Exact existing Guest same-session/revision refresh/rejoin run | NOT RUN | WP4.1 FIELD BLOCKED |
| Exact WP5 diagnostics/recovery field checklist | NOT RUN | WP5 FIELD BLOCKED |
| Unity 6000.3.21f1 Compile/EditMode on exact candidate | See current release audit | Must not be inferred from Node/static tests |
| Unity 6000.3.22f1 current patch rebaseline | NOT RUN | Follow-up; 21f1 remains supported and not known vulnerable |
| Launcher Authenticode signature | NOT SIGNED | Verify distribution channel and SHA-256 sidecar; SmartScreen trust gap remains |
| Docker/Compose | NOT RUN | Source/server option only; not the normal bundled Host path |
| macOS/Linux Launcher | NOT PACKAGED / NOT RUN | Windows x64 candidate only |
| Arbitrarily deep Windows extraction paths | Unsupported | Use the short candidate root and keep the absolute Runtime path within the 240-character release gate |
| Untrusted public-internet exposure | Unsupported | Shared access code is intended for trusted LAN/VPN/team environments |
| Server restart persistence | Not implemented | Phase 5 scope |
| WebRTC/NAT traversal/relay | Not implemented | Explicitly outside this hotfix |
| Persistent recovery/history across runs | Not implemented | Explicitly outside WP5; history is bounded and current-run only |
| Arbitrary component/serialized-property synchronization | Known Limitation | Explicitly outside WP5 |

The previous 0.5.0 candidate’s long root, ambiguous invite actions, loopback
advertising, obsolete validator, and dead packaged npm scripts are fixed or
removed in 0.5.1. Historical issue files retain their original recorded state
and are not current instructions.

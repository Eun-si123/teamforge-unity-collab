# TeamForge roadmap — current 0.5.1 view

| Work | State |
| --- | --- |
| Protocol v1 realtime/presence/transform/lock/hierarchy | Preserved |
| Direct HTTP Project Transfer v1 and signed bootstrap | Preserved |
| WP3.5 bundled Runtime and WP4 Windows Launcher | Implemented; automated gate required |
| WP4 release-integrity/field hotfix 0.5.1 | Automated qualification passed; Field Closure BLOCKED |
| Exact Host → fresh Guest two-PC Windows path | FIELD PASS reported by the tester for the prior 0.5.1 candidate |
| WP4.1 existing Guest refresh/rejoin | Implemented; automated qualification required; two-PC field gate BLOCKED |
| WP5 beginner diagnostics and state-driven safe recovery | Implemented; exact-final automated gate pending; manual field gate NOT RUN |
| Unity 6000.3.22f1 rebaseline | Follow-up; NOT RUN |
| Authenticode signing/installer | Follow-up; NOT SIGNED |
| macOS/Linux standalone launchers | Not packaged |
| Phase 5 persistent recovery/component expansion beyond WP5 UX | Not started; outside this work package |

Near-term order:

1. Freeze and verify the 0.5.1 WP5 Windows x64 ZIP.
2. Run the WP5 diagnostics/recovery checklist without exposing secrets or
   bypassing Scene/Project validation.
3. Rejoin the prior rev1 Guest with a new same-Baseline session invite.
4. Publish rev2 and refresh the same managed root without overwriting rev1.
5. Run the negative/failed-transfer items and record actual two-PC evidence.
6. Only then decide whether WP5 and WP4.1 can close.
7. Rebaseline the current Unity 6000.3 patch in a separate tested candidate.

WebRTC, ICE/STUN/TURN, relay, NAT traversal, discovery, and automatic routing
remain outside this roadmap item.

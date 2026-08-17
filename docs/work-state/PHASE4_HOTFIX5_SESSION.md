# Phase 4 Hotfix5 Session

Date: 2026-08-08 (Asia/Seoul)

## Field observation
- Hotfix4 EditMode: 71/71 PASS.
- Two-Editor Create -> Transform and symmetric Basic Lock: field PASS.
- Rename propagates in both directions, but the observing peer resets the renamed object's displayed Transform to stale `(0,0,0)` until the lock owner moves it again.

## Diagnosis
- Server `session.transforms` was current but `session.hierarchyObjects` retained older transform fields.
- Unity remote hierarchy apply reapplied complete Hierarchy state even for rename/reorder.
- Result: rename could temporarily roll the observer to a stale Hierarchy Transform.

## Hotfix5 changes
- Server accepted Transform updates also refresh matching authoritative Hierarchy transform fields with rollback-safe snapshot limit checks.
- Unity applies Hierarchy Transform payload only for create/reparent target records; rename/reorder preserve live Transform.
- Added Server integration + Unity EditMode regressions and validator guards.

## Current automated state
- Server 50/50 PASS.
- Project Peer 62/62 PASS.
- Validator PASS.
- Smoke PASS, serverRelayUsed=false.
- Offline audit 0 vulnerabilities.
- Unity field gate pending; expected EditMode count 72.

## Next
Restart Hotfix5 Server, replace both Unity packages, require 72/72, then repeat bidirectional rename at non-zero coordinates. Only after PASS continue to Reparent/cycle/reorder/delete/conflict/late join.

# Phase 4.5 Closure Test Report

Date: 2026-08-11 (Asia/Seoul)  
Environment: Windows NT `10.0.26200.0`, Node.js `24.18.1`, npm `11.16.0`, Unity `6000.3.21f1` (`c02631ffc030`)

## Evidence rules

- A reported PASS requires a completed command, zero failure result and its expected count/assertions.
- User-confirmed WP7 evidence is historical input evidence, not a WP8 execution claim.
- The first WP8 Unity launch was blocked before test execution by Licensing Client IPC; a second launch was blocked before test execution by the still-open project lock. Neither is counted as a test result.
- The successful Unity run produced an NUnit XML result with `result=Passed`, `total=105`, `passed=105`, `failed=0`, `skipped=0`, `inconclusive=0`.
- A/B/C multi-editor and Project field tests are `NOT RUN` until the user completes the final-candidate checklist.

## Current source tree

| Area | Command/gate | Result |
| --- | --- | --- |
| Server dependencies | `npm.cmd ci` with workspace-local `TEMP`/`TMP` | PASS; 0 audit vulnerabilities reported |
| Server tests | `npm.cmd test` | **70/70 PASS**, 0 failed/skipped/cancelled/todo |
| Server syntax | `npm.cmd run check` | PASS |
| Server smoke | `npm.cmd run smoke` | PASS: health, legacy Hello, pong, Presence, Transform, Lock and Project snapshot assertions true |
| Project Peer dependencies | `npm.cmd ci` with workspace-local `TEMP`/`TMP` | PASS; 0 audit vulnerabilities reported |
| Project Peer tests | `npm.cmd test` | **73/73 PASS**, 0 failed/skipped/cancelled/todo |
| Project Peer syntax | `npm.cmd run check` | PASS; 38 modules checked |
| Direct Transfer smoke | `npm.cmd run smoke` | PASS: transfer/Descriptor/Manifest true, 3 inventory Chunks, `serverRelayUsed=false` |
| Unity EditMode | Unity CLI `-batchmode -nographics -runTests -testPlatform EditMode -testResults ... -logFile ...` | **105/105 PASS**, 0 failed/skipped/inconclusive |
| WP7 byte parity | SHA-256 compare of product/runtime/package/protocol baseline set | PASS: 168 files compared, 0 differences |
| Repository validator | `node scripts/validate-repository.mjs` | **PASS**: 309 files, 51 C# sources, Protocol v1 |

## Exact final fresh archive

| Area | Result |
| --- | --- |
| Archive entry/root inspection | **PASS**: 309 files, root `package.json`, root `.gitignore`, no wrapper directory |
| Server install/test/check/smoke | **PASS**: `npm ci`, 70/70, syntax/check and smoke |
| Project Peer install/test/check/smoke | **PASS**: `npm ci`, 73/73, 38-module syntax check and Direct Transfer smoke |
| Repository validator | **PASS**: 309 files, 51 C# sources, Protocol v1 before generated dependency/import artifacts |
| Unity 6000.3.21f1 EditMode | **105/105 PASS**, 0 failed/skipped/inconclusive |
| Product/protocol parity | **PASS**: 168 frozen WP7 files compared, 0 differences |

The complete gate was first rehearsed against a provisional ZIP. After replacing all pending result text, the archive was rebuilt and the same complete gate was repeated against the exact final ZIP. Only the exact-final results above are Closure evidence.

## Field gate

All items are currently **NOT RUN**: A/B/C connection and Late Join; Presence; bidirectional Transform; Lock; Hierarchy Create/Rename/Reparent/Reorder/Delete; Project Publish/Invite/Sync. Use [phase-4.5-field-closure-checklist.md](phase-4.5-field-closure-checklist.md) and record the exact candidate filename and SHA-256.

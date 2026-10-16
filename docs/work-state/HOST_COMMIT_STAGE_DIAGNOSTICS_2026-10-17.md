# Host startup stage diagnostics — 2026-10-17

## Intent
Improve the unresolved diagnostic part of Issue #223 without claiming to reproduce or resolve physical r8 `coordinator_timeout`. Current `main` already rejects malformed IPv4-like input and clears stale Host state; preserve that behavior.

## Scope
Provide a bounded, hardcoded non-secret `stage` identifier on failed `commitHost` operations. Keep existing `failure.rawCode`, `failure.kind`, `message`, `action`, recovery behavior, and ownership cleanup unchanged. Unity Host UI renders `Host stage: ...` in sanitized current Host detail. No server/client wire protocol change; additive local bridge field only. No endpoint, token, path, host identity or external exception object in `stage`.

## Negative conditions
Before Coordinator spawn, distinguish input validation from start/listen stage. After spawn, distinguish Coordinator snapshot handshake, Baseline restoration, seed publication and peer registry verification. Do not present the stage as proven network root cause. Each attempt creates its own state, never reuse a prior stage. Fail-closed, no credential leak, no destructive lifecycle changes.

## Evidence target
Node host orchestration focused tests and full server+peer suites; Unity EditMode serialized `Failure.stage` and current-error diagnostic regression; docs/engineering/workflow validators; CI Unity tests. Physical Windows r8 remains FIELD BLOCKED.

## Checkpoint
Branch `fix/host-commit-stage-diagnostics-20261017`, forked from `main` at `1cc315d`. At creation: plan only, no tests yet. Preserve original stale working copies and uncommitted locale picker files.


## Implementation and evidence

- `project-peer/src/host-orchestrator.mjs`: fixed per-attempt failure stage, additive to stable code/action; lifecycle cleanup unchanged.
- `unity-package/com.eunsung.teamforge/Editor/UX/TeamForgeHostFlow.cs`: known labels only; unknown inputs ignored, current detail retains original error message.
- Node Host focused suite 13 pass; full Project Peer 217 pass and 5 platform skips, Server 194 pass.
- Initial fresh-worktree tests failed due missing `ws` dependency and npm CLI auto-resolution. After locked `npm run install:all` plus `npm_execpath=/usr/lib/node_modules/npm/bin/npm-cli.js`, tests passed.
- Unity EditMode serialization/display regression added; GitHub CI result must be recorded separately.
- The original physical r8 `coordinator_timeout` and any alleged firewall root cause remain unproven. Issue #223 remains open.

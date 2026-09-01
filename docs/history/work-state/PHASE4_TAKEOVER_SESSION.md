# Phase 4 takeover session

Date: 2026-08-07 Asia/Seoul

## Input
- Hotfix3 candidate SHA-256 verified: `15A3B4A59919ACEA6F21CDF98F83B2FC2EFB081763B18CC7BC820D81F0E61743`.
- Input preserved unchanged under `<WORK_ROOT>/base`.
- Working copy: `<WORK_ROOT>/stageA`.
- User has explicitly approved Phase 4 entry, but Stage A Phase 3 closure is performed first and kept separate.

## Stage A plan
1. Windows Active-path preflight / diagnostics.
2. Resume success observability.
3. Publish-vs-seed no-op UX guard.
4. Clarify partial-seed upload limiter option while keeping compatibility.
5. Run full automated/fresh-extract gates and freeze a Phase 3 closure artifact.

## Stage B boundary
- Start only from the exact frozen Stage A source.
- Scope: create/delete/rename/reparent/sibling order + hierarchy conflicts.
- Phase 5 persistence remains out of scope.

## Stage A implementation checkpoint 1
- Added pure CLI policy module for no-op publish guard, transfer-rate alias semantics, and Windows Unity Active-path preflight.
- `publish` now refuses an identical second publication by default and directs the user to `seed`; intentional identical revisions require `--force-new-revision`.
- `sync` accepts `--partial-seed-max-bytes-per-second`; legacy `--max-bytes-per-second` remains compatible for sync but is documented as a partial-seed upload limiter.
- Sync success JSON now exposes total/transferred/resumed Chunk and byte counts.
- Windows preflight is warning-only (no payload corruption risk): it estimates generated Unity PackageCache headroom and warns before download when the observed path shape is high-risk. It never changes OS registry policy.
- Added policy and downloader regression tests.

# TeamForge Phase 3 v0.4.1 Closure Patch Report

## Conclusion
Stage A closes the practical gaps discovered during the user's Hotfix3 field validation without changing Unity C# behavior, Coordinator payload architecture, or protocol version.

## Changes
1. Windows Active-path risk preflight with warning-only short-root guidance.
2. Successful Sync JSON transfer/resume counters.
3. Identical re-Publish blocked by default; `seed` is the normal re-advertisement path; `--force-new-revision` is explicit escape hatch.
4. `--partial-seed-max-bytes-per-second` clarifies Sync's partial-seed upload limiter; old option remains compatible.

## Security impact
No secrets are added to results. No path/manifest containment is relaxed. Coordinator remains metadata-only and P2P payload transfer remains direct.

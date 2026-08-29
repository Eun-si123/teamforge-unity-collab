# TeamForge agent instructions

## Before changing code

- Use `docs/STATUS.md` for current capability/readiness claims and `release-contract.json` for exact candidate/runtime identity.
- Use `docs/README.md` for the documentation map and `CODEMAP.md` to find the smallest relevant source and test surface.
- Do not treat historical `docs/work-state/`, `docs/phases/`, dated evidence notes, or engineering-history files as current truth when they conflict with current docs/code.

## Before substantial implementation

For non-trivial behavior, architecture, security, networking, filesystem, recovery, release, or Unity synchronization changes:

1. Read `docs/ENGINEERING_GUIDE.md`.
2. Define the problem and intended outcome before editing implementation code.
3. Classify affected subsystems and risk. Use `quality-gates.json` / `scripts/classify-change.mjs` as a routing aid.
4. Identify authority/state ownership and the invariants that must remain true.
5. List believable failure modes, including partial completion, stale/replayed input, reordering, disconnect/shutdown, path/trust mismatch, or recovery behavior where relevant.
6. Decide the evidence required before implementation: focused tests, subsystem suite, Unity E2E, chaos/property testing, release validation, or physical field evidence.
7. Keep explicit out-of-scope items so an AI-assisted change does not silently broaden itself.
8. After implementation, record what was actually tested and what remains unverified.

Use `docs/templates/CHANGE_PLAN.md` when the change is substantial enough that intent, risk, or required evidence would not be obvious from a small diff.

## Change rules

- Keep changes focused; avoid unrelated refactors, generated output, or build artifacts.
- Preserve realtime authority/protocol compatibility unless the task explicitly requires a protocol change.
- Do not weaken authentication, path safety, signature/hash/identity checks, activation rules, environment scrubbing, or other fail-closed security boundaries.
- Never commit credentials, invite secrets, tokens, private user data, or machine-local private paths.
- Do not claim a test, field gate, release state, benchmark, or behavior is verified unless it was actually verified.
- Do not treat a successful retry, fallback, or UI path as permission to weaken the underlying trust/identity contract.

## Validation

- Run the smallest relevant tests for changed code plus the stronger lanes required by the change risk.
- Use `npm run classify:change -- <paths...>` or pipe `git diff --name-only` into `node scripts/classify-change.mjs --stdin` when the required validation surface is unclear.
- For server/project-peer or repository-wide source changes, run `npm test` when practical.
- For engineering-policy changes, run `npm run validate:engineering`.
- For documentation governance and links, run `npm run validate:docs`.
- For source/document contract changes, run `npm run validate`.
- For `.github/workflows/` changes, run `npm run validate:workflows`.
- For Unity package changes, run the relevant Unity tests; `scripts/windows/Run-Unity-Tests.cmd` is the Windows helper.
- `npm run validate:release` is only for a fully staged release-candidate tree.
- Physical two-PC evidence is a separate evidence class; do not claim it from same-machine or CI results.

## Documentation changes

Before making a non-trivial documentation change:

1. Read `docs/DOCUMENTATION_GUIDE.md`.
2. Identify what actually changed and what evidence supports the claim.
3. Identify the **canonical owner** of the changing fact using `docs/README.md` and the guide.
4. Make a short documentation plan: audience, reader question, document type, canonical owner, required files, files that should not change, volatility, historical handling, and validation.
5. Update the smallest required current document set. Prefer links to the owning source over copying volatile values into several files.
6. Preserve dated historical evidence instead of rewriting it to match current behavior. Add a supersession note only when readers could otherwise mistake it for current truth.
7. Keep `STATUS.md` about current capability/evidence/readiness and `ROADMAP.md` about direction. Do not turn either into a duplicate of the other.
8. Keep `SOURCE.md` about source checkout/build/validation workflow and `CODEMAP.md` about question-to-code navigation.
9. Keep module READMEs focused on module responsibility and operating boundaries. Exact current runtime/release selections belong in `release-contract.json`; live readiness belongs in `STATUS.md`.
10. Run `npm run validate:docs` after documentation changes.

Use `docs/templates/DOCUMENTATION_PLAN.md` when a written plan helps. Other templates under `docs/templates/` are starting structures, not mandatory boilerplate.

## Documentation ownership reminders

- Current capability/blocker/readiness: `docs/STATUS.md`.
- Exact runtime/tool/protocol/release selections: `release-contract.json`.
- Packaged byte identity: `builds/README.md` + GitHub Release SHA-256.
- Future direction: `docs/ROADMAP.md`.
- Current as-built topology/trust boundaries: `docs/architecture.md`.
- Source workflow: `docs/SOURCE.md`.
- Code navigation: `CODEMAP.md`.
- Product-facing version history: root `CHANGELOG.md` and package changelog as applicable.
- Repository/engineering history that does not describe a product version change: `docs/history/` or another dated historical record.

## Release-tool naming

New release automation should use the WP-neutral entry points `scripts/build-launcher.mjs`, `scripts/verify-launcher.mjs`, and `scripts/stage-release.mjs`. The historical WP4-named implementation files remain temporary compatibility internals and should not be copied into new work-package-specific entry points.

See `.github/CONTRIBUTING.md` and `.github/SECURITY.md` for the full contribution and security policies.

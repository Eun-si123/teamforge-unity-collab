# TeamForge agent instructions

## Before changing code

- Use `docs/STATUS.md` for current capability/readiness claims and `release-contract.json` for exact candidate/runtime identity.
- Use `docs/README.md` for the documentation map and `CODEMAP.md` to find the smallest relevant source and test surface.
- Do not treat historical `docs/work-state/`, `docs/phases/`, dated evidence notes, or engineering-history files as current truth when they conflict with current docs/code.

## Change rules

- Keep changes focused; avoid unrelated refactors, generated output, or build artifacts.
- Preserve realtime authority/protocol compatibility unless the task explicitly requires a protocol change.
- Do not weaken authentication, path safety, signature/hash/identity checks, activation rules, environment scrubbing, or other fail-closed security boundaries.
- Never commit credentials, invite secrets, tokens, private user data, or machine-local private paths.
- Do not claim a test, field gate, release state, benchmark, or behavior is verified unless it was actually verified.

## Validation

- Run the smallest relevant tests for changed code.
- For server/project-peer or repository-wide source changes, run `npm test` when practical.
- For documentation governance and links, run `npm run validate:docs`.
- For source/document contract changes, run `npm run validate`.
- For `.github/workflows/` changes, run `npm run validate:workflows`.
- For Unity package changes, run the relevant Unity tests; `scripts/windows/Run-Unity-Tests.cmd` is the Windows helper.
- `npm run validate:release` is only for a fully staged release-candidate tree.

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

See `.github/CONTRIBUTING.md` and `.github/SECURITY.md` for the full contribution and security policies.

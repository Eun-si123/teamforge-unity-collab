# TeamForge agent instructions

## Before changing code

- Use `docs/STATUS.md` for current capability/readiness claims and `release-contract.json` for exact candidate/runtime identity.
- Use `docs/README.md` for the documentation map and `CODEMAP.md` to find the smallest relevant source and test surface.
- Do not treat historical `docs/work-state/` or `docs/phases/` notes as current truth when they conflict with current docs/code.

## Change rules

- Keep changes focused; avoid unrelated refactors, generated output, or build artifacts.
- Preserve realtime authority/protocol compatibility unless the task explicitly requires a protocol change.
- Do not weaken authentication, path safety, signature/hash/identity checks, activation rules, environment scrubbing, or other fail-closed security boundaries.
- Never commit credentials, invite secrets, tokens, private user data, or machine-local private paths.
- Do not claim a test, field gate, release state, benchmark, or behavior is verified unless it was actually verified.

## Validation

- Run the smallest relevant tests for changed code.
- For server/project-peer or repository-wide source changes, run `npm test` when practical.
- For source/document contract changes, run `npm run validate`.
- For Unity package changes, run the relevant Unity tests; `scripts/windows/Run-Unity-Tests.cmd` is the Windows helper.
- `npm run validate:release` is only for a fully staged release-candidate tree.

## Documentation

- Update `CODEMAP.md` when major file responsibilities move.
- Update current status/architecture/security docs only when the corresponding truth changes.
- Record notable repository/tooling changes in root `CHANGELOG.md`; runtime/package changes belong in `unity-package/com.eunsung.teamforge/CHANGELOG.md`.

See `.github/CONTRIBUTING.md` and `.github/SECURITY.md` for the full contribution and security policies.

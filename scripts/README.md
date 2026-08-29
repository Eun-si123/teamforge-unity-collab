# TeamForge repository scripts

These scripts support development, validation, packaging, and the generated project website. Prefer the documented entry points below instead of invoking internal helpers blindly.

## Common developer entry points

- `teamforge.ps1` — Windows development helper for server, install, test, smoke, verify, and related workflows.
- `windows/` — small Windows convenience wrappers that call `teamforge.ps1` by script-relative path.
- `run-unity-tests.sh` — Unity test helper used by automation/Linux environments.
- `classify-change.mjs` — classifies changed paths into risk and recommended validation lanes using `quality-gates.json`.
- `validate-engineering.mjs` — validates the engineering-process / quality-gate contract.
- `validate-documentation.mjs` — validates documentation ownership, governance, and local Markdown links.
- `validate-public-source.mjs` — validates an ordinary public source checkout.
- `validate-workflows.mjs` — checks GitHub Actions for explicit permissions, immutable external action references, bounded job runtimes, and unsafe `pull_request_target` usage.
- `validate-repository.mjs` — validates a fully staged release-candidate tree; it is not the normal fresh-clone validator.

## Runtime and release tooling

New release automation should use these **WP-neutral entry points**:

- `build-launcher.mjs` — current Launcher build entry point.
- `verify-launcher.mjs` — current Launcher verification entry point.
- `stage-release.mjs` — current release staging entry point.

The current implementation of those entry points delegates to historical WP4-named implementation files while the internals are migrated. The old names remain compatibility implementation details; do not create new work-package-specific entry points for WP6/WP7-style work.

Other release/runtime helpers include:

- `build-runtime-bundle.mjs` / `verify-runtime-bundle.mjs` — build and verify packaged Runtime contents.
- `verify-current-release-archive.ps1` — verifies an exact candidate ZIP/manifest/file-hash layout.
- `validate-repository.mjs` — validates a fully staged release tree including generated evidence.

## Website, search, and LLM discovery

- `build-agent-web.py` — enriches the generated Pages site with current project/search metadata.
- `build-repository-manifest.py` — generates the exhaustive source-commit-pinned tracked-file inventory.
- `build-sitemap.py` — generates crawler-facing sitemap data.
- `build-update-feeds.py` / `add-update-feed-discovery.py` — generate and advertise RSS/Atom project updates.
- `render_doc_pages.py` — renders selected canonical Markdown documents as normal HTML pages.
- `verify-agent-site.py` — validates generated search/agent outputs and internal discovery links.

## Engineering workflow

For substantial changes, read `docs/ENGINEERING_GUIDE.md` and use `docs/templates/CHANGE_PLAN.md` when a written plan helps.

Examples:

```powershell
npm run classify:change -- server/src/index.mjs project-peer/src/filesystem-safety.mjs
npm run validate:engineering
npm run validate:docs
npm run validate:workflows
```

Path classification is a routing aid. It does not prove that the required Unity/chaos/release/field evidence passed.

For supported developer commands, start with the root `package.json`, `docs/SOURCE.md`, and `.github/CONTRIBUTING.md`.

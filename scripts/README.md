# TeamForge repository scripts

These scripts support development, validation, packaging, and the generated project website. Prefer the documented entry points below instead of invoking internal helpers blindly.

## Common developer entry points

- `teamforge.ps1` — Windows development helper for server, install, test, smoke, verify, and related workflows.
- `windows/` — small Windows convenience wrappers that call `teamforge.ps1` by script-relative path.
- `run-unity-tests.sh` — Unity test helper used by automation/Linux environments.
- `validate-public-source.mjs` — validates an ordinary public source checkout.
- `validate-workflows.mjs` — checks GitHub Actions for explicit permissions, immutable external action references, and unsafe `pull_request_target` usage.
- `validate-repository.mjs` — validates a fully staged release-candidate tree; it is not the normal fresh-clone validator.

## Runtime and release tooling

- `build-runtime-bundle.mjs` / `verify-runtime-bundle.mjs` — build and verify packaged runtime contents.
- `stage-wp4-release.mjs` — stages the bounded release source tree.
- `build-wp4-launcher.mjs` and related release helpers — release-line packaging support.

## Website, search, and LLM discovery

- `build-agent-web.py` — enriches the generated Pages site with current project/search metadata.
- `build-repository-manifest.py` — generates the exhaustive source-commit-pinned tracked-file inventory.
- `build-sitemap.py` — generates crawler-facing sitemap data.
- `build-update-feeds.py` / `add-update-feed-discovery.py` — generate and advertise RSS/Atom project updates.
- `render_doc_pages.py` — renders selected canonical Markdown documents as normal HTML pages.
- `verify-agent-site.py` — validates generated search/agent outputs and internal discovery links.

For supported developer commands, start with the root `package.json`, `docs/SOURCE.md`, and `.github/CONTRIBUTING.md`.

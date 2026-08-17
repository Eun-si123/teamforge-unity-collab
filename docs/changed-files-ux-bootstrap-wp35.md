# UX Bootstrap WP3.5 changed files

## Runtime discovery and Host integration

- `unity-package/com.eunsung.teamforge/Editor/UX/TeamForgeRuntimeDiscovery.cs`
- `unity-package/com.eunsung.teamforge/Editor/UX/TeamForgeRuntimeManifest.g.cs`
- `unity-package/com.eunsung.teamforge/Editor/UX/TeamForgeHostFlow.cs`
- matching Unity `.meta` files

## Packaged runtime

- `unity-package/com.eunsung.teamforge/Runtime~/runtime-manifest.json`
- `unity-package/com.eunsung.teamforge/Runtime~/platforms/win-x64/node.exe`
- `unity-package/com.eunsung.teamforge/Runtime~/platforms/win-x64/LICENSE`
- runtime-only copies under `unity-package/com.eunsung.teamforge/Runtime~/backend`

## Build, verification, dependencies, and tests

- `scripts/build-runtime-bundle.mjs`
- `scripts/verify-runtime-bundle.mjs`
- `scripts/validate-repository.mjs`
- root, Server, and Project Peer package/lockfiles
- `project-peer/src/unified-preflight.mjs`
- `project-peer/test/unified-preflight.test.mjs`

## Documentation

- `README.md`
- `docs/ux-bootstrap-wp35-runtime-packaging-security-report.md`
- this file

No WP4/Phase 5/WebRTC/Component Sync source was added. Existing backend modules were packaged, not rewritten.

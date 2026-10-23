# Dependency tracking scope — TeamForge

This repository uses more than one package format. A green Dependabot status is not proof that every runtime, Unity engine or Asset Store dependency has been scanned.

| Surface | Source of truth | GitHub inventory | Known limitations |
| --- | --- | --- | --- |
| Node.js server and Project Peer | `package-lock.json`, `server/package-lock.json`, `project-peer/package-lock.json` | Native npm dependency graph + Dependabot | Native/runtime tools outside the lock are not included |
| GitHub Actions | `.github/workflows/*.yml` | GitHub Actions manifest scan | Embedded scripts, service images and external runtime executables require separate auditing |
| Unity Test Lab project | `unity-project/Packages/manifest.json` | `Unity UPM dependency inventory` workflow | No committed `packages-lock.json`; current results are declared versions, **not verified resolved versions or transitives** |
| TeamForge embedded Unity package | `unity-package/com.eunsung.teamforge/package.json` | Included as an explicitly marked local workspace entry | Same-repository component, not a separately distributed third-party library |
| Windows .NET 10 Launcher | `launcher/**/*.csproj`, `global.json` | No external `PackageReference` in the current five projects; `NuGetAudit=true` in `launcher/Directory.Build.props` | .NET SDK packs, WPF framework, Windows components and installer/runtime binaries are not NuGet packages |
| Unity Editor 6.3 / engine and Asset Store | Unity installer/editor and externally installed assets | **Not covered by this GitHub snapshot** | Unity Editor/package resolution, native DLLs, external Asset Store assets and installed SDKs need an explicit inventory from a real editor session |

## How the Unity UPM inventory works

- The source script is `scripts/unity_dependency_snapshot.py`. It validates `manifest.json` and the checked-in local `package.json`.
- For `file:` references it checks that the package stays inside the checkout and reads its real name/version from the package manifest, marking the dependency as `local-workspace`.
- When `Packages/packages-lock.json` **exists**, the script checks direct entries and submits actual lockfile versions and known direct→transitive edges. Without it, only direct declared versions are shown, clearly marked `manifest-declaration-unresolved`.
- Unsupported registry, URL or Git revisions fail closed. The script will not fabricate a version, silently omit a dependency, or pretend an Editor-resolved graph exists.
- The snapshot uses `pkg:generic` package URLs. This improves **inventory and SBOM visibility**, but these generic Unity entries generally do **not** gain Dependabot vulnerability alerts because the GitHub Advisory Database does not cover every UPM package ecosystem. See <https://docs.github.com/en/rest/dependency-graph/dependency-submission>.
- This submission is **only** for the Unity manifest. It does not replace or shadow existing npm and GitHub Actions dependency graph entries.
- PRs run read-only tests. Only trusted `main` pushes or a manual dispatch from `main` can use the job-scoped `contents: write` token to submit to GitHub.
- No Unity Editor installation, asset publishing, user-facing website, package release, or code signing is performed.

For local validation:

```bash
python3 -m unittest discover -s scripts -p test_unity_dependency_snapshot.py -v
python3 scripts/unity_dependency_snapshot.py
```

## When to improve resolution

On a tested Unity Editor 6.3 project checkout, let Package Manager resolve and write `unity-project/Packages/packages-lock.json`. Review licensing, reproducibility and machine-specific paths before deliberately committing it. Then the same script can submit the larger **resolved** Unity package graph. Do not commit caches under `Library/` or assume dependencies of external Unity components can be inferred without the editor.

If testing uses a custom package registry, make access explicit and scoped. Do not add registry tokens to Git, workflow text or build logs.

## Interpreting results

GitHub `Insights → Dependency graph` may show a higher count after Unity UPM submission. Count growth indicates **visibility**, not newly introduced code or a security regression. Use `Security → Dependabot` for supported-ecosystem advisories, NuGet Audit for restored NuGet projects, and platform-specific scans for editor/native DLLs. Keep engine/editor updates separate from automatic npm dependency PRs.

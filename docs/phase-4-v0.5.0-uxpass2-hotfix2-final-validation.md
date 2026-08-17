# TeamForge Phase 4 v0.5.0 UX Pass 2 Hotfix2 — Final Validation

Date: 2026-08-10 (Asia/Seoul)
Target Unity: `6000.3.21f1`
Product version: `0.5.0`
Realtime protocol: `1`
Base authority: Hotfix6; UX base: Pass 2 Hotfix1

## Field evidence inherited from exact predecessor

- UX Pass 2 Hotfix1 Unity compile: PASS in user field environment.
- UX Pass 2 Hotfix1 EditMode: **90/90 PASS**.
- Local Coordinator + A/B realtime connection: PASS in the field.
- Field defect reproduced after those gates: B clone launched on `Untitled` and auto-connected before the saved host Scene was loaded, causing Hierarchy snapshot rejection.

These predecessor field results are not claimed as execution results for Hotfix2 itself.

## Hotfix2 source/static validation

- Repository validator: PASS — `251 files`, `43 C# sources`, protocol v1.
- JavaScript module syntax (`node --check`): PASS — `46/46 .mjs` files.
- NUnit source discovery markers (`[Test]` + `[TestCase]` + `[UnityTest]`): `91` expected cases; this is source evidence only.
- Coordinator comparison to Hotfix1: `17/17` files present, `0` changed.
- Project Peer comparison to Hotfix1: `38/38` files present, `0` changed.
- Hotfix2 changes are limited to Unity UX/Test Lab/Hierarchy readiness, tests, validator and documentation.


## Packaged-artifact checks

- Unity package: `com.eunsung.teamforge-0.5.0-uxpass2-hotfix2.zip`
  - SHA-256: `86b6f58ba7a24e41045869731c71036b5084131a254a9042951c93fbdce2b76a`
  - source files `110`, fresh-extracted files `110`, content mismatches `0`
- Full candidate is accompanied by its `.sha256` sidecar.
  - source files `251`, fresh-extracted files `251`, content mismatches `0`
  - repository validator PASS and `.mjs` syntax `46/46` PASS on the fresh extraction.

## Targeted invariants validated statically

The final validator requires all of the following:

- clone bootstrap carries a `TeamForgeSceneBaseline`;
- Test Lab captures A's exact saved baseline and writes it to each clone bootstrap;
- clone startup waits while `EditorApplication.isCompiling` or `EditorApplication.isUpdating` is true;
- clone startup resolves the copied GUID with `AssetDatabase.GUIDToAssetPath`;
- exact Scene file SHA-256 must match before connect;
- automatic Scene preparation uses `EditorSceneManager.OpenScene(expectedPath, OpenSceneMode.Single)`;
- dirty clone Scene state fails closed and is never auto-saved/discarded;
- one Editor update is yielded after baseline Scene preparation before B auto-connect;
- C receives the same Scene preparation but remains offline when configured as the Late Join client;
- Home reads Hierarchy `SnapshotReady` and cannot label a connected-but-unaccepted Hierarchy snapshot as fully active;
- the Hotfix1 CS0177 short-circuit pattern remains forbidden;
- TeamForge still does not use Unity `Progress.GetStatus`/Progress lifecycle APIs.

## Tests not claimed for Hotfix2

### Unity

Unity `6000.3.21f1` is not available in this execution environment, therefore Hotfix2 C# compile and EditMode execution are **NOT RUN here**. Expected field count is 91, but `91/91 PASS` is not claimed until the user runs the exact package.

### Dependency-backed Node suites

Coordinator and Project Peer source are byte-for-byte unchanged from Hotfix1. The dependency-backed Node suites are not re-claimed for this hotfix; only repository/static and JS syntax evidence is claimed here.

## Remaining separate diagnostic

The field screenshot also contained `Rejected Project Coordinator message: A non-empty Project registry requires a Project UUID.` This hotfix does not weaken that security validation because the observed run does not establish whether the cause is a stale/older Coordinator instance, a Project Peer state, or a client/server project-registry race. Capture it again after the Scene-startup fix on a known clean local Coordinator before changing Project UUID rules.

## Release status

Hotfix2 is a field candidate. Required next gates:

1. Unity compile Error 0.
2. EditMode Failed 0 (expected source count 91).
3. Quick A/B/C Lab: B automatically opens the exact host saved Scene before connecting; C opens the same Scene and stays offline.
4. No `Authoritative Scene ... is not loaded` or `Scene '' was not added to the Transform baseline` during B bootstrap.
5. Then run C Late Join convergence.

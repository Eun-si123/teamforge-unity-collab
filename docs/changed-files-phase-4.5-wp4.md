# Phase 4.5 WP4 changed files

## Added

- `unity-package/com.eunsung.teamforge/Editor/Authority.meta` — Unity folder identity for the Authority View module.
- `unity-package/com.eunsung.teamforge/Editor/Authority/TeamForgeAuthorityView.cs` — transient observed Session Revision, Lock registry, capability and connection identity view, plus the minimal internal `IAuthorityView` contract.
- `unity-package/com.eunsung.teamforge/Editor/Authority/TeamForgeAuthorityView.cs.meta` — Unity asset identity for the Authority View source.
- `unity-package/com.eunsung.teamforge/Tests/Editor/TeamForgeAuthorityViewTests.cs` — characterization of monotonic revision observation, the Transform facade alias and the capability/identity view surface.
- `unity-package/com.eunsung.teamforge/Tests/Editor/TeamForgeAuthorityViewTests.cs.meta` — Unity asset identity for the WP4 EditMode tests.
- `docs/phase-4.5-wp4-unity-authority-view-report.md` — WP4 research, boundary, verification and risk report.
- `docs/changed-files-phase-4.5-wp4.md` — this inventory.

## Modified

- `unity-package/com.eunsung.teamforge/Editor/TransformSync/TeamForgeTransformSyncService.cs` — consume `IAuthorityView`; delegate Revision/Lock observations to the shared view; preserve `CurrentRevision`, `Locks` and the existing static/public behavior as facade aliases.
- `unity-package/com.eunsung.teamforge/Editor/HierarchySync/TeamForgeHierarchySyncService.cs` — consume shared Revision, Locks, capabilities and connection identity through `IAuthorityView` instead of using Transform Sync as the Authority store.
- `scripts/validate-repository.mjs` — require the WP4 sources/tests and freeze the facade aliases, Hierarchy dependency boundary and transient non-`ScriptableSingleton` state.
- `docs/architecture.md` — record the WP4 Unity Authority View and remaining Collaboration boundary.
- `docs/project-state.md` — mark WP4 complete and WP5 not started.

No Protocol v1 schema/fixture, Server, `project-peer`, runtime assembly, asmdef, Connection Service, transport implementation or Project Transfer product source was changed.

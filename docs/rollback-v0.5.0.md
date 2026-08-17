# TeamForge v0.5.0 Rollback Guide

## Principle

Rollback is artifact-level. Do not partially mix `0.5.0` Server/Unity hierarchy protocol code with the Phase 3 `0.4.1` closure package. Preserve Source Projects, Phase 3 managed roots, Owner keys, Active revisions, staging and chunk stores.

## Baseline

Known frozen Phase 3 closure input:

```text
Unity-TeamForge-Phase3-v0.4.1-closure.zip
SHA-256 b9c45dba18dbc984804a8fdb7548a78d9f580ae5649d89bd032f37cefd106f5a
```

## Roll back from v0.5.0 candidate

1. Stop Unity Editors, `0.5.0` Coordinator and any Project Peer sidecars.
2. Preserve logs after redacting secrets. Preserve `TeamForgeProjects`, Owner key backup, staging/chunk store and existing Active revisions.
3. Do not manually edit hierarchy/session metadata to imitate an older revision.
4. Start Server/Project Peer/Unity package from the frozen Phase 3 closure as one version set.
5. Re-run Phase 3 root tests/smoke and focused Unity Presence/Transform/Lock checks.
6. Reconnect from saved Project Scenes. Phase 4 in-memory hierarchy state is not expected to migrate backward.

## What is intentionally not migrated

Phase 4 hierarchy metadata/tombstones are server-memory state and are not a durable database. Rollback does not attempt to translate or persist them. The user must review/save the local Unity Scene state that should remain before switching artifacts.

## File-level rollback warning

Do not individually revert only `hierarchy-model.mjs`, only Unity hierarchy files, or only protocol DTOs. Phase 4 changes span capability negotiation, shared revision rules, Transform/Lock compatibility guards, UI and tests. Partial rollback can create incompatible authority rules.

# TeamForge known issues

This page is a **navigation index**, not a second source of truth for live bug state.

- Use **[STATUS.md](STATUS.md)** for the current release effect, validation boundary, and readiness summary.
- Use the individual **GitHub Issues** for detailed reproduction notes, discussion, patches, and live issue state.
- Use [`../release-contract.json`](../release-contract.json) and [`../builds/README.md`](../builds/README.md) when exact candidate or packaged byte identity matters.

## Current WP5.1 physical field-validation debt

The targeted source fixes for these items are present in current `main` through PR #81, but the required physical Windows reruns remain part of the release gate:

| Issue | Area | Current release significance |
| --- | --- | --- |
| [#67 — saved Guest reconnect](https://github.com/Eun-si123/teamforge-unity-collab/issues/67) | Guest reconnect / saved Scene | Source fix merged; exact physical saved-Guest reopen still needs validation |
| [#68 — rapid Transform / lock protected conflict](https://github.com/Eun-si123/teamforge-unity-collab/issues/68) | Transform / lock contention | Recovery source fix merged; exact physical two-PC contention rerun remains |
| [#74 — narrowed lock-contention path](https://github.com/Eun-si123/teamforge-unity-collab/issues/74) | Transform / lock contention | Tracked with #68 for physical closure |
| [#69 — receive shutdown](https://github.com/Eun-si123/teamforge-unity-collab/issues/69) | Launcher / interrupted receive | Handled shutdown source path merged; Windows close/restart/resume rerun remains |
| [#70 — Seed / firewall onboarding](https://github.com/Eun-si123/teamforge-unity-collab/issues/70) | LAN / Seed | Stable production Seed TCP `5091` source fix merged; LAN/firewall rerun remains |
| [#71 — execution-alias handoff](https://github.com/Eun-si123/teamforge-unity-collab/issues/71) | Windows path resilience | Canonical alias resolution source fix merged; real long/deep-path handoff rerun remains |

Do not copy the detailed issue state back into this file. When one of these issues changes, update the GitHub Issue and update [STATUS.md](STATUS.md) only if the change affects current capability or release readiness.

## Current unsupported capability areas

These are product limitations rather than necessarily individual bugs:

- general Component / Inspector / arbitrary `SerializedProperty` synchronization;
- general Prefab / Asset collaboration;
- persistent Server/Session restart recovery;
- automatic Internet NAT traversal, relay, or peer discovery;
- equivalent packaged macOS/Linux standalone launchers;
- Authenticode signing for the current Windows Launcher lineage;
- arbitrarily deep Windows project paths.

Current wording and release impact belong in [STATUS.md](STATUS.md) and [compatibility.md](compatibility.md).

## Historical issue snapshots

Older phase, work-state, field-test, and patch-status documents preserve what was known at their recorded time. They are useful for debugging and history, but they do not override current source/tests, GitHub Issues, or [STATUS.md](STATUS.md).

# TeamForge known issues

This page is a **navigation index**, not a second source of truth for live bug state.

- Use **[STATUS.md](STATUS.md)** for the current release effect, validation boundary, and readiness summary.
- Use the individual **GitHub Issues** for detailed reproduction notes, discussion, patches, exact field evidence, and live issue state.
- Use [`../release-contract.json`](../release-contract.json) and [`../builds/README.md`](../builds/README.md) when exact candidate or packaged byte identity matters.

## WP5.1 stabilization record

The original Windows blocker set associated with #67, #68/#74, #69, #70 and #71 should no longer be presented as one untouched queue of pending r4 physical reruns.

Exact `v0.5.1-prealpha-wp5.1-r5` physical testing on 2026-08-31 recorded successful closure for the saved-Guest reconnect, fresh late-join Transform conflict, repeated receive/shutdown-resume, long/deep-path handoff and stale lock-contention recovery paths. The same r5 field work also exercised packaged Host Stop/Start on Seed TCP `5091` and a real Guest transfer once firewall access existed.

The current release evidence gap is instead centered on **behavior added after r5**, especially Windows LAN firewall onboarding/rule lifecycle, preferred-Seed-port unavailable/collision fallback, Windows Project identity crash recovery, and integration smoke coverage for any future package built from current `main`. See [STATUS.md](STATUS.md) for the current boundary instead of inferring it from older issue bodies.

Useful historical/detail entry points:

- [#67 — saved Guest reconnect](https://github.com/Eun-si123/teamforge-unity-collab/issues/67)
- [#68 — fresh late-join Transform conflict](https://github.com/Eun-si123/teamforge-unity-collab/issues/68)
- [#74 — narrowed lock-contention recovery](https://github.com/Eun-si123/teamforge-unity-collab/issues/74)
- [#69 — receive shutdown/resume](https://github.com/Eun-si123/teamforge-unity-collab/issues/69)
- [#70 — Seed / firewall onboarding](https://github.com/Eun-si123/teamforge-unity-collab/issues/70)
- [#71 — execution-alias handoff](https://github.com/Eun-si123/teamforge-unity-collab/issues/71)
- [#79 — foreign-lock SceneView UX](https://github.com/Eun-si123/teamforge-unity-collab/issues/79)

Do not copy each Issue's mutable state into this index. When behavior/evidence changes, update the GitHub Issue and [STATUS.md](STATUS.md) if the change affects current capability or release readiness.

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

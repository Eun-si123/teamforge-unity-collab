# M1–M5 native Unity collaboration integration — 2026-11-22

This is a **source-development checkpoint**, not evidence that the next package or two physical Windows Editors passed. Current release readiness remains `FIELD_BLOCKED`.

## Intended user behavior

Use Unity's ordinary Hierarchy/Inspector/Scene workflows. Do not require `GameObject > TeamForge > Create Shared Cube` to create a built-in Cube/Sphere or `Collider Collaboration > Add shared ...` to add a default Collider. TeamForge should reuse Unity's own native objects and its existing signed Project, server authority, revision, lock, component catalog, and recovery infrastructure.

## Source integration in this branch

- The normal **owned** Host Coordinator receives the *already approved* Project Peer managed root. M1 property sync, M2 structure sync, M3 built-in primitive templates, and M4 SQLite durable Session storage are enabled for that Host without separately configuring three feature flags or a database path. Existing/externally managed Coordinators are **not** reconfigured.
- Lifecycle reuse rejects changing the approved managed root/database of an already-live owned Coordinator. SQLite's existing secure-path checks and signed Scene admission are unchanged.
- The Unity client offers supported property/structure/primitive capabilities by default. Unsupported render pipelines continue M1/M2 but cannot offer exact built-in M3 primitives.
- The Collider service joins a signed saved Scene automatically when the connection and Project pin are ready, with a bounded pin poll; automatic admission failure never auto-submits the recovery inbox. Other Scene/lineage conflicts still require review.
- A single exact **default native** BoxCollider/SphereCollider added using Unity's normal Inspector/Undo path on a selected, locked, already joined non-Prefab object is proposed through the existing authenticated M2 command. Its original native instance is adopted only if the accepted catalog has the exact logical ID and the observed native instance/properties and owner remain unchanged. Multi-add bursts, altered/unknown components, and unsafe cases remain local. No Unity-native component is silently destroyed or duplicated *by the native-origin adoption path*.
- The existing explicit shared commands remain as narrow recovery/developer fallback while native operations are expanded; the opt-in UI controls are removed from the ordinary Collider window.

## Boundaries not yet solved

- General native **Collider removal** in the ordinary Inspector and native non-default component edits require a separate exact deletion/Undo/reconciliation contract. The existing explicit `Remove shared Component` still works for the supported M2 catalog.
- Native M3 integration only recognizes exact engine-owned default Cube/Sphere shapes. Generic imported Prefab, FBX, Material and Asset creation/update after a Guest joined are not yet real-time shared; their signed initial Project transfer already exists.
- M5 has an implemented Host checkpoint preview in `main`, but Guest review/refresh PR #578 is **not merged** while trust-pin/Active activation consistency remains unresolved. No shortcut around Publisher trust, verified chunks, immutable Active or conflict review is allowed.
- A Scene change may preserve an earlier Scene's unconfirmed edits, so auto-join cannot silently discard its state. Cross-Scene collaboration belongs to M6.
- Source Node tests do not prove Unity Editor native input ordering. The amended Unity M2 EditMode E2E must run on an actual Editor, followed by packaging and two-Windows-Editor field evidence.

## Validation

- `npm run validate`: PASS.
- `npm --prefix server test`: 445 passed, 0 failed.
- `npm --prefix project-peer test`: 588 passed, 0 failed, 6 platform skips.
- Focused Host Orchestrator / Lifecycle tests: 30 passed, 0 failed. They include a real Coordinator capability handshake, managed-root reuse refusal, and source Host bootstrap.
- Unity Editor test execution in this checkout: **NOT RUN** (no Unity Editor executable available).

Do not merge until the native M2 Editor E2E and whole Unity regression checks validate the new exact-instance adoption path; do not report the legacy M5 PR as completed without fixing its trust/Active activation issue.

# TeamForge current status

**English** | [한국어](STATUS.ko.md)

_Last reviewed against public source: 2026-08-20 (Asia/Seoul)_

Current product version: `0.5.1`  
Current release identity: `0.5.1-wp5.1-path-resilience`  
Current candidate state: **FIELD BLOCKED**

> [!WARNING]
> **Early Public Preview — source available, general installation not recommended yet.**
>
> TeamForge is still being stabilized. The public repository is useful for source review, automated testing, security feedback, and development, but there is no general-user packaged alpha that this project currently recommends installing on an important Unity project.

This page is the short source of truth for **what exists, what is automatically checked, what is still unverified, and what must happen before a public alpha is treated as installable**.

For exact runtime/tool/protocol/candidate metadata, use [`../release-contract.json`](../release-contract.json). For the current packaged ZIP classification, use [`../builds/README.md`](../builds/README.md). Those files provide more precise identity; they do not override this page's release-readiness warning.

## Capability status

| Area | Current state | Notes |
| --- | --- | --- |
| Connected-user presence | ✅ Prototype exists | Project/session-scoped presence and peer awareness exist. |
| Selection / Editor awareness | ✅ Prototype exists | Selection, active Scene, Scene View awareness, and teammate navigation experiments exist. |
| Transform synchronization | ✅ Prototype exists | Position, rotation, and scale synchronization exist under the current realtime protocol. |
| Basic locking / ownership | 🟡 Stabilizing | Server-authoritative lease/ownership behavior exists, but conflict UX and edge cases still need field validation. |
| Same-Scene Hierarchy synchronization | 🟡 Stabilizing | Create, delete, rename, reparent, and sibling-order synchronization exist for the supported same-Scene path. |
| Project bootstrap / Collaboration Invite | 🟡 Stabilizing | Signed/validated bootstrap metadata and Host/Guest flow exist, but the end-to-end field workflow is not release-ready. |
| Direct P2P project transfer | 🟡 Stabilizing | Direct HTTP Project Peer transfer, chunking, integrity checks, resume/retry, staging, activation, and seed/failover logic exist in the development implementation. |
| Diagnostics / recovery UX | 🟡 Stabilizing | WP5 adds stable error explanations, redacted bounded diagnostics, and state-driven safe recovery actions. |
| Windows path resilience | 🟡 Stabilizing | WP5.1 adds managed short-workspace/path-resilience handling for the packaged Windows candidate without changing protocol or trust boundaries. |
| Component / Inspector synchronization | ⏳ Planned | General Component and `SerializedProperty` collaboration is not implemented as a supported general workflow. |
| Prefab / Asset collaboration | ⏳ Planned | General Prefab and Asset synchronization is not a supported capability. |
| Persistent restart recovery | ⏳ Planned | Persistent server/session recovery remains outside the current release scope. |
| Internet NAT traversal / relay | 🔬 Research / future | TeamForge currently does not provide WebRTC, ICE, STUN, TURN, relay, or automatic NAT traversal. |

For feature history, see the Unity package [CHANGELOG](../unity-package/com.eunsung.teamforge/CHANGELOG.md). For direction rather than current implementation, see the [roadmap](ROADMAP.md). For the current as-built topology and authority boundaries, see [architecture.md](architecture.md).

## Current candidate identity

The current source-controlled release contract identifies:

- product version `0.5.1`;
- release ID `0.5.1-wp5.1-path-resilience`;
- Windows x64 target;
- bundled Node `24.19.0`;
- developer/source Node range `>=22.23.2 <23 || >=24.18.1 <25`;
- npm release tooling `11.19.0`;
- `ws@8.21.3`;
- Unity package line `6000.3` with recorded candidate test Editor `6000.3.21f1`;
- Realtime Protocol v1, Project Transfer Protocol v1, and Project Manifest Schema v1;
- `FIELD_BLOCKED` release state.

`0.5.1` alone identifies the product line, not every byte-identical candidate produced during WP4/WP5/WP5.1 stabilization. For packaged evidence, identify the **release ID plus exact artifact filename and SHA-256**. If a ZIP is repacked and its bytes/hash change, it is a different byte-level artifact even if it remains in the same product/work-package lineage.

## What the public repository checks automatically

The repository CI currently runs on pull requests and `main` updates and covers:

- **Public source contract (Node 24)** — fresh-checkout source/document/package/release-contract consistency without requiring generated Runtime/Launcher/release-only evidence
- **Server (Node 24)** — locked dependency install, syntax/source checks, and server tests
- **Project Peer (Node 24)** — integration dependency install, policy/source checks, and Project Peer tests
- **Launcher runtime loader (Node 24)** — syntax and runtime-loader tests
- **Launcher (.NET 10 / Windows)** — launcher core tests, restore, and Windows build

The public-source contract gate is intentionally different from the staged release-candidate validator. `npm run validate` is expected to work on the public source checkout; `npm run validate:release` expects the generated Runtime/Launcher/release evidence of a fully staged candidate.

The public GitHub Actions CI does **not currently run Unity EditMode tests**. Unity test execution needs a reliable Unity runner/licensing strategy before it should become a required public CI gate.

A passing source-level CI run also does not prove that a generated Runtime bundle or candidate ZIP has passed every release/field gate. Source CI, release artifact verification, Unity execution, and two-PC field testing are separate evidence classes.

## Security automation status

Repository security automation is enabled, including secret protection / push protection, dependency alerts, and CodeQL scanning.

At the 2026-08-18 review, CodeQL showed **no open code-scanning alerts**. This is dated evidence, not a permanent claim. It is useful, but it is **not a security audit or proof that vulnerabilities do not exist**.

The C# CodeQL default setup also reported **low C# analysis quality** because C# was extracted with build mode set to `none`. JavaScript/TypeScript and GitHub Actions analysis completed normally. Until Unity-aware build analysis is integrated, C# CodeQL results should be treated as partial static-analysis coverage.

See [SECURITY.md](../.github/SECURITY.md) for reporting and trust-boundary guidance.

## Important distinction: historical candidate evidence vs current public `main`

The repository contains detailed development reports for specific historical candidates. Some of those reports record passing Unity, Node, Project Peer, runtime-integrity, packaging, or field checks.

Those reports are useful engineering evidence, but they should **not** be read as a blanket claim that every current `main` commit, every later 0.5.1 work package, or every future packaged build passed the exact same test matrix.

Evidence precedence for current questions is:

1. current source/tests for implemented behavior;
2. this `STATUS.md` for current capability/release-readiness claims;
3. `release-contract.json` for exact current candidate/runtime identity;
4. current module READMEs and `docs/architecture.md` for runtime contracts/topology;
5. `builds/README.md` and exact Release hashes for packaged artifact identity;
6. historical phase/work-state reports only for their recorded candidates.

## Current release / installation state

There is **no general-user TeamForge release currently recommended for installation**.

The public source intentionally does not commit generated runtime payloads, packaged executables, local credentials, private keys, or private machine state. In particular, the normal end-user Host path expects a packaged, hash-verified `Runtime~/` payload, and the normal fresh-Guest path expects a packaged `launcher/win-x64/` folder. Those generated release layouts are intentionally absent from a fresh source checkout.

That means a Git URL pointing directly at the public Unity package source should **not** be advertised as a complete end-user installation path yet, and a README path such as `launcher/win-x64/TeamForge.Launcher.exe` describes the packaged candidate layout rather than a binary committed in source.

A future public alpha should provide a validated package/runtime/launcher combination as an exact hashed release artifact, then be tested from a fresh Unity project before a Quick Start is promoted to general users.

## Current field-validation blockers

Before TeamForge should be presented as a generally installable alpha, the project should at minimum close these gates on the exact intended release artifact:

1. **Exact two-PC Windows field validation** of the intended Host → invite → Guest → project transfer → activation → realtime workflow.
2. **Fresh-install validation** from the exact artifacts that would be published, not only from a development workspace.
3. **Packaged runtime integrity validation** for the exact release artifact, including runtime/dependency provenance, generated manifests/pins, and hashes.
4. **Failure and recovery testing** for interrupted transfer, reconnect, stale/mismatched state, host/seed loss, and safe refusal paths.
5. **Unity EditMode validation** on the exact release candidate, with results retained as evidence.
6. **Path-resilience validation** for the current WP5.1 managed/short-workspace behavior without weakening containment, trust, or final handoff checks.
7. **Clear install / update / uninstall documentation** that does not require normal users to understand the development workspace.
8. **At least some external testing** so the project is not validated only by the person building it.

These are readiness gates, not promised dates.

## Known important limitations

- Keep backups; prefer disposable projects for experimental testing.
- TeamForge is not a replacement for Git, Unity Version Control, or another backup/history system.
- Same-Scene Hierarchy operations are narrower than general Unity Scene/Prefab/Asset collaboration.
- Cross-Scene structure, general Component sync, Inspector sync, Prefab structure sync, and general Asset sync remain outside the supported current scope.
- Persistent server/session restart recovery is not implemented.
- TeamForge does not currently provide WebRTC/ICE/STUN/TURN/relay/NAT traversal or a hosted internet relay service.
- Direct P2P currently means direct Project Peer reachability; it should not be read as automatic internet peer discovery/connectivity.
- The packaged Windows x64 runtime/launcher path has development-candidate evidence; macOS/Linux bundled payloads are not currently published as equivalent validated release artifacts.
- The current Windows Launcher is not Authenticode-signed.
- Arbitrarily deep Windows paths are not a supported promise; WP5.1 uses a bounded managed path strategy.
- TeamForge has not completed an independent professional security audit.
- AI-assisted development increases the importance of reproducible testing and independent review; generated or AI-assisted code is not assumed correct because it compiles.

## What is safe to do with the repository today?

Reasonable current uses include:

- reading and reviewing the source
- reviewing networking and security assumptions
- running the automated source-level test suites
- experimenting on disposable Unity projects
- reporting bugs and failure cases
- contributing code, tests, documentation, and review

What the project does **not** currently recommend is treating TeamForge as a dependable production collaboration layer for the only copy of an important project.

## Related documents

- [README.md](../README.md) — project overview
- [release-contract.json](../release-contract.json) — exact current candidate/runtime identity
- [builds/README.md](../builds/README.md) — packaged candidate/superseded artifact classification
- [architecture.md](architecture.md) — current as-built runtime topology and authority boundaries
- [project-state.md](project-state.md) — compact current engineering-state summary
- [known-issues.md](known-issues.md) — current candidate limitations and missing validation
- [deployment.md](deployment.md) — packaged Windows candidate deployment/rollback contract
- [ROADMAP.md](ROADMAP.md) — direction and future work
- [docs/SOURCE.md](SOURCE.md) — source-tree guide
- [SECURITY.md](../.github/SECURITY.md) — security expectations and reporting
- [CONTRIBUTING.md](../.github/CONTRIBUTING.md) — testing, review, and contribution
- [unity-package/com.eunsung.teamforge/CHANGELOG.md](../unity-package/com.eunsung.teamforge/CHANGELOG.md) — implementation history

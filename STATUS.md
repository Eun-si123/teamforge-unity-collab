# TeamForge current status

**English** | [한국어](STATUS.ko.md)

_Last reviewed: 2026-08-18_

> [!WARNING]
> **Early Public Preview — source available, general installation not recommended yet.**
>
> TeamForge is still being stabilized. The public repository is useful for source review, automated testing, security feedback, and development, but there is no general-user packaged alpha that this project currently recommends installing on an important Unity project.

This page is the short source of truth for **what exists, what is automatically checked, what is still unverified, and what must happen before a public alpha is treated as installable**.

## Capability status

| Area | Current state | Notes |
| --- | --- | --- |
| Connected-user presence | ✅ Prototype exists | Project/session-scoped presence and peer awareness exist. |
| Selection / Editor awareness | ✅ Prototype exists | Selection, active Scene, Scene View awareness, and teammate navigation experiments exist. |
| Transform synchronization | ✅ Prototype exists | Position, rotation, and scale synchronization exist under the current realtime protocol. |
| Basic locking / ownership | 🟡 Stabilizing | Server-authoritative lease/ownership behavior exists, but conflict UX and edge cases still need field validation. |
| Same-Scene Hierarchy synchronization | 🟡 Stabilizing | Create, delete, rename, reparent, and sibling-order synchronization exist for the supported same-Scene path. |
| Project bootstrap / collaboration invite | 🟡 Stabilizing | Signed/validated bootstrap metadata and Host/Guest flow exist, but the end-to-end field workflow is not release-ready. |
| Direct P2P project transfer | 🟡 Stabilizing | Chunking, integrity checks, resume/retry, staging, activation, and seed/failover work exist in the development implementation. |
| Diagnostics / recovery UX | 🟡 Stabilizing | Doctor/status/recovery-oriented diagnostics exist and continue to be refined. |
| Component / Inspector synchronization | ⏳ Planned | General Component and `SerializedProperty` collaboration is not implemented as a supported general workflow. |
| Prefab / Asset collaboration | ⏳ Planned | General Prefab and Asset synchronization is not a supported capability. |
| Persistent restart recovery | ⏳ Planned | Persistent server/session recovery remains outside the current release scope. |
| Internet NAT traversal / relay | 🔬 Research / future | TeamForge currently does not provide WebRTC, ICE, STUN, TURN, relay, or automatic NAT traversal. |

For feature history, see the Unity package [CHANGELOG](unity-package/com.eunsung.teamforge/CHANGELOG.md). For direction rather than current implementation, see the [roadmap](ROADMAP.md).

## What the public repository checks automatically

The repository CI currently runs on pull requests and `main` updates and covers:

- **Server (Node 24)** — locked dependency install, syntax/source checks, and server tests
- **Project Peer (Node 24)** — integration dependency install, policy/source checks, and Project Peer tests
- **Launcher runtime loader (Node 24)** — syntax and runtime-loader tests
- **Launcher (.NET 10 / Windows)** — launcher core tests, restore, and Windows build

The public GitHub Actions CI does **not currently run Unity EditMode tests**. Unity test execution needs a reliable Unity runner/licensing strategy before it should become a required public CI gate.

## Security automation status

Repository security automation is enabled, including secret protection / push protection, dependency alerts, and CodeQL scanning.

At the 2026-08-18 review, CodeQL showed **no open code-scanning alerts**. This is useful evidence, but it is **not a security audit or proof that vulnerabilities do not exist**.

The C# CodeQL default setup also reported **low C# analysis quality** because C# was extracted with build mode set to `none`. JavaScript/TypeScript and GitHub Actions analysis completed normally. Until Unity-aware build analysis is integrated, C# CodeQL results should be treated as partial static-analysis coverage.

See [SECURITY.md](SECURITY.md) for reporting and trust-boundary guidance.

## Important distinction: historical candidate evidence vs current public `main`

The repository contains detailed development reports for specific historical candidates. Some of those reports record passing Unity, Node, Project Peer, runtime-integrity, or packaging checks.

Those reports are useful engineering evidence, but they should **not** be read as a blanket claim that every current `main` commit or every future packaged build passed the exact same test matrix.

The current public CI status and this page should be used for the present repository state; candidate reports should be read in the context of the exact candidate they describe.

## Current release / installation state

There is **no general-user TeamForge release currently recommended for installation**.

The public source intentionally does not commit generated runtime payloads, packaged executables, local credentials, or private machine state. In particular, the normal end-user Host path expects a packaged, hash-verified `Runtime~/` payload, while the public source tree intentionally omits that generated runtime bundle.

That means a Git URL pointing directly at the public Unity package source should **not** be advertised as a complete end-user installation path yet.

A future public alpha should provide a validated package/runtime/launcher combination as a release artifact, then be tested from a fresh Unity project before a Quick Start is promoted to general users.

## Current field-validation blockers

Before TeamForge should be presented as a generally installable alpha, the project should at minimum close these gates:

1. **Exact two-PC Windows field validation** of the intended Host → invite → Guest → project transfer → activation → realtime workflow.
2. **Fresh-install validation** from the exact artifacts that would be published, not only from a development workspace.
3. **Packaged runtime integrity validation** for the release artifact, including exact runtime/dependency provenance and hashes.
4. **Failure and recovery testing** for interrupted transfer, reconnect, stale/mismatched state, host/seed loss, and safe refusal paths.
5. **Unity EditMode validation** on the release candidate, with results retained as evidence.
6. **Clear install / update / uninstall documentation** that does not require normal users to understand the development workspace.
7. **At least some external testing** so the project is not validated only by the person building it.

These are readiness gates, not promised dates.

## Known important limitations

- Keep backups; prefer disposable projects for experimental testing.
- TeamForge is not a replacement for Git, Unity Version Control, or another backup/history system.
- Same-Scene Hierarchy operations are narrower than general Unity Scene/Prefab/Asset collaboration.
- Cross-Scene structure, general Component sync, Inspector sync, Prefab structure sync, and general Asset sync remain outside the supported current scope.
- Persistent server restart recovery is not complete.
- TeamForge does not currently provide WebRTC/ICE/STUN/TURN/relay/NAT traversal or a hosted internet relay service.
- The packaged Windows x64 runtime path has development-candidate evidence; macOS/Linux bundled payloads are not currently published as equivalent validated release artifacts.
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

- [README.md](README.md) — project overview
- [ROADMAP.md](ROADMAP.md) — direction and future work
- [docs/SOURCE.md](docs/SOURCE.md) — source-tree guide
- [SECURITY.md](SECURITY.md) — security expectations and reporting
- [CONTRIBUTING.md](CONTRIBUTING.md) — testing, review, and contribution
- [unity-package/com.eunsung.teamforge/CHANGELOG.md](unity-package/com.eunsung.teamforge/CHANGELOG.md) — implementation history

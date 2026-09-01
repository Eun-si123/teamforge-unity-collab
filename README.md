# TeamForge — Real-time Collaboration for the Unity Editor

**Build together. Stay in sync.**

*Zero-config first, never zero-control.*

![Status: Early Public Preview](https://img.shields.io/badge/status-early%20public%20preview-orange)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)

**English** | [한국어](README.ko.md) | **[How it works](docs/HOW_IT_WORKS.md)** | **[Current status](docs/STATUS.md)** | [Changelog](CHANGELOG.md) | [Roadmap](docs/ROADMAP.md) | [Discussions](https://github.com/Eun-si123/teamforge-unity-collab/discussions) | [Contributing](.github/CONTRIBUTING.md) | [Security](.github/SECURITY.md)

**TeamForge** *(working name)* is an open-source real-time collaboration project for the Unity Editor. It explores **live Scene synchronization, connected-user presence, same-Scene Hierarchy collaboration, locking and ownership, and direct P2P project bootstrap and transfer** so small teams can work together with less project-copy friction.

> [!WARNING]
> **Early Public Preview — source is available, but general installation is not recommended yet.**
>
> TeamForge is still being stabilized and is not ready to be the only copy or recovery mechanism for an important Unity project. Keep backups and prefer disposable projects for early testing. See **[STATUS.md](docs/STATUS.md)** for the exact release-readiness state and remaining field blockers.

## Choose your path

You do not need to read the whole repository to understand or review TeamForge. Start with the path that matches your goal:

| I want to... | Start here |
| --- | --- |
| Understand what TeamForge does and how the pieces fit together | **[How TeamForge works](docs/HOW_IT_WORKS.md)** |
| See what works today, what is blocked, and whether it is ready for broader use | **[Current status](docs/STATUS.md)** |
| Build, test, or review the public source | **[Source guide](docs/SOURCE.md)** |
| Find the implementation and nearest tests for a behavior | **[Code map](CODEMAP.md)** |
| Understand architecture, authority, identity, or trust boundaries | **[Architecture](docs/architecture.md)** |
| Contribute a change | **[Contributing](.github/CONTRIBUTING.md)** and **[Engineering guide](docs/ENGINEERING_GUIDE.md)** |

Historical phase, work-state, decision, and evidence records are useful for archaeology, but they are not required pre-reading for an ordinary current question.

## Demo

![TeamForge live Unity Editor collaboration demo](TeamForge-readme-demo-hq-1280-12fps.gif)

A development capture showing two Unity Editor instances connected through TeamForge and sharing Editor changes in real time. It demonstrates prototype behavior, not production readiness.

Want to understand what happens behind the UI when a Host starts, a fresh Guest joins, a project transfers, or a Scene edit is synchronized? Start with **[How TeamForge works](docs/HOW_IT_WORKS.md)**, then continue to the architecture or code map when you want deeper implementation detail.

## At a glance

| Area | Current state |
| --- | --- |
| Connected-user presence | ✅ Prototype exists |
| Selection / Editor awareness | ✅ Prototype exists |
| Transform synchronization | ✅ Prototype exists |
| Same-Scene Hierarchy create/delete/rename/reparent/order | 🟡 Implemented / stabilizing |
| Object locking / ownership | 🟡 Implemented / stabilizing |
| Project bootstrap / collaboration invite | 🟡 Implemented / stabilizing |
| Direct P2P project transfer | 🟡 Implemented / stabilizing; direct reachability required |
| Resume, integrity checks, staging, diagnostics, recovery | 🟡 Implemented / stabilizing |
| Windows path resilience / managed short execution path | 🟡 Implemented / stabilizing |
| Component / Inspector / Prefab / general Asset collaboration | ⏳ Planned |
| General-user packaged alpha | ⏳ Not ready yet |

Current source product version: **`0.5.1`** · Packaged target: **Windows x64** · Current candidate state: **FIELD BLOCKED**

For exact release ID, candidate tag, runtime/protocol identity, field evidence, and remaining release gates, use **[STATUS.md](docs/STATUS.md)** and **[release-contract.json](release-contract.json)**. For packaged artifact and SHA-256 identity rules, see **[builds/README.md](builds/README.md)**.

## Why TeamForge?

TeamForge did not begin as a public developer-tool project. I was building a Unity game with a friend and started wondering: **what would it look like if two Unity Editor instances could communicate, share useful editing context, and collaborate in real time?**

That question became an experiment we might eventually use ourselves. While building it, I started wondering whether the same idea could also help friends, students, small teams, and indie developers who run into their own collaboration friction.

Version control is extremely useful, and TeamForge is **not intended to replace Git, Unity Version Control, or another version-control / backup system**. It focuses on the awkward moments around close collaboration inside the Editor, such as:

- "Which version of the project do you have?"
- "Can you send me the project?"
- "Did you move that object, or did I?"
- "Are you editing this Scene right now?"
- "Why does it work on your PC but not mine?"
- waiting for project files before another developer can begin working

The experiment is to combine **live Editor collaboration** with **project bootstrap / transfer tooling** while keeping failure, recovery, identity, networking, and trust boundaries visible instead of hiding them behind "magic."

## Intended workflow

The long-term common path should feel closer to:

1. Open a Unity project.
2. Start Collaboration.
3. Invite another developer.
4. The other developer gets what they need to join.
5. Both Editors connect.
6. Useful project and Scene changes can be seen collaboratively instead of constantly being passed back and forth manually.

There are difficult synchronization, identity, networking, security, and recovery problems hidden inside those six steps. TeamForge exists to explore them seriously.

## Important current boundaries

TeamForge is still an experimental collaboration layer, not a finished production platform. In particular:

- Same-Scene Hierarchy operations are narrower than general Scene / Prefab / Asset collaboration.
- General Component / Inspector / Prefab / Asset synchronization is not a supported current workflow.
- Persistent server/session restart recovery is not implemented.
- `P2P` currently means **direct Project Peer payload transfer**. The same PC, LAN, or a managed VPN can provide direct reachability, but TeamForge does not currently provide automatic peer discovery, WebRTC/ICE/STUN/TURN, relay, or automatic Internet NAT traversal.
- The normal end-user path expects packaged runtime/launcher artifacts that are intentionally not committed as canonical source, so the source Git URL is **not a complete end-user installation path**.
- The current Windows Launcher is not Authenticode-signed.
- Arbitrarily deep Windows paths are not a supported promise; the current WP5.1 lineage uses a bounded managed path / short execution-path strategy.
- TeamForge has not completed an independent professional security audit and cannot guarantee safety against every data-loss scenario, malicious peer, implementation mistake, or edge case.

See **[STATUS.md](docs/STATUS.md)** for the full current validation, limitation, and release-readiness record.

## Source and validation

The current source is available for **testing, review, security feedback, and contribution**. Start with **[docs/SOURCE.md](docs/SOURCE.md)** for the source-tree and contributor workflow.

Major areas are:

- `unity-package/com.eunsung.teamforge/` — Unity Editor package source and Editor tests
- `server/` — coordination/session server source and tests
- `project-peer/` — project bootstrap / direct-transfer tooling and tests
- `launcher/` — Windows Launcher source and tests; packaged `win-x64/` output is generated separately
- `scripts/` — development, source-validation, release-validation, and packaging helpers
- `docs/` — current architecture/status plus historical test, release, and engineering records

Generated runtimes, packaged executables, release ZIPs/manifests, local credentials, private keys, and machine-specific state are intentionally **not** committed as canonical source.

### Fresh-clone validation

For an ordinary public source checkout:

```powershell
npm run install:all
npm run validate
npm test
```

`npm run validate` is the **public-source validator** and does not require generated Runtime/Launcher/release-audit files. `npm run validate:release` is the stronger **staged release-candidate validator** and is expected to fail in a normal source checkout where those generated artifacts are intentionally absent.

For named validation scenarios, use **[Test Lab](docs/TEST_LAB.md)**. For example, `npm run testlab -- plan all-local` shows what an ordinary local validation scenario contains without pretending Unity or physical field evidence ran.

### Automated checks

GitHub Actions checks the Server, Project Peer, launcher runtime-loader, and .NET Windows launcher paths. Relevant pull requests and `main` pushes also run Unity `6000.3.21f1` EditMode / real-server E2E automation, deterministic authority/recovery chaos testing, and repository security automation.

Green CI and automated scanning are useful evidence, but they are not substitutes for independent review or exact physical field validation. The current evidence and remaining two-PC Windows gates are tracked in **[STATUS.md](docs/STATUS.md)**.

## Development history

TeamForge has been developed incrementally from the initial Editor connection prototype through Presence, Transform/Lock synchronization, P2P project bootstrap, Hierarchy synchronization, and later stabilization work.

- **[Changelog](CHANGELOG.md)** — version-history entry point with links to detailed package history
- **[Phase notes](docs/phases/)** — Phase 0 through Phase 4 development records
- **[Historical work-state notes](docs/history/work-state/)** — preserved implementation, debugging, hotfix, and handoff snapshots

Some work-state files began as internal engineering notes and may be rough or superseded by newer documentation. They remain visible so the project's implementation and debugging history can be inspected rather than rewritten into a cleaner story after the fact.

## Help and feedback wanted

I do not want TeamForge to be validated only by the same person who is building it. Help is especially useful in these areas:

- 🧪 **testing and breaking the prototype on disposable projects**
- 🧩 **Unity / C# review**
- 🌐 **networking and P2P review**
- 🔐 **security review**
- 📝 **documentation, UX, and translations**

Start with **[Help wanted: testers, Unity/C# reviewers, networking & security feedback](https://github.com/Eun-si123/teamforge-unity-collab/issues/2)** or **[CONTRIBUTING.md](.github/CONTRIBUTING.md)**. For open-ended questions and ideas, use **[GitHub Discussions](https://github.com/Eun-si123/teamforge-unity-collab/discussions)**.

Early criticism is useful too. Questions I am especially interested in include:

- How do you currently collaborate on Unity projects?
- What part of that workflow causes the most friction?
- Would live Scene / Editor collaboration actually help you?
- Is easier project sharing / bootstrap more valuable than live editing?
- What would make you refuse to use a tool like this?
- What would TeamForge need before you would trust it on a real project?

You can also reply to **[Would you use TeamForge? Early feedback wanted](https://github.com/Eun-si123/teamforge-unity-collab/issues/1)**.

## AI-assisted development transparency

TeamForge is developed using a **human-directed, spec-driven workflow with substantial AI assistance**. I provide project intent, goals, desired behavior, constraints, feedback, test evidence, and final decisions; AI tools assist with requirements, design options, implementation, tests, analysis, and documentation.

This does **not** mean every line was manually written or professionally reviewed by me. TeamForge contains substantial AI-assisted and AI-generated material, and AI output is not treated as automatically correct. Independent review remains important, especially for architecture, race conditions, security, data-loss scenarios, and edge cases.

AI-assisted contributions are welcome as long as contributors meaningfully review, test, and take responsibility for what they submit. See **[CONTRIBUTING.md](.github/CONTRIBUTING.md)**.

## Safety and security

Treat every current TeamForge build as experimental software:

- keep backups
- prefer disposable test projects during early testing
- expect incomplete behavior and compatibility changes
- do not publish credentials, access tokens, invite secrets, or sensitive data in logs
- treat unfamiliar forks and builds as untrusted until you have reason to trust them

Security-sensitive reports should follow **[SECURITY.md](.github/SECURITY.md)**. If GitHub Private Vulnerability Reporting is available, prefer it for sensitive findings.

## Open-source direction and license

TeamForge is an open-source project under the **GNU Affero General Public License version 3 (AGPLv3)**.

The AGPLv3 was chosen because TeamForge is networking software and I want modified covered versions to remain inspectable rather than quietly becoming closed black boxes. Open source makes inspection possible, but it does **not** automatically make a build safe.

**TeamForge was originally conceived, initiated, and developed as a project by [Eun-si123](https://github.com/Eun-si123) / BlackProtogen.** Later contributors and forks should receive credit for their own work as well.

See **[LICENSE](LICENSE)**, **[NOTICE](NOTICE)**, and **[AUTHORS.md](AUTHORS.md)** for the actual project terms and attribution information.

## Repository guide

| Resource | What it is for |
| --- | --- |
| [HOW_IT_WORKS.md](docs/HOW_IT_WORKS.md) | User-action-to-internal-flow explanation: Host, Guest, transfer, realtime edit, reconnect, recovery |
| [STATUS.md](docs/STATUS.md) | Current capabilities, validation, limitations, and alpha readiness gates |
| [release-contract.json](release-contract.json) | Exact current product/release/runtime/protocol identity |
| [builds/README.md](builds/README.md) | Current/superseded packaged artifact classification and hash identity rules |
| [architecture.md](docs/architecture.md) | Current as-built topology and authority/trust boundaries |
| [CODEMAP.md](CODEMAP.md) | Question-to-code navigation for implementation and tests |
| [TEST_LAB.md](docs/TEST_LAB.md) | Named validation scenarios and PASS/FAIL/INCOMPLETE evidence semantics |
| [CHANGELOG.md](CHANGELOG.md) | Version milestones and links into detailed historical engineering records |
| [docs/phases/](docs/phases/) | Phase 0–4 development history |
| [docs/history/work-state/](docs/history/work-state/) | Preserved implementation, debugging, stabilization, and handoff history |
| [docs/SOURCE.md](docs/SOURCE.md) | Public source tree, fresh-clone validation, and review entry point |
| [ROADMAP.md](docs/ROADMAP.md) | Development direction and future work |
| [CONTRIBUTING.md](.github/CONTRIBUTING.md) | How to test, review, document, or contribute |
| [SECURITY.md](.github/SECURITY.md) | Security expectations and reporting |
| [SUPPORT.md](.github/SUPPORT.md) | Where to ask questions or report different kinds of problems |
| [AUTHORS.md](AUTHORS.md) | Project origin and contributor credit |
| [NOTICE](NOTICE) | Attribution / origin terms accompanying the AGPLv3 license |
| [LICENSE](LICENSE) | GNU AGPLv3 license text |

## Development pace

TeamForge is a **personal open-source project, not a full-time job or a company-backed product**. Development may slow down or pause around school, rest, friends, games, other hobbies, or everyday life.

A quiet period does **not automatically mean the project has been abandoned**. I would rather build TeamForge at a sustainable pace than pretend I can promise constant updates.
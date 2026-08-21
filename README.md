# TeamForge — Real-time Collaboration for the Unity Editor

**Build together. Stay in sync.**

*Zero-config first, never zero-control.*

![Status: Early Public Preview](https://img.shields.io/badge/status-early%20public%20preview-orange)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)

**English** | [한국어](README.ko.md) | **[Current status](docs/STATUS.md)** | [Changelog](CHANGELOG.md) | [Roadmap](docs/ROADMAP.md) | [Discussions](https://github.com/Eun-si123/teamforge-unity-collab/discussions) | [Contributing](.github/CONTRIBUTING.md) | [Security](.github/SECURITY.md)

> [!WARNING]
> **Early Public Preview — source available, general installation not recommended yet.**
>
> TeamForge is under active development. The experimental source is public for testing, review, security feedback, and contribution, but there is currently **no general-user packaged alpha that this project recommends installing on an important Unity project**. Keep backups and do not treat TeamForge as the only copy or recovery mechanism for project state.

**TeamForge** *(working name)* is an **open-source real-time collaboration project for the Unity Editor**. It explores **live Scene synchronization, connected-user presence, same-Scene Hierarchy collaboration, locking and ownership, and direct P2P project bootstrap and transfer** so small teams can collaborate with less project-copy friction.

Before judging release readiness, read **[STATUS.md](docs/STATUS.md)**. It separates what is implemented from what is automatically tested, what remains field-blocked, and what must happen before a public install path is promoted.

### Current source identity

- Product version: **`0.5.1`**
- Current release ID: **`0.5.1-wp5.1-path-resilience`**
- Current packaged candidate tag: **`v0.5.1-prealpha-wp5.1-r2`**
- Packaged target: **Windows x64**
- Current candidate state: **FIELD BLOCKED**

The product version is not a byte-level artifact identifier. For exact runtime/protocol/candidate metadata use **[release-contract.json](release-contract.json)**; for current/superseded packaged build identity and SHA-256 rules use **[builds/README.md](builds/README.md)**.

`P2P` currently means **direct Project Peer payload transfer**. Direct reachability on the same PC, LAN, or managed VPN is still required; TeamForge does not currently provide automatic peer discovery, WebRTC/ICE/STUN/TURN, relay, or automatic Internet NAT traversal.

## Demo

![TeamForge live Unity Editor collaboration demo](TeamForge-readme-demo-hq-1280-12fps.gif)

A development capture showing two Unity Editor instances connected through TeamForge and sharing Editor changes in real time. It demonstrates prototype behavior, not production readiness.

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

See **[STATUS.md](docs/STATUS.md)** for current validation and limitations. See **[ROADMAP.md](docs/ROADMAP.md)** for future direction; roadmap items are not promises of dates or guaranteed features.

## Development history

TeamForge has been developed incrementally from the initial Editor connection prototype through Presence, Transform/Lock synchronization, P2P project bootstrap, Hierarchy synchronization, and later stabilization work.

- **[Changelog](CHANGELOG.md)** — an easy version-history entry point, with links to the detailed package changelog.
- **[Phase notes](docs/phases/)** — Phase 0 through Phase 4 development records.
- **[Work-state notes](docs/work-state/)** — implementation-session, debugging, hotfix, decision and handoff notes.

Some work-state files began as internal engineering notes, so they may be rough or superseded by newer documentation. They remain visible to make the project's development and debugging history easier to inspect.

## Source preview

The current TeamForge source is available for **testing, review, security feedback, and contribution**.

Start with **[docs/SOURCE.md](docs/SOURCE.md)** for the source-tree guide. Major areas are:

- `unity-package/com.eunsung.teamforge/` — Unity Editor package source and Editor tests
- `server/` — coordination/session server source and tests
- `project-peer/` — project bootstrap / direct-transfer tooling and tests
- `launcher/` — Windows Launcher source and tests; packaged `win-x64/` output is generated separately
- `scripts/` — development, source-validation, release-validation, and packaging helpers
- `docs/` — current architecture/status plus historical test/release/engineering records

Generated runtimes, packaged executables, release ZIPs/manifests, local credentials, private keys, and machine-specific state are intentionally **not** committed as canonical source.

### Fresh-clone validation

For an ordinary public source checkout:

```powershell
npm run install:all
npm run validate
npm test
```

`npm run validate` is the **public-source validator** and does not require generated Runtime/Launcher/release-audit files. `npm run validate:release` is the stronger **staged release-candidate validator** and is expected to fail in a normal source checkout where those generated artifacts are intentionally absent. See **[docs/SOURCE.md](docs/SOURCE.md)** for the complete contributor workflow.

### What the public repository automatically checks

GitHub Actions checks the Server, Project Peer, launcher runtime-loader, and .NET Windows launcher paths, and now also runs Unity `6000.3.21f1` EditMode / real-server E2E automation on relevant pull requests and `main` pushes. Deterministic authority/recovery chaos testing is also automated. Repository security automation provides dependency, secret, and code scanning.

The current WP5.1 r2 candidate is rebuilt and staged by a separate release workflow, while exact two-PC Windows field validation remains a separate release-readiness gate. Automated security scanning and green CI are evidence, not substitutes for independent review or field validation. Details are tracked in **[STATUS.md](docs/STATUS.md)**.

## Why I started TeamForge

TeamForge did not begin as a public developer-tool project.

I was building a Unity game with a friend, and at some point I started wondering whether we could work together more directly inside the Unity Editor itself. I was not reacting to a specific routine of constantly passing project copies back and forth; the starting point was mostly curiosity: **what would it look like if two Unity Editor instances could communicate, share useful editing context, and collaborate in real time?**

That question became TeamForge. At first, it was an experiment for something my friend and I could potentially use rather than a public product.

While building it, I started wondering whether the same idea might be useful beyond us. Friends, students, small teams, and indie developers may have their own collaboration friction, so I decided to make the project something other people could **inspect, improve, test, and eventually use**.

## What problem is TeamForge trying to solve?

Version control is extremely useful, and TeamForge is **not intended to replace Git, Unity Version Control, or another version-control / backup system**.

TeamForge focuses on awkward moments around close collaboration inside the Unity Editor:

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

## What TeamForge is not

TeamForge is currently **not**:

- a replacement for version control or backups
- a finished production collaboration platform
- a generally recommended installable alpha
- independently security-audited
- guaranteed safe against data loss, malicious peers, implementation mistakes, or edge cases
- a promise that every roadmap item will be built

The goal right now is to validate the workflow and engineering approach before pretending the project is ready for everyone.

## Important current boundaries

- Same-Scene Hierarchy operations are narrower than general Scene / Prefab / Asset collaboration.
- General Component / Inspector / Prefab / Asset synchronization is not a supported current workflow.
- Persistent server/session restart recovery is not implemented.
- TeamForge currently does not provide WebRTC, ICE, STUN, TURN, relay, discovery, or automatic NAT traversal.
- Direct P2P project transfer requires a directly reachable Project Peer endpoint; it is not automatic Internet P2P connectivity.
- The normal end-user path expects packaged runtime/launcher artifacts that are intentionally not committed as canonical source; the source Git URL is therefore **not being advertised as a complete end-user installation path**.
- The current Windows Launcher is not Authenticode-signed.
- Arbitrarily deep Windows paths are not a supported promise; the current WP5.1 lineage uses a bounded managed path / short execution-path strategy.

See **[STATUS.md](docs/STATUS.md)** for the full current limitation and readiness list.

## Help wanted

I do not want TeamForge to be validated only by the same person who is building it.

Help is especially useful in these areas:

- 🧪 **testing and breaking the prototype on disposable projects**
- 🧩 **Unity / C# review**
- 🌐 **networking and P2P review**
- 🔐 **security review**
- 📝 **documentation, UX, and translations**

Start with **[Help wanted: testers, Unity/C# reviewers, networking & security feedback](https://github.com/Eun-si123/teamforge-unity-collab/issues/2)** or read **[CONTRIBUTING.md](.github/CONTRIBUTING.md)**. For open-ended questions and ideas, use **[GitHub Discussions](https://github.com/Eun-si123/teamforge-unity-collab/discussions)**.

## Feedback wanted

I am publishing the project early because I would rather learn that an idea is wrong **before** spending a huge amount of time building it.

Useful questions include:

- How do you currently collaborate on Unity projects?
- What part of that workflow causes the most friction?
- Would live Scene / Editor collaboration actually help you?
- Is easier project sharing / bootstrap more valuable than live editing?
- What would make you refuse to use a tool like this?
- What would TeamForge need before you would trust it on a real project?

Positive feedback is useful, but **negative feedback is useful too**. You can reply to **[Would you use TeamForge? Early feedback wanted](https://github.com/Eun-si123/teamforge-unity-collab/issues/1)** or start a Discussion.

## AI-assisted development transparency

TeamForge is developed using a **human-directed, spec-driven, agentic workflow** with substantial AI assistance.

I usually provide the project intent, goals, desired behavior, constraints, feedback, test evidence, and final decisions. AI tools help turn that input into more detailed requirements, design options, implementation, tests, analysis, and documentation. In practice, a rough idea or problem may be expanded with AI into a technical specification, reviewed or redirected by me, implemented with AI assistance, then tested and iterated again from the results.

I am not an experienced programmer, and I do not want to give the impression that every line has been manually written or professionally reviewed by me. This describes the development process, not a claim that every line of code, technical design expression, or piece of documentation was manually authored by me. TeamForge includes substantial AI-assisted and AI-generated material.

That work is useful, but it does not replace experienced independent review. I cannot guarantee that I will catch every architectural problem, race condition, security issue, data-loss scenario, or edge case.

AI-assisted contributions are welcome too, as long as contributors meaningfully review, test, and take responsibility for what they submit. See **[CONTRIBUTING.md](.github/CONTRIBUTING.md)**.

## Safety and security

Treat every current TeamForge build as experimental software.

- keep backups
- prefer disposable test projects during early testing
- expect incomplete behavior and compatibility changes
- do not publish credentials, access tokens, invite secrets, or sensitive data in logs
- treat unfamiliar forks and builds as untrusted until you have reason to trust them

Security-sensitive reports should follow **[SECURITY.md](.github/SECURITY.md)**. If GitHub Private Vulnerability Reporting is available, prefer it for sensitive findings.

## Open-source direction and license

TeamForge is an open-source project under the **GNU Affero General Public License version 3 (AGPLv3)**. The current experimental source is public; packaged public-alpha distribution remains a future readiness step.

The AGPLv3 was chosen because TeamForge is networking software and I want modified covered versions to remain inspectable rather than quietly becoming closed black boxes. Open source makes inspection possible, but it does **not** automatically make a build safe.

**TeamForge was originally conceived, initiated, and developed as a project by [Eun-si123](https://github.com/Eun-si123) / BlackProtogen.** Later contributors and forks should receive credit for their own work as well.

See **[LICENSE](LICENSE)**, **[NOTICE](NOTICE)**, and **[AUTHORS.md](AUTHORS.md)** for the actual project terms and attribution information.

## Repository guide

| Resource | What it is for |
| --- | --- |
| [STATUS.md](docs/STATUS.md) | Current capabilities, validation, limitations, and alpha readiness gates |
| [release-contract.json](release-contract.json) | Exact current product/release/runtime/protocol identity |
| [builds/README.md](builds/README.md) | Current/superseded packaged artifact classification and hash identity rules |
| [architecture.md](docs/architecture.md) | Current as-built topology and authority/trust boundaries |
| [CHANGELOG.md](CHANGELOG.md) | Version milestones and links into detailed historical engineering records |
| [docs/phases/](docs/phases/) | Phase 0–4 development history |
| [docs/work-state/](docs/work-state/) | Raw implementation, debugging and stabilization notes |
| [docs/SOURCE.md](docs/SOURCE.md) | Public source tree, fresh-clone validation and review entry point |
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
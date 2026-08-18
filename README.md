# TeamForge — Real-time Collaboration for the Unity Editor

**Build together. Stay in sync.**

*Zero-config first, never zero-control.*

![Status: Early Public Preview](https://img.shields.io/badge/status-early%20public%20preview-orange)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)

**English** | [한국어](README.ko.md) | **[Current status](STATUS.md)** | [Changelog](CHANGELOG.md) | [Roadmap](ROADMAP.md) | [Discussions](https://github.com/Eun-si123/teamforge-unity-collab/discussions) | [Contributing](CONTRIBUTING.md) | [Security](SECURITY.md)

> [!WARNING]
> **Early Public Preview — source available, general installation not recommended yet.**
>
> TeamForge is under active development. The experimental source is public for testing, review, security feedback, and contribution, but there is currently **no general-user packaged alpha that this project recommends installing on an important Unity project**. Keep backups and do not treat TeamForge as the only copy or recovery mechanism for project state.

**TeamForge** *(working name)* is an **open-source real-time collaboration project for the Unity Editor**. It explores **live Scene synchronization, connected-user presence, same-Scene Hierarchy collaboration, locking and ownership, and P2P project bootstrap and transfer** so small teams can collaborate with less project-copy friction.

Before judging release readiness, read **[STATUS.md](STATUS.md)**. It separates what is implemented from what is automatically tested, what remains field-blocked, and what must happen before a public install path is promoted.

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
| Direct P2P project transfer | 🟡 Implemented / stabilizing |
| Resume, integrity checks, staging, diagnostics, recovery | 🟡 Implemented / stabilizing |
| Component / Inspector / Prefab / general Asset collaboration | ⏳ Planned |
| General-user packaged alpha | ⏳ Not ready yet |

See **[STATUS.md](STATUS.md)** for current validation and limitations. See **[ROADMAP.md](ROADMAP.md)** for future direction; roadmap items are not promises of dates or guaranteed features.

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
- `launcher/` — launcher source and tests
- `scripts/` — development and validation helpers
- `docs/` — architecture decisions, test/release reports, and engineering notes

Generated runtimes, packaged executables, local credentials, private keys, and machine-specific state are intentionally **not** committed as canonical source.

### What the public repository automatically checks

GitHub Actions currently checks the Server, Project Peer, launcher runtime-loader, and .NET Windows launcher paths. Repository security automation also provides dependency, secret, and code scanning.

Unity EditMode execution is **not yet a required public GitHub Actions gate**, and automated security scanning is not a substitute for an independent audit. Details are tracked in **[STATUS.md](STATUS.md)**.

## Why I started TeamForge

TeamForge did not begin as a public developer-tool project.

I was building a Unity game with a friend. We wanted to work on the same project together, but the practical workflow felt much more awkward than I expected: sharing project state, waiting for files, keeping track of who changed what, and trying to stay on the same version of the project.

So I started TeamForge because I wanted something that **my friend and I could use**.

While building it, I started wondering whether this was only our problem. Friends, students, small teams, and indie developers may run into the same kind of friction. That changed the project from a private tool for two people into something I want other people to be able to **inspect, improve, test, and eventually use**.

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
- Persistent server restart recovery is not complete.
- TeamForge currently does not provide WebRTC, ICE, STUN, TURN, relay, or automatic NAT traversal.
- The normal end-user path expects packaged runtime/launcher artifacts that are intentionally not committed as canonical source; the source Git URL is therefore **not being advertised as a complete end-user installation path**.

See **[STATUS.md](STATUS.md)** for the full current limitation and readiness list.

## Help wanted

I do not want TeamForge to be validated only by the same person who is building it.

Help is especially useful in these areas:

- 🧪 **testing and breaking the prototype on disposable projects**
- 🧩 **Unity / C# review**
- 🌐 **networking and P2P review**
- 🔐 **security review**
- 📝 **documentation, UX, and translations**

Start with **[Help wanted: testers, Unity/C# reviewers, networking & security feedback](https://github.com/Eun-si123/teamforge-unity-collab/issues/2)** or read **[CONTRIBUTING.md](CONTRIBUTING.md)**. For open-ended questions and ideas, use **[GitHub Discussions](https://github.com/Eun-si123/teamforge-unity-collab/discussions)**.

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

TeamForge is being developed with **substantial AI assistance**, including AI-assisted and AI-generated implementation and documentation.

I am not an experienced programmer, and I do not want to give the impression that every line has been manually written or professionally reviewed by me. My role includes defining product goals and workflows, directing and evaluating implementations, reproducing bugs, running the program in real environments, collecting failure cases, running automated/manual tests, and making final project decisions.

That work is useful, but it does not replace experienced independent review. I cannot guarantee that I will catch every architectural problem, race condition, security issue, data-loss scenario, or edge case.

AI-assisted contributions are welcome too, as long as contributors meaningfully review, test, and take responsibility for what they submit. See **[CONTRIBUTING.md](CONTRIBUTING.md)**.

## Safety and security

Treat every current TeamForge build as experimental software.

- keep backups
- prefer disposable test projects during early testing
- expect incomplete behavior and compatibility changes
- do not publish credentials, access tokens, invite secrets, or sensitive data in logs
- treat unfamiliar forks and builds as untrusted until you have reason to trust them

Security-sensitive reports should follow **[SECURITY.md](SECURITY.md)**. If GitHub Private Vulnerability Reporting is available, prefer it for sensitive findings.

## Open-source direction and license

TeamForge is an open-source project under the **GNU Affero General Public License version 3 (AGPLv3)**. The current experimental source is public; packaged public-alpha distribution remains a future readiness step.

The AGPLv3 was chosen because TeamForge is networking software and I want modified covered versions to remain inspectable rather than quietly becoming closed black boxes. Open source makes inspection possible, but it does **not** automatically make a build safe.

**TeamForge was originally conceived, initiated, and developed as a project by [Eun-si123](https://github.com/Eun-si123) / BlackProtogen.** Later contributors and forks should receive credit for their own work as well.

See **[LICENSE](LICENSE)**, **[NOTICE](NOTICE)**, and **[AUTHORS.md](AUTHORS.md)** for the actual project terms and attribution information.

## Repository guide

| Resource | What it is for |
| --- | --- |
| [STATUS.md](STATUS.md) | Current capabilities, validation, limitations, and alpha readiness gates |
| [CHANGELOG.md](CHANGELOG.md) | Version milestones and links into detailed historical engineering records |
| [docs/phases/](docs/phases/) | Phase 0–4 development history |
| [docs/work-state/](docs/work-state/) | Raw implementation, debugging and stabilization notes |
| [docs/SOURCE.md](docs/SOURCE.md) | Public source tree and review entry point |
| [ROADMAP.md](ROADMAP.md) | Development direction and future work |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to test, review, document, or contribute |
| [SECURITY.md](SECURITY.md) | Security expectations and vulnerability reporting |
| [SUPPORT.md](SUPPORT.md) | Where to ask questions or report different kinds of problems |
| [AUTHORS.md](AUTHORS.md) | Project origin and contributor credit |
| [NOTICE](NOTICE) | Attribution / origin terms accompanying the AGPLv3 license |
| [LICENSE](LICENSE) | GNU AGPLv3 license text |

## Development pace

TeamForge is a **personal open-source project, not a full-time job or a company-backed product**. Development may slow down or pause around school, rest, friends, games, other hobbies, or everyday life.

A quiet period does **not automatically mean the project has been abandoned**. I would rather build TeamForge at a sustainable pace than pretend I can promise constant updates.

## Project status

🛠️ **Active development / early validation**

The immediate goal is to make the existing collaboration, transfer, diagnostics, security, and recovery foundations more trustworthy before promoting general installation or rapidly expanding the feature surface.

If you found this repository early: hello 👋

Feedback, skepticism, bug reports, testing, code review, security criticism, and suggestions are all welcome.
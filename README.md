# TeamForge — Real-time Collaboration for the Unity Editor

**Build together. Stay in sync.**

*Zero-config first, never zero-control.*

![Status: Early Public Preview](https://img.shields.io/badge/status-early%20public%20preview-orange)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)

**English** | [한국어](README.ko.md) | [Roadmap](ROADMAP.md) | [Discussions](https://github.com/Eun-si123/teamforge-unity-collab/discussions) | [Contributing](CONTRIBUTING.md) | [Security](SECURITY.md)

> [!WARNING]
> **Early Public Preview — not production-ready.**
>
> TeamForge is under active development. The current experimental source is public for testing, review, and contribution, but a packaged public alpha is **not ready yet**. Do not treat this repository as a finished product or rely on TeamForge as the only copy of an important Unity project.

**TeamForge** *(working name)* is an **open-source real-time collaboration project for the Unity Editor**. It explores **live scene synchronization, connected-user presence, locking and ownership, and P2P project bootstrap and transfer** so small teams can collaborate in the Unity Editor with less project-copy friction.

## Demo

![TeamForge live Unity Editor collaboration demo](TeamForge-readme-demo-hq-1280-12fps.gif)

A short development capture showing two Unity Editor instances connected through TeamForge and sharing Editor changes in real time.

## Source preview

The current experimental TeamForge source is available in this repository for **testing, review, security feedback, and contribution**. It is still an early preview rather than a finished release.

Start with **[docs/SOURCE.md](docs/SOURCE.md)** for the source-tree guide, current limitations, and review notes. The major areas are:

- `unity-package/com.eunsung.teamforge/` — Unity Editor package source and Editor tests
- `server/` — TeamForge coordination/session server source and tests
- `project-peer/` — project bootstrap / P2P tooling and tests
- `launcher/` — launcher source
- `scripts/` — development and validation helpers

Generated runtimes, packaged executables, local credentials, private keys, and machine-specific state are intentionally **not** committed as source.

## At a glance

| Area | Current state |
| --- | --- |
| Connected-user presence | ✅ Prototype exists |
| Selection / Editor awareness | ✅ Prototype exists |
| Transform synchronization | ✅ Prototype exists |
| Object locking / ownership | 🟡 Partial / stabilizing |
| Project bootstrap | 🟡 Partial / stabilizing |
| Direct P2P project transfer | 🟡 Partial / stabilizing |
| Resume, integrity checks, diagnostics, recovery | 🟡 Partial / stabilizing |
| Deeper Scene / Inspector / Prefab / Asset collaboration | ⏳ Planned |

The detailed status and longer-term direction live in the **[roadmap](ROADMAP.md)**. Roadmap items are direction, not promises of dates or guaranteed features.

## Why I started TeamForge

TeamForge did not begin as a public developer-tool project.

I was building a Unity game with a friend. We wanted to work on the same project together, but the practical workflow felt much more awkward than I expected: sharing project state, waiting for files, keeping track of who changed what, and trying to stay on the same version of the project.

So I started TeamForge because I wanted something that **my friend and I could use**.

While building it, I started wondering whether this was only our problem. Friends, students, small teams, and indie developers may run into the same kind of friction. That changed the direction of the project from a private tool for two people into something I want other people to be able to **use, inspect, improve, test, and contribute to**.

## What problem is TeamForge trying to solve?

Version control is extremely useful, and TeamForge is **not intended to replace Git, Unity Version Control, or other version-control systems**.

Version control and live collaboration solve different parts of the workflow. TeamForge focuses on the awkward moments around working closely in the Unity Editor:

- "Which version of the project do you have?"
- "Can you send me the project?"
- "Did you move that object, or did I?"
- "Are you editing this Scene right now?"
- "Why does it work on your PC but not mine?"
- waiting for project files before another developer can even begin working

The experiment is to combine **live Editor collaboration** with **project bootstrap / transfer tooling** while keeping failure, recovery, and trust boundaries visible rather than hiding them behind "magic."

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
- independently security-audited
- guaranteed safe against data loss, malicious peers, implementation mistakes, or edge cases
- a promise that every roadmap item will be built

The goal right now is to validate the workflow and engineering approach before pretending the project is ready for everyone.

## Help wanted

I do not want TeamForge to be validated only by the same person who is building it.

Help is especially useful in these areas:

- 🧪 **testing and breaking the prototype**
- 🧩 **Unity / C# review**
- 🌐 **networking and P2P review**
- 🔐 **security review**
- 📝 **documentation, UX, and translations**

You do not need to be an expert in every area.

Start with **[Help wanted: testers, Unity/C# reviewers, networking & security feedback](https://github.com/Eun-si123/teamforge-unity-collab/issues/2)** or read **[CONTRIBUTING.md](CONTRIBUTING.md)**.

For open-ended questions, ideas, workflow discussion, and general feedback, use **[GitHub Discussions](https://github.com/Eun-si123/teamforge-unity-collab/discussions)**.

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

I am not an experienced programmer, and I do not want to give the impression that every line has been manually written or professionally reviewed by me. My role includes:

- defining product goals, requirements, and workflows
- directing and evaluating implementations
- running the program in real environments
- reproducing bugs and collecting failure cases
- repeatedly testing changes rather than accepting generated code because it compiles
- running automated tests where available
- making final project and release decisions

That work is useful, but it does not replace experienced independent review. I cannot guarantee that I will catch every architectural problem, race condition, security issue, data-loss scenario, or edge case.

AI-assisted contributions are welcome too, as long as contributors meaningfully review, test, and take responsibility for what they submit. See **[CONTRIBUTING.md](CONTRIBUTING.md)** for details.

## Safety and security

Treat every current TeamForge build as experimental software.

- keep backups
- prefer disposable test projects during early testing
- expect incomplete behavior and compatibility changes
- do not publish credentials, access tokens, invite secrets, or other sensitive data in logs
- treat unfamiliar forks and builds as untrusted until you have reason to trust them

Security-sensitive reports should follow **[SECURITY.md](SECURITY.md)**.

## Open-source direction and license

TeamForge is an open-source project under the **GNU Affero General Public License version 3 (AGPLv3)**. The current experimental source is public in this repository; packaged public-alpha builds are still being prepared and validated.

The AGPLv3 was chosen because TeamForge is networking software and I want modified covered versions to remain inspectable rather than quietly becoming closed black boxes. Open source makes inspection possible, but it does **not** automatically make a build safe.

Forks, modifications, redistribution, and commercial use are not prohibited simply because somebody else uses TeamForge code, as long as the applicable license terms are followed. What matters to this project is preserving accurate project history and credit.

**TeamForge was originally conceived, initiated, and developed as a project by [Eun-si123](https://github.com/Eun-si123) / BlackProtogen.** Later contributors and forks should receive credit for their own work as well.

See **[LICENSE](LICENSE)**, **[NOTICE](NOTICE)**, and **[AUTHORS.md](AUTHORS.md)** for the actual project terms and attribution information.

## Repository guide

| Resource | What it is for |
| --- | --- |
| [docs/SOURCE.md](docs/SOURCE.md) | Public source tree, limitations, and review notes |
| [ROADMAP.md](ROADMAP.md) | Current status and development direction |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to test, review, document, or contribute |
| [SECURITY.md](SECURITY.md) | Security expectations and vulnerability reporting |
| [SUPPORT.md](SUPPORT.md) | Where to ask questions or report different kinds of problems |
| [AUTHORS.md](AUTHORS.md) | Project origin and contributor credit |
| [NOTICE](NOTICE) | Attribution / origin terms accompanying the AGPLv3 license |
| [LICENSE](LICENSE) | GNU AGPLv3 license text |

## Development pace

TeamForge is a **personal open-source project, not a full-time job or a company-backed product**. I am currently a student, so development may slow down or pause around school, exams, rest, friends, games, other hobbies, or everyday life.

A quiet period does **not automatically mean the project has been abandoned**. I would rather build TeamForge at a sustainable pace than pretend I can promise constant updates.

## Project status

🛠️ **Active development / early validation**

The immediate goal is to find out whether the underlying idea and workflow are valuable enough to continue developing, while getting more eyes on the parts that are difficult to validate alone.

If you found this repository early: hello 👋

Feedback, skepticism, bug reports, testing, code review, security criticism, and suggestions are all welcome.
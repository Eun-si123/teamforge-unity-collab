# TeamForge — Real-time Collaboration for the Unity Editor

**Build together. Stay in sync.**

*Zero-config first, never zero-control.*

**English** | [한국어](README.ko.md) | [Roadmap](ROADMAP.md) | [한국어 로드맵](ROADMAP.ko.md)

> 🚧 **Early Public Preview — Work in Progress**
>
> TeamForge is still under active development. This repository currently exists mainly to explain the idea, show development progress, gather honest feedback, and prepare the project for broader open-source collaboration.
>
> **The full development source has not been publicly released here yet, and this should not be treated as a finished or production-ready product.**

**TeamForge** *(working name)* is an experimental collaboration tool for the **Unity Editor**.

The idea is simple: make working on the same Unity project with other people feel much more immediate and much less painful.

Instead of collaboration being only:

> edit → save → commit → push → pull → resolve → repeat

TeamForge explores a workflow where multiple people can be connected to the same project and see certain Editor changes in real time, while also making it easier for another developer to receive and join a project.

## Why I started TeamForge

TeamForge did not start as a plan to make a public developer tool.

I was working with a friend on a Unity game project inspired by a particular case/story. We wanted to build the game together, but actually working on the same Unity project was much more awkward than I expected. We could not simply work side by side inside the same Editor, and repeatedly sharing project state, waiting for files, or coordinating who was changing what became frustrating.

At first, I started building TeamForge simply because I wanted something that **my friend and I could use**.

While working on it, I started wondering whether this was only our problem. If collaborating in Unity was inconvenient for us, maybe other friends, students, small teams, and indie developers were dealing with the same kind of friction too.

That changed the direction of the project.

Instead of keeping TeamForge as a private tool for two people, I decided to work toward making it something **other people can use, inspect, improve, and contribute to as well**.

This GitHub repository exists because of that change in direction.

## What problem am I trying to solve?

Version control is extremely useful, and TeamForge is **not intended to replace Git or other version-control systems**.

But version control and real-time collaboration solve different problems.

When two people want to work closely together in Unity, there are still awkward moments:

- "Which version of the project do you have?"
- "Can you send me the project?"
- "Did you move that object, or did I?"
- "Are you editing this Scene right now?"
- "Why does it work on your PC but not mine?"
- waiting for project files to be copied or synchronized before someone can even begin working

TeamForge is an experiment in reducing that friction by combining **live Editor collaboration** with **project bootstrap / transfer tooling**.

## What is currently being explored?

The current prototype has been developed around features such as:

- **Presence** — seeing other connected collaborators
- **Selection / Editor awareness** — knowing what another user is working with
- **Transform synchronization** — position, rotation, and scale changes shared between Editors
- **Basic object locking / ownership** — reducing conflicting edits
- **Project bootstrap** — helping another developer obtain the project needed to join
- **Direct peer-to-peer project transfer experiments**
- **Chunked transfer, integrity checking, resume, and recovery experiments**
- **Diagnostics and recovery UX** for when synchronization or transfer fails

Some of these features already work in development builds, but their existence here **does not mean they are complete, safe, or ready for normal production projects**.

More features and more detailed status information will be documented as the public preview is prepared.

## Roadmap

TeamForge is intended to grow beyond basic Transform synchronization. Current development is focused on stabilizing the existing collaboration and project-bootstrap foundation before expanding into deeper Scene, Hierarchy, Inspector, Prefab, Asset, recovery, networking, and security work.

The roadmap is a **direction, not a promise of dates or guaranteed features**. Priorities can change when testing or community feedback shows that something else matters more.

➡️ **[See the full TeamForge roadmap](ROADMAP.md)** · [한국어](ROADMAP.ko.md)

## What I want the workflow to feel like

A long-term goal is something closer to:

1. One developer opens a Unity project.
2. They start a TeamForge session.
3. They invite another developer.
4. The other developer gets what they need to join the project.
5. Both Editors connect.
6. Useful project and Scene changes can be seen collaboratively instead of constantly being passed back and forth manually.

There are many technical and safety problems hidden inside those six steps. TeamForge is my attempt to explore them rather than pretending they do not exist.

## AI development transparency

This project is being built **heavily with AI-assisted / AI-generated programming**.

The documentation and public-facing writing in this repository are also created with substantial AI assistance. I review, revise, and make the final decision about what is published, but AI-generated mistakes, awkward wording, or inaccurate explanations may still remain.

I am **not an experienced programmer**, so I do not want to give the false impression that every line of code has been manually written or professionally reviewed by me.

My role in the project is closer to:

- deciding what I want the program to do
- designing and refining the workflow and requirements
- using AI tools to help implement those requirements
- running the program in real environments
- reproducing bugs and providing logs / failure cases
- repeatedly testing changes instead of accepting generated code just because it compiles
- running automated tests where available
- checking whether features actually behave as intended across multiple Unity Editor instances and test projects

That verification is useful, but it has limits.

**I cannot guarantee that I will notice every programming mistake, architectural problem, security issue, race condition, data-loss scenario, or edge case.** I also do not claim that the project has undergone a professional security audit or independent code review.

That is one of the reasons I am being explicit about the development process instead of hiding the use of AI.

If you are an experienced Unity, networking, security, or tooling developer, technical criticism is especially welcome.

## Help wanted

I do not want TeamForge to be validated only by the same person who is building it.

I am looking for people willing to help with:

- 🧪 **testing and breaking the prototype**
- 🧩 **Unity / C# review**
- 🌐 **networking and P2P review**
- 🔐 **security review**
- 📝 **documentation, UX, and translations**

You do not need to be an expert in every area.

See **[Help wanted: testers, Unity/C# reviewers, networking & security feedback](https://github.com/Eun-si123/teamforge-unity-collab/issues/2)** and [CONTRIBUTING.md](CONTRIBUTING.md) if you would like to help.

## Current safety / maturity warning

⚠️ **Treat TeamForge as experimental software.**

Until the project reaches a much more mature stage:

- do not rely on it as the only copy of an important project
- test using backups or disposable project copies
- expect bugs and incomplete behavior
- networking and synchronization behavior may change
- compatibility may change between development versions

The goal of this public preview is to learn what is useful **before** pretending the project is ready for everyone.

## Why make this public before it is finished?

Because I do not want to spend a huge amount of time building something that Unity developers do not actually want.

I would rather show the idea early and ask:

### Would you actually use something like this?

I am especially interested in answers to questions like:

- How do you currently collaborate on Unity projects?
- What part of working with another Unity developer causes the most friction?
- Would real-time Scene / Editor collaboration actually help you?
- Would easier project sharing or project bootstrap be more useful than live editing?
- What would make you *refuse* to use a tool like this?
- What would TeamForge need before you would trust it on a real project?
- Would you be interested in testing an early alpha when it becomes available?

Positive feedback is useful, but **negative feedback is useful too**. If the idea is solving the wrong problem, I would rather learn that now.

You can also reply to **[Would you use TeamForge? Early feedback wanted](https://github.com/Eun-si123/teamforge-unity-collab/issues/1)**.

## Demo

![TeamForge live Unity Editor collaboration demo](TeamForge-readme-demo-hq-1280-12fps.gif)

A short prototype capture showing **live Editor-to-Editor synchronization** in action. This is an **early development build**, not a polished or production-ready release.

The capture shows two Unity Editor instances connected through TeamForge and sharing Editor changes in real time.

## Open-source direction and license

TeamForge is being prepared as an **open-source project under the GNU Affero General Public License version 3 (AGPLv3)**.

The full development source is not yet present in this public repository while the project is still being reorganized and reviewed. The goal is to publish the source rather than keep the finished project closed.

The AGPLv3 was chosen because TeamForge is networking software and I want modified covered versions to remain inspectable rather than becoming a closed black box. In broad terms, the AGPL requires covered source and modifications to remain available under its terms when distributed, and it also includes source-availability requirements for modified versions used to provide network interaction.

That matters to this project because **open source makes review possible, but it does not automatically make software safe**. A third-party fork can still contain mistakes, malicious changes, credential theft, destructive behavior, or malware. Users should still check where a build came from and review significant changes when practical.

For security guidance, see [SECURITY.md](SECURITY.md).

### Forks and project origin

Forks, modifications, redistribution, and commercial use are not prohibited simply because somebody else uses the TeamForge code, as long as the applicable license terms are followed.

What I do care about is preserving accurate project history.

**TeamForge was originally conceived, initiated, and developed as a project by [Eun-si123](https://github.com/Eun-si123) / BlackProtogen.** Later contributors and forks should receive credit for their own work, but a fork should not erase the original project's history and falsely claim that pre-existing TeamForge work was independently created by the fork author.

See:

- [LICENSE](LICENSE) — GNU AGPLv3 license text
- [NOTICE](NOTICE) — attribution and project-origin terms
- [AUTHORS.md](AUTHORS.md) — original creator and contributor credit policy
- [CONTRIBUTING.md](CONTRIBUTING.md) — how to help
- [SECURITY.md](SECURITY.md) — security reporting and fork-safety guidance
- [ROADMAP.md](ROADMAP.md) — development direction and planned areas

## Source code status

The development source is currently still being reorganized and reviewed before its public source release.

This repository currently contains the public project home, documentation, demos, feedback discussions, licensing policy, and contribution/security guidance. More source and alpha information will be added as the project is prepared for broader testing.

## Development pace

TeamForge is a **personal open-source project, not a full-time job or a company-backed product**. I am currently a student, so there may be periods when development slows down or pauses while I focus on school, exams, rest, friends, games, other hobbies, or everyday life.

A quiet period does **not automatically mean the project has been abandoned**. I would rather develop TeamForge at a sustainable pace than pretend I can promise constant updates.

For that reason, roadmap items should be treated as direction rather than deadlines. Testing, review, documentation improvements, and outside contributions are especially welcome when development is slower.

## Project status

🛠️ **Active development / early validation**

The immediate goal is not to claim that TeamForge is finished. The immediate goal is to find out whether the underlying idea and workflow are valuable enough to continue developing — and to get more eyes on the parts that are difficult to validate alone.

If you found this repository early: hello 👋

Feedback, skepticism, bug reports, testing, code review, security criticism, and suggestions are all welcome.
# TeamForge — Real-time Collaboration for the Unity Editor

> 🚧 **Early Public Preview — Work in Progress**
>
> TeamForge is still under active development. This repository currently exists mainly to explain the idea, show development progress, and gather honest feedback from Unity developers.
>
> **The source code is not publicly released here yet, and this should not be treated as a finished or production-ready product.**

**TeamForge** *(working name)* is an experimental collaboration tool for the **Unity Editor**.

The idea is simple: make working on the same Unity project with other people feel much more immediate and much less painful.

Instead of collaboration being only:

> edit → save → commit → push → pull → resolve → repeat

TeamForge explores a workflow where multiple people can be connected to the same project and see certain Editor changes in real time, while also making it easier for another developer to receive and join a project.

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

## Demo

🎥 **Demo video / GIF: coming soon.**

The plan is to show actual Editor-to-Editor behavior rather than relying only on feature claims in text.

## Source code

The development source is currently kept private while the project is still being reorganized and reviewed.

This public repository is currently for:

- project explanation
- progress updates
- demos
- feedback
- future alpha information

A decision about source availability and licensing will be made separately as the project matures.

## Project status

🛠️ **Active development / early validation**

The immediate goal is not to claim that TeamForge is finished. The immediate goal is to find out whether the underlying idea and workflow are valuable enough to continue developing.

If you found this repository early: hello 👋

Feedback, skepticism, questions, and suggestions are all welcome.

# TeamForge Roadmap

**English** | [한국어](ROADMAP.ko.md)

> **Build together. Stay in sync.**
>
> *Zero-config first, never zero-control.*

This roadmap describes the **direction of TeamForge, not a promise of dates or guaranteed features**. Priorities may change based on testing, technical constraints, security findings, and community feedback.

TeamForge is intended to grow beyond basic Transform synchronization into a broader real-time collaboration system for the Unity Editor: easier project joining, deeper Scene and Inspector collaboration, safer conflict handling, stronger recovery, and flexible networking.

## Status legend

- ✅ **Prototype exists** — implemented and has worked in development testing, but may still be experimental
- 🟡 **Partial / stabilizing** — implemented in part or known to need more reliability work
- ⏳ **Planned** — part of the intended direction, not yet complete
- 🔬 **Research / long-term** — worth exploring, but architecture and feasibility are not settled

## 0. Current foundation — stabilize before expanding

The immediate priority is to make the existing foundation safer, easier to test, and easier for other people to understand before adding large amounts of new functionality.

- ✅ Connected-user presence
- ✅ Selection / Editor awareness experiments
- ✅ Live Transform synchronization for position, rotation, and scale
- 🟡 Basic object locking / ownership and conflict protection
- 🟡 Project bootstrap for helping another collaborator obtain the project needed to join
- 🟡 Direct peer-to-peer project transfer
- ✅/🟡 Chunked transfer, integrity checking, interrupted-transfer resume, and recovery experiments
- 🟡 Diagnostics and recovery UX
- 🟡 Reconnect, mismatch, baseline, and synchronization failure handling
- ⏳ Cleaner public-source packaging and early alpha distribution
- ⏳ More automated regression, integration, and stress testing
- ⏳ More testing by people other than the project creator

**Current development principle:** reliability, recoverability, and understandable UX come before adding a large number of new synchronized object types.

## 1. Deeper Scene collaboration

The next major direction is to move from "we can see each other's Transform edits" toward collaboratively editing more of the actual Scene structure.

- ⏳ GameObject creation and deletion synchronization
- ⏳ GameObject rename synchronization
- ⏳ Reparenting and Hierarchy synchronization
- ⏳ Component add / remove synchronization
- ⏳ Inspector / `SerializedProperty` synchronization
- ⏳ Safer simultaneous-edit conflict handling
- ⏳ Clearer ownership / lock state and conflict UX
- ⏳ Late-join state synchronization
- ⏳ Reconnect and authoritative resynchronization after temporary disconnects
- ⏳ Multiple-Scene workflows
- ⏳ Performance work for larger Hierarchies and frequent edits

The goal is not simply to transmit every Unity change blindly. Changes need identity, ordering, validation, conflict rules, and a safe recovery path when two Editors disagree.

## 2. Project, Prefab, and Asset collaboration

Scene synchronization alone does not make two Unity projects truly collaborative. A longer-term goal is to reduce friction around project files and assets as well.

- ⏳ Prefab change synchronization
- ⏳ Asset creation, deletion, move, and rename handling
- ⏳ `.meta` / GUID preservation and mismatch protection
- ⏳ Material and other serialized asset change awareness
- ⏳ Script / project-file change awareness
- ⏳ Incremental transfer of only what another peer actually needs
- ⏳ Better project identity and compatibility checks
- ⏳ Safer handling of package and project differences between peers

Asset synchronization is especially sensitive because a visually small mistake can silently damage references across a Unity project. Safety and verification take priority over making every asset type real-time immediately.

## 3. Easier onboarding and flexible networking

A long-term TeamForge workflow should feel closer to:

**Start Collaboration → invite someone → they get what they need → Join Collaboration**

rather than requiring every user to understand servers, Node.js, ports, coordinator internals, transfer staging, or launch configuration.

Planned directions include:

- ⏳ Simpler Start / Join Collaboration UX
- ⏳ Better automatic setup and diagnostics
- ⏳ Friendly LAN workflows
- ⏳ Direct-IP and direct P2P options
- ⏳ Practical internet collaboration when peers are not on the same LAN
- 🔬 Relay / coordinator-assisted connectivity where direct P2P is unavailable
- 🔬 Self-hosted and advanced networking options
- ⏳ Stronger peer identity and authentication
- ⏳ Advanced controls for users who do want to configure networking manually

The design principle is:

> **Zero-config first, never zero-control.**

The common path should be simple, but TeamForge should not force every advanced user into one networking provider or one hidden configuration model.

## 4. Reliability, history, and recovery

For a collaboration tool, "it usually syncs" is not enough. Losing or silently corrupting project state would be worse than failing loudly.

- ⏳ Better host-disconnect and host-crash recovery
- ⏳ Safer restart / reconnect behavior
- ⏳ Persistent snapshots or equivalent recoverable state
- 🔬 Operation / recovery journal
- 🔬 Replay or rollback mechanisms where practical
- ⏳ Atomic or staged project activation where destructive partial state should be avoided
- ⏳ Better detection of corrupted, stale, or mismatched project state
- ⏳ Long-running soak and stress tests
- ⏳ Multi-user conflict and load testing beyond two Editors
- ⏳ Automated disposable A/B/C test-project setup to reduce manual testing work

Recovery behavior should be designed as a first-class feature rather than added only after synchronization fails.

## 5. Security and trust boundaries

TeamForge exchanges network messages and can participate in transferring project files, so security review is part of the core roadmap rather than an optional final step.

Important areas include:

- 🟡 Authentication and session handling
- 🟡 Signed / validated invitation and project-transfer flows
- 🟡 Integrity verification for transferred content
- ⏳ Stronger peer identity and authorization rules
- ⏳ Untrusted network-input validation
- ⏳ Path-traversal and arbitrary-file-write protection
- ⏳ Safe archive / project extraction and activation
- ⏳ Protection against unsafe deserialization and command / code execution paths
- ⏳ Secret, token, and credential isolation
- ⏳ Resource-exhaustion and denial-of-service resistance
- ⏳ Clear handling of malicious or modified Unity projects / packages
- ⏳ Independent security review as the project matures

Open source makes inspection possible, but it does not automatically make a build trustworthy. Security-sensitive changes should receive more scrutiny, regardless of whether they were written manually or with AI assistance.

## 6. Long-term collaboration research

These ideas are interesting, but they should not be treated as near-term promises.

- 🔬 Shared or collaboration-aware Undo / Redo
- 🔬 Temporary offline editing followed by safe reconciliation
- 🔬 Operation-based synchronization or CRDT-like approaches where appropriate
- 🔬 More advanced automatic conflict merging
- 🔬 Host / publisher / seed migration without disrupting a session
- 🔬 Larger-team scalability
- 🔬 Better collaboration history and change inspection

Some of these may turn out to be inappropriate for Unity's data model or too complex for the value they provide. They remain research directions until proven useful.

## Product and engineering principles

### Build together. Stay in sync.

TeamForge exists to make working **together** the default experience, not merely to move files between computers.

### Complement version control, do not pretend it is obsolete

Git, Unity Version Control, and other VCS tools solve important history, review, and recovery problems. TeamForge aims to improve the live collaboration layer, not erase the need for version control.

### Safety before magic

A convenient automatic action should not silently overwrite or fabricate project state when TeamForge cannot prove that the action is safe.

### Fail visibly and recoverably

When state disagrees, TeamForge should prefer a clear diagnostic and a recovery path over silently forcing one side to "win."

### AI assistance is allowed; unverified output is not the goal

TeamForge itself is heavily AI-assisted. Contributions are judged by correctness, safety, testing, maintainability, and usefulness rather than whether AI was used. See [CONTRIBUTING.md](CONTRIBUTING.md).

## How community feedback changes this roadmap

This roadmap is intentionally flexible. If external testers consistently report that onboarding is a bigger problem than deeper Scene synchronization, onboarding may move first. If a planned synchronization feature creates unacceptable data-integrity risk, it may be redesigned or delayed.

That is why early negative feedback is useful.

If there is a feature here that matters to you, or one that you think should **not** be built, please open an issue or join the project discussion. See [CONTRIBUTING.md](CONTRIBUTING.md) and [SUPPORT.md](SUPPORT.md).
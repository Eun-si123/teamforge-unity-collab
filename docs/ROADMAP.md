# TeamForge Roadmap

**English** | [한국어](ROADMAP.ko.md) | [Current status](STATUS.md)

> **Build together. Stay in sync.**
>
> *Zero-config first, never zero-control.*

This roadmap describes the **direction of TeamForge, not a promise of dates or guaranteed features**. Priorities may change based on testing, technical constraints, security findings, and community feedback.

For a snapshot of what is implemented and what is still blocked **right now**, use **[STATUS.md](STATUS.md)**. This roadmap intentionally separates future direction from current release-readiness claims.

## Status legend

- ✅ **Prototype exists** — implemented and has worked in development testing, but may still be experimental
- 🟡 **Partial / stabilizing** — implemented in part or known to need more reliability / field work
- ⏳ **Planned** — part of the intended direction, not yet complete
- 🔬 **Research / long-term** — worth exploring, but architecture and feasibility are not settled

## 0. Current foundation — stabilize before expanding

The immediate priority is to make the existing foundation safer, easier to validate, and easier for other people to understand before expanding the supported collaboration surface.

- ✅ Connected-user presence
- ✅ Selection / Editor awareness experiments
- ✅ Live Transform synchronization for position, rotation, and scale
- 🟡 Basic object locking / ownership and conflict protection
- 🟡 Same-Scene Hierarchy create / delete / rename / reparent / sibling-order synchronization
- 🟡 Project bootstrap and signed/validated collaboration-invite flow
- 🟡 Direct peer-to-peer project transfer
- 🟡 Chunked transfer, integrity checking, interrupted-transfer resume/retry, staging, activation, and recovery experiments
- 🟡 Diagnostics and recovery UX
- 🟡 Reconnect, mismatch, baseline, and synchronization failure handling
- ✅ Public source publication and source-review structure
- ✅ Automated public CI for Server, Project Peer, launcher runtime-loader, and .NET Windows launcher
- ⏳ Reliable Unity EditMode execution as a required public CI gate
- ⏳ Exact two-PC Windows field-validation closure for the intended end-to-end flow
- ⏳ Validated, general-user packaged alpha distribution
- ⏳ More testing by people other than the project creator

**Current development principle:** reliability, recoverability, and understandable UX come before adding a large number of synchronized object types.

## 1. Deeper Scene collaboration

TeamForge has moved beyond Transform-only experiments: supported same-Scene Hierarchy operations now exist in the prototype. The next work is to make that path more reliable and then broaden the collaboration model carefully.

- 🟡 Same-Scene GameObject creation / deletion synchronization
- 🟡 Same-Scene GameObject rename synchronization
- 🟡 Same-Scene reparenting / sibling-order synchronization
- 🟡 Conflict handling between Hierarchy operations, Transform sync, and locking
- ⏳ Component add / remove synchronization
- ⏳ Inspector / `SerializedProperty` synchronization
- ⏳ Clearer ownership / lock / conflict UX
- ⏳ Stronger reconnect and authoritative resynchronization behavior
- ⏳ Multiple-Scene workflows
- ⏳ Cross-Scene structural operations
- ⏳ Performance work for larger Hierarchies and frequent edits

The goal is not to transmit every Unity change blindly. Changes need identity, ordering, validation, conflict rules, and a safe recovery path when Editors disagree.

## 2. Project, Prefab, and Asset collaboration

Scene synchronization alone does not make two Unity projects truly collaborative. A longer-term goal is to reduce friction around project files and assets while protecting Unity GUID/reference integrity.

- ⏳ Prefab structure / override collaboration
- ⏳ Asset creation, deletion, move, and rename handling
- ⏳ `.meta` / GUID preservation and mismatch protection beyond the current bootstrap scope
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

Current work already contains Host/Guest bootstrap and diagnostic foundations, but the general-user install/distribution path is deliberately not being promoted until field validation is stronger.

Planned directions include:

- 🟡 Simpler Start / Join Collaboration UX
- 🟡 Better automatic setup and diagnostics
- 🟡 Friendly LAN / direct-address workflows
- ⏳ Validated packaged install/update/uninstall experience
- ⏳ Practical internet collaboration when peers are not on the same LAN
- 🔬 Relay / coordinator-assisted connectivity where direct P2P is unavailable
- 🔬 Self-hosted and advanced networking options
- ⏳ Stronger peer identity and authorization
- ⏳ Advanced controls for users who want to configure networking manually

TeamForge currently does **not** provide WebRTC, ICE, STUN, TURN, relay, or automatic NAT traversal. Those should not be implied by the current P2P terminology.

The design principle remains:

> **Zero-config first, never zero-control.**

## 4. Reliability, history, and recovery

For a collaboration tool, "it usually syncs" is not enough. Losing or silently corrupting project state would be worse than failing loudly.

- 🟡 Transfer resume/retry, integrity verification, staged activation, and safe-refusal foundations
- 🟡 Reconnect / baseline mismatch / stale-state diagnostics
- ⏳ Better host-disconnect and host-crash recovery
- ⏳ Safer persistent restart / reconnect behavior
- ⏳ Persistent snapshots or equivalent recoverable state
- 🔬 Operation / recovery journal
- 🔬 Replay or rollback mechanisms where practical
- ⏳ Better detection of corrupted, stale, or mismatched project state
- ⏳ Long-running soak and stress tests
- ⏳ Multi-user conflict and load testing beyond two Editors
- ⏳ Automated disposable A/B/C test-project setup that is suitable for repeatable public CI / field testing

Recovery behavior should be designed as a first-class feature rather than added only after synchronization fails.

## 5. Testing and release readiness

A public source repository and a working development candidate are not the same thing as a generally installable alpha.

Near-term release-readiness work includes:

- ✅ Public-source CI for Node/server/Project Peer/launcher source-level paths
- ✅ Repository secret/dependency/code-scanning automation
- ⏳ Unity-aware CI that can reliably execute EditMode validation
- ⏳ Exact two-PC Windows end-to-end field checklist
- ⏳ Fresh-install tests from the exact artifacts intended for release
- ⏳ Reproducible packaged runtime / dependency provenance and integrity evidence
- ⏳ Failure/recovery matrix for interrupted transfer, reconnect, host/seed loss, and mismatched state
- ⏳ Clear general-user install / update / uninstall documentation
- ⏳ External testers before presenting the project as broadly usable

See **[STATUS.md](STATUS.md)** for the current readiness gates.

## 6. Security and trust boundaries

TeamForge exchanges network messages and can participate in transferring project files, so security review is part of the core roadmap rather than an optional final step.

Important areas include:

- 🟡 Authentication and session handling
- 🟡 Signed / validated invitation and project-transfer flows
- 🟡 Integrity verification for transferred content
- 🟡 Path / staging / activation safety foundations
- ⏳ Stronger peer identity and authorization rules
- ⏳ More systematic untrusted network-input validation and fuzzing
- ⏳ Continued path-traversal / arbitrary-file-write hardening
- ⏳ Continued archive / project extraction and activation review
- ⏳ Protection against unsafe deserialization and command / code execution paths
- ⏳ Secret, token, and credential isolation review
- ⏳ Resource-exhaustion and denial-of-service resistance
- ⏳ Clear handling of malicious or modified Unity projects / packages
- ⏳ Higher-quality Unity-aware C# static analysis
- ⏳ Independent security review as the project matures

Automated scanning is useful, but zero automated alerts is not the same as a professional security audit.

## 7. Long-term collaboration research

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

### Distribution follows validation

A convenient install button is not useful if the underlying package/runtime/field workflow is still too unstable. TeamForge should promote a general-user install path only after the exact distributed artifacts have passed the intended validation gates.

### AI assistance is allowed; unverified output is not the goal

TeamForge itself is heavily AI-assisted. Contributions are judged by correctness, safety, testing, maintainability, and usefulness rather than whether AI was used. See [CONTRIBUTING.md](CONTRIBUTING.md).

## How community feedback changes this roadmap

This roadmap is intentionally flexible. If external testers consistently report that onboarding is a bigger problem than deeper Scene synchronization, onboarding may move first. If a planned synchronization feature creates unacceptable data-integrity risk, it may be redesigned or delayed.

That is why early negative feedback is useful.

If there is a feature here that matters to you, or one that you think should **not** be built, please open an issue or join the project discussion. See [CONTRIBUTING.md](CONTRIBUTING.md) and [SUPPORT.md](SUPPORT.md).

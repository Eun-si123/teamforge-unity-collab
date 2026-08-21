# TeamForge Roadmap

**English** | [한국어](ROADMAP.ko.md) | [Current status](STATUS.md)

> **Build together. Stay in sync.**
>
> *Zero-config first, never zero-control.*

This roadmap describes **direction, not promised dates or guaranteed features**. Priorities may change based on testing, technical constraints, security findings, and community feedback. For current implemented/validated/blocked state, use [STATUS.md](STATUS.md).

## Status legend

- ✅ **Exists / automated** — implemented or an automated validation path now exists
- 🟡 **Partial / stabilizing** — implemented in part or still needs reliability/field work
- ⏳ **Planned** — intended direction, not yet implemented as a supported capability
- 🔬 **Research / long-term** — architecture and feasibility are not settled

## 0. Current foundation — stabilize while expanding carefully

The foundation is substantially stronger than the earlier prototype state, but WP5.1 remains field-blocked.

- ✅ Connected-user Presence
- ✅ Selection / Editor awareness
- ✅ Live Transform synchronization for position, rotation, and scale
- 🟡 Server-authoritative object locking / ownership and conflict protection
- 🟡 Same-Scene Hierarchy create / delete / rename / reparent / sibling-order synchronization
- 🟡 Project bootstrap and signed/validated Collaboration Invite flow
- 🟡 Direct P2P Project Peer transfer with chunking, integrity, resume/retry, staging, activation, and seed/failover foundations
- 🟡 Diagnostics, mismatch handling, and recovery UX
- 🟡 Windows path resilience / managed short execution workspace
- ✅ Public source CI for Server, Project Peer, runtime loader, and Windows Launcher
- ✅ Unity 6000.3.21f1 EditMode + real-server E2E automation on relevant PRs and `main` pushes
- ✅ Deterministic multi-peer authority/recovery chaos automation
- ✅ Rebuilt immutable WP5.1 r2 candidate publication workflow
- ⏳ Exact two-PC Windows field-validation closure on the intended candidate
- ⏳ Exact-candidate fresh-install / fresh-project validation
- ⏳ General-user packaged alpha promotion
- ⏳ More testing by people other than the project creator

**Current development principle:** reliability, recoverability, explicit authority, and understandable UX still come before broad synchronization coverage.

## 1. Immediate next work — Component & Inspector Sync Foundation

The next major Scene-collaboration expansion should build on the now-tested Transform/Hierarchy/Lock state machine rather than bypassing it.

### Proposed WP6 direction

- ⏳ Define stable Component identity under a GameObject, including multiple Components of the same type
- ⏳ Component add synchronization for a deliberately limited supported set
- ⏳ Component remove synchronization with authority/lock checks
- ⏳ Inspector / `SerializedProperty` change synchronization for narrow supported property shapes
- ⏳ Revision, ordering, replay/idempotency, stale-state, and rejection rules for Component/property operations
- ⏳ Undo/rejection/reconciliation behavior without leaving stale local Inspector state
- ⏳ Reconnect and authoritative resynchronization for Component/property state
- ⏳ Deterministic Unity E2E and chaos coverage from the first implementation pass

The first implementation should **not** blindly serialize every Unity property. Object references, managed references, arrays/lists, nested structures, custom drawers, Prefab overrides, and arbitrary MonoBehaviour data need explicit identity and safety rules before they become supported.

## 2. Deeper Scene collaboration after the foundation

- 🟡 Same-Scene GameObject create/delete/rename/reparent/order reliability
- 🟡 Transform/Hierarchy/Lock contention and reconciliation
- ⏳ Clearer Lock / Ownership / Conflict UX
- ⏳ Stronger reconnect and authoritative resynchronization
- ⏳ Broader safe Component/property support after WP6 proves the contract
- ⏳ Multiple-Scene workflows
- ⏳ Cross-Scene structural operations
- ⏳ Performance work for larger Hierarchies and frequent edits

The goal is not to transmit every Unity change blindly. Each operation needs identity, ordering, validation, authority, conflict rules, and a safe recovery path when Editors disagree.

## 3. Project, Prefab, and Asset collaboration

Scene synchronization alone does not make two Unity projects fully collaborative. Longer-term work may include:

- ⏳ Prefab structure / override collaboration
- ⏳ Asset creation, deletion, move, and rename handling
- ⏳ `.meta` / GUID preservation and mismatch protection beyond bootstrap
- ⏳ Material and other serialized Asset collaboration
- ⏳ Script / project-file change awareness
- ⏳ Incremental transfer of only what another peer needs
- ⏳ Stronger Project identity / compatibility checks
- ⏳ Safer handling of package/project differences between peers

Asset synchronization remains high risk because a small identity error can silently damage references throughout a Unity project.

## 4. Easier onboarding and flexible networking

The long-term common path should feel closer to:

**Start Collaboration → invite someone → they get what they need → Join Collaboration**

Current Host/Guest bootstrap and diagnostics are useful foundations, but the general-user install path remains deliberately unpromoted until field validation is stronger.

- 🟡 Simpler Start / Join Collaboration UX
- 🟡 Better automatic setup and diagnostics
- 🟡 Friendly LAN / direct-address workflows
- ⏳ Validated install / update / uninstall experience
- ⏳ Practical internet collaboration outside one LAN
- 🔬 Relay / coordinator-assisted connectivity when direct P2P is unavailable
- 🔬 Self-hosted / advanced networking options
- ⏳ Stronger peer identity and authorization
- ⏳ Advanced manual networking controls

TeamForge currently does **not** provide WebRTC, ICE, STUN, TURN, relay, or automatic NAT traversal.

## 5. Reliability, history, and recovery

- 🟡 Transfer resume/retry, integrity verification, staged activation, and safe-refusal foundations
- 🟡 Reconnect / baseline mismatch / stale-state diagnostics
- ✅ Deterministic authority/recovery chaos coverage for current protocol invariants
- ⏳ Better Host disconnect / crash recovery
- ⏳ Safe persistent server/session restart behavior
- ⏳ Persistent snapshots or equivalent recoverable state
- 🔬 Operation / recovery journal
- 🔬 Replay or rollback mechanisms where practical
- ⏳ Better detection of corrupted, stale, or mismatched Project state
- ⏳ Long-running soak/stress tests
- ⏳ Multi-user conflict/load testing beyond two Editors
- ⏳ Repeatable disposable A/B/C Unity test-project setup for CI/field use

Recovery is a first-class feature, not something to add only after synchronization fails.

## 6. Testing and release readiness

The testing baseline changed substantially on 2026-08-21.

- ✅ Public source CI for Node/Server/Project Peer/runtime-loader/Launcher
- ✅ Unity EditMode workflow using Unity `6000.3.21f1`
- ✅ Real-server Unity authority E2E
- ✅ Real-server Unity lock-contention E2E
- ✅ Project Transfer resume E2E
- ✅ Deterministic authority + recovery chaos suites
- ✅ Rebuild/stage/hash/publish automation for WP5.1 r2
- ⏳ Exact two-PC Windows end-to-end field checklist on r2
- ⏳ Fresh-install testing from the exact published r2 artifact
- ⏳ Exact-candidate Unity evidence retained specifically for release closure
- ⏳ Realistic network disruption / disconnect / host-loss field matrix
- ⏳ Clear install / update / uninstall documentation
- ⏳ External testers before broad usability claims

See [STATUS.md](STATUS.md) for the current readiness gate and exact evidence boundaries.

## 7. Security and trust boundaries

- 🟡 Authentication and session handling
- 🟡 Signed / validated invitation and Project-transfer flows
- 🟡 Integrity verification for transferred content
- 🟡 Path / staging / activation safety foundations
- ⏳ Stronger peer identity and authorization
- ⏳ More systematic untrusted network-input validation and fuzzing
- ⏳ Continued path-traversal / arbitrary-file-write hardening
- ⏳ Continued archive / Project extraction and activation review
- ⏳ Protection against unsafe deserialization and command/code-execution paths
- ⏳ Secret/token/credential isolation review
- ⏳ Resource-exhaustion / denial-of-service resistance
- ⏳ Clear handling of malicious or modified Unity projects/packages
- ⏳ Higher-quality Unity-aware C# static analysis
- ⏳ Independent security review as the project matures

Automated scanning and green tests are evidence, not a professional security audit.

## 8. Long-term collaboration research

- 🔬 Collaboration-aware shared Undo / Redo
- 🔬 Temporary offline editing followed by safe reconciliation
- 🔬 Operation-based synchronization or CRDT-like approaches where appropriate
- 🔬 More advanced conflict merging
- 🔬 Host / Publisher / Seed migration without disrupting a session
- 🔬 Larger-team scalability
- 🔬 Better collaboration history and change inspection

Some of these may not fit Unity's data model or may cost more complexity than the value they provide. They remain research directions until proven useful.

## Product and engineering principles

### Complement version control

Git, Unity Version Control, and other VCS tools remain important for history, review, backup, and recovery. TeamForge aims to improve live collaboration, not replace them.

### Safety before magic

A convenient automatic action should not silently overwrite or fabricate Project state when TeamForge cannot prove the action is safe.

### Fail visibly and recoverably

When state disagrees, prefer a clear diagnostic and recovery path over silently forcing one side to win.

### Distribution follows validation

A polished installer is not useful if the exact packaged workflow is still field-blocked. General-user distribution should follow exact-artifact validation.

### AI assistance is allowed; unverified output is not the goal

TeamForge is heavily AI-assisted. Changes are judged by correctness, safety, testing, maintainability, and usefulness rather than whether AI was used.

## How feedback changes this roadmap

This roadmap is intentionally flexible. If testing shows onboarding is a bigger blocker than deeper Scene synchronization, onboarding can move earlier. If a synchronization feature creates unacceptable data-integrity risk, it can be narrowed, redesigned, or delayed.

# TeamForge Roadmap

**English** | [한국어](ROADMAP.ko.md) | [Current status](STATUS.md)

> **Build together. Stay in sync.**
>
> *Zero-config first, never zero-control.*

This roadmap describes **direction, not promised dates or guaranteed features**. It deliberately avoids duplicating live blocker, PR, CI-run, and field-validation details. For what is implemented, validated, blocked, or currently packaged, use **[STATUS.md](STATUS.md)**.

## Guiding priorities

TeamForge is being developed in this order:

1. **Reliability before breadth** — existing collaboration paths should recover predictably before more Unity state is synchronized.
2. **Explicit authority and identity** — peers should not silently invent ownership, object identity, or conflict outcomes.
3. **Safe failure and recovery** — disagreement should produce a visible, recoverable state rather than silent project damage.
4. **Simple common path, inspectable advanced path** — normal Host/Guest collaboration should become easier without hiding important networking, trust, or recovery boundaries.
5. **Distribution follows validation** — installer polish does not substitute for exact-artifact field evidence.

## Now — close the current foundation and begin narrow Component collaboration

### Physical Windows closure for the current stabilization line

The current source contains targeted fixes for the known WP5.1 Windows field blockers. Before a generally installable alpha is promoted, the intended post-fix packaged candidate still needs the physical Windows scenarios listed in [STATUS.md](STATUS.md).

This work includes:

- saved Guest reconnect after legitimate collaborative Scene saves;
- rapid Transform / lock contention recovery;
- interrupted receive / Launcher shutdown and resume;
- repeatable LAN Seed / firewall onboarding;
- long/deep Windows path execution-alias handoff;
- a fresh Host → Guest → realtime collaboration rerun on the exact intended artifact.

### WP6: narrow Component / Inspector foundation

After the current stabilization source is in place, the next major Scene-collaboration expansion should build on the existing authority/identity/recovery model instead of bypassing it.

Planned first steps:

- define stable Component identity under a GameObject, including multiple Components of the same type;
- synchronize Component add/remove for a deliberately limited supported set;
- synchronize a narrow set of Inspector / `SerializedProperty` shapes;
- define revision, ordering, replay/idempotency, stale-state, and rejection rules;
- define Undo/rejection/reconciliation behavior that does not leave stale local Inspector state;
- restore authoritative Component/property state after reconnect;
- add deterministic Unity E2E and conflict/recovery tests from the first implementation pass.

The first implementation should **not** blindly serialize every Unity property. Object references, managed references, arrays/lists, nested structures, custom drawers, Prefab overrides, and arbitrary MonoBehaviour data need explicit identity and safety rules before they become supported.

## Next — deeper Scene collaboration

Once the narrow Component/property contract is proven:

- broader safe Component/property coverage;
- clearer Lock / Ownership / Conflict UX;
- stronger reconnect and authoritative resynchronization;
- multiple-Scene workflows;
- cross-Scene structural operations with explicit identity rules;
- performance work for larger Hierarchies and frequent edits;
- repeatable disposable A/B/C Unity test environments for local and field work.

The goal is not to transmit every Unity change blindly. Each operation needs identity, ordering, validation, authority, conflict rules, and a safe recovery path when Editors disagree.

## Later — Project, Prefab, and Asset collaboration

Longer-term project-level collaboration may include:

- Prefab structure / override collaboration;
- Asset create/delete/move/rename handling;
- stronger `.meta` / GUID preservation and mismatch protection beyond bootstrap;
- Material and other serialized Asset collaboration;
- script / project-file change awareness;
- incremental transfer of only what another peer needs;
- stronger Project identity / compatibility checks;
- safer package/project difference handling.

Asset synchronization remains high risk because an identity error can silently damage references throughout a Unity project.

## Later — easier onboarding and flexible networking

The long-term common path should feel closer to:

**Start Collaboration → invite someone → they get what they need → Join Collaboration**

Directions include:

- simpler Start / Join Collaboration UX;
- better automatic setup and diagnostics;
- friendly LAN / direct-address workflows;
- validated install / update / uninstall experience;
- practical Internet collaboration outside one LAN;
- stronger peer identity and authorization;
- advanced manual/self-hosted networking controls.

### Connectivity research

Possible research directions include:

- relay / coordinator-assisted connectivity when direct P2P is unavailable;
- WebRTC / ICE / STUN / TURN where they provide clear value;
- peer discovery that does not weaken explicit trust;
- transport fallback that remains observable rather than silently changing the security model.

These are research directions, not current capabilities. Current networking boundaries are documented in [STATUS.md](STATUS.md) and [architecture.md](architecture.md).

## Later — reliability, history, and recovery

Long-term recovery work may include:

- better Host disconnect / crash recovery;
- durable server/session restart behavior;
- persistent authoritative snapshots or equivalent recoverable state;
- operation / recovery journal;
- replay or rollback mechanisms where practical;
- stronger stale/corrupted/mismatched Project detection;
- long-running soak/stress testing;
- larger multi-user conflict/load testing.

Recovery is a first-class feature, not something to add only after synchronization fails.

## Later — security and trust hardening

Security work remains continuous rather than a one-time milestone:

- stronger peer identity and authorization;
- systematic untrusted network-input validation and fuzzing;
- continued path-traversal / arbitrary-file-write hardening;
- archive / Project extraction and activation review;
- unsafe deserialization and command/code-execution review;
- secret/token/credential isolation review;
- resource-exhaustion / denial-of-service resistance;
- malicious or modified Unity project/package handling;
- stronger Unity-aware C# static analysis;
- independent security review as the project matures.

Automated scanning and green tests are evidence, not a professional security audit.

## Research — advanced collaboration models

These ideas remain exploratory until their value and Unity fit are demonstrated:

- collaboration-aware shared Undo / Redo;
- temporary offline editing followed by safe reconciliation;
- operation-based synchronization or CRDT-like approaches where appropriate;
- advanced conflict merging;
- Host / Publisher / Seed migration without disrupting a session;
- larger-team scalability;
- richer collaboration history and change inspection.

Some may not fit Unity's data model or may cost more complexity than the value they provide.

## Product and engineering principles

### Complement version control

Git, Unity Version Control, and other VCS tools remain important for history, review, backup, and recovery. TeamForge aims to improve live collaboration, not replace them.

### Safety before magic

A convenient automatic action should not silently overwrite or fabricate Project state when TeamForge cannot prove the action is safe.

### Fail visibly and recoverably

When state disagrees, prefer a clear diagnostic and recovery path over silently forcing one side to win.

### Distribution follows validation

A polished installer is not useful if the exact packaged workflow remains unvalidated.

### AI assistance is allowed; unverified output is not the goal

TeamForge is heavily AI-assisted. Changes are judged by correctness, safety, testing, maintainability, and usefulness rather than whether AI was used.

## How feedback changes this roadmap

This roadmap is intentionally flexible. If testing shows onboarding is a bigger blocker than deeper Scene synchronization, onboarding can move earlier. If a synchronization feature creates unacceptable data-integrity risk, it can be narrowed, redesigned, or delayed.

For live implementation and readiness state, do not infer from this roadmap: use **[STATUS.md](STATUS.md)** and the relevant GitHub Issues.

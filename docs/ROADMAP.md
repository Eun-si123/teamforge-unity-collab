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

## Balanced outcomes across environments — engineering principle (2026-10-14)

**Design intent, not a newly implemented feature or change in release priority:** TeamForge should work usefully and predictably across supported environments by considering **performance/latency, reliability/recovery, security and project integrity, network/OS compatibility, ease of use and expert control, and CPU/RAM/network/hosting cost together**. No single protocol (WebSocket, H2/H3, QUIC, P2P, relay) or speed metric is the objective. **Balanced does not mean all concerns have equal priority at every instant**: authorization, identity, data integrity, explicit consent and project-preservation are hard requirements that cannot be traded for speed.

| Decision step | TeamForge-specific rule and example |
| --- | --- |
| **Identify actual capability** | Determine the supported Host/Guest platform, firewall/LAN/VPN/NAT, reachable Project Seed, authenticated Coordinator and Client/Server protocol negotiation. A discovered address, NAT mapping or advertised feature is not proof of trust or end-to-end reachability. |
| **Keep a known-good simple path** | Preserve current authoritative WebSocket realtime collaboration and separately verified Direct HTTP Project transfer unless an alternative demonstrates a real advantage. Protocol additions must remain capability-gated and backward-compatible; a stable connection is not changed for novelty. |
| **Optimize all affected dimensions** | Evaluate edit propagation p95/p99, Host/Guest join time, verified Project transfer time and bytes, resource cost, error rate, compatibility and user effort. More bandwidth, compression or parallel channels are not wins if they increase misapplied edits, security exposure, memory use or packaging failures. |
| **Gracefully degrade without inventing state** | If remote connectivity fails, local Unity editing may continue **under Unity's existing local behavior**, but do not imply TeamForge can automatically synchronize offline edits. Preserve verified Active Project revisions, present connection/conflict status, reject stale ownership and recover via authenticated revision/snapshot reconciliation **where implemented**. |
| **Fail safe, recover with evidence** | A transport ACK is not proof that an edit was accepted; a received chunk is not an activated project. Compare reconnect and Host/Seed loss on exact tested artifacts, including duplicate/stale operations, checksum/identity mismatch, NAT/UDP restrictions, user cancellation and multiple peers. Keep a manual/known-safe route where feasible. |
| **Make the outcome understandable** | Normal Host/Guest onboarding should be simple; advanced networking and recovery controls should expose effective state, reason, limits and safe fallback only where supported. Avoid permanent feature clutter and unverified automation. |

**Decision gate for a proposed protocol or feature:** Does it solve a reproduced user-visible problem? Which platform, network, peer and threat-model capabilities does it assume? Is there a simpler change to the existing WebSocket/HTTP, authoritative snapshot or manifest pathway? Can it maintain authorization, revision, lock, GUID, hash and atomic activation boundaries? Can it be backed out cleanly? Evaluate at least one healthy and one constrained/recovery scenario with the **same** task and trust assumptions, preserving negative results.

This balances **all** important product qualities without weakening the [guiding priorities](#guiding-priorities) above. The roadmap stays a future-looking owner; as-built behavior remains in [architecture.md](architecture.md), actual capability/field readiness in [STATUS.md](STATUS.md), and exact selected package/protocol identities in `release-contract.json`. It does not reopen completed phases or promote experimental NAT traversal, WebSocket H2/H3, WP6 Component sync, full offline collaboration or persistent Session recovery into currently supported features.

## Now — finish the current packaging/evidence boundary and begin narrow Component collaboration

### Validate the selected packaged candidate and its remaining field gates

The current published candidate, its exact artifact identity and remaining release gates are tracked in [STATUS.md](STATUS.md). A source checkout may contain changes newer than those packaged bytes; evidence belongs to the exact artifact and scenario that was tested.

Before promoting a selected artifact as a generally installable alpha candidate, validate its remaining field gates and preserve earlier exact two-PC evidence within its original boundary. Do not mechanically repeat closed historical scenarios as if they had never been tested, or treat source CI as physical evidence for a newer package.

Current validation direction includes:

- fresh Windows LAN firewall onboarding with narrow, inspectable rule scope and cleanup behavior;
- preferred Seed-port unavailable/collision fallback and advertised endpoint reachability;
- Windows Project identity recovery after abnormal process loss while preserving fail-closed conflict handling;
- Host stop/start and fresh Guest direct Project transfer on the exact packaged artifact;
- a fresh extraction Host → Guest → realtime collaboration smoke path so newer packaging/integration changes are covered by their own evidence;
- continued external/user testing beyond the project creator before broad reliability claims.

The detailed current evidence and exact remaining release gate belong in [STATUS.md](STATUS.md), not in this roadmap.

### WP6: narrow Component / Inspector foundation

The next major Scene-collaboration expansion should build on the existing authority/identity/recovery model instead of bypassing it.

Planned first steps:

- define stable Component identity under a GameObject, including multiple Components of the same type (a server-side **identity-only, unconnected WP6 pre-wire candidate validator** and fail-closed tests are in `server/src/component-foundation.mjs`, including absolute record and UTF-8 snapshot byte ceilings; no Unity/WS integration or feature support is implied);
- synchronize Component add/remove for a deliberately limited supported set (the **offline structural intent guardrail** in `server/src/component-structure-foundation.mjs` tests ownership, type metadata, multiplicity, and dependencies; no wire operation or Unity mutation is enabled);
- synchronize a narrow set of Inspector / `SerializedProperty` shapes (a separate, disconnected candidate validator now tests exact allowlisted simple typed property values, including per-property numeric bounds, but no live Inspector mutation or network integration exists);
- define revision, ordering, replay/idempotency, stale-state, and rejection rules;
- define Undo/rejection/reconciliation behavior that does not leave stale local Inspector state (a disconnected **read-only three-way observation classifier** in `server/src/component-property-foundation.mjs` identifies local-only, remote-only, convergent, divergent and incomplete property observations against one exact prepared baseline; it never chooses a winner, commits an edit or repairs Unity state);
- restore authoritative Component/property state after reconnect (an **unwired operation-ID replay classifier and structural/property membership/lock/repair-hint preflight** tests conflict-vs-matching previous results against the existing Session-wide history, but never authorizes, broadcasts or replays any operation);
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

## Research refinement — strengthen existing ideas before widening scope (2026-10-14)

**Idea candidates only; no new feature, protocol, implementation, release promise or change to current priorities.** These refine the WP6, project-transfer, connectivity, safety, and automation directions above. Implementation/evidence status remains exclusively in [STATUS.md](STATUS.md).

| Existing direction | Potential strengthening | Disproof / safety gate before considering implementation |
| --- | --- | --- |
| Component/Inspector collaboration | Treat the first supported property edit as a **scoped, revision-checked operation** with stable GameObject/Component/property identity, operation-ID replay protection, owner lease verification, and targeted reject/repair. Model Unity Undo/Redo and domain reload as separate failure paths, not implicit global Undo. | Two Editors make conflicting edits, one crashes/reconnects, and a duplicate arrives late: neither an unrelated local edit nor a Prefab override may be silently reverted or accepted without authority. Begin with one allowlisted property shape, not general serialization. |
| Durable session/recovery | Compare a minimal **session generation/epoch fence + authoritative snapshot + bounded operation journal** with today's in-memory authority. Separate recovering previous accepted state from reissuing a command. | Kill/restart coordinator between validate, broadcast, acknowledgement and persist boundaries. Prove stale owners/operations from the prior epoch cannot mutate a new session; never infer success from a missing acknowledgement. Do not promise crash survival before this is evidenced. |
| P2P bootstrap/transfer | Examine **verified incremental project manifests** and immutable chunk reuse to reduce repeat bootstrap work, while preserving Unity `.meta`/GUID identity, project-root containment, signatures, hash verification and atomic activation. | Alter or remove a `.meta`, rename an Asset, poison a cached chunk, or interrupt activation. Guest must either reconstruct exactly the intended project version or refuse with actionable recovery; speed is secondary to integrity. |
| Internet connectivity alternatives | First map direct LAN/WAN connection failure classes and observable fallbacks. Evaluate ICE/STUN/TURN, alternate address families, or a separately authorized relay **only if** a measured reachability gap warrants them; keep peer authentication independent of connectivity discovery. | Test symmetric NAT, blocked UDP, address changes and unavailable relay with explicit cost limits. An advertised candidate or a successful STUN response is never proof of peer identity or successful P2P data transfer. |
| Automation and diagnosis | Prefer an explainable **suggest → verify → act (only if safe) → confirm/undo** flow for Host/Guest setup, path/firewall checks and recoverable conflicts. Keep security-sensitive firewall/credential/trust changes inspectable and user-authorized. | Simulate misleading readiness, expired invite, stale endpoint and ambiguous Project root. Automation must not open broad firewall access, reuse a rejected identity or overwrite user changes to make a green status indicator. |
| Offline edits, CRDT/OT and history | Explore **operation-specific reconciliation** before wholesale CRDT adoption: commutative leaf properties might merge; deletion, reparenting, asset GUID replacement and Prefab conflicts usually need explicit authority or human resolution. | Replay an offline branch with reordered, duplicate and conflicting operations; preserve deterministic conflict reports and a recoverable original snapshot. Reject merge designs that cannot preserve Unity object references. |

**Balance rule:** Harden already-supported Host/Guest and Scene paths first, then evaluate one narrow new capability against simpler recovery or existing Git/version control. Assess correctness, clarity, failure recovery, resource cost and reproducibility together. An interesting protocol or automation candidate is not a scheduling mandate.

## Research discovery — additional protocol and synchronization options (2026-10-14)

**Research inventory, not a feature plan, implemented capability, endorsed dependency or change to the current WP6/field-validation priority.** Unlike the existing broad ICE/STUN/TURN, CRDT and incremental-transfer categories, these are concrete candidate protocols/algorithms to compare **only after an appropriate failure mode is observed**. Current as-built claims remain in [STATUS.md](STATUS.md).

| Newly examined candidate | Unique value beyond existing roadmap label | Cost, safety boundary and smallest useful comparison | Revisit |
| --- | --- | --- | --- |
| **libp2p Circuit Relay v2 + DCUtR** ([protocol spec](https://github.com/libp2p/specs/blob/master/relay/DCUtR.md), [JS implementation](https://libp2p.github.io/js-libp2p/modules/_libp2p_dcutr.html)) | A concrete *relay-first, synchronize hole punching, upgrade to direct* path; a distinct alternative to planning a full WebRTC/ICE stack merely to solve NAT reachability. | The relayed bootstrap already needs a trusted/reachable relay; hole punching fails on some NATs; relay cost and new runtime/dependency complexity may dominate a small-team project. Compare existing direct-address flow vs a disposable DCUtR/relay fixture vs ICE-based alternative under home/symmetric NAT and blocked UDP. **Do not reuse unauthenticated discovered peer addresses as identity.** | **B** connectivity gap |
| **WebRTC DataChannel / SCTP with partial reliability** ([RFC 8831](https://www.rfc-editor.org/rfc/rfc8831.html)) | Compare separate reliable ordered channels for authoritative edits against **unordered/expiry-limited updates** for ephemeral presence/selection/camera awareness. This makes transport delivery semantics explicit without treating every Unity change as durable. | WebRTC stack and SCTP/DTLS/ICE integration increase packaging/support cost; unreliable delivery is forbidden for authority, locks, project data and any edit requiring reconciliation. Run a disposable latency/loss/large-message comparison against existing WebSocket; preserve trusted user/operation identity across channels. | **B/C** only for measured head-of-line cost |
| **FastCDC content-defined chunks + VCDIFF/rsync** ([USENIX FastCDC](https://www.usenix.org/conference/atc16/technical-sessions/presentation/xia), [RFC 3284](https://www.rfc-editor.org/rfc/rfc3284), [rsync design](https://rsync.samba.org/tech_report/)) | Existing 'incremental project transfer' gains concrete alternatives that might reuse files after a byte insertion or near-identical Asset revision, rather than only exactly matching fixed-size chunks. | `.meta`/GUID mismatch can silently break projects; preserve signed project-version identity, trusted base hash, bounded delta decode, final byte/hash checks and atomic activation. Compare full copy vs fixed chunks vs CDC/delta on realistic Unity assets and compressed media; never patch active project files in place. | **B** transfer bottleneck |
| **Rateless IBLT / compact set reconciliation** ([SIGCOMM 2024](https://dspace.mit.edu/entities/publication/a6315819-c34a-4a2c-8218-e811d665dff3)) | Exchange *which* authenticated asset/chunk IDs differ before paying for a large manifest; possible complement to future offline/multi-seed project bootstrap. | Inventory sketches do **not** authenticate file bytes or project membership. Require signed manifests, bounded decoding, peer authorization and simple hashed-list fallback. Compare full list, Merkle tree and IBLT with small vs large differences, malformed/skewed inputs and constrained RAM. | **C** only at scale |
| **SPAKE2+ password-authenticated key exchange** ([RFC 9383](https://www.rfc-editor.org/rfc/rfc9383.html)) | An alternative **short human join-code *pairing* design** distinct from carrying a reusable server bearer token; consider as a component of one-paste Guest onboarding, not a silent replacement for existing signed invites. | A short code still requires online guessing limits, attempt/rate controls, expiry, peer/server identity binding and explicit membership authorization. Check whether the augmented PAKE registration model even fits a single-use invite; compare with existing high-entropy signed capability tokens first. Do not invent custom cryptography or weaken TLS. | **B/C** UX security research |
| **Messaging Layer Security (MLS)** ([RFC 9420](https://www.rfc-editor.org/rfc/rfc9420.html)) | A formal candidate if TeamForge later needs **end-to-end encrypted multi-editor group membership and changing key epochs** when coordinator/relays are not trusted with project-edit content. | MLS does not replace server authoritative revisions, lock ownership, project signatures, or trusted identity enrollment. Ratchet/state recovery and offline rejoin are complex. Compare simple authenticated peer sessions and signed invites for today's small groups first; evaluate MLS only against a concrete confidentiality/membership threat model. | **C** future trust model |
| **Merkle anti-entropy / causal reconciliation hints** (existing data-structure family; not a wire standard) | Let a reconnecting editor prove which authoritative snapshot/revision or immutable content subtree it lacks, rather than blindly replaying all history. Version vectors/causal metadata could help **diagnose** divergent offline edits without auto-merging Unity hierarchy. | A tree hash detects disagreement, not an authorized winner. Keep server authority, epoch fences, identity, GUIDs and reject/repair rules; compare existing full resync with bounded tree-diff plus snapshotted operation journal. Fail closed on conflicting ownership or stale epochs. | **B/C** reconnect evidence |

**Cross-project candidate:** BetterNet's verified content-inventory and TeamForge's immutable transfer manifest could both independently benchmark FastCDC/VCDIFF/IBLT, **without** merging services, user content, auth/trust roots or protocols. A matching algorithm is not evidence that shared caching is safe.

**Ranking is research priority, not implementation priority:** B = revisit if a measured current limitation makes a low-risk disposable comparison worthwhile; C = long-horizon/costly or trust-sensitive. Existing exact-package field gates and narrow WP6 authority/recovery remain first. Keep negative results and cite a verified specification/version before any future coding decision.

## Research: missed alternatives in earlier TeamForge phases (2026-10-14)

**Ideas only.** This is a retrospective options matrix for Phase 1 presence, Phase 2 editing/locks, Phase 3 project bootstrap/P2P and current WP5/WP6 recovery. It does **not** retrofit old releases, change wire version, require libraries, reopen closed bugs or claim field validation. Existing direct transfer, WebSocket authority, signed manifests, locks and Unity ownership rules remain the actual supported baseline ([STATUS.md](STATUS.md)).

| Historical phase / unresolved opportunity | Concrete protocol or technique to compare | Why it might help, and an explicit reason **not** to adopt |
| --- | --- | --- |
| **Phase 1: Host/Guest endpoint entry** | [mDNS, RFC 6762](https://www.rfc-editor.org/rfc/rfc6762.html) + [DNS-SD, RFC 6763](https://www.rfc-editor.org/rfc/rfc6763.html) optional LAN discovery | A trusted Host could be *found* on the same local link without typing its address; test manual endpoint vs mDNS on Windows private/public networks, guest Wi-Fi, VLAN and VPN. **Discovery never proves Host identity, access-code validity or consent**; show fingerprint/invite check, manual fallback and no sensitive TXT records. This is not Internet discovery. |
| **Phase 3: explicit Direct Seed ports and NAT** | [Port Control Protocol (PCP), RFC 6887](https://www.rfc-editor.org/rfc/rfc6887.html), compare manual port forwarding and future ICE/DCUtR | Router-assisted **temporary** mapping is a separate option before paying for permanent TURN/relay. PCP support is not universal, and does not solve every CGNAT or distribute an authenticated peer address. Never open an inbound port without user approval, scope, expiry/renewal, cleanup and a positive remote reachability check; retain direct/manual/relay alternatives. |
| **Phase 3: one signed Project baseline shared to multiple Guests** | [NACK-Oriented Reliable Multicast (NORM), RFC 5740](https://www.rfc-editor.org/rfc/rfc5740.html) versus existing authenticated unicast/chunk reuse | Where LAN multicast is actually supported, group FEC/NACK repair could avoid sending an immutable baseline separately to many approved Guests. However Wi-Fi multicast can be slow/lossy/blocked and NORM adds considerable complexity. Compare 1/2/4/8 receivers for total Host bytes, join latency, per-Guest hash correctness, missed repair and battery; this is **not** an automatic substitute for guest authorization or signed manifests. |
| **Phase 2: small authority messages versus bulk bootstrap** | [HTTP/2/3 Extensible Priorities, RFC 9218](https://www.rfc-editor.org/rfc/rfc9218.html) and bounded application queues | If future HTTP/2/3 transport or download requests share a cooperating endpoint, use urgency/incremental hints for control vs bulk; compare with separate existing WebSocket/HTTP channels and local queue caps. **HTTP Priority does not prioritize individual WebSocket frames**, and server support is optional; no justification to replace WebSockets without measured head-of-line contention. |
| **Phase 3: tail stalls in TCP project transfer** | [RACK-TLP TCP loss detection, RFC 8985](https://www.rfc-editor.org/rfc/rfc8985.html) | Before adding a new P2P transport, check whether OS TCP already uses efficient time-based tail-loss recovery; record final-chunk latency, retransmits and connection churn. Not an application wire protocol and not a request to replace Windows/Linux kernel controls. Prefer baseline instrumentation and a controlled OS/fixture comparison if supported. |
| **WP5: future changing direct/relay network path** | [QUIC native path validation/migration, RFC 9000 §9](https://www.rfc-editor.org/rfc/rfc9000.html#section-9) and [TAPS transport API, RFC 9622](https://www.rfc-editor.org/rfc/rfc9622.html) | Only if a **future cooperative transport** is considered: compare preserving a connection on address change with inexpensive authenticated reconnect + snapshot/resume; TAPS Require/Prohibit semantics may help keep security hard constraints explicit. They are **not currently implemented** by the WebSocket or Direct HTTP data path; packet routing and identity must be independently authorized. |
| **WP5/6: diagnosing obscure failures** | [qlog draft (July 2026)](https://datatracker.ietf.org/doc/draft-ietf-quic-qlog-main-schema/) for a hypothetical future QUIC stack + task-local structured decision trace today | A shared causal timeline (Host/Guest/Seed generation, request ID, revision, lock, authority rejection, reconnect) is often more useful than changing protocol. qlog applies **only if** QUIC/H3 is actually used; not a reason to fabricate QUIC traces or log private scene contents, access codes or bearer tokens. Validate redaction and bounded retention. |
| **WP6: edit replay and latency optimization** | [HTTP early data / replay threat, RFC 8470](https://www.rfc-editor.org/rfc/rfc8470.html) and **bounded operation idempotency + model-checked state machine** (TLA+/PlusCal as tools, not wire protocols) | A duplicate/replayed edit can outlive the socket even if a new transport promises low handshake latency. Test stale epoch + lock expiry + retry + targeted Undo + duplicate property edits against server authority. Never send mutating Component/Hierarchy operations in replayable 0-RTT by default; a faster handshake is no substitute for authorization, commit and deterministic repair. |

### Cross-phase options and stop conditions

- **First compare what exists:** Windows TCP tuning/visibility and existing WebSocket/Direct HTTP, signed manifests, Unity-aware target recovery, existing Session authority and known field gates.
- **Then the inexpensive optional improvements:** LAN discovery and human-confirmed onboarding, service-specific queue/priorities, replayable authority traces and small-scale group-transfer baselines.
- **Only then expensive protocol candidates:** PCP with explicit consent, NORM multicast, QUIC migration, ICE/DCUtR/WebRTC or different authority replication. Each needs a real gap, safer fallback, measured improvement and integration/packaging budget.
- **Security/compatibility rule:** endpoint discovery ≠ authentication; NAT mapping ≠ external reachability; transport ACK ≠ committed Unity edit; a delta or multicast copy ≠ trusted Project activation.
- **No scope promotion:** existing WP6 pre-wire Component validation is not live Inspector sync; existing r8 release remains physically unverified under its own exact-package test gate. Research ranking does not modify that state.

## Research: additional transport and offline-metadata alternatives (2026-10-14)

**Idea-only candidate comparison; no feature/code/wire-version/dependency change or readiness claim.** Prior research covers ICE/DCUtR, QUIC migration, NORM, FastCDC/VCDIFF/IBLT, MLS and PAKE; this pass examines **compatible WebSocket bootstraps, cooperative immutable-block fetching, compact typed control payloads, optional broker expiry and HTTP compression**. Current Scene edit authority/identity and signed project activation take precedence over protocol performance ([STATUS.md](STATUS.md)).

| New alternative / primary reference | Where it might fit | Cost, security and falsification condition |
| --- | --- | --- |
| **WebSockets over HTTP/2 (RFC 8441) / HTTP/3 (RFC 9220)** — [H2](https://www.rfc-editor.org/rfc/rfc8441.html), [H3](https://www.rfc-editor.org/rfc/rfc9220.html) | WP5 Internet ingress/proxy compatibility while retaining a **WebSocket** application protocol. If a particular reverse proxy/client supports extended CONNECT it may allow realtime edit traffic to coexist with ordinary HTTP requests on an H2/H3 connection. | Not a universal WebSocket upgrade and not automatic WebTransport support. Confirm client, proxy, Node runtime and TLS/auth behavior; compare existing RFC 6455 H1 WebSocket vs H2 vs H3 under proxy failure/reconnect and edit-order/load conditions. Keep H1 fallback; no wire-protocol migration without demonstrable benefit. |
| **IPFS Bitswap 1.2 Have/DontHave/wantlist** — [spec](https://specs.ipfs.tech/bitswap-protocol/) | Phase 3 future **authorized multi-Seed** distribution of immutable signed Project chunks; compare a standard block-request strategy against current direct per-Guest verified transfer and the earlier Merkle/IBLT *inventory* ideas. | Sharing a block is not authorization to reveal private project data. No public DHT, public CIDs or unauthenticated wantlists. Measure 2–4 trusted Guests for missed chunk fetch, redundant bytes, head-of-line, corrupt blocks and Seed departure. Final manifest, .meta/GUID and activation checks always govern. |
| **Zstandard dictionary compression + HTTP Compression Dictionary Transport** — [RFC 8878](https://www.rfc-editor.org/rfc/rfc8878.html), [RFC 9842](https://www.rfc-editor.org/rfc/rfc9842.html), [RFC 9659](https://www.rfc-editor.org/rfc/rfc9659.html) | Phase 3/5 repeated nonsecret project-manifest/status HTTP responses or **future owned** supported serialized metadata. HTTPS dictionary negotiation can reuse unchanged text across versions, without equating this to content-defined file chunks. | RFC 9842 client compatibility varies; HTTP zstd window ≤8 MiB per RFC 9659. Use exact dictionary identity, bounded decode/CPU and final uncompressed content hash; do not compress secret+attacker-controlled content together. Compare plain/gzip/zstd/dictionary against full signed manifest fetch; compressed Unity assets may gain nothing. |
| **CBOR (RFC 8949) typed compact representation** — [RFC](https://www.rfc-editor.org/rfc/rfc8949.html) | WP6 **research alternative** for a tightly allowlisted *future* operation payload, not immediate serialization of arbitrary Unity objects. Compare against the existing JSON envelope for many small predictable property edits. | Typed encoding/unknown-fields/canonical encodings must be versioned and fuzz-tested; it cannot itself authorize the edit or prevent corrupt references. Benchmark compressed JSON vs CBOR and schema-evolution failures first; keep existing v1 wire compatibility and readable diagnostics. |
| **MQTT 5 session expiry / message expiry** — [OASIS standard](https://docs.oasis-open.org/mqtt/mqtt/v5.0/os/mqtt-v5.0-os.html) | **Optional out-of-band async notifications** (missed collaborator activity, invite expiration, deferred non-authoritative events) in a future disconnected-control design, not a replacement for current Scene authority WebSocket. | Requires trusted broker/service, ACLs and resource quotas. QoS delivery is not exactly-once Unity mutation, offline retained events can be stale and revive wrong sessions. Compare current bounded pending-notice/snapshot model versus broker TTL and reconnect on a disposable test cluster before any product decision. |

**Phase-first filter:** if the actual bottleneck is authentication, stale revision, Project GUID integrity, Host availability or field-blocked packaged recovery, protocol substitutions above do not address it. Start with a measured current failure; demand a smaller fixed-baseline alternative and a rollback before promoting any candidate. No network/server/Unity implementation is authorized by this note.

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

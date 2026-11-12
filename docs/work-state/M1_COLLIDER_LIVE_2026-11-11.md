# M1 Collider live collaboration implementation checkpoint

## Approved scope and ownership

Owner-requested implementation of the approved TeamForge long-term roadmap,
starting with continuous BoxCollider / SphereCollider collaboration in saved,
non-Prefab Scenes. Target: Windows LAN, 2–8 collaborators; actual eight-Editor
support requires separate evidence. This is a high-risk authority, protocol,
Unity mutation and recovery change, not a release approval.

Integration owner: Convergence Agent. Branch:
`agent/teamforge/m1-collider-live-20261111`. Starting main:
`9b904ba0e2c532027ea0223c59811f8732baa3ce`.
Reused #529 (`02a973231bd9568deceed587e715f07b99a99e4b`) and its
#513 → #514 → #521–#528 ancestors, plus #520
(`fcdfdd6c06b1c71e3645d5cb5122717da1e0fdc3`); latest #514 merged
without rewriting or editing the original PR branches. Integration checkpoint
before feature edits: `81457f9`.

The hourly TeamForge development automation's latest run was completed before
this implementation began. Its prompt now reserves WP6 authority, protocol,
Unity Component, signed Scene admission, Undo and reconnect for this integration
owner. It remains enabled on its existing schedule and may work on independent
Launcher, Windows validation and field harness surfaces. The GitHub hourly queue
audit remains read only. Neither branch names nor queue comments are treated as
exclusive locks. Recheck live PR files and semantic overlap before publishing.

Delegated writers have disjoint file ownership: server authority/transport;
Unity Connection/Protocol/new ComponentSync; existing Scene witness and tests;
operator configuration. The integration owner handles documentation, validation
and publication. No original PR, CodeRabbit patch, release or shared branch is
being overwritten.

## Intended behavior and invariants

- Signed Project manifest, stored Scene/meta bytes, complete Collider identities
  and allowlisted values establish the initial baseline. Hash the exact bounded
  buffer that is parsed. Verification and admission use the same immutable
  snapshot, including across asynchronous reads.
- The server then owns the runtime Component ledger. Supported properties may
  be edited repeatedly while the Scene is dirty, using the common Session
  revision/history and GameObject lease. Unrelated Transform operations must not
  invalidate a healthy Component ledger.
- Property capability is negotiated separately from future structure support.
  Legacy peers cannot mutate an M1 Scene through an incompatible edit path.
- Exact operation IDs, revision, epoch, current membership and lease protect
  commits. Matching retries return the prior result. A conditional compensation
  operation implements shared Undo/Redo without globally undoing other work.
- Snapshot/reconnect and one in-flight edit converge without silently deleting
  unsent local work. Conflicting local values remain available for explicit
  review/resubmission. Receiver apply reports are distinct from server commit;
  neither establishes that Unity saved the Scene to disk.

## Implementation and evidence plan

Reuse the existing typed identity/property validators, transaction, signed
Project verifier, stored YAML parser and Unity identity/observation gates.
Production continuous editing gets its own narrow subsystem instead of treating
the one-use local test helper as a remote authority API. The Coordinator's
operator-configured Project store supplies source bytes; clients cannot choose
filesystem paths or declare their own trusted baseline.

Automated checks must cover stale revision/epoch/lease, malformed or changed
source snapshots, duplicate operations, wrong Component owner, lost ACK and
post-commit disconnect, late join/reconnect, conditional Undo conflicts, and
unrelated local-field preservation. Run the relevant server/Peer suites,
supported Node 22/24 checks, repository validators and independent boundary
review. Unity EditMode, actual A/B continuous Inspector editing, A/B/C late join,
save/reopen, physical Windows packages and soak have separate evidence states.

On refusal, preserve committed server state and local recovery entries; request
a current snapshot rather than inventing a merge. Server restart still loses
memory-resident state until M4. Opt-in can be disabled without changing signed
Project files. Existing r10 package evidence remains historical; this source
change needs a new artifact before any packaged feature claim.

## Initial verification

- Read AGENTS, ROADMAP, STATUS, work queue and specialist governance/engineering
  guides; inspected all 18 open PRs and WP6 dependency/head/file relationships.
- #513's latest failed Unity lane stopped at license activation (no assigned
  seat); #514's Windows Node 24 failure belongs to the #531/#532 fixture cleanup
  issue. Neither is recorded as an M1 product test failure or success.
- Unity executable, Windows and .NET runtime are absent in this Linux executor.
  Actual Unity/Windows evidence is **NOT RUN** here.
- Feature implementation and automated validation are in progress; no M1
  completion or release claim is made at this checkpoint.

## Next milestones

After M1 implementation and automated validation, prioritize M2 Component
add/remove and stable logical identity, then M3 actual built-in primitives.
M4 durable recovery and M5 Project checkpoint/refresh follow, then M6–M8.
Unity/field evidence remains an explicit gate, and does not justify replacing
the next user feature with repeated refactoring or helper-only tests.

## Implementation checkpoint and writer handoff

Feature source is committed as `94a48d3` (bounded exact-byte witness),
`fbe837e` (real signed-source server admission/continuous operations) and
`35a3e0f` (production Unity subsystem, recovery UI and actual Editor E2E gate).
Subsequent documentation-only commits carry the final readiness/handoff.
The original WP6 PR branches and shared history were preserved. Imported
historical commits were not rewritten to change their trailers; all new local
owner-directed commits passed the identity gate against the exact imported
integration ancestor `81457f9`, with author/committer and Agent trailers checked.

Implemented path: current signed Publisher Scene/meta chunk verification,
complete saved Collider identity/value admission, repeated dirty-Scene
property commits/broadcasts, common revision/lease/history, conditional own
Undo/Redo, source/epoch/digest-checked snapshots, scoped Editor apply/rollback,
latest-local-intent preservation and project-local Library recovery review.
Portable digests use explicit binary32 numeric encoding and bind the original
source pin. They are response consistency checks, not new signatures or disk
save attestations. Unity apply reports remain receiver claims.

Evidence actually obtained on the feature source:

- Node 24.22.1 server **379/379 PASS**, including 12 real M1 WebSocket tests.
- Node 22.23.2 server **379/379 PASS**.
- Node 24 Project Peer **581 PASS / 6 SKIP** (587 discovered entries, including
  the helper module); Node 22 explicit `*.test.mjs` **580 PASS / 6 SKIP** (586
  entries; it excludes that helper-only module). No product test was omitted.
- Existing authority chaos real-server fixture **18 checks PASS** using its
  required 2500 ms lease; an initial run used the normal longer lease and
  timed out awaiting expiry, then was corrected to the existing CI config.
- Workflow regression **36 PASS**; NUnit/evidence-parser negatives **11 PASS**;
  field/handoff harness regression **14 PASS**. These are not physical results.
- Engineering, documentation, public-source (1018 files), memory privacy,
  server syntax and whitespace checks **PASS**.
- C# syntax parser **11 files, zero syntax errors**. This is not semantic
  C#/Unity compilation. Unity compiler/EditMode and actual Unity+Node E2E
  **NOT RUN locally** because the executor has no Unity Editor.
- Node-only execution of the actual new CI fixture exercised signed
  publication, relay, remote commit and origin ACK suppression **PASS**. Smoke
  markers were removed; this is not Unity evidence.
- Independent server and Unity boundary reviews found input/owner, native Undo,
  latest pending-value and partial snapshot issues, which were fixed and
  re-reviewed. The new Unity E2E includes those native Undo and
  A→B→lost-ACK/reconnect scenarios; execution remains pending.

Maintainability warnings were reviewed: this is one cross-runtime M1 feature.
The existing Authority/transport/Connection files gained narrow routing and
capability hooks; production state/apply/recovery ownership lives in the new
Component modules. No unrelated cleanup was added to those large files.

Current bounds: one Scene per Session, 128 retained in-memory Component
Sessions, 512 Colliders / 1536 properties, bounded rolling history and numeric
limits. Owner/ancestor deletion requires M2. Server restart still loses memory
state; Library unconfirmed-value preservation is not M4 durability. Actual
two-Editor/three-Editor, save/reopen execution, eight-Editor soak and a new
Windows package remain **NOT RUN**. M1 is not promoted as a fully verified or
packaged milestone.

After publication of this checkpoint, the implementation writer releases active
editing ownership for the next authorized hourly run. Before continuing,
verify the live branch/PR head, CI, worktree and CodeRabbit/other writer activity.
Use a new branch from the actual M1 PR head for **M2 Box/SphereCollider logical
identity and add/remove**, and keep its single writer explicit. Do not edit or
force-push this M1 branch concurrently. Fix confirmed M1 CI defects first when
within the continuing writer's ownership; a Unity license/field blocker must
not turn the next feature into repeated helper-only maintenance. No merge,
release, protection change or deployment is authorized by this handoff.

## PR #533 CI follow-up — 2026-11-12

The first published head `ad7cedc` exposed a real installation regression:
statically importing the full Project Peer engine required its WebSocket
dependency even for a standalone server with Collider sync disabled. All Unity
lanes stopped at server startup, so **none supplied Unity compilation/EditMode
evidence**. This was not a Unity license failure. Locale source pins and three
committed `.meta` whitespace lines also failed their respective gates.

`82313bc` replaces that dependency with a canonical transport-free approved
publication reader, shared by the Engine and server. It preserves stored
Project identity, Active/published approval, exact descriptor and manifest
validation. It also closes normalized Scene-scope and Hello capability gaps.
A different baseline is explicitly refused while any M1 ledger retains work;
accepted edits are preserved for the future M5 checkpoint/refresh transition.

`3bdfc87` correlates and terminally pauses denied join/snapshot requests, caps
immutable operation sends at three, preserves the newest local value, pauses
before Play Mode and adds 14 Editor lifecycle regression cases. NUnit run
summaries are checked and empty WP6 source sets fail by default; older branches
can explicitly request legacy compatibility. The true Project Peer CI fixture
gets its own locked dependency installation in the Unity lane. Standalone
server CI remains unchanged and must work without Peer dependencies.

`7a33a0d` propagates the M1 delta to 14 additional STATUS translations and
reviews all 15 STATUS source pins. Earlier r9/r10 evidence paragraphs remain
unchanged. This note does not replace the four readiness stages in STATUS.

Checks after these fixes:

- **385/385 server PASS**, Node 24.22.1 in a separate copied source tree with
  only `server/node_modules/ws` and **no** `project-peer/node_modules`; the first
  copy lacked the shared Unity compatibility fixture, which was restored before
  the final full run. The actual production dependency graph remained isolated.
- **385/385 server PASS**, Node 22.23.2; includes **15 actual M1 WebSocket** and
  three transport-free publication-reader cases.
- Full Project Peer on Node 22 and 24: **581 PASS / 6 platform SKIP** each.
- Workflow regression **36 PASS**, evidence-parser regression **12 PASS**,
  locale reviewed-source pins **60 PASS**; public source, documentation,
  engineering and full proposed-patch whitespace checks PASS.
- C# syntax analysis **16 files, zero errors**; actual C#/Unity execution still
  **NOT RUN locally**. The real Node fixture and origin ACK suppression were
  re-exercised, without counting that smoke as Unity evidence.

The old-head Windows Node 22 orphan-cleanup `EBUSY` belongs to #531/#532 and is
recorded separately from M1. Independent hourly PR #535 adds Peer dependencies
to Chaos against the older M1 head; its branch was not overwritten, merged or
closed. Coordination now names this active CI-fix writer and directs M2's
existing separate writer to consume the revised #533 head after checking live
activity. Follow the latest PR head/CI, not the initial failed run or an older
handoff, before advancing or claiming completion.

## Actual Unity CI and admission ordering follow-up — 2026-11-12

The integration writer resumed on the owner's continuing instruction. The
earlier writer handoff above is historical: Convergence Agent currently owns
PR #533's M1 correction work. The hourly agent's separate M2 branch remains
preserved; M2 must consume the corrected integration head before modifying
shared authority/protocol/Unity owners.

Actual Unity 6000.3.21f1 execution is now available from GitHub Actions, despite
the lack of a local Editor. On `d0ba729`, Lock EditMode ran **595 PASS / 0 FAIL /
5 SKIP**. Realtime exposed a native Undo fixture timing issue and incomplete
asynchronous cleanup. `ea02acf` captures a real native Undo before-image after
lock handoff and awaits transport teardown before restoring the Scene/settings.
No existing production assertions or tests were weakened. Realtime run
`43233758887`, job `131235556451`, then ran **596 PASS / 1 FAIL / 3 SKIP**:
native Undo and the previously cascading recovery tests passed. The remaining
failure was a genuine reconnect ordering race: automatic edit-lock acquisition
preceded Collider Scene readmission. This run is **FAIL**, not M1 completion.

`203e314` announces retained M1 Scene requirements in negotiated Hello metadata,
before Connected observers can acquire edit authority. First admission also
notifies compatible existing peers before the origin receives its snapshot.
This metadata grants no write authority and client-spoofed notices are refused.
The Unity follow-up gates only outgoing edits/locks for the waiting Scene,
preserves local deltas and re-arms their observers after successful admission;
authority snapshot receipt remains independent to avoid a bootstrap cycle.
Correlated in-flight Transform/lock refusals preserve the selected local delta,
restore its observation cursor and reacquire authority before resubmission,
instead of becoming a permanent conflict. The new native Undo assertion leaves
the production event subscription intact and checks both historical fields in
the recovery inbox, latest shared fields and absence of extra commits.

The same follow-up retains an explicitly resubmitted recovery/Undo value when
its send loses acknowledgement while the Inspector still shows its unchanged
before-image. A newer local Inspector edit takes precedence. Both in-memory and
Library recovery serialization select the same immutable send-time before-image.

The server's asynchronous signed-source admission now rechecks the bounded
Session capacity after reads complete and immediately before seeding. A real
WebSocket race fixture holds two source reads at capacity minus one; precisely
one new ledger is admitted, without evicting prior accepted edits. Full server
tests: **387 PASS / 0 FAIL on Node 22.23.2 and 24.22.1**, including **17 M1
WebSocket cases**. The previously recorded full Peer results remain unchanged.
Workflow, source, engineering, documentation, locale pin and candidate checks,
plus 12 evidence-parser regressions, pass locally. C# syntax parsing is separate
from actual Unity compilation and does not qualify the new head as verified.

The revised head still needs its own Unity run and exact source-linked E2E
evidence. Physical two/three-Editor Windows LAN, save/reopen, eight-Editor soak
and a new packaged artifact remain **NOT RUN**. Server restart durability is
still M4. No merge, release, deployment or original PR rewrite was performed.

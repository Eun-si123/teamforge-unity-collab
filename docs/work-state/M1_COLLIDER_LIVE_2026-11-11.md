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

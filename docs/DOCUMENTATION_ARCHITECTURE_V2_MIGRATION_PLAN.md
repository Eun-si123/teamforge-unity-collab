# TeamForge Documentation Architecture V2 — Migration Plan

> **Status:** Proposed / design-only  
> **Depends on:** `DOCUMENTATION_ARCHITECTURE_V2_DESIGN.md`  
> **Safety rule:** No existing document should be moved, deleted, or rewritten merely because this plan proposes a target class. Classification must be audited first and migration should happen in separate reviewable changes.

## 1. Migration principle

The migration is **classify → preserve → distill → move → validate → optionally prune**, not “create clean folders and dump files into them.”

The current documentation governance already establishes canonical owners and historical-handling rules. V2 should preserve those strengths and add lifecycle clarity around non-current documents.

## 2. Required audit fields

Before moving an existing document, create one inventory row with:

| Field | Meaning |
| --- | --- |
| Current path | Exact repository path |
| Reader question | What question the file actually answers |
| Current role | How it is currently used |
| Proposed class | canonical / decision / lesson / active-plan / completed-plan / evidence / history / generated / reference |
| Proposed path | Target path if a move is justified |
| Canonical owner | Current source that owns any changing facts repeated here |
| Authority risk | Low / medium / high chance an agent could mistake it for current truth |
| Unique value | Decision, evidence, lesson, chronology, compatibility link, none/unknown |
| Distillation needed | ADR / lesson / evidence extraction / none |
| Link propagation | Known inbound/outbound routes that must be updated |
| Preservation action | keep / move / annotate / compatibility pointer / delete-later candidate |
| Confidence | high / medium / low |
| Open question | Anything that must be resolved manually |

No bulk rename should be approved without this inventory.

## 3. First-pass classification of known current surfaces

These paths should generally remain stable because they already own current questions or important discovery contracts.

| Current path | V2 class | Proposed action |
| --- | --- | --- |
| `README.md` | canonical current / orientation | keep stable |
| `README.ko.md` | canonical current / localized orientation | keep stable |
| `AGENTS.md` | agent routing/safety contract | keep path; possibly shorten only after lifecycle indexes exist |
| `CODEMAP.md` | canonical current / source navigation | keep stable |
| `CHANGELOG.md` | product version history | keep stable |
| `llms.txt` | curated external agent discovery | keep stable; update only after migration paths stabilize |
| `release-contract.json` | machine-readable current release/runtime contract | keep stable |
| `docs/README.md` | documentation router | keep stable |
| `docs/DOCUMENTATION_GUIDE.md` | canonical governance | keep stable; extend after V2 acceptance |
| `docs/ENGINEERING_GUIDE.md` | canonical engineering workflow | keep stable |
| `docs/HOW_IT_WORKS.md` | canonical current conceptual behavior | keep stable |
| `docs/HOW_IT_WORKS.ko.md` | localized canonical conceptual behavior | keep stable |
| `docs/STATUS.md` | canonical current capability/readiness | keep stable |
| `docs/ROADMAP.md` | canonical direction/planning | keep stable |
| `docs/ROADMAP.ko.md` | localized roadmap | keep stable |
| `docs/architecture.md` | canonical current as-built architecture | keep stable |
| `docs/architecture-decisions.md` | decision index / compatibility entry point | keep path during V2; later decide hand-maintained vs generated index |
| `docs/SOURCE.md` | canonical source workflow | keep stable |
| `docs/TEST_LAB.md` | canonical validation-scenario guide | keep stable |
| `docs/compatibility.md` | canonical compatibility reference | keep stable |
| `docs/deployment.md` | canonical deployment how-to | keep stable |
| `docs/known-issues.md` | issue-navigation reference | keep stable |

## 4. Known decision material

Observed decision records include:

- `docs/architecture-decisions.md`;
- `docs/decisions/phase-0.md`;
- `docs/decisions/phase-1.md`;
- `docs/decisions/phase-4.5.md`;
- older decision-like content inside `docs/work-state/DECISIONS.md` and historical session notes.

### Proposed handling

1. Keep `docs/architecture-decisions.md` as the stable decision entry point during migration.
2. Do not rewrite old phase decision bundles into fake “current” documents.
3. Introduce standalone ADRs only for decisions that are still important enough to navigate independently.
4. If a legacy decision bundle moves later, use `docs/decisions/legacy/` and preserve compatibility links where worthwhile.
5. Extract durable decisions hidden in work-state/history only when they have lasting architectural value.
6. Mark supersession explicitly instead of deleting old rationale.

### Candidate future shape

```text
docs/architecture-decisions.md

docs/decisions/
├── README.md
├── adr-0001-...
├── adr-0002-...
└── legacy/
    ├── phase-0.md
    ├── phase-1.md
    └── phase-4.5.md
```

This move is optional; stable paths may be preferable if link cost outweighs directory neatness.

## 5. Known phase material

Observed phase records:

- `docs/phases/phase-0.md`;
- `docs/phases/phase-1.md`;
- `docs/phases/phase-2.md`;
- `docs/phases/phase-3.md`;
- `docs/phases/phase-4.md`.

These are strong candidates for **history**, because the current docs map already treats phase material as historical rather than current truth.

Proposed eventual target:

```text
docs/history/phases/
├── phase-0.md
├── phase-1.md
├── phase-2.md
├── phase-3.md
└── phase-4.md
```

Before moving each file:

- extract any still-important decision into ADR/index form;
- extract any reusable engineering principle into lessons;
- preserve unique test results as evidence if the phase document is the only surviving proof;
- update Pages/history indexes and internal links;
- do not alter the historical narrative merely to modernize terminology.

## 6. Known work-state material

Observed `docs/work-state/` material includes at least:

- `CHANGED_FILES.md`;
- `CURRENT_STATE.md`;
- `DECISIONS.md`;
- `HOTFIX_SESSION.md`;
- `HOTFIX3_SESSION.md`;
- `NEXT_SESSION.md`;
- `PHASE4_SESSION.md`;
- multiple `PHASE4_HOTFIX*_SESSION.md` records;
- takeover/handoff-style notes and other session documents.

### Main risk

Names such as `CURRENT_STATE.md`, `NEXT_SESSION.md`, and `DECISIONS.md` can look highly authoritative when found through code search even though `STATUS.md`, current source/tests, and current decision docs now own those questions.

### Proposed eventual target

```text
docs/history/work-state/
```

### Special handling

#### `docs/work-state/CURRENT_STATE.md`

Preferred options, in order:

1. archive it under history and update inbound links; or
2. if legacy external links are important, replace the old path with a short compatibility pointer stating that current state lives in `docs/STATUS.md`.

Do not maintain two independently editable current-state documents.

#### `docs/work-state/DECISIONS.md`

Audit for durable decisions. Promote only the decisions that remain meaningful; preserve the original file as historical context.

#### `NEXT_SESSION.md`

If it describes an obsolete handoff, archive it. If any still-active work remains, move the live work into an explicit `plans/active/` document rather than reviving the historical session file as current truth.

#### Hotfix/session notes

These are usually history, but they often contain excellent lesson/evidence candidates. Distill before optional pruning.

## 7. Dated root-level docs under `docs/`

Known examples include:

- `docs/MAIN_PATCH_STATUS_2026-08-27.md`;
- `docs/PHYSICAL_FIELD_EVIDENCE_2026-08-30.md`;
- focused dated reports/audits and changed-files records.

### Proposed classification rule

Classify by what the file primarily proves, not by filename alone.

#### Evidence

Move to evidence when the document records a reproducible observation/result:

```text
docs/evidence/field/
docs/evidence/verification/
docs/evidence/regressions/
docs/evidence/releases/
docs/evidence/audits/
```

`PHYSICAL_FIELD_EVIDENCE_2026-08-30.md` is a strong candidate for `evidence/field/`, subject to link audit.

#### History

Use history when the file is primarily a dated narrative/status snapshot and its unique value is chronology rather than proof.

#### Completed plan

Use `plans/completed/` only when the document is actually an execution plan whose structure remains useful after completion.

Do not classify by date alone.

## 8. Audit material

`docs/AI_COMMENT_AUDIT.md` and similar focused audits need semantic review.

Two valid classes exist:

- **evidence/audits** when the result is used as scoped proof of a verified repository property;
- **history/snapshots** when it mainly records what an audit found at a past point and no longer supports a current claim.

A past audit should not silently become a permanent security or quality guarantee.

## 9. Test plans

Example: `docs/LOCALE_PICKER_TEST_PLAN.md`.

Classification depends on execution state:

- still active and needed → `plans/active/` or a test-specific active plan;
- completed and useful for archaeology → `plans/completed/` with result links;
- merely the only record of actual observations → split plan from evidence, preserving the observations under `evidence/`;
- obsolete low-value task note → delete-later candidate only after useful content is distilled.

A plan and its execution evidence should not be conflated.

## 10. Proposed lessons seed set

Do **not** populate these by copying old reports wholesale. Use them as destinations for short, reusable principles extracted during audit.

### `docs/lessons/distributed-state.md`

Potential topics:

- receipt of a request is not proof a mutation completed;
- reconnect must distinguish intent restoration from operation replay;
- operation identity/idempotency must survive ambiguous delivery outcomes;
- partial completion is a first-class state, not an exceptional afterthought.

### `docs/lessons/unity-editor-lifecycle.md`

Potential topics:

- Domain Reload breaks process-local assumptions;
- connection intent and transport instance must be modeled separately;
- Editor compilation/reload can occur between admission, mutation, acknowledgement, and observation;
- Unity-specific lifecycle boundaries require explicit recovery evidence.

### `docs/lessons/filesystem-and-paths.md`

Potential topics:

- managed-root containment must be validated before transfer;
- path traversal/unsafe references should fail closed;
- source path validity does not imply packaged runtime path validity;
- long-path and normalization behavior must be tested across staging/activation boundaries.

### `docs/lessons/networking-and-reconnect.md`

Potential topics:

- port ownership and stale process state should be diagnosed explicitly;
- direct-transfer reachability and realtime coordination reachability are different claims;
- successful fallback does not prove the primary network path is healthy.

### `docs/lessons/security-and-trust.md`

Potential topics:

- retry/fallback should never weaken identity/hash/signature checks;
- source identity, package identity, publisher identity, and active-project identity are distinct contracts;
- diagnostics must not leak secrets or machine-local private paths.

### `docs/lessons/testing-and-evidence.md`

Potential topics:

- same-machine tests cannot be relabeled as physical two-PC evidence;
- a test result proves its exercised contract, not unrelated readiness claims;
- release artifacts must be validated as bytes, not inferred from later source state;
- flaky retry success must preserve the first failure as evidence.

## 11. Active/completed plan distinction from ROADMAP

`ROADMAP.md` should remain the public/current **direction** document.

`plans/active/` should contain implementation-level execution plans that are too detailed or volatile for the roadmap.

Example distinction:

```text
ROADMAP:
Improve Guest bootstrap resilience.

plans/active/wp5-path-resilience.md:
- exact problem
- affected subsystems
- invariants
- implementation slices
- expected tests
- rollout/field gates
- completion criteria
```

When complete, the detailed plan moves to `plans/completed/`; ROADMAP and STATUS are updated only if their owned facts changed.

## 12. Proposed migration batches

### Batch A — indexes and semantics only

No old-file moves.

Add:

- lessons index and lesson template;
- plan lifecycle index;
- evidence index;
- history index clarification;
- ADR status semantics if needed.

Then update documentation governance/agent routing.

### Batch B — obvious history

Candidates:

- `docs/phases/*`;
- clearly obsolete session/handoff notes.

Do not include ambiguous evidence files in the same batch.

### Batch C — obvious evidence

Candidates:

- physical field evidence;
- focused verification reports;
- regression proof;
- release candidate evidence.

Normalize metadata without rewriting original observations.

### Batch D — work-state distillation

Audit `docs/work-state/` one file at a time:

- extract ADRs;
- extract lessons;
- extract unique evidence;
- archive the remainder.

### Batch E — plans

Identify live plans versus completed/obsolete plans and separate them.

### Batch F — discovery cleanup

Only after paths are stable:

- `docs/README.md`;
- `AGENTS.md`;
- `llms.txt` / `llms-full.txt`;
- Pages/history indexes;
- project metadata;
- validators.

### Batch G — optional deletion/collapse

Last step only.

Use Git history as the archive for genuinely redundant low-value working noise **after** decisions, lessons, evidence, and useful chronology have been preserved.

## 13. Validation requirements for every migration batch

At minimum:

1. no broken internal Markdown links;
2. current canonical owner remains unambiguous;
3. no historical file becomes newly exposed as current AI context by accident;
4. no evidence is rewritten into a stronger claim than it originally supported;
5. no active plan is silently archived while work remains open;
6. redirects/pointers exist where stable external paths matter;
7. Pages and `llms.txt` are updated only when their curated surface intentionally changes;
8. `npm run validate:docs` passes after governance-aware changes;
9. ordinary repository validation runs when scripts/generators/Pages metadata change.

## 14. Rollback strategy

Each migration batch should be independently revertible.

Avoid mixing:

- file moves;
- large prose rewrites;
- validator implementation;
- product behavior changes;
- release-state changes

in one migration commit/PR unless there is a strong dependency.

This keeps a documentation reorganization from becoming a hidden engineering change.

## 15. Initial recommendation

Do not start by moving `docs/phases/` or `docs/work-state/` immediately.

The first implementation PR after design approval should create the **classification/index/template infrastructure** and an exhaustive audit inventory. That inventory should then drive subsequent moves.

The most important new V2 capability is not a folder. It is the ability to answer, for every document:

> Is this current truth, a decision, a reusable lesson, an active/completed plan, scoped evidence, or history — and what is allowed to override it?

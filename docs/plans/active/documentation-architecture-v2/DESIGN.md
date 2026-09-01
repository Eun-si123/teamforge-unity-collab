# TeamForge Documentation Architecture V2 — Design Proposal

> **Status:** Proposed / design-only  
> **Authority:** This document is **not** current project truth and does not supersede `docs/README.md`, `docs/DOCUMENTATION_GUIDE.md`, `AGENTS.md`, source, tests, or release contracts.  
> **Branch intent:** Design the documentation lifecycle before moving, deleting, or reclassifying existing files.

## 1. Why this proposal exists

TeamForge already has several strong documentation-governance ideas:

- one changing fact should have one canonical owner;
- current source/tests and current canonical documents outrank historical notes;
- `STATUS.md`, `ROADMAP.md`, `HOW_IT_WORKS.md`, `architecture.md`, `SOURCE.md`, `CODEMAP.md`, release contracts, and evidence have distinct responsibilities;
- historical evidence should be preserved rather than silently rewritten;
- `AGENTS.md`, `docs/README.md`, `llms.txt`, Pages mirrors, and validators provide discovery and routing.

The remaining problem is not simply “too many Markdown files.” The problem is that **different document lifecycles are still physically and semantically mixed**. Root-level dated reports, phase notes, work-state handoffs, design decisions, test evidence, active plans, completed plans, and durable lessons can all be valuable, but they should not look equally authoritative to a human or an agent.

V2 therefore adds an explicit lifecycle model without discarding the current canonical-owner model.

## 2. Design goals

1. Preserve the current canonical URLs and ownership model where they already work.
2. Make “current truth” easy to distinguish from decisions, lessons, plans, evidence, and history.
3. Preserve high-value engineering history without allowing it to override current truth.
4. Extract reusable lessons from incidents, experiments, and completed work instead of forcing agents to rediscover them from old session logs.
5. Keep active working context small and progressively disclose deeper material only when needed.
6. Give humans and coding agents the same routing model.
7. Avoid a big-bang documentation migration.
8. Make future documentation validation mechanically enforceable.
9. Keep release/source packaging behavior understandable: source snapshots may contain extensive docs; user-facing release assets should contain only intentionally packaged material.
10. Minimize duplicated volatile facts.

## 3. Non-goals

This proposal does **not**:

- move existing files yet;
- delete historical records yet;
- rewrite historical evidence to match the present;
- change release readiness or product claims;
- change source architecture;
- require every old decision bundle to be converted to a standalone ADR immediately;
- require versioned copies of every documentation page;
- make `llms.txt` an exhaustive repository inventory;
- make lessons or ADRs more authoritative than current source/contracts.

## 4. Core model: document class and lifecycle are separate from topic

A document should be classified first by **what role it plays**, not only by what subsystem it mentions.

### 4.1 Canonical current documents

These answer questions about the project **now**.

Examples already present:

- `README.md` / `README.ko.md` — project orientation;
- `docs/HOW_IT_WORKS.md` — end-to-end conceptual behavior;
- `docs/STATUS.md` — current capability, blocker, evidence boundary, readiness;
- `release-contract.json` — exact current runtime/protocol/release selections;
- `docs/architecture.md` — current as-built topology and trust boundaries;
- `docs/ROADMAP.md` — future direction;
- `docs/SOURCE.md` — source workflow;
- `CODEMAP.md` — question-to-code navigation;
- `docs/TEST_LAB.md` + `test-lab.json` — validation scenario semantics;
- `docs/ENGINEERING_GUIDE.md` — engineering workflow;
- `docs/DOCUMENTATION_GUIDE.md` — documentation governance.

**V2 recommendation:** keep these stable paths. Do **not** move them into `docs/current/` merely for visual symmetry. Their existing links, Pages routes, agent discovery, translations, and validators are valuable infrastructure.

### 4.2 Decisions

Decisions explain **why a durable choice was made**, what alternatives existed, and what supersedes it.

Decisions are not current implementation references by themselves. A still-active decision must agree with current source/contracts; if the implementation changes, the decision can become partially or fully superseded while remaining historically valuable.

### 4.3 Lessons

Lessons capture **generalized engineering knowledge learned from experience**.

A lesson is not a diary entry and not a design decision. It answers questions such as:

- What failure pattern should we recognize next time?
- What invariant repeatedly prevented damage?
- What did an incident teach us that code alone does not make obvious?
- What rule is likely to remain useful across future phases or subsystems?

Example transformation:

- Evidence/history: “An external local UPM package outside the managed root could not be transferred.”
- Lesson: “Transferable dependencies must be contained by, or explicitly admitted into, the managed transfer root; detect violations before publish rather than failing late during transfer.”

Lessons are advisory engineering knowledge. They **never override** current source, tests, contracts, security policy, or canonical current documentation.

### 4.4 Plans

Plans describe intended work and its execution state.

Two lifecycle states are useful:

- `plans/active/` — work that is actually active or approved to execute;
- `plans/completed/` — plans retained for implementation archaeology after completion.

A plan is not proof that work happened. Completion should point to code/PR/tests/evidence.

### 4.5 Evidence

Evidence records what was actually observed under a particular environment, commit, candidate, or test lane.

Evidence can include:

- automated verification;
- physical field tests;
- regression reproduction and closure evidence;
- release-candidate validation;
- focused audit results.

Evidence is intentionally time-scoped. A PASS proves only the tested claim and environment. Evidence does not automatically imply “supported,” “safe,” or “release ready.”

### 4.6 History

History preserves chronological engineering/repository context that is useful for archaeology but is not a current contract.

Typical material:

- old phase narratives;
- session handoffs;
- hotfix work-state notes;
- dated engineering snapshots;
- old implementation diaries;
- superseded process notes;
- repository milestones.

History is a **low-authority evidence/archaeology surface**, not an unstructured secondary knowledge base.

### 4.7 Generated/reference material

Generated inventories, machine-readable manifests, externally mirrored references, schemas, and other reproducible artifacts should be clearly identified as generated/reference material. They should not be manually edited as if they own product truth when another source generates them.

## 5. Proposed target layout

The target layout intentionally keeps current canonical documents at stable paths and organizes lifecycle-heavy material underneath them.

```text
AGENTS.md
CODEMAP.md
README.md
README.ko.md
CHANGELOG.md
llms.txt
release-contract.json

/docs
├── README.md                         # human/agent documentation router
├── DOCUMENTATION_GUIDE.md            # governance
├── ENGINEERING_GUIDE.md              # engineering workflow
├── HOW_IT_WORKS.md                   # current conceptual behavior
├── HOW_IT_WORKS.ko.md
├── STATUS.md                         # current capability/readiness
├── ROADMAP.md                        # direction, not implementation truth
├── ROADMAP.ko.md
├── SOURCE.md
├── TEST_LAB.md
├── architecture.md                   # current as-built architecture
├── architecture-decisions.md         # decision index / compatibility entry point
├── compatibility.md
├── deployment.md
├── known-issues.md
│
├── decisions/
│   ├── README.md                     # ADR index + status semantics
│   ├── legacy/                       # optional later home for old phase bundles
│   └── adr-XXXX-short-name.md        # new durable decisions
│
├── lessons/
│   ├── README.md                     # scope, promotion rules, index
│   ├── distributed-state.md
│   ├── unity-editor-lifecycle.md
│   ├── filesystem-and-paths.md
│   ├── networking-and-reconnect.md
│   ├── security-and-trust.md
│   └── testing-and-evidence.md
│
├── plans/
│   ├── active/
│   └── completed/
│
├── evidence/
│   ├── field/
│   ├── verification/
│   ├── regressions/
│   ├── releases/
│   └── audits/
│
├── history/
│   ├── DEVELOPMENT_HISTORY.md
│   ├── phases/
│   ├── work-state/
│   └── snapshots/
│
├── generated/
├── references/
└── templates/
```

This is a **target model**, not a required one-commit rename plan.

## 6. Why there is no `docs/current/`

A `current/` directory is attractive because it looks clean, but TeamForge already has durable current-document paths referenced by:

- root README navigation;
- paired-language pages;
- `AGENTS.md`;
- `docs/README.md`;
- `llms.txt` and `llms-full.txt`;
- GitHub Pages routes and project metadata;
- validators;
- external links.

Moving all canonical documents would create a large propagation surface while adding little semantic value. V2 therefore makes “current” a **role defined by the documentation map and governance**, while subdirectories carry the lifecycle labels for non-current material.

## 7. Authority model: resolve by question, not by one global ranking

A single numeric ranking is useful but insufficient because different sources own different questions. V2 should route by reader question first.

| Reader/agent question | Primary authority | Supporting material |
| --- | --- | --- |
| What does the source implement now? | current source + tests | `STATUS.md`, architecture, module docs |
| What is currently supported/blocked/release-ready? | `STATUS.md` | issues, current evidence |
| What exact runtime/protocol/candidate identity is current? | `release-contract.json` | STATUS / builds metadata |
| What exact packaged bytes were published? | GitHub Release filename + SHA-256 / `builds/README.md` | release evidence |
| How does the product work end to end? | `HOW_IT_WORKS.md` | architecture / CODEMAP |
| What is the current topology/trust boundary? | `architecture.md` | source / active ADRs |
| Why was this durable choice made? | non-superseded ADR | architecture / evidence |
| What engineering pitfall should I avoid? | `lessons/` | linked evidence / ADR / source |
| What are we actively implementing? | `plans/active/` | roadmap / issue / PR |
| What was implemented according to an old plan? | code/PR/tests first | `plans/completed/` |
| Was this exact behavior tested in this environment? | matching evidence record | STATUS if current claim changed |
| What happened during an old phase/session? | `history/` | old evidence / completed plan |
| What is planned later? | `ROADMAP.md` | issues/discussions/research notes |

### 7.1 Conflict rule

When documents disagree:

1. identify the question type;
2. use the canonical owner for that type;
3. verify against source/tests/contracts where applicable;
4. treat decisions, lessons, evidence, plans, and history according to their declared role;
5. do not “average” contradictory documents into a synthetic answer.

## 8. Decision lifecycle

New standalone ADRs should use explicit status values:

- `proposed`;
- `accepted`;
- `partially-superseded`;
- `superseded`;
- `rejected`;
- `deprecated` when useful for a still-visible but discouraged choice.

Each ADR should include:

- ID and title;
- status;
- date accepted/changed;
- scope;
- context/problem;
- decision;
- alternatives considered;
- consequences/trade-offs;
- invariants affected;
- evidence or implementation links when available;
- supersedes / superseded-by links;
- current canonical references.

Old phase decision bundles do not need immediate conversion. They can remain legacy records until a migration pass determines whether individual decisions deserve standalone ADRs.

## 9. Lesson lifecycle

### 9.1 Promotion criteria

Promote knowledge into `docs/lessons/` when most of the following are true:

1. **Repeat value:** future work could plausibly encounter the same class of problem.
2. **Generalizable:** the useful idea is broader than one date, PR, or incident.
3. **Non-obvious:** source code alone does not communicate the reasoning well.
4. **Risk reduction:** remembering it can prevent a bug, unsafe change, false claim, or expensive debugging cycle.
5. **Evidence-backed:** there is at least one incident, test, ADR, source invariant, or field result supporting it.
6. **Durable enough:** it is unlikely to become stale because of a trivial file rename or version bump.

Do **not** promote:

- raw logs;
- one-off command transcripts;
- volatile version numbers;
- temporary branch state;
- facts already owned by current canonical docs;
- speculative advice without evidence;
- a whole incident narrative when one generalized sentence is the durable value.

### 9.2 Lesson format

A lesson should be short and structured:

```md
# Managed-root containment must be checked before publish

> Class: Lesson
> Scope: Project transfer / filesystem safety
> Status: Active

## Lesson
...

## Why it matters
...

## When to apply it
...

## When not to apply it
...

## Evidence and origin
- field/test/incident link
- ADR/source link

## Supersession
None.
```

### 9.3 Lesson status

Lessons can be:

- `active`;
- `partially-superseded`;
- `superseded`.

A superseded lesson should normally remain visible with the replacement linked. This preserves the reasoning trail without letting old guidance masquerade as current advice.

## 10. Plan lifecycle

### 10.1 Active plan

An active plan should state:

- intended outcome;
- scope and non-goals;
- affected subsystems;
- risk/invariants;
- required evidence;
- expected source/docs/release impact;
- open questions;
- completion criteria;
- links to issues/PRs when they exist.

### 10.2 Completion

When a plan completes:

1. update current canonical owners if the product truth changed;
2. record actual evidence;
3. extract any durable lessons;
4. record durable decisions as ADRs when warranted;
5. move the plan to `plans/completed/`;
6. add completion links to commits/PRs/evidence;
7. remove it from active-agent routing.

A completed plan remains an implementation-history artifact, not current truth.

### 10.3 Abandoned plans

Do not silently delete a substantial abandoned plan if it explains a meaningful rejected direction. Mark it cancelled/rejected and either place it with completed plans or convert the durable rationale into an ADR, then keep only the amount of plan history that has archaeology value.

## 11. Evidence lifecycle and semantics

Evidence records should be easy to evaluate without reading surrounding chat/session history.

Recommended metadata:

- class (`field`, `verification`, `regression`, `release`, `audit`);
- date/time;
- source commit;
- candidate/release identity when applicable;
- environment (OS, Unity version, topology, physical-vs-same-machine boundary);
- test/scenario name;
- expected outcome;
- observed outcome;
- result: `PASS`, `FAIL`, or `INCOMPLETE`;
- artifacts/log references;
- limitations;
- whether the result changed a current STATUS claim.

### 11.1 Evidence immutability rule

Historical evidence should normally be **append-only or annotation-only** after capture. If an old conclusion is later understood differently, add a correction/supersession note rather than rewriting the original observation into a cleaner story.

### 11.2 Evidence is scoped proof

Examples:

- same-machine E2E is not physical two-PC evidence;
- a retry succeeding does not prove the first failure was harmless;
- one field PASS does not establish broad compatibility;
- source tests passing do not identify the bytes inside an older published ZIP;
- a packaged candidate does not inherit behavior from later `main` commits.

## 12. History policy: preserve, distill, then optionally prune

V2 combines two useful philosophies:

1. **Preserve valuable history** for debugging and design archaeology.
2. **Do not keep noise forever merely because it existed.** Git already preserves exact historical file content.

Therefore use a **distillation-first cleanup rule**:

Before deleting or heavily collapsing an old note, ask:

- Does it contain a durable decision? → promote/link an ADR.
- Does it contain a reusable lesson? → promote a lesson.
- Does it contain unique test/field proof? → preserve as evidence.
- Does it explain a significant historical milestone? → preserve in history.
- Is it redundant raw working noise after the useful content has been promoted and Git history retains the original? → deletion/collapse can be considered in a later cleanup PR.

No deletion should happen in the initial V2 migration merely to make directory counts smaller.

## 13. Discovery and progressive disclosure

### 13.1 `AGENTS.md`

`AGENTS.md` should be a **small routing and safety contract**, not the complete project encyclopedia.

It should tell an agent:

- where current truth lives;
- what must be read before high-risk changes;
- how documentation classes differ;
- that history/completed plans are non-authoritative;
- when lessons and ADRs are relevant;
- which validators/tests to run.

Nested `AGENTS.md` files should be added only when a subsystem genuinely needs local rules that would otherwise pollute the global instructions.

### 13.2 `docs/README.md`

This remains the primary human/contributor documentation router. It should expose current canonical docs first, then lifecycle collections.

### 13.3 `llms.txt`

`llms.txt` remains a curated **external AI discovery index**, not an exhaustive file list.

Recommended exposure:

- current canonical docs: yes;
- key engineering guides: yes;
- active ADR index: yes when useful;
- lessons index: yes when stable enough;
- active plans: usually not public discovery unless intentionally useful;
- completed plans: no by default;
- raw evidence/history/work-state: no by default;
- exhaustive inventory: repository manifest instead.

### 13.4 `llms-full.txt`

A “full” context should still be **curated current context**, not literal concatenation of every `.md` file. Raw work-state/history can lower retrieval precision and cause stale claims to compete with current truth.

## 14. Naming rules

Use names that reveal role and remain stable.

### Current canonical documents

Prefer stable semantic names:

- `STATUS.md`;
- `ROADMAP.md`;
- `HOW_IT_WORKS.md`;
- `architecture.md`.

Avoid `FINAL_STATUS_V2_NEW.md`-style names.

### Evidence/history

Dated names are appropriate when date is part of identity:

- `2026-08-30-two-pc-path-resilience.md`;
- `2026-08-27-main-patch-verification.md`.

### ADRs

Prefer stable IDs:

- `adr-0001-managed-project-activation.md`.

### Lessons

Prefer topic/claim names rather than dates:

- `filesystem-and-paths.md`;
- `distributed-state.md`.

### Plans

Prefer work identity:

- `wp5-path-resilience.md`;
- `launcher-trust-ux.md`.

The folder already communicates active/completed state, so filenames do not need `FINAL` or `DONE` suffixes.

## 15. Release and versioning policy

### 15.1 Source archives

GitHub-generated source archives are repository snapshots. Extensive developer documentation inside them is normal and does not imply that every document is user-facing runtime material.

### 15.2 Custom release assets

Custom TeamForge release ZIPs should include only files intentionally required for the packaged experience, diagnostics, licenses/notices, and any selected user-facing docs. They should not accidentally bundle the entire engineering-history tree merely because it exists in the source repository.

### 15.3 Versioned docs

Do **not** create a duplicated `versioned_docs/<every-release>/` tree by default.

Use Git tags/releases as immutable historical snapshots. Add parallel versioned user documentation only if TeamForge eventually supports multiple materially different product lines at the same time and users genuinely need version-specific instructions.

## 16. Proposed machine-enforceable invariants

These are design targets for later validator work, not requirements implemented by this proposal.

1. Current canonical docs referenced by `docs/README.md` must exist.
2. `llms.txt` must not accidentally route raw `work-state/` or completed-plan files as current truth.
3. Historical/evidence documents should carry a visible class/status marker or live under an unambiguous lifecycle directory.
4. Active plans and completed plans must not share the same path.
5. New ADR IDs must be unique.
6. Superseded ADRs/lessons should link a replacement when one exists.
7. Evidence claiming a source/candidate identity should include a commit or release identifier when practical.
8. Canonical-document moves require an explicit propagation review.
9. New current canonical documents must be intentionally classified as discovery class A/B/C under the existing documentation guide model.
10. Generated artifacts must declare their generator/owner where practical.

## 17. Migration strategy

V2 should be introduced incrementally.

### Stage 0 — design only

- agree on lifecycle model;
- agree on naming and authority semantics;
- inventory conflicts/duplicates;
- make no bulk moves.

### Stage 1 — add lifecycle indexes/templates

- create `lessons/README.md`;
- create `plans/active/` and `plans/completed/` indexes;
- create evidence/history indexes as needed;
- define ADR and lesson status semantics;
- update documentation governance only after design acceptance.

### Stage 2 — classify existing documents

Create a migration inventory with one row per candidate file:

- current path;
- current role;
- proposed class;
- proposed path;
- canonical owner if it duplicates a changing fact;
- preserve/move/distill/delete-later decision;
- links that would need propagation;
- confidence/open question.

Do not move ambiguous files until their role is resolved.

### Stage 3 — low-risk moves

Start with clearly historical/evidence material whose role is already explicit. Preserve Git history where practical and update internal links/indexes.

### Stage 4 — extract lessons and normalize decisions

Read high-value incidents, hotfix sessions, phase reports, and field evidence. Promote only reusable knowledge. Do not copy entire reports into lessons.

### Stage 5 — plan lifecycle

Move genuinely active execution plans into `plans/active/`, close completed plans into `plans/completed/`, and remove completed plans from current-agent routing.

### Stage 6 — discovery/agent update

After paths stabilize:

- tighten `AGENTS.md` routing;
- update `docs/README.md`;
- curate `llms.txt` / `llms-full.txt`;
- update Pages/project metadata;
- add/extend validators.

### Stage 7 — optional cleanup

Only after useful knowledge has been promoted and references are safe:

- collapse duplicate old snapshots;
- delete low-value working noise when Git history is sufficient;
- keep unique decisions/evidence/history.

## 18. Migration acceptance criteria

The V2 migration should not be considered complete merely because directories look tidy.

Success means:

- an agent can answer “what is true now?” without reading old work-state notes;
- a maintainer can find why a design choice exists;
- recurring pitfalls are captured as lessons rather than buried in chat/session logs;
- field/test proof is independently discoverable as evidence;
- active work is distinguishable from completed work;
- old phase/session records remain available for archaeology but do not compete with current truth;
- current canonical links remain stable or are intentionally redirected;
- `llms.txt` remains curated rather than exhaustive;
- release assets remain intentionally packaged;
- validators can detect major documentation-governance regressions.

## 19. Open design questions

These should be resolved before migration begins:

1. Should legacy `docs/decisions/phase-*.md` remain in place indefinitely, or later move under `decisions/legacy/`?
2. Should `architecture-decisions.md` remain a hand-maintained index or become generated from standalone ADR metadata?
3. Should lessons be topic compendia (`filesystem-and-paths.md`) or one lesson per file? A hybrid may be best: one-file-per-major-lesson once a topic page becomes too large.
4. Which dated root-level docs are evidence versus history versus completed plans?
5. Should `docs/work-state/CURRENT_STATE.md` remain as a compatibility pointer, or be archived once all inbound links route to `STATUS.md`?
6. Which evidence metadata can be validated automatically without making historical records burdensome to maintain?
7. How much of `AGENTS.md` can be shortened after the docs router and lifecycle indexes become strong enough?

## 20. Recommended decision

Adopt the V2 model **without a big-bang move**:

- keep current canonical documents at stable paths;
- add explicit lifecycle collections for decisions, lessons, plans, evidence, and history;
- preserve useful history;
- distill reusable lessons before pruning noise;
- keep agents on progressive disclosure;
- migrate in small, reviewable stages with validators and link checks.

This retains the best part of TeamForge's existing documentation governance while adding the missing lifecycle boundaries needed for a long-lived, agent-heavy engineering project.

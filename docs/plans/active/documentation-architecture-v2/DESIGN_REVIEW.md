# TeamForge Documentation Architecture V2 — Design Review

> **Status:** Proposed / design-review resolution  
> **Scope:** Design only. No existing documentation is moved, deleted, reclassified, or made authoritative by this file.  
> **Branch:** `docs/documentation-architecture-v2-design`  
> **Relationship:** This review tightens `DOCUMENTATION_ARCHITECTURE_V2_DESIGN.md` and `DOCUMENTATION_ARCHITECTURE_V2_MIGRATION_PLAN.md`. Where this review explicitly resolves an open design question, treat the resolution as the preferred V2 direction for the remainder of the design branch.

## 1. Review outcome

The V2 direction is sound, but the first proposal can be simplified before any migration begins.

Keep the existing strengths:

- current canonical documents remain at stable paths;
- one changing fact has one canonical owner;
- history is preserved without becoming current truth;
- decisions, evidence, plans and lessons have distinct roles;
- agents use progressive disclosure rather than loading every document;
- migration is incremental and reversible.

Tighten the design in five places:

1. make lessons atomic instead of growing a few large topic compendia;
2. do not create lifecycle directories that have no immediate use;
3. give active plans an explicit stale/paused/cancelled lifecycle;
4. make metadata requirements strict for new records but grandfather historical records;
5. make agent discovery intentionally asymmetric: current material is easy to reach, historical material is available but not preloaded.

## 2. Simplified target architecture

The initial V2 target should focus on five lifecycle collections only.

```text
AGENTS.md
CODEMAP.md
README.md
README.ko.md
CHANGELOG.md
llms.txt
release-contract.json

/docs
├── README.md
├── DOCUMENTATION_GUIDE.md
├── ENGINEERING_GUIDE.md
├── HOW_IT_WORKS.md
├── HOW_IT_WORKS.ko.md
├── STATUS.md
├── ROADMAP.md
├── ROADMAP.ko.md
├── SOURCE.md
├── TEST_LAB.md
├── architecture.md
├── architecture-decisions.md
├── compatibility.md
├── deployment.md
├── known-issues.md
│
├── decisions/
├── lessons/
├── plans/
├── evidence/
├── history/
└── templates/
```

`generated/` and `references/` are **reserved concepts, not Stage-1 directories**. Create them only when an actual document has a clear need for those classes.

This avoids replacing one clutter problem with a large taxonomy full of empty or ambiguous folders.

## 3. Resolved design question: lesson storage

### Decision

Use **one durable lesson per file**, with `docs/lessons/README.md` as the topic/index layer.

Prefer:

```text
docs/lessons/
├── README.md
├── L-0001-request-receipt-is-not-mutation-completion.md
├── L-0002-managed-root-containment-before-publish.md
├── L-0003-source-state-is-not-packaged-byte-state.md
└── L-0004-domain-reload-breaks-process-local-assumptions.md
```

Do not start with large mutable compendia such as:

```text
filesystem-and-paths.md
networking-and-reconnect.md
distributed-state.md
```

Those topic names are useful as **index headings/tags**, but a few giant files would eventually recreate the same mixed-lifecycle problem V2 is trying to solve.

### Why atomic lessons are better

- supersession applies to one lesson rather than a whole topic document;
- evidence links are precise;
- agents can retrieve only the relevant lesson;
- concurrent edits are less likely to conflict;
- one stale lesson does not make an entire topic page suspect;
- promotion from an incident is explicit and reviewable;
- lessons can be retired without rewriting unrelated guidance.

### Lesson ID

Use stable IDs:

```text
L-0001
L-0002
L-0003
```

IDs are repository-global within `docs/lessons/`.

Do not encode Phase, date, or subsystem into the ID. Those can change while the lesson identity should remain stable.

### Lesson metadata

New lessons should include a small visible header:

```md
# Request receipt is not mutation completion

> ID: L-0001
> Class: Lesson
> Status: Active
> Topics: distributed-state, recovery, reconnect

## Lesson
...

## Applies when
...

## Does not imply
...

## Evidence and origin
...

## Supersession
- Supersedes: none
- Superseded by: none
```

Avoid large YAML metadata schemas unless there is a concrete automation need later. Simple Markdown remains easy for humans, agents, GitHub rendering and lightweight validators.

## 4. Lesson promotion rule

A lesson should be created only when the extracted statement is more valuable than simply linking the original incident.

Use this test:

```text
Past incident/test/decision
        │
        ├─ unique observation? ───────────→ Evidence
        │
        ├─ durable choice/rationale? ─────→ ADR / Decision
        │
        ├─ chronological context? ────────→ History
        │
        └─ reusable general principle? ───→ Lesson
```

A single source record may produce more than one downstream artifact, but each artifact must keep its own role.

Example:

```text
Historical event:
external local UPM dependency was outside the managed transfer root

Evidence:
exact failure, environment and observed error

Lesson L-xxxx:
validate transferable dependency containment before publish

Possible ADR:
fail closed at admission rather than silently rewriting unsafe references
```

Do not copy the full incident into the lesson.

## 5. Resolved design question: decisions

### Decision

Keep `docs/architecture-decisions.md` as the stable human/agent decision entry point for V2.

Do **not** generate it from metadata yet.

Reasons:

- the existing decision system already contains phase bundles and supersession explanations;
- generation would add tooling before the document model is stable;
- a hand-maintained index can express partial supersession and current canonical links more clearly during migration.

New important decisions may use standalone ADRs under `docs/decisions/` with the existing ADR template.

Legacy `docs/decisions/phase-*.md` stay at their current paths during the initial migration. Moving them to `decisions/legacy/` is optional and should occur only if a later link audit shows a real benefit.

Directory neatness alone is not enough reason to move them.

## 6. Resolved design question: plan lifecycle

Two folders are still enough:

```text
docs/plans/active/
docs/plans/completed/
```

But folder state alone is not enough.

New active-plan documents should declare one of:

- `Proposed` — concrete plan exists but execution has not started;
- `Active` — currently being executed;
- `Paused` — intentionally stopped but expected to resume.

Completed-side documents should declare one of:

- `Completed` — intended completion criteria were reached;
- `Cancelled` — work was intentionally abandoned;
- `Superseded` — another plan replaced it.

A plan must never be used as evidence that implementation happened.

### Active-plan freshness

Every new active plan should include:

```text
Status
Last reviewed
Tracking issue/PR when one exists
Completion criteria
```

Do not make age alone a hard failure. A long-running plan can be valid. Instead, future tooling may warn when an `Active` or `Proposed` plan has not been reviewed for a long period.

The important invariant is that stale plans must not silently remain in high-priority agent routing forever.

## 7. ROADMAP versus active plans

Keep the distinction strict:

```text
ROADMAP.md
= direction / priority / public intent

plans/active/*
= execution detail for a concrete body of work

GitHub Issue / PR
= live discussion and implementation tracking

STATUS.md
= what exists / what is blocked / what evidence supports current readiness
```

An active plan should normally link an Issue or PR rather than duplicate its live comment history.

## 8. Resolved design question: evidence metadata

### New evidence

New V2 evidence records should use a minimal common header when the fields apply:

```text
Class
Date
Source commit
Candidate/release identity (if applicable)
Environment/topology
Scenario/test
Result: PASS / FAIL / INCOMPLETE
Limitations
```

### Historical evidence

Do **not** require old evidence to be rewritten into the new metadata format merely to pass validation.

Historical material is grandfathered.

If an old record is moved into `docs/evidence/`, either:

1. preserve it byte-for-byte and add classification in an index; or
2. add a clearly marked annotation header without rewriting the original observation.

This avoids falsifying history in the name of consistency.

## 9. Evidence directory policy

Do not require every evidence subtype directory on day one.

Create subdirectories only when real files are being migrated.

Likely first categories:

```text
docs/evidence/field/
docs/evidence/verification/
```

Add `regressions/`, `releases/`, `audits/`, or others when the inventory proves they improve navigation.

Classification should follow the question the evidence answers, not the name of the test tool that created it.

## 10. History policy

`docs/history/` is not a dumping ground.

History should retain records with at least one of these values:

- meaningful chronology;
- design archaeology;
- debugging archaeology;
- contextual explanation for a later decision/lesson/evidence record;
- compatibility value for old links.

Raw working notes with no remaining unique value may eventually be removed **after distillation** because Git history already preserves the exact old bytes.

The cleanup rule remains:

```text
preserve → distill → classify → move/annotate → validate → optionally prune
```

## 11. `work-state/` handling

`docs/work-state/` should be treated as a migration source, not a permanent second current-state system.

### `CURRENT_STATE.md`

Preferred final state:

- archive under history when safe;
- keep a short compatibility pointer at the old path only if inbound links justify it.

The compatibility pointer, if retained, must route readers to `docs/STATUS.md` and must not grow back into a state database.

### `DECISIONS.md`

Extract durable decisions into the decision system where warranted. Preserve the old file as history until that audit is complete.

### `NEXT_SESSION.md` and session/hotfix notes

Classify as history unless they contain still-live work. Live work belongs in a concrete active plan or GitHub Issue, not in a historical session handoff filename.

## 12. Agent discovery model

Discovery should be intentionally asymmetric.

### Always easy to find

- current canonical docs;
- engineering/documentation guides;
- current architecture;
- decision index;
- lessons index.

### Available when relevant, but not preloaded

- individual lessons;
- active plans;
- matching evidence;
- matching ADRs.

### Archaeology-only by default

- completed plans;
- old phase notes;
- raw work-state/session notes;
- superseded historical snapshots.

This asymmetry is a feature, not a limitation. The repository can preserve extensive history without making every historical token compete with current truth.

## 13. `AGENTS.md` policy

Do not shorten `AGENTS.md` during the first migration stages.

The existing file already protects important TeamForge invariants, validation requirements and canonical ownership rules.

Only consider shortening it after:

1. lifecycle indexes exist;
2. routing is tested against realistic agent tasks;
3. `docs/README.md` and validators enforce the new model;
4. no critical safety/validation instruction would become retrieval-dependent.

A short `AGENTS.md` is a means, not a goal.

Nested `AGENTS.md` files remain optional and should exist only where a subsystem has genuinely local rules.

## 14. `llms.txt` policy

Keep `llms.txt` curated.

V2 should normally expose:

- current canonical docs;
- engineering/documentation guides;
- architecture;
- decision index;
- lessons index once populated and stable.

Do not enumerate every lesson, evidence file, plan or historical note.

The lesson index can route an AI to individual lessons when a topic is relevant.

`llms-full.txt` should remain a curated expanded current context, not a concatenation of repository Markdown.

## 15. Translation policy

Do not automatically translate lifecycle/history material.

Maintain paired translations where TeamForge already treats a document as user-facing/current, such as README, HOW_IT_WORKS, STATUS and ROADMAP.

Decisions, lessons, plans, evidence and history are maintainer/engineering material by default and should have one canonical language unless a real user/contributor need justifies a translation.

This avoids doubling drift-prone documents solely for symmetry.

## 16. Metadata philosophy

V2 should not create a second database describing every Markdown file.

Prefer this order of classification signals:

1. stable canonical path or lifecycle directory;
2. visible document header for records that need status/identity;
3. lifecycle index;
4. machine-readable registry only if future automation demonstrates a concrete need.

Do not create a global `document-lifecycle.json` in Stage 1. It would duplicate information already visible in paths and headers and could become another source of drift.

The migration inventory is temporary planning material, not a permanent source of truth.

## 17. One document, one primary class

Every lifecycle document should have one **primary** class.

A field-test report may contain useful history and produce a lesson, but its primary class is Evidence.

A completed execution plan may explain history, but its primary class is Completed Plan.

A decision may cite tests, but its primary class is Decision.

Cross-class value should be expressed with links, not by making one document pretend to own several roles.

This rule improves retrieval precision and makes future validation realistic.

## 18. Naming convention

### Canonical current files

Keep existing stable names and casing.

### New lessons

```text
L-0001-short-claim.md
```

### New ADRs

Follow the existing ADR naming/ID convention rather than inventing a second competing decision ID system.

### Evidence

Prefer ISO date first when the date is part of the record identity:

```text
2026-08-30-two-pc-path-resilience.md
```

### Plans

Use durable work identity, without `FINAL`, `NEW`, or `DONE` suffixes.

Folder and metadata carry lifecycle state.

## 19. Validator strategy

The existing documentation validator already protects current canonical paths, ownership separation, Pages discovery, `llms.txt` routing and local Markdown links.

V2 should extend that validator incrementally rather than replace it.

### Stage-1 validator additions

Only after lifecycle infrastructure exists:

- `docs/lessons/README.md` exists;
- lesson IDs are unique;
- new lesson files contain ID/Class/Status fields;
- active/completed plan paths do not overlap;
- current discovery surfaces do not directly route raw history/work-state as current truth;
- new standalone ADR identifiers do not collide;
- canonical current paths remain unchanged unless a deliberate propagation review accompanies the change.

### Later validator additions

After real migration experience:

- warnings for stale active plans;
- replacement links for superseded lessons/ADRs;
- evidence metadata checks for newly created records;
- detection of historical filenames that accidentally appear in curated current context.

Do not make old historical files fail CI because they predate V2.

## 20. Resolved open questions

The initial proposal listed several design questions. Resolve them as follows for the next design iteration.

1. **Legacy `docs/decisions/phase-*.md`:** keep in place initially. Reconsider moves only after link/inventory audit.
2. **`architecture-decisions.md`:** keep hand-maintained in V2; no generator yet.
3. **Lessons:** one durable lesson per file, stable `L-NNNN` ID, topic grouping in `lessons/README.md`.
4. **Dated root-level docs:** classify one by one from the migration inventory; do not infer class from date/name alone.
5. **`work-state/CURRENT_STATE.md`:** archive when safe; compatibility pointer only if inbound-link value justifies it.
6. **Evidence metadata:** required for new V2 evidence where applicable; historical records grandfathered.
7. **`AGENTS.md` shortening:** defer until lifecycle routing exists and has been tested.

## 21. Still-open questions

These require the actual inventory rather than more abstract design:

1. Which existing dated reports contain unique evidence versus only chronology?
2. Which work-state documents contain durable decisions or lessons worth promoting?
3. Which old paths have enough inbound links to justify compatibility pointers?
4. Which evidence subdirectories are actually needed after classification?
5. Which active pieces of work still deserve plan documents instead of only GitHub Issues/PRs?

These questions should be answered by the audit, not guessed from filenames.

## 22. Recommended next step

Do **not** migrate files yet.

The next design-phase artifact should be an exhaustive, read-only classification inventory of candidate documentation with:

- current path;
- primary reader question;
- proposed primary class;
- authority risk;
- unique value;
- distillation candidates;
- inbound-link/compatibility risk;
- proposed action;
- confidence.

Once that inventory exists, the V2 design can be consolidated into a final proposal before any actual move/delete PR is created.

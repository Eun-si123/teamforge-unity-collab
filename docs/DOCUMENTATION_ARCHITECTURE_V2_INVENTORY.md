# TeamForge Documentation Architecture V2 — Read-only Inventory

> **Status:** Proposed / audit-only  
> **Snapshot:** `main` at `a97b6ba5649e2888b909bf3c99c64acfd7042ba6`  
> **Branch:** `docs/documentation-architecture-v2-design`  
> **Safety rule:** This inventory does **not** move, delete, rewrite, reclassify in-place, or change the authority of any existing document. It records the proposed treatment to drive later reviewable migration changes.

## 1. Purpose

This inventory applies the V2 design to the documentation that currently exists in TeamForge.

The goal is not to make the tree look tidy. The goal is to identify:

- which documents already own current truth and should stay stable;
- which files are durable decisions;
- which files are scoped evidence;
- which files are implementation/test plans or procedures;
- which files are historical engineering records;
- which old files have names that can mislead humans or agents into treating them as current;
- which records contain reusable lessons or decisions worth distilling before any optional pruning.

Classification follows document **meaning**, not filename alone.

## 2. Classification legend

| Code | Class | Meaning |
| --- | --- | --- |
| `C` | Current canonical | Owns a current question and should normally remain at its stable path |
| `R` | Current reference/policy | Current contributor/user reference, but not the owner of all project state |
| `P` | Compatibility pointer | Stable legacy path that redirects readers to current canonical owners |
| `D` | Decision | Durable rationale / ADR material |
| `E` | Evidence | Time-scoped observed result, test, field run, validation, or audit |
| `A` | Active plan/procedure | Current intended work or maintained verification procedure |
| `CP` | Completed plan/procedure | Historical plan/checklist retained for implementation archaeology |
| `H` | History | Chronological engineering/session/repository record; not current truth |
| `M` | Mixed | Contains more than one lifecycle role and should be distilled before migration |
| `X` | Delete-later candidate | Likely redundant after useful content and links are preserved; never delete in the first migration pass |
| `?` | Needs semantic review | Filename/path is insufficient for a safe decision |

Confidence is `high`, `medium`, or `low`.

## 3. Current canonical and current reference surfaces — keep stable

These paths already participate in current navigation, agent routing, Pages/discovery, validation, translations, or canonical ownership. V2 should not move them merely for directory symmetry.

| Path | Class | Confidence | Proposed treatment |
| --- | --- | --- | --- |
| `docs/README.md` | C | high | Keep. Primary documentation router. |
| `docs/DOCUMENTATION_GUIDE.md` | C | high | Keep. Documentation governance owner. |
| `docs/ENGINEERING_GUIDE.md` | C | high | Keep. Engineering-change process owner. |
| `docs/HOW_IT_WORKS.md` | C | high | Keep. Current end-to-end conceptual behavior. |
| `docs/HOW_IT_WORKS.ko.md` | C | high | Keep paired current translation. |
| `docs/HOW_IT_WORKS.zh-Hans.md` | R/C-localized | medium | Keep while locale lifecycle says it is maintained/preview as appropriate. Do not classify as history just because English owns the ultimate claim. |
| `docs/STATUS.md` | C | high | Keep. Current capability/readiness owner. |
| `docs/STATUS.ko.md` | C-localized | high | Keep paired current status. |
| `docs/STATUS.zh-Hans.md` | R/C-localized | medium | Keep according to localization lifecycle. |
| `docs/ROADMAP.md` | C | high | Keep. Current direction owner; intentionally excludes live evidence detail. |
| `docs/ROADMAP.ko.md` | C-localized | high | Keep paired roadmap. |
| `docs/architecture.md` | C | high | Keep. Current as-built topology/trust/authority reference. |
| `docs/architecture-decisions.md` | D/index | high | Keep stable as the decision entry point during V2. |
| `docs/SOURCE.md` | C/R | high | Keep. Source checkout/build/validation workflow. |
| `docs/TEST_LAB.md` | C/R | high | Keep. Named validation-scenario semantics. |
| `docs/testing-strategy.md` | R | high | Keep. Current test strategy; Test Lab remains orchestration rather than ownership of domain assertions. |
| `docs/compatibility.md` | C/R | high | Keep current compatibility reference. |
| `docs/deployment.md` | C/R | high | Keep current deployment/rollback workflow. |
| `docs/known-issues.md` | P/R | high | Keep. It is deliberately a navigation index, not a duplicate bug-state DB. |
| `docs/protocol-v1.md` | C/R | high | Keep protocol reference while Protocol v1 remains current. Supersede explicitly if protocol lineage changes. |
| `docs/protocol-project-transfer-v1.md` | C/R | high | Keep Project Transfer v1 reference while current. |
| `docs/SITE_LOCALIZATION.md` | C/R | high | Keep. Current localization policy and publication gates. |
| `docs/AI_DISCOVERY.md` | R | high | Keep. Current discovery/retrieval architecture; it routes to canonical owners rather than replacing them. |
| `docs/project-state.md` | P | high | Keep as compatibility pointer. Do not expand it back into a second current-state database. |
| `docs/templates/*` | R/template | high | Keep. Templates are starting structures, not project-state truth. |

### Why `project-state.md` is already a good V2 pattern

The current file explicitly says it is retained for compatibility and is no longer an independent current-state source. It routes implementation/readiness to `STATUS.md`, exact identity to `release-contract.json`, topology to `architecture.md`, direction to `ROADMAP.md`, and live issues to GitHub Issues.

V2 should use this same pointer pattern only where preserving an old external path has real value.

## 4. Highest authority-risk files

These should be reviewed before large-scale cosmetic moves because their current names can cause incorrect retrieval even though current canonical owners already exist.

| Path | Current problem | Proposed class/action | Confidence |
| --- | --- | --- | --- |
| `docs/roadmap.md` | Lowercase duplicate claims to be a “current 0.5.1 view” and contains live work state / execution order that belongs to `STATUS.md`, Issues, evidence, or detailed plans. Current README/AGENTS/validator/discovery route to uppercase `ROADMAP.md`. | H or CP; archive after link audit. Optional delete-later after history references are safe. Do **not** keep as a second roadmap. | high |
| `docs/work-state/CURRENT_STATE.md` | Filename implies present truth but body begins with Phase 4 Hotfix2 state dated 2026-08-08 and contains older Phase/state snapshots. | H. Move/contain under `history/work-state/`; consider a tiny pointer only if meaningful external links require the old path. | high |
| `docs/work-state/DECISIONS.md` | Generic name can compete with current decision index. May contain durable decisions mixed with session context. | M → extract still-useful D/lesson items, preserve remainder as H. | high |
| `docs/work-state/NEXT_SESSION.md` | “NEXT” can appear active forever after the referenced session is over. | H unless an audit proves any work is still live; live work should become a new explicit active plan rather than reviving this file. | high |
| `docs/work-state/PROJECT_CONTEXT.md` | Generic context name can look like an agent bootstrap/current-truth document. | H after extracting any still-unique durable context. | high |
| `docs/work-state/TEST_EVIDENCE.md` | Real evidence, but generic undated title and work-state location make scope/freshness hard to judge. Last-updated snapshot is 2026-08-04. | E, probably `evidence/verification/` or a historical aggregate. Preserve observations; later decide whether to split by run or retain as one grandfathered evidence bundle. | high |
| `docs/known-issues-v0.5.0.md` | Frozen version-specific issue state can be found beside current `known-issues.md`. | H/E snapshot for v0.5.0. Keep out of current discovery; possible history/release snapshot location. | high |

## 5. Decisions

### Stable decision entry point

| Path | Class | Action |
| --- | --- | --- |
| `docs/architecture-decisions.md` | D/index | Keep stable and hand-maintained during V2. |

### Existing phase decision bundles

| Path | Class | Action |
| --- | --- | --- |
| `docs/decisions/phase-0.md` | D / legacy bundle | Keep in place initially. Mark/retain supersession semantics. |
| `docs/decisions/phase-1.md` | D / legacy bundle | Keep in place initially. |
| `docs/decisions/phase-4.5.md` | D / legacy bundle | Keep in place initially. |

Do not move these to `decisions/legacy/` just for neatness. Standalone ADRs should be created only when a durable decision deserves independent identity/navigation.

### Decision extraction candidates

- `docs/work-state/DECISIONS.md` — audit for durable choices not already represented in the decision index.
- Phase, hotfix, takeover, identity/authority and closure reports — extract only decisions with lasting architectural value.
- Do not convert every historical “we did X” sentence into an ADR.

## 6. Lessons — extraction candidates, not automatic copies

No existing historical file should simply be renamed into `lessons/`.

Strong initial extraction candidates discovered during this inventory include:

| Origin | Possible atomic lesson | Notes |
| --- | --- | --- |
| project-transfer / Phase 3 records | `L-xxxx` — validate managed-root containment before publish | Generalizes the external local UPM package failure. |
| reconnect / authority records | `L-xxxx` — request receipt is not mutation completion | Useful across admission → mutation → acknowledgement → reconnect/replay. |
| Unity reload work | `L-xxxx` — connection intent and transport instance are separate across Domain Reload | Generalizable Unity lifecycle rule. |
| release/field evidence | `L-xxxx` — current source state is not packaged byte identity | Prevents retroactively assigning later source behavior to an old ZIP. |
| `AI_COMMENT_AUDIT.md` | `L-xxxx` — comment reasons/invariants, not obvious syntax or fake density targets | The dated audit itself remains evidence/history; the reusable review rule may become a lesson or be integrated into current engineering guidance. |
| physical/same-machine testing records | `L-xxxx` — same-machine E2E is not physical two-PC evidence | Evidence-class boundary. |
| retry/shutdown records | `L-xxxx` — successful fallback/retry does not erase the primary failure | Preserve first-failure evidence and trust boundaries. |

Every lesson must link its origin/evidence and remain advisory below current source/contracts/security/canonical docs.

## 7. Evidence — strong direct candidates

### Dated root evidence

| Path | Class | Proposed destination concept | Confidence |
| --- | --- | --- | --- |
| `docs/PHYSICAL_FIELD_EVIDENCE_2026-08-30.md` | E / field | `evidence/field/` | high |
| `docs/MAIN_PATCH_STATUS_2026-08-27.md` | E / integration verification | `evidence/verification/` or `evidence/releases/` depending final indexing | high |

Both documents already state that they are dated evidence and not the current status source, so moving them later should be semantically low-risk once inbound links are audited.

### Existing audit directory

| Path | Class | Action |
| --- | --- | --- |
| `docs/audits/POST_MERGE_INTEGRATION_AUDIT_2026-08-30.md` | E / audit | Strong candidate for `evidence/audits/`; preserve dated scope and findings. |

`docs/audits/` already expresses useful semantics. Migration should not move it twice unless the benefit of one unified `evidence/` root is worth the link churn.

### Focused audit at docs root

| Path | Class | Action |
| --- | --- | --- |
| `docs/AI_COMMENT_AUDIT.md` | M: E/H + lesson candidate | Preserve dated audit; distill reusable comment/invariant policy if not already owned by current engineering docs. |

### Historical test-report families

The following families are primarily evidence/history rather than current product truth:

- `docs/phase-0-test-report.md`
- `docs/phase-1-test-report.md`
- `docs/phase-2-test-report.md`
- `docs/phase-3-test-report.md`
- `docs/phase-3-v0.4.1-test-report.md`
- `docs/phase-4-v0.5.0-test-report.md`
- Phase 4.5 `*-test-report*`, validation, reconciliation, audit-test-evidence and closure-evidence records
- UX/WP validation reports when they record actual observed results

Default treatment: `E` when the document primarily proves a scoped result; `H` when it primarily narrates implementation chronology. Mixed reports can remain grandfathered until a later semantic pass rather than being split destructively.

## 8. Plans, checklists and procedures

Filename `*TEST_PLAN*` or `*checklist*` is not enough to decide active/completed status.

### `docs/LOCALE_PICKER_TEST_PLAN.md`

Observed content describes the **minimum expected behavior** of the current progressive locale-picker enhancement: fallback links, search aliases, browser-language recommendation behavior, localStorage preference, preview labels, localization, Escape/focus behavior, and mobile layout.

Proposed classification: `R` verification specification, not an execution diary. Keep for now; later consider a clearer name/location near `SITE_LOCALIZATION.md` if current code/tests actively depend on this contract.

Confidence: medium-high.

### `docs/manual-test-checklist.md`

Despite the generic filename, the file contains preserved Phase 1/2 observations from 2026-08-02/03 and explicitly avoids changing historical checkbox evidence without independent observation.

Proposed classification: `M` → historical verification procedure + evidence. It is **not** a current generic TeamForge manual test owner.

Potential later treatment:

- keep historical observations as evidence/history;
- move any still-current reusable procedure into Test Lab/current testing docs if it is not already represented;
- avoid carrying historical checkbox state into a new active plan.

### Version/phase manual checklists

Families such as:

- `phase-3-manual-test-checklist.md`
- `phase-3-v0.4.1-manual-test-checklist.md`
- `phase-4-v0.5.0-manual-test-checklist.md`
- Phase 4.5 field/closure/manual checklists

should be classified by execution state:

- still required for a current exact candidate → `A` or current release evidence procedure;
- completed for an old immutable candidate → `CP` plus linked evidence;
- historical checklist with embedded observations → `M` / E+H.

Do not infer `Active` merely because boxes remain unchecked.

## 9. Phase records

The current documentation map already treats `docs/phases/` as historical milestone material.

| Path | Class | Proposed action |
| --- | --- | --- |
| `docs/phases/phase-0.md` | H | Eventual `history/phases/` candidate; distill unique D/E/lesson first if needed. |
| `docs/phases/phase-1.md` | H | Same. |
| `docs/phases/phase-2.md` | H | Same. |
| `docs/phases/phase-3.md` | H | Same. High-value Phase 3 transfer history; preserve archaeology value. |
| `docs/phases/phase-4.md` | H | Same. |

Confidence: high.

A move should happen only after Pages/history/internal-link propagation is understood. Their classification is already clear; their path does not need to change immediately for correctness.

## 10. Work-state records

Default rule: session/handoff notes are history unless they contain unique evidence or a durable decision that should be distilled first.

| Path/family | Primary class | Distillation before move/prune |
| --- | --- | --- |
| `docs/work-state/CHANGED_FILES.md` | H / X | Usually redundant with Git diff/history; preserve only unique rationale/navigation before optional deletion. |
| `docs/work-state/CURRENT_STATE.md` | H | High authority-risk name; preserve dated Phase snapshots, then archive. |
| `docs/work-state/DECISIONS.md` | M | Extract durable D items, then H. |
| `docs/work-state/NEXT_SESSION.md` | H | Extract any genuinely still-live work to a new active plan if necessary. |
| `docs/work-state/PROJECT_CONTEXT.md` | H/M | Extract unique durable context if still useful. |
| `docs/work-state/TEST_EVIDENCE.md` | E | Grandfather as historical aggregate or later split by evidence scope. |
| `docs/work-state/HOTFIX_SESSION.md` | H/M | Look for lesson/evidence candidates before archive. |
| `docs/work-state/HOTFIX3_SESSION.md` | H/M | Same. |
| `docs/work-state/PHASE4_SESSION.md` | H/M | Same. |
| `docs/work-state/PHASE4_TAKEOVER_SESSION.md` | H/M | Likely useful decision/lesson extraction around takeover/handoff. |
| `docs/work-state/PHASE4_HOTFIX*_SESSION.md` | H/M | Archive after D/E/lesson distillation as needed. |
| `docs/work-state/UX_PASS1_SESSION.md` | H/M | History; preserve unique UX findings/evidence. |
| `docs/work-state/UX_PASS2_SESSION.md` | H/M | Same. |
| `docs/work-state/UX_PASS2_HOTFIX*_SESSION.md` | H/M | Same. |
| `docs/work-state/UX_PASS3_SESSION.md` | H/M | Same. |
| `docs/work-state/UX_PASS4_SESSION.md` | H/M | Same. |

No work-state file should be exposed from `llms.txt` as current truth by default.

## 11. Historical repository records

### Existing `docs/history/`

| Path | Class | Action |
| --- | --- | --- |
| `docs/history/DEVELOPMENT_HISTORY.md` | H | Keep. Main engineering/repository chronology entry. |
| `docs/history/LLMS_TXT_V2_ADOPTION_2026-08-30.md` | H | Keep. Historical adoption record, not current llms specification. |

### Historical fixtures

| Path | Class | Action |
| --- | --- | --- |
| `docs/historical-fixtures/teamforge-compatibility-v1-0.5.0.json` | H/reference fixture | Preserve. Its historical identity is already explicit. Do not move unless a unified history layout adds real value. |

## 12. Changed-files manifests

Known families include:

- `docs/changed-files-v0.4.1.md`
- `docs/changed-files-v0.5.0.md`
- Phase 4.5 `changed-files-*` records
- UX bootstrap `changed-files-*` records
- work-state `CHANGED_FILES.md`

Primary classification: `H`, with many becoming `X` **after** audit.

Rationale:

- Git already owns exact file/commit diffs;
- a changed-files note can still contain useful release grouping or rationale;
- deleting before extracting that unique rationale risks losing convenient archaeology even though raw Git history remains.

Migration rule:

1. check for unique human rationale or release composition;
2. link/move that value to the correct H/E/D record if needed;
3. preserve the manifest if it remains a useful index;
4. only then consider deletion in an optional cleanup batch.

## 13. Versioned known-issue / rollback / closure records

### Versioned known issues

`docs/known-issues-v0.5.0.md` is a frozen version-era issue/status snapshot and should not compete with current `known-issues.md`, STATUS, or GitHub Issues.

Proposed class: `H/E` release snapshot.

### Rollback references

Known version/phase rollback documents such as:

- `docs/rollback-v0.4.1.md`
- `docs/rollback-v0.5.0.md`
- Phase 4.5 rollback references

need semantic review:

- if they still document a supported rollback path for a currently distributed artifact, retain as `R` scoped by version;
- if the artifact is historical, classify `H/CP` and keep it away from generic current deployment routing.

Do not merge old rollback instructions into current `deployment.md` unless they remain supported.

## 14. Phase 3 / Phase 4 / Phase 4.5 report families

These report trees are valuable but should not sit conceptually beside current canonical docs.

### Phase 3 / v0.4.1

Typical classes:

- patch/closure/implementation narrative → H;
- test report / observed Unity field result → E;
- manual checklist → CP/M;
- rollback reference → H/R-versioned;
- changed-files manifest → H/X-later.

### Phase 4 / v0.5.0

Typical classes:

- implementation/hotfix narrative → H/M;
- test/validation result → E;
- manual gate checklist → CP/M;
- known-issues snapshot → H/E;
- rollback → H/R-versioned;
- changed-files → H/X-later.

### Phase 4.5 / WP reports

WP1..WP8, closure, field, audit, identity-authority, reconciliation and hotfix reports should be separated by primary role rather than kept together merely because they share a WP number:

- actual observations / test runs / field outcomes → E;
- architecture/trust choices → D extraction + H source record;
- work-package implementation diary → H;
- checklist / intended gate → CP/A according to current execution state;
- changed-files list → H/X-later;
- reusable failure pattern → atomic lesson extraction.

The WP number is chronology, not authority.

## 15. UX bootstrap WP report families

`ux-bootstrap-wp*` and corresponding changed-files/session records are likely a mix of implementation history, plans, verification and UX decisions.

Default treatment:

- implementation/report narrative → H;
- actual test evidence → E;
- durable user-safety/authority decision → D extraction;
- reusable UX/recovery principle → lesson extraction;
- changed-files-only record → H/X-later.

Do not bulk-move this family until a semantic pass identifies records still referenced by current Launcher/Guest UX documentation.

## 16. Audit-specific conclusions

### Conclusion A — the tree is not failing because it has “too many Markdown files”

The current canonical layer is already relatively disciplined. The dominant problem is that historical reports, work-state snapshots, dated evidence, and old execution documents remain highly discoverable beside it.

### Conclusion B — filenames create retrieval risk

The biggest immediate risks are generic names that imply current authority:

1. `docs/roadmap.md`
2. `docs/work-state/CURRENT_STATE.md`
3. `docs/work-state/DECISIONS.md`
4. `docs/work-state/NEXT_SESSION.md`
5. `docs/work-state/PROJECT_CONTEXT.md`
6. `docs/work-state/TEST_EVIDENCE.md`

### Conclusion C — some old files are already well designed

Dated evidence records such as the 2026-08-27 main patch note and 2026-08-30 physical two-PC field note explicitly state that they are not current status sources. They mainly need lifecycle placement, not prose rewriting.

`project-state.md` is also already converted into a safe compatibility pointer.

### Conclusion D — `ROADMAP.md` vs `roadmap.md` should be resolved early

The uppercase `ROADMAP.md` explicitly owns **direction** and sends implementation/readiness/evidence detail to STATUS. Current README, AGENTS, AI discovery and validator routes use uppercase `ROADMAP.md`.

The lowercase `roadmap.md` is therefore not an alternate current roadmap. It is a historical current-view snapshot that survived the documentation-architecture transition.

Recommended eventual action:

1. inventory inbound links to lowercase `roadmap.md`;
2. update any still-current inbound link to `ROADMAP.md` or the correct owner;
3. preserve historical references where useful;
4. archive lowercase `roadmap.md` as history or remove it after Git/history/link value is safely preserved;
5. never maintain both as current documents.

## 17. Proposed migration priority

### Priority 0 — no moves

Use this inventory for review. Resolve any disagreement about document role first.

### Priority 1 — authority-risk cleanup

Address the misleading duplicate/generic current-looking paths:

- lowercase `docs/roadmap.md`;
- `docs/work-state/CURRENT_STATE.md`;
- `docs/work-state/NEXT_SESSION.md`;
- `docs/work-state/PROJECT_CONTEXT.md`;
- `docs/work-state/DECISIONS.md` after decision extraction.

### Priority 2 — lifecycle indexes

Create the minimal V2 infrastructure:

- `docs/lessons/README.md`;
- `docs/plans/active/README.md` and `docs/plans/completed/README.md` when there are actual plans to place there;
- `docs/evidence/README.md` if evidence migration begins;
- clearer `docs/history/README.md` if history migration begins.

Avoid creating empty taxonomy for its own sake.

### Priority 3 — obvious evidence

Move only evidence whose role is already explicit, such as physical field and dated integration evidence, with link propagation and no claim strengthening.

### Priority 4 — work-state distillation

Audit work-state one file at a time for:

- ADR/decision extraction;
- atomic lesson extraction;
- unique evidence preservation;
- historical archive;
- optional low-value deletion only later.

### Priority 5 — phase/report families

Move in small coherent batches after the new lifecycle indexes and validators prove stable.

## 18. Items intentionally left unresolved

These need more content/link/runtime inspection before a migration decision:

1. whether `LOCALE_PICKER_TEST_PLAN.md` should keep its path or be renamed to a verification/spec name;
2. which manual/field checklists are still active against the current candidate versus purely historical;
3. whether `docs/audits/` should remain a top-level audit collection or move under `docs/evidence/audits/`;
4. whether the 2026-08-04 aggregated `work-state/TEST_EVIDENCE.md` is best preserved whole or split into evidence records;
5. which old rollback references are still part of supported user recovery for downloadable releases;
6. which changed-files reports have enough human rationale to remain useful after Git-history review;
7. which Phase 4.5 / UX bootstrap reports contain decisions or lessons not already captured elsewhere.

Ambiguity is intentional here. V2 should not manufacture confidence just to complete a table.

## 19. Read-only acceptance result

This inventory supports the V2 architecture with one important refinement:

> The first real migration should focus on **authority-risk reduction**, not on moving the largest number of files.

The repository already knows what its principal current owners are. The fastest quality improvement is to prevent stale generic names and historical execution notes from competing with those owners during human/agent retrieval.

No existing document was changed to reach this conclusion.
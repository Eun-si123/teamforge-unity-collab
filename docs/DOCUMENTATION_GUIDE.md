# TeamForge documentation maintenance guide

This guide defines **how TeamForge documentation should be changed**. It exists so documentation is not rewritten ad hoc every time a feature, bug, release, architecture decision, or test result changes.

Use [docs/README.md](README.md) to find the current document that owns a fact. Use this guide to decide **what to update, what not to duplicate, and how to verify the result**.

## Core rule: one changing fact, one canonical owner

A changing fact should have one primary source of truth. Other documents may summarize it briefly when the reader needs context, but they should link to the canonical owner instead of becoming a second independently maintained copy.

| Kind of information | Canonical owner |
| --- | --- |
| Project orientation / shortest product explanation | root `README.md` |
| End-to-end conceptual behavior: Host, Guest, transfer, realtime edit, reconnect, recovery | `docs/HOW_IT_WORKS.md` / paired Korean guide |
| Current capability, blocker and release-readiness state | `docs/STATUS.md` |
| Exact product, runtime, tool, protocol and candidate selections | `release-contract.json` |
| Packaged artifact classification and byte identity | `builds/README.md` + GitHub Release filename/SHA-256 |
| Future direction and priority | `docs/ROADMAP.md` |
| Current as-built topology, ownership and trust boundaries | `docs/architecture.md` |
| Why an architecture decision was made | `docs/architecture-decisions.md` / future ADR records |
| Source checkout, build and validation workflow | `docs/SOURCE.md` |
| Question-to-code navigation | `CODEMAP.md` |
| Named test-scenario discovery/orchestration and evidence semantics | `docs/TEST_LAB.md` + `test-lab.json` |
| User-facing deployment/update/rollback procedure | `docs/deployment.md` |
| Platform/runtime compatibility scope | `docs/compatibility.md` |
| Live bug discussion and issue state | GitHub Issues |
| Product-facing version changes | `CHANGELOG.md` and the package changelog where applicable |
| Detailed engineering history | `docs/history/`, `docs/phases/`, `docs/work-state/`, dated evidence notes |
| Security support/reporting policy | `.github/SECURITY.md` |
| Contribution process | `.github/CONTRIBUTING.md` |

If the same changing value must appear in more than one current document, prefer generating it mechanically or keeping the secondary wording deliberately broad.

## Before writing: make a documentation plan

For any non-trivial documentation change, answer these questions before editing prose. The plan can be written in a PR description, issue, working note, or kept as a short internal checklist during a focused edit.

Use [`docs/templates/DOCUMENTATION_PLAN.md`](templates/DOCUMENTATION_PLAN.md) when a written plan is useful.

1. **Change** — What actually changed in code, behavior, policy, evidence, release state or project direction?
2. **Audience** — Who needs to know: user, tester, contributor, reviewer, maintainer, security researcher, coding agent?
3. **Question** — What question should the document answer for that reader?
4. **Document type** — Overview, conceptual explanation, status, roadmap, how-to, reference, decision, test guide, or historical evidence?
5. **Canonical owner** — Which one file/system owns the changing fact?
6. **Evidence** — What source, test, issue, PR, release, artifact hash or field result supports the claim?
7. **Minimum change surface** — Which files must change, which only need a link check, and which should not change?
8. **Volatility** — Is this a value likely to change again soon? If yes, avoid copying it into several files.
9. **Historical handling** — Does an old record need correction, or should it remain unchanged as an accurate snapshot of its time?
10. **Validation** — What automated and manual checks will show that the documentation still agrees with the repository?

Do not start by asking “which files mention this?” Start by asking **“which document owns this fact?”**

## Choose the document by reader task

TeamForge documentation roughly follows task-oriented documentation types.

### Overview / orientation

Examples: root `README.md`, `docs/README.md`.

Use for:
- what TeamForge is;
- why it may be useful;
- the shortest useful current summary;
- navigation to deeper material.

Do not turn an overview into a release audit, test log, protocol reference or bug tracker.

### Conceptual explanation / How It Works

`docs/HOW_IT_WORKS.md` answers **what happens end to end** when a person hosts, joins, transfers a Project, performs a supported realtime edit, reconnects, or recovers from a failure.

Use it to bridge the gap between the product README and low-level architecture/source references.

Prefer:
- user action → internal flow;
- a small number of stable concepts such as authority, identity, revision, lock/lease, staging and activation;
- diagrams and sequences that remain useful across file refactors;
- links into architecture/CODEMAP for deeper details.

Do not turn HOW_IT_WORKS into:
- a second STATUS database;
- a protocol/wire specification;
- an exhaustive source-file map;
- a dump of current release IDs, exact dependency versions, CI run numbers or work-package history.

If a refactor moves files but the conceptual flow is unchanged, CODEMAP may need an update while HOW_IT_WORKS may not.

### How-to

Examples: `docs/SOURCE.md`, `docs/deployment.md`.

Use for a reader trying to **do a specific task**.

Prefer this shape:
1. goal;
2. prerequisites;
3. steps;
4. expected result;
5. failure/recovery path;
6. related reference.

Do not bury the task under long project history or architecture explanation.

### Reference

Examples: `CODEMAP.md`, `docs/compatibility.md`, much of `docs/architecture.md`.

Use for facts readers look up repeatedly. Keep terminology precise and structure predictable. Reference material should describe what is true, not narrate a development story.

### Explanation / decision record

Examples: architecture decision records.

Use for why a design choice exists, what alternatives were considered, and what consequences follow. Preserve superseded decisions as history instead of rewriting them to look as if the current choice was always obvious.

Use [`docs/templates/ADR.md`](templates/ADR.md) for new standalone decisions when the current architecture-decision index becomes too large for another inline entry.

### Current status

`docs/STATUS.md` answers:
- what exists now;
- what evidence exists now;
- what is still blocked or unsupported;
- what must happen before a stronger readiness claim is made.

Status is not a roadmap and not a chronological engineering diary. Link to issues and dated evidence rather than copying their full timelines.

### Roadmap

`docs/ROADMAP.md` answers:
- what is being prioritized now;
- what direction comes next;
- what is later or research-only.

Keep individual bug state, exact CI run numbers, test counts and short-lived PR implementation details in STATUS/issues/evidence rather than turning the roadmap into a second current-state database.

### Test scenario / evidence guide

`docs/TEST_LAB.md` explains how named validation scenarios are discovered and run, while `test-lab.json` owns the machine-readable scenario definitions.

Use this layer to answer:
- which ordinary local checks can be grouped under a stable scenario name;
- which environment-dependent lanes are external/manual;
- what PASS, FAIL and INCOMPLETE mean;
- how failure evidence/log retention behaves.

Do not copy domain assertions out of Server/Project Peer/Launcher/Unity tests into Test Lab. Test Lab should orchestrate the owning tests. Do not make retries hide flakiness, and do not convert an unexecuted Unity/release/field lane into PASS for convenience.

### Historical evidence

Dated reports, phase notes, work-state notes and engineering-history documents preserve what happened at a specific time.

Historical records should normally **not be rewritten just because current behavior changed**. Add a supersession note or link when necessary, but preserve the original evidence unless the record itself was factually wrong at the time it was written.

## Change routing matrix

Use this as the default decision table.

| Change | Update first | Also review | Normally do not duplicate into |
| --- | --- | --- | --- |
| Feature becomes implemented/supported | `STATUS.md` | module README, README summary, HOW_IT_WORKS if end-to-end behavior changed, CHANGELOG | ROADMAP implementation diary |
| End-to-end user/internal flow changes materially | `HOW_IT_WORKS.md` | architecture, CODEMAP, module docs, paired Korean guide | STATUS unless readiness changed |
| Feature is proposed or reprioritized | `ROADMAP.md` | Issue/Discussion | STATUS/HOW_IT_WORKS as if implemented |
| Bug is discovered | GitHub Issue | STATUS if release-significant | ROADMAP detailed bug log |
| Bug fix is merged | GitHub Issue + `STATUS.md` if current readiness changes | CHANGELOG, module docs, HOW_IT_WORKS only if conceptual behavior changed | architecture if structure did not change |
| Architecture/authority/trust boundary changes | `architecture.md` | ADR, HOW_IT_WORKS, CODEMAP, SECURITY if relevant | STATUS with full design rationale |
| Durable design decision is made | ADR / architecture decisions | architecture summary | ROADMAP as decision history |
| Runtime/tool/protocol version changes | `release-contract.json` | compatibility, STATUS if readiness affected | every module README / HOW_IT_WORKS |
| New packaged artifact is published | `builds/README.md` + Release/hash | STATUS, deployment | architecture / HOW_IT_WORKS |
| Installation/deployment procedure changes | `deployment.md` | README quick path, STATUS if blocked | CODEMAP |
| Source build/test workflow changes | `SOURCE.md` | CONTRIBUTING, AGENTS, TEST_LAB if scenario command changed | ROADMAP |
| Named validation scenario changes | `test-lab.json` + `TEST_LAB.md` when semantics change | quality gates, scripts README, CI if applicable | underlying test assertions |
| File/module responsibility moves | `CODEMAP.md` | architecture, SOURCE | HOW_IT_WORKS if conceptual flow is unchanged |
| Product-facing version changes | `CHANGELOG.md` | package changelog, STATUS | DEVELOPMENT_HISTORY duplicate prose |
| Repository/tooling milestone | `docs/history/DEVELOPMENT_HISTORY.md` when worth preserving | CHANGELOG only if product-facing | STATUS unless readiness changes |
| Security policy/support changes | `.github/SECURITY.md` | README/CONTRIBUTING links | unrelated module READMEs |
| One test/field run produces evidence | dated evidence/Issue/PR | STATUS if it changes current claim | ROADMAP/HOW_IT_WORKS detailed run log |

## Writing rules

### Separate fact, evidence and inference

Write claims so the reader can tell the difference between:
- **implemented** — source contains the behavior;
- **automated evidence** — a specific test/workflow exercised it;
- **field evidence** — a real environment exercised it;
- **supported/recommended** — the project is willing to make a current usability claim;
- **planned/research** — not implemented fact.

A green test is evidence for what it executed, not proof of unrelated field behavior or security.

### Prefer durable wording

Avoid copying values that already have a canonical machine-readable owner.

Prefer:
> Use `release-contract.json` for the exact bundled runtime version.

Over:
> The bundled runtime is Node X.Y.Z.

unless the exact number is the subject of that document or the number is intentionally recorded as historical evidence.

### Preserve useful technical terms

Keep established names such as Unity Editor, Prefab, WebRTC, SHA-256, CI, `SerializedProperty` and protocol identifiers when they are the clearest terms. Avoid unnecessary mixed-language process jargon when ordinary Korean/English prose is clearer.

### Avoid defensive repetition

One clear warning is usually stronger than repeating the same disclaimer in every section. Link to STATUS/SECURITY for the complete boundary.

### Avoid invented certainty

Do not write:
- “verified” without evidence;
- “safe” when only some checks passed;
- “supported” because code exists;
- “current/latest” for upstream versions without a dated or canonical source;
- “fixed” when only a patch exists and required validation is still pending.

## Minimal-change principle

Documentation changes should modify the **smallest current set of files that must change**.

Examples:

- A Node patch version changes with no architecture effect → update `release-contract.json`; review compatibility; do not edit every README or HOW_IT_WORKS.
- A field blocker closes → update the Issue and STATUS; do not append the test transcript to ROADMAP or HOW_IT_WORKS.
- A new historical test is recorded but current readiness does not change → preserve the evidence record; STATUS may not need an edit.
- A file is renamed without responsibility change → update CODEMAP/links; architecture and HOW_IT_WORKS may not need an edit.
- A Test Lab command points to a renamed existing test → update `test-lab.json`; do not copy that test's assertion logic into the runner.

More changed documentation files does not automatically mean better documentation.

## English and Korean documents

Where TeamForge maintains paired English/Korean current documents, keep their **meaning and section-level structure** aligned. Literal sentence-for-sentence translation is not required, but one language must not claim a feature is ready while the other says it is blocked.

`HOW_IT_WORKS.md` and `HOW_IT_WORKS.ko.md` are a paired conceptual explanation. A material end-to-end behavior change should be reconciled in both languages rather than leaving two different system stories.

When only one language is updated first, treat the pair as incomplete until the material current-state difference is reconciled.

## Review checklist

Before merging a documentation-affecting change:

- [ ] The changed fact has one clear canonical owner.
- [ ] Claims are supported by current source/evidence.
- [ ] Planned work is not written as implemented fact.
- [ ] Historical evidence was preserved rather than silently rewritten.
- [ ] Volatile values were not copied unnecessarily.
- [ ] README, HOW_IT_WORKS, architecture and CODEMAP remain distinct layers: orientation → conceptual flow → structural reference → source navigation.
- [ ] STATUS and ROADMAP remain different kinds of documents.
- [ ] SOURCE and CODEMAP remain different kinds of documents.
- [ ] TEST_LAB orchestrates owning tests rather than accumulating domain assertions.
- [ ] Module READMEs describe module responsibility rather than duplicating release state.
- [ ] English/Korean current claims do not materially contradict each other.
- [ ] Links point to the owning source of truth.
- [ ] `npm run validate:docs` passes.
- [ ] `npm run testlab:validate` passes when Test Lab docs/config changed.
- [ ] `npm run validate` passes when source/document contract files changed.

## Templates

- [Documentation plan](templates/DOCUMENTATION_PLAN.md)
- [ADR](templates/ADR.md)
- [How-to guide](templates/HOW_TO.md)
- [Status capability entry](templates/STATUS_CHANGE.md)

Templates are starting structures, not forms that must be filled mechanically. Remove irrelevant sections rather than publishing empty boilerplate.

## Updating this guide

Change this guide when the **documentation system itself** changes: canonical ownership moves, a new document type becomes important, a validator rule changes, or a repeated maintenance failure reveals a missing rule.

Do not add a rule for every isolated typo. The guide should remain small enough that a contributor or coding agent can actually use it before editing documentation.

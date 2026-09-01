# TeamForge documentation map

Use this page to find the **one canonical document that owns the kind of information you need** before opening historical reports or broad repository search results.

## Start here by goal

| I want to... | Start with | Go deeper with |
| --- | --- | --- |
| Understand what TeamForge is | [Project README](../README.md) / [한국어 README](../README.ko.md) | [HOW_IT_WORKS.md](HOW_IT_WORKS.md) |
| Understand how Host, Guest, project transfer, realtime edits, reconnect, and recovery fit together | [HOW_IT_WORKS.md](HOW_IT_WORKS.md) / [한국어](HOW_IT_WORKS.ko.md) | [architecture.md](architecture.md), then [CODEMAP.md](../CODEMAP.md) |
| See what works now, what is blocked, and what still needs validation | [STATUS.md](STATUS.md) | linked Issues/evidence; exact identity in [`release-contract.json`](../release-contract.json) |
| Check exact runtime, protocol, product, or release selections | [`release-contract.json`](../release-contract.json) | [STATUS.md](STATUS.md) for readiness context |
| Check the exact packaged build or SHA-256 | [`builds/README.md`](../builds/README.md) + GitHub Release | release evidence; do not infer bytes from later source |
| Understand the current architecture or trust boundaries | [architecture.md](architecture.md) | [architecture-decisions.md](architecture-decisions.md) for rationale |
| Find where a behavior lives in code | [CODEMAP.md](../CODEMAP.md) | relevant module README, source, and nearest tests |
| Check out, build, or validate the source | [SOURCE.md](SOURCE.md) | [TEST_LAB.md](TEST_LAB.md) for named validation scenarios |
| Plan a substantial implementation change | [ENGINEERING_GUIDE.md](ENGINEERING_GUIDE.md) | [change-plan template](templates/CHANGE_PLAN.md), `quality-gates.json` |
| Change documentation safely | [DOCUMENTATION_GUIDE.md](DOCUMENTATION_GUIDE.md) | [documentation-plan template](templates/DOCUMENTATION_PLAN.md), `npm run validate:docs` |
| See future direction | [ROADMAP.md](ROADMAP.md) | GitHub Issues/Discussions for live work discussion |
| Understand why an old or current design decision exists | [architecture-decisions.md](architecture-decisions.md) | matching ADR/legacy decision record and current architecture/source |
| Investigate an old phase, incident, or debugging session | [Development history](history/DEVELOPMENT_HISTORY.md) | [historical work-state](history/work-state/), phase/evidence records |
| Contribute or report a problem | [CONTRIBUTING.md](../.github/CONTRIBUTING.md) | [SECURITY.md](../.github/SECURITY.md), [SUPPORT.md](../.github/SUPPORT.md) |

A reader should normally stop when the current question is answered. Historical records, plans, decisions, and evidence are available for deeper investigation; they are not required pre-reading for ordinary use.

## Current project truth by question

There is no useful single global ranking for every kind of fact. **Route by the question first**, then verify against source/tests/contracts where that question requires it.

| Question | Canonical owner |
| --- | --- |
| What is TeamForge and what problem does it solve? | [README.md](../README.md) / [한국어 README](../README.ko.md) |
| How does TeamForge work end to end? | [HOW_IT_WORKS.md](HOW_IT_WORKS.md) / [한국어](HOW_IT_WORKS.ko.md) |
| What works now? What is blocked? What still needs validation? | [STATUS.md](STATUS.md) |
| What exact product/runtime/protocol/release selections are current? | [`../release-contract.json`](../release-contract.json) |
| What exact packaged bytes are current or superseded? | [`../builds/README.md`](../builds/README.md) + exact GitHub Release filename/SHA-256 |
| How is the current system structured? | [architecture.md](architecture.md) |
| Why was an architecture/design decision made? | [architecture-decisions.md](architecture-decisions.md) / matching ADR |
| What is planned next or later? | [ROADMAP.md](ROADMAP.md) |
| How do I work with a source checkout? | [SOURCE.md](SOURCE.md) |
| Where does a particular behavior live in code? | [CODEMAP.md](../CODEMAP.md) |
| Which named validation scenario should I run? | [TEST_LAB.md](TEST_LAB.md) |
| What is the detailed state of a live bug? | GitHub Issues |
| What changed by product version? | [CHANGELOG.md](../CHANGELOG.md) |
| What happened in older engineering/repository history? | [DEVELOPMENT_HISTORY.md](history/DEVELOPMENT_HISTORY.md), phase/work-state/evidence records |

When two documents appear to disagree, do not average them into a synthetic truth. Identify the question, use its owner, and check the exact source/test/release identity relevant to the claim.

## Project and module guides

Current explanatory and user-facing entry points:

- [Project README](../README.md)
- [한국어 README](../README.ko.md)
- [How TeamForge works](HOW_IT_WORKS.md)
- [TeamForge는 어떻게 동작하나요?](HOW_IT_WORKS.ko.md)
- [Current status](STATUS.md)
- [Roadmap](ROADMAP.md)
- [Version changelog](../CHANGELOG.md)

Module guides:

- [Unity package](../unity-package/com.eunsung.teamforge/README.md)
- [Realtime server](../server/README.md)
- [Project Peer](../project-peer/README.md)
- [Windows launcher](../launcher/README.md)
- [Repository scripts](../scripts/README.md)

Module READMEs describe module responsibility and operating boundaries. They should link to `STATUS.md` for live readiness rather than maintain competing blocker/release state.

## Build, operation, and validation

- [SOURCE.md](SOURCE.md) — public checkout/build/validation workflow
- [Compatibility](compatibility.md) — platform/runtime compatibility and supported topology
- [Deployment and rollback](deployment.md) — intended packaged Windows deployment/rollback workflow
- [Test Lab](TEST_LAB.md) — named scenario planning/execution with explicit PASS/FAIL/INCOMPLETE and environment boundaries
- [Known issues index](known-issues.md) — navigation to live GitHub Issues, not a second bug-state database
- [Project-state pointer](project-state.md) — compatibility pointer for older links; current state lives in `STATUS.md`

## Changing TeamForge

### Engineering system

Before a substantial implementation, architecture, security, networking, recovery, release, or Unity synchronization change, read **[ENGINEERING_GUIDE.md](ENGINEERING_GUIDE.md)**.

The engineering process is:

**problem → scope/risk → invariants/failure modes → required evidence → implementation → validation → documentation → release/field impact**

Useful entry points:

- [Engineering change plan](templates/CHANGE_PLAN.md) — scope, risk, invariants, failure modes, tests, recovery, documentation, and release impact;
- [`quality-gates.json`](../quality-gates.json) — machine-readable path-to-risk/test-lane mapping;
- [`scripts/classify-change.mjs`](../scripts/classify-change.mjs) — changed-path risk/recommended-gate classifier;
- [`scripts/validate-engineering.mjs`](../scripts/validate-engineering.mjs) — engineering-process contract validator;
- [Test Lab](TEST_LAB.md) — named validation scenarios over the owning test/validator lanes.

Run `npm run validate:engineering` for engineering-policy changes. The classifier is advisory about heavy evidence: it can recommend Unity/chaos/release/field review, but it cannot claim those tests passed.

### Documentation system

Before a non-trivial documentation change, read **[DOCUMENTATION_GUIDE.md](DOCUMENTATION_GUIDE.md)**. It defines planning, document types, canonical ownership, minimum-change rules, historical-evidence handling, discovery propagation, and validation.

Useful starting templates:

- [Documentation plan](templates/DOCUMENTATION_PLAN.md)
- [ADR](templates/ADR.md)
- [How-to guide](templates/HOW_TO.md)
- [Status capability update](templates/STATUS_CHANGE.md)

Run `npm run validate:docs` after documentation changes. The normal `npm test` path also runs documentation governance checks.

## Plans, decisions, evidence, and history

These lifecycle collections answer different questions and should not be treated as interchangeable current truth.

- [`plans/`](plans/) — execution plans. `active/` guides concrete work; completed plans are implementation archaeology. **A plan is not proof that implementation happened.**
- [`decisions/`](decisions/) and [architecture-decisions.md](architecture-decisions.md) — rationale and supersession history. Decisions explain *why*; current source/architecture/contracts explain *what is true now*.
- dated test/field/audit records — scoped evidence for the exact environment/revision/candidate that was exercised;
- [`history/`](history/) — chronology, debugging archaeology, and preserved engineering snapshots;
- [`work-state/`](work-state/) — legacy compatibility/migration area. Do not use filenames such as `CURRENT_STATE.md` or `NEXT_SESSION.md` as present-day authority.

Historical material can be extremely useful when reproducing a regression or reconstructing a design choice. It should be retrieved **after** the current question has been routed to its canonical owner unless history itself is the question.

## Documentation maintenance rule

Avoid maintaining the same changing fact in several current documents.

Examples:

- blocker/readiness state belongs in `STATUS.md` + the relevant GitHub Issue;
- exact tool/runtime/protocol/release selections belong in `release-contract.json`;
- packaged byte identity belongs in `builds/README.md` + exact Release hashes;
- future direction belongs in `ROADMAP.md`;
- end-to-end conceptual behavior belongs in `HOW_IT_WORKS.md` while current structural/trust boundaries belong in `architecture.md`;
- version changes belong in root `CHANGELOG.md`;
- detailed repository/engineering history belongs in `docs/history/`;
- historical test evidence stays scoped to the dated record that observed it.

Other documents may summarize these facts briefly for context but should link to the owning source rather than become another independently maintained state database. For the full decision process, including **what not to update**, use [DOCUMENTATION_GUIDE.md](DOCUMENTATION_GUIDE.md).

## Machine-readable / agent discovery

- [AGENTS.md](../AGENTS.md) — repository-wide coding-agent safety, routing, and validation instructions
- [llms.txt](../llms.txt) — small curated AI/agent routing surface
- [AI discovery design](AI_DISCOVERY.md) — search/LLM discovery strategy and generated-layer rationale
- [Repository manifest](https://eun-si123.github.io/teamforge-unity-collab/repository-manifest.json) — exhaustive tracked-file inventory for the deployed source commit

`llms.txt` and agent/search infrastructure are routing layers, not independent truth databases. Curated agent context should favor current canonical documents; plans, decisions, evidence, and history should be retrieved only when the task calls for them.

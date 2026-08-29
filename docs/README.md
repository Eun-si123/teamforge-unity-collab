# TeamForge documentation map

Use this page to find the **one document that owns the kind of information you need** before opening historical reports.

## Engineering system

Before a substantial implementation, architecture, security, networking, recovery, release, or Unity synchronization change, read **[ENGINEERING_GUIDE.md](ENGINEERING_GUIDE.md)**.

The engineering process is:

**problem → scope/risk → invariants/failure modes → required evidence → implementation → validation → documentation → release/field impact**

Useful entry points:

- [Engineering change plan](templates/CHANGE_PLAN.md) — plan scope, risk, invariants, failure modes, tests, recovery, documentation, and release impact before implementation.
- [`quality-gates.json`](../quality-gates.json) — machine-readable path-to-risk/test-lane mapping.
- [`scripts/classify-change.mjs`](../scripts/classify-change.mjs) — changed-path risk and recommended-gate classifier.
- [`scripts/validate-engineering.mjs`](../scripts/validate-engineering.mjs) — validates the engineering-process contract itself.

Run `npm run validate:engineering` for engineering-policy changes. `npm test` also includes this validator.

The classifier is deliberately advisory about heavy evidence: a path can suggest Unity/chaos/release/field review, but it cannot claim those tests passed. Semantic risk may also be higher than a filename suggests.

## Documentation system

Before making a non-trivial documentation change, read **[DOCUMENTATION_GUIDE.md](DOCUMENTATION_GUIDE.md)**. It defines the planning step, document types, canonical ownership rules, minimum-change principle, historical-evidence handling, and validation checklist.

Useful starting templates:

- [Documentation plan](templates/DOCUMENTATION_PLAN.md) — decide what changed, who needs it, which document owns the fact, and which files should not be edited before writing prose.
- [ADR](templates/ADR.md) — durable architecture/design decision record.
- [How-to guide](templates/HOW_TO.md) — task-oriented procedure structure.
- [Status capability update](templates/STATUS_CHANGE.md) — separates implementation, evidence, remaining boundary, and support claims.

Run `npm run validate:docs` after documentation changes. The normal `npm test` path also runs the documentation-governance validator.

## Current project truth

| Question | Canonical document |
| --- | --- |
| What works now? What is blocked? What still needs validation? | [STATUS.md](STATUS.md) |
| What exact product/runtime/protocol/release selections are current? | [`../release-contract.json`](../release-contract.json) |
| What exact packaged build/hash is current or superseded? | [`../builds/README.md`](../builds/README.md) + GitHub Release SHA-256 |
| How is the current system structured? | [architecture.md](architecture.md) |
| Why was an architecture decision made? | [architecture-decisions.md](architecture-decisions.md) |
| What is planned next/later? | [ROADMAP.md](ROADMAP.md) |
| How do I work with a source checkout? | [SOURCE.md](SOURCE.md) |
| Where does a particular behavior live in code? | [CODEMAP.md](../CODEMAP.md) |
| How should a substantial code/system change be planned? | [ENGINEERING_GUIDE.md](ENGINEERING_GUIDE.md) |
| How should documentation be maintained? | [DOCUMENTATION_GUIDE.md](DOCUMENTATION_GUIDE.md) |
| What are the security/reporting expectations? | [SECURITY.md](../.github/SECURITY.md) |
| How do I contribute? | [CONTRIBUTING.md](../.github/CONTRIBUTING.md) |
| What changed by product version? | [CHANGELOG.md](../CHANGELOG.md) |
| What happened in detailed engineering/repository history? | [DEVELOPMENT_HISTORY.md](history/DEVELOPMENT_HISTORY.md) |

## Project overview

- [Project README](../README.md)
- [한국어 README](../README.ko.md)
- [Current status](STATUS.md)
- [Roadmap](ROADMAP.md)
- [Version changelog](../CHANGELOG.md)

## Module guides

- [Unity package](../unity-package/com.eunsung.teamforge/README.md)
- [Realtime server](../server/README.md)
- [Project Peer](../project-peer/README.md)
- [Windows launcher](../launcher/README.md)
- [Repository scripts](../scripts/README.md)

Module READMEs describe the supported responsibility and operating boundary of that module. They should link to `STATUS.md` for live release/readiness state instead of maintaining a second copy of current blocker status.

## Compatibility and operation

- [Compatibility](compatibility.md) — platform/runtime compatibility and supported topology
- [Deployment and rollback](deployment.md) — intended packaged Windows deployment/rollback workflow
- [Known issues index](known-issues.md) — navigation to live GitHub Issues; not an independent bug-state database
- [Project-state pointer](project-state.md) — compatibility pointer for older links; current state lives in `STATUS.md`

## Historical engineering records

TeamForge intentionally keeps detailed engineering history. These records can be valuable for debugging, design archaeology and understanding why a fix exists, but they are **snapshots**, not current truth.

Start with **[Development history](history/DEVELOPMENT_HISTORY.md)** for the former root changelog's detailed engineering/repository milestones.

Other historical material includes:

- `phases/` — milestone/phase development records;
- `work-state/` — implementation, debugging, hotfix, decision and handoff notes;
- dated patch/test/status notes such as `MAIN_PATCH_STATUS_*.md`;
- `changed-files-*.md` records;
- focused audits such as `AI_COMMENT_AUDIT.md`.

When a historical note disagrees with current source/tests or current canonical documentation, prefer the current material.

## Documentation maintenance rule

Avoid maintaining the same changing fact in several current documents.

Examples:

- blocker status belongs in `STATUS.md` + the relevant GitHub Issue;
- exact tool/runtime versions belong in `release-contract.json`;
- packaged byte identity belongs in `builds/README.md` + Release hashes;
- future direction belongs in `ROADMAP.md`;
- as-built structure belongs in `architecture.md`;
- version changes belong in root `CHANGELOG.md`;
- detailed repository/engineering history belongs in `docs/history/`;
- historical test evidence stays in dated records.

Other documents may summarize these facts briefly when needed for context, but should link back to the owning source rather than becoming another independently maintained state record.

For the full decision process, including **what not to update**, use [DOCUMENTATION_GUIDE.md](DOCUMENTATION_GUIDE.md).

## Machine-readable / agent discovery

- [llms.txt](../llms.txt) — curated AI/agent routing
- [AI discovery design](AI_DISCOVERY.md) — search and LLM discovery strategy
- [Repository manifest](https://eun-si123.github.io/teamforge-unity-collab/repository-manifest.json) — exhaustive tracked-file inventory for the deployed source commit

Discovery infrastructure should route tools to canonical information; it does not replace keeping the canonical documents accurate.

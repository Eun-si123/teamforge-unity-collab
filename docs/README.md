# TeamForge documentation map

Use this page to find the **one document that owns the kind of information you need** before opening historical reports.

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
| What are the security/reporting expectations? | [SECURITY.md](../.github/SECURITY.md) |
| How do I contribute? | [CONTRIBUTING.md](../.github/CONTRIBUTING.md) |

## Project overview

- [Project README](../README.md)
- [한국어 README](../README.ko.md)
- [Current status](STATUS.md)
- [Roadmap](ROADMAP.md)

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

Historical material includes:

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
- historical test evidence stays in dated records.

Other documents may summarize these facts briefly when needed for context, but should link back to the owning source rather than becoming another independently maintained state record.

## Machine-readable / agent discovery

- [llms.txt](../llms.txt) — curated AI/agent routing
- [AI discovery design](AI_DISCOVERY.md) — search and LLM discovery strategy
- [Repository manifest](https://eun-si123.github.io/teamforge-unity-collab/repository-manifest.json) — exhaustive tracked-file inventory for the deployed source commit

Discovery infrastructure should route tools to canonical information; it does not replace keeping the canonical documents accurate.

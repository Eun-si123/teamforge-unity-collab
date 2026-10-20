# TeamForge agent work queue and coordination

This is a **contributor/maintainer workflow**, not a new product capability. It complements [AGENT_GOVERNANCE.md](AGENT_GOVERNANCE.md); GitHub Issues and PRs remain the live record. Historical `docs/work-state/` files are never assignments. The existing [CONTRIBUTOR_TASK_GUIDE.md](CONTRIBUTOR_TASK_GUIDE.md) separately governs beginner-friendly labels.

## Read-only live planning

From a checked-out source tree with Node 22 or 24:

```powershell
npm run agent:queue -- plan
npm run agent:queue -- check --issue 303
npm run agent:queue -- plan --repo Eun-si123/teamforge-unity-collab
npm run test:agent-queue
```

The helper reads the **current public GitHub Issues, open PRs, and (for check) Issue comments**, not locally cached memory. Optional `GITHUB_TOKEN` / `GH_TOKEN` increases API rate capacity; it is only sent to the GitHub API, never printed. Failures/timeouts/pagination limits cause a nonzero exit, **not** an empty “all free” queue. There are no write permissions or auto-merge operations in this helper. Output is JSON; `--fixture path.json` supports offline, explicitly labelled fixtures for tests. A fixture is never current GitHub proof.

## Unattended GitHub Actions audit

[TeamForge agent queue audit](../.github/workflows/agent-workqueue-audit.yml) is scheduled **at minute 00 of every hour** (`0 * * * *`, UTC; also 00 minutes past the hour in KST) and can also be launched with `workflow_dispatch`. The audit now executes on an **existing Linux self-hosted GitHub Actions runner** (`runs-on: [self-hosted, Linux]`), not GitHub-hosted `ubuntu-latest`. **The runner machine and its GitHub runner service must be online** and permitted to run jobs for this repository; otherwise the job stays queued and does not silently move to a paid runner. A self-hosted runner is not created or registered by this workflow. No Unity Editor or separately run `npm` command is needed on the user's device.

The workflow uses a short-lived GitHub Actions token restricted to `contents:read`, `issues:read`, `pull-requests:read` and checks the live Issues, open PRs and candidate Issue claim comments. Its evidence appears in the Actions job summary and a 14-day JSON artifact. It runs `npm run test:agent-queue` before the live audit, with a bounded timeout and no npm dependency installation. The `audit` subcommand is also available manually:

```powershell
npm run agent:queue -- audit
```



**Reliability and resource caution:** GitHub's `schedule` trigger is best effort and can be delayed or dropped, particularly at the top of the hour, **even with a self-hosted runner**. Changing `17` to `00` honors the requested timing but cannot guarantee an exact start time or backlog catch-up. This read-only audit takes one short runner job per hour and shares the runner's CPU/memory with other CI jobs. Confirm a matching runner is **online** at repository **Settings → Actions → Runners**; if all runners are offline or attached to another repository, no audit will execute. GitHub's current billing terms make self-hosted runner compute free, but the owner pays for their machine/power/network and artifact storage remains subject to GitHub retention and account policies. To achieve strict top-of-hour wall-clock execution independent of GitHub's scheduler, use a host-side systemd timer/cron instead, while preserving the same read-only command and logs.

**Boundaries:** This is read-only scheduling, **not** an autonomous coding agent, atomic task lease, security decision, release publication or auto-merge. Lack of a claim only means none was observed in that API snapshot. API/auth/rate/pagination failures make the run fail and do not reclassify unavailable tasks as idle. Missing metadata remains triage; code work is not silently assigned. Workflow schedules require Actions enabled in GitHub and may be suspended by GitHub policies or repository inactivity. For source-changing hourly agents, separately provision an authorized execution engine, robust atomic ownership and reviewer/CI controls; never treat this audit as that engine.

## Work selection and issue classification

Issues are eligible for further claim checking **only if** they have an explicit, current priority `p0..p3` **and** readiness `agent-ready`, with no known referencing open PR. An unlabeled or metadata-free Issue is `untriaged`, **not** a low-priority permission to implement. Agents must still inspect current source, issue scope, protected boundaries, user permission, and tests.

Priority is **impact / urgency**, not ease: `p0` critical correctness/data loss; `p1` current user-facing bug or release blocker; `p2` bounded feature/UX; `p3` cleanup or exploratory backlog. Do not infer `p0` just because a task is security-related without evidence.

Readiness (independent of priority):
- `agent-ready`: a bounded, accepted change with specific tests/negative checks and independently actionable scope; **not permission to self-schedule**.
- `needs-decision`: competing semantics/security/product choices await authorized input.
- `needs-field-test`: code may exist, but observed two-PC/OS/Unity behavior is still required; do not claim closure.
- `blocked`: concrete dependency, missing artifact or failing prerequisite.
- `triage`: owner/evidence/scope cannot yet be established.

Prefer a one-line machine-readable marker in the Issue body:

```md
<!-- teamforge-task-v1 {"priority":"p2","readiness":"agent-ready","area":"unity"} -->
```

Supported areas are lowercase hyphenated identifiers such as `unity`, `server`, `launcher`, `project-peer`, `docs`, `infra`. To ease migration, GitHub labels `priority:p0` through `priority:p3` and `agent:agent-ready` / `agent:needs-field-test` etc. can replace the matching marker fields **if those labels exist**; marker/label disagreement is a conflict, never a silent override. Adding a label does not prove risk reduction or readiness. Only maintainers/authorized agents should update triage metadata after reading current source and the entire Issue. The [agent task Issue template](../.github/ISSUE_TEMPLATE/agent-task.md) starts safely as untriaged.

## Advisory per-Issue claim convention

**A branch alone is not a lock.** To coordinate independently started agents:

1. Run `plan`, read the live Issue and linked PRs, then `check --issue N` immediately before any assignment.
2. If ready, publish an Issue comment with the exact marker below **only with authorization to take the task**. Confirm the intended surface, no conflicting PR, and an expiration up to **six hours from the comment's GitHub created_at**.
3. Re-read `check --issue N` after posting. If any other active claim, ambiguous metadata, or competing PR exists, stop overlapping edits and coordinate. Do not resolve conflicts by force-pushing, overriding another worktree, or deleting their branch.
4. Work on a named branch, save an interruption-safe checkpoint in the PR or Issue (branch, HEAD, changed paths, saved/uncommitted distinction, tests, blocker, next action).
5. Comment a release marker when done or handing off; a crash/expiry does **not** authorize destructive takeover. Re-read actual PR/worktree state and source before continuation.

Example comment markers:

```md
<!-- teamforge-agent-claim-v1 {"agent":"runner-a","branch":"agent/wp6-safe-task","expiresAt":"2026-10-20T15:00:00Z"} -->
<!-- teamforge-agent-release-v1 {"agent":"runner-a","branch":"agent/wp6-safe-task","expiresAt":"2026-10-20T15:00:00Z"} -->
```

Markers must be one line and public-safe. Never include auth tokens, private machine details, secrets, or raw private logs. A release must match the latest claiming agent/branch; otherwise it cannot silently release another agent's work. Invalid/out-of-range markers cause the checker to return an uncertain state. Expired comments are historical breadcrumbs, not proof work has stopped. Renew by publishing a **new claim** only after checking ownership and scoped progress.

**Important race limitation:** GitHub comments and labels are not an atomic compare-and-swap distributed mutex; two agents can race, post claims simultaneously, or write before observing another. This helper **does not enforce exclusive ownership**. It fails closed on known claims and known open PRs, but an unobserved claim is `NO_CLAIM_OBSERVED_RECHECK_AND_CONFIRM`, never `LOCK_ACQUIRED`. For truly autonomous concurrent writes, use an independently verified atomic lease/queue service or a GitHub ref-based compare-and-swap protocol with crash/recovery tests before enabling unattended mutation. Branch separation protects commits but not semantic conflicts.

## Safe execution / release boundary

- Only user-authorized, independently launchable agents may proceed; documentation does not schedule them or override a user's choice.
- Prefer distinct Issue and source-file ownership, review cross-cutting changes, and make PR checks required. PR reviewers should inspect semantic overlap even when Git merges cleanly.
- Safety-critical trust/identity/protocol/filesystem changes and destructive operations require the usual [engineering change gate](ENGINEERING_GUIDE.md); a queue entry cannot bypass it.
- Tests are evidence of the precise source/run. Packaged ZIP, Unity E2E and physical two-PC proof remain separate.
- A task that has no useful bounded path must stop rather than manufacture commits. Never auto-close an Issue after a read-only queue check.

## Maintaining the queue

The canonical Issue body owns its current classification; a PR owns its actual patch/tests/checkpoint; `docs/STATUS.md` owns release readiness. This document owns **the work-selection protocol only**. Update labels/markers after source/Issue review and remove outdated claims through a new release comment (not history rewriting). Use the read-only helper for discovery before any metadata write. Verify the Issue and PR again after the write. More than one active claim means coordination is required, never “pick a winner”.

**Discoverability:** B-class maintainer canonical; linked from `AGENTS.md`, `docs/README.md`, `CODEMAP.md`, governance and contributor docs. Not a new user-facing Pages route or translated product page; user-facing release status stays in STATUS.

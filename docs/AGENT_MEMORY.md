# TeamForge Agent Memory

This file is TeamForge's durable repository-level memory for coding agents across sessions.

It is intentionally small. It should help a future agent avoid rediscovering important technical context, but it is **not** a source of truth that overrides current implementation, tests, CI, `docs/STATUS.md`, `release-contract.json`, architecture, or live GitHub state.

## What belongs here

Record only durable repository-level information that is useful across sessions and is not better owned by a more specific canonical document:

- important architectural or governance decisions and why they were made;
- verified lessons from incidents or failed approaches that are likely to recur;
- completed cross-cutting changes whose existence helps future work navigate the repository;
- explicit rejected/deferred approaches when forgetting the reason would cause repeated wasted work;
- pointers to the canonical file, test, Issue, PR, or evidence that owns the current truth.

Do not use this file as a command transcript, changelog replacement, backlog, or duplicate STATUS/ROADMAP.

## Working-memory rule

For substantial multi-step work, use a lightweight task checkpoint when interruption risk justifies it. Update that checkpoint at meaningful milestones, before/after risky transitions, when switching major subtasks, and after unexpected discoveries. On completion, promote only durable lessons/decisions here and keep stable product facts in their canonical owners.

When resuming, re-read current repository state before acting. Old memory is context, not proof.

## Public-repository privacy rule

This repository is public. **Agent memory must be public-safe by construction.**

Never commit:

- private chat excerpts or conversational context;
- personal identity/contact information or unrelated personal preferences;
- local absolute home paths, private hostnames/IPs, SSH fingerprints, device IDs, or machine-specific secrets;
- credentials, tokens, cookies, private keys, signing secrets, environment secrets, or auth material;
- private repository names/details that are not already intentionally public;
- private infrastructure topology, raw private logs, abuse/security telemetry, or sensitive operational evidence.

Prefer repository-relative paths, public Issue/PR/commit references, and generic environment labels. If evidence originates privately, preserve only the sanitized technical conclusion needed by TeamForge.

## Durable notes

### 2026-10-04 — memory/checkpoint policy established

- `AGENTS.md` defines the separation between durable agent memory, temporary task checkpoints, and canonical repository truth.
- Public-safety/privacy is a hard boundary for all committed agent-memory material.
- Repeated lessons should still be encoded in code, tests, validators, tooling, or safer defaults when practical rather than accumulating prose here.

### 2026-10-10 — transfer settlement and localized release identity

- Terminal chunk exhaustion must cancel sibling source requests and pacing/cooldown waits, then await worker settlement while preserving the first error. Recoverable failover remains separate; regression evidence lives in `project-peer/test/swarm-downloader.test.mjs`.
- An exact English-source review pin does not prove that every localized paragraph agrees semantically. Current candidate tag/commit/ZIP/hash, commit labels and the first field-test package are checked separately by `scripts/validate-published-candidate.mjs`; historical package evidence keeps its original identity.

### 2026-10-11 — Component identity collisions must be tested, not inferred from Set insertion

- During WP6 pre-wire identity validation, CI on both Node 22 and 24 caught a duplicate-Component-ID acceptance bug: JavaScript `Set.add()` returns the Set itself, **not** a success boolean. The guard now checks `Set.has()` before inserting.
- Regression owner: `server/test/component-foundation.test.mjs` and `server/src/component-foundation.mjs` ([PR #236](https://github.com/Eun-si123/teamforge-unity-collab/pull/236)). The separate Unity `TeamForgeGlobalObjectIdProbeTests.cs` exercises two same-type saved Components across Scene reload.
- This work is an **unwired identity-only experiment**; do not equate test success with a negotiated Component/Inspector synchronization protocol.

### 2026-10-11 — reviewed website translations are a dependency of STATUS source edits

- Editing canonical `docs/STATUS.md` changed a reviewed homepage source digest; the website build correctly refused to proceed without the corresponding reviewed Korean locale update. A docs-only batch test plan initially triggered this gate.
- Preserve the review requirement rather than updating source hashes blindly or claiming machine translation has been reviewed. Keep current source-vs-package truth in STATUS once the necessary reviewed-locale synchronization can be performed; see `docs/SITE_LOCALIZATION.md` and [PR #237](https://github.com/Eun-si123/teamforge-unity-collab/pull/237).

### 2026-10-16 — cache access workflow validation needs a real GitHub run

- [PR #278](https://github.com/Eun-si123/teamforge-unity-collab/pull/278) tested a dynamic `cache-mode` expression that GitHub Actions rejected **before jobs started**, even though local workflow checks passed. Do not infer GitHub workflow-schema acceptance from local validation alone.
- The merged, narrower change uses static `cache-mode: read` for Authority Chaos Stress and rejects explicit write/dynamic cache grants in `scripts/validate-workflows.mjs` (regressions: `scripts/validate-workflows.test.mjs`). Regular CI/Unity retain GitHub's trigger-derived cache defaults. This is defense in depth, **not evidence of a proven cache-poisoning incident**; verify the exact workflow revision in GitHub Actions after future permission changes.

### 2026-10-25 — commit attribution is a public privacy boundary

- During agent-driven GitHub writes, a commit's author/committer metadata exposed an account's private profile identity even though the source change itself was innocuous. Commit messages and attribution trailers are separate leak surfaces. Never reproduce detected personal fields in public memory, logs, PR comments, or review summaries.
- Owner-directed AI commits must use only the requested public GitHub handle and no-reply address for owner attribution, plus a freely named `... Agent` no-reply co-author. Do not impersonate unrelated human contributors. Verify **both local metadata before pushing and the actual GitHub author, committer, and trailers after every push/squash merge**; an authenticated API can override a presumed local identity.
- Treat attribution verification as fail-closed: prefer Git with an explicitly controlled identity; if a tool cannot set or verify author/committer, do not publish with it. The trusted-base `Commit identity privacy` gate and required CI protect incoming PR commits, but cannot retroactively sanitize historical Git objects or guarantee a merge-created commit's identity. Do not rewrite protected/shared history just to hide the incident.
- Canonical prevention and evidence: `docs/AGENT_COMMIT_IDENTITY.md`, `scripts/check-commit-identity.mjs`, [PR #363](https://github.com/Eun-si123/teamforge-unity-collab/pull/363), [PR #364](https://github.com/Eun-si123/teamforge-unity-collab/pull/364), and [PR #368](https://github.com/Eun-si123/teamforge-unity-collab/pull/368). A prevention check passing does **not** prove historical or cached PR references were removed.

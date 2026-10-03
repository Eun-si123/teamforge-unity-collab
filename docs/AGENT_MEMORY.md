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

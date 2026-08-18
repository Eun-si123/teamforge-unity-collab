# TeamForge AI/code-comment readability audit

Date: 2026-08-18

This note records a focused readability review prompted by external AI-agent feedback. It is not a release-readiness or security-audit claim.

## What was sampled

The review sampled representative code from each major runtime area, including:

- Unity connection, Presence, Transform, Hierarchy and Authority View code;
- Server host and Session Authority code;
- Project Peer orchestration and filesystem-safety code;
- Launcher runtime verification code.

## Result

The sampled implementation is **comment-light**. Names, tests, module READMEs, `CODEMAP.md`, and architecture documents carry much of the explanation, while many source files contain few or no comments around otherwise non-obvious lifecycle, authority, trust, filesystem, and fail-closed behavior.

That is not automatically a defect: a target comment percentage would encourage stale or redundant prose. However, TeamForge has several areas where an LLM or new human reviewer benefits from an explicit statement of **why a boundary exists**, not only what the code does.

## Policy adopted by this pass

Comments should be added selectively at high-information boundaries:

1. **File/module role** — what this file owns and what it deliberately does not own.
2. **Authority/state ownership** — which layer is authoritative and which layer only observes or executes effects.
3. **Trust/security invariants** — why path, hash, identity, capability, or activation checks fail closed.
4. **Lifecycle/concurrency rules** — why epochs, serialized bridges, main-thread dispatch, or shutdown ordering exist.
5. **Compatibility traps** — behavior that looks simplifiable but is required to preserve protocol/release compatibility.

Comments should **not** narrate obvious syntax, duplicate nearby README text line by line, claim validation that tests do not provide, or be added solely to raise a numeric density score.

## Initial targeted additions

This pass adds or strengthens comments in small, high-leverage files that sit on module/trust boundaries:

- `unity-package/com.eunsung.teamforge/Editor/Authority/TeamForgeAuthorityView.cs`
- `server/src/index.mjs`
- `project-peer/src/host-orchestrator-cli.mjs`
- `project-peer/src/filesystem-safety.mjs`
- `launcher/runtime-loader.mjs`

Larger state-machine files such as the connection, Transform, Hierarchy, Session Authority, and Launcher verification implementations should receive comments only when a future change touches a non-obvious invariant. Their current reading path is documented in `CODEMAP.md` and `docs/SOURCE.md` so an agent can reach the relevant tests and architecture before editing them.

## How to review comment quality

For a source change, ask:

- Would a competent reviewer understand the invariant without reconstructing several modules?
- Does the comment explain a constraint or reason that the code cannot express clearly by naming alone?
- Is the statement backed by current source/tests or architecture documentation?
- Would the comment still be true after a small implementation refactor?

If the answer is no, prefer clearer names, smaller functions, tests, or canonical documentation instead of more comments.

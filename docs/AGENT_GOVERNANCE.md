# TeamForge agent governance

This document defines how AI coding agents and other automated assistants should inspect, plan, mutate, and verify the TeamForge repository.

The goal is not to make agents timid. The goal is to make changes **deliberate, evidence-based, scoped, and reviewable** instead of allowing a plausible-looking model response to become an accidental design or repository-policy decision.

> **Inspect first. Decide ownership. Make the smallest justified change. Verify the final state.**

`AGENTS.md` is the repository-wide entry point. This document owns the general mutation discipline. More specific rules remain owned by the relevant guides:

- implementation / architecture / security / release changes → `docs/ENGINEERING_GUIDE.md`
- documentation changes → `docs/DOCUMENTATION_GUIDE.md`
- contributor-facing Issues and labels → `docs/CONTRIBUTOR_TASK_GUIDE.md`
- security reporting policy → `.github/SECURITY.md`
- human contribution policy → `.github/CONTRIBUTING.md`

When a specific guide is stricter than this one, follow the stricter rule for that surface.

## 1. Core behavior

An agent should distinguish three questions that are easy to collapse into one:

1. **Could this be improved?**
2. **Should this be changed now?**
3. **Am I authorized and sufficiently informed to make that change?**

A yes to the first question is not a yes to the other two.

Agents must not reorganize, rewrite, relabel, close, split, broaden, refactor, or “clean up” repository state merely because another arrangement appears neater.

Prefer a narrow change that solves the stated problem over a broad change that also makes nearby things look nicer.

## 2. Source-of-truth routing

Before changing a fact, find the system or document that owns it.

Use the current repository sources in this order where relevant:

1. current implementation and tests for implemented behavior;
2. `docs/STATUS.md` for current capability, blockers, evidence, and readiness;
3. `release-contract.json` for exact product/runtime/tool/protocol/candidate selections;
4. `docs/architecture.md` for current topology, authority, and trust boundaries;
5. `docs/HOW_IT_WORKS.md` for stable end-to-end conceptual flow;
6. `CODEMAP.md` for question-to-source navigation;
7. live GitHub Issues for detailed bug/task state;
8. `docs/ROADMAP.md` for future direction;
9. dated phase/work-state/history records only for the historical snapshot they record.

Do not promote a historical note into current truth because it contains a convenient explanation or old implementation detail.

## 3. Mutation gate

Before any meaningful write, answer the following. This can be a brief internal checklist for small changes and a written plan for larger ones.

### Intent

- What exact object, file, Issue, label, workflow, or claim is being changed?
- What observed fact or explicit request justifies the change?
- What user-visible or engineering outcome should be different afterward?

### Ownership

- What is the canonical owner of the changing fact?
- Has the current owner been inspected rather than inferred from an older note, cached result, or nearby file?

### Scope

- What is in scope?
- What is explicitly out of scope?
- Can the same outcome be achieved with fewer files, smaller behavior changes, or fewer metadata mutations?

### Risk

- Does the change touch authority, locking, identity, authentication, trust, paths, filesystem mutation, transfer integrity, reconnect/recovery, protocol compatibility, packaging, release identity, or security policy?
- If yes, route through `docs/ENGINEERING_GUIDE.md` and use the required evidence level.

### Evidence

- Which tests, validators, re-reads, or manual checks can falsify the change if it is wrong?
- Which stronger claims remain unverified after those checks?

### Uncertainty

- What assumptions are still uncertain?
- Can the uncertainty be resolved by reading current source, tests, Issues, or documentation before writing?
- If an important uncertainty cannot be resolved, do not silently convert it into a mutation or confident claim.

## 4. Read-before-write and read-after-write

For mutable repository objects, especially GitHub metadata, use this sequence:

**read current state → decide one intended mutation → write → read final state → compare with intent**

This applies to:

- Issues and their state;
- labels and assignees;
- milestones;
- pull-request metadata;
- repository policy files;
- workflows;
- release/candidate metadata;
- public project metadata.

Do not rely on a prior conversation snapshot when the live object can be fetched.

After a mutation, verify the resulting state rather than assuming the API call produced exactly the intended result.

If a mutation accidentally changes the wrong object or metadata, restore the previous state promptly and record the correction when the accidental change could otherwise confuse collaborators.

## 5. Smallest coherent change

Agents should avoid scope creep introduced by implementation convenience.

Examples:

- Fixing one diagnostics classification bug does not authorize redesigning the diagnostics system.
- Correcting one stale contributor Issue does not authorize rewriting the entire Issue backlog.
- Adding one validation rule does not authorize weakening another gate to make CI green.
- Updating one current fact does not authorize rewriting historical evidence.
- Refactoring a helper to support the requested fix does not authorize unrelated naming/formatting cleanup across the module.

Related cleanup may be proposed separately when it has independent value.

## 6. Protected and high-risk surfaces

The following are not ordinary cleanup surfaces:

- authority, lock/ownership, replay, ordering, revision, reconciliation, reconnect, recovery;
- authentication, authorization, signatures, hashes, identities, invite contracts, trust decisions;
- filesystem paths, containment, extraction, staging, activation, and Active Project state;
- protocol/message/schema compatibility;
- network exposure and firewall/security boundaries;
- packaged Runtime / Launcher integrity;
- release manifests, candidate identity, artifact hashes, and release workflows;
- `.github/SECURITY.md`, license/origin/attribution policy, and security-sensitive workflow policy.

Do not weaken a fail-closed check, identity requirement, validation gate, or security boundary merely to make a workflow pass.

Do not silently substitute a convenience path for an explicitly verified identity or trust contract.

## 7. Repository and GitHub metadata

Issue state and labels are project data, not cosmetic formatting.

Before changing an Issue or label:

1. fetch the current Issue;
2. inspect current source/docs when the Issue may be stale;
3. decide whether the task still exists in the current default branch;
4. preserve useful historical context;
5. make only the metadata/body change needed for the current purpose;
6. fetch the Issue again and verify state, labels, title, and body meaning.

Do not:

- close an Issue only because it is old;
- reopen an Issue only because a similar problem reappeared;
- turn a closed historical bug into a new onboarding task;
- replace a broad Issue with a different problem while keeping the old title/number for convenience;
- add `good first issue` because a change merely looks small;
- add `help wanted` when the task still requires an unresolved product/design decision.

For contributor-facing task curation, follow `docs/CONTRIBUTOR_TASK_GUIDE.md`.

## 8. Claims and evidence

Agents must separate:

- implementation exists;
- an automated test exercised it;
- Unity automation exercised it;
- a same-machine multi-instance test exercised it;
- a physical two-machine field test exercised it;
- an exact packaged artifact was validated;
- the project currently recommends/supports that behavior.

These evidence classes are not interchangeable.

Never write “verified”, “fixed”, “safe”, “supported”, “release-ready”, or an equivalent stronger claim solely because code was edited or one happy-path check passed.

Record tests that were **not run** when their absence matters to the claim.

## 9. Failure and recovery while editing

If validation fails after an agent change:

1. investigate the failure;
2. determine whether it exposes a real problem in the change, a stale test/policy, or an unrelated pre-existing failure;
3. fix the root cause within scope or report the unresolved failure;
4. do not delete, relax, skip, or bypass the failing assertion merely to obtain a green result unless changing that assertion is itself the justified task.

Repeated regeneration is not investigation.

If the intended change cannot be made safely within the requested scope, stop with a concrete explanation of the blocker rather than broadening the task silently.

## 10. Governance self-modification

Changes to `AGENTS.md`, this document, `docs/CONTRIBUTOR_TASK_GUIDE.md`, `docs/ENGINEERING_GUIDE.md`, `docs/DOCUMENTATION_GUIDE.md`, quality gates, validators, or vendor instruction adapters are **governance changes**.

An agent modifying governance must:

- state what failure mode or ambiguity the policy change addresses;
- preserve a single canonical owner instead of duplicating full policies across vendor files;
- avoid weakening safety, evidence, review, or validation requirements merely for convenience;
- keep rules concrete enough to act on and short enough at entry points to be followed;
- update validators when a durable routing invariant should be machine-enforced;
- run `npm run validate:engineering` and relevant documentation/workflow validators;
- re-read the resulting policy/routing files after the mutation.

If a user explicitly asks to relax a governance requirement, preserve the rest of the policy and make the relaxation narrow and visible rather than indirectly bypassing the rule.

## 11. Vendor-specific agent instruction files

Vendor adapters such as `CLAUDE.md`, `GEMINI.md`, and `.github/copilot-instructions.md` should stay deliberately small.

They should:

- route the tool to `AGENTS.md`;
- avoid inventing a parallel TeamForge policy;
- point to the same canonical specialist guides where necessary;
- not override repository-wide safety/evidence rules with vendor-specific shortcuts.

If an adapter and `AGENTS.md` disagree, treat `AGENTS.md` plus the canonical specialist guide as the TeamForge project policy and fix the adapter drift.

## 12. Completion report

For a meaningful repository change, the final report should distinguish:

- what changed;
- why it changed;
- what was actually validated;
- what was not validated;
- any remaining risk or follow-up.

Do not hide uncertainty behind a generic “done”.

## Quick checklist

Before writing:

- [ ] I inspected the current source/object.
- [ ] I know which source owns the changing fact.
- [ ] The requested outcome and out-of-scope boundary are clear.
- [ ] I chose the smallest coherent mutation.
- [ ] I identified risk and required evidence.

After writing:

- [ ] I re-read or re-fetched the final state.
- [ ] I ran the relevant focused checks/validators where possible.
- [ ] I did not weaken an unrelated test, trust check, or policy to make the change pass.
- [ ] I did not turn unrun evidence into a stronger claim.
- [ ] I can explain remaining uncertainty and follow-up clearly.

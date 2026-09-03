# TeamForge contributor task curation guide

This guide defines how maintainers and coding agents should create, refresh, label, split, and close contributor-facing GitHub Issues.

The goal is simple: newcomer tasks should be **current, bounded, testable, and supported**. A task is not good onboarding merely because its patch looks small.

Use this with `AGENTS.md` and `docs/AGENT_GOVERNANCE.md`. Implementation risk still belongs to `docs/ENGINEERING_GUIDE.md`; human contribution expectations belong to `.github/CONTRIBUTING.md`.

## Quick decision table

| Situation | Preferred classification |
| --- | --- |
| Small, current, one-PR task; desired outcome already decided; code/docs pointers and verification are clear | `good first issue` + usually `help wanted` |
| Well-defined outside contribution, but requires more project familiarity/debugging/judgment | `help wanted` |
| Product/UX/architecture direction is still undecided | normal Issue or Discussion; no onboarding label yet |
| Authority/security/trust/protocol/filesystem/release correctness is the task | maintainer/high-risk unless a safe subtask is explicitly carved out |
| Old Issue may already be solved | revalidate current `main` before changing labels or state |

Think of the label relationship as:

**`good first issue` ⊂ `help wanted`**

A good first issue is a particularly well-prepared outside-contribution task.

## Quick curation workflow

Before publishing or relabelling a contributor task:

1. **Read the live Issue** if one exists.
2. **Check current `main`.** Confirm the problem/task still exists and current paths/functions/tests are accurate.
3. **Classify decision burden and risk.** Do not delegate unresolved architecture or safety decisions to a newcomer.
4. **Bound the task.** Define one observable outcome, one focused PR, and explicit out-of-scope work.
5. **Give a path in.** Name exact files/areas, relevant helpers, and the nearest useful test/validator.
6. **Define acceptance and verification.** A reviewer should be able to tell whether the result is correct without reconstructing the whole project.
7. **Mutate the Issue/labels.** Then re-fetch and verify title, body meaning, state, and labels.

## 1. Label meanings

### `good first issue`

Use for a curated onboarding task that a contributor can complete without inventing TeamForge product or architecture decisions.

A good first issue should already have:

- a confirmed current problem or missing improvement;
- a bounded desired outcome;
- a reasonably clear implementation direction;
- exact or narrowly scoped files/areas to inspect;
- practical verification;
- explicit out-of-scope boundaries;
- no hidden requirement to understand the whole architecture.

Learning is fine. Discovering what the project wants is not the contributor's job.

### `help wanted`

Use when outside contribution is genuinely welcome and the project already knows the target outcome, but the work may require deeper debugging, wider context, or more implementation judgment.

`help wanted` should still describe a real task, not “please design a better system.”

### Design / research / discussion

Do not use onboarding labels while the project still needs to choose **what should be built**.

Examples:

- selecting a new synchronization model;
- redesigning P2P topology;
- choosing a trust/security policy;
- exploring several incompatible UX directions before a target is selected.

### Maintainer / high-risk work

High-risk correctness/security work should normally remain outside newcomer labels unless a safely isolated subtask has been carved out and the sensitive decision is already settled.

## 2. Mandatory current-state check

Before creating, relabelling, or substantially rewriting a contributor task:

- fetch the live Issue;
- inspect the current default branch;
- check whether later commits/PRs solved all or part of the task;
- identify the current canonical source/docs for the behavior;
- verify referenced paths/functions/tests still exist;
- decide whether the Issue should stay, narrow, split, close, or be replaced by a new Issue.

Issue age means **revalidate**, not **close automatically**.

## 3. Good-first-issue gate

A task should normally satisfy every category below before receiving `good first issue`.

### Problem readiness

- [ ] The problem is reproducible, directly observable, or clearly documented.
- [ ] The desired result is already decided.
- [ ] The task is still present in current `main`.

### Scope

- [ ] One focused PR can complete the task.
- [ ] Exact files or a small source/document surface can be named.
- [ ] The contributor does not need the whole TeamForge architecture to start.
- [ ] Out-of-scope work is explicit.

### Decision burden

- [ ] No new protocol/schema design is required.
- [ ] No new authority/ownership/conflict policy is required.
- [ ] No security/trust policy decision is required.
- [ ] No release/packaging identity decision is required.
- [ ] The instruction is more specific than “investigate and fix it.”

### Verification

- [ ] Expected behavior is observable/testable.
- [ ] Relevant existing tests or a clear new-test location can be named for code changes.
- [ ] Manual checks are specific when automation is not appropriate.
- [ ] The maintainer can review the result without rediscovering the task.

If an important item is false, use `help wanted`, a normal Issue/Discussion, or split a smaller task instead.

## 4. Usually NOT a good first issue

Do not normally apply `good first issue` to tasks whose core work involves:

- realtime authority, revisions, replay, conflict, reconciliation;
- lock/ownership correctness;
- reconnect/recovery correctness;
- authentication/authorization;
- identity, signatures, keys, hashes, trust, invite security contracts;
- arbitrary/untrusted network input handling;
- filesystem containment, extraction, staging, activation, Active Project integrity;
- Project Transfer integrity;
- protocol/message/schema compatibility;
- Windows firewall/network exposure policy;
- packaged Runtime/Launcher integrity;
- release manifests, exact artifact identity, signing;
- vulnerability/security-policy work;
- large cross-module refactors;
- open-ended performance/security audits;
- “design a better UX/architecture” without a selected outcome.

A small subtask inside one of these areas can qualify only when the sensitive decision is already made and the contributor cannot accidentally weaken the boundary.

## 5. Preferred Issue shape

For a substantive onboarding task, use roughly this structure:

```md
## Why

What is currently confusing, missing, or incorrect, and why it matters.

## Expected outcome

What should be observably different when the task is complete.

## Where to start

- `exact/path/or/small/area`
- relevant function/class/section
- relevant test file or validation command

## Suggested approach

A bounded direction that prevents unnecessary archaeology without dictating every line.

## Acceptance criteria

- [ ] Observable criterion
- [ ] Regression/compatibility criterion
- [ ] Additional criterion relevant to the task

## How to verify

Focused tests, validators, or explicit manual steps.

## Out of scope

What this PR should deliberately not redesign or clean up.

## Getting help

Questions are welcome on this Issue. If a source pointer is stale, ask before broadening scope.
```

Do not force all headings onto a one-line typo. This is a quality target, not ceremony for trivial fixes.

## 6. Good code pointers

Prefer:

- exact file path;
- class/function/section name;
- an existing helper to reuse;
- nearest relevant test file;
- exact focused validation command.

Avoid brittle line numbers unless the Issue is intentionally short-lived and line numbers materially help.

Do not send newcomers into historical phase/work-state notes first when current code, CODEMAP, or current module docs can explain the task.

## 7. Acceptance criteria vs implementation hints

Acceptance criteria describe **reviewable outcomes**.

Prefer:

- “Pasting a Host Collaboration Invite into the TF1 field shows the specific format-mismatch guidance.”
- “Existing valid TF1 codes still join normally.”

Avoid making acceptance criteria implementation guesses such as:

- “Add an if statement in method X.”
- “Refactor parser Y cleanly.”

Implementation hints can be given separately. A different correct implementation should be acceptable when it preserves the required contract.

## 8. Verification expectations

Name the smallest relevant lane first; add stronger validation only when the task requires it.

Examples:

- documentation → `npm run validate:docs`;
- repository/governance policy → `npm run validate:engineering` plus relevant validator;
- isolated Unity UX/helper → focused EditMode tests;
- Server behavior → focused test + Server suite as appropriate.

Do not make a first contribution require unrelated physical field or exact-release validation.

If the task inherently requires a difficult physical setup, it is usually better as `help wanted` or maintainer work than as `good first issue`.

## 9. Splitting broad Issues

A broad Issue may contain a contributor-safe subproblem.

When splitting:

1. preserve the original Issue and its context;
2. create a new Issue for the independently completable subtask;
3. link the new Issue to the parent;
4. define exactly what the subtask does **not** solve;
5. keep architecture/security/release decisions in the parent when they are outside the newcomer task.

Do not rewrite a broad historical Issue into a different small task merely to reuse its number.

## 10. Stale Issue triage

### Still valid

Refresh only stale pointers/commands/context that block contribution. Preserve the problem meaning.

### Partially solved

Narrow the remaining acceptance criteria or create a focused follow-up Issue when that is clearer.

### Fully solved

Confirm current `main` satisfies the intended outcome, then close with a concise note about what completed or superseded it.

### Problem changed materially

Preserve/close the old record as appropriate and create a new Issue for the new problem. Do not mutate the old Issue into a different bug.

### Cannot determine yet

Do not guess. If an onboarding label is clearly misleading, remove it only after confirming why; otherwise leave the uncertainty for maintainer review.

## 11. Closing rules

Do not close an Issue merely because:

- it is old;
- it has no comments;
- a nearby refactor happened;
- a model predicts the problem is probably gone;
- one vaguely related test passes.

Close when the intended outcome is demonstrably complete, intentionally rejected/superseded, duplicate, or otherwise resolved by a clear project decision.

For contributor-facing Issues, add a short closure note when the reason is not obvious from linked commits/PRs.

## 12. Labelling rules

### Add `good first issue` only when

- the gate above is satisfied;
- the Issue is open;
- pointers and verification are current;
- no contributor is already doing overlapping work unless parallel work is explicitly wanted.

### Remove `good first issue` when

- the task was solved;
- current scope became architectural/high-risk;
- pointers or acceptance criteria are stale enough to mislead;
- the task is no longer independently completable.

Removing the label does not mean the Issue is unimportant.

### Add `help wanted` when

- outside implementation/review is genuinely welcome;
- the problem and target outcome are defined;
- maintainers are ready to review a contribution in that direction.

Do not use `help wanted` as a substitute for unresolved product design.

## 13. Contributor autonomy

A well-scoped task should provide direction without turning the contributor into a patch typist.

Give:

- problem context;
- constraints and protected invariants;
- code pointers;
- acceptance criteria;
- verification.

Leave room for reasonable implementation choices inside those boundaries.

## 14. AI-assisted contributions

TeamForge permits AI-assisted contributions under `.github/CONTRIBUTING.md`.

Write contributor tasks so they remain robust when an LLM is involved:

- define the actual problem rather than relying on tribal context;
- use current source/test pointers;
- state what must not change;
- require checks capable of catching plausible-but-wrong output;
- avoid rewarding large generated rewrites.

A task is high quality when a human or LLM-assisted contributor can understand its boundary and a reviewer can falsify an incorrect solution.

## 15. Maintainer commitment

A curated `good first issue` is an onboarding promise from the project.

When practical, maintainers should:

- answer reasonable scope questions;
- fix stale source pointers promptly;
- avoid letting newcomers unknowingly duplicate work;
- review focused first contributions with enough explanation to help the contributor learn.

Prefer a small set of current, supported good-first issues over a large stale backlog.

## Final curation checklist

Before publishing or relabelling:

- [ ] The Issue reflects current `main`.
- [ ] Problem and expected outcome are clear and separate.
- [ ] The task fits one focused PR or uses a broader classification.
- [ ] Current files/functions/tests are named where useful.
- [ ] Acceptance criteria are observable.
- [ ] Verification is practical.
- [ ] Out-of-scope boundaries prevent accidental redesign.
- [ ] The label matches the decision/risk burden.
- [ ] No authority/security/release boundary is delegated casually.
- [ ] Useful historical context is preserved.

After changing an existing Issue, re-fetch it and verify title, body meaning, state, and labels.

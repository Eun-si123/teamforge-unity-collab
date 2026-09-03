# TeamForge contributor task curation guide

This guide defines how maintainers and coding agents should create, update, label, split, and close contributor-facing GitHub Issues.

The purpose is to make newcomer tasks **real, current, bounded, testable, and helpful** rather than merely easy-looking.

Use this guide together with:

- `AGENTS.md` and `docs/AGENT_GOVERNANCE.md` for repository mutation discipline;
- `docs/ENGINEERING_GUIDE.md` for implementation risk and evidence;
- `.github/CONTRIBUTING.md` for human contribution expectations;
- `.github/SECURITY.md` for sensitive reports.

## 1. Task classes

TeamForge uses contributor labels as contracts, not decoration.

### `good first issue`

A curated onboarding task for someone who may be seeing the codebase for the first time.

A `good first issue` should already have:

- a confirmed current problem;
- a bounded desired outcome;
- a reasonably clear implementation direction;
- exact or narrowly scoped files/areas to inspect;
- a practical verification path;
- explicit out-of-scope boundaries;
- no unresolved architecture/product decision that the newcomer must invent.

A good first issue may still require learning. It should not require discovering what the project actually wants.

### `help wanted`

A task for which outside contribution is welcome, but which may require more project familiarity, deeper debugging, or broader implementation judgment.

The problem and success conditions should still be sufficiently defined that a contributor is not being asked to design the product from scratch.

### Design / research / discussion task

Use an ordinary enhancement/Issue/Discussion without `good first issue` or `help wanted` when the project still needs to decide **what should be built** or which architecture/policy direction is correct.

Examples:

- choosing a new synchronization model;
- redesigning P2P topology;
- deciding a security or trust policy;
- investigating several incompatible UX directions without a selected target.

### Maintainer / high-risk task

Keep high-risk correctness/security work unlabelled as newcomer work unless a safely isolated subtask has genuinely been carved out.

## 2. Relationship between labels

Treat:

**`good first issue` ⊂ `help wanted`**

A good first issue is a particularly well-prepared help-wanted task.

Where practical, a new or refreshed `good first issue` should also carry `help wanted` so the intent is explicit to both humans and external issue indexes.

Do not mechanically add `help wanted` to old `good first issue` tickets without first revalidating that the task still exists.

## 3. Mandatory current-state check

Before creating, relabelling, or substantially rewriting a contributor task:

1. fetch the live Issue when one already exists;
2. inspect the current default branch, not only the Issue's original date/context;
3. check whether later commits/PRs already solved all or part of the task;
4. identify the current canonical source/docs for the affected behavior;
5. verify that referenced paths/functions still exist or replace them with current pointers;
6. decide whether the task should be kept, narrowed, split, closed, or replaced with a new Issue.

An Issue can become stale while remaining open. Its age is a reason to **revalidate**, not a reason to close it automatically.

## 4. `good first issue` eligibility checklist

A task should normally satisfy every item below before receiving `good first issue`.

### Problem readiness

- [ ] The problem is reproducible, directly observable, or clearly documented.
- [ ] The desired result is already decided.
- [ ] The task is still present in the current default branch.

### Scope

- [ ] The task can be completed as one focused PR.
- [ ] Exact files or a small code/document surface can be named.
- [ ] A newcomer does not need to understand the entire TeamForge architecture.
- [ ] Out-of-scope work can be stated explicitly.

### Decision burden

- [ ] No new protocol/schema design is required.
- [ ] No new authority/ownership/conflict policy is required.
- [ ] No security/trust policy decision is required.
- [ ] No release/packaging identity decision is required.
- [ ] The contributor is not being told only “investigate and fix whatever is wrong.”

### Verification

- [ ] The expected behavior is testable.
- [ ] Relevant existing tests or a clear new-test location can be named when code changes are involved.
- [ ] Manual verification steps are specific when automation is not appropriate.
- [ ] The maintainer can review the result without reconstructing the task from scratch.

If an important item is false, use `help wanted`, a normal Issue/Discussion, or split out a smaller task instead.

## 5. Tasks that are normally NOT good first issues

Do not apply `good first issue` by default to work involving:

- realtime authority, revision, replay, reconciliation, or conflict semantics;
- lock/ownership correctness;
- reconnect/recovery correctness;
- authentication/authorization;
- signatures, keys, hashes, identity, trust, or invite security contracts;
- arbitrary/untrusted network input validation;
- filesystem containment, extraction, staging, activation, or Active Project integrity;
- project transfer integrity;
- protocol/message/schema compatibility;
- Windows firewall/network-exposure policy;
- packaged Runtime/Launcher integrity;
- release manifests, exact artifact identity, or signing;
- security policy or vulnerability handling;
- large cross-module refactors;
- open-ended performance/security audits;
- “design a better UX/architecture” tasks with no selected outcome.

A small isolated subtask from one of these areas can qualify only when the high-risk decision is already made and the newcomer cannot accidentally weaken the boundary.

## 6. Preferred good-first-issue shape

Use a structure close to this:

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

A bounded implementation direction. Give enough context to prevent needless archaeology,
without writing the whole patch for the contributor.

## Acceptance criteria

- [ ] Concrete observable criterion
- [ ] Regression/compatibility criterion
- [ ] Documentation/accessibility/etc. criterion when relevant

## How to verify

Exact focused tests, validator commands, or manual steps.

## Out of scope

What this PR should deliberately not redesign or clean up.

## Getting help

Questions are welcome on this Issue. If a current source pointer no longer matches,
ask before broadening the task.
```

Do not require every heading for a trivial documentation typo. The structure is a quality target for substantive onboarding tasks, not mandatory bureaucracy for one-line fixes.

## 7. Code pointers

A newcomer task should prefer current, narrow pointers such as:

- exact file path;
- relevant class/function;
- existing helper that should be reused;
- nearest test file;
- exact validation command.

Avoid brittle line numbers unless the issue is short-lived and line numbers materially help.

Do not point newcomers first to historical phase/work-state notes when current code, CODEMAP, or module docs can explain the task.

## 8. Acceptance criteria

Acceptance criteria should describe externally reviewable results, not implementation guesses.

Prefer:

- “Pasting a Host Ready Collaboration Invite into the TF1 field shows the specific format-mismatch guidance.”
- “Existing valid TF1 codes still join normally.”

Over:

- “Add an if statement to method X.”
- “Refactor the parser cleanly.”

Implementation suggestions may appear separately, but a different correct implementation should be acceptable when it preserves the required contract.

## 9. Verification expectations

For code tasks, name the smallest relevant test lane first.

Also state stronger validation only when the change requires it.

Examples:

- documentation task → `npm run validate:docs`;
- repository-policy task → `npm run validate:engineering` / relevant validator;
- isolated Unity UX helper → relevant EditMode tests;
- server behavior → focused test + Server suite as appropriate.

Do not make a first contribution require unrelated physical field or release validation unless that environment is inherently the task.

If a task genuinely cannot be verified without a difficult physical setup, it is probably better classified as `help wanted` or maintainer work than `good first issue`.

## 10. Splitting broad Issues

A broad Issue may contain a small contributor-safe subproblem.

When splitting:

1. preserve the original Issue and its historical/problem context;
2. create a new Issue for the independently completable subtask;
3. link the new Issue back to the parent;
4. define exactly what the subtask does **not** solve;
5. leave architecture/security/release decisions in the parent when they are not part of the newcomer task.

Do not silently rewrite a broad historical Issue into a different small task merely to reuse the Issue number.

## 11. Stale Issue triage

When a contributor Issue looks stale, classify it deliberately.

### Still valid

Refresh only stale paths/commands/context that block contribution. Preserve the problem meaning.

### Partially solved

Narrow the remaining acceptance criteria or create a focused follow-up Issue when that produces a clearer task.

### Fully solved by later work

Confirm the current branch satisfies the Issue's intended outcome, then close with a short note explaining what superseded/completed it.

### Problem changed materially

Close or preserve the old Issue according to its historical value and create a new Issue for the new problem. Do not mutate the old record into a different bug.

### Cannot currently determine

Do not guess. Remove misleading onboarding labels if necessary only after confirming they are misleading, and leave/record the uncertainty for maintainer review.

## 12. Closing rules

Do not close an Issue merely because:

- it is old;
- nobody commented;
- a nearby refactor occurred;
- a model predicts the problem is probably gone;
- a test looks related.

Close when the intended outcome is demonstrably completed, intentionally rejected/superseded, duplicate, or otherwise resolved under a clear repository decision.

For a contributor-facing Issue, prefer a concise closure note when the reason would not be obvious from linked commits/PRs.

## 13. Labelling rules

Before changing labels, read the live Issue and inspect current implementation/context when necessary.

### Add `good first issue` only when

- the eligibility checklist is satisfied;
- task pointers and verification are current;
- the issue is open;
- no contributor is already doing overlapping work unless the project explicitly supports parallel attempts.

### Remove `good first issue` when

- the task was solved;
- current scope became high-risk or architectural;
- source pointers/acceptance criteria are so stale that a newcomer would be misled;
- the task is no longer independently completable.

Removal does not mean the Issue is unimportant.

### Add `help wanted` when

- outside implementation/review is genuinely welcome;
- the task has a defined problem and target outcome;
- the project is ready to review a contribution in that direction.

Do not use `help wanted` as a substitute for unresolved product design.

## 14. Contributor autonomy

A well-scoped issue should provide direction without turning the contributor into a patch typist.

Give:

- problem context;
- constraints;
- code pointers;
- acceptance criteria;
- verification.

Leave room for the contributor to choose a reasonable implementation within those boundaries.

For sensitive boundaries, however, explicitly state invariants that must not be weakened.

## 15. AI-assisted contributions

TeamForge welcomes AI-assisted contributions under `.github/CONTRIBUTING.md`.

Contributor tasks should therefore be robust against a contributor using an LLM:

- define the real problem instead of relying on tribal context;
- give current source/test pointers;
- state what must not be changed;
- require verification that can detect plausible-but-wrong output;
- avoid acceptance criteria that reward large generated rewrites.

A task is not high quality because an LLM can produce a patch quickly. It is high quality when a human or LLM-assisted contributor can understand the intended boundary and reviewers can falsify an incorrect solution.

## 16. Maintainer response expectation

A curated `good first issue` is an onboarding promise from the project.

When practical, maintainers should:

- answer reasonable scope questions;
- correct stale source pointers promptly;
- avoid letting two newcomers unknowingly duplicate the same task;
- review focused first contributions with enough explanation that the contributor can learn from the result.

Do not maintain a large backlog of nominal good-first issues that nobody intends to support.

A small set of current, high-quality tasks is preferable to many stale ones.

## 17. Review checklist for a contributor task

Before publishing or relabelling:

- [ ] The Issue reflects current `main`.
- [ ] The problem and desired outcome are different sections/concepts.
- [ ] The task is one focused PR or is labelled at the appropriate broader level.
- [ ] Current files/functions/tests are named where useful.
- [ ] Acceptance criteria are observable.
- [ ] Verification is practical.
- [ ] Out-of-scope boundaries prevent accidental redesign.
- [ ] The label matches the decision/risk burden.
- [ ] No security/authority/release boundary is being delegated casually.
- [ ] Existing historical context was preserved where useful.

After mutating an existing Issue, re-fetch it and verify the final title, body meaning, state, and labels.

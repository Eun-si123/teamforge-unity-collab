# Recursive self-improvement (opt-in, provider-neutral)

This standalone component can improve its own allowed source code (or any other
Git project) by proposing changes, measuring them with a frozen independent
evaluator, and keeping only objectively better candidates. No auto-merge,
automatic production deployment, schedule, or unlimited reasoning loop exists.

## Inspiration and implementation

- Codex: tool loop, progress receipts, approval boundaries and context limits.
- Claude Code: deterministic lifecycle hooks and permissions (future extension).
- OpenCode: explicit tool capabilities and independent provider configuration.
- OpenHands: disposable workspaces and evaluation independent of code generation.
- Gemini CLI: model/tools/plugin separation.

These were consulted as architectural references. No third-party source code was copied.

The new code lives in improve/runner.mjs and improve/benchmark.mjs; both reuse
the general harness engine, model router, Git adapter, source tools and Draft
publisher. Source hosting and LLM providers are NOT hardcoded.

## Feedback loop

1. Freeze exact Git HEAD, external evaluator SHA-256 and actual container image IDs.
2. Run each regression and hidden holdout evaluation case twice by default,
   in identical network-disabled, read-only Docker environments.
3. Use configured LLMs and limited read/search/patch tools to propose a change
   in an independent temporary Git checkout. The model cannot see the evaluator
   source or change the tests, approval policy, or evaluator/scorer this run.
4. Run the same tests. Accept only if at least one previously failing case passes,
   and no previously passing case fails.
5. Reject candidates with regressions, restore the last accepted patch, and feed
   the model only bounded case IDs and outcome summaries for the next attempt.
6. Repeat 1-3 rounds. Re-evaluate the final candidate and verify exact diff bytes.
7. Save an owner-only patch and unique append-only-style run receipt. Future
   runs can consult the previous five outcome summaries.
8. Only an explicit --publish option creates a Draft PR/MR after fresh source
   HEAD verification. No auto-merge or automatic adoption of modified harness code.

Perfect baseline scores stop with no_measurable_gap. To improve an uncovered
capability, create and independently verify new evaluation cases first. The
evaluation code must live OUTSIDE the source repository being edited. The model
may still overfit tests or write harmful code, so a human review and project CI
are mandatory before adoption.

## Usage

Prepare a private model config using harness/examples/provider-neutral.json
and explicitly approve model routes and source disclosure. API keys stay in
environment variables, never in the config file.

Copy harness/examples/self-improvement-policy.json to a private file and
adapt the existing editableFiles, protectedFiles, testFile and 2-12 test
cases. Use an external, trusted evaluator folder (for example,
/opt/agent-evaluations/verified-suite) with separately authored tests.
Tests import the candidate files via the read-only /workspace mount; the
evaluator folder is mounted as /evaluator and hashed before/after every case.

Plan, no provider or GitHub calls:

    node harness/improve/runner.mjs plan --config /private/models.json --policy /private/policy.json --source /path/to/git/repo --ref main --eval-dir /path/to/external/evaluator --task-file /private/goal.txt

Candidate proposals and offline benchmark (not published):

    node harness/improve/runner.mjs propose --config /private/models.json --policy /private/policy.json --source /path/to/git/repo --ref main --eval-dir /path/to/external/evaluator --task-file /private/goal.txt

An operator may append --publish only after arranging an authorized publisher
and Git credentials. It can create a Draft PR/MR but never merge one.

## Verification

    node --test harness/test/self-improve.test.mjs
    HARNESS_INTEGRATION=1 node --test harness/test/self-improve.test.mjs

The synthetic local-Git integration proves two consecutive improvements
1/3 -> 2/3 -> 3/3 with an independent evaluator, and separately demonstrates
that a candidate that fixes one holdout but breaks an existing regression is
rejected and the prior good candidate restored. No commercial model or remote
PR is used in those tests.

## Known gaps

No distributed cross-host lease or long-running production agent. No real
commercial-model self-editing E2E, API pricing/quota enforcement, merged code
promotion, metric-aware performance optimizations or robust adversarial
prompt-injection evaluation. Frozen heldout tests are not a substitute for
independent security review or field tests. A future recurring worker must be
coordinated with existing TeamForge agents before activation.


## Extra stage-specific verification

A local promotion may also require the protected in-repository test suite to
run independently. Set protectedVerification in the private evaluator policy
to a trusted Docker image with all required runtime test tools installed
(such as Git, when the tests create temporary Git fixtures), an exact argv
array, expected output marker and timeoutMs. The model cannot edit this
policy or the Docker image. The optional verifier image recipe lives in
harness/docker/node24-git-verifier.Dockerfile. Only the trusted controller
uses this setting; it does not become a model tool.

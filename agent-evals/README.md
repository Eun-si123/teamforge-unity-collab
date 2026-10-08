# Historical coding-agent evaluation tasks

This is a **small starter corpus**, not a model benchmark result. Cases use real project failures and existing validation lanes. The runner does not launch an AI agent; an evaluator runs it in a controlled, separate worktree **after** an agent attempts the case.

- Inspect tasks: `python3 scripts/agent_evals.py list` and `python3 scripts/agent_evals.py plan <case-id>`.
- Validate fixtures: `python3 scripts/agent_evals.py validate`.
- Run actual repository checks: `python3 scripts/agent_evals.py run <case-id> --label candidate --output /tmp/agent-eval-candidate.json`.
- Compare evidence summaries: `python3 scripts/agent_evals.py compare /tmp/baseline.json /tmp/candidate.json`.
- Run harness self-tests: `python3 -m unittest discover -s scripts -p test_agent_evals.py`.

`passed` only means that all **listed executable checks** exited successfully. External/manual checks always yield `incomplete` and a nonzero exit status; failed commands yield `failed`. Do not relabel an incomplete physical Unity/Android/field lane as PASS from a summary, PR description, or agent self-report.

For an **agent productivity/accuracy comparison**, start two trials from the **same pinned source revision** in separate disposable worktrees, with the same task, test tools and environment. Keep acceptance checks/evaluator separate from the implementing agent. Record agent variant/model, tokens/cost, human intervention, end-to-end elapsed time and independently checked output. Repeat trials where possible and preserve failures. The commands in this runner time *only the checks*, not the agent; its `compare` output is **not a productivity claim**.

No automatic deployment, release, API calls, expensive device tests, extra permissions or recurring agents are created by this suite. Review generated JSON before publishing: even metadata may reveal private system details.

## Independent trial review and matched comparison

The initial `agent_evals.py compare` command only compares **test-run summaries**; it does not assess developer productivity. For reviewed experiments, use `agent_eval_trials.py` instead. This second tool does **not** invoke an AI model, open a PR, or certify a reviewer's identity.

1. Start each baseline/candidate attempt in an isolated checkout from the **same full starting commit**. Keep the task, tool permissions, hardware/network profile, evaluator case definition and evaluator code comparable; retain the actual agent session log separately.
2. Run the existing checks from the evaluator-controlled checkout and save each raw run JSON. A `run` exit code of `2` means **INCOMPLETE**, not a test failure or a PASS.
3. Create a separate review worksheet, e.g.:

   ```sh
   python3 scripts/agent_eval_trials.py template /tmp/agent-eval-run.json --starting-commit FULL_40_CHAR_START_SHA --variant baseline --trial-id baseline-01 --environment controlled-linux --agent worker-1 --reviewer reviewer-1 --output /tmp/agent-eval-review.json
   ```

4. A **different reviewer** checks the code and actual behavior, fills each acceptance/regression criterion and external/manual step as `passed`, `failed`, or `not_checked`, and supplies a relevant evidence reference for each checked item. Record externally measured end-to-end `agentWallSeconds`, `humanMinutes` and `costUsd` if known; leave unknown measurements null, never substitute test elapsed time.
5. Validate the binding between runner output and reviewer worksheet and produce a review assessment:

   ```sh
   python3 scripts/agent_eval_trials.py assess /tmp/agent-eval-run.json /tmp/agent-eval-review.json --output /tmp/agent-eval-assessment.json
   ```

6. Compare **multiple independently assessed attempts** from two variants:

   ```sh
   python3 scripts/agent_eval_trials.py compare /tmp/baseline-01-assessment.json /tmp/candidate-01-assessment.json
   ```

The comparison refuses different case definitions, starting revisions, environment labels, duplicated trial IDs, or more/fewer than two variants. Fewer than three **complete** reviewed trials per variant are labelled insufficient. Even with three or more, summaries are *descriptive only*, not causal proof of better model quality.

**Evidence boundaries:** Source tests, actual Unity/Android/device evidence, and reviewer attestations are distinct. A reviewer can attest to a physical/manual result with a documented reference, but the tool cannot inspect that evidence or cryptographically prove the reviewer independent; the resulting label is `review-attested-pass`, **not an automatically verified physical PASS**. Treat case fixtures and a copied evaluation runner inside an agent-editable checkout as potentially modifiable; for higher-assurance comparisons, keep the evaluator and hidden acceptance tests in a separate trusted pinned checkout. Review all saved JSON before sharing; do not insert credentials, user identifiers, private machine paths or raw logs.

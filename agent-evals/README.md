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
# Multi-model coding and recursive-improvement pool

Any explicitly approved provider routes (OpenAI-compatible or Anthropic
Messages) can be used as independent proposers and independent advisory
reviewers. No model or code host name is hardcoded in the pool.

Each route proposes patches against the same pinned Git HEAD and the same
independent frozen evaluator. Proposer histories are separated by model
connection so a competitor cannot inherit another model's hidden feedback.
The global controller caps network/model requests, spaces them in time and
runs candidates sequentially. Each proposer uses a disposable checkout.

The independent reviewer gets only a bounded diff and task description and
reports advisory concerns through a structured function. Neither the proposer
nor the reviewer can change the benchmark, grant shell access, publish code,
approve a review, or merge.

Selection is deterministic: only patches that passed the independent
regression/held-out evaluator with a measured improvement qualify. Highest
score wins, then smaller patch bytes and stable model ordering. Results,
patch identities, critic observations and request counts are stored in
private local receipts.

Publication is intentionally absent from this pool entrypoint. The best
candidate must be independently reviewed, tested and explicitly submitted
through an authorized Draft PR/MR workflow before deployment. The service
never replaces its own running code.

Configuration example: harness/examples/provider-multi-model.json.
Set sourceDisclosureApproved true only for public/authorized source and
explicitly approved model routes. No secrets should be committed. A model
being listed as available does not mean it is free to call.

Plan (no model request):

    node harness/pool/runner.mjs plan --config /private/pool.json --policy /private/policy.json --source /path/to/git --ref main --eval-dir /private/external-tests --task-file /private/goal.txt

Make bounded candidate proposals:

    node harness/pool/runner.mjs propose --config /private/pool.json --policy /private/policy.json --source /path/to/git --ref main --eval-dir /private/external-tests --task-file /private/goal.txt

Contract tests:

    node --test harness/test/pool.test.mjs

The installed mini PC example uses OmniRoute routes for NVIDIA models,
SearXNG and a dedicated Playwright browser. The generic code does not require
those services. A synthetic test only verifies multi-route selection; a
live-model test must be recorded separately.


## Persistent local staging (explicitly operator enabled)

An operator-owned private config may enable a local staging directory, without
enabling any remote push or merge:

    "pool": {
      "maxModels": 3,
      "maxRequests": 16,
      "minDelayMs": 4000,
      "critic": true,
      "localStaging": {
        "enabled": true,
        "directory": "/absolute/private/harness-stages"
      }
    }

If all frozen benchmark cases already pass, the controller runs a single
preflight and **does not call any LLM**. If a model earns a strictly better
candidate, the trusted staging gate clones the pinned source a second time,
validates patch integrity and scope, runs the independent project tests plus
the entire frozen external evaluator, commits to a new private local
harness-stage branch, and updates an atomic current.json pointer. The original
source remains untouched and no branch is pushed.

Later runs can explicitly use that saved private repository/ref as their new
source, realizing recursive improvement across runs rather than repeatedly
editing the same old baseline. A trusted wrapper must check pointer integrity
and the exact commit SHA before choosing it. A failed verification refuses
stage promotion and retains the previous good pointer.

Source integration examples and the Git-enabled isolated verifier image
recipe are under harness/docker/node24-git-verifier.Dockerfile. The verifier
image must be built/provisioned independently and kept on the trusted host.

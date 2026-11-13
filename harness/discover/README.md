# Continuous independently verified self-improvement

This optional controller fills the missing step in the portable Harness:
discovering a new reproducible defect without waiting for the operator to
manually add the next evaluation test.

## Closed loop

1. Load the independently verified pinned local Git staging commit.
2. Explore the next two or three deterministic model/tool property probes:
   malformed JSON, wrong types, unknown fields, missing required fields,
   invalid enum values, valid calls, unknown tools, and handler exceptions.
   Later runs cycle the same invariant families with fresh input values.
3. Compile bounded tests from trusted code templates, not from arbitrary
   model-generated JavaScript. Run each test twice against a separate trusted
   reference oracle. It must pass both times.
4. Run the same test twice against the actual Harness engine. Only a
   deterministic failure is classified as a discovered defect.
5. Build a new, SHA-256-frozen evaluator from the previously trusted
   regression/holdout tests, learned fixed cases and the new failing case.
   All old behaviors must still pass; otherwise halt rather than disguise
   an existing regression as a new improvement opportunity.
6. Use the explicitly approved model pool to propose bounded candidate
   patches against identical pinned source. Models cannot read or modify
   the evaluator, controls, CI, project tests or model routing.
7. Independently score patches using network-disabled Docker, keeping only
   changes that add passing tests with no regressions. Verify protected
   project tests and advance to a new private local Git staging commit.
   No remote publishing, merging or deployment is automatic.
8. Independently retest the new stage against the discovered property.
   Only then mark the property as learned and continue discovery next time.

If no defect is discovered the persistent probe cursor advances, rather than
idling forever on an all-green benchmark. If all models fail to fix a
confirmed defect, keep it pending and retry after a three-hour cooldown
instead of burning model quota each hour.

The reference oracle is used only to prove that generated property tests
are satisfiable. A reference pass does not prove the candidate is correct:
the independent candidate evaluation and regression suite still decide.

## Private operator configuration

Extend a private, explicitly approved provider pool configuration with:

    "discovery": {
      "enabled": true,
      "stageRoot": "/absolute/private/local-stages",
      "stateDir": "/absolute/private/discovery-state",
      "baselineDirectory": "/absolute/private/trusted-fixtures",
      "baselinePolicy": "/absolute/private/trusted-policy.json",
      "probesPerRun": 2
    }

The prior baseline policy must include an independently tested protected
test command and evaluator images already present on the host. No API key
must be stored in this JSON; model keys remain in private environment
variables. Any paid model route requires prior operator authorization.

One bounded cycle:

    node harness/discover/controller.mjs /private/operator-pool-config.json

The controller stores an owner-only state.json with cursor, pending failure,
retry time, and learned properties. A private local exclusive lock protects
one controller instance. Stale locks are NOT automatically stolen after
a crash. Model pool limits and per-model feedback isolation remain in place.
This is local and does not lock unrelated machines or agents.

## Tests

    node --test harness/test/discovery.test.mjs
    HARNESS_INTEGRATION=1 node --test harness/test/discovery.test.mjs

Tests exercise cursor advancement, frozen evaluator building, three-hour
backoff, model-pool handoff, learning after verified promotion, and
actual offline Docker reference-vs-candidate reproduction.

## Limitations

Trusted probe families cover the model/tool contract but are not a general
AI bug oracle, vulnerability scanner or universal evaluator. Benchmark
templates themselves require independent human review before extension.
The model cannot supply arbitrary executable tests or change grading
criteria. Frozen tests are not a replacement for source review, security
testing, full CI or the relevant Unity two-editor field test.

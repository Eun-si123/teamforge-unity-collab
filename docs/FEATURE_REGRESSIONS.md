# Product feature regression checks

All contributors use the same repository-owned product tests.
The map at [scripts/feature-contracts.json](../scripts/feature-contracts.json)
covers three high-risk areas and their actual regression tests; it is not
exhaustive. AGENTS.md and CODEMAP.md retain project instruction and source
navigation ownership.

TeamForge does not run comparative AI-agent experiments. Keep model,
prompt, harness, productivity and cost benchmarks out of product CI;
retain independent code review and actual product regression evidence.

## Commands

- python3 scripts/agent_feature_map.py validate — checks schema and real paths.
- python3 scripts/agent_feature_map.py impact --base SHA --head SHA —
  reports changed covered areas, relevant tests, unmapped code and
  separate field-evidence requirements.
- python3 -m unittest discover -s scripts -p test_agent_feature_map.py —
  includes negative controls for misleading/malformed map entries.
- python3 -m unittest discover -s scripts -p test_agent_regression_evidence.py —
  verifies actual regression selection and evidence handling.

The feature map alone is NOT an executor or evidence source. The separate
agent_regression_evidence.py runner selects impacted, checked-in Node regression
files and runs them with the existing locked project dependencies inside the
read-only GitHub PR workflow. It writes an exit-code-, SHA- and log-hash-bearing
receipt for the actual checked-out commit, fails the PR check if a selected
test fails or times out, and keeps manual/Unity/physical evidence NOT RUN.
It does not claim to test unmapped features. For local reproduction use:
python3 scripts/agent_regression_evidence.py run --base BASE_SHA --head HEAD_SHA.

A test path
existing does not mean it passed. A changed production file without a
changed test is a review prompt, not automatically a defect: existing
regressions can already exercise the change. The authoritative CI
and named Test Lab run the real tests; physical Windows/Unity evidence
remains separate and must never be promoted from source CI.

## Repeated defect workflow

1. Reproduce a concrete failure with an independently observable fixture.
2. Add a regression that fails on the original source (or record why this
   cannot be automated), then fix production behavior.
3. Add the regression to existing product CI and the focused feature map if
   it is stable and important. Keep broad code navigation in CODEMAP.md.
4. Compare before/after exact commits and failure modes. The reviewer
   cannot replace the runner output with a self-reported PASS.

# TeamForge hybrid GitHub / NVIDIA agent harness (experimental)

**Status:** source implementation in stacked Draft PR #537 (depends on #536). Not deployed or scheduled; no tested coding E2E or automatically published AI PR yet.

This intentionally composes existing, well-tested capabilities rather than writing a second agent runtime.

| Layer | Reused advantage | Boundary |
| --- | --- | --- |
| **OpenCode 1.19.5** | Coding tool loop, file reading, context handling and editable workspace | Model never receives GitHub credentials, host shell or user home |
| **OmniRoute** | Provider selection, NVIDIA account routing, rate control and usage policy | Dedicated inference-only key, exact allowlisted models, no paid automatic fallback |
| **TeamForge work queue** | Issue readiness, other-agent claims and PR references | Issue selection remains explicit; a local lock is **not** a distributed lease |
| **OpenHands-style isolation** | Disposable workspace / strict container separation | Existing Docker network + image must be independently verified |
| **Codex-style evidence** | Diff restrictions, syntax/test gates, independent review, checkpoints | Model completion is not equivalent to passing CI, Unity E2E or physical field tests |

## Execution modes and safe defaults

All commands are run from a trusted operator terminal in the checked-out repository.

```bash
# Existing advisory reviewer, never publishes unless called explicitly with --publish
node github-agent/harness-runner.mjs plan --repo Eun-si123/teamforge-unity-collab --pr 536
node github-agent/harness-runner.mjs review --repo Eun-si123/teamforge-unity-collab --pr 536

# New OpenCode + OmniRoute coding harness; review only, no model call
node github-agent/opencode-runner.mjs plan --issue 531 --files server/src/example.mjs

# Real model run: after operator has provisioned private network and dedicated API key
export OMNIROUTE_GITHUB_KEY_FILE=/absolute/private/path/nvidia-github.key
node github-agent/opencode-runner.mjs develop --issue 531 --files server/src/example.mjs --test 'node --test server/test/example.test.mjs'

# Only after independently reviewing the candidate, requesting --publish permits a Draft PR.
# No auto-merge; this writes to GitHub and should be a deliberate operator action.
# node github-agent/opencode-runner.mjs develop ... --publish
```

Paths above are **examples**, not proof those specific source files exist. All files must already be present on the selected Issue's current `main` checkout. The only executable test form currently allowed is `node --test <existing-file>`; tests relying on unavailable dependencies will fail closed.

### One-time operator prerequisites (not performed automatically)

- Pin a dedicated **GitHub-only** OmniRoute key through the local dashboard: restrict to the NVIDIA connections, explicitly checked models, no management scope, no auto-combos, quota ceilings and disabled paid fallback. The key must be stored in a private 0600 file. Do not copy any S640 or Discord secret.
- Confirm each model is entitled to non-billable developer usage on the connected NVIDIA account. A listing in `/v1/models` is **not** proof of successful inference, tool calling or pricing.
- Prepare a **separate IPv4-only internal Docker bridge** named `teamforge_omni_internal`, containing *only* the existing `omniroute` container. Do not reuse or modify the S640 research bridge. The existing OmniRoute's upstream attachment must remain intact. The runner verifies `Internal=true`, IPv6 disabled and gateway membership, and fails closed otherwise; it does not create or connect networks.
- Ensure local `gh`, Git, Node 22+, `docker`, existing `node:24-bookworm-slim` test image, the existing `local/s640-opencode-readonly:20261103` image, and the operator's `/home/eun/.local/bin/opencode` binary. The code intentionally does not download images or upgrade binaries.
- Confirm the chosen OpenCode V1 config works with the actual binary. This is based on the previously observed S640 OpenCode v1 provider configuration, **not a claim that the new profile has completed a live tool call**.

### Why the isolation matters

The agent can read the disposable public TeamForge clone and edit only files inside its container's workspace through OpenCode's controlled edit tool. Shell, web, browser, external directories, subagent launching and external MCP tools are denied in the generated V1 config. The container is unprivileged, read-only outside its workspace, with temporary home and resource caps, and the Git directory is explicitly mounted read-only. It receives *only* the inference API key. The container cannot reach GitHub, and Github CLI runs on the trusted host.

After OpenCode finishes, a trusted controller refuses deleted/renamed/untracked/extra files, rejects diffs beyond the limit, runs JS syntax checks, and runs an independently selected test in another network-disabled read-only Node container. Only with `--publish` and fresh main/Issue checks does the trusted host create a new branch and **Draft** PR. The model cannot auto-merge or change protected branch settings.

### Work state / recovery

- PR reviews use a stable hash of `repo + PR number + exact head SHA`, a local exclusive directory lock and an atomic JSON receipt. A changed PR head invalidates the prior model result.
- Issue development uses a separate per-Issue lock and a private JSON checkpoint (running, tested, blocked, draft_pr_created). If a crash leaves a lock, do **not** delete it automatically: verify the active process, repository PRs, and any partial output first.
- Retryable model errors are classified; a model fallback is permitted only if the disposable clone has no modifications. HTTP 401/403/404 and unknown failures block rather than spinning repeatedly. This is distinct from OmniRoute's own upstream rate controls.
- No unattended schedule is installed. Existing TeamForge hourly development and PR-management tasks remain unchanged. The existing TeamForge issue queue has advisory claims, not distributed atomic ownership; autonomous recurring code writes require an additional verified lease protocol.

### Tests and remaining gaps

CI validates the pure configuration/permissions, model allowlist, path rules, Docker argument generation, review-head identity, cooldown decisions and deterministic CLI parsing. Live end-to-end checks remain outstanding: NVIDIA tool-call correctness, restricted-key authorization, isolated network reachability, sandbox OpenCode edits, source+test validation on a real Task, and GitHub Draft PR submission. CI cannot prove those alone.

Security limitations to improve before unattended use: signed image/binary provenance, protecting non-workspace mounts against all indirect symlinks, network egress enforcement and LLM prompt-injection resistance in real tool traces, a real atomic distributed Issue lease, and independent two-editor Unity field verification for TeamForge changes.

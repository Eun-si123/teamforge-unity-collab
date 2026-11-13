# GitHub ↔ NVIDIA via local OmniRoute (opt-in)

Small advisory prototype for GitHub PR review and issue-scoped **Draft PR** patch proposals.
It uses the **existing** OmniRoute OpenAI-compatible endpoint and GitHub CLI.
No outbound public tunnel, webhook endpoint, GitHub Action token, new provider, or credentials in Git are needed.

## Security and eligibility

- Start on **public** repositories. Private repositories are refused unless the operator deliberately sets `OMNIROUTE_GITHUB_ALLOW_PRIVATE=1`, because source is forwarded to NVIDIA.
- NVIDIA-only fixed model list. No `auto/*` combo and no non-NVIDIA paid fallback. Availability, free developer-tier eligibility and API quotas are external and must be checked per account.
- Prefer a **dedicated inference-only API key** created in OmniRoute's API Manager with **restricted models**, **restricted NVIDIA connections**, no auto-combos, no management permission, and bounded usage/rate limits. Store it in a local `chmod 600` file; set `OMNIROUTE_GITHUB_KEY_FILE=/absolute/path`. Alternatively set `OMNIROUTE_GITHUB_API_KEY` in a private process environment. Never commit either.
- Requires local `gh auth login`, Node.js 22+, Git, Docker (for the coding test), and OmniRoute at `127.0.0.1:20128/v1`.
- No automatic scheduling or comments by default. Exactly `--publish` permits a PR comment or Draft PR. **No merges or release actions**, and no changes to project working copies.
- PR review is skipped when its diff exceeds 58KB rather than implying the entire PR was checked. Generated code is limited to 1–6 explicitly supplied existing files (22KB each); all target paths, patch shape, and `git apply --check` are verified. A controlled test command is mandatory before a Draft PR, executed in a network-disabled, unprivileged Docker container with only the temporary clone mounted. The `node:24-bookworm-slim` image must already exist; it is not pulled automatically.
- Model output is **untrusted**. It is not an approval or a replacement for independent review, source checks, physical Unity tests, or proper authorization. Issue/PR content may attempt prompt injection; the bridge never executes generated shell commands.
- Do not treat a development/test free API as a production entitlement. NVIDIA hosted developer APIs are for prototyping and testing per NVIDIA terms.

## Usage

```bash
node github-agent/omniroute-github.mjs review --repo Eun-si123/teamforge-unity-collab --pr 535
node github-agent/omniroute-github.mjs review --repo Eun-si123/teamforge-unity-collab --pr 535 --publish
node github-agent/omniroute-github.mjs develop --repo Eun-si123/teamforge-unity-collab --issue 531 --files scripts/test-lab.mjs,scripts/test-lab.test.mjs --test "npm run validate"
# Add --publish only when ready to push the tested branch and open a Draft PR.
node --test github-agent/omniroute-github.test.mjs
```

**Results and limitations:** `review` prints JSON with grounded findings and source SHA; `develop` builds a temporary shallow clone, requests a bounded unified diff and validates it. Without `--publish` it retains the temporary workspace and prints its location. The model may refuse, issue an invalid patch, or lack confidence; the tool fails closed rather than claiming success. Github source and files are only sent after eligibility checks.

**Not implemented:** autonomous issue selection, recurring timers, cross-run PR review queue, unattended PR selection, unattended merging, Copilot integration. These need separate validation and should not be inferred from this prototype.

## Hybrid Harness (OpenCode + OmniRoute + GitHub)

The OpenCode-backed coding workflow and checkpointed read-only review controller are specified in [HARNESS.md](HARNESS.md). Their entry points are `opencode-runner.mjs` and `harness-runner.mjs`. They reuse the installed OpenCode agent engine rather than rewriting its tool loop, and default to **no publication**. `opencode-runner.mjs` is currently restricted to TeamForge's public repository and a bounded pre-existing independent Node test file. A dedicated inference-only NVIDIA key and an isolated, internal-only Docker bridge must be provisioned separately. No autonomous scheduling or tested live coding E2E is claimed.

```bash
node github-agent/opencode-runner.mjs plan --issue 531 --files server/src/example.mjs
node --test github-agent/omniroute-github.test.mjs github-agent/harness-core.test.mjs github-agent/opencode-harness.test.mjs
```

The `server/src/example.mjs` path above is a placeholder, not an existing-file assertion; use paths verified in the repository. The original `omniroute-github.mjs` remains a small, standalone review/patch adapter for backwards compatibility. The OpenCode harness supersedes its one-shot AI patch generation as the preferred future implementation once the runtime gates pass.

# Portable Agent Harness (experimental)

An independent coding-agent runtime. There is NO OpenCode, Codex, NVIDIA, GitHub, GitLab or other single-vendor runtime dependency in the core. Models, API endpoints, credentials, Git sources, verifier images/commands and publication destinations are configured by the operator. The harness is separately reusable from the existing github-agent adapter.

## Design references and original implementation

| Public reference | Adopted architectural idea |
| --- | --- |
| [OpenAI Codex open harness](https://developers.openai.com/blog/codex-as-a-platform) (Codex CLI Apache-2.0) | Bounded agent/tool loop, context limits, execution and approval separation |
| [OpenCode](https://github.com/anomalyco/opencode) (MIT) | Separate read-only and editing capabilities, provider-independent agents |
| [Google Gemini CLI](https://github.com/google-gemini/gemini-cli) (Apache-2.0) | Extensible tools and explicit execution policy |
| [OpenHands Agent SDK](https://github.com/OpenHands/software-agent-sdk) (MIT) | Environment isolation, verification and durable task records |
| [Anthropic Agent SDK](https://github.com/anthropics/claude-agent-sdk-python) and [sandbox runtime](https://github.com/anthropics/sandbox-runtime) | Tool authorization and sandbox boundaries |

These references informed design choices; source code was independently written, **not copied**. Publishing a Claude Code repository does not imply its entire internal runtime is freely available for copying.

## Features

- Configurable OpenAI-compatible Chat Completions or Anthropic Messages providers. API key names are provided in configuration and their values are read from the environment. Exact approved model routes only. Several accounts may expose the same model; cooldown after 429/5xx applies to each configured route separately.
- Model-independent, multi-turn tool-calling loop (max 12 turns / 28 tool calls by default, bounded context and tool output).
- Constrained file listing, reading and searching; editing only specified pre-existing Git-tracked paths through checked unified diffs. No arbitrary shell, web access, package installation, or Git push tool exposed to the model.
- Disposable clone of **any valid Git source**, including a local repository, GitHub or GitLab. A precise initial Git HEAD is checked; the original repository stays unchanged.
- Model-independent verification in a pre-existing Docker image with no network, read-only source mount, no extra capabilities, non-root user and bounded resources. Operator config chooses verifier image, argv and observable success marker; the model cannot change the verifier. For Node tests, default verifies an actual nonzero test count.
- Atomic owner-only receipts and task lock; no silent recovery or automatic lease takeover. A private patch artifact is saved after validation.
- Explicit optional Draft PR/MR creation through a GitHub CLI or GitLab CLI publisher plugin, only when the operator adds --publish and all checks succeed. No auto-merge, scheduled daemon or automatic edits to existing project trees.

## Config

Copy [example provider-neutral.json](examples/provider-neutral.json), replace all placeholders and explicitly approve real model routes. The example refuses live calls until edited: sourceDisclosureApproved=false and approved=false. No credentials must be saved to this JSON.

A route uses protocol = openai-compatible with a compatible /v1 endpoint, or protocol = anthropic-messages with Anthropic's Messages API host. Use apiKeyEnv to name an already available secret environment variable. Set sourceDisclosureApproved=true only when authorized to forward the selected source to every configured provider. A local proxy may relay that data to third parties.

A configured model may be paid: this harness **does not assume free usage** or silently add non-allowlisted paid routes. Verify provider pricing, quota and function-calling ability before each production integration. Endpoints supporting only the newer OpenAI Responses API need a separate adapter.

The optional verification object has the following example values for a C# test:

    "verification": {
      "image": "mcr.microsoft.com/dotnet/sdk:8.0",
      "command": ["dotnet", "test", "Example.csproj", "--no-restore"],
      "expectedText": "Passed!",
      "timeoutMs": 180000
    }

That container image and its dependencies must already be installed; the harness does not fetch images or install dependencies. For Unity batchmode, use a prebuilt Unity test image, a compatible preselected command and a reliable output marker; this does **not** imply Unity Editor or Windows two-PC tests are covered by the sample.

## CLI

Plan (no network or credential access and no state changes):

    node harness/cli.mjs plan --config /private/harness.json --source /path/to/git/repo --ref main --task-file /path/task.txt --files src/module.mjs --test-file test/module.test.mjs

Read-only code review with the authorized model (no PR comment is automatically posted):

    node harness/cli.mjs review --config /private/harness.json --source https://git.example.com/org/project.git --ref main --task-file /path/task.txt --files src/module.mjs

Create a candidate patch using model tool calls, then run independent offline validation:

    node harness/cli.mjs develop --config /private/harness.json --source /path/to/git/repo --ref main --task-file /path/task.txt --files src/module.mjs --test-file test/module.test.mjs

Paths are examples, not claims about existing files. The --test-file must be a distinct tracked path the model is forbidden to edit. Without --publish the result is only a private patch and JSON receipt. Publishing also requires a publisher config, a remote Git source, valid host CLI credentials, and a fresh matching base HEAD.

## Test

    node --test harness/test/harness.test.mjs

Full local integration with deterministic fake LLM HTTP service (no paid model, GitHub or cloud API):

    HARNESS_INTEGRATION=1 node --test harness/test/integration.test.mjs

The integration test exercises actual tool calls, patch application, independent offline Docker testing, receipts and original working-tree preservation. It does **not** prove real commercial model coding quality or the untested publication adapters.

## Explicit remaining gates

Real end-to-end model and provider tests, quota/billing enforcement, external source-disclosure review, independent model/tool permission penetration checks, pinned container image provenance, robust distributed task leasing/recovery, publisher PR/MR read-after-write, and relevant project CI/Unity physical field tests are still needed before unattended automation. No recurring job, auto-publish or auto-merge has been installed by this prototype.

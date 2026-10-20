# Shared Agent Control Plane (local MVP)

**Scope:** Optional, independent maintainer infrastructure for TeamForge, BetterNet and DataNetShare. This is **not** Unity product runtime, not the existing hourly queue audit, and **not** an autonomous coding/merge engine. Its *source* lives in the public TeamForge repository; its **private GitHub settings, SQLite database, lease tokens and agent progress must remain on the trusted miniPC**.

## What an LLM can query

The read-only MCP stdio endpoint at `mcp_stdio.py` exposes:

| Tool | Source of truth |
| --- | --- |
| `get_project_status(project)` | Live GitHub default branch, Issues, open PRs |
| `get_next_tasks(project)` | Live Issue classification + locally held lease status |
| `get_task_context(project, issue)` | Live Issue detail, PR references (untrusted task data) |
| `get_agent_progress(project)` | Local leases/checkpoints with live GitHub status |
| `get_last_checkpoint(project, task)` | Local last checkpoint + live GitHub branch HEAD comparison |

Projects are addressed by stable aliases: `TeamForge`, `BetterNet`, `DataNetShare`. Do **not** embed non-public repository names or GitHub authentication in this public code. Github CLI `gh api` is invoked in read-only GET mode using the local user's existing authorization, with a bounded page budget (up to 500 items per listing) and an 18-second timeout. GitHub/API errors fail closed. Live private Issue content is returned **only to local authorized callers**, never persisted in a public artifact.

Run as a trusted local process, using stdin/stdout MCP JSON-RPC messages (one JSON message per line):

```bash
python3 /opt/agent-control-plane/mcp_stdio.py
```

**No TCP port, web UI or unauthenticated HTTP listener exists.** Do not put this MCP on a public transport or grant it to untrusted public-fork GitHub jobs. The MCP endpoint is **read only**: it does not expose lease tokens, write to GitHub or enable automatic code editing.

## Atomic local task leases (CLI only)

The SQLite database lives under `/mnt/storage/agent-control-plane/state/` (HDD, private 0700 directory and 0600 DB); the application code can reside on NVMe in `/opt/agent-control-plane/`. It uses `BEGIN IMMEDIATE` and a transactional fencing number to stop concurrent clients of **this same database** acquiring the same task or overlapping source directories. Resource paths such as `server/` or `unity-package/Editor/` are checked for safe repository-relative format and directory-prefix overlaps. Work on different repositories is independently tracked.

```bash
python3 /opt/agent-control-plane/cli.py status --all
python3 /opt/agent-control-plane/cli.py next-tasks --project TeamForge
python3 /opt/agent-control-plane/cli.py task-context --project TeamForge --issue 303
python3 /opt/agent-control-plane/cli.py progress --all

# Authorized agent, after inspecting current source/PR/Issue:
python3 /opt/agent-control-plane/cli.py lease-acquire \
  --project TeamForge --task '#303' --actor trusted-worker-a \
  --branch agent/my-existing-branch --surface 'unity-package/Editor/' --ttl 1800

# The acquire output contains a CAPABILITY TOKEN. Keep it private in memory
# or a protected process environment, NEVER in a GitHub Issue, CI output or logs.
# export AGENT_LEASE_TOKEN=<redacted>

python3 /opt/agent-control-plane/cli.py save-checkpoint \
  --project TeamForge --task '#303' --fence 1 \
  --head 0123456789abcdef0123456789abcdef01234567 \
  --test 'unit PASS' --next 'Inspect live branch and continue bounded task'

python3 /opt/agent-control-plane/cli.py lease-renew \
  --project TeamForge --task '#303' --fence 1 --ttl 1800

python3 /opt/agent-control-plane/cli.py lease-release \
  --project TeamForge --task '#303' --fence 1
```

The acquired lease capability is the only credential for renew, checkpoint and release. It is **never** included in list/progress/MCP outputs. Always verify the lease fence and the actual source HEAD before writing code or creating a PR.

### Expiry, crash and recovery

- TTL is bounded 60–3600 seconds; check, renewal, release and checkpoint require the exact current capability and fence. Expired capabilities **cannot** write.
- An expired task remains **EXPIRED_NEEDS_REVIEW**, with its overlapping source surfaces locked. No automatic takeover/force unlock (another agent may have unsaved source edits).
- `lease-recover` requires the old fencing number, stored last checkpoint SHA and branch, plus `--confirm-inspected`. The CLI independently checks the exact current GitHub branch HEAD equals the stored checkpoint before granting a **new** capability/fence. It does **not** inspect arbitrary uncommitted worktrees, so the operator must inspect that state independently.
- A genuine mismatch is a blocker, not permission to reset or overwrite the branch. Completed tasks must be explicitly released.
- **Atomic only for clients using this one SQLite file.** Other GitHub bots, human collaborators, disconnected S20 runners and direct GitHub writes can race. Cross-machine writer synchronization needs an authenticated local IPC endpoint with verified identity/authorization, or a GitHub CAS ref protocol; it is **not implemented** by this read-only MCP.

## Private project mapping

Private GitHub repository identifiers must not be checked into the public repository. On the authorized miniPC host, store the mapping in the owner-only file `/mnt/storage/agent-control-plane/state/private-repos.json`, e.g.:

```json
{"BetterNet":"<owner>/<private-repository>"}
```

Replace placeholders on the host only, with a valid GitHub repo owner/name and `chmod 600`. Override path only using the local environment variable `AGENT_CONTROL_PRIVATE_CONFIG`. A missing, unsafe or world-readable mapping is rejected. `gh` must be separately authenticated for repositories the local user is allowed to read. Do not copy `gh` credentials into other runner accounts.

## Installation / update on the miniPC

- Python 3.11+ (stdlib only), `gh` CLI authenticated locally, mounted HDD.
- Install only the source `*.py` into `/opt/agent-control-plane` (NVMe); put runtime state and private config in `/mnt/storage/agent-control-plane/state` (HDD).
- The program deliberately has **no daemon or port**. Trusted clients can spawn `mcp_stdio.py` through their MCP host. A control-plane process/worker is not automatically started by GitHub Actions.
- Use `python3 -m unittest discover -s tools/agent-control-plane/tests -v` from the source checkout, or `npm run test:agent-control`.
- Never store unredacted Issue bodies, credentials, lease capabilities, external GitHub token, or private paths in a public Actions artifact.

## Current non-capabilities / design boundary

This MVP does **not** trigger an LLM API, run autonomous hourly development, write to other repositories, create GitHub Issues/PRs or merge code. It makes context retrieval and **participating** local task claims deterministic. It is suitable for building those higher-trust systems next, but it must not be misrepresented as a deployed cross-host distributed worker scheduler.

A validation run proves only the source/client scenario executed. It does not prove TeamForge's Unity/Windows physical test matrix, release readiness or any arbitrary third-party agent's compliance.


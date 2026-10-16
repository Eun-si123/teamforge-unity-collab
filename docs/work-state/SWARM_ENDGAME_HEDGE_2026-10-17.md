# Endgame tail hedge source prototype (2026-10-17)
- Worktree: /home/eun/work/teamforge-endgame-hedge, branch feat/swarm-endgame-hedge-20261017, starting main cafa702. Original dirty locale-picker worktree preserved.
- Goal: behind an explicit opt-in advanced sync flag, issue at most one delayed speculative duplicate Chunk request for the final two pending unique Chunks to a **different eligible peer**. Use existing signed Manifest, source trust, SHA-256 checks, cooldown/pacing and final activation. Only one valid response is ever stored, completed or announced.
- Guardrails: default mode off. No extra request with one source, no duplicate IDs, failed/invalid advertised inventory still fails closed. Hedging may consume extra bandwidth; not proof of improvement. No change to packaged r8 FIELD BLOCKED status. Test valid race, corrupt/late peer, cancellation and fallback, resume, source metrics and no post-return writes.
- Checkpoint state: plan only; tests/CI not yet run.


## Implementation evidence checkpoint

- New `endgameMode = "hedged"` is opt-in, defaults `off`. It races a SHA-256-verified second eligible distinct Seed only after the first has waited 180ms on at most the last two pending Chunks, settles both requests and writes once.
- Advanced `sync --endgame-mode off|hedged`, benchmark comparator, endgame counters and API forwarding implemented. No new wire/Invite/identity/signed Manifest fields or changes to published r8.
- Focused Swarm tests: **39/39 pass**, including fast verified secondary, corrupt secondary, duplicate Seed labels/resume and caller cancellation.
- Focused loopback benchmark tests: **10/10 pass**. Full Project Peer/Server CI and GitHub exact-head checks remain to be recorded.

- The extra fallback test rejects two bad speculative responses before succeeding from a new verified request; at most one hedge per pending Chunk and honest count even when that hedge fails.
- Maintainability review reports a **non-blocking source-size warning** in pre-existing long `project-peer/src/project-peer.mjs`; no unrelated refactor introduced.

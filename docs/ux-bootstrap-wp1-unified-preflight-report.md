# TeamForge UX Bootstrap WP1 — Unified Preflight + Dependency Bootstrap

Date: 2026-08-13 KST  
Baseline: approved UX Bootstrap WP0 candidate  
Scope: WP1 only

## Result

WP1 implements the frozen WP0 `inspect` seam and its `repair_dependencies` failure action without replacing the existing Server or Project Peer CLI. The new bootstrap entry point imports no third-party package, so it can diagnose and repair a missing `ws` installation instead of failing during module loading.

```text
npm run preflight -- --launch-settings <absolute-or-relative-file>
npm run repair:dependencies -- --server-port 5080 --seed-port 0
```

The first command is read-only. The second is an explicit local mutation: the npm script supplies `--confirm-repair`, acquires a workspace repair lock, refuses to proceed while a configured fixed TeamForge port accepts connections, and runs a locked clean install only for a missing or stale dependency target. Existing `teamforge-project-peer` commands and their confirmations remain unchanged.

## Implemented checks

| Check | Behavior | Frozen failure mapping |
| --- | --- | --- |
| Node runtime | Records the absolute `process.execPath`; requires Node 20+ | `dependencies_not_ready` / `repair_dependencies` |
| npm | Resolves an absolute `npm-cli.js` and executes it through the absolute Node executable | `dependencies_not_ready` / `repair_dependencies` |
| lockfiles | Checks the root workspace lock plus Server and Project Peer locks | `dependencies_not_ready` / `repair_dependencies` |
| dependencies | Compares direct manifest/lock contracts and installed versions for both workspaces | `dependencies_not_ready` / `repair_dependencies` |
| launch settings | Uses the existing strict, secret-free launch-settings parser | `launch_settings_invalid` / `regenerate_launch_settings` |
| source Project | Resolves an absolute path and validates bounded `ProjectSettings/ProjectVersion.txt` as Unity `6000.3.x` | `launch_settings_invalid` / `regenerate_launch_settings` |
| managed root | Rejects links/non-directories; checks `W_OK` on an existing root or nearest existing parent without creating the directory | `project_not_initialized` / `resolve_managed_root_or_publish` |
| ports | Makes a bounded TCP connect probe only; an accepting listener is `occupied_unverified`, never adopted or killed | `port_conflict` / `inspect_port_owner` |

`not_requested` is not reported as PASS. A fixed Direct Seed port is checked only when supplied; the current stable Project Peer default is port `0` (OS-selected), so the default Seed probe is explicitly `not_requested`.

## Dependency repair policy

Repair is deliberately separate from inspection because `npm ci` removes an existing `node_modules` directory before installing. The operation therefore:

1. requires explicit confirmation;
2. validates Node, npm, lockfiles, and configured ports before mutation;
3. creates one non-overwriting workspace repair lock;
4. skips a target that already matches its lockfile;
5. runs absolute Node + absolute npm CLI with `ci --ignore-scripts --no-audit --no-fund --workspaces=false` only for a repairable target; the last flag prevents one child-workspace clean install from removing the other child's installation;
6. re-inspects both installations before returning `idle`;
7. never starts, reuses, stops, or kills a Server or Seed.

The development strategy remains an external Node/npm runtime. A future bundled-runtime distribution is recorded as `not_implemented`; WP1 does not disguise that limitation.

## Safety and compatibility boundary

- Realtime Protocol v1, Project Transfer Protocol v1, manifest schema v1, signed invite/trust, verified staging, atomic activation, Authority ordering, and Direct-only Project payload behavior are unchanged.
- The existing Project Peer CLI binary remains present. Its Publish and Publisher-trust confirmations are untouched.
- URL validation was moved into a dependency-free policy module with the same behavior so strict launch-settings inspection works before `ws` is installed.
- Port inspection proves only whether TCP accepts a connection. It does not identify TeamForge health, compatibility, PID ownership, or safe reuse.
- No process lifecycle, one-click Host/Join, UI, launcher, project open, persistent recovery, alternate transport, NAT traversal, relay, or Component Sync behavior is present.

## Official/primary-source decisions

- [npm `ci`](https://docs.npmjs.com/cli/v11/commands/npm-ci/) documents that a lockfile is required, manifest/lock disagreement fails, an existing `node_modules` is removed, package manifests/locks are not rewritten, and `--ignore-scripts` disables lifecycle scripts. This is why repair is explicit, locked, conditional, and never concurrent with a configured listener.
- [Node.js `process.execPath`](https://nodejs.org/api/process.html#processexecpath) returns the absolute path of the executable that started the process. WP1 records and uses that path rather than relying on the caller's current directory.
- [Node.js `fsPromises.access`](https://nodejs.org/api/fs.html#fspromisesaccesspath-mode) defines `W_OK` as the current-process accessibility probe. The documented time-of-check/time-of-use limitation remains: the actual later write must still handle failure.
- [Node.js system errors](https://nodejs.org/api/errors.html#common-system-errors) defines `EADDRINUSE` as a local address already occupied and `ECONNREFUSED` as no accepting service. WP1 still does not infer process identity from either result.
- [Unity Cloud Build documentation](https://docs.unity3d.com/kr/2021.2/Manual/UnityCloudBuildVcsPlastic.html) uses `ProjectSettings/ProjectVersion.txt` for automatic Unity version detection. WP1 preserves the product's existing stricter Unity `6000.3.x` rule.

## Validation evidence

New execution evidence in the working candidate:

- Focused WP0-contract + WP1 tests: **9/9 PASS**.
- Server automated tests: **72/72 PASS**.
- Project Peer automated tests: **82/82 PASS** (the prior WP0 suite plus 7 WP1 tests).
- Repository validator: **PASS**, exactly `335` source files, `53` C# sources, Protocol v1.
- Server syntax check: **PASS**.
- Project Peer syntax check: **PASS**, `44` modules.
- Server smoke: **PASS**.
- Direct Transfer smoke: **PASS**, `serverRelayUsed=false`.
- Live read-only preflight against `unity-project`: **PASS**; Unity `6000.3.21f1`, writable parent, port 5080 with no listener; the missing managed-root probe target remained absent.
- Ready-installation repair rerun: **PASS/no-op**, `changed=false` and no `npm ci` repair target.
- WP0 source comparison excluding generated `node_modules`: `6` added, `10` changed, `0` deleted; no Server or Unity source/test file changed.

During the first live clean bootstrap attempt, both child `npm ci` commands exited `0`, but the second child workspace clean removed the first child's dependency installation under npm workspace discovery. The final recheck correctly returned `needs_action`; it was not reported as PASS. WP1 then added `--workspaces=false`, and the fresh-candidate gate must prove both installations survive one repair operation.

Fresh archive hashes, clean install results, parity, tests, checks, smoke, and validator are recorded in the separate output verification report so the archive contents remain immutable while they are tested. Automated results are reported only from executed commands. Unity Editor and multi-machine field checks remain explicitly NOT RUN in WP1.

## Known limitations and NOT RUN

- Unity 6000.3 EditMode: **NOT RUN** in WP1.
- A/B/C multi-Editor field session: **NOT RUN** in WP1.
- Windows/macOS/Linux end-user launcher execution: **NOT RUN**; no launcher was implemented.
- Live compatible/incompatible Server identity detection and reuse: **NOT RUN / NOT IMPLEMENTED**; WP2 scope.
- Live Direct Seed ownership/reuse/stop: **NOT RUN / NOT IMPLEMENTED**; WP2 scope.
- Real missing-dependency network repair is verified in the fresh candidate gate; a simulated selective-repair unit test separately proves target selection and recheck behavior.
- The writable-root check is a preflight accessibility signal, not a reservation. Filesystem state can change after inspection.
- Repair checks only the configured fixed ports. It cannot prove that no Node process is using the same dependency tree on another or OS-selected port.

## Explicit non-goals retained

WP2 Server/Seed lifecycle, WP3/WP4 one-click UI or launcher, Phase 5 Persistent Recovery, WebRTC, ICE, STUN, TURN, Relay/NAT traversal, Host Migration, Protocol v2, Component Sync, and arbitrary serialized-property sync are outside this candidate.

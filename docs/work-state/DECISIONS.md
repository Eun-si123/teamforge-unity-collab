# Stabilization decisions

## D-001 - 2026-08-04 - Preserve the supplied archive

- Decision: use the ZIP as the sole code baseline, retain it unchanged in Downloads, and edit only a separate working extraction.
- Reason: the master prompt requires provenance, rollback, and fresh-extract evidence.
- Rejected alternative: overwrite or repack the supplied ZIP.
- Impact: no runtime impact; stronger provenance.

## D-002 - 2026-08-04 - Keep Phase 3, product 0.4.1, and wire protocol 1

- Decision: make only backward-compatible stabilization changes. Do not add Phase 4 behavior or bump versions.
- Reason: the verified problems are path interpretation, lifecycle cleanup, and retry correctness, not protocol design.
- Impact: existing Phase 0-3 compatibility and wire format remain unchanged.

## D-003 - 2026-08-04 - Require pre-fix evidence

- Decision: reproduce both known blockers on the unmodified extraction before patching.
- Reason: unsupported root-cause claims and test-only fixes are forbidden.
- Impact: preserved baseline logs support before/after comparisons.

## D-004 - 2026-08-04 - Cancel work instead of extending shutdown timeouts

- Decision: propagate request/response/socket cancellation through reads, throttle timers, drain waits, and shutdown; track and close live sockets; return one cached `stop()` promise.
- Reason: the original supplied abort test failed 8/8 on Node v22.16.0. A larger timeout would leave the leak/race intact. Additional stress evidence showed aborted queued requests retained timers and future bandwidth debt.
- Rejected alternatives: delete/relax the test, treat the Node v24 pass as sufficient, or merely increase its timeout.
- Impact: bounded shutdown and cleanup across supported Node versions without a protocol change.

## D-005 - 2026-08-04 - Keep manifest paths canonical and filesystem conversion explicit

- Decision: remote manifest paths remain strict portable `/` paths. Trusted filesystem-relative inputs and Unity local-package references are converted separately before validation.
- Reason: using host `path.sep` made untrusted manifest acceptance OS-dependent.
- Impact: consistent Windows/Linux security behavior while supporting Unity references written with either relative separator style.

## D-006 - 2026-08-04 - Resolve Unity `file:` references from `Packages`

- Decision: resolve the reference from `dirname(manifestPath)`, permit safe `.`/`..` segments during resolution, and apply final lexical containment plus existing-component real-path checks against the project root.
- Reason: Unity defines local package paths relative to `Packages/manifest.json`; rejecting every `..` incorrectly rejects valid projects.
- Rejected alternatives: resolve from project root or weaken final containment.
- Impact: required Unity compatibility with traversal, junction/symlink, URI, absolute-path, and missing-package rejection retained.

## D-007 - 2026-08-04 - Make retry semantics exact and deterministic

- Decision: accept only strict decimal precise retry headers; retain valid HTTP-date/delta fallback; cap server hints at 60 seconds separately from exponential backoff; order available peers before cooling peers with lexical tie-breaks; report the peer actually selected.
- Reason: malformed precise values, early capping, and history-first ordering could select the wrong wait or peer and emit misleading diagnostics.
- Impact: no wire-version change; more predictable failover and standards-compatible retry behavior.

## D-008 - 2026-08-04 - Support the declared minimum Node version

- Decision: test exact official Node v20.0.0, v22.16.0, and local v24.18.1; replace repository-owned `import.meta.dirname` usage with `fileURLToPath`/`dirname` compatibility code.
- Reason: `package.json` declares `>=20`, so testing only current Node versions is insufficient.
- Impact: broader runtime compatibility, no product behavior change.

## D-009 - 2026-08-04 - Make root clean install a real gate

- Decision: declare the two npm workspaces and commit a root lockfile with the exact existing `ws` dependency resolution.
- Reason: the supplied root `npm ci` deterministically failed because no root lockfile existed.
- Impact: reproducible root install; package-level dependencies and runtime remain unchanged.

## D-010 - 2026-08-04 - Keep generated test state outside candidates

- Decision: put TEMP, TMP, npm cache, Node compile cache, and Unity-generated state in sibling disposable directories.
- Reason: an early clean-copy probe placed `.test-tmp` inside the copied tree, causing a misleading validator count even though all tests passed.
- Impact: final inventory, manifest, ZIP, and fresh-extract evidence will reflect source files only.

## D-011 - 2026-08-04 - Use a Node 20-compatible test suite boundary

- Decision: wrap the server's existing shared `before`/`after` hooks and endpoint-dependent tests in one `describe()` suite; do not change server product code.
- Reason: a minimal exact Node v20.0.0 reproduction proved top-level hooks did not run, while the same hooks inside `describe()` passed. Node v24's top-level behavior differed.
- Rejected alternatives: raise the declared Node minimum, add arbitrary waits, or attribute undefined test state to the product server.
- Impact: test-only compatibility. Exact Node 20 then passed all 37 server tests.

## D-012 - 2026-08-04 - Keep Unity evidence honest when execution is host-blocked

- Decision: record Unity compile/EditMode as NOT RUN after the host approval/usage gate rejected the launch before Unity started; retain static inspection and provide exact manual commands/checklist.
- Reason: retrying indirectly would circumvent the host decision, and a non-started process provides no Unity pass/fail evidence.
- Impact: no source impact. Phase 4 remains forbidden until the user completes the manual Unity gate and explicitly approves progression.

## D-013 - 2026-08-04 - Exercise transport boundaries with real loopback processes

- Decision: add real HTTP 503, TCP reset, stalled-response timeout, live Seed shutdown/failover, and killed receiver-process resume tests instead of relying only on fake clients.
- Reason: the master prompt requires boundary evidence for the field failure modes. The existing tests proved policy but not every real socket/process transition.
- Rejected alternative: relabel the existing simulated/process-equivalent cases as real process coverage.
- Impact: test and validator coverage only; no product behavior changed.

## D-014 - 2026-08-04 - Centralize socket lifecycle listeners

- Decision: keep one close/error listener pair per accepted socket and dispatch aborts through a set of request contexts; make both socket and request cleanup idempotent.
- Reason: a final review reproduced 24 pipelined active handlers, 23 socket close listeners, and `MaxListenersExceededWarning` with per-request listeners.
- Rejected alternatives: raise the EventEmitter listener limit, suppress warnings, or rely on eventual handler cleanup.
- Impact: removes a listener-warning/availability risk without changing HTTP or wire behavior; verified by bounded shutdown and zero-context assertions.

## D-Phase3-Closure-01 — Windows Active path is warning-only preflight

**Decision:** Detect high-risk Windows Active paths before Sync using the exact future Active path plus a documented representative Unity PackageCache headroom. Emit a warning and recommend a shorter managed root; do not mutate LongPaths policy and do not reject safe data transfer.

**Alternatives:** hard fail at a fixed MAX_PATH number; silently rely on Windows long-path support; modify registry policy.

**Reason:** the field failure was an Editor import/environment path expansion issue, while the same verified payload opened correctly from a short root. A hard fail would reject machines/configurations where long paths work, and registry mutation is outside TeamForge's authority.

**Known downside:** the heuristic cannot predict every Unity package-generated path. It is intentionally a conservative usability signal, not a filesystem guarantee.

**Replacement condition:** use a more precise Unity-provided path capability/preflight if Unity exposes one that can be queried before Editor open.

**Test:** pure Windows path-policy regression reproduces the long field root as high risk and the short field root as not high risk.

## D-Phase3-Closure-02 — no-op Publish is blocked by default

**Decision:** when an existing Baseline Publish review has zero added/changed/deleted files, stop with `no_content_changes` and tell the operator to use `seed`. Intentional identical revision advancement requires `--force-new-revision`.

**Alternatives:** preserve unconditional Publish; confirmation text only; silently convert Publish to Seed.

**Reason:** silently converting changes command semantics; unconditional Publish caused a real field operator mistake and unnecessary SyncRequired state. Explicit force preserves advanced workflows without making the dangerous path the default.

**Known downside:** unattended scripts that intentionally publish identical content must add the new force flag.

**Test:** policy regression covers blocked no-op, force override, and changed-content pass-through.

## D-Phase3-Closure-03 — sync bandwidth option names partial-seed upload explicitly

**Decision:** add `--partial-seed-max-bytes-per-second` for Sync. Keep `--max-bytes-per-second` as a compatible Sync alias and as the Seed server upload limiter.

**Reason:** current Sync behavior limits the receiver's temporary partial-seed HTTP server, not incoming download bandwidth. Renaming without alias would be needlessly breaking.

**Test:** alias equality and conflicting dual-option rejection are automated.

## D-406 — Hierarchy edits respect affected parent/subtree locks
**Decision:** Hierarchy operations fail closed not only on a target lock, but also when they mutate a parent child-list locked by another connection; subtree delete additionally checks every deleted object's lock.

**Alternatives reviewed:** target-only lock checks; require explicit locks on every hierarchy operation; ignore parent locks and rely only on revision conflicts.

**Why:** create/reorder/reparent/delete mutate child-list structure even when the target itself is unlocked. Target-only locking lets one editor structurally change a parent/subtree another editor currently owns. Requiring every caller to pre-acquire multiple locks is too invasive for the current Basic Lock UX, so the server treats other-user locks as authoritative conflict guards while exact revision remains the primary ordering rule.

**Known downside:** an editor can be rejected because another user locked a related parent or descendant even if their concrete edits would not ultimately overlap.

**Replacement condition:** a future explicit hierarchy transaction/child-list lock protocol proves necessary from real multi-editor UX data.

**Test:** realtime Server integration covers destination-parent lock, subtree descendant lock, no revision mutation on reject, and successful delete after unlock.

## D-407 — Delete clears stale Presence selection references
**Decision:** after authoritative hierarchy deletion, the server clears any Presence selection that points at a deleted object and broadcasts `presence_updated`.

**Alternatives reviewed:** wait for each Unity client to notice destroyed selection; leave stale references until next Presence heartbeat.

**Why:** deleted identities must not remain advertised as current selections, especially for late/remote viewers. Cleanup is metadata-only and stays inside the existing Presence registry.

**Known downside:** the server updates `lastHeartbeatUnixMs` for the cleanup event even though it was server-triggered rather than a client heartbeat.

**Replacement condition:** Presence gains a dedicated authoritative reference-cleanup event in a later protocol revision.

**Test:** integration selects an object, deletes its parent/subtree, then asserts the selected ID/name are cleared on both peers.

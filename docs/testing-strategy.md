# TeamForge testing strategy

This page describes how TeamForge should choose evidence for risky changes. It is not a coverage target and it does not turn every test class into a mandatory gate for every pull request.

## Principle

Prefer tests that can falsify the important claim over maximizing line coverage or test count.

The repository already has substantial deterministic authority/recovery chaos coverage. Future test work should extend that foundation rather than replacing it with a second overlapping framework without a demonstrated gap.

## Test layers

### Focused unit / integration

Use for narrow protocol, parsing, state-machine, path, manifest, retry, and validation behavior.

### Real-server / process integration

Use when multiple TeamForge processes must agree on behavior or lifecycle.

### Unity EditMode / real-server E2E

Use when Unity Editor state, Scene lifecycle, actual GameObjects, locks, reconnect, or authoritative synchronization are part of the claim.

### Deterministic chaos / invariant stress

The existing authority chaos scripts use deterministic seeds and randomized ordering to exercise invariants such as:

- exactly one authoritative owner for a contested object;
- unauthorized losing-peer mutations are rejected;
- revisions serialize without silent jumps;
- independent object locks do not interfere;
- lease renewal preserves ownership;
- handoff/replay/stale behavior remains fail-closed;
- late join/recovery converges toward authoritative state.

Before adding a new property-testing dependency, identify an invariant or state-space gap that the existing seeded harness cannot reasonably express. If such a gap exists, model/property testing may be added as an extension rather than as a duplicate test stack.

### Transfer interruption / recovery

Use for chunk reuse, resume, immutable previous Active preservation, staging, activation, and source failover.

### Exact release validation

Use for a particular published ZIP, its cryptographic identity, runtime/launcher contents, fresh extraction, and Windows packaged behavior.

### Physical field validation

Use when the real failure surface includes separate machines, Windows process behavior, firewall/LAN state, Unity UI timing, or other conditions CI/same-machine tests do not prove.

## Fault-injection direction

When a bug class repeats, prefer turning it into a reusable fault scenario rather than a one-off manual ritual.

Useful fault classes include:

- socket disconnect/reconnect;
- process termination during receive or handoff;
- stale/replayed/reordered operation attempts;
- lock contention and lease expiry;
- corrupted/mismatched manifest/chunk data;
- invalid or retargeted paths/aliases;
- unavailable Seed/Coordinator endpoints;
- partial staging/activation failure.

A future unified Test Lab may orchestrate these scenarios, but it should call existing production paths and existing focused harnesses instead of creating a parallel mock implementation of TeamForge.

## Performance baseline direction

Performance budgets become useful when broader Component/Inspector synchronization begins increasing update volume.

Prefer a small stable baseline over arbitrary optimization goals. Candidate measurements include:

- Editor update cost and GC allocation;
- server event-loop latency / processing time;
- message count and payload volume;
- hierarchy/snapshot size and apply latency;
- reconnect/late-join convergence time;
- memory growth during long-running collaboration.

Do not claim a regression threshold until a repeatable baseline environment has been recorded.

## Mapping from engineering changes

`quality-gates.json` routes changed paths to recommended validation lanes. `docs/ENGINEERING_GUIDE.md` remains the human decision guide when semantic risk is stronger than the path-based classifier can infer.

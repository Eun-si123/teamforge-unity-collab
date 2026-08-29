# Change plan

Use this template before substantial implementation work. Remove sections that are genuinely irrelevant; do not fill them with boilerplate just to make the plan look complete.

## Problem

What observed behavior, risk, missing capability, or maintenance problem are we addressing?

## Intended outcome

What should be true after the change?

## Scope

### In scope

- 

### Out of scope

- 

## Affected subsystems

Check or list the relevant surfaces.

- [ ] Unity Editor package
- [ ] Realtime Server / authority
- [ ] Project Peer / transfer
- [ ] Windows Launcher
- [ ] Runtime / packaging
- [ ] Release tooling
- [ ] Documentation / repository policy
- [ ] Other:

## Risk classification

- Risk: Low / Medium / High
- Why:

## State ownership / authority

Which process or module owns the affected state? Which layers only observe, cache, or execute effects?

## Invariants that must remain true

- 

## Failure modes considered

Consider partial completion, stale state, duplicate/replayed input, reordering, disconnect, shutdown, restart, bad paths, malformed input, and trust mismatch where relevant.

- 

## Security / trust impact

Does this affect authentication, authorization, secrets, signatures, hashes, paths, untrusted input, project activation, code execution, or other fail-closed checks?

- 

## Compatibility impact

- Protocol/schema change: Yes / No
- Product/runtime compatibility change: Yes / No
- Existing project/session compatibility impact:
- Migration required:

## Implementation approach

Describe the smallest coherent approach. Mention important alternatives that were rejected when the tradeoff matters.

## Required evidence before merge

### Automated

- [ ] Focused tests
- [ ] Subsystem suite
- [ ] Real-server / integration E2E
- [ ] Chaos / property / replay testing
- [ ] Repository / docs / workflow validation
- [ ] Static/security analysis where applicable

Specific checks:

- 

### Manual / Unity

- 

### Physical field evidence

Required / Not required / Deferred

Reason:

## Recovery / rollback

If the change fails or partially completes, what state remains usable? How can the user/developer recover?

## Observability

What logs, diagnostics, error codes, evidence artifacts, or correlation fields are needed to understand success/failure without exposing secrets?

## Documentation plan

Follow `docs/DOCUMENTATION_GUIDE.md`.

- Canonical owner(s):
- Must update:
- Review only:
- Should not update:

## Release impact

- Source-only change / packaged behavior change / release tooling change
- Does an existing ZIP remain representative of current behavior?
- Does a new candidate/artifact identity become necessary?
- Does this open/close/change a field gate?

## Unresolved questions

- 

## Completion evidence

Fill this after implementation.

- Commit/PR:
- Tests actually run:
- Tests not run:
- Field evidence:
- Remaining uncertainty:

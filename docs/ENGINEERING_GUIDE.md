# TeamForge engineering change process

This guide defines how TeamForge changes should be planned, implemented, validated, documented, and reviewed.

The goal is not to add ceremony. The goal is to avoid a common failure mode in AI-assisted and fast-moving development: implementation begins before the important invariants, failure modes, and required evidence have been identified.

For substantial changes, **plan first, then implement**.

## The change lifecycle

Use this sequence for changes that affect behavior, architecture, security, release tooling, persistence, networking, Unity state, project transfer, or other non-trivial surfaces:

1. **Define the problem** — describe the observed behavior, desired outcome, or missing capability.
2. **Classify the change** — identify affected subsystems and risk level.
3. **Identify invariants** — list behavior that must remain true after the change.
4. **List failure modes** — consider how the change can fail, race, partially complete, or leave stale state.
5. **Choose required evidence** — decide what automated, Unity, chaos, release, and physical tests are needed before implementation begins.
6. **Implement the smallest coherent change** — avoid unrelated cleanup unless required for correctness.
7. **Validate** — run the planned evidence and record what actually passed, failed, or was not run.
8. **Update canonical documentation** — follow `docs/DOCUMENTATION_GUIDE.md`; do not duplicate volatile state across documents.
9. **Review release impact** — decide whether the change affects source only, compatibility, protocols, packaged bytes, field gates, or release identity.
10. **Merge only the claims supported by evidence** — a green unit test does not prove a physical two-PC workflow, and source CI does not prove an exact packaged ZIP.

Use [`docs/templates/CHANGE_PLAN.md`](templates/CHANGE_PLAN.md) for a reusable planning skeleton.

## When a written change plan is expected

A written plan is strongly recommended when any of the following is true:

- the change modifies realtime authority, locks, revisions, replay, conflict handling, reconciliation, or reconnect behavior;
- the change writes, moves, extracts, activates, trusts, or launches project files;
- authentication, signatures, hashes, identities, secrets, invite handling, or path safety are involved;
- the change modifies protocol/message shape or compatibility behavior;
- multiple processes or runtimes must agree on the change;
- the change modifies the Windows Launcher, packaged Runtime, release manifests, release workflow, or artifact verification;
- the change fixes a race, lifecycle bug, shutdown bug, data-integrity problem, or physical-field failure;
- a new Unity synchronization surface is introduced;
- rollback or recovery behavior matters;
- the implementation is large enough that a reviewer cannot easily infer intent from the diff.

A typo fix, link correction, isolated comment improvement, or obvious test-only cleanup usually does not need a separate plan.

## Risk levels

### Low

Examples:

- documentation-only changes that do not alter release claims;
- test-message wording;
- isolated developer tooling with no release/runtime effect;
- non-behavioral refactors with strong existing coverage.

Expected evidence is usually focused validation plus documentation/workflow validation where relevant.

### Medium

Examples:

- normal Server or Project Peer behavior changes;
- diagnostics and UX changes;
- non-authority Unity Editor behavior;
- build tooling changes that do not alter packaged trust or identity;
- dependency/runtime updates within an already supported compatibility line.

Expected evidence normally includes focused tests and the subsystem's standard CI lane.

### High

Examples:

- authority, locking, revision, replay, or conflict semantics;
- persistent/staged/Active Project state;
- path containment or filesystem mutation;
- authentication, trust, signature, hash, or identity checks;
- project transfer integrity and activation;
- reconnect/recovery correctness;
- release packaging and exact artifact identity;
- arbitrary or untrusted network/project input;
- a new synchronized Unity data model.

High-risk changes should explicitly list invariants, negative cases, rollback/recovery behavior, and the strongest practical automated evidence. Physical field evidence remains separate when the real environment is part of the failure surface.

## Core invariants to consider

Not every change touches every invariant. A change plan should name the relevant ones instead of copying this list mechanically.

### Authority and ordering

- The Server remains authoritative for supported realtime collaborative state.
- A stale or replayed operation must not silently become a newer authoritative mutation.
- Lock/ownership state must not produce two simultaneous authoritative owners for the same protected operation.
- Reconnect and late join must converge toward current authoritative state without inventing local authority.

### Identity

- Saved Unity objects and session-created objects must not be silently confused.
- Project, Session, Baseline, Owner, Publisher, manifest, and Active revision identities remain explicit where required.
- A convenience path/alias must not become a second unverified project identity.

### Filesystem and activation

- Untrusted paths cannot escape their allowed managed roots.
- Failed or interrupted transfer must not destroy a previously verified Active revision.
- Activation occurs only after the required integrity/trust checks succeed.
- Temporary/staging state must not be mistaken for verified Active state.

### Security and secrets

- Fail-closed checks must not be weakened only to make a workflow succeed.
- Credentials, access codes, tokens, private keys, and private machine-local data must not enter public logs, invites, artifacts, or diagnostics.
- Untrusted network/project input must be bounded and validated before use.

### Release identity

- Source identity, product version, release ID, candidate tag, and byte-level artifact identity are distinct concepts.
- A rebuilt/repacked ZIP is a new byte-level artifact even if the product version does not change.
- Generated runtime/launcher files are not canonical public source merely because they exist in a packaged candidate.

## Test selection

Do not optimize for the largest number of tests. Choose tests that can falsify the risky claim.

### Documentation / repository policy

Use when documentation, workflows, repository policy, source layout, or canonical information ownership changes.

Typical checks:

- `npm run validate:docs`
- `npm run validate:engineering`
- `npm run validate:workflows`
- `npm run validate`

### Server

Use for session, authority, authentication, WebSocket, presence, revision, or coordinator behavior.

Typical evidence:

- focused unit/integration tests;
- Server test suite;
- malformed/replay/stale input tests when relevant;
- authority/recovery chaos for authority-sensitive changes.

### Project Peer / project transfer

Use for transfer, resume, manifests, chunks, trust, activation, staging, path safety, or Host/Guest orchestration.

Typical evidence:

- Project Peer tests;
- negative path/identity/hash cases;
- transfer interruption/resume E2E;
- previous-Active preservation checks;
- packaged/runtime validation when release behavior changes.

### Unity Editor collaboration

Use for Presence, Transform, Lock, Hierarchy, Component, Inspector, selection, reconnect, Unity lifecycle, or Scene behavior.

Typical evidence:

- focused EditMode tests;
- real TeamForge Server E2E where authority/protocol behavior matters;
- late-join/reconnect checks where state convergence matters;
- A/B or A/B/C contention/convergence scenarios;
- physical two-PC validation only when the environment/network/OS/Unity interaction is part of the claim.

### Launcher / release

Use for packaged Runtime, .NET Launcher, handoff, update, path resilience, release manifests, ZIP construction, or artifact verification.

Typical evidence:

- Launcher Core tests;
- runtime-loader tests;
- fresh staged-tree validation;
- exact ZIP/hash verification;
- Windows path/environment tests;
- artifact provenance/attestation where available.

## Evidence classes are not interchangeable

Keep these distinctions explicit:

- **unit/integration tests** prove the exercised implementation logic;
- **Unity automation** proves the exercised Editor/runtime path under that automation environment;
- **chaos/property testing** explores ordering/state combinations but does not reproduce every physical environment;
- **same-machine multi-project testing** strengthens peer/state evidence but shares one OS/hardware/network stack;
- **physical field testing** proves the exact physical scenario that was run;
- **release validation** proves the exact packaged artifact that was validated;
- **static/security analysis** finds classes of defects but is not an independent security audit.

Never upgrade one evidence class into another in release claims.

## Change-plan rules

A useful plan should answer:

- What exactly is wrong or missing?
- What is in scope?
- What is deliberately out of scope?
- Which processes/modules own the affected state?
- Which invariants must remain true?
- What can fail halfway through?
- What can race or arrive out of order?
- What happens after disconnect/restart/retry?
- What is the rollback/recovery behavior?
- Which tests would prove the proposed fix is wrong if it is wrong?
- Which claims cannot be automated and need field evidence?
- Does this change alter compatibility, protocol, artifact identity, or release state?
- Which canonical documents need updates?

Do not turn the plan into a prediction that everything will work. The plan describes hypotheses, constraints, and required evidence.

## Pull-request expectations

The PR should be understandable as the result of the plan rather than as a raw implementation dump.

For substantial changes, the PR should make clear:

- problem and intended outcome;
- risk classification;
- important invariants/failure modes;
- implementation summary;
- actual tests/evidence;
- tests not run or evidence still missing;
- security/data-integrity/recovery implications;
- documentation impact;
- release/field-gate impact.

The repository PR template is intentionally aligned with these fields.

## AI-assisted implementation

AI assistance is welcome, but the engineering process should make it harder for plausible generated code to become an unexamined design decision.

Before accepting a substantial AI-generated implementation:

1. check that it solves the stated problem rather than a nearby problem;
2. compare it with the invariants and out-of-scope list;
3. inspect any new trust, path, network, serialization, authority, or lifecycle assumptions;
4. require tests that can fail for the important wrong behavior;
5. verify that the implementation did not silently broaden scope;
6. record unresolved uncertainty instead of converting it into confident documentation.

Regenerating code repeatedly is not a substitute for investigating the failure.

## Quality-gate classification

`quality-gates.json` and `scripts/classify-change.mjs` provide a lightweight machine-readable mapping from changed paths to risk areas and recommended validation lanes.

Run:

```powershell
node scripts/classify-change.mjs path/to/changed-file another/path
```

or pipe a newline-separated changed-file list:

```powershell
git diff --name-only main...HEAD | node scripts/classify-change.mjs --stdin
```

The classifier is a routing aid, not proof that the selected tests passed. A reviewer may require stronger evidence when the semantic change is riskier than its file path suggests.

## Release-tool migration rule

Active release workflows should use WP-neutral entry points such as:

- `scripts/build-launcher.mjs`
- `scripts/verify-launcher.mjs`
- `scripts/stage-release.mjs`

Legacy `*-wp4-*` implementation files remain temporarily as compatibility implementations while the release internals are generalized. New release automation should not add more work-package-specific entry-point names.

## Final review question

Before merge, ask one final question:

> If this change is wrong, what is the most damaging believable way it could fail, and did we run evidence capable of detecting that failure?

If the answer is unknown, the change is not necessarily blocked — but the uncertainty should be explicit.
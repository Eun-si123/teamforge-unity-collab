# WP6 property replay and authority preflight — 2026-10-14

Historical change plan. Current capabilities remain in `docs/STATUS.md`; the
task PR owns the live checkpoint and exact commit/test status.

## Problem and intended outcome

The disconnected WP6 property candidate validator checks identity, revision and
exact typed policy, but cannot classify retries or inspect the current actor's
GameObject lease. Structural intents already have both read-only preflights.
Add the corresponding property path before considering any live Inspector
operation, following roadmap WP6 and issue #241.

## Scope, ownership and risk

- Extend the existing operation-history and authority-preflight modules for
  property candidates; retain the structural public API and error behavior.
- Session-owned membership, shared revision, operation history and Scene/object
  leases remain authoritative. Prepared identity baselines remain bound to the
  same Session. No caller-supplied validated baseline or actor is trusted.
- Risk: high semantic boundary, contained to disconnected pre-wire experiments.
  A positive result is an observation, never permission, an ACK or a commit.
- No wire handler, capability negotiation, Unity property write/Undo, history
  mutation, lock grant/renewal, new dependency or release/version change.

## Invariants and failure modes

- Session-wide operation IDs cannot be reused across structure, property,
  Hierarchy or Transform operations, or by another authenticated actor.
- Property fingerprints include every identity, exact path, kind and value.
  Vector axis insertion order must not change semantic identity. The explicit
  zero value remains distinct from missing or invalid values.
- A matching fingerprint needs a complete, consistent hypothetical property
  applied record at a subsequent, non-future authoritative revision. Never
  expose that record as a cached ACK.
- A registered replacement connection cannot inherit the old connection's
  lease. Removed/replaced members are rejected even for matching retries.
- An unseen edit needs the current prepared baseline, exact type/path/range
  policy and an owned, unexpired lock for the same Scene/object. Expiry at the
  sampled time is already expired. No preflight changes Session or input state.
- Matching committed retries are observations before current revision/policy/
  lease checks, preserving existing structural ordering; no new effect follows.
- Invalid values, extra fields, stale/foreign identities, unknown policies,
  corrupt histories and cross-kind collisions fail closed. Repair returns only
  a resnapshot hint, not authoritative bytes or a repair mutation.

## Implementation and alternatives

Keep retry classification and lease inspection in their existing semantic owners.
Share the current membership/lease policy across property and structural paths
without creating generic helpers or a new dispatch abstraction. Keep property
value matching explicit and validate cached typed values before comparison.
Opening a live wire operation now would require capability, authoritative
property snapshots and targeted Unity rejection/reconnect contracts that this
small milestone cannot honestly prove; defer that larger step.

## Required evidence

- Focused structural/property/identity/preflight tests, including all supported
  value kinds, reorder/retry, changed values, collisions, corrupt applied fields,
  exact lease expiry, replacement connection, stale baseline and no mutations.
- Existing real WebSocket Protocol v1 denial test, extended for the hypothetical
  property-operation name; denied attempts must not advance authority.
- Full repository `npm test`, real Server/Project Peer smoke, syntax checks,
  documentation/engineering/workflow/public-source and maintainability checks.
- Remote supported Node 22/24 and Windows CI. Unity automation may run as an
  integration regression; it cannot prove a live property operation here.
- No exact ZIP, new release or physical two-PC test. No field gate closes.

## Recovery, observability and documentation

The modules return stable errors, observed server revision and inert repair
hints. Rejecting a candidate preserves all state; removing this extension also
preserves current live Protocol v1 behavior. A future commit boundary must
recheck authority and define atomic effects and targeted Editor recovery.

Update `docs/architecture.md` for as-built pre-wire boundaries and `server/README.md`
for the contributor entry point. Review CODEMAP navigation and capability/roadmap
wording; avoid creating competing current-status or evidence copies. This dated
plan is historical, not a new current canonical document.

## Initial checkpoint

Base: `7644ce5025188905edb57539b4d2da8d22e9f032` on main. Branch:
`feat/wp6-property-authority-preflight-20261014`. Only this plan exists at the
initial checkpoint; implementation and required validation are not yet complete.
Next safe step: add the focused tests and extend the two disconnected modules.

## Validated implementation checkpoint

The two existing preflight modules now inspect typed property retries and the
same live membership/lease policy as structural candidates. There are 27 new
property regression tests; all 96 focused WP6 foundation/preflight tests pass.
The real WebSocket deny-by-default test also rejects the hypothetical property
operation name without advancing authority.

Local Node 24 validation: full `npm test` passes (Server 170; Project Peer 189
passed, five Windows-only skips; candidate tests four; maintainability six),
both real smoke paths and Server syntax checks pass. Documentation, workflow,
engineering, Test Lab, public-source, public-checkpoint privacy and diff checks
pass. These results do not exercise a live Inspector edit.

The bounded second look preserved structural fingerprint ordering and failure
codes, current membership before retry lookup, lease expiry, same-Session
baseline binding and Protocol v1 denial. Shared checks remain inside the two
existing semantic owners; no helper-file or dispatch framework was introduced.
Before live integration, separately define operation-history retention, property
snapshot limits, Unity float/Vector3 precision and round-trip semantics, capability
negotiation and targeted rejection/reconnect recovery. A boolean is a smaller
initial live-value candidate than introducing numeric quantization implicitly.

Source changes are pending the implementation commit and remote supported
Node/Windows/Unity integration CI at this checkpoint; the task PR records the
immutable validated head and final completion. No new package, deployment or
physical result is claimed.

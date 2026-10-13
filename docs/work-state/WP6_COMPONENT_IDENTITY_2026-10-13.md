# WP6 saved Component identity change plan — 2026-10-13

## Problem and intended outcome

At base `2a490cc02646038eb1c6cf9da77b9be2e5822d28`, the disconnected
Component identity validator treats any digit-only GlobalObjectId-shaped string
as a saved Component ID. Unity's null ID, asset IDs, null Scene GUIDs, numeric
aliases and overflowing file IDs can therefore become prepared baseline data.

Accept canonical saved **Scene Component** identities only. Preserve all valid
unsigned 64-bit file IDs exactly, including values above JavaScript's safe
integer limit. Parsing a GlobalObjectId does not establish its Component type,
owner, existence, trusted project or permission to mutate it.

## Scope, risk and invariants

- Medium implementation risk; identity is a protected boundary, but this
  pre-wire experiment is disconnected from HTTP/WS and Unity mutation.
- Change the existing saved-ID predicate, its identity/structural/property
  regression tests and Unity identity probes; document the contract in the
  Server README. Do not introduce a new identity abstraction or wire message.
- Require Scene identifier type `2`, a non-null Scene GUID, a nonzero local
  file ID and canonical decimal spelling within unsigned 64-bit bounds.
- Preserve logical pending IDs, distinct same-type Components, immutable
  prepared baselines, Session/revision binding, operation replay and locks.
- A syntactically valid prefab-instance ID remains identity data only; Prefab
  mutation support and metadata/ownership checks remain separate prerequisites.
- No activation, protocol/schema, release bytes, field gates or production
  deployment changes. General Component/Inspector collaboration remains planned.

## Failure modes and evidence before merge

- Reject null/imported/source/builtin/unknown identifier types, an all-zero
  GUID, a zero local ID, leading zero aliases and both local/prefab overflows.
- Accept canonical IDs above `Number.MAX_SAFE_INTEGER` and at `ulong.MaxValue`
  without converting them through JavaScript Number or altering fingerprints.
- Reproduce rejection failures before implementation. Exercise identity
  baselines and both downstream property and removal candidates afterward.
- Run the focused Component tests, the full Server suite, source/docs/workflow
  and engineering validators, public checkpoint privacy and maintainability.
- Use existing Unity CI for actual saved/unsaved/null/round-trip identity probes.
  A local Node result is not Unity evidence or physical two-PC evidence.

## Documentation, recovery and bounded follow-up

Canonical implementation remains `server/src/component-foundation.mjs`;
Server README explains this contributor-facing contract. STATUS, release
contract, published r8 bytes and historical field evidence remain unchanged.
Rollback is an ordinary source revert; these experiments write no Session or
Scene state and require no migration.

Adjacent observation, **not reproduced or fixed in this change**:
`TeamForgeHierarchySyncService.RevertLastLocalHierarchyChange` calls global
`Undo.PerformUndo()`. A later unrelated local Undo record could be the record
that gets undone when a delayed conflict arrives. Before changing recovery,
add a real Unity delayed-conflict/intervening-edit regression and preserve
Component data, selection and authoritative Transform state during recovery.

## Checkpoint

- Branch: `fix/wp6-saved-component-identity-20261013`.
- Base: `2a490cc02646038eb1c6cf9da77b9be2e5822d28`.
- Implementation: canonical type/GUID/unsigned-range checks complete; existing
  logical IDs and live Protocol v1 behavior remain unchanged.
- Before fix: 42 identity/property/structural tests, 38 passed and four new
  regression tests failed on invalid-ID acceptance. After fix: all 69 focused
  Component foundation/preflight tests passed.
- Full local `npm test` and both Server/Project Peer smoke checks passed;
  exact counts and remote CI are recorded in PR #261, the live task owner.
- Unity probes added for unsaved versus saved Scene GUID/type, null parsing,
  save/reload and full unsigned 64-bit string round trips.
- First actual Unity CI on head `4a4fce82f90ee21fb7f7758c43d7782e86412e70`
  ran 210 cases per lane: 207 passed, one failed, two intentionally skipped.
  The new null probe incorrectly expected `GlobalObjectId.TryParse` to accept
  Unity's default null sentinel. Both Unity lanes rejected it; the expectation
  is corrected to explicit refusal. Saved/reload and all large-ID probes
  already passed. No production check is relaxed to address this test error.
- Local C# execution and physical two-PC tests were not run; corrected-head
  Unity evidence remains pending in the live PR.
- Next: check exact committed HEAD in PR #261 and actual Unity/Node/Windows CI
  evidence. Do not treat the new Unity probes as passing before execution.

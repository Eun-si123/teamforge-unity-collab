# Changed Files — Phase 4.5 WP8 Identity / Authority Test Reconciliation Hotfix

Exact input: `Unity-TeamForge-Phase4.5-WP8-identity-authority-audit-candidate.zip`  
Input SHA-256: `F8A4FAD7CA2F02959AD5E6B9DD52148DDC56BEC09CE394CC0CE12757C08E650D`

Exact ledger: 7 changed/added paths, 0 deleted paths; candidate file count 321 versus input count 319.

## Test code

- `unity-package/com.eunsung.teamforge/Tests/Editor/TeamForgeIdentityAuthorityAuditTests.cs`
  - deterministic single-GameObject Selection for reconnect authoritative re-arm;
  - explicit Authority/connection/epoch/Hierarchy assertions;
  - shared static/global state snapshot and restoration scope.
- `unity-package/com.eunsung.teamforge/Tests/Editor/TeamForgeTransformModelTests.cs`
  - explicit snapshot-wait, baseline-rejection, authoritative-apply and automatic re-arm sequence;
  - logical Lock ID and pending-delta assertions;
  - shared state scope use.

## Documentation

- `docs/phase-4.5-wp8-identity-authority-test-reconciliation-hotfix-report.md` — added.
- `docs/changed-files-phase-4.5-wp8-identity-authority-test-reconciliation-hotfix.md` — added.
- `docs/project-state.md` — current blocked reconciliation candidate/evidence.
- `docs/phase-4.5-closure-report.md` — user-observed two-test failure and reconciliation gate.
- `docs/phase-4.5-wp8-identity-authority-audit-field-checklist.md` — exact new candidate and ordered Unity rerun gate.

## Explicitly unchanged

- all Unity product/runtime `Editor/` source;
- all `server/src/` product/runtime source;
- all `project-peer/` source, tests and CLI behavior;
- Protocol v1 and Project Transfer v1 documents and schemas;
- connection, authority, identity, baseline, parent, dirty-Scene, Lock, Revision, Hierarchy and Tombstone behavior.

No file from the exact input is deleted. Unity-generated `Library`, temporary ProjectSettings and package-lock artifacts from local test attempts are excluded from the candidate.

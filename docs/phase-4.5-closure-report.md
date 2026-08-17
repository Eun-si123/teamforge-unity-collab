# Phase 4.5 Architecture Foundation Closure Report

Date: 2026-08-11 (Asia/Seoul)  
Status: **BLOCKED**; reconciliation Unity run reached `116/117`, root-cause hotfix Unity and multi-Editor field gate `NOT RUN`

## Closure decision

WP0 through WP7 remain frozen. WP8 documentation/validator work remains valid, but Phase 4.5 is not field-closed.

The original Closure candidate exposed a saved-baseline Transform identity asymmetry. The first field hotfix corrected that path, and user field evidence confirms saved A -> B, B -> A and runtime-created Transform. The same field run then exposed a separate saved Presence asymmetry when A retained a `Library/TeamForge` alias and B/C clones had no Library cache.

The comprehensive identity/authority audit confirms and corrects that defect, freezes the shared canonicalization contract, and adds reconnect/additive-Scene/Project UUID/directional characterization. The full result is [phase-4.5-wp8-identity-authority-audit-report.md](phase-4.5-wp8-identity-authority-audit-report.md).

The user then ran Unity `6000.3.21f1` against the exact audit candidate and found two test-suite reconciliation failures. The first reconciliation corrected the obsolete pre-snapshot expectation, but the user's exact reconciliation-candidate run reached **116/117** with one remaining re-arm failure. Root-cause analysis proved that the mega-test itself created a protected conflict through a reflected, non-production Transform transition and reused that contaminated state for re-arm. The correction and focused tests are in [phase-4.5-wp8-identity-authority-rearm-rootcause-hotfix-report.md](phase-4.5-wp8-identity-authority-rearm-rootcause-hotfix-report.md).

## Exact baseline and candidate

| Role | Artifact | SHA-256 / status |
| --- | --- | --- |
| Exact audit input | `Unity-TeamForge-Phase4.5-WP8-field-hotfix-saved-transform-identity.zip` | `53D624AC05634001EFBCBD3207F4EB7EA7579F2D8E92973E734823508A48A32D` |
| Exact reconciliation input | `Unity-TeamForge-Phase4.5-WP8-identity-authority-audit-candidate.zip` | `F8A4FAD7CA2F02959AD5E6B9DD52148DDC56BEC09CE394CC0CE12757C08E650D` |
| Exact root-cause input | `Unity-TeamForge-Phase4.5-WP8-identity-authority-test-reconciliation-hotfix-candidate.zip` | `B2DAC04C72F7D0F048158A09208A1699F3C40E148DE85F9D43E70DBC271E55B5` |
| Current candidate | `Unity-TeamForge-Phase4.5-WP8-identity-authority-rearm-rootcause-hotfix-candidate.zip` | Adjacent `.sha256` sidecar; field-blocked |

No prior archive is overwritten. The new archive cannot contain its own final digest without changing that digest, so the final SHA-256 is external.

## Audit outcome

Confirmed and fixed:

- persisted local `tf:` alias promoted to saved Presence wire identity;
- Presence selection/resolution caches surviving authority identity changes;
- prior-session logical Transform baseline reuse before new authority confirmation;
- Global fallback after a current logical key is rejected by the exact Transform/parent baseline;
- inbound logical Transform resolution through a prior-epoch persisted alias;
- inbound Transform/Lock authority processing before a negotiated Hierarchy snapshot was ready;
- inbound Global/logical key split and stale-parent Lock request windows;
- selected object and active Scene identity mismatch in additive editing;
- persisted-only alias reuse during live Hierarchy capture;
- conflicting reverse/live logical registry bindings.

Confirmed correct or intentionally unchanged:

- the prior saved-Transform baseline/parent correction;
- exact Server Session Authority object keys and Revision/Lock/Hierarchy/Tombstone semantics;
- Project Coordinator atomic UUID/Baseline/peer transitions;
- Authority View, Strategy/Factory, Transfer Source and Policy/Profile responsibility boundaries;
- Protocol v1, Project Transfer v1, Manifest schema 1 and all wire schemas/routes;
- Direct Server WebSocket and project-peer Direct HTTP as the only active paths.

The Project UUID warning for an empty routing UUID with a non-empty registry is not a legal normal transient in current transitions. Validation remains fail-closed; recurrence requires timestamp, running Server provenance and a token-redacted raw snapshot.

## Automated evidence

| Gate | Result |
| --- | --- |
| User reconciliation-candidate Unity EditMode | **116/117 PASS; 1 FAIL**; user field evidence |
| Root-cause hotfix Unity `6000.3.21f1` EditMode | **NOT RUN**; licensing IPC prevented start, expected `123` |
| Unity product/test static compile | **PASS** using the Unity `6000.3.21f1` compiler/reference surface |
| Server | **72/72 PASS** |
| Project Peer | **73/73 PASS** |
| Server + Project Peer syntax | **PASS** |
| Server + Direct Transfer smoke | **PASS** |
| Repository validator | **PASS** |
| Exact final fresh archive install/test/check/smoke/validator | **PASS**; Unity Test Runner **NOT RUN**, expected count `123` |

The audit input's Unity Test Runner result is user-observed **FAIL** for the two named reconciliation tests. The reconciliation candidate's user-run result is **116/117 PASS** with the re-arm mega-test as the sole failure. The root-cause candidate's Unity individual, repeated, class and full-suite runs are **NOT RUN** because local Licensing IPC stopped before Test Runner execution. No XML was produced. Product/test static compile remains separate PASS evidence.

The saved Presence regression tests were added before product correction. Unity red execution was attempted but produced no result XML because licensing failed before Test Runner start; it is not reported as an executed FAIL/PASS. Static compile and Node results are not substituted for Unity or A/B/C evidence.

## Safety and scope

Clean baseline membership, parent validation, dirty Scene/local unsaved work protection, Lock/Revision authority, Tombstones, Project UUID/signatures, all hashes, path containment, verified Staging and atomic/non-destructive activation remain mandatory. No Profile disable switch was added.

There is no WebRTC/RTCDataChannel, ICE/STUN/TURN, Relay, LAN discovery, auto fallback, embedded/serverless authority, Component Sync, Phase 5 persistence or Protocol v2 in this candidate.

## Field closure required

Run the exact candidate through:

1. Unity EditMode `123/123`.
2. A/B/C saved Presence in both directions with A-side cache and Library-less clones.
3. saved Transform/Lock and saved-parent validation in both directions.
4. runtime logical create/Presence/Transform/Lock/rename/reparent/reorder/delete in both actor roles.
5. reconnect and Late Join identity behavior.
6. minimum Project Publish/Invite/Sync over Direct HTTP.

The precise form is [phase-4.5-wp8-identity-authority-audit-field-checklist.md](phase-4.5-wp8-identity-authority-audit-field-checklist.md). Until it passes against the root-cause candidate, Phase 4.5 Closure remains **BLOCKED** and Phase 5 must not begin.

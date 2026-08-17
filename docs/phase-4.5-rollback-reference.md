# TeamForge Phase 4.5 Rollback and Reference Baselines

Date: 2026-08-11 (Asia/Seoul)

Rollback is whole-artifact replacement. There is no Protocol or persisted Server-state migration in Phase 4.5.

## Immediate rollback baseline

| Candidate | SHA-256 | Purpose |
| --- | --- | --- |
| `Unity-TeamForge-Phase4.5-WP7-policy-profile-resolution.zip` | `3D203F86B6AB9F3E23905F2BEC25D3FD23C0A3616A232A6B0EFAF40D68035D4B` | Exact WP8 input and immediate rollback from documentation/validator-only Closure changes |

## Field-hotfix input and status

| Candidate | SHA-256 | Status |
| --- | --- | --- |
| `Unity-TeamForge-Phase4.5-closure.zip` | `859D0806238A588187D76A14E4575CE04E2E1348CFA7DB4F6CF68CEA2571987D` | Exact 309-entry hotfix input and reproduction baseline; **field-blocked**, not a successful saved-object Transform rollback target |

The field-hotfix candidate is a separate archive and does not overwrite the row above. Its hash is external in `Unity-TeamForge-Phase4.5-WP8-field-hotfix-saved-transform-identity.zip.sha256`.

## Identity / authority audit input and candidate

| Role | Candidate | SHA-256 / status |
| --- | --- | --- |
| Exact audit input | `Unity-TeamForge-Phase4.5-WP8-field-hotfix-saved-transform-identity.zip` | `53D624AC05634001EFBCBD3207F4EB7EA7579F2D8E92973E734823508A48A32D`; saved Transform field fix verified, saved Presence field-blocked |
| Current audit candidate | `Unity-TeamForge-Phase4.5-WP8-identity-authority-audit-candidate.zip` | Adjacent external sidecar; automated gates complete, Unity/multi-Editor field gate **NOT RUN** |

Neither earlier artifact is overwritten. For immediate operational recovery, use a whole verified artifact in a disposable Project copy and repeat its exact Unity/field gate; do not mix identity registry, Transform, Presence or Hierarchy files across candidates.

## Reference chain

| Stage | Candidate | SHA-256 |
| --- | --- | --- |
| Phase 4 UX Pass 4 source candidate | `Unity-TeamForge-Phase4-v0.5.0-uxpass4-candidate.zip` | `ED27CC23459B15AB90337A7DF181996D469A2DC33F252EE49125814256521AE7` |
| WP0 Phase 4 Closure baseline | `Unity-TeamForge-Phase4-v0.5.0-closure.zip` | `4453D67CD13A524ED7A9B4740781DAA844397EB729D4FCABFDD9B9B5561AA702` |
| WP1 characterization | `Unity-TeamForge-Phase4.5-WP1-characterization.zip` | `7ACC6BCDDAAF182F5B0FAA50A48EEB34782921AD7F17169AFA2925C77B59A068` |
| WP1 compile hotfix | `Unity-TeamForge-Phase4.5-WP1-characterization-compile-hotfix1.zip` | `979E7AD88CAEDF93E04758A813B57AA2CDB5CA86BFA36D9ED68A71F5F675F26E` |
| WP2 Authority Core | `Unity-TeamForge-Phase4.5-WP2-server-authority-core.zip` | `050F5EC3447656A7AD5B7CFC8962A0EC8A21FA2BA18CAABF835C2EA4AB98C472` |
| WP3 Coordinator Core | `Unity-TeamForge-Phase4.5-WP3-project-coordinator-core.zip` | `B20A9C5E4F6B991EADA69232DED1B3FA1A38BDCEB619D746B065470FB7D8FD89` |
| WP4 Unity Authority View | `Unity-TeamForge-Phase4.5-WP4-unity-authority-view.zip` | `3A3035B4FA3D8EAB724285F4CF119DABDDB2144A56E73EDADE04FA0BC3F31D7B` |
| WP5 transport composition | `Unity-TeamForge-Phase4.5-WP5-transport-factory-legacy-strategy.zip` | `4F0DD3882DF249AE8CD741AB7F93D60A450B9DE72D70B632867C4E7C5A70443D` |
| WP6 Transfer Source | `Unity-TeamForge-Phase4.5-WP6-transfer-source-stable-backend.zip` | `1ED6360DE6E99B789CBE19494345974ECAF90982DDBB292BB948687D09E04D0F` |
| WP7 Policy/Profile | `Unity-TeamForge-Phase4.5-WP7-policy-profile-resolution.zip` | `3D203F86B6AB9F3E23905F2BEC25D3FD23C0A3616A232A6B0EFAF40D68035D4B` |

Always verify the artifact itself against the published sidecar. A filename alone is not evidence.

## Rollback procedure

1. Stop new `project-peer` Publish/Seed/Sync processes and disconnect all Unity Editors cleanly.
2. Save or explicitly discard dirty Scenes. Back up the Unity Project, `TeamForgeProjects`, Owner identity backup and sanitized failure evidence.
3. Do not delete or overwrite existing immutable Active revision directories.
4. Select the intended rollback ZIP and verify its SHA-256 above and against its adjacent sidecar.
5. Extract to a new directory. Do not overlay files from different work packages.
6. Run `npm.cmd --prefix server ci`, `npm.cmd --prefix project-peer ci`, both test/check/smoke suites and the repository validator.
7. Replace Server, Unity package and Project Peer together from the same artifact. Product version remains `0.5.0`, but mixed source boundaries are not a supported rollback method.
8. Open a disposable Project copy in the recorded Unity version and run its exact expected EditMode suite before production reuse.
9. Reconnect a separate test Project/Session and verify Presence, Transform/Lock, Hierarchy and Project metadata before resuming work.

## State cautions

- Server Session Authority and Project Coordinator registries are memory-only and reset when the Server stops.
- Project Peer `metadata/published.json` and Active Current pointers are monotonic safety records. Do not edit or move them backward manually.
- Owner keys, signed Invites, Project UUIDs and Baseline identity must not be regenerated to make a rollback appear compatible.
- A rollback does not convert a newer live hierarchy Session into a compatible older baseline. Start a clean Session/baseline when identity compatibility is uncertain.
- The original user Unity Project is not a rollback target for automated deletion or overwrite.

The Phase 4.5 Closure and field-hotfix archive hashes are published only in their external `.sha256` sidecars and final handoff because embedding a hash in the same archive would change that archive hash.

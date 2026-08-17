# TeamForge v0.5.0 Known Issues

## Release status

`0.5.0` is a Phase 4 candidate until Unity `6000.3.21f1` Compile/EditMode and the two-Editor hierarchy manual gate pass on the exact packaged artifact.

## Open issues / limits

| Severity | Item | Current behavior / mitigation |
| --- | --- | --- |
| Release Gate | Unity Compile/EditMode not run in the current execution environment | Source/static checks exist, but the user must run the exact candidate in Unity 6000.3.21f1. |
| Release Gate | Two-Editor hierarchy field E2E not yet run | Use the v0.5.0 manual checklist for create/delete/rename/reparent/reorder/conflict/late join. |
| Release Gate | WP8 identity/authority audit candidate field gate not yet run | Run Unity `117/117` plus cache-asymmetric saved Presence, Transform/Lock, reconnect/Late Join and Project smoke against the exact audit ZIP. Closure remains blocked. |
| Diagnostic / provenance required | `A non-empty Project registry requires a Project UUID` warning has been observed in field history | Current legal Coordinator transitions cannot produce this as a normal empty transient. If it recurs, capture timestamp, running Server source hash and a token-redacted raw snapshot; do not suppress or infer the UUID. |
| Medium / design limit | New logical object identity mapping is local generated state | `tf:` IDs bind locally under `Library/TeamForge`. A fresh republished baseline opened against an older live hierarchy session is not guessed; initial snapshot fails closed. Keep Project baseline and live hierarchy session aligned. Persistent/migratable identity is deferred to Phase 5 or a later explicit design. |
| Medium / design limit | Server hierarchy state is memory-only | Server restart loses hierarchy snapshot/tombstones/revision state. Local Scene remains; persistent recovery is Phase 5. |
| Medium | Prefab Stage/Prefab structural collaboration unsupported | Structural Prefab operations fail closed or remain local with diagnostic. Scene Prefab Instance Transform behavior from Phase 2 remains separate. |
| Medium | Cross-Scene reparent unsupported | Prevented/fails closed to avoid identity and Scene ownership ambiguity. |
| Medium | No general Component/Asset synchronization | Phase 4 handles hierarchy structure and Transform only. Runtime-created remote clones do not automatically acquire MeshFilter, MeshRenderer, Collider, material, prefab or serialized Component state. |
| Low / scale | Default hierarchy caps: 2,048 objects, 4,096 tombstones, 1 MiB snapshot, depth 256 | Operations exceeding caps are rejected before authoritative mutation. Increase only with load testing. |
| Low | Object names may be duplicated | This is intentional; identity never uses name. |
| Low | Remote authoritative hierarchy changes do not provide shared Undo history | Remote apply avoids normal local Undo; persistent/shared operation history is Phase 5. |
| Low / security model | Shared Bearer token does not cryptographically bind user identity | Continue trusted-team/private-network deployment guidance. |
| Environment | Windows long Active/PackageCache path can still exceed Unity/environment path capability | Phase 3 closure warns and recommends a short managed root; it does not mutate OS policy. |
| Environment | Docker/Linux/macOS validation depends on available hosts | Never claim those matrices without actual runs. |

- **Environment / Unity Editor progress noise:** Unity can emit `(GetStatus) Cannot get non-existing progress id ...` around background task completion/import. TeamForge does not call `UnityEditor.Progress.GetStatus` or its lifecycle APIs. Treat a bare message without a TeamForge stack trace as Editor noise; capture a package-owned stack trace before attributing it to TeamForge.

## Non-goals for this version

- Scene create/delete/rename
- cross-Scene GameObject migration
- general Component/SerializedProperty sync
- Prefab Asset merge
- persistent operation log/snapshot/recovery
- CRDT/offline merge
- Coordinator Project payload relay

Phase 5 must not be started as a workaround for any `0.5.0` test failure.

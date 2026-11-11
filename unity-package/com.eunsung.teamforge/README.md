# Unity TeamForge package

This Unity Editor package provides TeamForge's Editor-facing realtime collaboration, Host flow, diagnostics/recovery UX and supported same-Scene collaboration behavior.

This module README describes **package behavior and boundaries**, not current release readiness. Use [`../../docs/STATUS.md`](../../docs/STATUS.md) for live readiness and [`../../release-contract.json`](../../release-contract.json) for exact Unity/protocol/runtime selections.

## Host workflow

Open **Window > TeamForge > Collaboration**, choose **Host**, save/review the Scene, and complete **Publish & Start**.

Host Ready succeeds only after the backend returns a signed Collaboration Invite that contains separately validated Project-transfer and realtime-session contracts.

The ordinary signed Collaboration Invite does not contain the access code, private key or local absolute Project path. By default the code is shared separately. **Optional source-only UI:** after Host Ready, “Copy invite + code (sensitive)” requires explicit confirmation and copies a *separate plaintext clipboard envelope* that contains the signed invite plus a **reusable** Server access code. The Guest Launcher offers “Paste invite + code…” with its own warning. This is not single-use, encrypted, or expiring; do not publicly distribute or save it. Ordinary invite exports remain code-free. See [How TeamForge works](../../docs/HOW_IT_WORKS.md).

The advanced realtime-only Session Invite is for an already-provisioned matching Project and is not a fresh-Guest bootstrap value.

## LAN endpoint policy

For two PCs:

- **Host address (Guests connect here)** is the concrete Host LAN/VPN origin reachable from each Guest; it is not the Guest machine's IP;
- **Coordinator listen address** is a separate local bind;
- non-loopback listening requires authentication according to current policy;
- wildcard/unspecified/loopback addresses are not valid advertised remote Guest destinations.

Explicit same-PC mode may use loopback.

**Current source Host onboarding:** If no code is configured for a LAN listener, Start Collaboration offers to generate a unique 256-bit code **after explicit confirmation**; previously configured codes are preserved. Manual connection settings provide masked reveal, explicit clipboard copy and confirmed regeneration while Host is stopped. Host network-address selection lists active IPv4 adapters (including VPN adapters) alongside optional default-route discovery. A selected address is merely a **local candidate**, not proof of remote Guest reachability. Trusted-LAN no-code mode and *scoped/expiring* one-paste capability invites are **not implemented**; the optional plaintext share above is deliberately distinct. **Source-only Host diagnostics** show the bounded stage
of a failed Host commit in current technical details when reported by the Host
bridge. The original error code and underlying message remain visible. The
stage distinguishes where startup stopped, not why the network failed. Existing
r8 packages and Windows two-PC validation are unchanged. See STATUS and exact release artifacts before attributing these controls to any packaged build.

TeamForge does not currently provide automatic Internet peer discovery, NAT traversal or relay. Current connectivity boundaries belong to [architecture.md](../../docs/architecture.md) and [STATUS.md](../../docs/STATUS.md).

## Guest / Project transfer boundary

Fresh packaged Guests use the standalone Windows Guest Launcher. Generated packaged Launcher/Runtime output is intentionally not committed as normal source.

The packaged Launcher/Host path uses a manifest-pinned verified Runtime. Normal Guests do not need to install system Node/npm or operate the Project Peer CLI manually.

Project payload bytes move directly between Project Peer processes. The TeamForge Server carries realtime authority and signed Project coordination metadata rather than Manifest/File/Chunk payload bytes.

Owner/Publisher identity, signed invites/descriptors, hashes, staging, immutable activation and final Unity handoff are fail-closed trust boundaries.

## Opt-in live Scene View camera follow (source-only, unverified in a packaged release)

In **Window > TeamForge > Advanced > Team Members**, choose **Follow Camera**
next to a teammate. The local Scene View mirrors that teammate's currently
advertised camera pivot, rotation, zoom and orthographic mode while following.
The feature is explicitly local and read-only; it neither controls the other
Editor nor changes Scene objects, transforms, locks, project files or Server
authority. The ordinary **Go to Camera** one-shot action remains available.

Follow accepts only valid Presence data from the current authenticated
connection, the same saved Scene GUID and the same specific teammate
connection. It stops on disconnection, peer reconnect/leave, missing camera,
Scene/Editor mode change, stale Presence or local Scene View interaction.
**Esc**, clicking/dragging/scrolling in Scene View, and the visible **Stop**
control all disengage it. While following, TeamForge does **not** re-advertise
the copied camera as the local user's own camera, to prevent mutual-follow
feedback loops. The server protocol and trust contract are unchanged. This
source feature still requires Unity Editor integration testing and is not
implicitly included in the currently published candidate ZIP.

## Hierarchy / identity boundary

Supported same-Scene GameObject create/delete/rename/reparent/sibling-order operations are authoritative collaboration operations.

Saved Scene objects use stable Unity identity; session-created objects use TeamForge logical identity after authoritative binding. Name, hierarchy path or sibling index must not silently become authority fallbacks when identity is ambiguous.

General Component/Inspector/Prefab/Asset synchronization and cross-Scene structural collaboration are separate future surfaces and must not be inferred from supported Hierarchy behavior.

### WP6 exact saved Component lookup (source-only prerequisite)

The Editor-only `TeamForgeWp6ComponentIdentity` helper can capture and
round-trip-resolve an exact **saved Scene** `BoxCollider` or `SphereCollider`
using its canonical Unity `GlobalObjectId`, owning GameObject identity, Scene
GUID and exact built-in Component type. Two Colliders of the same type on
one GameObject remain distinct regardless of Inspector ordering or extra
Components. Deleted, unloaded, unsaved, forged-owner, forged-type and
Prefab-backed identities are rejected instead of falling back to type/index.
The opt-in local read-only Inspector probe now checks this exact resolution
before reporting any property observation.

**This is not authorization or Component synchronization.** The resolver
does not prove Project trust, an authoritative Hierarchy baseline, Session
revision, lock ownership, a signed source snapshot or write permission.
No Component/Inspector values are applied, no Undo or Scene writes occur,
and there is no new server packet or public runtime capability. Actual
live WP6 write operations require separate end-to-end authority,
reconciliation and physical two-Editor validation before rollout.

### WP6 bounded local saved-Scene Collider inventory (source-only)

Built on the exact-ID helper above (PR #506), `TeamForgeWp6SceneInventory`
observes **every supported BoxCollider/SphereCollider** in one saved,
loaded Scene, including duplicate same-type Components and inactive children.
The complete allowlisted set is returned in canonical Component-ID order,
with exact owner/Scene IDs, typed local `SerializedProperty` observations and
an explicit local dirty-Scene marker. Unsupported Component types are not
inventoried. Unsupported Prefab Colliders, invalid properties, duplicate IDs,
an altered Scene or resource ceilings cause the **entire** capture to fail,
not a partial "synchronized" snapshot. Hard caps: 4,096 traversed
GameObjects and 512 allowed Colliders per capture.

This opt-in developer-facing in-memory helper is **not** automatically run,
persisted, broadcast, compared with server authority, accepted as a trusted
Project baseline or applied to any Scene. It does not add live Inspector
synchronization; authenticated, revision-checked baseline seeding and safe
reconciliation remain next WP6 milestones.

### WP6 loaded Scene and signed source-byte consistency (Editor-only)

`TeamForgeWp6LoadedSceneSource.TryCapture` is a narrow, **read-only**
bridge for the complete saved-Scene Collider inventory above. Given an
expected Scene asset path/GUID, Scene SHA-256 and .meta SHA-256 from a
separately verified Project source, it requires that the **currently
active** loaded Scene is saved, clean and exact-ID-matched. It checks
the regular Scene/.meta file byte budgets (128 MiB/64 KiB),
rejects redirected directories under Assets through the Scene parent,
hashes the saved Scene and .meta before collecting every supported
Collider, and hashes both again afterward. A dirty/changed Scene,
different active Scene, wrong GUID, different on-disk bytes, missing
metadata or unsupported Collider refuses the **entire** result.

It never opens/reloads another Scene, saves files, applies Inspector
values, creates Undo records, calls a Server or signs an approval.
The input hash is an **expectation**, not internally authenticated
Owner/Publisher evidence: the caller must first establish the signed
published Scene/.meta source via the separate Project Peer check in
PR #511 and bind it to the correct active Project. Matching file
hashes/clean Scene is a *consistency observation*, not proof that
every in-memory serialized Component value was decoded from those
bytes or safe to synchronize. A future independent Unity Scene
content/value attestation, Publisher-approved observation, Server
revision/lock and rejection/Undo contract remain required. The
helper is source-only and is **not automatically enabled**.

### WP6 serialized Scene ↔ loaded Collider value witness (source-only)

After exact identity, bounded Scene inventory and the active saved-file
fingerprint gate, `TeamForgeWp6SerializedSceneWitness` adds an opt-in
**read-only serialized-value check**. It loads at most **16 MiB** of a
clean saved Unity **text YAML** Scene (UTF-8) whose GUID and both file
hashes already passed `TeamForgeWp6LoadedSceneSource`, then compares
all exact supported `BoxCollider`/`SphereCollider` YAML documents
against the observed Unity `SerializedProperty` values. The matcher
uses the Unity document class IDs **65/135**, canonical local
`fileID` for every Component and owning GameObject, plus the owner's
actual `m_Component` references. It verifies trigger/center/size or
radius with exact finite float equality (no approximate Vector3
comparison). Scene files containing unknown or ambiguous serialized
Collider structures, duplicate/missing references, PrefabInstance
documents, unsupported direct Prefab bindings, or noncanonical YAML
are **refused**, never treated as empty or partially synchronized.

File hashes, clean active Scene and values are re-observed again after
parsing; a changed observation causes the entire witness to fail.
This intentionally supports only **small text-serialized Scenes with
simple direct saved Colliders** and does not attempt a broad YAML
deserializer, binary Scene parsing or Prefab override reconstruction.
A successful match means these **specific allowlisted values**
correspond to the expected current saved file under the stated
checks. It does **not** prove every Unity Component/property matches,
provide authority for remote edits, establish that the expected
hashes came from the signed Publisher, or eliminate an adversarial
concurrent file/reimport race. Actual Project/Publisher provenance
and Server membership, revision, lock, Undo, replay and reconnect
rules remain separate prerequisites before enabling WP6 writes.
No network, Editor window or live default behavior is changed.

### WP6 bounded Undo-capable Inspector **local test** (source-only)

`TeamForgeWp6LocalInspectorApply` exercises the previously missing
**Unity write + Undo + reject/replay** boundary for one exact
`BoxCollider` or `SphereCollider` field. Its
`TryBeginForLocalTest` requires the signed-source *expectation* to
be locally consistent with a clean, saved, direct-Collider text Scene
and its actual serialized YAML values (the read-only gates above).
`TryApplyForLocalTest` then revalidates the entire observed Scene,
the exact Component/owner `GlobalObjectId`, the narrow
`SerializedProperty` path/type/range and consecutive local
base/server revisions. Only after every check does it write one
supported property through Unity `SerializedObject`, with one named
Undo group, and reread the precise resulting delta. If the write
does not yield the expected result it attempts to revert its own
Undo group. A successful preview is **single-use**; identical
replays are acknowledged only while the actual complete Collider
after-image still matches. Undo or subsequent edits invalidate
that acknowledgement and require recapture.

**Never use this as an authenticated Server command.** Test code
can freely construct the proposed applied record and expected
source/revision; this preview DOES NOT validate signed Session
authorization, verified Project identity, remote lock ownership,
Server replay/idempotency, member identity or a trusted Publisher
handoff. It is an opt-in internal EditMode-test entrypoint, not
wired into Server WebSocket dispatch, Editor collaboration menus,
normal project operation or the public release. It does not
save the Scene, broadcast anything, or silently rebase conflicts.
One local edit dirties the Scene, so a new verified baseline is
required before beginning another local-preview operation.
Network grants, real multi-user Undo/reconciliation and reconnect
are still future WP6 gates.

### WP6 read-only Scene inventory comparison (source-only)

Following the bounded complete Collider inventory, the experimental
`TeamForgeWp6SceneComparison` compares **two observed snapshots of the
same saved Scene GUID**. It reports exact supported Component IDs as added,
removed or property-changed, with only the allowlisted changed property
**paths** (not the values). Results are sorted by canonical Component ID
and do not depend on Hierarchy traversal or Inspector ordering. Both
snapshots are rechecked for duplicate IDs, owner/Scene/type consistency,
three correctly typed and bounded Collider properties, and dirty-state
consistency; any invalid input or conflicting owner/type aborts the
entire comparison. Property vectors use exact component-wise comparisons,
not Unity's approximate Vector3 equality.

A difference is **not** a proposal to synchronize, delete or overwrite
a Component. Dirty snapshots remain explicitly flagged as unverified
local observations. No socket messages, Server revisions, Undo, Inspector
writes, Scene changes or Project mutations are triggered. Before
a real WP6 property write can be enabled, the Server must independently
validate signed Project provenance, owning Hierarchy identity,
authenticated session/lock/revision and replay/rejection semantics.

### Experimental WP6 Inspector read-only probe (source only)

`Editor/ComponentProbe/TeamForgeWp6InspectorProbe.cs` is an isolated,
**not runtime-connected** testable Unity Editor helper. For a loaded saved Scene
with verified GlobalObjectIds, it can locally observe exact serialized values
for `BoxCollider` (`m_IsTrigger`, `m_Center`, `m_Size`) or `SphereCollider`
(`m_IsTrigger`, `m_Center`, `m_Radius`). Readings use explicit types and small
bounds (vectors per axis and radii/sizes within 100 Unity units); a missing,
unsupported or out-of-range field causes the **entire** observation to fail.
Values and Scene dirtiness are captured as an in-memory preview; no network,
Undo, Editor mutation, Session revision, lock, approved baseline, or write
permission is implied. Prefab source/components and session-created logical
IDs are not supported by this prototype. Unity EditMode tests exercise only
the offline probe. The immutable packaged r8 does not include this source
change and the field gate remains open.

Rejected rename/reparent/sibling-order changes restore only the exact live
authoritative target; recovery preserves other objects, Component data,
selection and unrelated Undo. Reparent recovery uses the latest observed
server Transform. It does not traverse the global Undo stack.

When safe target recovery is unavailable, including rejected deletion,
unverified creation, missing identity/parent or an unsupported Prefab context,
Hierarchy processing pauses and readiness is reported as partial. Review and
preserve local changes, use manual Undo where appropriate, then
disconnect/reconnect to obtain a fresh authoritative snapshot. Recovery does
not fabricate saved objects or discard local Component data to get past a
conflict.

## Diagnostics and recovery

Diagnostics/recovery UX should explain failures and offer state-driven recovery actions without bypassing:

- invitation/signature validation;
- stored Project/Owner/Publisher trust;
- Project staging/activation verification;
- Scene/baseline checks;
- authority/identity rules.

A recovery button is not permission to force unknown local state over authoritative state.

## Windows path-resilience boundary

The packaged Windows flow can use a TeamForge-owned short execution path when the platform/filesystem policy can prove the expected canonical Active Project identity.

Path shortening is an execution detail. It must not weaken managed-destination containment, Runtime integrity, Project trust, immutable Active verification or final Unity handoff checks.

Arbitrary external reparse/symlink/junction paths are not implicitly trusted because a narrow TeamForge-owned execution alias is supported.

## Settings / secrets

Project-local user settings live under `UserSettings` according to the package implementation.

Credentials/access secrets are not intended to be embedded into Collaboration Invites or Project descriptors. Remove secrets/private paths from logs before sharing diagnostics publicly.

## Validation

Package behavior is covered by Unity EditMode and real-server E2E paths in the repository, but each result applies only to the exact scenario and source revision exercised.

Do not infer physical two-PC Windows field closure from EditMode/CI results. Current validation and release effects are tracked in [`../../docs/STATUS.md`](../../docs/STATUS.md).

# TeamForge deployment and rollback

This page describes the **intended packaged Windows deployment and rollback workflow**.

It is a how-to guide, not a release-readiness declaration.

- Current readiness / field gates → [STATUS.md](STATUS.md)
- Exact product/runtime/protocol/candidate selections → [`../release-contract.json`](../release-contract.json)
- Current/superseded packaged artifact identity → [`../builds/README.md`](../builds/README.md) + GitHub Release SHA-256

> [!WARNING]
> Do not use these steps to infer that a particular candidate is ready for an important project. Check [STATUS.md](STATUS.md) first.

## Normal packaged Windows deployment

1. Obtain the exact intended TeamForge packaged artifact from the trusted distribution source.
2. Verify the artifact identity/hash published for those exact bytes.
3. Extract the complete artifact as one set; do not overlay individual files from another candidate.
4. Keep the extraction/destination path within the currently supported Windows path policy.
5. Start the Host through the packaged Unity workflow.
6. Start a fresh Guest through the packaged Windows Guest Launcher.
7. Share the signed Collaboration Invite and the access code through the intended separate channels.
8. Confirm Project/Publisher trust information before allowing the Guest flow to activate/open the received Project.

Generated packaged Launcher/Runtime output is a release artifact and is intentionally absent from a normal public source checkout.

Normal packaged Host/Guest operation should not depend on a caller working directory, a source workspace or arbitrary system Node/npm fallback.

## Host network settings

The Host flow separates:

- **Coordinator listen address** — local bind/interface selection;
- **Guest address** — concrete origin reachable from the Guest machine;
- **Project Peer Seed endpoint** — direct Project payload source reachable by the Guest.

A remote two-PC invite must not advertise wildcard/unspecified/loopback destinations as if they were reachable Guest endpoints.

Non-loopback listening requires authentication according to current policy. Firewall and LAN/VPN routing must allow the intended Coordinator and Seed endpoints.

Current source keeps one remembered exact Seed port per local Unity Project, defaulting to TCP `5091`. If that preferred port is occupied by an unverified/other listener, TeamForge leaves that listener untouched and asks the OS to bind one available fallback port; the actual bound port becomes the next preferred port.

On Windows, TeamForge-managed firewall onboarding uses only two named inbound rules: the current Coordinator TCP port and the actual bound Seed TCP port. Both are limited to the Private profile and `LocalSubnet`; changing the Seed port replaces the named Seed rule instead of accumulating old ports. Normal **Stop Collaboration** closes the owned listeners but keeps the narrow rules for reuse. After stopping the Host, **Manual connection settings → Remove TeamForge LAN firewall rules** explicitly removes those two named rules with administrator approval.

Current TeamForge does not provide automatic Internet NAT traversal, relay, discovery or silent transport fallback.

## Invite handling

Use the normal signed **Collaboration Invite** produced by Host Ready for a fresh Guest.

The access code is shared separately from the Invite.

A lower-level realtime-only/session-only value is not a substitute for the complete fresh-Guest bootstrap contract.

Do not edit signed invite content manually and assume it remains trusted.

## Guest receive / activation

The packaged Guest flow should preserve the following order:

1. validate the bootstrap/Invite structure and signatures;
2. validate Project/Owner/Publisher identity/trust;
3. receive Project content through the direct Project Peer transfer path;
4. verify manifests/files/chunks and filesystem/path policy;
5. stage content without replacing the previous known-good Active revision;
6. activate only after full verification;
7. revalidate the exact Unity handoff/project path before launch.

A partially received or unverified Project should not become the current Active Project merely to make the workflow continue.

## Windows path handling

Keep normal extraction and managed Project destinations reasonably short.

Current path-resilience can use an approved TeamForge-owned short execution path when the canonical Project identity can be proven. This does not authorize arbitrary external symlinks/junctions/reparse points or bypass the managed destination/trust model.

Arbitrarily deep Windows paths are not a supported promise.

## Developer source execution

Source developers should follow [SOURCE.md](SOURCE.md) instead of treating the packaged deployment steps as a source-build guide.

Typical source validation starts with:

```powershell
npm run install:all
npm run validate
npm test
```

Exact supported tool/runtime selections belong to `release-contract.json`.

## Update

Before updating:

- stop collaboration cleanly when practical;
- back up important Unity Project/Scene/`.meta` state;
- identify the exact replacement artifact and verify its hash;
- keep the packaged Server/Project Peer/Unity package/Runtime/Launcher set together;
- review release/status notes for changes that affect compatibility or trust.

Do not hand-copy individual generated binaries, manifests or Runtime pins between candidates.

If the update changes Project/Publisher identity or a trust-boundary contract, require the explicit review path rather than silently preserving an incompatible binding.

## Rollback

Rollback only to a **complete previously verified artifact set**.

- stop current collaboration;
- preserve relevant logs/evidence if investigating a regression;
- restore the complete older artifact rather than mixing files;
- retain Project Owner/trust material only according to the documented compatibility/trust contract;
- confirm the old artifact is compatible with the Project state you intend to reopen;
- do not treat rollback as a way to bypass an activation/baseline mismatch.

Immutable Active Project revisions should remain preferable to destructive in-place replacement where the implemented flow supports them.

## Failure / recovery expectations

- A failed update or transfer should preserve the previous verified Active Project when possible.
- A process/network interruption should fail visibly and resume/recover only through a validated state transition.
- Server restart currently does not imply durable old-session authority recovery; see [STATUS.md](STATUS.md) for the current persistence boundary.
- Exact physical field evidence applies only to the artifact/source and scenario actually tested.

## Release evidence boundary

Source CI, Unity automation, package validation and physical field testing are separate evidence classes.

Before calling a packaged release dependable, use [STATUS.md](STATUS.md) to confirm that the intended exact artifact has completed the required physical/user-facing gates rather than inferring readiness from source tests alone.

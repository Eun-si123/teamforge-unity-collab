# TeamForge physical two-PC field evidence — 2026-10-04

> [!NOTE]
> **Dated engineering evidence, not the current status source.**
>
> This note records the r6 → r7 physical Windows field pass that found and then re-tested the Guest managed-root retry bug. For current capability and release readiness, use **[STATUS.md](STATUS.md)**.

## Purpose

The run continued the post-r5 Windows field pass with two physical PCs on the same LAN.

Its immediate goals were to:
- preserve the r6 failure state instead of deleting it;
- verify the r7 Guest retry fix against that real state;
- separate the earlier Coordinator timeout from the managed-root bug;
- continue through Publisher trust, Project receive, Unity launch, and realtime connection if the network path recovered.

## Artifact provenance

- Host: the previously running r6 Host flow in Unity.
- Guest: exact published r7 Windows candidate.
- r7 tag: `v0.5.1-prealpha-wp5.1-r7`.
- r7 source commit: `d88ca4c41ecf1f9cc7aa5d349960f407f158ce9a`.
- r7 ZIP: `Unity-TeamForge-0.5.1-WP5.1-path-resilience-candidate-r7-win-x64.zip`.
- r7 SHA-256: `a710acd3cd7189c3f44ae1b4ee46a15239313c850ad7f6982e3a58f2492a13aa`.

This is therefore **mixed r6 Host / exact r7 Guest physical evidence**, not exact-r7-on-both-machines closure.

## Observed r7 Guest retry result

The Guest reused the existing TeamForge-managed root left by the failed r6 attempts, including the Windows v2 Project identity compatibility fence.

The r7 Launcher reported:

```text
runtime_verification_started
runtime_verification_passed
path_budget_risk_detected: automatic Unity path optimization will be selected after verification
guest_state: ImportingInvite
guest_state: Connecting
coordinator_timeout: coordinator_timeout: Coordinator handshake timed out.
```

Crucially, the prior r6 retry failure **did not recur**:

```text
destination_contains_unmanaged_content
```

This physically exercises PR #200's intended fix: an exact TeamForge-owned Windows v2 `project-identity.lock` compatibility fence no longer causes TeamForge to reject its own managed root on retry.

## Coordinator timeout isolation

The initial r7 retry still timed out at the Coordinator, so the network path was tested independently.

The Guest first showed an unintended VPN route. After that route was removed, the Guest used the physical LAN interface but TCP 5080 still failed.

On the Host:
- the Coordinator was listening on `0.0.0.0:5080`;
- loopback TCP 5080 succeeded;
- TeamForge's Coordinator and Seed inbound rules were enabled, inbound/allow, and scoped to the **Private** firewall profile;
- the actual Wi-Fi network profile was **Public**.

After the trusted home LAN profile was changed from Public to Private, Guest → Host TCP 5080 succeeded.

The same r7 Launcher flow then advanced beyond the earlier timeout:
- signed Collaboration Invite remained verified;
- approved Baseline revision 1 was visible;
- Publisher fingerprint/trust confirmation was presented;
- the user confirmed the expected Publisher;
- Project receive completed far enough to hand off into Unity;
- Unity opened the received Project;
- the user reported TeamForge connected successfully.

This strongly isolates the observed Coordinator timeout in this run to the Windows network-profile/firewall-policy mismatch rather than the r7 managed-root fix.

## Product interpretation

The firewall safety policy behaved as designed: TeamForge did **not** broaden its inbound rules to the Windows Public profile.

However, the Host reached a user-facing Ready state while the active LAN interface was Public and the TeamForge rules were Private-only. That is a diagnostics/onboarding UX gap worth addressing separately: the safer direction is to explain the profile mismatch, not to auto-open TeamForge on Public networks.

## What this run proves

- **PASS — r7 Guest retry regression:** the real r6-managed root with the TeamForge Windows v2 compatibility fence no longer self-blocks with `destination_contains_unmanaged_content`.
- **PASS — LAN Coordinator reachability after correct Windows profile:** Guest TCP 5080 became reachable once the Host LAN was Private.
- **PASS — mixed r6 Host / r7 Guest bootstrap continuation:** Invite verification → Publisher trust → Project receive → Unity launch → reported TeamForge connection completed.
- **PASS — safety boundary retained:** the observed fix did not require opening TeamForge firewall rules on the Public profile.

## What remains unproven

- exact r7 Host + exact r7 Guest on both physical machines;
- fresh non-elevated UAC onboarding;
- independent verification of exact firewall address/port filters after a clean r7 Host onboarding;
- preferred Seed-port unavailable/collision fallback on the physical LAN;
- Host Stop → Start followed by another fresh Guest transfer on exact r7;
- abnormal process-loss Project identity recovery on physical Windows;
- foreign-lock feedback/release/takeover UX on the r7 two-Editor path.

## Later r7-on-Host follow-up: new blockers exposed

Later in the same physical session, the Host embedded TeamForge package was replaced with the r7 package files and the Host reported **Baseline revision 2**.

The Guest history also produced two useful negative-path results before the new blockers:
- a deliberately incorrect access code was rejected as `access_code_incorrect`, preserving fail-closed authentication;
- an earlier receive had reached `Complete`, verified the exact Unity `6000.3.21f1`, and started Unity.

Two additional field defects were then exposed.

### Host can display stale Ready while no Direct Project Peer is discoverable

Even after Host Stop → Start showed Baseline revision 2, Guest receive repeatedly reached `Receiving` and then failed with:

```text
baseline_unavailable: Published baseline has no direct Project Peer.
```

This is stronger evidence than the Host Ready label alone: the Coordinator Baseline existed, but the Guest snapshot did not contain a usable exact direct Seed for that Baseline.

Source review found that Host Ready was bound to the successful start/announce path, but the Unity Host UI did not continuously revoke Ready if the owned Host bridge/Seed later disappeared. The follow-up source change therefore treats current Direct-Seed discoverability as part of Host health instead of equating a historical Ready transition with ongoing availability.

This source change is **not yet packaged or physically proven** in this evidence note.

### Existing-Active recovery bypassed the short Unity execution path

When the Guest chose the already existing verified project recovery path, Unity opened but emitted a `DirectoryNotFoundException` while resolving a long package-cache assembly path. The observed canonical Active path contained a duplicated Project UUID segment:

```text
...\TF\<project-uuid>\<project-uuid>\active\1-...\Library\PackageCache\...\Unity.VisualScripting.YamlDotNet.dll
```

Source review found two separable issues:

1. normal receive → Unity launch uses the verified WP5.1 execution-alias strategy for high-risk paths, but **Open existing verified project** launched the canonical Active path directly;
2. selecting an individual TeamForge Project UUID directory as the managed Projects root can lead to a nested `<uuid>\<uuid>` layout and should be rejected explicitly rather than silently reused as another managed root.

The follow-up source change reuses the identity-bound execution-alias strategy for Existing-Active recovery and adds a fail-closed nested-project-root guard. These fixes remain **source evidence only** until a new immutable candidate is built, exact-release-validated, and physically retested.

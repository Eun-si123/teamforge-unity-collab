# TeamForge compatibility

This page describes **human-readable compatibility and topology boundaries**.

- Exact current product/runtime/protocol selections → [`../release-contract.json`](../release-contract.json)
- Current validation/readiness → [STATUS.md](STATUS.md)
- Packaged artifact identity → [`../builds/README.md`](../builds/README.md) + exact Release SHA-256

Avoid copying fast-changing tool/runtime patch numbers into multiple documents. The release contract owns those exact selections.

## Before you test

Use a disposable project and keep backups: TeamForge is an Early Public Preview, and [STATUS.md](STATUS.md) owns the current field-validation boundaries. The platform matrix below distinguishes the packaged target from source/build requirements.

Minimum CPU, RAM, GPU, disk, bandwidth and latency requirements have not yet been established through controlled testing. A successful prototype run is not a minimum-hardware recommendation.

Guests must be able to reach the configured Server and the Host's advertised Project Peer endpoint. A signed invite does not create network reachability. Use the same machine, a reachable LAN or a managed VPN; automatic Internet traversal and relay are not provided.

## Product / protocol compatibility

TeamForge components are intended to move as one compatible product line rather than as independently mixed Server/Project Peer/Launcher/package versions.

The current architecture separates:

- realtime collaboration authority over the configured TeamForge Server WebSocket;
- Project bootstrap/metadata coordination;
- direct Project Peer payload transfer;
- packaged Host/Guest Runtime and Launcher integrity.

Protocol/schema version compatibility is additive only when existing semantics remain compatible. Exact selected protocol/schema numbers belong to `release-contract.json`.

Do not mix generated Runtime/Launcher manifests or binaries from different packaged candidates merely because the visible product version is the same.

## Unity compatibility

The current supported Unity product line is **Unity 6000.3**.

Current source additionally admits stable **Unity 6000.6** Projects as **experimental**. Source publication and preflight accept stable `f` builds only; the Editor Doctor reports an experimental warning. Other Unity lines and 6000.6 alpha, beta or patch-suffix builds remain outside this admission policy. The existing 6000.3 metadata compatibility rules remain unchanged.

A Project's complete Editor version remains part of its verified metadata. In verified Project transfer and Launcher Guest handoff, the selected Editor must still match that exact version; experimental source admission does not remove this check or silently upgrade a verified Project. Manual TF1 realtime codes bind Project/Scene identity without carrying an Editor version, so manual mixed-version realtime collaboration remains unverified. The [Unity workflow](../.github/workflows/unity-tests.yml) exercises baseline, current 6.3 LTS patch and explicitly labelled 6.6 experimental Authority/Lock cells. A configured cell is not a PASS: inspect the actual Editor version and exact-commit results before making a tested claim. Experimental source admission does not change the recorded release Editor, UPM minimum or existing packaged candidate.

A specific Editor patch becomes a validated claim only when it has recorded evidence for the intended source/candidate. Do not treat whichever Unity patch is newest upstream as automatically tested or supported.

Exact recorded test Editor selection is stored in `release-contract.json` and current evidence is summarized in [STATUS.md](STATUS.md).

## Developer/runtime compatibility

Source developers should use the Node/npm/.NET/tool ranges selected by `release-contract.json` and the repository lock/build configuration.

These are **source/build requirements**, not normal end-user installation requirements for the packaged Host/Guest path, which uses bundled/self-contained runtime components according to the current release contract.

A new major Runtime/toolchain family should receive a deliberate compatibility decision and validation rather than being inferred from successful installation on one machine.

## Supported topology

Current supported/intentional topology includes:

- configured TeamForge Server WebSocket for realtime authority;
- direct Project Peer HTTP transfer on the same PC, reachable LAN or managed VPN;
- explicit loopback-only same-PC mode;
- authenticated non-loopback listening with a concrete advertised Guest host;
- packaged Windows Host/Guest flow using a verified bundled Runtime.

Not currently provided as supported topology:

- WebRTC / RTCDataChannel;
- ICE / STUN / TURN;
- automatic NAT traversal;
- relay / automatic transport fallback;
- automatic peer discovery;
- serverless/embedded realtime authority;
- untrusted public-Internet deployment with a full user-identity/authorization system.

`P2P` in current TeamForge documentation means **direct Project Peer payload transfer**, not automatic Internet P2P connectivity.

## Platform matrix

| Surface | Compatibility status |
| --- | --- |
| Windows x64 bundled Runtime / Guest Launcher | Current packaged platform direction; exact candidate still follows STATUS field gates |
| Unity 6000.3 | Current Unity product line |
| Exact recorded Unity patch | See `release-contract.json` + STATUS evidence |
| Other Unity 6000.3 patches | Require separate rebaseline/validation before a tested claim |
| Stable Unity 6000.6 source | Experimental admission and separate CI evidence; not a packaged/physical support claim |
| macOS/Linux standalone Launcher | Not packaged as an equivalent current candidate |
| Docker/Compose | Source/server option, not the normal packaged Host path or current release gate |
| Authenticode | Distribution/signing status belongs to STATUS/current artifact documentation |

## Current-source Windows managed storage

Current source requires a local fixed NTFS/ReFS managed root for Windows Project identity locking. Network, unavailable or unverified roots fail closed. This is a condition for TeamForge's managed storage, not a new general Unity project requirement. See [STATUS.md](STATUS.md) for the source-versus-published-candidate boundary and [the owning implementation](../project-peer/src/project-identity-lock.mjs).

## Compatibility claims and history

Historical phase/work-state/test reports apply to the source/artifact they recorded. They must not be used as current compatibility evidence merely because the visible product version resembles the current line.

When exact byte identity matters, use the Release asset filename + SHA-256 rather than product version alone.

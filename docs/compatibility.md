# TeamForge compatibility

This page describes **human-readable compatibility and topology boundaries**.

- Exact current product/runtime/protocol selections → [`../release-contract.json`](../release-contract.json)
- Current validation/readiness → [STATUS.md](STATUS.md)
- Packaged artifact identity → [`../builds/README.md`](../builds/README.md) + exact Release SHA-256

Avoid copying fast-changing tool/runtime patch numbers into multiple documents. The release contract owns those exact selections.

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
| macOS/Linux standalone Launcher | Not packaged as an equivalent current candidate |
| Docker/Compose | Source/server option, not the normal packaged Host path or current release gate |
| Authenticode | Distribution/signing status belongs to STATUS/current artifact documentation |

## Compatibility claims and history

Historical phase/work-state/test reports apply to the source/artifact they recorded. They must not be used as current compatibility evidence merely because the visible product version resembles the current line.

When exact byte identity matters, use the Release asset filename + SHA-256 rather than product version alone.

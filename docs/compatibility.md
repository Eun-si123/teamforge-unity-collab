# Compatibility — TeamForge 0.5.1 WP5.1

Release identity: `0.5.1-wp5.1-path-resilience`  
Release state: **FIELD BLOCKED**

## Product and protocols

The current components are version-aligned at product version `0.5.1`:

- workspace/source tools;
- Server health and Project Coordinator;
- Project Peer CLI/constants;
- Unity package and contract;
- bundled Runtime contract;
- Windows Launcher assembly/file/product metadata;
- Launcher and release manifests.

The product version does not uniquely identify every packaged candidate produced during stabilization. Use `release-contract.json` for the current release ID and runtime selections, and use the exact artifact filename + SHA-256 for byte-level packaged identity.

Realtime Protocol, Project Transfer Protocol, and Project Manifest Schema remain version 1. Hierarchy capability is additive. Project payloads remain direct HTTP between Project Peers and never traverse the Coordinator.

The signed 0.5.0 golden compatibility fixture is intentionally frozen historical Protocol v1 evidence. It is not a current product-version or current-candidate declaration.

## Runtime lines

| Component | Current selection |
| --- | --- |
| Product version | 0.5.1 |
| Release ID | 0.5.1-wp5.1-path-resilience |
| Bundled Node | 24.19.0 |
| Developer/source Node | >=22.23.2 <23 or >=24.18.1 <25 |
| npm release tool | 11.19.0 |
| ws | 8.21.3 |
| Launcher target | net10.0-windows |
| Self-contained .NET runtime | 10.0.11 |
| Reproducible/tested .NET SDK | 10.0.303 |
| Unity package minimum | 6000.3 |
| Recorded candidate test Editor | 6000.3.21f1 |

A new Node major, npm major, .NET major, Unity release family, or materially different runtime selection requires a separate compatibility decision/evidence update.

Do not keep a durable statement such as “Unity X is the latest/current patch” in this compatibility contract. Upstream patch availability changes independently of TeamForge. The stable claim here is only that the package targets Unity `6000.3` and `6000.3.21f1` is the recorded candidate test Editor. A different patch needs its own validation evidence.

## Supported topology

- configured TeamForge Server WebSocket for realtime authority;
- direct HTTP Project Peer transfer on same PC, reachable LAN, or managed VPN;
- explicit loopback-only same-PC mode;
- authenticated non-loopback listening with a concrete advertised Guest host;
- packaged Windows Host/Guest runtime using the manifest-pinned bundled Node runtime.

Unsupported: WebRTC, ICE, STUN, TURN, relay, NAT traversal, discovery, automatic route fallback, serverless/embedded authority, and untrusted public-internet deployment.

`P2P` in current TeamForge documentation means direct Project Peer payload transfer. It does not imply automatic peer discovery or automatic internet/NAT traversal.

## Platform matrix

| Surface | Status |
| --- | --- |
| Windows x64 bundled Runtime and Launcher | Current packaged candidate lineage; exact artifact still subject to field gates |
| Unity 6000.3.21f1 test project | Recorded candidate baseline; use retained exact-candidate evidence for PASS claims |
| Exact current-candidate two-PC Windows Host → fresh Guest | Required before closure; FIELD BLOCKED until recorded |
| Other Unity 6000.3 patches | Separate rebaseline/validation required before claiming candidate support |
| macOS/Linux standalone Launcher | NOT PACKAGED / NOT RUN as equivalent current candidate |
| Docker/Compose | NOT RUN as a current release gate |
| Authenticode | NOT SIGNED |

Historical reports under `docs/` retain evidence for their exact artifact and must not be read as current 0.5.1/WP5.1 execution results.

See [STATUS.md](STATUS.md) for current readiness, [`../release-contract.json`](../release-contract.json) for exact current candidate/runtime identity, and [`../builds/README.md`](../builds/README.md) for packaged artifact classification.

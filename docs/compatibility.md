# Compatibility — TeamForge 0.5.1

## Product and protocols

The current components are version-aligned at 0.5.1:

- workspace/source tools;
- Server health and Project Coordinator;
- Project Peer CLI/constants;
- Unity package and contract;
- bundled Runtime;
- Windows Launcher assembly/file/product metadata;
- Launcher and release manifests.

Realtime Protocol, Project Transfer Protocol, and Project Manifest Schema remain
version 1. Hierarchy capability is additive. Project payloads remain direct
HTTP between Project Peers and never traverse the Coordinator.

The signed 0.5.0 golden compatibility fixture is intentionally frozen historical
Protocol v1 evidence. It is not a current product-version declaration.

## Runtime lines

| Component | Current selection |
| --- | --- |
| Bundled Node | 24.19.0 |
| Developer/fallback Node | >=22.23.2 <23 or >=24.18.1 <25 |
| npm release tool | 11.19.0 |
| ws | 8.21.3 |
| Launcher target | net10.0-windows |
| Self-contained .NET runtime | 10.0.11 |
| Reproducible .NET SDK | 10.0.303 |
| Unity package minimum | 6000.3 |
| Candidate test Editor | 6000.3.21f1 |

Node 26, npm 12, a new .NET major, or a new Unity release family requires a
separate compatibility decision. Unity 6000.3.22f1 is the latest same-line
patch but remains a rebaseline follow-up until installed and tested.

## Supported topology

- configured TeamForge Server WebSocket for realtime authority;
- direct HTTP Project Peer transfer on same PC, reachable LAN, or managed VPN;
- explicit loopback-only same-PC mode;
- authenticated non-loopback listening with a concrete advertised Guest host.

Unsupported: WebRTC, ICE, STUN, TURN, relay, NAT traversal, discovery,
automatic route fallback, serverless/embedded authority, and untrusted public
internet deployment.

## Platform matrix

| Surface | Status |
| --- | --- |
| Windows x64 bundled Runtime and Launcher | Packaged; automated gates required |
| Unity 6000.3.21f1 test project | Candidate baseline; current result recorded separately |
| Two-PC Windows Host → fresh Guest | NOT RUN on the frozen ZIP; FIELD BLOCKED |
| Unity 6000.3.22f1 | NOT RUN follow-up |
| macOS/Linux standalone Launcher | NOT PACKAGED / NOT RUN |
| Docker/Compose | NOT RUN in this release audit |
| Authenticode | NOT SIGNED |

Historical reports under `docs/` retain evidence for their exact artifact and
must not be read as current 0.5.1 execution results.

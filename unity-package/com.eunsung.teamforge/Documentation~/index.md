# Unity TeamForge 0.5.1 WP4 Field Hotfix

Menu: **Window > TeamForge > Collaboration**

Normal Host:

1. Select a concrete Guest address and the separate Coordinator listen address.
2. Save the Scene and choose **Publish & Start**.
3. Share the automatically copied signed **Collaboration Invite**.
4. Share the access code through a separate trusted channel.

Normal fresh Guest:

1. Run the Windows x64 standalone Launcher.
2. Paste the Collaboration Invite and access code.
3. Review Publisher/Project trust and receive the Project.
4. Launch Unity from the verified immutable Active revision.

Host Ready requires a `teamforge-bootstrap-invite-v1` envelope. A TF1-only
Session Invite is available under Advanced for an already-provisioned matching
Project, but cannot bootstrap a fresh Guest. Missing realtime data returns
`realtime_session_missing`.

The Coordinator may listen on `0.0.0.0`; invites must advertise a concrete,
reachable non-loopback address for two-PC use. Non-loopback listening requires
authentication. Explicit same-PC mode may use loopback for both values.

Realtime, Project Transfer, and Manifest contracts remain version 1. Project
payloads remain direct HTTP between Project Peers. WebRTC/ICE/STUN/TURN/relay,
NAT traversal, discovery, and automatic fallback are not implemented.

The package targets Unity 6000.3 LTS and this candidate is tested against
6000.3.21f1. WP4 remains **FIELD BLOCKED** pending the manual Windows two-PC
checklist.

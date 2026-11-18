# Source-only ws 8.23.0 contract review (2026-11-18)

This review applies to the main-source coordinated server and Project Peer
dependency upgrade, not to any immutable previously published r10 ZIP.

Only release-contract.json ws version and integrity changed; product
version, Release ID, Node and Unity versions, protocol versions, FIELD_BLOCKED
status, and published candidate metadata did not change. ws 8.23.0 registry
integrity matches the npm registry and all three updated lockfiles. The server
and Project Peer use that same pinned version; neither separately bumped
Dependabot PR should be accepted with an inconsistent runtime contract.

All twenty current homepage locale manifests were inspected for direct source
copy advertising the old ws version or unsupported new capability. None of
their replacements contains ws/WebSocket/Pong-specific source copy; existing
translated strings were preserved. Each manifest's release-contract.json
reviewed-source SHA was advanced to the new source contract blob. This is
a source-to-copy claim review, NOT native-speaker translation certification.

No published release/ZIP, two-physical-Editor field evidence, deploy policy,
server runtime or production process was modified. Independent GitHub CI and
a new exact Windows packaged candidate remain separate release gates.

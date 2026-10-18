# Test Lab: two-physical-Windows-PC source LAN lane

This is an automated **source-level Direct Project Peer transfer** test on two **different real Windows computers**, not a replacement for packaged Launcher + Unity Editor physical field validation. The canonical release blocker remains in [STATUS.md](STATUS.md).

## What is actually automated

On PC A (Host), Test Lab creates an ephemeral, non-sensitive 1–8 MiB Unity-shaped project fixture, builds the production Project Peer Manifest and signed Descriptor, then starts the **real** DirectTransferServer listening on an OS-selected TCP port. PC A uses an already authorized and host-key-verified OpenSSH session to ask PC B (Guest) to run the checked-out **same source commit**. PC B downloads actual chunks from PC A via the production DirectTransferClient and SwarmDownloader over LAN HTTP. It verifies that:

- A deliberately wrong Bearer token receives HTTP 401.
- Signed Owner/Project Descriptor discovery, Manifest binding, and verified Chunk download succeed.
- SHA-256-verified chunks are readable from the Guest's physical disk.
- A second transfer reuses **all** previously verified chunks without downloading them again.
- Host and Guest report distinct Windows computer names and the exact same Git commit.

SSH only controls the Guest test process and sends a fresh random transfer token over its encrypted stdin. Project payload **does not** travel over SSH or the Coordinator. The test never publishes a user project or changes real TeamForge identities, sessions, firewalls, Unity projects, or Windows security policy.

## Preparation (once per PC)

1. Both PCs: Windows x64, supported Node 22/24, and matching checkouts of the same TeamForge Git commit. From each source checkout, install Project Peer dependencies with npm run install:peer.
2. PC B: OpenSSH Server enabled only for the intended trusted LAN / Host and a dedicated, least-privilege testing account. PC A: OpenSSH Client, key-based authentication, and an already verified PC B host key (ssh tester@guest-pc hostname). **Do not disable strict host-key checking or expose SSH on the Internet to make testing pass.**
3. PC B: make node accessible to its non-interactive SSH session. Put the repo in a simple fixed path **without spaces**, for example C:\TeamForge; the script entry point is C:/TeamForge/scripts/field-two-pc.mjs.
4. PC A: identify the actual IPv4 address of its LAN interface. A wrong, incomplete, loopback, or nonlocal IP is refused before binding.
5. Windows Defender Firewall on PC A must allow the relevant **temporary Node TCP listener** from PC B for the duration of testing, scoped to the trusted Private network and appropriate local subnet. The port is selected dynamically and recorded in the **local ignored** evidence file. Prepare a tightly scoped test rule or explicit Windows approval yourself; the test will not silently alter firewall rules or widen Public/WAN exposure.

## Execute from PC A

In PowerShell, from the same checkout as PC B:

~~~powershell
$env:TEAMFORGE_FIELD_GUEST_SSH = "tester@guest-pc"
$env:TEAMFORGE_FIELD_HOST_IPV4 = "192.168.1.10" # replace with Host's actual LAN IP
$env:TEAMFORGE_FIELD_GUEST_SCRIPT = "C:/TeamForge/scripts/field-two-pc.mjs"
$env:TEAMFORGE_FIELD_SIZE_MIB = "2"
npm run testlab -- run field-two-pc
~~~

npm run testlab -- plan field-two-pc describes the lane. The command works only when both real Windows computers are configured correctly. Without those prerequisites it **fails** rather than reporting a fabricated PASS.

## Results and limitations

The existing Test Lab writes its step summary.json under test-results/test-lab. This lane additionally writes a bounded, structured result to test-results/field-two-pc/<timestamp>-<run-id>.json. Both are local ignored output. The independent result records the source commit, both machine roles, ephemeral Host listener address/port, elapsed time, verified bytes/chunks, resume byte count, and a clear fieldGateComplete: false marker. Failures record a stable code, not a transfer token or private remote stderr.

- **PASS** means the enumerated source-level two-PC Direct HTTP assertions succeeded. It does **not** mean the r8/next candidate Windows ZIP, Launcher, Guest trust UI, Unity Editor realtime collaboration, SceneView locks, Host Stop/Start, firewall UAC prompts, or recovery GUI were tested.
- For that broader gate, add a separate runtime-/artifact-pinned Unity Editor driver and WPF UI automation (interactive desktop or automation-accessible equivalent), and collect scenario-specific test evidence without suppressing trust decisions. Keep the existing field scenario **manual/incomplete** until this actually exists and is executed.
- Changing the source commit requires synchronizing both checkouts before rerunning. No retry loop masks a transient failure.
- The default OS-selected listener port may require a temporary, manually approved Private/LocalSubnet rule. If the Guest cannot reach it, preserve that failure as real LAN evidence instead of making the port publicly reachable.

For user-facing Host/Guest behavior and exact candidate requirements, see [TEST_LAB.md](TEST_LAB.md) and [STATUS.md](STATUS.md).

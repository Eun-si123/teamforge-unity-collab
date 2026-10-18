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


## Next lane: physical Host Unity Editor vs Guest realtime Node peer

This lane runs the **existing Unity EditMode E2E authority and lock-contention assertions** on Host PC A while the existing CI protocol Peer B runs on **physical Windows PC B** over the real authenticated LAN. Compared with the source-only transfer lane above, this exercises a real Unity Editor and a physically separate remote collaboration client. It still does **not** open Unity Editor or Launcher on the Guest, and therefore does not close the whole two-Unity-Editor/packaged release gate.

The two named scenarios each start a fresh ephemeral authenticated TeamForge Server bound to Host PC A at an OS-selected port, remotely start one peer over an already trusted SSH connection, then run **one isolated Unity 6000.3.21f1 EditMode test**. The local Unity instance connects to Host loopback; the remote Node peer connects to Host's actual LAN IP. The test asserts Presence, real Transform/Lock authority handoff, unauthorized competing locks, blocked Transform/Hierarchy mutations, and authoritative reconciliation. On success the Guest sends a list of required evidence filenames; test summaries and Unity NUnit XML/logs stay local in ignored test-results/field-realtime. No actual Project Peer file payload is transferred in this lane; keep it separate from field-two-pc.

### Prerequisites

- **Both Windows PCs:** same PR/commit checkout. PC A must have Node 22 or 24, TeamForge server dependencies installed with npm run install:server, and Unity **6000.3.21f1** installed, with Unity license activation working in batch mode. PC B must have supported Node and TeamForge server dependencies installed. No Unity Editor is required on PC B for this intermediate lane.
- PC B OpenSSH Server must be reachable **only from the trusted private LAN**, configured for noninteractive key-based login. The Host PC's SSH client must already trust Guest's authentic SSH host key. Do not bypass host key checking, expose SSH to the public Internet, or use a user account with administrator rights unless required by separately approved setup.
- The Windows firewall on PC A must permit the ephemeral Node Coordinator TCP listening port from the intended Guest PC on the trusted **Private/LocalSubnet** network. The runner deliberately does not create firewall rules or widen exposure. Because the port is OS-selected, either explicitly approve a narrow program-specific rule for the dedicated Node runtime in the trusted environment or arrange an equally constrained preapproved test firewall policy.
- Run from a **disposable, backed-up Unity validation checkout** with no live editor already holding unity-project open. The test temporarily edits Editor settings and generates a test Scene; its cleanup restores the original settings on normal test completion. Abrupt Unity process termination can leave UserSettings/Library test residue, so never use a valuable project.

### Host PC PowerShell invocation

Set the Host LAN address and the actual Unity.exe path for PC A. The remote script path must be the absolute path of this same checkout on PC B, using forward slashes and no spaces.

~~~powershell
$env:TEAMFORGE_FIELD_GUEST_SSH = "tester@guest-pc"
$env:TEAMFORGE_FIELD_HOST_IPV4 = "192.168.1.10" # replace with Host LAN IPv4
$env:TEAMFORGE_FIELD_GUEST_REALTIME_SCRIPT = "C:/TeamForge/scripts/field-realtime-guest.mjs"
$env:TEAMFORGE_FIELD_UNITY_EDITOR = "C:\Program Files\Unity\Hub\Editor\6000.3.21f1\Editor\Unity.exe"
npm run testlab -- plan field-realtime-two-pc
npm run testlab -- run field-realtime-two-pc
~~~

The runner runs two scenarios sequentially and stops on the first failure. It fails closed on no SSH identity/ready evidence, mismatched Git commit, no remote named evidence, missing NUnit XML, zero/ignored tests, non-passing Unity assertions, peer termination, and timeouts. Logs do not print the temporary access code or remote peer's stderr; nonetheless, **review all local generated Unity logs before sharing**. The user must not claim a pass until the command actually finishes with PASS on two distinct Windows machines.

Supported test commands:

~~~powershell
npm run test:field-realtime
npm run testlab -- run field-realtime-selftest
~~~

These source tests verify harness configuration and reject forged/no-result inputs. They do **not** satisfy two-PC field evidence. CI checks these source tests on Windows Node 22/24 and Linux Node 24; the real physical scenario only runs after explicit local setup, never silently in GitHub hosted runners.

**What remains for true full two-PC automation:** run the actual packaged Host Unity plugin and Guest Windows Launcher/Unity Editor on the two machines, verify exact release ZIP/SHA and trust/Publisher/handoff UI, and execute the physical Scene/Hierarchy/Lock/port/UAC/recovery scenario matrix in both real Editors. This requires a carefully scoped Windows interactive UI driver or in-Editor test API on **both** PCs. No claim of completed physical evidence is made by this source PR.


## Run both automated physical sublanes with one Test Lab command

After supplying all the environment variables from **both** preparation blocks above, run:

~~~powershell
npm run testlab -- plan field-two-pc-automated
npm run testlab -- run field-two-pc-automated
~~~

The aggregate reports PASS only when both the physical Project Peer file transfer and physical Unity-vs-remote-Node realtime tests pass. It leaves the broader packaged two-Unity-Editor `field\` scenario INCOMPLETE / NOT RUN. A failure in the first sublane prevents falsely running or marking later sublanes as passed.

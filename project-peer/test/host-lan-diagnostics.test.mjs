import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";

const run = promisify(execFile);
const workspace = fileURLToPath(new URL("../../", import.meta.url));
// A test-only executable selection permits the identical fully mocked fixture
// on other developer platforms. Production never reads this environment value.
const fixturePowerShell = process.env.TEAMFORGE_LAN_TEST_PWSH;

test("Windows Host LAN scripts inspect exact mocked interfaces and firewall scopes without mutation", {
  skip: process.platform !== "win32" && !fixturePowerShell ? "Windows PowerShell fixture runs in the Windows CI lane." : false,
  timeout: 120_000,
}, async () => {
  const scratch = await mkdtemp(path.join(os.tmpdir(), "teamforge-lan-diagnostics-"));
  try {
    const stub = path.join(scratch, "UnityStub.cs");
    const proxy = path.join(scratch, "ProbeProxy.cs");
    const driver = path.join(scratch, "fixture.ps1");
    await writeFile(stub, `namespace UnityEngine {
      public enum RuntimePlatform { WindowsEditor }
      public static class Application {
        public static RuntimePlatform platform { get { throw new System.InvalidOperationException("Unity platform must be captured on the main thread."); } }
      }
    }\n`);
    await writeFile(proxy, `namespace EunSung.TeamForge {
      public static class LanProbeFixture {
        public static string Profile() { return TeamForgeWindowsFirewall.BuildHostNetworkCategoryProbeScript("192.0.2.19"); }
        public static string Rules() { return TeamForgeWindowsFirewall.BuildDiagnosticRuleProbeScript(5080, 53781); }
        public static string UnboundSeed() { return TeamForgeWindowsFirewall.BuildDiagnosticRuleProbeScript(5080, 0); }
        public static string LegacyRules() { return TeamForgeWindowsFirewall.BuildProbeScript(5080, 53781); }
      }
    }\n`);
    await writeFile(driver, fixtureScript);
    const source = path.join(workspace, "unity-package", "com.eunsung.teamforge", "Editor", "UX");
    const { stdout } = await run(fixturePowerShell || "pwsh", [
      "-NoProfile", "-NonInteractive", "-File", driver,
      "-Firewall", path.join(source, "TeamForgeWindowsFirewall.cs"),
      "-Model", path.join(source, "TeamForgeHostLanDiagnostics.cs"),
      "-Stub", stub, "-Proxy", proxy,
    ], { timeout: 115_000, maxBuffer: 1024 * 1024, windowsHide: true });
    assert.match(stdout, /RESULT 28 mocked script cases passed/u);
    // The fixture substitutes every queried cmdlet before executing generated
    // scripts in child PowerShell processes. No real firewall or network state
    // is queried, changed, or used as physical-connectivity evidence.
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

const fixtureScript = String.raw`param([string]$Firewall, [string]$Model, [string]$Stub, [string]$Proxy)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
Add-Type -Path @($Firewall, $Model, $Stub, $Proxy) -ErrorAction Stop
$profile = [EunSung.TeamForge.LanProbeFixture]::Profile()
$rules = [EunSung.TeamForge.LanProbeFixture]::Rules()
$unbound = [EunSung.TeamForge.LanProbeFixture]::UnboundSeed()
$legacy = [EunSung.TeamForge.LanProbeFixture]::LegacyRules()
foreach ($script in @($profile, $rules, $unbound, $legacy)) {
    if ($script -match '(?i)(New|Set|Remove)-Net|runas|ExecutionPolicy') { throw 'Diagnostic script contains a mutation or elevation.' }
}
$mocks = @'
function Import-Module { [CmdletBinding()] param([string]$Name) }
function Get-NetIPAddress {
    [CmdletBinding()] param([string]$AddressFamily, [string]$IPAddress)
    if ($AddressFamily -ne 'IPv4' -or $IPAddress -ne '192.0.2.19') { throw 'Unexpected address query.' }
    if ($global:FixtureMode -eq 'no_address') { return }
    $value = [pscustomobject]@{ InterfaceIndex = 17; AddressState = 'Preferred' }
    if ($global:FixtureMode -eq 'tentative') { $value.AddressState = 'Tentative' }
    $value
    if ($global:FixtureMode -eq 'multiple_addresses') { $value }
}
function Get-NetIPInterface {
    [CmdletBinding()] param([string]$AddressFamily, [int]$InterfaceIndex)
    if ($AddressFamily -ne 'IPv4' -or $InterfaceIndex -ne 17) { throw 'Unexpected interface query.' }
    $value = [pscustomobject]@{ ConnectionState = 'Connected' }
    if ($global:FixtureMode -eq 'down') { $value.ConnectionState = 'Disconnected' }
    $value
    if ($global:FixtureMode -eq 'multiple_interfaces') { $value }
}
function Get-NetConnectionProfile {
    [CmdletBinding()] param([int]$InterfaceIndex)
    if ($InterfaceIndex -ne 17) { throw 'Unexpected profile query.' }
    if ($global:FixtureMode -eq 'unknown') { return }
    $category = switch ($global:FixtureMode) { 'public' { 'Public' }; 'domain' { 'DomainAuthenticated' }; default { 'Private' } }
    $value = [pscustomobject]@{ NetworkCategory = $category }
    $value
    if ($global:FixtureMode -eq 'multiple_profiles') { $value }
}
function Get-NetFirewallRule {
    [CmdletBinding()] param([string]$PolicyStore, [string]$Name)
    if ($PolicyStore -ne 'ActiveStore' -or $Name -notin @('TeamForge-Coordinator-LAN-v1', 'TeamForge-Seed-LAN-v1')) { throw 'Unexpected rule query.' }
    if ($global:FixtureMode -eq 'query_error') { throw 'Public synthetic query failure.' }
    if ($global:FixtureMode -eq 'missing' -or
        ($global:FixtureMode -eq 'coordinator_missing' -and $Name -eq 'TeamForge-Coordinator-LAN-v1') -or
        ($global:FixtureMode -eq 'seed_missing' -and $Name -eq 'TeamForge-Seed-LAN-v1')) { return }
    $value = [pscustomobject]@{ Name = $Name; Enabled = 'True'; Direction = 'Inbound'; Action = 'Allow'; Profile = 'Private'; EdgeTraversalPolicy = 'Block' }
    switch ($global:FixtureMode) {
        'public_rule' { $value.Profile = 'Public' }
        'multi_profile' { $value.Profile = 'Private, Public' }
        'disabled' { $value.Enabled = 'False' }
        'edge_allowed' { $value.EdgeTraversalPolicy = 'Allow' }
    }
    $value
    if ($global:FixtureMode -eq 'duplicate') { $value }
}
function Get-NetFirewallPortFilter {
    [CmdletBinding()] param([Parameter(ValueFromPipeline = $true)]$Rule)
    process {
        $port = if ($Rule.Name -eq 'TeamForge-Coordinator-LAN-v1') { '5080' } else { '53781' }
        $value = [pscustomobject]@{ Protocol = 'TCP'; LocalPort = @($port) }
        switch ($global:FixtureMode) {
            'extra_port' { $value.LocalPort = @($port, '44444') }
            'any_port' { $value.LocalPort = @('Any') }
            'udp' { $value.Protocol = 'UDP' }
        }
        $value
        if ($global:FixtureMode -eq 'duplicate_filter') { $value }
    }
}
function Get-NetFirewallAddressFilter {
    [CmdletBinding()] param([Parameter(ValueFromPipeline = $true)]$Rule)
    process {
        $value = [pscustomobject]@{ RemoteAddress = @('LocalSubnet') }
        switch ($global:FixtureMode) {
            'extra_remote' { $value.RemoteAddress = @('LocalSubnet', 'Any') }
            'any_remote' { $value.RemoteAddress = @('Any') }
        }
        $value
    }
}
'@
$cases = @(
    @('private', $profile, 21), @('public', $profile, 20), @('domain', $profile, 22),
    @('unknown', $profile, 3), @('no_address', $profile, 3), @('multiple_addresses', $profile, 3),
    @('tentative', $profile, 3), @('down', $profile, 3), @('multiple_interfaces', $profile, 3), @('multiple_profiles', $profile, 3),
    @('healthy', $rules, 43), @('missing', $rules, 40), @('coordinator_missing', $rules, 42), @('seed_missing', $rules, 41),
    @('duplicate', $rules, 40), @('extra_port', $rules, 40), @('any_port', $rules, 40), @('udp', $rules, 40),
    @('duplicate_filter', $rules, 40), @('extra_remote', $rules, 40), @('any_remote', $rules, 40),
    @('public_rule', $rules, 40), @('multi_profile', $rules, 40), @('disabled', $rules, 40), @('edge_allowed', $rules, 40),
    @('healthy', $unbound, 41), @('healthy', $legacy, 0), @('extra_remote', $legacy, 3)
)
$executable = (Get-Process -Id $PID).Path
$newline = [Environment]::NewLine
foreach ($case in $cases) {
    $script = '$global:FixtureMode = ''' + $case[0] + "'" + $newline + $mocks + $newline + $case[1]
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($script))
    & $executable -NoProfile -NonInteractive -EncodedCommand $encoded 2>$null
    if ($LASTEXITCODE -ne $case[2]) { throw ('Unexpected result for ' + $case[0] + ': ' + $LASTEXITCODE) }
}
$script = '$global:FixtureMode = ''query_error''' + $newline + $mocks + $newline + $rules
$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($script))
& $executable -NoProfile -NonInteractive -EncodedCommand $encoded 2>$null
if ($LASTEXITCODE -ge 40 -and $LASTEXITCODE -le 43) { throw 'Query failure was reported as verified rule state.' }
Write-Output ('RESULT ' + $cases.Count + ' mocked script cases passed')
`;

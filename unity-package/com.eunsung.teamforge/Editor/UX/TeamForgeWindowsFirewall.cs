using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;
using UnityEngine;

namespace EunSung.TeamForge
{
    internal static class TeamForgeWindowsFirewall
    {
        internal const int DefaultCoordinatorPort = 5080;
        internal const int DefaultSeedPort = 5091;
        internal const string CoordinatorRuleName = "TeamForge-Coordinator-LAN-v1";
        internal const string SeedRuleName = "TeamForge-Seed-LAN-v1";

        internal static bool IsSupportedPlatform => Application.platform == RuntimePlatform.WindowsEditor;

        // Read-only probe: the exact IPv4 address advertised to Guests maps to
        // an active Windows interface. Never choose an unrelated VPN/adapter by name.
        internal static string BuildHostNetworkCategoryProbeScript(string advertisedIpv4)
        {
            if (!System.Net.IPAddress.TryParse(advertisedIpv4, out var address) ||
                address.AddressFamily != System.Net.Sockets.AddressFamily.InterNetwork ||
                !string.Equals(address.ToString(), advertisedIpv4, StringComparison.Ordinal))
            {
                throw new ArgumentException("Expected one canonical advertised IPv4 address.", nameof(advertisedIpv4));
            }

            return BuildCommonPrelude() +
                "$address = @(Get-NetIPAddress -AddressFamily IPv4 -IPAddress '" + advertisedIpv4 +
                "' -ErrorAction SilentlyContinue)\n" +
                "if ($address.Count -ne 1) { exit 3 }\n" +
                "if ([string]$address[0].AddressState -ne 'Preferred' -or [int]$address[0].InterfaceIndex -le 0) { exit 3 }\n" +
                "$interface = @(Get-NetIPInterface -AddressFamily IPv4 -InterfaceIndex $address[0].InterfaceIndex -ErrorAction SilentlyContinue)\n" +
                "if ($interface.Count -ne 1 -or [string]$interface[0].ConnectionState -ne 'Connected') { exit 3 }\n" +
                "$profile = @(Get-NetConnectionProfile -InterfaceIndex $address[0].InterfaceIndex -ErrorAction SilentlyContinue)\n" +
                "if ($profile.Count -ne 1) { exit 3 }\n" +
                "switch ([string]$profile[0].NetworkCategory) {\n" +
                "  'Public' { exit 20 }\n" +
                "  'Private' { exit 21 }\n" +
                "  'DomainAuthenticated' { exit 22 }\n" +
                "}\nexit 3\n";
        }

        internal static bool IsPrivateRuleProfileMismatch(string category)
        {
            return string.Equals(category, "Public", StringComparison.Ordinal) ||
                   string.Equals(category, "DomainAuthenticated", StringComparison.Ordinal);
        }

        internal static bool TryReadHostNetworkCategory(
            string advertisedIpv4, out string category, out string error)
        {
            category = string.Empty;
            error = string.Empty;
            if (!IsSupportedPlatform)
            {
                error = "Windows-only network category probe.";
                return false;
            }

            string script;
            try { script = BuildHostNetworkCategoryProbeScript(advertisedIpv4); }
            catch (ArgumentException)
            {
                error = "The advertised Host address is not a canonical local IPv4 address.";
                return false;
            }
            if (!TryRunPowerShell(script, false, 10000, out var code, out error)) return false;
            switch (code)
            {
                case 20: category = "Public"; return true;
                case 21: category = "Private"; return true;
                case 22: category = "DomainAuthenticated"; return true;
                default:
                    error = "Windows did not resolve one active network profile for the advertised Host address.";
                    return false;
            }
        }

        internal static string BuildInstallScript(int coordinatorPort, int seedPort)
        {
            ValidatePort(coordinatorPort, nameof(coordinatorPort));
            ValidatePort(seedPort, nameof(seedPort));
            return BuildCommonPrelude() + $@"
function Set-TeamForgeRule([string]$Name, [string]$DisplayName, [int]$Port) {{
    Get-NetFirewallRule -PolicyStore PersistentStore -Name $Name -ErrorAction SilentlyContinue |
        Remove-NetFirewallRule -ErrorAction Stop
    New-NetFirewallRule -PolicyStore PersistentStore -Name $Name -DisplayName $DisplayName `
        -Description 'TeamForge LAN collaboration only. Private profile and LocalSubnet scope.' `
        -Direction Inbound -Action Allow -Enabled True -Profile Private -Protocol TCP `
        -LocalPort $Port -RemoteAddress LocalSubnet -EdgeTraversalPolicy Block | Out-Null
}}
try {{
    Set-TeamForgeRule '{CoordinatorRuleName}' 'TeamForge Coordinator (LAN)' {coordinatorPort}
    Set-TeamForgeRule '{SeedRuleName}' 'TeamForge Seed (LAN)' {seedPort}
}}
catch {{
    Get-NetFirewallRule -PolicyStore PersistentStore -Name '{CoordinatorRuleName}' -ErrorAction SilentlyContinue |
        Remove-NetFirewallRule -ErrorAction SilentlyContinue
    Get-NetFirewallRule -PolicyStore PersistentStore -Name '{SeedRuleName}' -ErrorAction SilentlyContinue |
        Remove-NetFirewallRule -ErrorAction SilentlyContinue
    throw
}}
";
        }

        internal static string BuildProbeScript(int coordinatorPort, int seedPort)
        {
            ValidatePort(coordinatorPort, nameof(coordinatorPort));
            ValidatePort(seedPort, nameof(seedPort));
            return BuildRuleProbePrelude() + $@"
if ((Test-TeamForgeRule '{CoordinatorRuleName}' {coordinatorPort}) -and
    (Test-TeamForgeRule '{SeedRuleName}' {seedPort})) {{ exit 0 }}
exit 3
";
        }

        internal static string BuildDiagnosticRuleProbeScript(int coordinatorPort, int seedPort)
        {
            ValidatePort(coordinatorPort, nameof(coordinatorPort));
            if (seedPort != 0) ValidatePort(seedPort, nameof(seedPort));
            var seedCheck = seedPort == 0 ? string.Empty :
                $"if (Test-TeamForgeRule '{SeedRuleName}' {seedPort}) {{ $result += 2 }}\n";
            return BuildRuleProbePrelude() +
                "$result = 40\n" +
                $"if (Test-TeamForgeRule '{CoordinatorRuleName}' {coordinatorPort}) {{ $result += 1 }}\n" +
                seedCheck + "exit $result\n";
        }

        private static string BuildRuleProbePrelude()
        {
            return BuildCommonPrelude() + @"
function Test-TeamForgeRule([string]$Name, [int]$Port) {
    $queryErrors = @()
    $rules = @(Get-NetFirewallRule -PolicyStore ActiveStore -Name $Name -ErrorAction SilentlyContinue -ErrorVariable queryErrors)
    if (@($queryErrors | Where-Object { $_.CategoryInfo.Category -ne 'ObjectNotFound' }).Count -ne 0) {
        throw 'Named firewall rule inspection failed.'
    }
    if ($rules.Count -ne 1) { return $false }
    $rule = $rules[0]
    if ([string]$rule.Enabled -ne 'True' -or [string]$rule.Direction -ne 'Inbound' -or
        [string]$rule.Action -ne 'Allow' -or [string]$rule.Profile -ne 'Private' -or
        [string]$rule.EdgeTraversalPolicy -ne 'Block') { return $false }
    $portFilters = @($rule | Get-NetFirewallPortFilter -ErrorAction Stop)
    if ($portFilters.Count -ne 1) { return $false }
    $portFilter = $portFilters[0]
    if ([string]$portFilter.Protocol -ne 'TCP' -or @($portFilter.LocalPort).Count -ne 1 -or
        [string]$portFilter.LocalPort -ne [string]$Port) { return $false }
    $addressFilters = @($rule | Get-NetFirewallAddressFilter -ErrorAction Stop)
    if ($addressFilters.Count -ne 1) { return $false }
    $addressFilter = $addressFilters[0]
    if (@($addressFilter.RemoteAddress).Count -ne 1 -or
        [string]$addressFilter.RemoteAddress -ne 'LocalSubnet') { return $false }
    return $true
}
";
        }

        // Worker-only entry: callers capture Windows support and immutable target
        // settings on the Unity main thread. No Unity API or configuration write
        // belongs in this read-only probe.
        internal static TeamForgeHostLanResult ReadHostLanDiagnostics(
            TeamForgeHostLanTarget target, CancellationToken cancellationToken)
        {
            if (target == null) throw new ArgumentNullException(nameof(target));
            cancellationToken.ThrowIfCancellationRequested();
            if (!target.CanProbe) return TeamForgeHostLanResult.Unknown("probe_failed");
            try
            {
                var profileCode = RunReadOnlyPowerShell(
                    BuildHostNetworkCategoryProbeScript(target.HostIpv4), cancellationToken);
                var profile = profileCode == 20 ? TeamForgeHostLanProfile.Public :
                    profileCode == 21 ? TeamForgeHostLanProfile.Private :
                    profileCode == 22 ? TeamForgeHostLanProfile.DomainAuthenticated : TeamForgeHostLanProfile.Unknown;
                var ruleCode = RunReadOnlyPowerShell(
                    BuildDiagnosticRuleProbeScript(target.CoordinatorPort, target.SeedPort), cancellationToken);
                var coordinator = TeamForgeHostLanRules.Unknown;
                var seed = TeamForgeHostLanRules.Unknown;
                if (ruleCode >= 40 && ruleCode <= 43)
                {
                    var mask = ruleCode.Value - 40;
                    coordinator = (mask & 1) != 0 ? TeamForgeHostLanRules.Matches : TeamForgeHostLanRules.Mismatch;
                    if (target.SeedPort > 0)
                        seed = (mask & 2) != 0 ? TeamForgeHostLanRules.Matches : TeamForgeHostLanRules.Mismatch;
                }
                return TeamForgeHostLanResult.FromProbe(target, profile, coordinator, seed);
            }
            catch (OperationCanceledException) { throw; }
            catch (TimeoutException) { return TeamForgeHostLanResult.Unknown("probe_timeout"); }
            catch { return TeamForgeHostLanResult.Unknown("probe_failed"); }
        }

        private static int? RunReadOnlyPowerShell(string script, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var system = Environment.GetFolderPath(Environment.SpecialFolder.System);
            if (string.IsNullOrEmpty(system)) return null;
            var executable = Path.Combine(system, "WindowsPowerShell", "v1.0", "powershell.exe");
            var startInfo = new ProcessStartInfo
            {
                FileName = executable,
                Arguments = "-NoProfile -NonInteractive -EncodedCommand " + Convert.ToBase64String(Encoding.Unicode.GetBytes(script)),
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            Process process;
            try { process = Process.Start(startInfo); }
            catch (Exception exception) when (exception is Win32Exception || exception is InvalidOperationException || exception is IOException)
            {
                return null;
            }
            if (process == null) return null;
            using (process)
            {
                // Drain without retaining command output, adapter details or
                // localized PowerShell errors in UI, logs or diagnostics.
                var elapsed = Stopwatch.StartNew();
                try
                {
                    process.OutputDataReceived += (_, __) => { };
                    process.ErrorDataReceived += (_, __) => { };
                    process.BeginOutputReadLine();
                    process.BeginErrorReadLine();
                    while (!process.WaitForExit(100))
                    {
                        cancellationToken.ThrowIfCancellationRequested();
                        if (elapsed.ElapsedMilliseconds >= 10000) throw new TimeoutException();
                    }
                    cancellationToken.ThrowIfCancellationRequested();
                    return process.ExitCode;
                }
                finally
                {
                    if (!process.HasExited)
                    {
                        try { process.Kill(); } catch { }
                        try { process.WaitForExit(1000); } catch { }
                    }
                }
            }
        }

        internal static string BuildRemoveScript()
        {
            return BuildCommonPrelude() + $@"
Get-NetFirewallRule -PolicyStore PersistentStore -Name '{CoordinatorRuleName}' -ErrorAction SilentlyContinue |
    Remove-NetFirewallRule -ErrorAction Stop
Get-NetFirewallRule -PolicyStore PersistentStore -Name '{SeedRuleName}' -ErrorAction SilentlyContinue |
    Remove-NetFirewallRule -ErrorAction Stop
";
        }

        internal static string BuildRemovedProbeScript()
        {
            return BuildCommonPrelude() + $@"
$coordinator = @(Get-NetFirewallRule -PolicyStore ActiveStore -Name '{CoordinatorRuleName}' -ErrorAction SilentlyContinue)
$seed = @(Get-NetFirewallRule -PolicyStore ActiveStore -Name '{SeedRuleName}' -ErrorAction SilentlyContinue)
if ($coordinator.Count -eq 0 -and $seed.Count -eq 0) {{ exit 0 }}
exit 3
";
        }

        internal static bool TryProbeLanRules(int coordinatorPort, int seedPort, out bool configured, out string error)
        {
            configured = false;
            error = string.Empty;
            if (!IsSupportedPlatform)
            {
                configured = true;
                return true;
            }

            var script = BuildProbeScript(coordinatorPort, seedPort);
            if (!TryRunPowerShell(script, false, 10000, out var exitCode, out error))
            {
                return false;
            }

            configured = exitCode == 0;
            if (!configured && exitCode != 3)
            {
                error = $"Windows Firewall rule inspection failed with exit code {exitCode}.";
                return false;
            }
            return true;
        }

        internal static bool TryInstallLanRules(int coordinatorPort, int seedPort, out string error)
        {
            error = string.Empty;
            if (!IsSupportedPlatform)
            {
                return true;
            }
            var script = BuildInstallScript(coordinatorPort, seedPort);
            if (!TryRunPowerShell(script, true, 120000, out var exitCode, out error))
            {
                return false;
            }
            if (exitCode != 0)
            {
                error = $"Windows Firewall configuration failed with exit code {exitCode}.";
                return false;
            }

            if (!TryProbeLanRules(coordinatorPort, seedPort, out var configured, out error))
            {
                return false;
            }
            if (!configured)
            {
                error = "Windows did not expose the expected TeamForge Private/LocalSubnet firewall rules after administrator approval.";
                return false;
            }
            return true;
        }

        internal static bool TryRemoveLanRules(out string error)
        {
            error = string.Empty;
            if (!IsSupportedPlatform)
            {
                return true;
            }

            // Avoid an unnecessary UAC prompt when both TeamForge rules are already absent.
            if (!TryRunPowerShell(BuildRemovedProbeScript(), false, 10000, out var exitCode, out error))
            {
                return false;
            }
            if (exitCode == 0)
            {
                return true;
            }
            if (exitCode != 3)
            {
                error = $"Windows Firewall rule presence check failed with exit code {exitCode}.";
                return false;
            }

            if (!TryRunPowerShell(BuildRemoveScript(), true, 120000, out exitCode, out error))
            {
                return false;
            }
            if (exitCode != 0)
            {
                error = $"Windows Firewall rule removal failed with exit code {exitCode}.";
                return false;
            }
            if (!TryRunPowerShell(BuildRemovedProbeScript(), false, 10000, out exitCode, out error))
            {
                return false;
            }
            if (exitCode != 0)
            {
                error = "Windows still reports one or more TeamForge LAN firewall rules after removal.";
                return false;
            }
            return true;
        }

        private static string BuildCommonPrelude()
        {
            return "$ErrorActionPreference = 'Stop'\nImport-Module NetSecurity -ErrorAction Stop\n";
        }

        private static void ValidatePort(int port, string parameterName)
        {
            if (port < 1 || port > 65535)
            {
                throw new ArgumentOutOfRangeException(parameterName, port, "TCP port must be between 1 and 65535.");
            }
        }

        private static bool TryRunPowerShell(
            string script,
            bool elevated,
            int timeoutMilliseconds,
            out int exitCode,
            out string error)
        {
            exitCode = -1;
            error = string.Empty;
            var encoded = Convert.ToBase64String(Encoding.Unicode.GetBytes(script));
            var startInfo = new ProcessStartInfo
            {
                FileName = "powershell.exe",
                Arguments = $"-NoProfile -NonInteractive -EncodedCommand {encoded}",
                UseShellExecute = elevated,
                CreateNoWindow = !elevated,
                WindowStyle = ProcessWindowStyle.Hidden,
            };
            if (elevated)
            {
                startInfo.Verb = "runas";
            }
            try
            {
                using (var process = Process.Start(startInfo))
                {
                    if (process == null)
                    {
                        error = "Windows PowerShell did not start.";
                        return false;
                    }
                    if (!process.WaitForExit(timeoutMilliseconds))
                    {
                        try { process.Kill(); } catch { }
                        error = "Windows Firewall configuration timed out.";
                        return false;
                    }
                    exitCode = process.ExitCode;
                    return true;
                }
            }
            catch (Win32Exception exception) when (exception.NativeErrorCode == 1223)
            {
                error = "Administrator approval was cancelled. No TeamForge firewall rule was changed.";
                return false;
            }
            catch (Exception exception)
            {
                error = $"Windows Firewall command failed ({exception.GetType().Name}).";
                return false;
            }
        }
    }
}

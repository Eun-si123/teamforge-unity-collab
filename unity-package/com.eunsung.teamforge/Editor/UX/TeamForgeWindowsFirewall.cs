using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Text;
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
Set-TeamForgeRule '{CoordinatorRuleName}' 'TeamForge Coordinator (LAN)' {coordinatorPort}
Set-TeamForgeRule '{SeedRuleName}' 'TeamForge Seed (LAN)' {seedPort}
";
        }

        internal static string BuildProbeScript(int coordinatorPort, int seedPort)
        {
            ValidatePort(coordinatorPort, nameof(coordinatorPort));
            ValidatePort(seedPort, nameof(seedPort));
            return BuildCommonPrelude() + $@"
function Test-TeamForgeRule([string]$Name, [int]$Port) {{
    $rule = @(Get-NetFirewallRule -PolicyStore ActiveStore -Name $Name -ErrorAction SilentlyContinue) |
        Select-Object -First 1
    if ($null -eq $rule) {{ return $false }}
    if ([string]$rule.Enabled -ne 'True' -or [string]$rule.Direction -ne 'Inbound' -or
        [string]$rule.Action -ne 'Allow' -or [string]$rule.Profile -ne 'Private') {{ return $false }}
    $portFilter = $rule | Get-NetFirewallPortFilter
    if ([string]$portFilter.Protocol -ne 'TCP' -or
        (@($portFilter.LocalPort) -notcontains [string]$Port)) {{ return $false }}
    $addressFilter = $rule | Get-NetFirewallAddressFilter
    if (@($addressFilter.RemoteAddress) -notcontains 'LocalSubnet') {{ return $false }}
    return $true
}}
if ((Test-TeamForgeRule '{CoordinatorRuleName}' {coordinatorPort}) -and
    (Test-TeamForgeRule '{SeedRuleName}' {seedPort})) {{ exit 0 }}
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

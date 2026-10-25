using System;
using System.Globalization;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace EunSung.TeamForge
{
    internal enum TeamForgeHostLanProfile { Unknown, Public, Private, DomainAuthenticated }
    internal enum TeamForgeHostLanRules { Unknown, Matches, Mismatch }
    internal enum TeamForgeHostLanLevel { Info, Warning }

    // A snapshot of the explicitly selected endpoint. Local ownership of its IP
    // is established by the Windows probe, never by DNS or by this parser.
    internal sealed class TeamForgeHostLanTarget
    {
        internal TeamForgeHostLanTarget(string serverAddress, string listenHost, int seedPort,
            bool activeHost, long hostGeneration, string contextKey)
        {
            ActiveHost = activeHost;
            SeedPort = seedPort;
            HostIpv4 = string.Empty;
            ReasonCode = "unsupported_target";
            Reason = "The selected Host address cannot be inspected by the IPv4 LAN check.";
            Key = BuildKey(serverAddress, listenHost, seedPort.ToString(CultureInfo.InvariantCulture),
                activeHost.ToString(), hostGeneration.ToString(CultureInfo.InvariantCulture), contextKey);

            if (string.IsNullOrEmpty(serverAddress) || serverAddress.Length > 2048 ||
                !string.Equals(serverAddress, serverAddress.Trim(), StringComparison.Ordinal) ||
                HasControls(serverAddress) || serverAddress.IndexOf('\\') >= 0 ||
                !Uri.TryCreate(serverAddress, UriKind.Absolute, out var uri) ||
                !string.Equals(uri.Scheme, Uri.UriSchemeHttp, StringComparison.OrdinalIgnoreCase) ||
                uri.AbsolutePath != "/" || !string.IsNullOrEmpty(uri.UserInfo) ||
                !string.IsNullOrEmpty(uri.Query) || !string.IsNullOrEmpty(uri.Fragment)) return;

            var authorityStart = serverAddress.IndexOf("://", StringComparison.Ordinal) + 3;
            if (authorityStart < 3) return;
            var authority = serverAddress.Substring(authorityStart).TrimEnd('/');
            if (authority.IndexOfAny(new[] { '/', '@', '?', '#', '%' }) >= 0) return;
            var rawHost = authority.StartsWith("[", StringComparison.Ordinal)
                ? authority.Substring(0, authority.IndexOf(']') + 1)
                : authority.Split(':')[0];
            var host = rawHost.Trim('[', ']');
            if (!TryReadListenerLocality(listenHost, out var listenerLocal))
            {
                ReasonCode = "unsupported_listener";
                Reason = "The selected listen address must be one valid host name or IP address without a scheme, path or control characters.";
                return;
            }
            var localName = IsLocalName(host);
            var parsed = IPAddress.TryParse(host, out var address);
            if (!localName && (!parsed || !string.Equals(host, address.ToString(), StringComparison.Ordinal) ||
                (address.AddressFamily != AddressFamily.InterNetwork && !IPAddress.IsLoopback(address))))
            {
                ReasonCode = "host_not_canonical_ipv4";
                Reason = "DNS names, IPv6 and noncanonical addresses remain unverified; select one canonical Host IPv4 address.";
                return;
            }
            var advertisedLocal = localName || IPAddress.IsLoopback(address);
            if (advertisedLocal != listenerLocal)
            {
                ReasonCode = "listener_mismatch";
                Reason = "The selected advertised Host and listen address disagree about local-only versus LAN hosting. Review the connection settings.";
                return;
            }
            if (advertisedLocal)
            {
                SetLocalOnly();
                return;
            }
            if (address.GetAddressBytes()[0] == 0 || address.GetAddressBytes()[0] >= 224) return;
            if (seedPort < 0 || seedPort > 65535 || (activeHost && seedPort == 0))
            {
                ReasonCode = "invalid_ports";
                Reason = "The Host did not provide usable Coordinator and bound Seed ports for this check.";
                return;
            }
            HostIpv4 = address.ToString();
            CoordinatorPort = uri.Port;
            CanProbe = CoordinatorPort >= 1 && CoordinatorPort <= 65535;
            ReasonCode = CanProbe ? "ready_to_check" : "invalid_ports";
            Reason = CanProbe ? string.Empty : "The selected Coordinator port cannot be inspected.";
        }

        internal string HostIpv4 { get; }
        internal int CoordinatorPort { get; }
        internal int SeedPort { get; }
        internal bool ActiveHost { get; }
        internal bool CanProbe { get; }
        internal string Key { get; }
        internal string ReasonCode { get; private set; }
        internal string Reason { get; private set; }

        private void SetLocalOnly()
        {
            ReasonCode = "local_only";
            Reason = "The selected configuration is local-only; LAN profile and rule checks are not applicable.";
        }

        private static bool TryReadListenerLocality(string listener, out bool local)
        {
            local = false;
            if (string.IsNullOrWhiteSpace(listener) || listener.Length > 253 || HasControls(listener) ||
                !string.Equals(listener, listener.Trim(), StringComparison.Ordinal) ||
                listener.IndexOfAny(new[] { '/', '\\', '?', '#', '@' }) >= 0) return false;
            var host = listener;
            if (listener.IndexOfAny(new[] { '[', ']' }) >= 0)
            {
                if (!listener.StartsWith("[", StringComparison.Ordinal) || !listener.EndsWith("]", StringComparison.Ordinal)) return false;
                host = listener.Substring(1, listener.Length - 2);
                if (host.IndexOfAny(new[] { '[', ']' }) >= 0 || !IPAddress.TryParse(host, out var bracketed) ||
                    bracketed.AddressFamily != AddressFamily.InterNetworkV6) return false;
                local = IPAddress.IsLoopback(bracketed);
                return true;
            }
            if (IPAddress.TryParse(host, out var address))
            {
                if (address.AddressFamily == AddressFamily.InterNetwork &&
                    !string.Equals(host, address.ToString(), StringComparison.Ordinal)) return false;
                local = IPAddress.IsLoopback(address);
                return true;
            }
            if (Uri.CheckHostName(host) != UriHostNameType.Dns) return false;
            local = IsLocalName(host);
            return true;
        }

        private static bool IsLocalName(string host) =>
            string.Equals(host, "localhost", StringComparison.OrdinalIgnoreCase) ||
            host.EndsWith(".localhost", StringComparison.OrdinalIgnoreCase);

        private static bool HasControls(string value)
        {
            foreach (var character in value) if (character < 32 || character == 127) return true;
            return false;
        }

        private static string BuildKey(params string[] values)
        {
            var builder = new StringBuilder();
            foreach (var item in values)
            {
                var value = item ?? string.Empty;
                builder.Append(value.Length.ToString(CultureInfo.InvariantCulture)).Append(':').Append(value);
            }
            using (var hash = SHA256.Create())
                return Convert.ToBase64String(hash.ComputeHash(Encoding.UTF8.GetBytes(builder.ToString())));
        }
    }

    // Result text accepts only typed observations and fixed codes. Raw addresses,
    // adapter/SSID names, process output and context keys never enter a report.
    internal sealed class TeamForgeHostLanResult
    {
        private TeamForgeHostLanResult(TeamForgeHostLanProfile profile, TeamForgeHostLanRules coordinatorRules,
            TeamForgeHostLanRules seedRules, string code, TeamForgeHostLanLevel level, string summary)
        {
            Profile = profile;
            CoordinatorRules = coordinatorRules;
            SeedRules = seedRules;
            Code = code;
            Level = level;
            Summary = summary + " Guest reachability is unverified. Other local policy may still block connections.";
            CheckedAtUtc = DateTime.UtcNow;
        }

        internal TeamForgeHostLanProfile Profile { get; }
        internal TeamForgeHostLanRules CoordinatorRules { get; }
        internal TeamForgeHostLanRules SeedRules { get; }
        internal string Code { get; }
        internal TeamForgeHostLanLevel Level { get; }
        internal string Summary { get; }
        internal DateTime CheckedAtUtc { get; }

        internal static TeamForgeHostLanResult FromProbe(TeamForgeHostLanTarget target,
            TeamForgeHostLanProfile profile, TeamForgeHostLanRules coordinatorRules, TeamForgeHostLanRules seedRules)
        {
            if (target == null) return Unknown();
            if (!target.CanProbe) return Unavailable(target);
            if (!Enum.IsDefined(typeof(TeamForgeHostLanProfile), profile)) profile = TeamForgeHostLanProfile.Unknown;
            if (!Enum.IsDefined(typeof(TeamForgeHostLanRules), coordinatorRules)) coordinatorRules = TeamForgeHostLanRules.Unknown;
            if (target.SeedPort == 0 || !Enum.IsDefined(typeof(TeamForgeHostLanRules), seedRules)) seedRules = TeamForgeHostLanRules.Unknown;
            var code = "configuration_matches";
            var level = TeamForgeHostLanLevel.Warning;
            string advice;
            if (profile == TeamForgeHostLanProfile.Public || profile == TeamForgeHostLanProfile.DomainAuthenticated)
            {
                code = "profile_mismatch";
                advice = profile == TeamForgeHostLanProfile.Public
                    ? "Private-only rules do not apply to Public networks. Review Windows network settings only for a trusted LAN."
                    : "Private-only rules do not apply to a Domain profile. Ask the network administrator for an approved connection method.";
            }
            else if (profile == TeamForgeHostLanProfile.Unknown)
            {
                code = "profile_unknown";
                advice = "The selected interface profile could not be verified.";
            }
            else if (coordinatorRules == TeamForgeHostLanRules.Mismatch || seedRules == TeamForgeHostLanRules.Mismatch)
            {
                code = "firewall_rules_mismatch";
                advice = "Expected named rule profile/TCP port/LAN scope fields were not observed.";
            }
            else if (coordinatorRules == TeamForgeHostLanRules.Unknown || seedRules == TeamForgeHostLanRules.Unknown)
            {
                code = "firewall_rules_unknown";
                advice = target.SeedPort == 0 ? "No bound Seed port is available to inspect." : "Some named rule fields could not be verified.";
            }
            else
            {
                level = TeamForgeHostLanLevel.Info;
                advice = "Expected named rule profile/TCP port/LAN scope fields were observed.";
            }
            var scope = target.ActiveHost
                ? "Running Host ports were selected for this check."
                : "Selected settings only; listeners and the Seed port are not verified as running.";
            return new TeamForgeHostLanResult(profile, coordinatorRules, seedRules, code, level,
                "Profile: " + profile + ". Coordinator rule fields: " + coordinatorRules +
                ". Seed rule fields: " + seedRules + ". " + advice + " " + scope);
        }

        internal static TeamForgeHostLanResult Unknown(string code = "probe_failed")
        {
            if (code != "probe_timeout" && code != "unsupported_platform") code = "probe_failed";
            var summary = code == "probe_timeout" ? "The read-only LAN check timed out."
                : code == "unsupported_platform" ? "The read-only Windows LAN check is unavailable on this platform."
                : "The read-only LAN check could not verify the selected configuration.";
            return new TeamForgeHostLanResult(TeamForgeHostLanProfile.Unknown, TeamForgeHostLanRules.Unknown,
                TeamForgeHostLanRules.Unknown, code, TeamForgeHostLanLevel.Warning, summary);
        }

        internal static TeamForgeHostLanResult Cancelled()
        {
            return new TeamForgeHostLanResult(TeamForgeHostLanProfile.Unknown, TeamForgeHostLanRules.Unknown,
                TeamForgeHostLanRules.Unknown, "cancelled", TeamForgeHostLanLevel.Info, "The read-only LAN check was cancelled.");
        }

        internal static TeamForgeHostLanResult Unavailable(TeamForgeHostLanTarget target)
        {
            return new TeamForgeHostLanResult(TeamForgeHostLanProfile.Unknown, TeamForgeHostLanRules.Unknown,
                TeamForgeHostLanRules.Unknown, target.ReasonCode,
                target.ReasonCode == "local_only" ? TeamForgeHostLanLevel.Info : TeamForgeHostLanLevel.Warning, target.Reason);
        }

        internal string ToReportString()
        {
            return "[" + Level + "] LAN configuration · " + CheckedAtUtc.ToString("O", CultureInfo.InvariantCulture) +
                " · " + Code + ": " + Summary;
        }
    }

    // Session methods belong to the caller's UI thread. Workers publish no events
    // and touch no Unity APIs; only Poll can make their result visible.
    internal sealed class TeamForgeHostLanSession : IDisposable
    {
        private sealed class Check
        {
            internal string Key;
            internal long Generation;
            internal CancellationTokenSource Cancellation;
            internal CancellationToken Token;
            internal Task<TeamForgeHostLanResult> Work;
        }

        private readonly Func<TeamForgeHostLanTarget, CancellationToken, TeamForgeHostLanResult> _worker;
        private readonly int _timeoutMilliseconds;
        private Check _check;
        private long _generation;
        private bool _disposed;

        internal TeamForgeHostLanSession(Func<TeamForgeHostLanTarget, CancellationToken, TeamForgeHostLanResult> worker,
            int timeoutMilliseconds = 22000)
        {
            _worker = worker ?? throw new ArgumentNullException(nameof(worker));
            if (timeoutMilliseconds < 1 || timeoutMilliseconds > 300000) throw new ArgumentOutOfRangeException(nameof(timeoutMilliseconds));
            _timeoutMilliseconds = timeoutMilliseconds;
        }

        internal TeamForgeHostLanTarget Target { get; private set; }
        internal TeamForgeHostLanResult Result { get; private set; }
        internal bool IsChecking => _check != null;

        internal void UpdateTarget(TeamForgeHostLanTarget target)
        {
            if (_disposed || string.Equals(Target?.Key, target?.Key, StringComparison.Ordinal)) return;
            Cancel();
            Target = target;
        }

        internal bool BeginCheck()
        {
            if (_disposed || _check != null || Target == null) return false;
            Result = null;
            if (!Target.CanProbe)
            {
                Result = TeamForgeHostLanResult.Unavailable(Target);
                return true;
            }
            var target = Target;
            var cancellation = new CancellationTokenSource();
            var check = new Check { Key = target.Key, Generation = _generation, Cancellation = cancellation, Token = cancellation.Token };
            cancellation.CancelAfter(_timeoutMilliseconds);
            check.Work = Task.Run(() =>
            {
                try
                {
                    check.Token.ThrowIfCancellationRequested();
                    return _worker(target, check.Token) ?? TeamForgeHostLanResult.Unknown();
                }
                catch (OperationCanceledException) { return TeamForgeHostLanResult.Cancelled(); }
                catch (Exception) { return TeamForgeHostLanResult.Unknown(); }
            });
            // Retired workers may ignore cancellation or fail later. Their task
            // always has an observer, and its token source lives until they finish.
            _ = check.Work.ContinueWith(work =>
            {
                if (work.IsFaulted) _ = work.Exception;
                cancellation.Dispose();
            }, CancellationToken.None, TaskContinuationOptions.ExecuteSynchronously, TaskScheduler.Default);
            _check = check;
            return true;
        }

        internal bool Poll()
        {
            var check = _check;
            if (_disposed || check == null) return false;
            if (check.Generation != _generation || !string.Equals(check.Key, Target?.Key, StringComparison.Ordinal))
            {
                Cancel();
                return false;
            }
            if (check.Token.IsCancellationRequested)
            {
                _check = null;
                Result = TeamForgeHostLanResult.Unknown("probe_timeout");
                return true;
            }
            if (!check.Work.IsCompleted) return false;
            _check = null;
            Result = check.Work.Status == TaskStatus.RanToCompletion ? check.Work.Result : TeamForgeHostLanResult.Unknown();
            return true;
        }

        internal void Cancel()
        {
            var check = _check;
            _check = null;
            _generation += 1;
            Result = null;
            if (check == null) return;
            try { check.Cancellation.Cancel(); }
            catch (ObjectDisposedException) { }
            catch (AggregateException) { }
        }

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;
            Cancel();
            Target = null;
        }
    }
}

using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;

namespace EunSung.TeamForge
{
    internal static class TeamForgeHostEndpointPolicy
    {
        internal const string DefaultLanListenHost = "0.0.0.0";
        private static readonly IPAddress RouteProbeAddress = IPAddress.Parse("192.0.2.1");

        internal static bool TryValidateListenHost(string value, out string error)
        {
            var candidate = value?.Trim() ?? string.Empty;
            if (candidate.Length == 0 || candidate.Length > 253 ||
                !string.Equals(candidate, value, StringComparison.Ordinal) ||
                candidate.IndexOfAny(new[] { '\0', '\r', '\n', '/', '\\' }) >= 0)
            {
                error = "Coordinator listen address must be one host name or IP address without a scheme or path.";
                return false;
            }

            if (IPAddress.TryParse(candidate, out _) ||
                Uri.CheckHostName(candidate) == UriHostNameType.Dns)
            {
                error = string.Empty;
                return true;
            }

            error = "Coordinator listen address is not a valid host name or IP address.";
            return false;
        }

        internal static bool IsLoopbackHost(string value)
        {
            var host = NormalizeHost(value);
            if (string.Equals(host, "localhost", StringComparison.OrdinalIgnoreCase) ||
                host.EndsWith(".localhost", StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }

            return IPAddress.TryParse(host, out var address) && IPAddress.IsLoopback(address);
        }

        internal static bool IsWildcardHost(string value)
        {
            var host = NormalizeHost(value);
            return IPAddress.TryParse(host, out var address) &&
                   (address.Equals(IPAddress.Any) || address.Equals(IPAddress.IPv6Any));
        }

        internal static bool IsExposedListenHost(string value)
        {
            return IsWildcardHost(value) || !IsLoopbackHost(value);
        }

        internal static bool TryValidateHostingPolicy(
            string serverAddress,
            string listenHost,
            string authenticationToken,
            out string error)
        {
            if (!TryValidateListenHost(listenHost, out error))
            {
                return false;
            }

            if (!TryManagedServerOrigin(serverAddress, out var server, out error))
            {
                return false;
            }

            var advertisedLocalOnly = IsLoopbackHost(server.Host);
            var advertisedWildcard = IsWildcardHost(server.Host);
            var listenLocalOnly = IsLoopbackHost(listenHost);
            var listenExposed = IsExposedListenHost(listenHost);
            if (advertisedWildcard || (listenExposed && advertisedLocalOnly) ||
                (listenLocalOnly && !advertisedLocalOnly))
            {
                error = "The Coordinator listen address and Guest address do not match. " +
                        "Use a reachable LAN Guest address for LAN hosting, or use loopback for both in explicit local-only mode.";
                return false;
            }

            if (listenExposed && string.IsNullOrWhiteSpace(authenticationToken))
            {
                error = "LAN hosting was not started without authentication. Expand Manual connection settings, " +
                        "set a unique Server access code (Bearer Token), and share that code separately from the invite.";
                return false;
            }

            error = string.Empty;
            return true;
        }

        internal static bool TryBuildAdvertisedAddress(
            string currentServerAddress,
            string lanAddress,
            out string advertisedAddress,
            out string error)
        {
            advertisedAddress = string.Empty;
            if (!TryManagedServerOrigin(currentServerAddress, out var current, out error))
            {
                return false;
            }

            if (!IPAddress.TryParse(lanAddress?.Trim(), out var address) ||
                address.AddressFamily != AddressFamily.InterNetwork ||
                IPAddress.IsLoopback(address) || address.Equals(IPAddress.Any) || IsLinkLocal(address))
            {
                error = "TeamForge could not select a reachable LAN IPv4 address. Set Guest address explicitly in Manual connection settings.";
                return false;
            }

            var builder = new UriBuilder(current) { Host = address.ToString() };
            advertisedAddress = builder.Uri.GetLeftPart(UriPartial.Authority);
            error = string.Empty;
            return true;
        }

        internal static bool TryDiscoverPreferredLanAddress(out string address, out string error)
        {
            address = string.Empty;
            try
            {
                // UDP Connect selects the current IPv4 route without sending project data.
                using (var socket = new Socket(AddressFamily.InterNetwork, SocketType.Dgram, ProtocolType.Udp))
                {
                    socket.Connect(new IPEndPoint(RouteProbeAddress, 9));
                    if (socket.LocalEndPoint is IPEndPoint endpoint && IsUsableLanAddress(endpoint.Address))
                    {
                        address = endpoint.Address.ToString();
                        error = string.Empty;
                        return true;
                    }
                }
            }
            catch
            {
                // Fall through to bounded local adapter inspection.
            }

            var all = new List<IPAddress>();
            var gatewayBacked = new List<IPAddress>();
            try
            {
                foreach (var adapter in NetworkInterface.GetAllNetworkInterfaces())
                {
                    if (adapter.OperationalStatus != OperationalStatus.Up ||
                        adapter.NetworkInterfaceType == NetworkInterfaceType.Loopback ||
                        adapter.NetworkInterfaceType == NetworkInterfaceType.Tunnel)
                    {
                        continue;
                    }

                    var properties = adapter.GetIPProperties();
                    var hasGateway = properties.GatewayAddresses.Any(item =>
                        item?.Address != null && !item.Address.Equals(IPAddress.Any) &&
                        !item.Address.Equals(IPAddress.IPv6Any));
                    foreach (var unicast in properties.UnicastAddresses)
                    {
                        if (!IsUsableLanAddress(unicast.Address)) continue;
                        all.Add(unicast.Address);
                        if (hasGateway) gatewayBacked.Add(unicast.Address);
                    }
                }
            }
            catch
            {
                // The actionable error below is preferable to leaking adapter details.
            }

            var preferred = DistinctAddresses(gatewayBacked);
            if (preferred.Count == 0) preferred = DistinctAddresses(all);
            if (preferred.Count == 1)
            {
                address = preferred[0];
                error = string.Empty;
                return true;
            }

            error = preferred.Count == 0
                ? "No reachable LAN IPv4 address was found. Set Guest address explicitly in Manual connection settings."
                : "Multiple active LAN addresses were found. Set the Guest address for the Guest PC's network explicitly in Manual connection settings.";
            return false;
        }

        private static bool TryManagedServerOrigin(string value, out Uri uri, out string error)
        {
            uri = null;
            if (!TeamForgeUriBuilder.TryValidateBaseAddress(value, out var candidate, out error))
            {
                return false;
            }

            if (!string.Equals(candidate.Scheme, Uri.UriSchemeHttp, StringComparison.OrdinalIgnoreCase) ||
                candidate.AbsolutePath != "/")
            {
                error = "The managed Coordinator Guest address must be a credential-free HTTP origin without a path.";
                return false;
            }

            uri = candidate;
            error = string.Empty;
            return true;
        }

        private static string NormalizeHost(string value)
        {
            var host = value?.Trim() ?? string.Empty;
            return host.Length > 1 && host[0] == '[' && host[host.Length - 1] == ']'
                ? host.Substring(1, host.Length - 2)
                : host;
        }

        private static bool IsUsableLanAddress(IPAddress address)
        {
            return address != null && address.AddressFamily == AddressFamily.InterNetwork &&
                   !IPAddress.IsLoopback(address) && !address.Equals(IPAddress.Any) && !IsLinkLocal(address);
        }

        private static bool IsLinkLocal(IPAddress address)
        {
            var bytes = address.GetAddressBytes();
            return bytes.Length == 4 && bytes[0] == 169 && bytes[1] == 254;
        }

        private static List<string> DistinctAddresses(IEnumerable<IPAddress> addresses)
        {
            return addresses
                .Where(IsUsableLanAddress)
                .Select(item => item.ToString())
                .Distinct(StringComparer.Ordinal)
                .OrderBy(item => item, StringComparer.Ordinal)
                .ToList();
        }
    }
}

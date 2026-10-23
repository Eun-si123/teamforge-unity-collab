using System;
using System.Net;
using System.Net.Sockets;
using System.Text.RegularExpressions;

namespace EunSung.TeamForge
{
    public static class TeamForgeUriBuilder
    {
        public static bool TryBuildWebSocketUri(
            string serverAddress,
            string relativeRealtimePath,
            out Uri webSocketUri,
            out string error)
        {
            webSocketUri = null;
            error = string.Empty;

            if (!TryValidateBaseAddress(serverAddress, out var baseUri, out error))
            {
                return false;
            }

            if (!TryNormalizeRelativePath(relativeRealtimePath, out var normalizedPath, out error))
            {
                return false;
            }

            var scheme = baseUri.Scheme == Uri.UriSchemeHttps || baseUri.Scheme == "wss" ? "wss" : "ws";
            var builder = new UriBuilder(baseUri)
            {
                Scheme = scheme,
                Path = CombinePaths(baseUri.AbsolutePath, normalizedPath),
                Query = string.Empty,
                Fragment = string.Empty,
            };

            if (baseUri.IsDefaultPort)
            {
                builder.Port = -1;
            }

            webSocketUri = builder.Uri;
            return true;
        }

        public static bool TryValidateBaseAddress(string serverAddress, out Uri uri, out string error)
        {
            uri = null;
            error = string.Empty;

            if (HasMalformedNumericIpv4Host(serverAddress))
            {
                error = "IPv4 Host address must contain four decimal numbers from 0 to 255 (for example, 192.168.1.10). Check the Host address before starting collaboration.";
                return false;
            }

            if (!Uri.TryCreate(serverAddress?.Trim(), UriKind.Absolute, out var candidate))
            {
                error = "Server address must be an absolute http(s) or ws(s) URI.";
                return false;
            }

            var scheme = candidate.Scheme.ToLowerInvariant();
            if (scheme != Uri.UriSchemeHttp && scheme != Uri.UriSchemeHttps && scheme != "ws" && scheme != "wss")
            {
                error = "Server address scheme must be http, https, ws, or wss.";
                return false;
            }

            if (string.IsNullOrWhiteSpace(candidate.Host))
            {
                error = "Server address must include a host.";
                return false;
            }

            if (!string.IsNullOrEmpty(candidate.UserInfo))
            {
                error = "Credentials must not be embedded in the server address.";
                return false;
            }

            if (!string.IsNullOrEmpty(candidate.Query) || !string.IsNullOrEmpty(candidate.Fragment))
            {
                error = "Server address cannot contain a query or fragment.";
                return false;
            }

            uri = candidate;
            return true;
        }

        // Check the originally typed authority before URI parsers can normalize shorthand
        // numeric hosts (e.g. 192.168.219. into 192.168.0.219 on some runtimes).
        internal static bool HasMalformedNumericIpv4Host(string serverAddress)
        {
            var input = serverAddress?.Trim() ?? string.Empty;
            var match = Regex.Match(input,
                @"^[A-Za-z][A-Za-z0-9+.-]*://(?<host>[0-9.]+)(?::[0-9]+)?(?:[/?#]|$)");
            if (!match.Success) return false;

            var rawHost = match.Groups["host"].Value;
            var octets = rawHost.Split('.');
            if (octets.Length != 4) return true;
            foreach (var octet in octets)
            {
                if (octet.Length == 0 || octet.Length > 3 ||
                    (octet.Length > 1 && octet[0] == '0') ||
                    !byte.TryParse(octet, out _))
                {
                    return true;
                }
            }
            return !IPAddress.TryParse(rawHost, out var parsed) ||
                   parsed.AddressFamily != AddressFamily.InterNetwork;
        }

        private static bool TryNormalizeRelativePath(string value, out string path, out string error)
        {
            path = string.Empty;
            error = string.Empty;
            // Do not let UriBuilder silently remove ASCII controls or normalize
            // ambiguous segments that Project Peer rejects for signed invites.
            if (value != null)
            {
                foreach (var character in value)
                {
                    if (character < 0x20 || character == 0x7f)
                    {
                        error = "Realtime path cannot contain control characters.";
                        return false;
                    }
                }
            }

            var candidate = value?.Trim() ?? string.Empty;

            if (candidate.Length == 0 || candidate.Contains("?") || candidate.Contains("#") || candidate.Contains("\\"))
            {
                error = "Realtime path must be a non-empty relative URL path without query, fragment, or backslash.";
                return false;
            }

            path = candidate.Trim('/');
            if (path.Length == 0)
            {
                error = "Realtime path cannot be the server root.";
                return false;
            }

            if (path.Contains("..") || path.Contains("//"))
            {
                error = "Realtime path contains ambiguous path segments.";
                return false;
            }
            foreach (var segment in path.Split('/'))
            {
                if (segment.Length == 0 || Regex.IsMatch(segment, @"^(?:\.|%2e)+$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant))
                {
                    error = "Realtime path contains ambiguous path segments.";
                    return false;
                }
            }

            return true;
        }

        private static string CombinePaths(string basePath, string relativePath)
        {
            var left = string.IsNullOrWhiteSpace(basePath) ? string.Empty : basePath.Trim('/');
            return left.Length == 0 ? $"/{relativePath}" : $"/{left}/{relativePath}";
        }
    }
}

using System;

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

        private static bool TryNormalizeRelativePath(string value, out string path, out string error)
        {
            path = string.Empty;
            error = string.Empty;
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

            return true;
        }

        private static string CombinePaths(string basePath, string relativePath)
        {
            var left = string.IsNullOrWhiteSpace(basePath) ? string.Empty : basePath.Trim('/');
            return left.Length == 0 ? $"/{relativePath}" : $"/{left}/{relativePath}";
        }
    }
}

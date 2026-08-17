using System;

namespace EunSung.TeamForge
{
    internal sealed class RealtimeConnectionAttempt
    {
        internal RealtimeConnectionAttempt(
            Uri endpoint,
            string bearerToken,
            int keepAliveSeconds)
        {
            Endpoint = endpoint ?? throw new ArgumentNullException(nameof(endpoint));
            BearerToken = bearerToken ?? string.Empty;
            KeepAliveSeconds = Math.Max(5, keepAliveSeconds);
        }

        internal Uri Endpoint { get; }
        internal string BearerToken { get; }
        internal int KeepAliveSeconds { get; }
    }

    internal interface IConnectionStrategy
    {
        bool TryCreateAttempts(
            string serverAddress,
            string realtimePath,
            string bearerToken,
            int keepAliveSeconds,
            out RealtimeConnectionAttempt[] attempts,
            out string error);
    }

    internal sealed class LegacyServerStrategy : IConnectionStrategy
    {
        public bool TryCreateAttempts(
            string serverAddress,
            string realtimePath,
            string bearerToken,
            int keepAliveSeconds,
            out RealtimeConnectionAttempt[] attempts,
            out string error)
        {
            attempts = Array.Empty<RealtimeConnectionAttempt>();
            if (!TeamForgeUriBuilder.TryBuildWebSocketUri(
                    serverAddress,
                    realtimePath,
                    out var endpoint,
                    out error))
            {
                return false;
            }

            attempts = new[]
            {
                new RealtimeConnectionAttempt(
                    endpoint,
                    bearerToken,
                    keepAliveSeconds),
            };
            return true;
        }
    }
}

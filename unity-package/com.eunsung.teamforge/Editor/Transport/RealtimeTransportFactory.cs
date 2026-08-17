using System;
using System.Net.WebSockets;

namespace EunSung.TeamForge
{
    internal interface IRealtimeTransportFactory
    {
        IRealtimeTransport Create(RealtimeConnectionAttempt attempt);
    }

    internal sealed class WebSocketTransportFactory : IRealtimeTransportFactory
    {
        public IRealtimeTransport Create(RealtimeConnectionAttempt attempt)
        {
            if (attempt == null)
            {
                throw new ArgumentNullException(nameof(attempt));
            }

            var socket = new ClientWebSocket();
            socket.Options.KeepAliveInterval = TimeSpan.FromSeconds(attempt.KeepAliveSeconds);
            if (!string.IsNullOrWhiteSpace(attempt.BearerToken))
            {
                socket.Options.SetRequestHeader(
                    "Authorization",
                    $"Bearer {attempt.BearerToken.Trim()}");
            }

            return new ClientWebSocketTransport(attempt.Endpoint, socket);
        }
    }
}

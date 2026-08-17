using System;
using System.Threading;
using System.Threading.Tasks;

namespace EunSung.TeamForge
{
    internal interface IRealtimeTransport : IDisposable
    {
        event Action Connected;
        event Action<string> TextReceived;
        event Action<string> Closed;
        event Action<Exception> Faulted;

        Task ConnectAsync(CancellationToken cancellationToken);
        Task SendTextAsync(string text, CancellationToken cancellationToken);
        Task DisconnectAsync(CancellationToken cancellationToken);
    }
}

using System;
using System.IO;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace EunSung.TeamForge
{
    internal sealed class ClientWebSocketTransport : IRealtimeTransport
    {
        private const int ReceiveBufferSize = 8 * 1024;
        private const int MaximumReceivedMessageBytes = 1024 * 1024;

        private readonly SemaphoreSlim _sendGate = new SemaphoreSlim(1, 1);
        private readonly Uri _endpoint;
        private readonly ClientWebSocket _socket;
        private CancellationTokenSource _receiveCancellation;
        private int _closedRaised;
        private bool _connectStarted;
        private bool _disposed;

        internal ClientWebSocketTransport(Uri endpoint, ClientWebSocket socket)
        {
            _endpoint = endpoint ?? throw new ArgumentNullException(nameof(endpoint));
            _socket = socket ?? throw new ArgumentNullException(nameof(socket));
        }

        public event Action Connected;
        public event Action<string> TextReceived;
        public event Action<string> Closed;
        public event Action<Exception> Faulted;

        public async Task ConnectAsync(CancellationToken cancellationToken)
        {
            ThrowIfDisposed();
            if (_connectStarted)
            {
                throw new InvalidOperationException("Transport can only connect once.");
            }

            _connectStarted = true;
            await _socket.ConnectAsync(_endpoint, cancellationToken).ConfigureAwait(false);

            _receiveCancellation = new CancellationTokenSource();
            Connected?.Invoke();
            _ = ReceiveLoopAsync(_socket, _receiveCancellation.Token);
        }

        public async Task SendTextAsync(string text, CancellationToken cancellationToken)
        {
            ThrowIfDisposed();
            var socket = _socket;
            if (socket == null || socket.State != WebSocketState.Open)
            {
                throw new InvalidOperationException("WebSocket is not open.");
            }

            var payload = Encoding.UTF8.GetBytes(text ?? string.Empty);
            await _sendGate.WaitAsync(cancellationToken).ConfigureAwait(false);
            try
            {
                await socket.SendAsync(
                        new ArraySegment<byte>(payload),
                        WebSocketMessageType.Text,
                        true,
                        cancellationToken)
                    .ConfigureAwait(false);
            }
            finally
            {
                _sendGate.Release();
            }
        }

        public async Task DisconnectAsync(CancellationToken cancellationToken)
        {
            var socket = _socket;
            if (socket == null)
            {
                RaiseClosed("Disconnected.");
                return;
            }

            var sendGateHeld = false;
            try
            {
                // Wait for already queued final Transform/lock-release frames. New sends
                // are rejected by ConnectionService once Disconnecting begins.
                await _sendGate.WaitAsync(cancellationToken).ConfigureAwait(false);
                sendGateHeld = true;
                if (socket.State == WebSocketState.Open || socket.State == WebSocketState.CloseReceived)
                {
                    await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "Client disconnect", cancellationToken)
                        .ConfigureAwait(false);
                }
            }
            catch (OperationCanceledException)
            {
                socket.Abort();
            }
            catch (WebSocketException)
            {
                socket.Abort();
            }
            finally
            {
                if (sendGateHeld)
                {
                    _sendGate.Release();
                }
                _receiveCancellation?.Cancel();
                socket.Dispose();
                RaiseClosed("Disconnected.");
            }
        }

        public void Dispose()
        {
            if (_disposed)
            {
                return;
            }

            _disposed = true;
            _receiveCancellation?.Cancel();
            try
            {
                _socket?.Abort();
            }
            catch
            {
                // Best-effort synchronous shutdown during assembly reload/editor quit.
            }
            _socket?.Dispose();
            _receiveCancellation?.Dispose();
            _sendGate.Dispose();
            RaiseClosed("Transport disposed.");
        }

        private async Task ReceiveLoopAsync(ClientWebSocket socket, CancellationToken cancellationToken)
        {
            var buffer = new byte[ReceiveBufferSize];
            try
            {
                while (!cancellationToken.IsCancellationRequested && socket.State == WebSocketState.Open)
                {
                    using (var message = new MemoryStream())
                    {
                        WebSocketReceiveResult result;
                        do
                        {
                            result = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), cancellationToken)
                                .ConfigureAwait(false);

                            if (result.MessageType == WebSocketMessageType.Close)
                            {
                                RaiseClosed($"Remote close: {result.CloseStatus} {result.CloseStatusDescription}".Trim());
                                return;
                            }

                            if (result.MessageType != WebSocketMessageType.Text)
                            {
                                throw new WebSocketException("Only UTF-8 text messages are supported.");
                            }

                            message.Write(buffer, 0, result.Count);
                            if (message.Length > MaximumReceivedMessageBytes)
                            {
                                throw new WebSocketException("Received message exceeds the client safety limit.");
                            }
                        }
                        while (!result.EndOfMessage);

                        TextReceived?.Invoke(Encoding.UTF8.GetString(message.ToArray()));
                    }
                }
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                // Expected during disconnect/reload.
            }
            catch (ObjectDisposedException) when (_disposed || cancellationToken.IsCancellationRequested)
            {
                // Expected during synchronous editor shutdown.
            }
            catch (Exception exception)
            {
                Faulted?.Invoke(exception);
            }
            finally
            {
                RaiseClosed("Receive loop ended.");
            }
        }

        private void RaiseClosed(string reason)
        {
            if (Interlocked.Exchange(ref _closedRaised, 1) == 0)
            {
                Closed?.Invoke(reason);
            }
        }

        private void ThrowIfDisposed()
        {
            if (_disposed)
            {
                throw new ObjectDisposedException(nameof(ClientWebSocketTransport));
            }
        }
    }
}

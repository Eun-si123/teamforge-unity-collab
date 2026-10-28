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
        private readonly CancellationTokenSource _lifetimeCancellation = new CancellationTokenSource();
        private readonly Uri _endpoint;
        private readonly ClientWebSocket _socket;
        private int _closedRaised;
        private bool _connectStarted;
        private int _disposed;

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

            Connected?.Invoke();
            _ = ReceiveLoopAsync(_socket, _lifetimeCancellation.Token);
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
            using var operationCancellation = CancellationTokenSource.CreateLinkedTokenSource(
                cancellationToken, _lifetimeCancellation.Token);
            var operationToken = operationCancellation.Token;
            await _sendGate.WaitAsync(operationToken).ConfigureAwait(false);
            try
            {
                await socket.SendAsync(
                        new ArraySegment<byte>(payload),
                        WebSocketMessageType.Text,
                        true,
                        operationToken)
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

            using var operationCancellation = CancellationTokenSource.CreateLinkedTokenSource(
                cancellationToken, _lifetimeCancellation.Token);
            var operationToken = operationCancellation.Token;
            var sendGateHeld = false;
            try
            {
                // Wait for already queued final Transform/lock-release frames. New sends
                // are rejected by ConnectionService once Disconnecting begins.
                await _sendGate.WaitAsync(operationToken).ConfigureAwait(false);
                sendGateHeld = true;
                if (socket.State == WebSocketState.Open || socket.State == WebSocketState.CloseReceived)
                {
                    await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "Client disconnect", operationToken)
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
                // Retire lifetime only after the normal final-frame drain and close.
                _lifetimeCancellation.Cancel();
                socket.Dispose();
                RaiseClosed("Disconnected.");
            }
        }

        public void Dispose()
        {
            if (Interlocked.Exchange(ref _disposed, 1) != 0)
            {
                return;
            }

            _lifetimeCancellation.Cancel();
            try
            {
                _socket?.Abort();
            }
            catch
            {
                // Best-effort synchronous shutdown during assembly reload/editor quit.
            }
            _socket?.Dispose();
            // In-flight waiters, gate holders and token registrations still own
            // these managed primitives. We use no WaitHandle or timer; let them
            // retire with the transport rather than racing WaitAsync/Release or
            // linked-token registration. The actual socket is disposed above.
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
            catch (ObjectDisposedException) when (Volatile.Read(ref _disposed) != 0 || cancellationToken.IsCancellationRequested)
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
            if (Volatile.Read(ref _disposed) != 0)
            {
                throw new ObjectDisposedException(nameof(ClientWebSocketTransport));
            }
        }
    }
}

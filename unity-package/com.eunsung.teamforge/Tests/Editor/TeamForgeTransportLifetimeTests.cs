using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;

namespace EunSung.TeamForge.Tests
{
    public sealed class TeamForgeTransportLifetimeTests
    {
        private const int TimeoutMilliseconds = 5000;

        [Test]
        public async Task DisposeSettlesQueuedSendsAndDisconnectBeforeGateHolderReleases()
        {
            using (var pair = await LoopbackPair.ConnectAsync())
            {
                var closed = 0;
                pair.Transport.Closed += _ => Interlocked.Increment(ref closed);
                var gate = SendGate(pair.Transport);
                await gate.WaitAsync();
                var gateHeld = true;
                try
                {
                    var first = pair.Transport.SendTextAsync("queued Transform", CancellationToken.None);
                    var second = pair.Transport.SendTextAsync("queued lock release", CancellationToken.None);
                    var disconnect = pair.Transport.DisconnectAsync(CancellationToken.None);
                    Assert.That(first.IsCompleted || second.IsCompleted || disconnect.IsCompleted, Is.False);

                    pair.Transport.Dispose();
                    pair.Transport.Dispose();
                    await Within(Task.WhenAll(ObserveFailure(first), ObserveFailure(second), ObserveFailure(disconnect)));
                    await AssertCancelled(first);
                    await AssertCancelled(second);
                    await disconnect;
                    Assert.DoesNotThrow(() => gate.Release(), "An in-flight holder must retain a usable gate after Dispose.");
                    gateHeld = false;
                    Assert.That(Volatile.Read(ref closed), Is.EqualTo(1));
                    try
                    {
                        await pair.Transport.SendTextAsync("too late", CancellationToken.None);
                        Assert.Fail("A disposed transport must reject a future send.");
                    }
                    catch (ObjectDisposedException) { }
                }
                finally
                {
                    if (gateHeld)
                    {
                        try { gate.Release(); }
                        catch (ObjectDisposedException) { } // Baseline failure cleanup only.
                    }
                }
            }
        }

        [Test]
        public async Task CancellingQueuedCallerLeavesOtherSendsAndTransportAvailable()
        {
            using (var pair = await LoopbackPair.ConnectAsync())
            using (var caller = new CancellationTokenSource())
            {
                var gate = SendGate(pair.Transport);
                await gate.WaitAsync();
                var received = pair.ReceiveTextAsync();
                _ = ObserveFailure(received);
                Task healthy;
                try
                {
                    var cancelled = pair.Transport.SendTextAsync("caller cancelled", caller.Token);
                    healthy = pair.Transport.SendTextAsync("healthy frame", CancellationToken.None);
                    caller.Cancel();
                    await AssertCancelled(cancelled);
                    Assert.That(healthy.IsCompleted, Is.False, "Only the cancelled caller should leave the send queue.");
                }
                finally { gate.Release(); }

                await Within(healthy);
                await Within(received);
                Assert.That(await received, Is.EqualTo("healthy frame"));
            }
        }

        [Test]
        public async Task GracefulDisconnectDrainsQueuedFinalFramesBeforeClose()
        {
            using (var pair = await LoopbackPair.ConnectAsync())
            {
                var received = pair.ReceiveUntilCloseAsync();
                var gate = SendGate(pair.Transport);
                await gate.WaitAsync();
                var gateHeld = true;
                try
                {
                    var first = pair.Transport.SendTextAsync("final Transform", CancellationToken.None);
                    var second = pair.Transport.SendTextAsync("final lock release", CancellationToken.None);
                    var disconnect = pair.Transport.DisconnectAsync(CancellationToken.None);
                    Assert.That(disconnect.IsCompleted, Is.False);
                    gate.Release();
                    gateHeld = false;

                    await Within(Task.WhenAll(first, second, disconnect));
                    await Within(received);
                    Assert.That(await received, Is.EqualTo(new[] { "final Transform", "final lock release" }));
                }
                finally
                {
                    if (gateHeld) gate.Release();
                    _ = ObserveFailure(received);
                }
            }
        }

        private static SemaphoreSlim SendGate(ClientWebSocketTransport transport)
        {
            var field = typeof(ClientWebSocketTransport).GetField("_sendGate", BindingFlags.Instance | BindingFlags.NonPublic);
            Assert.That(field, Is.Not.Null);
            return (SemaphoreSlim)field.GetValue(transport);
        }

        private static async Task Within(Task task)
        {
            if (await Task.WhenAny(task, Task.Delay(TimeoutMilliseconds)).ConfigureAwait(false) != task)
                throw new TimeoutException("The transport operation did not settle within the test deadline.");
            await task.ConfigureAwait(false);
        }

        private static async Task AssertCancelled(Task task)
        {
            try
            {
                await Within(task).ConfigureAwait(false);
                Assert.Fail("The cancelled send must not complete successfully.");
            }
            catch (OperationCanceledException) { }
        }

        private static async Task ObserveFailure(Task task)
        {
            try { await task.ConfigureAwait(false); }
            catch (Exception) { }
        }

        // A bounded RFC 6455 handshake over an ephemeral TCP port avoids
        // HttpListener.AcceptWebSocketAsync, which is unavailable on some Mono runtimes.
        // Pure fixture I/O must not wait for an Editor frame after each byte read.
        private sealed class LoopbackPair : IDisposable
        {
            private readonly TcpListener _listener;
            private TcpClient _peerClient;
            private WebSocket _peer;

            private LoopbackPair()
            {
                _listener = new TcpListener(IPAddress.Loopback, 0);
                _listener.Start();
                var port = ((IPEndPoint)_listener.LocalEndpoint).Port;
                Transport = new ClientWebSocketTransport(new Uri($"ws://127.0.0.1:{port}/"), new ClientWebSocket());
            }

            internal ClientWebSocketTransport Transport { get; }

            internal static async Task<LoopbackPair> ConnectAsync()
            {
                var pair = new LoopbackPair();
                var accepting = pair.AcceptPeerAsync();
                try
                {
                    using (var deadline = new CancellationTokenSource(TimeoutMilliseconds))
                        await Within(Task.WhenAll(pair.Transport.ConnectAsync(deadline.Token), accepting)).ConfigureAwait(false);
                    return pair;
                }
                catch
                {
                    pair.Dispose();
                    _ = ObserveFailure(accepting);
                    throw;
                }
            }

            private async Task AcceptPeerAsync()
            {
                _peerClient = await _listener.AcceptTcpClientAsync().ConfigureAwait(false);
                var stream = _peerClient.GetStream();
                using (var deadline = new CancellationTokenSource(TimeoutMilliseconds))
                using (var headers = new MemoryStream())
                {
                    var single = new byte[1];
                    var tail = string.Empty;
                    while (!tail.EndsWith("\r\n\r\n", StringComparison.Ordinal))
                    {
                        if (headers.Length >= 16384) throw new InvalidDataException("WebSocket test headers exceed the bound.");
                        if (await stream.ReadAsync(single, 0, 1, deadline.Token).ConfigureAwait(false) == 0) throw new EndOfStreamException();
                        headers.WriteByte(single[0]);
                        tail = (tail + (char)single[0]);
                        if (tail.Length > 4) tail = tail.Substring(tail.Length - 4);
                    }
                    string key = null;
                    foreach (var line in Encoding.ASCII.GetString(headers.ToArray()).Split(new[] { "\r\n" }, StringSplitOptions.None))
                    {
                        if (line.StartsWith("Sec-WebSocket-Key:", StringComparison.OrdinalIgnoreCase))
                            key = line.Substring("Sec-WebSocket-Key:".Length).Trim();
                    }
                    if (string.IsNullOrEmpty(key)) throw new InvalidDataException("WebSocket test handshake has no key.");
                    string accept;
                    using (var sha1 = SHA1.Create())
                        accept = Convert.ToBase64String(sha1.ComputeHash(Encoding.ASCII.GetBytes(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")));
                    var response = Encoding.ASCII.GetBytes("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + "\r\n\r\n");
                    await stream.WriteAsync(response, 0, response.Length, deadline.Token).ConfigureAwait(false);
                }
                _peer = WebSocket.CreateFromStream(stream, true, null, TimeSpan.Zero);
            }

            internal async Task<string> ReceiveTextAsync()
            {
                var message = await ReceiveMessageAsync().ConfigureAwait(false);
                Assert.That(message.Item1, Is.EqualTo(WebSocketMessageType.Text));
                return message.Item2;
            }

            internal async Task<List<string>> ReceiveUntilCloseAsync()
            {
                var frames = new List<string>();
                while (true)
                {
                    var message = await ReceiveMessageAsync().ConfigureAwait(false);
                    if (message.Item1 == WebSocketMessageType.Close)
                    {
                        using (var deadline = new CancellationTokenSource(TimeoutMilliseconds))
                            await _peer.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "Test peer closed", deadline.Token).ConfigureAwait(false);
                        return frames;
                    }
                    Assert.That(message.Item1, Is.EqualTo(WebSocketMessageType.Text));
                    frames.Add(message.Item2);
                }
            }

            private async Task<Tuple<WebSocketMessageType, string>> ReceiveMessageAsync()
            {
                using (var deadline = new CancellationTokenSource(TimeoutMilliseconds))
                using (var message = new MemoryStream())
                {
                    var buffer = new byte[1024];
                    WebSocketReceiveResult result;
                    do
                    {
                        result = await _peer.ReceiveAsync(new ArraySegment<byte>(buffer), deadline.Token).ConfigureAwait(false);
                        message.Write(buffer, 0, result.Count);
                        if (message.Length > 16384) throw new InvalidDataException("WebSocket test frame exceeds the bound.");
                    }
                    while (!result.EndOfMessage);
                    return Tuple.Create(result.MessageType, Encoding.UTF8.GetString(message.ToArray()));
                }
            }

            public void Dispose()
            {
                Transport.Dispose();
                _peer?.Abort();
                _peer?.Dispose();
                _peerClient?.Dispose();
                _listener.Stop();
            }
        }
    }
}

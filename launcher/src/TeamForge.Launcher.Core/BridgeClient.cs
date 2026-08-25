using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text.Json;

namespace TeamForge.Launcher.Core;

public sealed class BridgeException : Exception
{
    public BridgeException(string code, string userMessage, string action, string advancedDetail, JsonElement? diagnostics = null)
        : base(userMessage)
    {
        Code = string.IsNullOrWhiteSpace(code) ? "guest_bootstrap_failed" : code;
        UserMessage = string.IsNullOrWhiteSpace(userMessage) ? "TeamForge could not receive this project safely." : userMessage;
        Action = action ?? string.Empty;
        AdvancedDetail = advancedDetail ?? string.Empty;
        Diagnostics = diagnostics?.Clone();
    }

    public string Code { get; }
    public string UserMessage { get; }
    public string Action { get; }
    public string AdvancedDetail { get; }
    public JsonElement? Diagnostics { get; }
}

public sealed class BridgeEventArgs : EventArgs
{
    public BridgeEventArgs(string requestId, string eventName, JsonElement message)
    {
        RequestId = requestId;
        EventName = eventName;
        Message = message;
    }

    public string RequestId { get; }
    public string EventName { get; }
    public JsonElement Message { get; }
}

public static class RuntimeProcessPolicy
{
    public static ProcessStartInfo CreateBridgeStartInfo(VerifiedRuntimeLayout runtime)
    {
        var info = new ProcessStartInfo
        {
            FileName = runtime.NodeExecutable,
            WorkingDirectory = runtime.BaseDirectory,
            UseShellExecute = false,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
        };
        info.ArgumentList.Add(runtime.Loader);
        info.ArgumentList.Add("--runtime-root");
        info.ArgumentList.Add(runtime.RuntimeRoot);
        info.ArgumentList.Add("--manifest-sha256");
        info.ArgumentList.Add(runtime.Pins.RuntimeManifestSha256);
        EnvironmentPolicy.Scrub(info.Environment);
        return info;
    }
}

public sealed class BridgeClient : IAsyncDisposable
{
    private const int MaximumBridgeLineCharacters = 1024 * 1024;
    private readonly Process _process;
    private readonly SemaphoreSlim _writeLock = new(1, 1);
    private readonly ConcurrentDictionary<string, TaskCompletionSource<JsonElement>> _pending = new(StringComparer.Ordinal);
    private readonly CancellationTokenSource _lifetime = new();
    private readonly Task _stdoutTask;
    private readonly Task _stderrTask;
    private readonly Task _exitTask;
    private int _disposed;

    private BridgeClient(Process process)
    {
        _process = process;
        _stdoutTask = ReadStdoutAsync(_lifetime.Token);
        _stderrTask = ReadStderrAsync(_lifetime.Token);
        _exitTask = WatchExitAsync(_lifetime.Token);
    }

    public event EventHandler<BridgeEventArgs>? EventReceived;
    public event EventHandler<string>? DiagnosticReceived;

    public static BridgeClient Start(VerifiedRuntimeLayout runtime)
    {
        var process = new Process { StartInfo = RuntimeProcessPolicy.CreateBridgeStartInfo(runtime), EnableRaisingEvents = true };
        try
        {
            if (!process.Start())
            {
                throw new InvalidOperationException("The verified TeamForge runtime did not start.");
            }

            return new BridgeClient(process);
        }
        catch
        {
            process.Dispose();
            throw;
        }
    }

    public async Task<JsonElement> SendRequestAsync(
        string type,
        IReadOnlyDictionary<string, object?>? values = null,
        CancellationToken cancellationToken = default)
    {
        if (Volatile.Read(ref _disposed) != 0)
        {
            throw ClosingException();
        }
        if (string.IsNullOrWhiteSpace(type))
        {
            throw new ArgumentException("A bridge request type is required.", nameof(type));
        }

        var id = Guid.NewGuid().ToString("N");
        var pending = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        if (!_pending.TryAdd(id, pending))
        {
            throw new InvalidOperationException("Could not allocate a bridge request identifier.");
        }

        var frame = new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["id"] = id,
            ["type"] = type,
        };
        if (values is not null)
        {
            foreach (var pair in values)
            {
                if (pair.Key is "id" or "type")
                {
                    throw new ArgumentException("Bridge payload values cannot replace id or type.", nameof(values));
                }

                frame[pair.Key] = pair.Value;
            }
        }

        using var registration = cancellationToken.Register(() =>
        {
            if (_pending.TryRemove(id, out var source))
            {
                source.TrySetCanceled(cancellationToken);
            }
        });

        try
        {
            var line = JsonSerializer.Serialize(frame);
            await _writeLock.WaitAsync(cancellationToken).ConfigureAwait(false);
            try
            {
                if (Volatile.Read(ref _disposed) != 0)
                {
                    throw ClosingException();
                }
                await _process.StandardInput.WriteLineAsync(line.AsMemory(), cancellationToken).ConfigureAwait(false);
                await _process.StandardInput.FlushAsync(cancellationToken).ConfigureAwait(false);
            }
            finally
            {
                try
                {
                    _writeLock.Release();
                }
                catch (ObjectDisposedException) when (Volatile.Read(ref _disposed) != 0)
                {
                }
            }

            return await pending.Task.ConfigureAwait(false);
        }
        catch (Exception exception) when (
            Volatile.Read(ref _disposed) != 0 &&
            exception is ObjectDisposedException or IOException or InvalidOperationException)
        {
            _pending.TryRemove(id, out _);
            throw ClosingException();
        }
        catch
        {
            _pending.TryRemove(id, out _);
            throw;
        }
    }

    private async Task ReadStdoutAsync(CancellationToken cancellationToken)
    {
        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                var line = await _process.StandardOutput.ReadLineAsync(cancellationToken).ConfigureAwait(false);
                if (line is null)
                {
                    break;
                }

                if (line.Length == 0)
                {
                    continue;
                }

                if (line.Length > MaximumBridgeLineCharacters)
                {
                    throw new InvalidDataException("The TeamForge runtime returned an oversized response.");
                }

                HandleLine(line);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
        catch (Exception exception)
        {
            FailAll(new BridgeException("runtime_protocol_error", "TeamForge's internal runtime stopped responding safely.", "Restart TeamForge Launcher and try again.", exception.Message));
        }
    }

    private async Task ReadStderrAsync(CancellationToken cancellationToken)
    {
        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                var line = await _process.StandardError.ReadLineAsync(cancellationToken).ConfigureAwait(false);
                if (line is null)
                {
                    break;
                }

                if (line.Length > 4096)
                {
                    line = line[..4096] + "…";
                }

                // stderr is deliberately not surfaced verbatim: even a trusted
                // bridge must not accidentally echo an invite or access code.
                DiagnosticReceived?.Invoke(this, "runtime_stderr");
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
        catch (IOException)
        {
        }
    }

    private void HandleLine(string line)
    {
        using var document = JsonDocument.Parse(line, new JsonDocumentOptions { AllowTrailingCommas = false, CommentHandling = JsonCommentHandling.Disallow, MaxDepth = 32 });
        var root = document.RootElement;
        if (root.ValueKind != JsonValueKind.Object)
        {
            throw new InvalidDataException("The TeamForge runtime returned a non-object frame.");
        }

        var id = ReadString(root, "id") ?? string.Empty;
        var eventName = ReadString(root, "event") ?? ReadString(root, "kind") ?? ReadString(root, "type") ?? string.Empty;
        var isError = eventName.Equals("error", StringComparison.OrdinalIgnoreCase)
            || (root.TryGetProperty("ok", out var ok) && ok.ValueKind == JsonValueKind.False);
        var isComplete = eventName.Equals("complete", StringComparison.OrdinalIgnoreCase)
            || eventName.Equals("result", StringComparison.OrdinalIgnoreCase)
            || (root.TryGetProperty("ok", out ok) && ok.ValueKind == JsonValueKind.True);

        if (!string.IsNullOrEmpty(id) && isError && _pending.TryRemove(id, out var failed))
        {
            failed.TrySetException(ParseBridgeException(root));
            return;
        }

        if (!string.IsNullOrEmpty(id) && isComplete && _pending.TryRemove(id, out var completed))
        {
            completed.TrySetResult(ReadResult(root));
            return;
        }

        EventReceived?.Invoke(this, new BridgeEventArgs(id, eventName, root.Clone()));
    }

    private async Task WatchExitAsync(CancellationToken cancellationToken)
    {
        try
        {
            await _process.WaitForExitAsync(cancellationToken).ConfigureAwait(false);
            if (Volatile.Read(ref _disposed) == 0)
            {
                FailAll(new BridgeException("runtime_exited", "TeamForge's internal runtime exited unexpectedly.", "Restart TeamForge Launcher and try again.", $"Exit code: {_process.ExitCode}"));
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
    }

    private static BridgeException ParseBridgeException(JsonElement root)
    {
        var error = root.TryGetProperty("error", out var nested) && nested.ValueKind == JsonValueKind.Object ? nested : root;
        return new BridgeException(
            ReadString(error, "code") ?? "guest_bootstrap_failed",
            ReadString(error, "userMessage") ?? ReadString(error, "message") ?? "TeamForge could not receive this project safely.",
            ReadString(error, "action") ?? ReadString(error, "recoveryAction") ?? string.Empty,
            ReadString(error, "advancedDetail") ?? ReadString(error, "technicalDetail") ?? ReadString(error, "detail") ?? string.Empty,
            error.TryGetProperty("diagnostics", out var diagnostics) && diagnostics.ValueKind == JsonValueKind.Object
                ? diagnostics
                : null);
    }

    private static JsonElement ReadResult(JsonElement root)
    {
        if (root.TryGetProperty("result", out var result))
        {
            return result.Clone();
        }

        return root.Clone();
    }

    private static string? ReadString(JsonElement element, string name)
    {
        return element.TryGetProperty(name, out var property) && property.ValueKind == JsonValueKind.String
            ? property.GetString()
            : null;
    }

    private static BridgeException ClosingException()
    {
        return new BridgeException(
            "runtime_shutdown",
            "TeamForge Launcher is closing.",
            string.Empty,
            "An in-flight bridge request was cancelled because the Launcher/runtime is shutting down.");
    }

    private void FailAll(Exception exception)
    {
        foreach (var pair in _pending.ToArray())
        {
            if (_pending.TryRemove(pair.Key, out var source))
            {
                source.TrySetException(exception);
            }
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0)
        {
            return;
        }

        // Settle callers with the same handled BridgeException type used by normal
        // runtime failures. This prevents a pending WPF Receive_Click continuation
        // from observing an uncaught ObjectDisposedException during window shutdown.
        FailAll(ClosingException());

        try
        {
            using var gracefulTimeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
            await SendShutdownFrameDirectAsync(gracefulTimeout.Token).ConfigureAwait(false);
            await _process.WaitForExitAsync(gracefulTimeout.Token).ConfigureAwait(false);
        }
        catch (Exception exception) when (exception is OperationCanceledException or IOException or InvalidOperationException or ObjectDisposedException)
        {
            try
            {
                if (!_process.HasExited)
                {
                    _process.Kill(entireProcessTree: true);
                    await _process.WaitForExitAsync().ConfigureAwait(false);
                }
            }
            catch (Exception killException) when (killException is InvalidOperationException or ObjectDisposedException)
            {
            }
        }
        finally
        {
            _lifetime.Cancel();
            FailAll(ClosingException());
            try
            {
                await Task.WhenAll(_stdoutTask, _stderrTask, _exitTask).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
            }

            _process.Dispose();
            _writeLock.Dispose();
            _lifetime.Dispose();
        }
    }

    private async Task SendShutdownFrameDirectAsync(CancellationToken cancellationToken)
    {
        if (_process.HasExited)
        {
            return;
        }

        var frame = JsonSerializer.Serialize(new { id = Guid.NewGuid().ToString("N"), type = "shutdown" });
        await _writeLock.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            await _process.StandardInput.WriteLineAsync(frame.AsMemory(), cancellationToken).ConfigureAwait(false);
            await _process.StandardInput.FlushAsync(cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            _writeLock.Release();
        }
    }
}

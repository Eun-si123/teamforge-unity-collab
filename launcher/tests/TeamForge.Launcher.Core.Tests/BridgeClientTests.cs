using System.Diagnostics;
using System.IO.Pipes;
using System.Reflection;
using System.Text;
using System.Text.Json;
using TeamForge.Launcher.Core;

internal static class BridgeClientTests
{
    private const BindingFlags PrivateInstance = BindingFlags.Instance | BindingFlags.NonPublic;
    private static readonly TimeSpan Deadline = TimeSpan.FromSeconds(5);

    // This child only handles synthetic protocol frames; it never loads a
    // packaged runtime, project, invite, access code, or persistent user state.
    public static async Task<int> RunChildAsync(string mode)
    {
        while (await Console.In.ReadLineAsync() is { } line)
        {
            if (mode == "guest-limit" && Encoding.UTF8.GetByteCount(line) > 1_048_576)
            {
                // Mirrors the Guest runtime's uncorrelated oversized-frame error.
                Console.WriteLine("{\"id\":\"\",\"event\":\"error\",\"error\":{\"code\":\"invalid_guest_request\"}}");
                continue;
            }
            using var document = JsonDocument.Parse(line);
            var root = document.RootElement;
            var type = root.GetProperty("type").GetString();
            if (type == "shutdown") return 0;
            if (type == "hold") continue;
            if (type == "reject")
            {
                Console.WriteLine(JsonSerializer.Serialize(new
                {
                    id = root.GetProperty("id").GetString(), @event = "error",
                    error = new { code = "public_request_rejected", message = "Public fixture rejection." },
                }));
                continue;
            }
            if (type == "trigger")
            {
                if (mode == "exit") return 0;
                Console.WriteLine(mode == "oversized" ? new string('x', 1024 * 1024 + 1) : "{public malformed frame");
                Console.Out.Flush();
                continue;
            }
            Console.WriteLine(JsonSerializer.Serialize(new
            {
                id = root.GetProperty("id").GetString(),
                @event = "complete", result = new { publicFixture = true },
            }));
        }
        return 0;
    }

    public static async Task HealthyAsync()
    {
        await using var fixture = new Fixture("healthy");
        for (var index = 0; index < 2; index++)
        {
            using var timeout = new CancellationTokenSource(Deadline);
            var result = await fixture.Bridge.SendRequestAsync("health", cancellationToken: timeout.Token);
            Require(result.GetProperty("publicFixture").GetBoolean(), "Healthy bridge result was not delivered.");
        }
        Require(PendingCount(fixture.Bridge) == 0, "Healthy requests left pending entries.");
        using var rejectionTimeout = new CancellationTokenSource(Deadline);
        var rejection = await ExpectBridgeFailureAsync(fixture.Bridge.SendRequestAsync("reject", cancellationToken: rejectionTimeout.Token));
        Require(rejection.Code == "public_request_rejected", "Ordinary request error was not preserved.");
        using var recoveryTimeout = new CancellationTokenSource(Deadline);
        await fixture.Bridge.SendRequestAsync("health", cancellationToken: recoveryTimeout.Token);
        await fixture.Bridge.DisposeAsync();
        var shutdown = await ExpectBridgeFailureAsync(fixture.Bridge.SendRequestAsync("health"));
        Require(shutdown.Code == "runtime_shutdown", "Disposed clients must retain shutdown semantics.");
    }

    public static async Task RequestFrameBudgetAsync()
    {
        await using var fixture = new Fixture("guest-limit");
        var values = new Dictionary<string, object?>
        {
            ["invite"] = "",
            ["managedRoot"] = "m",
            ["stateRoot"] = "s",
        };
        var template = new Dictionary<string, object?>
        {
            ["id"] = new string('0', 32),
            ["type"] = "inspect",
            ["invite"] = "",
            ["managedRoot"] = "m",
            ["stateRoot"] = "s",
        };
        var remaining = 1_048_576 - Encoding.UTF8.GetByteCount(JsonSerializer.Serialize(template));
        Require(remaining > 0, "Invalid synthetic Guest frame budget.");
        values["invite"] = new string('x', remaining);
        using (var timeout = new CancellationTokenSource(Deadline))
        {
            var exact = await fixture.Bridge.SendRequestAsync("inspect", values, timeout.Token);
            Require(exact.GetProperty("publicFixture").GetBoolean(), "Exactly 1 MiB must remain valid.");
        }

        values["invite"] = new string('x', remaining + 1);
        var over = await ExpectBridgeFailureAsync(fixture.Bridge.SendRequestAsync("inspect", values));
        Require(over.Code == "invalid_guest_request", "Oversized Guest request must fail before write.");
        Require(PendingCount(fixture.Bridge) == 0, "Oversized request left a pending entry.");
        values["invite"] = new string('가', 200_000);
        var unicode = await ExpectBridgeFailureAsync(fixture.Bridge.SendRequestAsync("inspect", values));
        Require(unicode.Code == "invalid_guest_request", "Serialized Unicode request must use UTF-8 frame bytes.");
        Require(PendingCount(fixture.Bridge) == 0, "Unicode rejection left a pending entry.");

        using var recoveryTimeout = new CancellationTokenSource(Deadline);
        await fixture.Bridge.SendRequestAsync("health", cancellationToken: recoveryTimeout.Token);
    }

    public static Task MalformedAsync() => BrokenReaderAsync("malformed");
    public static Task OversizedAsync() => BrokenReaderAsync("oversized");
    public static async Task EofAsync()
    {
        await using var fixture = new Fixture("healthy", controlledOutput: true);
        using var timeout = new CancellationTokenSource(Deadline);
        var request = fixture.Bridge.SendRequestAsync("hold", cancellationToken: timeout.Token);
        Require(PendingCount(fixture.Bridge) == 1, "EOF fixture did not register its request.");
        fixture.CloseOutput();
        var failure = await ExpectBridgeFailureAsync(request);
        Require(failure.Code == "runtime_protocol_error", "Unexpected stdout EOF must fail the pending request.");
        Require(!fixture.Process.HasExited, "The EOF test must not rely on process exit.");
        using var retryTimeout = new CancellationTokenSource(Deadline);
        var retry = await ExpectBridgeFailureAsync(fixture.Bridge.SendRequestAsync("health", cancellationToken: retryTimeout.Token));
        Require(retry.Code == failure.Code, "EOF must preserve the failure for subsequent requests.");
        Require(PendingCount(fixture.Bridge) == 0, "EOF left a pending request.");
    }

    private static async Task BrokenReaderAsync(string mode)
    {
        await using var fixture = new Fixture(mode);
        using var timeout = new CancellationTokenSource(Deadline);
        var failure = await ExpectBridgeFailureAsync(fixture.Bridge.SendRequestAsync("trigger", cancellationToken: timeout.Token));
        Require(failure.Code == "runtime_protocol_error", "A dead stdout reader must report a stable protocol failure.");
        Require(!fixture.Process.HasExited, "The fixture must stay alive after its stdout fails.");
        using var retryTimeout = new CancellationTokenSource(Deadline);
        var retryFailure = await ExpectBridgeFailureAsync(fixture.Bridge.SendRequestAsync("health", cancellationToken: retryTimeout.Token));
        Require(retryFailure.Code == failure.Code, "A subsequent request must preserve the terminal failure category.");
        Require(PendingCount(fixture.Bridge) == 0, "Terminal bridge failure left a pending request.");
        Require(!fixture.Process.HasExited, "Terminal rejection must not depend on process exit.");
    }

    public static async Task ExitedAsync()
    {
        await using var fixture = new Fixture("exit");
        using var timeout = new CancellationTokenSource(Deadline);
        var failure = await ExpectBridgeFailureAsync(fixture.Bridge.SendRequestAsync("trigger", cancellationToken: timeout.Token));
        await fixture.Process.WaitForExitAsync().WaitAsync(Deadline);
        // EOF and the process observer can race. The first failure remains the
        // stable reason, whichever of those signals arrives first.
        Require(failure.Code is "runtime_exited" or "runtime_protocol_error", "Exited runtime had no stable failure category.");
        using var retryTimeout = new CancellationTokenSource(Deadline);
        var retryFailure = await ExpectBridgeFailureAsync(fixture.Bridge.SendRequestAsync("health", cancellationToken: retryTimeout.Token));
        Require(retryFailure.Code == failure.Code, "Requests after exit lost the terminal failure category.");
        Require(PendingCount(fixture.Bridge) == 0, "Process exit left a pending request.");
    }

    public static async Task QueuedWriterAsync()
    {
        await using var fixture = new Fixture("malformed");
        var writeLock = (SemaphoreSlim)typeof(BridgeClient).GetField("_writeLock", PrivateInstance)!.GetValue(fixture.Bridge)!;
        await writeLock.WaitAsync();
        try
        {
            using var timeout = new CancellationTokenSource(Deadline);
            var request = fixture.Bridge.SendRequestAsync("health", cancellationToken: timeout.Token);
            Require(PendingCount(fixture.Bridge) == 1, "Synthetic writer did not queue before failure.");
            // Test-only bypass of the held writer sends the child's failure frame.
            // The request must settle before this test releases the semaphore.
            await fixture.Process.StandardInput.WriteLineAsync("{\"id\":\"public-trigger\",\"type\":\"trigger\"}");
            await fixture.Process.StandardInput.FlushAsync();
            var failure = await ExpectBridgeFailureAsync(request);
            Require(failure.Code == "runtime_protocol_error", "Queued writer did not receive the terminal failure.");
            Require(PendingCount(fixture.Bridge) == 0, "Queued writer left a pending entry.");
        }
        finally { writeLock.Release(); }
    }

    public static async Task CallerCancellationAsync()
    {
        await using var fixture = new Fixture("healthy");
        foreach (var queued in new[] { false, true })
        {
            var writeLock = WriteLock(fixture.Bridge);
            if (queued) await writeLock.WaitAsync();
            try
            {
                using var cancellation = new CancellationTokenSource();
                var request = fixture.Bridge.SendRequestAsync(queued ? "health" : "hold", cancellationToken: cancellation.Token);
                Require(PendingCount(fixture.Bridge) == 1, "Cancellation fixture did not register its request.");
                cancellation.Cancel();
                try
                {
                    await request.WaitAsync(Deadline);
                    throw new InvalidOperationException("Caller cancellation was ignored.");
                }
                catch (OperationCanceledException exception)
                {
                    Require(exception.CancellationToken == cancellation.Token, "Caller cancellation lost its token.");
                }
                Require(PendingCount(fixture.Bridge) == 0, "Caller cancellation left a pending request.");
            }
            finally { if (queued) writeLock.Release(); }
            using var timeout = new CancellationTokenSource(Deadline);
            await fixture.Bridge.SendRequestAsync("health", cancellationToken: timeout.Token);
        }
    }

    public static async Task ShutdownPendingAsync()
    {
        foreach (var queued in new[] { false, true })
        {
            await using var fixture = new Fixture("healthy");
            var writeLock = WriteLock(fixture.Bridge);
            if (queued) await writeLock.WaitAsync();
            Task disposal;
            try
            {
                var request = fixture.Bridge.SendRequestAsync(queued ? "health" : "hold");
                Require(PendingCount(fixture.Bridge) == 1, "Shutdown fixture did not register its request.");
                disposal = fixture.Bridge.DisposeAsync().AsTask();
                var failure = await ExpectBridgeFailureAsync(request);
                Require(failure.Code == "runtime_shutdown", "Shutdown must retire the pending operation consistently.");
                Require(PendingCount(fixture.Bridge) == 0, "Shutdown left a pending request.");
            }
            finally { if (queued) writeLock.Release(); }
            await disposal.WaitAsync(Deadline);
        }
    }

    private static SemaphoreSlim WriteLock(BridgeClient bridge) =>
        (SemaphoreSlim)typeof(BridgeClient).GetField("_writeLock", PrivateInstance)!.GetValue(bridge)!;

    private static async Task<BridgeException> ExpectBridgeFailureAsync(Task<JsonElement> request)
    {
        try { await request.WaitAsync(Deadline + TimeSpan.FromSeconds(1)); }
        catch (BridgeException exception) { return exception; }
        throw new InvalidOperationException("The broken bridge accepted a request instead of rejecting it.");
    }

    private static int PendingCount(BridgeClient bridge)
    {
        var pending = typeof(BridgeClient).GetField("_pending", PrivateInstance)!.GetValue(bridge)!;
        return (int)pending.GetType().GetProperty("Count")!.GetValue(pending)!;
    }

    private static void Require(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException(message);
    }

    private sealed class Fixture : IAsyncDisposable
    {
        private readonly StreamReader? _originalOutput;
        private readonly AnonymousPipeClientStream? _outputWriter;
        public Process Process { get; }
        public BridgeClient Bridge { get; }

        public Fixture(string mode, bool controlledOutput = false)
        {
            var executable = Environment.ProcessPath ?? throw new InvalidOperationException("Test executable is unavailable.");
            var info = new ProcessStartInfo(executable)
            {
                UseShellExecute = false, RedirectStandardInput = true,
                RedirectStandardOutput = true, RedirectStandardError = true,
                CreateNoWindow = true,
            };
            if (Path.GetFileNameWithoutExtension(executable).Equals("dotnet", StringComparison.OrdinalIgnoreCase))
                info.ArgumentList.Add(Assembly.GetEntryAssembly()!.Location);
            info.ArgumentList.Add("--bridge-fixture");
            info.ArgumentList.Add(mode);
            EnvironmentPolicy.Scrub(info.Environment);
            Process = Process.Start(info) ?? throw new InvalidOperationException("Synthetic bridge did not start.");
            if (controlledOutput)
            {
                // A parent-controlled real pipe gives deterministic EOF without
                // relying on the child runtime's duplicated OS console handles.
                // Only the test Process's reader is substituted, before the
                // production BridgeClient starts reading it.
                _originalOutput = Process.StandardOutput;
                var output = new AnonymousPipeServerStream(PipeDirection.In);
                _outputWriter = new AnonymousPipeClientStream(PipeDirection.Out, output.ClientSafePipeHandle);
                typeof(Process).GetField("_standardOutput", PrivateInstance)!.SetValue(Process, new StreamReader(output));
            }
            // Production Start still requires a pinned verified Runtime layout.
            Bridge = (BridgeClient)typeof(BridgeClient).GetConstructor(PrivateInstance, null,
                new[] { typeof(Process) }, null)!.Invoke(new object[] { Process });
        }

        public void CloseOutput() => _outputWriter!.Dispose();

        public async ValueTask DisposeAsync()
        {
            try { await Bridge.DisposeAsync(); }
            finally
            {
                _outputWriter?.Dispose();
                _originalOutput?.Dispose();
            }
        }
    }
}

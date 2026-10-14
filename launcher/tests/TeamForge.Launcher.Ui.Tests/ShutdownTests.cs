using System.Diagnostics;
using System.Reflection;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using TeamForge.Launcher;
using TeamForge.Launcher.Core;

internal static class ShutdownTests
{
    private const BindingFlags PrivateInstance = BindingFlags.Instance | BindingFlags.NonPublic;

    // Only the self-contained test executable enters this mode. No production
    // Runtime, credentials, projects, network or persistent state are involved.
    public static int RunChild(string[] args)
    {
        if (args.Length != 5) return 2;
        using var ready = EventWaitHandle.OpenExisting(args[1]);
        using var shutdown = EventWaitHandle.OpenExisting(args[2]);
        using var release = EventWaitHandle.OpenExisting(args[3]);
        ready.Set();
        while (Console.ReadLine() is { } line)
        {
            using var document = JsonDocument.Parse(line);
            var type = document.RootElement.GetProperty("type").GetString();
            if (type == "health" && args[4] != "hold-health")
            {
                Console.WriteLine(JsonSerializer.Serialize(new
                {
                    id = document.RootElement.GetProperty("id").GetString(),
                    @event = "complete", result = new { productVersion = "0.5.1" },
                }));
                continue;
            }
            if (type != "shutdown") continue;
            shutdown.Set();
            // Ignore mode deliberately leaves the real BridgeClient deadline to
            // terminate this process. Gate mode exits only after the parent says so.
            return release.WaitOne(TimeSpan.FromSeconds(15)) && args[4] != "ignore" ? 0 : 3;
        }
        return 0;
    }

    public static void RepeatedClose(Action pump)
    {
        using var fixture = new Fixture(pump);
        fixture.Window.Close();
        fixture.WaitForShutdown();
        Require(fixture.ClosedCount == 0, "Initial Close must wait for the child.");
        fixture.Window.Close();
        fixture.Window.Close();
        Require(fixture.ClosedCount == 0, "Repeated Close bypassed unfinished bridge cleanup.");
        fixture.Release();
        fixture.WaitForClosed();
        Require(fixture.ChildExited, "Closed was raised before the child exited.");
        Require(fixture.ClosedCount == 1, "Window should finish closing exactly once.");
    }

    public static void PendingRequestAndInput(Action pump)
    {
        using var fixture = new Fixture(pump);
        var input = (AccessCodeInput)fixture.Window.FindName("AccessCodeBox");
        ((TextBox)fixture.Window.FindName("InviteTextBox")).Text = "public-placeholder-invite";
        SetField(fixture.Window, "_runtimeReady", true);
        input.Password = "public-synthetic-shutdown-code";
        SetField(fixture.Window, "_pendingAccessCode", input.Password);
        var pending = fixture.Bridge.SendRequestAsync("hold");
        fixture.Window.Close();
        fixture.WaitForShutdown();
        WaitUntil(() => pending.IsCompleted, pump, "Pending bridge request did not settle.");
        try
        {
            pending.GetAwaiter().GetResult();
            throw new InvalidOperationException("Pending request unexpectedly succeeded during shutdown.");
        }
        catch (BridgeException exception)
        {
            Require(exception.Code == "runtime_shutdown", "Shutdown error classification changed.");
        }
        Require(input.Password.Length == 0 && GetField(fixture.Window, "_pendingAccessCode") is null,
            "Closing did not immediately retire credential copies.");
        Invoke(fixture.Window, "UpdateButtons"); // A receive/error continuation may run it again.
        foreach (var name in new[] { "InviteTextBox", "OpenInviteButton", "ReceiveButton", "AccessCodeBox",
                     "ChooseDestinationButton", "RememberCodeForRetriesCheckBox" })
        {
            Require(!((UIElement)fixture.Window.FindName(name)).IsEnabled,
                "Closing must keep workflow input disabled: " + name);
        }
        var status = (TextBlock)fixture.Window.FindName("StatusText");
        var before = status.Text;
        Invoke(fixture.Window, "ShowBridgeFailure", new BridgeException("runtime_shutdown",
            "public synthetic late failure", string.Empty, string.Empty));
        Require(status.Text == before, "Pending-request cancellation must preserve the closing UI.");
        foreach (var handler in new[] { "Preview_Click", "Receive_Click", "Pause_Click", "Cancel_Click" })
            Invoke(fixture.Window, handler, fixture.Window, new RoutedEventArgs());
        Require(GetField(fixture.Window, "_receiving") is false
            && GetField(fixture.Window, "_pendingAccessCode") is null,
            "A queued command restarted the closing workflow.");
        fixture.Release();
        fixture.WaitForClosed();
    }

    public static void QueuedEvents(Action pump)
    {
        using var fixture = new Fixture(pump);
        fixture.Window.Close();
        fixture.WaitForShutdown();
        var status = (TextBlock)fixture.Window.FindName("StatusText");
        var before = status.Text;
        using var progress = JsonDocument.Parse("{\"message\":\"late synthetic progress\",\"percent\":50}");
        var queued = (Task)Invoke(fixture.Window, "HandleBridgeEventAsync",
            new BridgeEventArgs("public-fixture", "progress", progress.RootElement.Clone()))!;
        queued.GetAwaiter().GetResult();
        Require(status.Text == before, "Queued bridge progress changed the closing UI.");
        // This must return without reaching trust presentation or ShowDialog.
        using var trust = JsonDocument.Parse("{}");
        var ignoredTrust = (Task)Invoke(fixture.Window, "HandleBridgeEventAsync",
            new BridgeEventArgs("public-fixture", "trust", trust.RootElement.Clone()))!;
        ignoredTrust.GetAwaiter().GetResult();
        Require(fixture.ClosedCount == 0, "Queued bridge work must not bypass close cleanup.");
        fixture.Release();
        fixture.WaitForClosed();
    }

    public static void UnresponsiveChild(Action pump)
    {
        using var fixture = new Fixture(pump, ignoreShutdown: true);
        fixture.Window.Close();
        fixture.WaitForShutdown();
        Require(fixture.ClosedCount == 0, "Ignored graceful shutdown closed the window prematurely.");
        fixture.WaitForClosed();
        Require(fixture.ChildExited, "Unresponsive child survived completed close cleanup.");
        Require(fixture.ClosedCount == 1, "Forced termination should complete the window close once.");
    }

    public static void CloseDuringVerification(Action pump)
    {
        var window = new MainWindow();
        var verification = new TaskCompletionSource<VerifiedRuntimeLayout>();
        var starts = 0;
        var closed = false;
        window.Closed += (_, _) => closed = true;
        var initialization = Initialize(window, () => verification.Task, _ =>
        {
            starts++;
            throw new InvalidOperationException("Late verification started a child after close.");
        });
        try
        {
            Require(!initialization.IsCompleted, "Verification gate must hold startup.");
            window.Close();
            WaitUntil(() => closed, pump, "No-bridge close did not finish.");
            var before = ((TextBlock)window.FindName("StatusText")).Text;
            // A synthetic result is sufficient: the forbidden factory must never
            // run. This does not produce or bypass a verified production layout.
            verification.SetResult(null!);
            WaitUntil(() => initialization.IsCompleted, pump, "Late verification did not settle.");
            initialization.GetAwaiter().GetResult();
            Require(starts == 0 && GetField(window, "_bridge") is null,
                "A closed window must never acquire a new child.");
            Require(GetField(window, "_runtimeReady") is false
                && ((TextBlock)window.FindName("StatusText")).Text == before,
                "Late verification changed the closing state.");
        }
        finally
        {
            verification.TrySetResult(null!);
            window.Close();
            pump();
        }
    }

    public static void CloseDuringHealth(Action pump)
    {
        using var fixture = new Fixture(pump, holdHealth: true);
        var initialization = Initialize(fixture.Window,
            () => Task.FromResult<VerifiedRuntimeLayout>(null!), _ => fixture.Bridge);
        Require(!initialization.IsCompleted, "Synthetic child must hold the health request.");
        fixture.Window.Close();
        fixture.WaitForShutdown();
        WaitUntil(() => initialization.IsCompleted, pump, "Startup health did not settle during close.");
        initialization.GetAwaiter().GetResult();
        Require(GetField(fixture.Window, "_runtimeReady") is false,
            "Shutdown-cancelled health must not publish ready.");
        Require(fixture.ClosedCount == 0, "Health cancellation must still wait for child cleanup.");
        fixture.Release();
        fixture.WaitForClosed();
    }

    public static void HealthyStartup(Action pump)
    {
        using var fixture = new Fixture(pump);
        var initialization = Initialize(fixture.Window,
            () => Task.FromResult<VerifiedRuntimeLayout>(null!), _ => fixture.Bridge);
        WaitUntil(() => initialization.IsCompleted, pump, "Healthy initialization did not finish.");
        initialization.GetAwaiter().GetResult();
        Require(GetField(fixture.Window, "_runtimeReady") is true,
            "Healthy runtime must still reach ready.");
        ((TextBox)fixture.Window.FindName("InviteTextBox")).Text = "public-placeholder-invite";
        Require(((Button)fixture.Window.FindName("ReceiveButton")).IsEnabled,
            "Healthy startup must keep the normal Guest workflow available.");
    }

    public static void RejectedEnvelopes(Action pump)
    {
        using var fixture = new Fixture(pump);
        var active = fixture.Bridge.SendRequestAsync("hold");
        try
        {
            Require(PendingCount(fixture.Bridge) == 1, "Control request must be pending before rejection.");
            foreach (var key in new[] { "id", "type" })
            {
                for (var attempt = 0; attempt < 3; attempt++)
                {
                    try
                    {
                        var rejected = fixture.Bridge.SendRequestAsync("hold", new Dictionary<string, object?>
                        {
                            [key] = "public-synthetic-reserved-value",
                        });
                        WaitUntil(() => rejected.IsCompleted, pump, "Reserved envelope was not rejected promptly.");
                        rejected.GetAwaiter().GetResult();
                        throw new InvalidOperationException("Reserved envelope key was accepted.");
                    }
                    catch (ArgumentException)
                    {
                        // Invalid caller input must not allocate an unreachable
                        // pending request or disturb a different valid request.
                    }
                    var pendingCount = PendingCount(fixture.Bridge);
                    Require(pendingCount == 1,
                        $"Rejected envelope retained pending state (expected 1, observed {pendingCount}).");
                    Require(!active.IsCompleted, "Envelope rejection disturbed a different valid request.");
                }
            }
            var health = fixture.Bridge.SendRequestAsync("health");
            WaitUntil(() => health.IsCompleted, pump, "Valid request failed after envelope rejection.");
            Require(health.GetAwaiter().GetResult().GetProperty("productVersion").GetString() == "0.5.1",
                "Healthy bridge response changed after rejection.");
            Require(PendingCount(fixture.Bridge) == 1, "Completed valid request must retire only itself.");
        }
        finally
        {
            fixture.Window.Close();
            fixture.WaitForShutdown();
            fixture.Release();
            fixture.WaitForClosed();
            Require(active.IsCompleted, "Shutdown did not settle the valid held request.");
            try
            {
                active.GetAwaiter().GetResult();
                throw new InvalidOperationException("Held request unexpectedly succeeded.");
            }
            catch (BridgeException exception)
            {
                Require(exception.Code == "runtime_shutdown", "Valid pending request shutdown changed.");
            }
            Require(PendingCount(fixture.Bridge) == 0, "Shutdown left pending requests behind.");
        }
    }

    private static int PendingCount(BridgeClient bridge)
    {
        var pending = typeof(BridgeClient).GetField("_pending", PrivateInstance)!.GetValue(bridge)!;
        return (int)pending.GetType().GetProperty("Count")!.GetValue(pending)!;
    }

    private static Task Initialize(MainWindow window, Func<Task<VerifiedRuntimeLayout>> verify,
        Func<VerifiedRuntimeLayout, BridgeClient> start) =>
        (Task)Invoke(window, "InitializeRuntimeAsync", verify, start)!;

    private static object? GetField(MainWindow window, string name) =>
        typeof(MainWindow).GetField(name, PrivateInstance)!.GetValue(window);

    private static void SetField(MainWindow window, string name, object? value) =>
        typeof(MainWindow).GetField(name, PrivateInstance)!.SetValue(window, value);

    private static object? Invoke(MainWindow window, string name, params object[] args) =>
        typeof(MainWindow).GetMethod(name, PrivateInstance)!.Invoke(window, args);

    private static void Require(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException(message);
    }

    private static void WaitUntil(Func<bool> complete, Action pump, string failure)
    {
        var clock = Stopwatch.StartNew();
        while (!complete())
        {
            Require(clock.Elapsed < TimeSpan.FromSeconds(8), failure);
            pump();
            Thread.Sleep(10);
        }
        pump();
    }

    private sealed class Fixture : IDisposable
    {
        private readonly Action _pump;
        private readonly EventWaitHandle _ready;
        private readonly EventWaitHandle _shutdown;
        private readonly EventWaitHandle _release;
        private readonly Process _observer;
        public MainWindow Window { get; }
        public BridgeClient Bridge { get; }
        public int ClosedCount { get; private set; }
        public bool ChildExited => _observer.HasExited;

        public Fixture(Action pump, bool ignoreShutdown = false, bool holdHealth = false)
        {
            _pump = pump;
            var prefix = "Local\\TeamForge.Ui.Shutdown." + Guid.NewGuid().ToString("N");
            _ready = new EventWaitHandle(false, EventResetMode.ManualReset, prefix + ".ready");
            _shutdown = new EventWaitHandle(false, EventResetMode.ManualReset, prefix + ".shutdown");
            _release = new EventWaitHandle(false, EventResetMode.ManualReset, prefix + ".release");
            var info = new ProcessStartInfo(Environment.ProcessPath!)
            {
                UseShellExecute = false, RedirectStandardInput = true,
                RedirectStandardOutput = true, RedirectStandardError = true, CreateNoWindow = true,
            };
            foreach (var arg in new[] { "--shutdown-fixture", prefix + ".ready", prefix + ".shutdown",
                         prefix + ".release", ignoreShutdown ? "ignore" : holdHealth ? "hold-health" : "gate" }) info.ArgumentList.Add(arg);
            EnvironmentPolicy.Scrub(info.Environment);
            var process = Process.Start(info) ?? throw new InvalidOperationException("Synthetic child did not start.");
            _observer = Process.GetProcessById(process.Id);
            try
            {
                Require(_ready.WaitOne(TimeSpan.FromSeconds(8)), "Synthetic child did not become ready.");
                // Test-only injection of a real client around a synthetic process;
                // the production Start still requires its verified Runtime layout.
                Bridge = (BridgeClient)typeof(BridgeClient).GetConstructor(PrivateInstance, null,
                    new[] { typeof(Process) }, null)!.Invoke(new object[] { process });
                Window = new MainWindow(); // Do not Show or start the production Runtime.
                SetField(Window, "_bridge", Bridge);
                Window.Closed += (_, _) => ClosedCount++;
            }
            catch
            {
                if (!process.HasExited) process.Kill(entireProcessTree: true);
                process.WaitForExit();
                process.Dispose();
                _observer.Dispose();
                _ready.Dispose();
                _shutdown.Dispose();
                _release.Dispose();
                throw;
            }
        }

        public void WaitForShutdown() =>
            Require(_shutdown.WaitOne(TimeSpan.FromSeconds(8)), "Graceful shutdown frame did not reach the child.");

        public void Release() => _release.Set();

        public void WaitForClosed() =>
            WaitUntil(() => ClosedCount > 0 && GetField(Window, "_bridge") is null,
                _pump, "Bridge cleanup and final Close did not complete.");

        public void Dispose()
        {
            _release.Set();
            try
            {
                if (ClosedCount == 0) Window.Close();
                WaitForClosed();
            }
            finally
            {
                if (!_observer.HasExited)
                {
                    _observer.Kill(entireProcessTree: true);
                    _observer.WaitForExit();
                }
                _observer.Dispose();
                _ready.Dispose();
                _shutdown.Dispose();
                _release.Dispose();
            }
        }
    }
}

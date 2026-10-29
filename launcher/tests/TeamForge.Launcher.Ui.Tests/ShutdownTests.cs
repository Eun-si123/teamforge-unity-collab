using System.Diagnostics;
using System.IO;
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
            if (type == "inspect" && args[4] == "reject-inspection-secret")
            {
                Console.WriteLine(JsonSerializer.Serialize(new
                {
                    id = document.RootElement.GetProperty("id").GetString(),
                    @event = "error",
                    code = "guest_activation_failed:public-synthetic-inspect-secret",
                    message = "Public synthetic inspection rejection: public-synthetic-inspect-secret",
                    advancedDetail = "Synthetic inspection detail: public-synthetic-inspect-secret",
                    diagnostics = new { managedRoot = "public-synthetic-inspect-secret", endpoint = "public-synthetic-inspect-secret" },
                }));
                continue;
            }
            if (type == "inspect" && args[4] == "hold-inspection")
            {
                shutdown.Set();
                if (!release.WaitOne(TimeSpan.FromSeconds(15))) return 3;
                Console.WriteLine(JsonSerializer.Serialize(new
                {
                    id = document.RootElement.GetProperty("id").GetString(),
                    @event = "complete", result = new { includesRealtimeSession = true },
                }));
                continue;
            }
            if (type == "start")
            {
                Console.WriteLine(JsonSerializer.Serialize(new
                {
                    id = document.RootElement.GetProperty("id").GetString(),
                    @event = "error", code = "unexpected_start", message = "Cancelled inspection must not start a transfer.",
                }));
                continue;
            }
            if (type is "pause" or "resume" or "cancel")
            {
                shutdown.Set(); // Notify the parent that the control request is held.
                if (!release.WaitOne(TimeSpan.FromSeconds(15))) return 3;
                if (args[4] == "reject-control")
                    Console.WriteLine(JsonSerializer.Serialize(new
                    {
                        id = document.RootElement.GetProperty("id").GetString(),
                        @event = "error", code = "control_rejected", message = "Public synthetic control rejection.",
                    }));
                else Console.WriteLine(JsonSerializer.Serialize(new
                    {
                        id = document.RootElement.GetProperty("id").GetString(),
                        @event = "complete", result = new { accepted = true },
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

    public static void PauseAcknowledgement(Action pump)
    {
        foreach (var initiallyPaused in new[] { false, true })
        {
            using var fixture = new Fixture(pump);
            SetField(fixture.Window, "_receiving", true);
            SetField(fixture.Window, "_paused", initiallyPaused);
            Invoke(fixture.Window, "Pause_Click", fixture.Window, new RoutedEventArgs());
            fixture.WaitForShutdown(); // The synthetic child holds the control ACK.
            using var message = JsonDocument.Parse("{}");
            var applied = (Task)Invoke(fixture.Window, "HandleBridgeEventAsync",
                new BridgeEventArgs("public-fixture", initiallyPaused ? "resumed" : "paused",
                    message.RootElement.Clone()))!;
            applied.GetAwaiter().GetResult();
            Require((bool)GetField(fixture.Window, "_paused")! == !initiallyPaused,
                "The real runtime event must apply before the held acknowledgement.");
            var status = (TextBlock)fixture.Window.FindName("StatusText");
            const string waitingForAck = "Waiting for synthetic control acknowledgement.";
            status.Text = waitingForAck;
            fixture.Release();
            WaitUntil(() => status.Text != waitingForAck, pump, "Control ACK did not reach the UI continuation.");
            Require(PendingCount(fixture.Bridge) == 0, "Completed control left a pending request behind.");
            Require((bool)GetField(fixture.Window, "_paused")! == !initiallyPaused,
                "A late ACK must not toggle the already-confirmed pause/resume event back.");
            Require(((Button)fixture.Window.FindName("PauseButton")).Content.ToString() ==
                (initiallyPaused ? "Pause" : "Resume"), "The next action must match the confirmed state.");
        }
    }

    public static void DuplicateReceiveControls(Action pump)
    {
        foreach (var cancel in new[] { false, true })
        {
            using var fixture = new Fixture(pump);
            SetField(fixture.Window, "_runtimeReady", true);
            Invoke(fixture.Window, "SetReceiving", true);
            const string publicCode = "public-synthetic-control-code";
            SetField(fixture.Window, "_pendingAccessCode", publicCode);
            var control = (Task)Invoke(fixture.Window, "SendReceiveControlAsync", cancel)!;
            fixture.WaitForShutdown();
            Require(cancel ? GetField(fixture.Window, "_pendingAccessCode") is null
                : (string?)GetField(fixture.Window, "_pendingAccessCode") == publicCode,
                "Cancel must retire transient auth before the child receives it; pause retains the launch context.");
            var duplicate = (Task)Invoke(fixture.Window, "SendReceiveControlAsync", cancel)!;
            Require(duplicate.IsCompleted && PendingCount(fixture.Bridge) == 1,
                "Repeated input must not send a second pending receive control.");
            Require(!((Button)fixture.Window.FindName("PauseButton")).IsEnabled,
                "Pause is disabled while pending or cancelling.");
            Require(((Button)fixture.Window.FindName("CancelButton")).IsEnabled == !cancel,
                "Cancellation must remain available while pause is pending.");
            fixture.Release();
            WaitUntil(() => control.IsCompleted, pump, "Receive control did not settle.");
            control.GetAwaiter().GetResult();
            Require(PendingCount(fixture.Bridge) == 0, "Completed controls retained requests.");
        }
    }

    public static void CancelDuringInspection(Action pump)
    {
        var root = Path.Combine(Path.GetTempPath(), "tf-inspect-" + Guid.NewGuid().ToString("N"));
        try
        {
            using var fixture = new Fixture(pump, holdInspection: true);
            var paths = new LauncherUserPaths(Path.Combine(root, "projects"), Path.Combine(root, "state"), Path.Combine(root, "state.json"));
            SetField(fixture.Window, "_userPaths", paths);
            SetField(fixture.Window, "_stateStore", new LauncherStateStore(paths));
            SetField(fixture.Window, "_runtimeReady", true);
            ((TextBox)fixture.Window.FindName("InviteTextBox")).Text = "public held-inspection invite";
            ((TextBox)fixture.Window.FindName("DestinationTextBox")).Text = paths.DefaultProjectsRoot;
            var receive = (Task)Invoke(fixture.Window, "ReceiveAsync")!;
            fixture.WaitForShutdown(); // Inspect is held before any receive exists in the child.
            var cancel = (Task)Invoke(fixture.Window, "SendReceiveControlAsync", true)!;
            fixture.Release();
            WaitUntil(() => receive.IsCompleted && cancel.IsCompleted, pump, "Cancelled inspection did not settle.");
            receive.GetAwaiter().GetResult();
            cancel.GetAwaiter().GetResult();
            Require(GetField(fixture.Window, "_receiving") is false, "Cancelled inspection kept receiving active.");
            Require(((TextBlock)fixture.Window.FindName("StatusText")).Text.Contains("before transfer started", StringComparison.Ordinal),
                "Cancel during inspection must stop the local continuation before start.");
            Require(((Border)fixture.Window.FindName("FailureBorder")).Visibility != Visibility.Visible,
                "Cancelled inspection reached the child's unexpected-start failure.");
            Require(!File.Exists(paths.StateFile), "Cancelled inspection must stop before persisting a receive or sending start.");
            Require(GetField(fixture.Window, "_pendingAccessCode") is null, "Cancelled inspection retained launch credentials.");
        }
        finally { if (Directory.Exists(root)) Directory.Delete(root, recursive: true); }
    }

    public static void RuntimeEventsRedactOptOutSecret(Action pump)
    {
        const string syntheticSecret = "public-synthetic-event-secret";
        using var fixture = new Fixture(pump);
        Invoke(fixture.Window, "SetReceiving", true);
        SetField(fixture.Window, "_pendingAccessCode", syntheticSecret);
        Require(((AccessCodeInput)fixture.Window.FindName("AccessCodeBox")).Password.Length == 0,
            "The event test must exercise an opt-out receive with no visible credential.");

        using var state = JsonDocument.Parse(JsonSerializer.Serialize(new
        {
            state = "receiving-" + syntheticSecret,
            message = "Synthetic state: " + syntheticSecret,
        }));
        ((Task)Invoke(fixture.Window, "HandleBridgeEventAsync",
            new BridgeEventArgs("public-fixture", "state", state.RootElement.Clone()))!).GetAwaiter().GetResult();
        var context = (DiagnosticContext)GetField(fixture.Window, "_diagnosticContext")!;
        Require(!((TextBlock)fixture.Window.FindName("StatusText")).Text.Contains(syntheticSecret, StringComparison.Ordinal) &&
                !context.Operation.Contains(syntheticSecret, StringComparison.Ordinal) &&
                !context.TransferState.Contains(syntheticSecret, StringComparison.Ordinal),
            "Runtime state event exposed a transient access code in UI or diagnostics.");

        using var progress = JsonDocument.Parse(JsonSerializer.Serialize(new
        {
            state = "downloading", message = "Synthetic progress: " + syntheticSecret, percent = 25,
        }));
        ((Task)Invoke(fixture.Window, "HandleBridgeEventAsync",
            new BridgeEventArgs("public-fixture", "progress", progress.RootElement.Clone()))!).GetAwaiter().GetResult();
        var status = ((TextBlock)fixture.Window.FindName("StatusText")).Text;
        var history = (DiagnosticHistory)GetField(fixture.Window, "_diagnosticHistory")!;
        Require(!status.Contains(syntheticSecret, StringComparison.Ordinal) &&
                !history.BuildCopyBundle((DiagnosticContext)GetField(fixture.Window, "_diagnosticContext")!)
                    .Contains(syntheticSecret, StringComparison.Ordinal),
            "Runtime progress event exposed a transient access code.");
        Require(status.Contains("[redacted]", StringComparison.Ordinal) &&
                ((System.Windows.Controls.ProgressBar)fixture.Window.FindName("ReceiveProgress")).Value == 25,
            "Runtime progress redaction must retain useful progress feedback.");
    }

    public static void FailedReceiveRedactsOptOutSecret(Action pump)
    {
        const string syntheticSecret = "public-synthetic-inspect-secret";
        var root = Path.Combine(Path.GetTempPath(), "tf-redact-" + Guid.NewGuid().ToString("N"));
        try
        {
            using var fixture = new Fixture(pump, rejectInspectionWithSecret: true);
            var paths = new LauncherUserPaths(Path.Combine(root, "projects"), Path.Combine(root, "state"), Path.Combine(root, "state.json"));
            SetField(fixture.Window, "_userPaths", paths);
            SetField(fixture.Window, "_stateStore", new LauncherStateStore(paths));
            SetField(fixture.Window, "_runtimeReady", true);
            ((TextBox)fixture.Window.FindName("InviteTextBox")).Text = "public synthetic inspection invite";
            ((TextBox)fixture.Window.FindName("DestinationTextBox")).Text = paths.DefaultProjectsRoot;
            ((CheckBox)fixture.Window.FindName("RememberCodeForRetriesCheckBox")).IsChecked = false;
            var input = (AccessCodeInput)fixture.Window.FindName("AccessCodeBox");
            input.Password = syntheticSecret;
            var receive = (Task)Invoke(fixture.Window, "ReceiveAsync")!;
            WaitUntil(() => receive.IsCompleted, pump, "Synthetic inspection rejection did not settle.");
            receive.GetAwaiter().GetResult();
            var details = ((TextBox)fixture.Window.FindName("DiagnosticsTextBox")).Text;
            var context = (DiagnosticContext)GetField(fixture.Window, "_diagnosticContext")!;
            var history = (DiagnosticHistory)GetField(fixture.Window, "_diagnosticHistory")!;
            var status = ((TextBlock)fixture.Window.FindName("StatusText")).Text;
            var failureCode = ((TextBlock)fixture.Window.FindName("FailureCodeText")).Text;
            Require(!details.Contains(syntheticSecret, StringComparison.Ordinal) &&
                    !status.Contains(syntheticSecret, StringComparison.Ordinal) &&
                    !failureCode.Contains(syntheticSecret, StringComparison.Ordinal) &&
                    !context.DetailedErrorMessage.Contains(syntheticSecret, StringComparison.Ordinal) &&
                    !context.ManagedRoot.Contains(syntheticSecret, StringComparison.Ordinal) &&
                    !context.Endpoint.Contains(syntheticSecret, StringComparison.Ordinal) &&
                    !history.BuildCopyBundle(context).Contains(syntheticSecret, StringComparison.Ordinal),
                "Failure UI, bridge diagnostic fields or copied bundle retained the opt-out access code.");
            Require(details.Contains("[redacted]", StringComparison.Ordinal) &&
                    status.Contains("[redacted]", StringComparison.Ordinal) &&
                    failureCode.Contains("[redacted]", StringComparison.Ordinal) &&
                    context.ManagedRoot.Contains("[redacted]", StringComparison.Ordinal),
                "Runtime error fields must be sanitized, not silently discarded.");
            Require(input.Password.Length == 0 && GetField(fixture.Window, "_pendingAccessCode") is null,
                "Failed receive must still retire transient credentials when retention is disabled.");
        }
        finally { if (Directory.Exists(root)) Directory.Delete(root, recursive: true); }
    }

    public static void ReplacedReceiveControls(Action pump)
    {
        foreach (var cancel in new[] { false, true })
        foreach (var reject in new[] { false, true })
        {
            using var fixture = new Fixture(pump, rejectControl: reject);
            SetField(fixture.Window, "_runtimeReady", true);
            Invoke(fixture.Window, "SetReceiving", true);
            var control = (Task)Invoke(fixture.Window, "SendReceiveControlAsync", cancel)!;
            fixture.WaitForShutdown();
            Invoke(fixture.Window, "SetReceiving", false);
            Invoke(fixture.Window, "SetReceiving", true);
            var status = (TextBlock)fixture.Window.FindName("StatusText");
            const string replacement = "Replacement receive is active.";
            status.Text = replacement;
            fixture.Release();
            WaitUntil(() => control.IsCompleted, pump, "Old receive control did not retire.");
            control.GetAwaiter().GetResult();
            Require(status.Text == replacement, "A previous receive ACK/error changed the new workflow.");
            Require(GetField(fixture.Window, "_paused") is false, "A previous pause resurrected old state.");
            Require(((Border)fixture.Window.FindName("FailureBorder")).Visibility != Visibility.Visible,
                "A previous control rejection reopened failure feedback.");
            Require(((Button)fixture.Window.FindName("PauseButton")).IsEnabled,
                "Old completion must not leave the new receive controls disabled.");
        }
    }

    public static void CancelDuringPause(Action pump)
    {
        using var fixture = new Fixture(pump);
        SetField(fixture.Window, "_runtimeReady", true);
        Invoke(fixture.Window, "SetReceiving", true);
        var pause = (Task)Invoke(fixture.Window, "SendReceiveControlAsync", false)!;
        fixture.WaitForShutdown();
        var cancel = (Task)Invoke(fixture.Window, "SendReceiveControlAsync", true)!;
        Require(PendingCount(fixture.Bridge) == 2, "Cancel must not wait for the held pause ACK.");
        using var message = JsonDocument.Parse("{}");
        ((Task)Invoke(fixture.Window, "HandleBridgeEventAsync",
            new BridgeEventArgs("public-fixture", "paused", message.RootElement.Clone()))!).GetAwaiter().GetResult();
        Require(GetField(fixture.Window, "_paused") is false, "Late pause event must not replace cancellation.");
        fixture.Release();
        WaitUntil(() => pause.IsCompleted && cancel.IsCompleted, pump, "Receive controls did not settle.");
        pause.GetAwaiter().GetResult();
        cancel.GetAwaiter().GetResult();
        Require(GetField(fixture.Window, "_paused") is false, "Late pause ACK must not restore pause during cancellation.");
        Require(!((Button)fixture.Window.FindName("PauseButton")).IsEnabled,
            "An acknowledged cancellation cannot offer Resume while receiving retires.");
        Require(((TextBlock)fixture.Window.FindName("StatusText")).Text.Contains("cancelled", StringComparison.Ordinal),
            "Cancellation feedback was lost to the old pause.");
    }

    public static void QueuedReceiveProgress(Action pump)
    {
        using var fixture = new Fixture(pump);
        Invoke(fixture.Window, "SetReceiving", true);
        using var message = JsonDocument.Parse("""{"state":"Downloading","percent":80}""");
        Invoke(fixture.Window, "Bridge_EventReceived", fixture.Bridge,
            new BridgeEventArgs("public-fixture", "progress", message.RootElement.Clone()));
        Invoke(fixture.Window, "SetReceiving", false);
        Invoke(fixture.Window, "SetReceiving", true);
        var status = (TextBlock)fixture.Window.FindName("StatusText");
        const string replacement = "New receive owns the status.";
        status.Text = replacement;
        pump();
        Require(status.Text == replacement, "A queued previous receive event overwrote the replacement.");
        Require(((ProgressBar)fixture.Window.FindName("ReceiveProgress")).IsIndeterminate,
            "Stale byte progress changed the replacement's indicator.");
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

        public Fixture(Action pump, bool ignoreShutdown = false, bool holdHealth = false, bool rejectControl = false, bool holdInspection = false, bool rejectInspectionWithSecret = false)
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
                         prefix + ".release", ignoreShutdown ? "ignore" : holdHealth ? "hold-health" : rejectControl ? "reject-control"
                             : holdInspection ? "hold-inspection" : rejectInspectionWithSecret ? "reject-inspection-secret" : "gate" }) info.ArgumentList.Add(arg);
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

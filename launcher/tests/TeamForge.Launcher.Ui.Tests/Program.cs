using System.Reflection;
using System.Text.Json;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Threading;
using TeamForge.Launcher;
using TeamForge.Launcher.Core;

internal static class Program
{
    // Deliberately public fake input. Tests never use live credentials or invoke
    // MainWindow's production runtime startup, transfer, clipboard or state saving.
    // Shutdown cases use the actual BridgeClient with a public synthetic child.
    private const string SampleCode = "sample-code-for-ui-regression";
    private static readonly List<Exception> CallbackFailures = new();

    [STAThread]
    public static int Main(string[] args)
    {
        if (args.Length > 0 && args[0] == "--shutdown-fixture")
        {
            return ShutdownTests.RunChild(args);
        }
        if (args.Length > 0 && args[0] == "--unity-version-fixture")
        {
            return UnityLaunchTests.RunVersionChild(args);
        }
        if (args.Length > 0 && args[0] == "--preview-fixture") return PreviewTests.RunChild(args);

        var app = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
        SynchronizationContext.SetSynchronizationContext(
            new DispatcherSynchronizationContext(Dispatcher.CurrentDispatcher));
        app.DispatcherUnhandledException += (_, args) =>
        {
            CallbackFailures.Add(args.Exception);
            args.Handled = true; // Keep reporting; a callback exception still fails the case.
        };
        var tests = new (string Name, Action Run)[]
        {
            ("code is masked by default with no hidden cleartext copy", DefaultMasked),
            ("explicit reveal and visible edit update the masked input", RevealAndEdit),
            ("hide retires cleartext without erasing retry input", HideRetainsPassword),
            ("masked replacement never resurrects the old revealed value", ReplaceAfterHide),
            ("explicit clear wipes both views and resets visibility", ClearBothViews),
            ("disabled input hides and refuses a programmatic reveal", DisabledInput),
            ("hidden advanced content retires the cleartext view", HiddenInput),
            ("window deactivation masks but preserves retry input", DeactivatedWindow),
            ("unloading clears and detaches the previous window", UnloadAndReattach),
            ("closing the owning window retires the input", CloseWindow),
            ("input length ceiling rejects overlong replacement", BoundedInput),
            ("MainWindow same-invite working-copy retirement keeps selected retry input", MainWindowRetainsRetry),
            ("MainWindow retention opt-out clears pending and input copies", MainWindowOptOut),
            ("MainWindow changing invite forgets the previous credential", MainWindowChangesInvite),
            ("MainWindow shutdown forgets pending and input copies", MainWindowShutdown),
            ("receive verification remains visibly busy after all bytes arrive", MainWindowProgress),
            ("late progress preserves paused feedback until resume", MainWindowPausedProgress),
            ("late pause and resume acknowledgements preserve confirmed runtime events", () => ShutdownTests.PauseAcknowledgement(Pump)),
            ("duplicate receive controls send one pending command", () => ShutdownTests.DuplicateReceiveControls(Pump)),
            ("old receive controls cannot change a replacement workflow", () => ShutdownTests.ReplacedReceiveControls(Pump)),
            ("cancel remains available and dominates late pause events and ACKs", () => ShutdownTests.CancelDuringPause(Pump)),
            ("queued progress belongs to its original receive lifetime", () => ShutdownTests.QueuedReceiveProgress(Pump)),
            ("retired receive events cannot expose a discarded code", () => ShutdownTests.RetiredReceiveEventsCannotEchoCode(Pump)),
            ("cancel during invite inspection never starts a transfer", () => ShutdownTests.CancelDuringInspection(Pump)),
            ("cancel rejection and late diagnostic never echo retired code", () => ShutdownTests.CancelRejectionRedactsRetiredCode(Pump)),
            ("late receive error after cancel never echoes retired code", () => ShutdownTests.CancelledReceiveErrorDoesNotEchoRetiredCode(Pump)),
            ("late trust ACK after cancel never echoes retired code", () => ShutdownTests.TrustAckAfterCancelCannotEchoRetiredCode(Pump)),
            ("old trust ACK cannot block a replacement receive trust challenge", () => ShutdownTests.ReplacementTrustChallengeWhileOldAckPending(Pump)),
            ("failed receive redacts a non-retained code before retiring it", () => ShutdownTests.FailedReceiveRedactsOptOutSecret(Pump)),
            ("runtime state and progress redact transient access codes", () => ShutdownTests.RuntimeEventsRedactOptOutSecret(Pump)),
            ("repeated Close waits for real bridge cleanup", () => ShutdownTests.RepeatedClose(Pump)),
            ("shutdown cancels pending requests and disables new input", () => ShutdownTests.PendingRequestAndInput(Pump)),
            ("queued bridge work cannot reopen a closing workflow", () => ShutdownTests.QueuedEvents(Pump)),
            ("unresponsive bridge is terminated before the window closes", () => ShutdownTests.UnresponsiveChild(Pump)),
            ("late runtime verification cannot start a child after close", () => ShutdownTests.CloseDuringVerification(Pump)),
            ("close during startup health is handled without becoming ready", () => ShutdownTests.CloseDuringHealth(Pump)),
            ("healthy startup still reaches the ready UI", () => ShutdownTests.HealthyStartup(Pump)),
            ("rejected bridge envelopes never retain pending requests", () => ShutdownTests.RejectedEnvelopes(Pump)),
            ("healthy preview publishes once and suppresses duplicate input", () => PreviewTests.Healthy(Pump)),
            ("current inspection validation publishes its recovery project", () => PreviewTests.CurrentValidation(Pump)),
            ("invite replacement fences an already completed old preview", () => PreviewTests.ReplacedInvite(Pump, false)),
            ("invite replacement fences an already completed old preview failure", () => PreviewTests.ReplacedInvite(Pump, true)),
            ("destination replacement fences preview results", () => PreviewTests.ReplacedDestination(Pump)),
            ("late inspection validation cannot overwrite or retire a newer preview", () => PreviewTests.LateValidation(Pump, false)),
            ("late inspection validation failure preserves a newer preview", () => PreviewTests.LateValidation(Pump, true)),
            ("receive start retires pending preview work", () => PreviewTests.ReceiveStarts(Pump)),
            ("closing retires late preview validation", () => PreviewTests.CloseDuringValidation(Pump)),
            ("current preview rejection remains actionable", () => PreviewTests.CurrentFailure(Pump)),
            ("healthy Active handoff retires transient auth after one start", () => UnityLaunchTests.HealthyActive(Pump)),
            ("healthy completed receive opens verified Unity once", () => UnityLaunchTests.ReceiveCompletion(Pump, false)),
            ("late receive cancellation preserves Active for manual opening", () => UnityLaunchTests.ReceiveCompletion(Pump, true)),
            ("closing final receive validation cannot publish or launch", () => UnityLaunchTests.CloseDuringReceiveCompletion(Pump)),
            ("invite replacement fences late Active validation", () => UnityLaunchTests.InviteDuringValidation(Pump)),
            ("close cancels and waits for Unity operation cleanup", () => UnityLaunchTests.CloseDuringValidation(Pump)),
            ("invite replacement fences a late Editor probe", () => UnityLaunchTests.InviteDuringProbe(Pump)),
            ("cancel after refresh retires only the unused handoff", () => UnityLaunchTests.InviteAfterRefresh(Pump)),
            ("late path preparation cannot open the previous context", () => UnityLaunchTests.InviteDuringPathPreparation(Pump)),
            ("repeated open starts only one Unity pipeline", () => UnityLaunchTests.DuplicateOpen(Pump)),
            ("late launch failure preserves the newer ready context", () => UnityLaunchTests.LateFailure(Pump)),
            ("Unity validation failure redacts the transient code", () => UnityLaunchTests.LaunchFailureRedactsWorkingCode(Pump, false)),
            ("Unity post-refresh failure redacts and cleans its handoff", () => UnityLaunchTests.LaunchFailureRedactsWorkingCode(Pump, true)),
            ("Existing Active opens without realtime auth or handoff", () => UnityLaunchTests.ExistingActive(Pump, false)),
            ("Existing Active replacement fences late path work", () => UnityLaunchTests.ExistingActive(Pump, true)),
            ("exact Editor selection publishes in its current context", () => UnityLaunchTests.EditorSelection(Pump, false)),
            ("late Editor selection cannot change a replacement context", () => UnityLaunchTests.EditorSelection(Pump, true)),
            ("cancelled Editor probe terminates its owned child", () => UnityLaunchTests.CancelledProbeChild(Pump)),
            ("close waits for unused handoff cleanup before finishing", () => UnityLaunchTests.CloseDuringPathPreparation(Pump)),
        };
        var failures = 0;
        try
        {
            foreach (var test in tests)
            {
                try
                {
                    CallbackFailures.Clear();
                    test.Run();
                    Pump();
                    Console.WriteLine($"PASS {test.Name}");
                }
                catch (Exception exception)
                {
                    failures++;
                    // Assertions intentionally do not print input contents.
                    Console.WriteLine($"FAIL {test.Name}: {exception.GetType().Name}: {exception.Message}");
                }
            }
            Console.WriteLine($"RESULT {tests.Length - failures}/{tests.Length} passed");
            return failures == 0 ? 0 : 1;
        }
        finally
        {
            app.Shutdown();
        }
    }

    private static void DefaultMasked()
    {
        using var host = new InputWindow();
        host.Input.Password = SampleCode;
        RequireMasked(host.Input);
        Require(Element<Button>(host.Input, "ClearCodeButton").IsEnabled, "Clear should be available for nonempty input.");
        host.Input.Clear();
        Require(!Element<Button>(host.Input, "ClearCodeButton").IsEnabled, "Clear should be disabled for empty input.");
    }

    private static void RevealAndEdit()
    {
        using var host = new InputWindow();
        Reveal(host.Input);
        var text = Element<TextBox>(host.Input, "RevealedCodeBox");
        Require(text.Text == SampleCode && text.IsVisible, "Explicit reveal should display the current input.");
        Require(!Element<PasswordBox>(host.Input, "MaskedCodeBox").IsVisible, "Masked view must not overlap revealed view.");
        text.Text = "replacement-ui-test-code";
        Require(host.Input.Password == text.Text, "Visible edit must update the credential used for receiving.");
        Require(AutomationProperties.GetName(Element<ToggleButton>(host.Input, "RevealCodeButton")) == "Hide access code",
            "The accessible toggle label must describe its current action.");
    }

    private static void HideRetainsPassword()
    {
        using var host = new InputWindow();
        Reveal(host.Input);
        Element<ToggleButton>(host.Input, "RevealCodeButton").IsChecked = false;
        RequireMasked(host.Input);
        Require(host.Input.Password == SampleCode, "Clearing the hidden text view must not erase retry input.");
        Reveal(host.Input);
        host.Input.Hide();
        RequireMasked(host.Input);
        Require(host.Input.Password == SampleCode, "Direct hide must preserve masked input.");
    }

    private static void ReplaceAfterHide()
    {
        using var host = new InputWindow();
        Reveal(host.Input);
        host.Input.Hide();
        host.Input.Password = "replacement-ui-test-code";
        RequireMasked(host.Input);
        Element<ToggleButton>(host.Input, "RevealCodeButton").IsChecked = true;
        Require(Element<TextBox>(host.Input, "RevealedCodeBox").Text == "replacement-ui-test-code",
            "Reveal must use the new input, not a retired view.");
    }

    private static void ClearBothViews()
    {
        using var host = new InputWindow();
        Reveal(host.Input);
        Element<Button>(host.Input, "ClearCodeButton").RaiseEvent(new RoutedEventArgs(ButtonBase.ClickEvent));
        Require(host.Input.Password.Length == 0, "Clear button must retire masked input.");
        RequireMasked(host.Input);
        Element<ToggleButton>(host.Input, "RevealCodeButton").IsChecked = true;
        Require(Element<TextBox>(host.Input, "RevealedCodeBox").Text.Length == 0, "Old value must not reappear after clear.");
        host.Input.Clear();
        RequireMasked(host.Input);
    }

    private static void DisabledInput()
    {
        using var host = new InputWindow();
        Reveal(host.Input);
        host.Input.IsEnabled = false;
        RequireMasked(host.Input);
        Require(host.Input.Password == SampleCode, "Receive-time disabling must preserve selected retry input.");
        Element<ToggleButton>(host.Input, "RevealCodeButton").IsChecked = true;
        RequireMasked(host.Input);
        host.Input.IsEnabled = true;
        RequireMasked(host.Input);
    }

    private static void HiddenInput()
    {
        using var host = new InputWindow();
        Reveal(host.Input);
        host.Input.Visibility = Visibility.Collapsed;
        Pump();
        RequireMasked(host.Input);
        Require(host.Input.Password == SampleCode, "Collapsing advanced details must not forget retained input.");
        host.Input.Visibility = Visibility.Visible;
        Pump();
        RequireMasked(host.Input);
    }

    private static void DeactivatedWindow()
    {
        using var host = new InputWindow();
        Reveal(host.Input);
        Deactivate(host.Window);
        RequireMasked(host.Input);
        Require(host.Input.Password == SampleCode, "Switching windows must preserve masked retry input.");
    }

    private static void UnloadAndReattach()
    {
        using var original = new InputWindow();
        Reveal(original.Input);
        original.Window.Content = null;
        Pump();
        Require(original.Input.Password.Length == 0 && !original.Input.IsLoaded, "Unloading must retire input.");
        RequireMasked(original.Input);
        using var current = new InputWindow(original.Input);
        Reveal(current.Input);
        Deactivate(original.Window);
        Require(Element<ToggleButton>(current.Input, "RevealCodeButton").IsChecked == true,
            "An old detached window must not affect a reused input.");
        Deactivate(current.Window);
        RequireMasked(current.Input);
    }

    private static void CloseWindow()
    {
        using var host = new InputWindow();
        Reveal(host.Input);
        host.Window.Close();
        Pump();
        Require(host.Input.Password.Length == 0, "Window close must retire masked input.");
        RequireMasked(host.Input);
    }

    private static void BoundedInput()
    {
        using var host = new InputWindow();
        Require(Element<PasswordBox>(host.Input, "MaskedCodeBox").MaxLength == 8192, "Masked length bound changed.");
        Require(Element<TextBox>(host.Input, "RevealedCodeBox").MaxLength == 8192, "Revealed length bound changed.");
        host.Input.Password = new string('a', 8192);
        try
        {
            host.Input.Password = new string('a', 8193);
            throw new InvalidOperationException("Overlong replacement was accepted.");
        }
        catch (ArgumentOutOfRangeException)
        {
            Require(host.Input.Password.Length == 8192, "Rejected replacement must preserve valid prior input.");
            RequireMasked(host.Input);
        }
    }

    private static void MainWindowRetainsRetry()
    {
        WithMainWindow(window =>
        {
            var input = SeedMainWindow(window);
            Invoke(window, "ClearPendingAccessCode", false);
            Require(PendingCode(window) is null, "Bridge working copy should be retired.");
            Require(input.Password == SampleCode, "Selected session retry input should remain available.");
            RequireMasked(input);
        });
    }

    private static void MainWindowOptOut()
    {
        WithMainWindow(window =>
        {
            var input = SeedMainWindow(window);
            ((CheckBox)window.FindName("RememberCodeForRetriesCheckBox")).IsChecked = false;
            Require(input.Password.Length == 0 && PendingCode(window) is null, "Opt-out must retire all credential copies.");
            RequireMasked(input);
        });
    }

    private static void MainWindowChangesInvite()
    {
        WithMainWindow(window =>
        {
            var input = SeedMainWindow(window);
            ((TextBox)window.FindName("InviteTextBox")).Text = "changed-placeholder-invite";
            Require(input.Password.Length == 0 && PendingCode(window) is null, "Invite edit must forget old credentials.");
            RequireMasked(input);
        });
    }

    private static void MainWindowShutdown()
    {
        WithMainWindow(window =>
        {
            var input = SeedMainWindow(window);
            window.Close();
            Pump();
            Require(input.Password.Length == 0 && PendingCode(window) is null, "Shutdown must retire credential copies.");
            RequireMasked(input);
        });
    }

    private static void MainWindowProgress()
    {
        WithMainWindow(window =>
        {
            PresentEvent(window, "progress", """{"state":"Downloading","completedBytes":25,"totalBytes":100}""");
            var progress = (ProgressBar)window.FindName("ReceiveProgress");
            var status = (TextBlock)window.FindName("StatusText");
            Require(!progress.IsIndeterminate && progress.Value == 25, "Byte progress should display its bounded percentage.");
            PresentEvent(window, "progress", """{"state":"Verifying","completedBytes":100,"totalBytes":100}""");
            Require(progress.IsIndeterminate, "Receiving all bytes must not imply verification has finished.");
            Require(status.Text.Contains("Verifying", StringComparison.Ordinal), "Verification needs actionable visible feedback.");
            var context = (DiagnosticContext)typeof(MainWindow).GetField("_diagnosticContext",
                BindingFlags.Instance | BindingFlags.NonPublic)!.GetValue(window)!;
            Require(context.TransferState == "verifying", "Support diagnostics must retain the actual phase.");
            PresentEvent(window, "progress", """{"percent":"NaN"}""");
            Require(progress.IsIndeterminate && double.IsFinite(progress.Value), "Non-finite progress must not enter WPF controls.");
        });
    }

    private static void MainWindowPausedProgress()
    {
        WithMainWindow(window =>
        {
            PresentEvent(window, "paused", "{}");
            var status = (TextBlock)window.FindName("StatusText");
            var paused = status.Text;
            PresentEvent(window, "progress", """{"state":"Downloading","percent":80}""");
            Require(status.Text == paused, "Queued progress must not erase the confirmed paused state.");
            var context = (DiagnosticContext)typeof(MainWindow).GetField("_diagnosticContext",
                BindingFlags.Instance | BindingFlags.NonPublic)!.GetValue(window)!;
            Require(context.TransferState == "paused", "Paused diagnostics must not regress to receiving.");
            PresentEvent(window, "resumed", "{}");
            PresentEvent(window, "progress", """{"state":"Downloading","percent":90}""");
            var progress = (ProgressBar)window.FindName("ReceiveProgress");
            Require(!progress.IsIndeterminate && progress.Value == 90, "Resume should accept fresh progress again.");
        });
    }

    private static void PresentEvent(MainWindow window, string name, string json)
    {
        using var document = JsonDocument.Parse(json);
        var task = (Task)typeof(MainWindow).GetMethod("HandleBridgeEventAsync",
            BindingFlags.Instance | BindingFlags.NonPublic)!.Invoke(window,
            new object[] { new BridgeEventArgs("public-fixture", name, document.RootElement.Clone()) })!;
        Require(task.IsCompleted, "Progress/state presentation must not wait on asynchronous work.");
        task.GetAwaiter().GetResult();
    }

    private static void WithMainWindow(Action<MainWindow> test)
    {
        // Do not Show: runtime verification/bridge startup is independently
        // covered; these cases execute the real UI's cleanup handlers only.
        var window = new MainWindow();
        try { test(window); }
        finally
        {
            // Teardown does not test closing twice. The dedicated shutdown case
            // exercises the real first Close, including async-void callbacks.
            typeof(MainWindow).GetField("_closingAfterCleanup", BindingFlags.Instance | BindingFlags.NonPublic)!.SetValue(window, true);
            ((AccessCodeInput)window.FindName("AccessCodeBox")).Clear();
            window.Close();
            Pump();
        }
    }

    private static AccessCodeInput SeedMainWindow(MainWindow window)
    {
        var input = (AccessCodeInput)window.FindName("AccessCodeBox");
        ((CheckBox)window.FindName("RememberCodeForRetriesCheckBox")).IsChecked = true;
        input.Password = SampleCode;
        typeof(MainWindow).GetField("_pendingAccessCode", BindingFlags.Instance | BindingFlags.NonPublic)!.SetValue(window, SampleCode);
        return input;
    }

    private static object? PendingCode(MainWindow window) =>
        typeof(MainWindow).GetField("_pendingAccessCode", BindingFlags.Instance | BindingFlags.NonPublic)!.GetValue(window);

    private static void Invoke(MainWindow window, string method, params object[] args) =>
        typeof(MainWindow).GetMethod(method, BindingFlags.Instance | BindingFlags.NonPublic)!.Invoke(window, args);

    private static void Deactivate(Window window) =>
        typeof(Window).GetMethod("OnDeactivated", BindingFlags.Instance | BindingFlags.NonPublic)!.Invoke(window, new object[] { EventArgs.Empty });

    private static void Reveal(AccessCodeInput input)
    {
        input.Password = SampleCode;
        Element<ToggleButton>(input, "RevealCodeButton").IsChecked = true;
        Require(Element<TextBox>(input, "RevealedCodeBox").Visibility == Visibility.Visible,
            "Explicit Show must reveal loaded, enabled input.");
    }

    private static void RequireMasked(AccessCodeInput input)
    {
        Require(Element<ToggleButton>(input, "RevealCodeButton").IsChecked == false, "Input should be masked.");
        Require(Element<TextBox>(input, "RevealedCodeBox").Text.Length == 0, "Hidden view must not retain cleartext.");
        Require(Element<TextBox>(input, "RevealedCodeBox").Visibility == Visibility.Collapsed, "Revealed view must be hidden.");
        Require(Element<PasswordBox>(input, "MaskedCodeBox").Visibility == Visibility.Visible, "Masked view must be available.");
    }

    private static T Element<T>(AccessCodeInput input, string name) where T : FrameworkElement =>
        input.FindName(name) as T ?? throw new InvalidOperationException($"Missing input element: {name}");

    private static void Require(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException(message);
    }

    private static void Pump()
    {
        Dispatcher.CurrentDispatcher.Invoke(() => { }, DispatcherPriority.ApplicationIdle);
        if (CallbackFailures.Count > 0)
        {
            var exception = CallbackFailures[0];
            CallbackFailures.Clear();
            throw new InvalidOperationException($"Unhandled WPF callback: {exception.GetType().Name}: {exception.Message}");
        }
    }

    private sealed class InputWindow : IDisposable
    {
        public AccessCodeInput Input { get; }
        public Window Window { get; }

        public InputWindow(AccessCodeInput? input = null)
        {
            Input = input ?? new AccessCodeInput();
            Window = new Window { Content = Input, Width = 520, Height = 130,
                ShowInTaskbar = false, Title = "TeamForge access-code UI regression" };
            Window.Show();
            Pump();
            Require(Input.IsLoaded && Input.IsVisible, "Native WPF input must load; do not skip missing UI setup.");
        }

        public void Dispose()
        {
            Window.Close();
            Pump();
        }
    }
}

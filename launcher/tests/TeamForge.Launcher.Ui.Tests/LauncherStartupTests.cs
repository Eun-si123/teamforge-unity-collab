using System.Diagnostics;
using System.Reflection;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Threading;
using TeamForge.Launcher;
using TeamForge.Launcher.Core;

internal static class LauncherStartupTests
{
    private const string ChildModeVariable = "TEAMFORGE_STARTUP_TEST_MODE";
    private const string ChildScopeVariable = "TEAMFORGE_STARTUP_TEST_SCOPE";
    internal static bool IsAppChild => Environment.GetEnvironmentVariable(ChildModeVariable) is not null;

    internal static void ClosingSplashCancelsAppStartup() => RunIsolatedApp("cancel");
    internal static void AppPromotionAndDuplicateActivation() => RunIsolatedApp("promote");

    internal static int RunAppChild(string[] args)
    {
        try
        {
            Require(args.Length == 0, "The actual App must receive no fixture arguments.");
            var mode = Environment.GetEnvironmentVariable(ChildModeVariable);
            var scope = Environment.GetEnvironmentVariable(ChildScopeVariable);
            Require(mode is "cancel" or "promote", "Unknown startup fixture mode.");
            Require(!string.IsNullOrEmpty(scope), "Startup fixture scope is missing.");
            Environment.SetEnvironmentVariable(ChildModeVariable, null);
            Environment.SetEnvironmentVariable(ChildScopeVariable, null);
            return RunAppFixture(mode!, scope!);
        }
        catch (Exception exception)
        {
            // Never print a process environment, user state or exception paths.
            Console.WriteLine(JsonSerializer.Serialize(new { failed = true, exception = exception.GetType().Name }));
            return 1;
        }
    }

    private static void RunIsolatedApp(string mode)
    {
        var scope = "Ui-" + Guid.NewGuid().ToString("N");
        using var signals = new StartupSignals(scope, create: true);
        var info = new ProcessStartInfo(Environment.ProcessPath!)
        {
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
        };
        EnvironmentPolicy.Scrub(info.Environment);
        info.Environment[ChildModeVariable] = mode;
        info.Environment[ChildScopeVariable] = scope;
        // No ArgumentList entries: WPF reads the real process command line.
        using var process = Process.Start(info)
            ?? throw new InvalidOperationException("Startup App fixture did not start.");
        var output = process.StandardOutput.ReadToEndAsync();
        var error = process.StandardError.ReadToEndAsync();
        try
        {
            Require(signals.Ready.WaitOne(TimeSpan.FromSeconds(10)), "Actual App startup was not observed.");
            using (var duplicate = new LauncherInstanceGate(scope))
            {
                Require(!duplicate.TryAcquire(), "A duplicate process acquired the running App's mutex.");
                duplicate.RequestActivation();
                if (mode == "promote")
                    Require(signals.Restored.WaitOne(TimeSpan.FromSeconds(8)),
                        "The actual App did not restore its minimized window after a duplicate signal.");
                signals.Proceed.Set();
                Require(signals.Released.WaitOne(TimeSpan.FromSeconds(10)), "App exit did not reach owned-gate cleanup.");
                Require(!process.HasExited, "The fixture must remain alive while normal mutex disposal is checked.");
                Require(duplicate.TryAcquire(), "App.OnExit did not release ownership before process termination.");
            }
            signals.Finish.Set();
            Require(process.WaitForExit(8000), "Actual App did not finish exiting.");
            Require(Task.WaitAll(new Task[] { output, error }, TimeSpan.FromSeconds(3)),
                "Startup child output did not close after exit.");
            Require(process.ExitCode == 0, "Actual App startup fixture reported failure.");
            Require(string.IsNullOrWhiteSpace(error.GetAwaiter().GetResult()), "Startup child wrote unexpected error output.");
            using var result = JsonDocument.Parse(output.GetAwaiter().GetResult());
            var summary = result.RootElement;
            Require(summary.GetProperty("mode").GetString() == mode, "Startup evidence has the wrong fixture mode.");
            Require(summary.GetProperty("callbackFailures").GetInt32() == 0, "A WPF callback failed during startup.");
            Require(summary.GetProperty("created").GetInt32() == (mode == "cancel" ? 0 : 1),
                "The actual App created an unexpected number of main windows.");
            Require(summary.GetProperty("observed").GetBoolean(), "The intended App lifecycle was not exercised.");
        }
        finally
        {
            signals.Proceed.Set();
            signals.Finish.Set();
            if (!process.HasExited)
            {
                process.Kill(entireProcessTree: true);
                Require(process.WaitForExit(8000), "Owned startup fixture could not be terminated.");
            }
        }
    }

    private static int RunAppFixture(string mode, string scope)
    {
        using var signals = new StartupSignals(scope, create: false);
        var created = 0;
        var callbackFailures = 0;
        var observed = false;
        var exitHandshakeFailed = false;
        RegisteredWaitHandle? closeListener = null;
        App app = null!;
        app = new App(scope, () =>
        {
            created++;
            // A real App owns these ordinary WPF windows. Never construct the
            // production MainWindow, verify a Runtime or read user settings.
            var window = new Window
            {
                Title = "TeamForge isolated startup fixture",
                Width = 320,
                Height = 180,
                ShowInTaskbar = false,
                Content = new TextBlock { Text = "Isolated startup lifecycle test" },
            };
            if (mode == "cancel")
            {
                // A broken cancellation path must fail promptly, not leave a
                // displayed test window or start the production Runtime.
                window.Loaded += (_, _) => app.Shutdown(71);
            }
            else
            {
                var waitingForActivation = false;
                var promotionObserved = false;
                window.StateChanged += (_, _) =>
                {
                    if (waitingForActivation && window.WindowState == WindowState.Normal)
                    {
                        observed = true;
                        signals.Restored.Set();
                    }
                };
                window.ContentRendered += (_, _) =>
                {
                    if (promotionObserved) return;
                    promotionObserved = true;
                    Require(ReferenceEquals(app.MainWindow, window), "Main-window promotion did not publish the current window.");
                    Require(!app.Windows.OfType<LauncherStartupWindow>().Any(), "Normal promotion did not retire the splash.");
                    window.WindowState = WindowState.Minimized;
                    Require(window.WindowState == WindowState.Minimized, "The fixture must start its activation check minimized.");
                    waitingForActivation = true;
                    closeListener = ThreadPool.RegisterWaitForSingleObject(signals.Proceed, (_, timedOut) =>
                    {
                        if (!timedOut)
                            _ = app.Dispatcher.BeginInvoke(new Action(window.Close), DispatcherPriority.Background);
                    }, null, Timeout.Infinite, executeOnlyOnce: true);
                    signals.Ready.Set();
                };
            }
            return window;
        });
        app.InitializeComponent();
        SynchronizationContext.SetSynchronizationContext(new DispatcherSynchronizationContext(app.Dispatcher));
        app.DispatcherUnhandledException += (_, args) =>
        {
            callbackFailures++;
            args.Handled = true; // The evidence and exit code still fail.
            app.Shutdown(70);
        };
        if (mode == "cancel")
        {
            app.Startup += (_, _) =>
            {
                _ = app.Dispatcher.BeginInvoke(new Action(() =>
                {
                    var splash = app.MainWindow as LauncherStartupWindow
                        ?? throw new InvalidOperationException("The actual startup splash was not displayed.");
                    Require(splash.IsVisible && splash.IsLoaded, "The native splash must be loaded before it is closed.");
                    signals.Ready.Set();
                    Require(signals.Proceed.WaitOne(TimeSpan.FromSeconds(10)), "Parent did not release the cancellation fixture.");
                    splash.Close();
                    // A previously queued activation can run before dispatcher
                    // shutdown begins. Exercise the real callback at that point.
                    typeof(App).GetMethod("ActivateRunningWindow", BindingFlags.Instance | BindingFlags.NonPublic)!
                        .Invoke(app, null);
                    observed = true;
                }), DispatcherPriority.Input);
            };
        }
        app.Exit += (_, args) =>
        {
            // App.OnExit disposes the real gate before raising this event.
            // Keep the process alive so the parent cannot mistake abandonment
            // on process death for normal mutex release.
            signals.Released.Set();
            if (!signals.Finish.WaitOne(TimeSpan.FromSeconds(10)))
            {
                exitHandshakeFailed = true;
                args.ApplicationExitCode = 73;
            }
        };
        var watchdog = new DispatcherTimer(DispatcherPriority.Send, app.Dispatcher)
        {
            Interval = TimeSpan.FromSeconds(25),
        };
        watchdog.Tick += (_, _) => app.Shutdown(72);
        watchdog.Start();
        int exitCode;
        try { exitCode = app.Run(); }
        finally
        {
            watchdog.Stop();
            closeListener?.Unregister(null);
        }
        Console.WriteLine(JsonSerializer.Serialize(new { mode, created, callbackFailures, observed }));
        return exitCode == 0 && callbackFailures == 0 && observed && !exitHandshakeFailed
            && created == (mode == "cancel" ? 0 : 1) ? 0 : 1;
    }

    private sealed class StartupSignals : IDisposable
    {
        private readonly Dictionary<string, EventWaitHandle> _handles = new();
        internal EventWaitHandle Ready => _handles["ready"];
        internal EventWaitHandle Proceed => _handles["proceed"];
        internal EventWaitHandle Restored => _handles["restored"];
        internal EventWaitHandle Released => _handles["released"];
        internal EventWaitHandle Finish => _handles["finish"];

        internal StartupSignals(string scope, bool create)
        {
            try
            {
                foreach (var suffix in new[] { "ready", "proceed", "restored", "released", "finish" })
                {
                    var name = @"Local\TeamForge.Startup.Tests." + scope + "." + suffix;
                    _handles.Add(suffix, create
                        ? new EventWaitHandle(false, EventResetMode.ManualReset, name)
                        : EventWaitHandle.OpenExisting(name));
                }
            }
            catch { Dispose(); throw; }
        }

        public void Dispose()
        {
            foreach (var handle in _handles.Values) handle.Dispose();
        }
    }

    internal static void DuplicateLaunchNotifiesOwner()
    {
        var scope = "Ui-" + Guid.NewGuid().ToString("N");
        using var owner = new LauncherInstanceGate(scope);
        Require(owner.TryAcquire(), "First Launcher did not take the instance mutex.");

        // A second *thread* is essential: mutexes are recursive on the owning
        // thread, whereas a real second process runs on another thread.
        var duplicateOwned = Task.Run(() =>
        {
            using var duplicate = new LauncherInstanceGate(scope);
            var acquired = duplicate.TryAcquire();
            if (!acquired) duplicate.RequestActivation();
            return acquired;
        }).GetAwaiter().GetResult();
        Require(!duplicateOwned, "The second Launcher must not acquire the first instance's mutex.");

        // The notification preceded listener registration, as can happen on
        // a slow PC while the first application is still loading WPF.
        var notifications = 0;
        owner.ListenForActivation(() => Interlocked.Increment(ref notifications));
        Require(SpinWait.SpinUntil(() => Volatile.Read(ref notifications) == 1, TimeSpan.FromSeconds(3)),
            "A fast duplicate launch must notify even before the splash appears.");
    }

    internal static void RunningWindowCanBeReactivated()
    {
        var scope = "Ui-" + Guid.NewGuid().ToString("N");
        using var owner = new LauncherInstanceGate(scope);
        Require(owner.TryAcquire(), "First Launcher must acquire ownership.");
        var notifications = 0;
        owner.ListenForActivation(() => Interlocked.Increment(ref notifications));
        var acquired = Task.Run(() =>
        {
            using var duplicate = new LauncherInstanceGate(scope);
            var result = duplicate.TryAcquire();
            if (!result) duplicate.RequestActivation();
            return result;
        }).GetAwaiter().GetResult();
        Require(!acquired, "Duplicate Launcher obtained ownership.");
        Require(SpinWait.SpinUntil(() => Volatile.Read(ref notifications) >= 1, TimeSpan.FromSeconds(3)),
            "An already-running window did not receive the activation signal.");
    }

    internal static void ExitingReleasesOwnership()
    {
        var scope = "Ui-" + Guid.NewGuid().ToString("N");
        using (var first = new LauncherInstanceGate(scope))
        {
            Require(first.TryAcquire(), "First Launcher must acquire ownership.");
        }
        using var restarted = new LauncherInstanceGate(scope);
        Require(restarted.TryAcquire(), "Launcher restart must work after a clean exit.");
    }

    internal static void SplashIsIndeterminate()
    {
        var splash = new LauncherStartupWindow();
        try
        {
            Require(splash.Title.Contains("TeamForge", StringComparison.Ordinal),
                "Splash must identify TeamForge.");
            var content = ((Border)splash.Content).Child as StackPanel
                ?? throw new InvalidOperationException("Splash content missing.");
            var progress = content.Children.OfType<ProgressBar>().Single();
            Require(progress.IsIndeterminate,
                "Startup must never manufacture a percentage for unknown runtime loading.");
        }
        finally { splash.Close(); }
    }

    private static void Require(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException(message);
    }
}

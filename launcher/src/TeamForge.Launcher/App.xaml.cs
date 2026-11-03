using System.Windows;
using System.Windows.Threading;
using System.Text.Json;
using TeamForge.Launcher.Core;

namespace TeamForge.Launcher;

public partial class App : Application
{
    private LauncherInstanceGate? _instanceGate;
    private LauncherStartupWindow? _startupWindow;

    protected override async void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        if (e.Args.Length == 1 && string.Equals(e.Args[0], "--self-test-runtime", StringComparison.Ordinal))
        {
            ShutdownMode = ShutdownMode.OnExplicitShutdown;
            var exitCode = await RunRuntimeSelfTestAsync();
            Shutdown(exitCode);
            return;
        }

        if (e.Args.Length != 0)
        {
            Shutdown(64);
            return;
        }

        try
        {
            _instanceGate = new LauncherInstanceGate("Guest-v1");
            if (!_instanceGate.TryAcquire())
            {
                // Rapid clicks should focus the existing first process,
                // including when it is still showing its startup window.
                _instanceGate.RequestActivation();
                Shutdown();
                return;
            }

            _instanceGate.ListenForActivation(() =>
            {
                if (!Dispatcher.HasShutdownStarted)
                {
                    Dispatcher.BeginInvoke(new Action(ActivateRunningWindow), DispatcherPriority.Normal);
                }
            });

            // Render a small first window before loading the full MainWindow
            // and validating the bundled Runtime.
            ShutdownMode = ShutdownMode.OnExplicitShutdown;
            _startupWindow = new LauncherStartupWindow();
            MainWindow = _startupWindow;
            _startupWindow.Show();
            Dispatcher.BeginInvoke(new Action(OpenMainWindow), DispatcherPriority.Background);
        }
        catch (Exception exception) when (exception is InvalidOperationException or
                                         UnauthorizedAccessException or System.IO.IOException or
                                         System.Threading.WaitHandleCannotBeOpenedException)
        {
            MessageBox.Show("TeamForge could not initialize its Launcher. Close any stuck TeamForge process and try again.",
                "TeamForge", MessageBoxButton.OK, MessageBoxImage.Error);
            Shutdown(2);
        }
    }

    private void OpenMainWindow()
    {
        if (Dispatcher.HasShutdownStarted) return;
        try
        {
            var window = new MainWindow();
            MainWindow = window;
            ShutdownMode = ShutdownMode.OnMainWindowClose;
            window.Show();
            _startupWindow?.Close();
            _startupWindow = null;
        }
        catch (Exception)
        {
            MessageBox.Show("TeamForge could not open its Launcher window. Try starting TeamForge again.",
                "TeamForge", MessageBoxButton.OK, MessageBoxImage.Error);
            Shutdown(2);
        }
    }

    private void ActivateRunningWindow()
    {
        if (Dispatcher.HasShutdownStarted) return;
        var target = MainWindow ?? _startupWindow;
        if (target is null) return;
        if (target.WindowState == WindowState.Minimized) target.WindowState = WindowState.Normal;
        target.Show();
        target.Activate();
    }

    protected override void OnExit(ExitEventArgs e)
    {
        _instanceGate?.Dispose();
        base.OnExit(e);
    }

    private static async Task<int> RunRuntimeSelfTestAsync()
    {
        try
        {
            var pins = new RuntimeTrustPins(
                RuntimePins.ManifestSha256,
                RuntimePins.LoaderSha256,
                "0.5.1",
                1,
                "backend/project-peer/src/guest-orchestrator-cli.mjs");
            var runtime = await RuntimeLayoutVerifier.VerifyAsync(AppContext.BaseDirectory, pins);
            await using var bridge = BridgeClient.Start(runtime);
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(20));
            var result = await bridge.SendRequestAsync("health", cancellationToken: timeout.Token);
            if (result.ValueKind != JsonValueKind.Object)
            {
                Console.Out.WriteLine("{\"ok\":false,\"code\":\"runtime_health_invalid\"}");
                return 3;
            }

            if (!result.TryGetProperty("ready", out var ready)
                || ready.ValueKind != JsonValueKind.True
                || !HasExactString(result, "bridge", "teamforge-guest-bridge-v1")
                || !HasExactString(result, "productVersion", "0.5.1")
                || !HasExactString(result, "backend", "project-peer")
                || !HasExactString(result, "runtimeStrategy", "bundled-verified-only"))
            {
                Console.Out.WriteLine("{\"ok\":false,\"code\":\"runtime_not_ready\"}");
                return 4;
            }

            Console.Out.WriteLine("{\"ok\":true,\"code\":\"runtime_self_test_passed\"}");
            return 0;
        }
        catch
        {
            Console.Out.WriteLine("{\"ok\":false,\"code\":\"runtime_self_test_failed\"}");
            return 2;
        }
    }

    private static bool HasExactString(JsonElement element, string name, string expected)
    {
        return element.TryGetProperty(name, out var value)
            && value.ValueKind == JsonValueKind.String
            && string.Equals(value.GetString(), expected, StringComparison.Ordinal);
    }
}

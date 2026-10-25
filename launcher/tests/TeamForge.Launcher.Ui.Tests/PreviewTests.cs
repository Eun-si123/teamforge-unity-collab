using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using TeamForge.Launcher;
using TeamForge.Launcher.Core;

internal static class PreviewTests
{
    private const BindingFlags Private = BindingFlags.Instance | BindingFlags.NonPublic;
    private const string ProjectUuid = "123e4567-e89b-42d3-a456-426614174000";

    public static int RunChild(string[] args)
    {
        if (args.Length != 3) return 2;
        using var ready = EventWaitHandle.OpenExisting(args[1] + ".ready");
        using var releaseA = EventWaitHandle.OpenExisting(args[1] + ".a");
        using var releaseB = EventWaitHandle.OpenExisting(args[1] + ".b");
        var replies = new List<Task>();
        ready.Set();
        while (Console.ReadLine() is { } line)
        {
            using var document = JsonDocument.Parse(line);
            var frame = document.RootElement;
            var type = frame.GetProperty("type").GetString();
            if (type == "shutdown")
            {
                releaseA.Set();
                releaseB.Set();
                Task.WaitAll(replies.ToArray(), TimeSpan.FromSeconds(3));
                return 0;
            }
            if (type != "inspect") continue;
            var id = frame.GetProperty("id").GetString();
            var managedRoot = frame.GetProperty("managedRoot").GetString()!;
            var isB = frame.GetProperty("invite").GetString() == "public-invite-B";
            replies.Add(Task.Run(() =>
            {
                if (!(isB ? releaseB : releaseA).WaitOne(TimeSpan.FromSeconds(15))) return;
                if (!isB && args[2] == "error")
                {
                    Console.WriteLine(JsonSerializer.Serialize(new
                    {
                        id, @event = "error",
                        error = new { code = "invite_invalid", userMessage = "Public preview rejection.", advancedDetail = "Public synthetic rejection." },
                    }));
                    return;
                }
                Console.WriteLine(JsonSerializer.Serialize(new
                {
                    id, @event = "complete", result = new
                    {
                        includesRealtimeSession = true, managedRoot,
                        projectId = isB ? "public-project-B" : "public-project-A", projectUuid = ProjectUuid,
                        serverHost = isB ? "public-host-B" : "public-host-A", baselineRevision = 1,
                        previousVerifiedActiveAvailable = !isB && args[2] == "existing",
                        activePath = Path.Combine(managedRoot, ProjectUuid, "active", "1-aaaaaaaaaaaa"),
                        activeUnityVersion = "6000.0.65f1", activeRevision = 1, activeManifestHash = new string('a', 64),
                    },
                }));
            }));
        }
        return 0;
    }

    public static void Healthy(Action pump)
    {
        using var fixture = new Fixture(pump);
        var preview = fixture.Preview();
        Require(!fixture.PreviewButton.IsEnabled, "Preview must be disabled while its inspection is pending.");
        var duplicate = fixture.Preview();
        Require(duplicate.IsCompleted && fixture.PendingCount == 1, "Repeated input sent another inspection.");
        fixture.ReleaseA();
        fixture.Wait(preview);
        Require(fixture.Visible && fixture.Summary.Contains("public-project-A", StringComparison.Ordinal), "Healthy preview was not published.");
        Require(fixture.PreviewButton.IsEnabled, "Completed preview did not restore its input.");
        Require(fixture.PendingCount == 0, "Healthy preview retained a request.");
    }

    public static void CurrentValidation(Action pump)
    {
        using var fixture = new Fixture(pump, "existing");
        var preview = fixture.Preview();
        fixture.ReleaseA();
        fixture.WaitForValidation();
        fixture.Validation.SetResult(fixture.Existing);
        fixture.Wait(preview);
        Require(fixture.Visible && ReferenceEquals(Get(fixture.Window, "_existingVerifiedProject"), fixture.Existing),
            "Current validated recovery state was not published.");
        Require(fixture.PreviewButton.IsEnabled, "Current validation did not restore preview input.");
    }

    public static void ReplacedInvite(Action pump, bool error)
    {
        using var fixture = new Fixture(pump, error ? "error" : "healthy");
        var old = fixture.Preview();
        fixture.ReleaseA();
        fixture.WaitForResponseWithoutPumping(); // A continuation is queued on the UI thread.
        fixture.UseInviteB();
        var current = fixture.Preview();
        fixture.Status.Text = "Public current-preview sentinel.";
        fixture.Wait(old);
        Require(!fixture.Visible && !fixture.FailureVisible, "Old success/failure reached replacement input.");
        Require(fixture.Status.Text == "Public current-preview sentinel.", "Old continuation overwrote the newer status.");
        Require(!fixture.PreviewButton.IsEnabled, "Old finally retired the newer preview.");
        fixture.ReleaseB();
        fixture.Wait(current);
        Require(fixture.Summary.Contains("public-project-B", StringComparison.Ordinal), "Replacement preview failed to publish.");
    }

    public static void ReplacedDestination(Action pump)
    {
        using var fixture = new Fixture(pump);
        var old = fixture.Preview();
        // Even a target update without the normal Choose action's invalidation
        // must not bind an old result to the new selected root.
        fixture.Destination.Text = Path.Combine(fixture.Root, "other-projects");
        fixture.Status.Text = "Public replacement-root sentinel.";
        fixture.ReleaseA();
        fixture.Wait(old);
        Require(!fixture.Visible && !fixture.FailureVisible, "Old result was rebound to another destination.");
        Require(fixture.Status.Text == "Public replacement-root sentinel.", "Old preview changed replacement-root status.");
        Require(Get(fixture.Window, "_existingVerifiedProject") is null, "Old recovery project survived destination replacement.");
    }

    public static void LateValidation(Action pump, bool error)
    {
        using var fixture = new Fixture(pump, "existing");
        var old = fixture.Preview();
        fixture.ReleaseA();
        fixture.WaitForValidation();
        fixture.UseInviteB();
        var current = fixture.Preview();
        var context = Get(fixture.Window, "_diagnosticContext");
        fixture.Status.Text = "Public newer-validation sentinel.";
        if (error) fixture.Validation.SetException(new IOException("Public obsolete validation failure."));
        else fixture.Validation.SetResult(fixture.Existing);
        fixture.Wait(old);
        Require(ReferenceEquals(context, Get(fixture.Window, "_diagnosticContext")), "Late helper overwrote the replacement diagnostic context.");
        Require(Get(fixture.Window, "_existingVerifiedProject") is null, "Late helper republished the old recovery project.");
        Require(!fixture.Visible && !fixture.FailureVisible, "Late validation published old success/failure.");
        Require(!fixture.PreviewButton.IsEnabled && fixture.Status.Text == "Public newer-validation sentinel.", "Old finally changed the newer preview.");
        fixture.ReleaseB();
        fixture.Wait(current);
        Require(fixture.Summary.Contains("public-project-B", StringComparison.Ordinal), "Current preview failed after obsolete validation.");
    }

    public static void ReceiveStarts(Action pump)
    {
        foreach (var validating in new[] { false, true })
        {
            using var fixture = new Fixture(pump, validating ? "existing" : "healthy");
            var preview = fixture.Preview();
            if (validating) { fixture.ReleaseA(); fixture.WaitForValidation(); }
            Invoke(fixture.Window, "SetReceiving", true);
            fixture.Status.Text = "Public receive sentinel.";
            fixture.Validation.TrySetResult(fixture.Existing);
            fixture.Wait(preview);
            Require(Get(fixture.Window, "_receiving") is true && !fixture.Visible && !fixture.FailureVisible,
                "Retired preview changed the receive workflow.");
            Require(Get(fixture.Window, "_existingVerifiedProject") is null, "Preview validation republished recovery state during receive.");
            Require(fixture.Status.Text == "Public receive sentinel.", "Cancelled preview overwrote receive status.");
            Require(fixture.PendingCount == 0, "Receive start did not retire preview's pending request.");
        }
    }

    public static void CloseDuringValidation(Action pump)
    {
        using var fixture = new Fixture(pump, "existing");
        var preview = fixture.Preview();
        fixture.ReleaseA();
        fixture.WaitForValidation();
        fixture.Window.Close();
        fixture.WaitForClosed();
        fixture.Validation.SetResult(fixture.Existing);
        fixture.Wait(preview);
        Require(!fixture.Visible && Get(fixture.Window, "_existingVerifiedProject") is null,
            "Late inspection validation republished state after Close.");
    }

    public static void CurrentFailure(Action pump)
    {
        using var fixture = new Fixture(pump, "error");
        var preview = fixture.Preview();
        fixture.ReleaseA();
        fixture.Wait(preview);
        Require(fixture.FailureVisible && !fixture.Visible, "Current invalid preview did not show its handled failure.");
        Require(fixture.PreviewButton.IsEnabled, "Current failure left Preview disabled.");
    }

    private static object? Get(MainWindow window, string name) => typeof(MainWindow).GetField(name, Private)!.GetValue(window);
    private static void Set(MainWindow window, string name, object? value) => typeof(MainWindow).GetField(name, Private)!.SetValue(window, value);
    private static object? Invoke(MainWindow window, string name, params object[] args) => typeof(MainWindow).GetMethod(name, Private)!.Invoke(window, args);
    private static void Require(bool value, string message) { if (!value) throw new InvalidOperationException(message); }

    private sealed class Fixture : IDisposable
    {
        private readonly Action _pump;
        private readonly EventWaitHandle _ready, _releaseA, _releaseB;
        private readonly Process _observer;
        public string Root { get; } = Path.Combine(Path.GetTempPath(), "tf-preview-" + Guid.NewGuid().ToString("N"));
        public MainWindow Window { get; }
        public BridgeClient Bridge { get; }
        public VerifiedExistingProject Existing { get; }
        public TaskCompletionSource<VerifiedExistingProject> Validation { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private bool _validationStarted;
        private bool _closed;
        public Button PreviewButton => (Button)Window.FindName("PreviewButton");
        public TextBox Destination => (TextBox)Window.FindName("DestinationTextBox");
        public TextBlock Status => (TextBlock)Window.FindName("StatusText");
        public string Summary => ((TextBlock)Window.FindName("PreviewSummaryText")).Text;
        public bool Visible => ((Border)Window.FindName("PreviewBorder")).Visibility == Visibility.Visible;
        public bool FailureVisible => ((Border)Window.FindName("FailureBorder")).Visibility == Visibility.Visible;
        public int PendingCount
        {
            get
            {
                var pending = typeof(BridgeClient).GetField("_pending", Private)!.GetValue(Bridge)!;
                return (int)pending.GetType().GetProperty("Count")!.GetValue(pending)!;
            }
        }

        public Fixture(Action pump, string mode = "healthy")
        {
            _pump = pump;
            var prefix = "Local\\TeamForge.Ui.Preview." + Guid.NewGuid().ToString("N");
            _ready = new EventWaitHandle(false, EventResetMode.ManualReset, prefix + ".ready");
            _releaseA = new EventWaitHandle(false, EventResetMode.ManualReset, prefix + ".a");
            _releaseB = new EventWaitHandle(false, EventResetMode.ManualReset, prefix + ".b");
            var info = new ProcessStartInfo(Environment.ProcessPath!)
            {
                UseShellExecute = false, RedirectStandardInput = true,
                RedirectStandardOutput = true, RedirectStandardError = true, CreateNoWindow = true,
            };
            foreach (var arg in new[] { "--preview-fixture", prefix, mode }) info.ArgumentList.Add(arg);
            EnvironmentPolicy.Scrub(info.Environment);
            var process = Process.Start(info) ?? throw new InvalidOperationException("Public preview child did not start.");
            _observer = Process.GetProcessById(process.Id);
            try
            {
                Require(_ready.WaitOne(TimeSpan.FromSeconds(8)), "Public preview child did not become ready.");
                Bridge = (BridgeClient)typeof(BridgeClient).GetConstructor(Private, null, new[] { typeof(Process) }, null)!.Invoke(new object[] { process });
                Window = new MainWindow(); // Never Show or load the production Runtime.
                Window.Closed += (_, _) => _closed = true;
                var paths = new LauncherUserPaths(Path.Combine(Root, "projects"), Path.Combine(Root, "state"), Path.Combine(Root, "state", "state.json"));
                Set(Window, "_userPaths", paths);
                Set(Window, "_stateStore", new LauncherStateStore(paths));
                Set(Window, "_bridge", Bridge);
                Set(Window, "_runtimeReady", true);
                Destination.Text = paths.DefaultProjectsRoot;
                ((TextBox)Window.FindName("InviteTextBox")).Text = "public-invite-A";
                Existing = (VerifiedExistingProject)typeof(VerifiedExistingProject).GetConstructor(Private, null,
                    new[] { typeof(string), typeof(string), typeof(string), typeof(string), typeof(long), typeof(string) }, null)!.Invoke(new object[]
                    { paths.DefaultProjectsRoot, Path.Combine(paths.DefaultProjectsRoot, ProjectUuid, "active", "1-aaaaaaaaaaaa"),
                        "6000.0.65f1", ProjectUuid, 1L, new string('a', 64) });
                Func<string, JsonElement, CancellationToken, Task<VerifiedExistingProject>> validate = (_, _, _) =>
                {
                    _validationStarted = true;
                    return Validation.Task; // Deliberately ignore cancellation to exercise late completion fencing.
                };
                Set(Window, "_validateInspectionExisting", validate);
            }
            catch
            {
                if (!process.HasExited) process.Kill(entireProcessTree: true);
                process.WaitForExit();
                process.Dispose();
                _observer.Dispose();
                _ready.Dispose();
                _releaseA.Dispose();
                _releaseB.Dispose();
                throw;
            }
        }

        public Task Preview() => (Task)Invoke(Window, "PreviewAsync")!;
        public void UseInviteB() => ((TextBox)Window.FindName("InviteTextBox")).Text = "public-invite-B";
        public void ReleaseA() => _releaseA.Set();
        public void ReleaseB() => _releaseB.Set();
        public void Wait(Task task)
        {
            WaitUntil(() => task.IsCompleted, true);
            task.GetAwaiter().GetResult();
        }
        public void WaitForResponseWithoutPumping() => WaitUntil(() => PendingCount == 0, false);
        public void WaitForValidation() => WaitUntil(() => _validationStarted, true);
        public void WaitForClosed() => WaitUntil(() => _closed, true);
        private void WaitUntil(Func<bool> predicate, bool pump)
        {
            var elapsed = Stopwatch.StartNew();
            while (!predicate())
            {
                Require(elapsed.Elapsed < TimeSpan.FromSeconds(8), "Preview fixture did not settle within its deadline.");
                if (pump) _pump();
                Thread.Sleep(10);
            }
            if (pump) _pump();
        }

        public void Dispose()
        {
            _releaseA.Set();
            _releaseB.Set();
            Validation.TrySetResult(Existing);
            try
            {
                if (!_closed) Window.Close();
                WaitForClosed();
            }
            finally
            {
                if (!_observer.HasExited) { _observer.Kill(entireProcessTree: true); _observer.WaitForExit(); }
                _observer.Dispose();
                _ready.Dispose();
                _releaseA.Dispose();
                _releaseB.Dispose();
                if (Directory.Exists(Root)) Directory.Delete(Root, recursive: true);
            }
        }
    }
}

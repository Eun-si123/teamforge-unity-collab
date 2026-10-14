using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using TeamForge.Launcher;
using TeamForge.Launcher.Core;

internal static class UnityLaunchTests
{
    private const BindingFlags Private = BindingFlags.Instance | BindingFlags.NonPublic;
    private const string Version = "6000.3.21f1";
    private const string PublicCode = "public-synthetic-handoff-code";

    public static void HealthyActive(Action pump)
    {
        using var f = new Fixture(pump);
        f.Wait(f.OpenActive());
        Require(f.Starts == 1, "Healthy Active should start exactly once.");
        Require(f.TokenSeen && f.LastStartInfo is not null, "Active start must receive the selected working code.");
        Require(!f.LastStartInfo!.Environment.ContainsKey(UnityLaunchPolicy.GuestAuthenticationEnvironmentVariable),
            "The process-start environment must retire its access-code copy.");
        Require(Get(f.Window, "_pendingAccessCode") is null && Get(f.Window, "_readyProject") is null,
            "Successful Active launch must retire working state.");
        Require(f.Refreshed is not null && File.Exists(f.Refreshed.HandoffPath),
            "A started Unity must retain its one-shot handoff for consumption.");
    }

    public static void InviteDuringValidation(Action pump)
    {
        using var f = new Fixture(pump);
        var gate = f.Gate(f.Project);
        f.ValidateActive = (_, _, _, _) => gate.Task;
        f.Install();
        var task = f.OpenActive();
        f.ChangeContext();
        gate.SetResult(f.Project);
        f.Wait(task);
        Require(f.Starts == 0 && Get(f.Window, "_readyProject") is null,
            "Late validation resurrected or opened the previous invite's project.");
        Require(f.Status.Text == "new public context", "Late validation overwrote the newer UI.");
    }

    public static void CloseDuringValidation(Action pump)
    {
        using var f = new Fixture(pump);
        var gate = f.Gate(f.Project);
        CancellationToken observed = default;
        f.ValidateActive = (_, _, _, token) => { observed = token; return gate.Task; };
        f.Install();
        var task = f.OpenActive();
        f.Window.Close();
        pump();
        Require(observed.IsCancellationRequested, "Close must cancel its owned Unity operation.");
        Require(f.Closed == 0, "Close must wait for Unity-operation cleanup.");
        gate.SetResult(f.Project);
        f.Wait(task);
        WaitUntil(() => f.Closed == 1, pump, "Close did not finish after Unity cleanup.");
        Require(f.Starts == 0, "Closing validation must never start Unity.");
    }

    public static void InviteDuringProbe(Action pump)
    {
        using var f = new Fixture(pump);
        var gate = f.Gate<VerifiedUnityEditor?>(f.Editor);
        f.ValidateActive = (_, _, _, _) => Task.FromResult(f.Project);
        f.FindEditor = (_, _) => gate.Task;
        f.Install();
        var task = f.OpenActive();
        f.ChangeContext();
        gate.SetResult(f.Editor);
        f.Wait(task);
        Require(f.Starts == 0 && f.Refreshed is null, "Stale Editor probe reached handoff refresh or launch.");
        Require(f.Status.Text == "new public context", "Stale probe overwrote current UI.");
    }

    public static void InviteAfterRefresh(Action pump)
    {
        using var f = new Fixture(pump);
        var refreshed = UnityLaunchPolicy.RefreshHandoffForUnityLaunchAsync(f.Project).GetAwaiter().GetResult();
        f.Refreshed = refreshed;
        var gate = f.Gate(refreshed);
        f.ValidateActive = (_, _, _, _) => Task.FromResult(f.Project);
        f.Refresh = (_, _) => gate.Task;
        f.Install();
        var task = f.OpenActive();
        f.ChangeContext();
        gate.SetResult(refreshed);
        f.Wait(task);
        Require(f.Starts == 0 && !File.Exists(refreshed.HandoffPath),
            "Cancelled launch started or retained its unused refreshed handoff.");
        Require(File.Exists(f.UnrelatedHandoff) && Directory.Exists(f.Project.ActivePath),
            "Cancellation removed unrelated handoff or Active data.");
    }

    public static void InviteDuringPathPreparation(Action pump)
    {
        using var f = new Fixture(pump);
        var prepared = f.Prepare(f.Project).GetAwaiter().GetResult();
        var gate = f.Gate(prepared);
        f.PrepareActive = (_, _) => gate.Task;
        f.Install();
        var task = f.OpenActive();
        WaitUntil(() => f.Refreshed is not null, pump, "Refresh did not reach path gate.");
        f.ChangeContext();
        gate.SetResult(prepared);
        f.Wait(task);
        Require(f.Starts == 0 && !File.Exists(f.Refreshed!.HandoffPath),
            "Late path preparation started Unity or retained unused handoff.");
        Require(f.Status.Text == "new public context", "Old launch overwrote replacement context.");
    }

    public static void DuplicateOpen(Action pump)
    {
        using var f = new Fixture(pump);
        var gate = f.Gate(f.Project);
        var calls = 0;
        f.ValidateActive = (_, _, _, _) => { calls++; return gate.Task; };
        f.Install();
        var first = f.OpenActive();
        var second = f.OpenActive();
        Require(calls == 1 && second.IsCompleted, "Repeated open started another validation pipeline.");
        gate.SetResult(f.Project);
        f.Wait(first);
        f.Wait(second);
        Require(f.Starts == 1, "Repeated open must produce exactly one start.");
    }

    public static void CloseDuringPathPreparation(Action pump)
    {
        using var f = new Fixture(pump);
        var prepared = f.Prepare(f.Project).GetAwaiter().GetResult();
        var gate = f.Gate(prepared);
        f.PrepareActive = (_, _) => gate.Task;
        f.Install();
        var task = f.OpenActive();
        WaitUntil(() => f.Refreshed is not null, pump, "Close scenario did not reach refreshed handoff.");
        f.Window.Close();
        pump();
        Require(f.Closed == 0, "Window closed before unused handoff cleanup could run.");
        gate.SetResult(prepared);
        f.Wait(task);
        WaitUntil(() => f.Closed == 1, pump, "Window did not finish after handoff cleanup.");
        Require(f.Starts == 0 && !File.Exists(f.Refreshed!.HandoffPath)
            && File.Exists(f.UnrelatedHandoff) && Directory.Exists(f.Project.ActivePath),
            "Close failed to retire only its unused handoff before finishing.");
    }

    public static void LateFailure(Action pump)
    {
        using var f = new Fixture(pump);
        var gate = f.Gate(f.Project);
        f.ValidateActive = (_, _, _, _) => gate.Task;
        f.Install();
        var task = f.OpenActive();
        f.ChangeContext();
        Set(f.Window, "_readyProject", f.Project); // Same identity, new invite context.
        Set(f.Window, "_readyResult", f.Result.RootElement.Clone());
        Set(f.Window, "_pendingAccessCode", PublicCode);
        gate.SetException(new IOException("public synthetic late validation failure"));
        f.Wait(task);
        Require(ReferenceEquals(Get(f.Window, "_readyProject"), f.Project)
            && Equals(Get(f.Window, "_pendingAccessCode"), PublicCode),
            "Late failure cleared the newer ready project or credential.");
        Require(f.Status.Text == "new public context", "Late failure replaced current presentation.");
    }

    public static void ExistingActive(Action pump, bool changeContext)
    {
        using var f = new Fixture(pump);
        var prepared = f.Prepare(f.Existing).GetAwaiter().GetResult();
        var gate = f.Gate(prepared);
        f.PrepareExisting = (_, _) => changeContext ? gate.Task : Task.FromResult(prepared);
        f.Install();
        var task = f.OpenExisting();
        if (changeContext)
        {
            WaitUntil(() => f.ExistingValidated, pump, "Existing Active did not reach validation.");
            f.ChangeContext();
            gate.SetResult(prepared);
        }
        f.Wait(task);
        Require(f.Starts == (changeContext ? 0 : 1), "Existing Active did not respect its context.");
        if (!changeContext)
        {
            Require(!f.TokenSeen && !f.LastStartInfo!.Environment.ContainsKey("TEAMFORGE_GUEST_HANDOFF_PATH"),
                "Existing Active must not inherit realtime handoff or auth state.");
        }
    }

    public static void EditorSelection(Action pump, bool changeContext)
    {
        using var f = new Fixture(pump);
        var gate = f.Gate(f.Editor);
        f.VerifyEditor = (_, version, _) =>
        {
            Require(version == Version, "Editor selection lost the required exact version.");
            return changeContext ? gate.Task : Task.FromResult(f.Editor);
        };
        f.Install();
        var task = f.VerifyChosenEditor();
        if (changeContext)
        {
            f.ChangeContext();
            gate.SetResult(f.Editor);
        }
        f.Wait(task);
        Require(f.Starts == 0, "Editor selection must not start Unity.");
        Require(changeContext ? Get(f.Window, "_explicitlyVerifiedEditor") is null
            : ReferenceEquals(Get(f.Window, "_explicitlyVerifiedEditor"), f.Editor),
            "Editor selection did not respect the project context.");
        if (changeContext) Require(f.Status.Text == "new public context", "Late selection changed current UI.");
    }

    public static int RunVersionChild(string[] args)
    {
        if (args.Length != 4) return 2;
        using var ready = EventWaitHandle.OpenExisting(args[1]);
        using var release = EventWaitHandle.OpenExisting(args[2]);
        File.WriteAllText(args[3], Environment.ProcessId.ToString(System.Globalization.CultureInfo.InvariantCulture));
        Console.WriteLine(Version);
        ready.Set();
        return release.WaitOne(TimeSpan.FromSeconds(15)) ? 0 : 3;
    }

    public static void CancelledProbeChild(Action pump)
    {
        var prefix = "Local\\TeamForge.Ui.Version." + Guid.NewGuid().ToString("N");
        using var ready = new EventWaitHandle(false, EventResetMode.ManualReset, prefix + ".ready");
        using var release = new EventWaitHandle(false, EventResetMode.ManualReset, prefix + ".release");
        var pidFile = Path.Combine(Path.GetTempPath(), "tf-version-" + Guid.NewGuid().ToString("N"));
        using var cancellation = new CancellationTokenSource();
        var info = new ProcessStartInfo(Environment.ProcessPath!)
        {
            UseShellExecute = false, RedirectStandardOutput = true,
            RedirectStandardError = true, CreateNoWindow = true,
        };
        foreach (var arg in new[] { "--unity-version-fixture", prefix + ".ready", prefix + ".release", pidFile })
            info.ArgumentList.Add(arg);
        EnvironmentPolicy.Scrub(info.Environment);
        var method = typeof(UnityLaunchPolicy).GetMethod("ProbeEditorVersionAsync", BindingFlags.Static | BindingFlags.NonPublic)!;
        var task = (Task<VerifiedUnityEditor>)method.Invoke(null,
            new object[] { Environment.ProcessPath!, Version, info, cancellation.Token })!;
        Process? observer = null;
        try
        {
            Require(ready.WaitOne(TimeSpan.FromSeconds(8)), "Synthetic version child did not become ready.");
            observer = Process.GetProcessById(int.Parse(File.ReadAllText(pidFile), System.Globalization.CultureInfo.InvariantCulture));
            cancellation.Cancel();
            WaitUntil(() => task.IsCompleted, pump, "Cancelled version probe did not settle.");
            try
            {
                task.GetAwaiter().GetResult();
                throw new InvalidOperationException("Cancelled probe unexpectedly verified the Editor.");
            }
            catch (OperationCanceledException) { }
            Require(observer.HasExited, "Cancelled Editor probe left its child running.");
        }
        finally
        {
            release.Set();
            if (observer is not null)
            {
                if (!observer.WaitForExit(8000)) { observer.Kill(entireProcessTree: true); observer.WaitForExit(); }
                observer.Dispose();
            }
            File.Delete(pidFile);
        }
    }

    private static object? Get(MainWindow window, string name) => typeof(MainWindow).GetField(name, Private)!.GetValue(window);
    private static void Set(MainWindow window, string name, object? value) => typeof(MainWindow).GetField(name, Private)!.SetValue(window, value);
    private static void Require(bool condition, string message) { if (!condition) throw new InvalidOperationException(message); }
    private static void WaitUntil(Func<bool> done, Action pump, string message)
    {
        var clock = Stopwatch.StartNew();
        while (!done()) { Require(clock.Elapsed < TimeSpan.FromSeconds(10), message); pump(); Thread.Sleep(10); }
        pump();
    }

    private sealed class Fixture : IDisposable
    {
        private readonly Action _pump;
        private readonly List<Task> _tasks = new();
        private readonly List<Action> _release = new();
        private readonly List<PreparedUnityLaunchPath> _preparedPaths = new();
        private readonly string _root;
        public MainWindow Window { get; }
        public JsonDocument Result { get; }
        public VerifiedActiveProject Project { get; }
        public VerifiedExistingProject Existing { get; }
        public VerifiedUnityEditor Editor { get; }
        public string AliasRoot { get; }
        public string UnrelatedHandoff { get; }
        public TextBlock Status => (TextBlock)Window.FindName("StatusText");
        public int Starts { get; private set; }
        public int Closed { get; private set; }
        public bool TokenSeen { get; private set; }
        public bool ExistingValidated { get; private set; }
        public ProcessStartInfo? LastStartInfo { get; private set; }
        public VerifiedActiveProject? Refreshed { get; set; }
        public Func<string, string, JsonElement, CancellationToken, Task<VerifiedActiveProject>> ValidateActive { get; set; }
        public Func<VerifiedExistingProject, CancellationToken, Task<VerifiedExistingProject>> ValidateExisting { get; set; }
        public Func<string, CancellationToken, Task<VerifiedUnityEditor?>> FindEditor { get; set; }
        public Func<string, string, CancellationToken, Task<VerifiedUnityEditor>> VerifyEditor { get; set; }
        public Func<VerifiedActiveProject, CancellationToken, Task<VerifiedActiveProject>> Refresh { get; set; }
        public Func<VerifiedActiveProject, CancellationToken, Task<PreparedUnityLaunchPath>> PrepareActive { get; set; }
        public Func<VerifiedExistingProject, CancellationToken, Task<PreparedUnityLaunchPath>> PrepareExisting { get; set; }

        public Fixture(Action pump)
        {
            _pump = pump;
            _root = Path.Combine(Path.GetTempPath(), "tfu-" + Guid.NewGuid().ToString("N"));
            var projects = Path.Combine(_root, "p");
            var state = Path.Combine(_root, "s");
            var active = Path.Combine(projects, "123e4567-e89b-42d3-a456-426614174000", "active", "3-aaaaaaaaaaaa");
            foreach (var directory in new[] { "Assets", "Packages", "ProjectSettings" }) Directory.CreateDirectory(Path.Combine(active, directory));
            File.WriteAllText(Path.Combine(active, "Packages", "manifest.json"), "{}");
            File.WriteAllText(Path.Combine(active, "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersion: " + Version + "\n");
            var handoff = Path.Combine(state, "guest-core", "handoff", "guest.json");
            Directory.CreateDirectory(Path.GetDirectoryName(handoff)!);
            File.WriteAllText(handoff, JsonSerializer.Serialize(new
            {
                schemaVersion = 1, projectUuid = "123e4567-e89b-42d3-a456-426614174000", baselineRevision = 3,
                manifestHash = new string('a', 64), descriptorHash = new string('b', 64),
                ownerKeyId = new string('c', 64), publisherKeyId = new string('d', 64), activeProjectPath = active,
                sessionJoinCode = "TF1.c2lnbmVkLXJlYWx0aW1lLXNlc3Npb24", createdAtUnixMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            }));
            UnrelatedHandoff = Path.Combine(Path.GetDirectoryName(handoff)!, "unrelated.json");
            File.WriteAllText(UnrelatedHandoff, "public unrelated fixture");
            Result = JsonDocument.Parse(JsonSerializer.Serialize(new { activePath = active, unityVersion = Version,
                handoffPath = handoff, handoffSha256 = PathSafety.Sha256FileAsync(handoff).GetAwaiter().GetResult() }));
            Project = UnityLaunchPolicy.ValidateActiveResultAsync(projects, state, Result.RootElement).GetAwaiter().GetResult();
            Existing = UnityLaunchPolicy.ValidateExistingActiveAsync(projects, active, Version, Project.ProjectUuid,
                3, new string('a', 64)).GetAwaiter().GetResult();
            var editorPath = Path.Combine(_root, "Unity.exe");
            File.WriteAllText(editorPath, "public probe stub - never executed");
            Editor = (VerifiedUnityEditor)typeof(VerifiedUnityEditor).GetConstructor(Private, null,
                new[] { typeof(string), typeof(string) }, null)!.Invoke(new object[] { editorPath, Version });
            // Keep the independently owned alias root short enough for the same
            // real path-budget policy; this fixture tests orchestration, not long-root rejection.
            AliasRoot = Path.Combine(Path.GetTempPath(), "tfx-ui", Guid.NewGuid().ToString("N")[..16]);
            Window = new MainWindow(); // No production Runtime startup, transfer or state saving.
            Window.Closed += (_, _) => Closed++;
            Set(Window, "_userPaths", new LauncherUserPaths(projects, state, Path.Combine(state, "state.json")));
            ((TextBox)Window.FindName("InviteTextBox")).Text = "public original invite";
            ((TextBox)Window.FindName("DestinationTextBox")).Text = projects;
            Set(Window, "_readyProject", Project);
            Set(Window, "_readyResult", Result.RootElement.Clone());
            Set(Window, "_existingVerifiedProject", Existing);
            Set(Window, "_pendingAccessCode", PublicCode);
            ValidateActive = (root, localState, result, token) => UnityLaunchPolicy.ValidateActiveResultAsync(root, localState, result, token);
            ValidateExisting = async (project, token) =>
            {
                var result = await UnityLaunchPolicy.ValidateExistingActiveAsync(project.ProjectsRoot, project.ActivePath,
                    project.UnityVersion, project.ProjectUuid, project.BaselineRevision, project.ManifestSha256, token);
                ExistingValidated = true;
                return result;
            };
            FindEditor = (_, _) => Task.FromResult<VerifiedUnityEditor?>(Editor);
            VerifyEditor = (_, _, _) => Task.FromResult(Editor);
            Refresh = async (project, token) =>
            {
                var refreshed = await UnityLaunchPolicy.RefreshHandoffForUnityLaunchAsync(project, cancellationToken: token);
                Refreshed = refreshed;
                return refreshed;
            };
            PrepareActive = (project, _) => Prepare(project);
            PrepareExisting = (project, _) => Prepare(project);
            Install();
        }

        public async Task<PreparedUnityLaunchPath> Prepare(VerifiedActiveProject project)
        {
            var prepared = await UnityPathStrategy.PrepareAsync(project, AliasRoot);
            _preparedPaths.Add(prepared);
            return prepared;
        }
        public async Task<PreparedUnityLaunchPath> Prepare(VerifiedExistingProject project)
        {
            var prepared = await UnityPathStrategy.PrepareAsync(project, AliasRoot);
            _preparedPaths.Add(prepared);
            return prepared;
        }
        public TaskCompletionSource<T> Gate<T>(T value)
        {
            var gate = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
            _release.Add(() => gate.TrySetResult(value));
            return gate;
        }
        public void Install()
        {
            var type = typeof(MainWindow).GetNestedType("UnityLaunchOperations", BindingFlags.NonPublic)!;
            var constructor = type.GetConstructors(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance)
                .Single(c => c.GetParameters().Length == 8);
            Func<ProcessStartInfo, Process?> start = info =>
            {
                Starts++;
                LastStartInfo = info;
                TokenSeen = info.Environment.ContainsKey(UnityLaunchPolicy.GuestAuthenticationEnvironmentVariable);
                return Process.GetCurrentProcess(); // Stand-in only; no Unity process is launched.
            };
            Set(Window, "_unityLaunchOperations", constructor.Invoke(new object[]
            { ValidateActive, ValidateExisting, FindEditor, VerifyEditor, Refresh, PrepareActive, PrepareExisting, start }));
        }
        private Task Invoke(string method, params object[] args)
        {
            var task = (Task)typeof(MainWindow).GetMethod(method, Private)!.Invoke(Window, args)!;
            _tasks.Add(task);
            return task;
        }
        public Task OpenActive() => Invoke("TryOpenUnityAsync");
        public Task OpenExisting() => Invoke("TryOpenExistingProjectAsync");
        public Task VerifyChosenEditor() => Invoke("VerifyChosenUnityEditorAsync", Editor.ExecutablePath, Version);
        public void Wait(Task task) { WaitUntil(() => task.IsCompleted, _pump, "Gated Unity operation did not settle."); task.GetAwaiter().GetResult(); }
        public void ChangeContext()
        {
            ((TextBox)Window.FindName("InviteTextBox")).Text = "public replacement invite";
            Status.Text = "new public context";
        }
        public void Dispose()
        {
            Window.Close();
            foreach (var release in _release) release();
            WaitUntil(() => _tasks.All(t => t.IsCompleted), _pump, "Fixture did not settle its owned operations.");
            foreach (var task in _tasks) if (task.IsFaulted) _ = task.Exception;
            WaitUntil(() => Closed > 0, _pump, "Fixture window did not finish closing.");
            // Unlink only aliases created/returned by this fixture through their
            // verified owner policy before deleting the ordinary temp tree.
            foreach (var prepared in _preparedPaths.DistinctBy(p => p.UnityVisiblePath))
            {
                var alias = (PreparedExecutionAlias?)typeof(PreparedUnityLaunchPath)
                    .GetProperty("Alias", Private)!.GetValue(prepared);
                if (alias is not null && Directory.Exists(alias.AliasPath))
                    ExecutionAliasManager.RemoveIfOwnedAsync(alias).GetAwaiter().GetResult();
            }
            Result.Dispose();
            Directory.Delete(_root, recursive: true);
            if (Directory.Exists(AliasRoot))
            {
                var cache = Path.Combine(AliasRoot, "cache");
                if (Directory.Exists(cache)) Directory.Delete(cache, recursive: true);
                File.Delete(Path.Combine(AliasRoot, ".teamforge-path-root.json"));
                // The verified junction removal above is the assertion. Windows
                // may briefly keep that removed entry pending, as in Core tests.
                try { Directory.Delete(AliasRoot); }
                catch (IOException) { }
            }
        }
    }
}

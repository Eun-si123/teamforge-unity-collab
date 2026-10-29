using Microsoft.Win32;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Windows;
using TeamForge.Launcher.Core;

namespace TeamForge.Launcher;

public partial class MainWindow
{
    private readonly UnityLaunchOperations _unityLaunchOperations = UnityLaunchOperations.Production;
    private object _unityProjectContext = new();
    private UnityLaunchOperation? _unityOperation;

    private async void ChooseUnity_Click(object sender, RoutedEventArgs e)
    {
        if (_closing || _unityOperation is not null) return;
        var context = _unityProjectContext;
        var requiredUnityVersion = _readyProject?.UnityVersion ?? _existingVerifiedProject?.UnityVersion;
        if (string.IsNullOrWhiteSpace(requiredUnityVersion))
        {
            StatusText.Text = "Receive the verified project before selecting Unity.";
            return;
        }
        var dialog = new OpenFileDialog
        {
            Title = $"Select Unity {requiredUnityVersion}",
            Filter = "Unity Editor (Unity.exe)|Unity.exe",
            CheckFileExists = true,
            Multiselect = false,
        };
        if (dialog.ShowDialog(this) != true || _closing || !ReferenceEquals(context, _unityProjectContext)) return;
        await VerifyChosenUnityEditorAsync(dialog.FileName, requiredUnityVersion);
    }

    private async Task VerifyChosenUnityEditorAsync(string editorPath, string requiredUnityVersion)
    {
        var operation = BeginUnityOperation();
        if (operation is null) return;
        try
        {
            StatusText.Text = $"Verifying Unity {requiredUnityVersion}…";
            var editor = await _unityLaunchOperations.VerifyEditor(editorPath, requiredUnityVersion, operation.Token);
            if (!IsCurrentUnityOperation(operation)) return;
            _explicitlyVerifiedEditor = editor;
            UnityEditorTextBox.Text = editor.ExecutablePath;
            StatusText.Text = "Exact Unity Editor verified. You can open the project now.";
            _diagnosticContext = _diagnosticContext with { UnityVersion = requiredUnityVersion, Operation = "unity_editor_verified" };
            AppendDiagnostic($"unity_editor_verified: {requiredUnityVersion}");
            ClearFailure();
        }
        catch (OperationCanceledException) when (!IsCurrentUnityOperation(operation)) { }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or InvalidDataException or InvalidOperationException or TimeoutException or Win32Exception)
        {
            if (!IsCurrentUnityOperation(operation)) return;
            _explicitlyVerifiedEditor = null;
            ShowFailure($"That executable is not exactly Unity {requiredUnityVersion}.", "unity_version_mismatch", exception.Message);
        }
        finally { FinishUnityOperation(operation); }
    }

    private async void OpenUnity_Click(object sender, RoutedEventArgs e) => await TryOpenUnityAsync();
    private async void OpenExistingProjectRecovery_Click(object sender, RoutedEventArgs e) => await TryOpenExistingProjectAsync();

    private async Task TryOpenExistingProjectAsync()
    {
        if (_closing || _unityOperation is not null) return;
        var source = _existingVerifiedProject;
        if (source is null)
        {
            ShowFailure("No previously verified project is available to open.", "existing_active_unavailable",
                "The last inspected managed root did not expose a validated current Active.");
            return;
        }
        var operation = BeginUnityOperation();
        if (operation is null) return;
        var selectedEditor = _explicitlyVerifiedEditor;
        try
        {
            var existing = await _unityLaunchOperations.ValidateExisting(source, operation.Token);
            if (!IsCurrentUnityOperation(operation)) return;
            var editor = selectedEditor ?? await _unityLaunchOperations.FindEditor(existing.UnityVersion, operation.Token);
            if (!IsCurrentUnityOperation(operation)) return;
            if (editor is null)
            {
                ShowMissingUnityEditor(existing.UnityVersion);
                return;
            }
            var preparedPath = await _unityLaunchOperations.PrepareExisting(existing, operation.Token);
            if (!IsCurrentUnityOperation(operation)) return;
            var startInfo = UnityLaunchPolicy.CreateExistingProjectOpenStartInfo(editor, existing, preparedPath);
            using var unity = _unityLaunchOperations.StartProcess(startInfo) ?? throw new InvalidOperationException("Unity did not start.");
            ClearPendingAccessCode();
            StatusText.Text = $"Opened the existing verified project in Unity {existing.UnityVersion} without joining the failed session. TeamForge optimized the project path when required.";
            _diagnosticContext = _diagnosticContext with { Operation = "existing_active_opened", StableErrorCode = "none" };
            AppendDiagnostic("existing_verified_active_open_started");
            ClearFailure();
        }
        catch (OperationCanceledException) when (!IsCurrentUnityOperation(operation)) { }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or InvalidDataException or InvalidOperationException or TimeoutException or Win32Exception)
        {
            if (!IsCurrentUnityOperation(operation)) return;
            ShowFailure("Unity could not open the existing verified project safely.", "unity_open_failed", exception.Message);
        }
        finally { FinishUnityOperation(operation); }
    }

    private async Task TryOpenUnityAsync()
    {
        var source = _readyProject;
        var result = _readyResult;
        if (source is null || result is null) return;
        var operation = BeginUnityOperation();
        if (operation is null) return;
        var selectedEditor = _explicitlyVerifiedEditor;
        VerifiedActiveProject? launchProject = null;
        var started = false;
        try
        {
            var sourceProject = await _unityLaunchOperations.ValidateActive(
                source.ProjectsRoot, _userPaths.StateDirectory, result.Value, operation.Token);
            if (!IsCurrentUnityOperation(operation)) return;
            var editor = selectedEditor ?? await _unityLaunchOperations.FindEditor(sourceProject.UnityVersion, operation.Token);
            if (!IsCurrentUnityOperation(operation)) return;
            if (editor is null)
            {
                ShowMissingUnityEditor(sourceProject.UnityVersion);
                return;
            }
            launchProject = await _unityLaunchOperations.RefreshHandoff(sourceProject, operation.Token);
            if (!IsCurrentUnityOperation(operation)) return;
            var preparedPath = await _unityLaunchOperations.PrepareActive(launchProject, operation.Token);
            if (!IsCurrentUnityOperation(operation)) return;
            var startInfo = UnityLaunchPolicy.CreateUnityOpenStartInfo(editor, launchProject, _pendingAccessCode, preparedPath);
            try
            {
                using var unity = _unityLaunchOperations.StartProcess(startInfo) ?? throw new InvalidOperationException("Unity did not start.");
                started = true;
            }
            finally { startInfo.Environment.Remove(UnityLaunchPolicy.GuestAuthenticationEnvironmentVariable); }
            var openedVersion = sourceProject.UnityVersion;
            ClearPendingAccessCode();
            InvalidateReadyProject();
            StatusText.Text = $"Opened the verified Active project in Unity {openedVersion}. TeamForge optimized the project path when required.";
            _diagnosticContext = _diagnosticContext with { Operation = "unity_open_started", StableErrorCode = "none" };
            AppendDiagnostic("unity_open_started");
            ClearFailure();
        }
        catch (OperationCanceledException) when (!IsCurrentUnityOperation(operation)) { }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or InvalidDataException or InvalidOperationException or TimeoutException or Win32Exception)
        {
            if (!IsCurrentUnityOperation(operation)) return;
            try
            {
                // Redact unexpected error details while the receive-scoped code still exists.
                ShowFailure("Unity could not open the verified Active project safely. Receive it again before retrying.",
                    "unity_open_failed", exception.Message);
            }
            finally { InvalidateReadyProject(); }
        }
        finally
        {
            try
            {
                if (!started && launchProject is not null) UnityLaunchPolicy.DeleteRefreshedHandoff(launchProject);
            }
            catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or InvalidDataException)
            {
                // Cleanup is scoped to this task's verified refresh. Do not erase
                // a replacement context to present an old task's cleanup error.
                AppendDiagnostic("unity_handoff_cleanup_warning");
                if (IsCurrentUnityOperation(operation))
                {
                    try
                    {
                        ShowFailure("Unity handoff cleanup could not complete safely. Receive the project again.",
                            "unity_open_failed", exception.Message);
                    }
                    finally { InvalidateReadyProject(); }
                }
            }
            finally { FinishUnityOperation(operation); }
        }
    }

    private void ShowMissingUnityEditor(string version)
    {
        _diagnosticContext = _diagnosticContext with { UnityVersion = version };
        ShowFailure("Unity version is not installed or cannot be found.", "unity_editor_missing",
            $"Expected Unity executable: {UnityLaunchPolicy.FindStandardEditor(version)}");
        AppendDiagnostic($"unity_editor_missing: {version}");
    }

    private UnityLaunchOperation? BeginUnityOperation()
    {
        if (_closing || _unityOperation is not null) return null;
        var operation = new UnityLaunchOperation(_unityProjectContext);
        _unityOperation = operation;
        UpdateButtons();
        return operation;
    }

    private bool IsCurrentUnityOperation(UnityLaunchOperation operation) =>
        !_closing && ReferenceEquals(operation.Context, _unityProjectContext) && !operation.Token.IsCancellationRequested;

    private void FinishUnityOperation(UnityLaunchOperation operation)
    {
        if (ReferenceEquals(_unityOperation, operation)) _unityOperation = null;
        operation.Dispose();
        operation.Completion.TrySetResult(true);
        UpdateButtons();
    }

    private sealed class UnityLaunchOperation(object context) : IDisposable
    {
        private readonly CancellationTokenSource _cancellation = new();
        public object Context { get; } = context;
        public CancellationToken Token => _cancellation.Token;
        public TaskCompletionSource<bool> Completion { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public void Cancel() => _cancellation.Cancel();
        public void Dispose() => _cancellation.Dispose();
    }

    // Private asynchronous stage seams: production always uses the existing Core
    // policies. Tests gate completion/probe/start without a public injection API.
    private sealed record UnityLaunchOperations(
        Func<string, string, JsonElement, CancellationToken, Task<VerifiedActiveProject>> ValidateActive,
        Func<VerifiedExistingProject, CancellationToken, Task<VerifiedExistingProject>> ValidateExisting,
        Func<string, CancellationToken, Task<VerifiedUnityEditor?>> FindEditor,
        Func<string, string, CancellationToken, Task<VerifiedUnityEditor>> VerifyEditor,
        Func<VerifiedActiveProject, CancellationToken, Task<VerifiedActiveProject>> RefreshHandoff,
        Func<VerifiedActiveProject, CancellationToken, Task<PreparedUnityLaunchPath>> PrepareActive,
        Func<VerifiedExistingProject, CancellationToken, Task<PreparedUnityLaunchPath>> PrepareExisting,
        Func<ProcessStartInfo, Process?> StartProcess)
    {
        public static UnityLaunchOperations Production { get; } = new(
            (projects, state, result, token) => UnityLaunchPolicy.ValidateActiveResultAsync(projects, state, result, token),
            (project, token) => UnityLaunchPolicy.ValidateExistingActiveAsync(project.ProjectsRoot,
                project.ActivePath, project.UnityVersion, project.ProjectUuid,
                project.BaselineRevision, project.ManifestSha256, token),
            FindEditorAsync,
            (path, version, token) => UnityLaunchPolicy.VerifyEditorAsync(path, version, token),
            (project, token) => UnityLaunchPolicy.RefreshHandoffForUnityLaunchAsync(project, cancellationToken: token),
            (project, _) => UnityPathStrategy.PrepareAsync(project),
            (project, _) => UnityPathStrategy.PrepareAsync(project),
            Process.Start);

        private static async Task<VerifiedUnityEditor?> FindEditorAsync(string version, CancellationToken token)
        {
            var path = UnityLaunchPolicy.FindStandardEditor(version);
            return string.IsNullOrEmpty(path) || !File.Exists(path)
                ? null
                : await UnityLaunchPolicy.VerifyEditorAsync(path, version, token);
        }
    }
}

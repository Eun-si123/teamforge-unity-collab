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

    private async void ChooseUnity_Click(object sender, RoutedEventArgs e)
    {
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
        if (dialog.ShowDialog(this) != true)
        {
            return;
        }

        await VerifyChosenUnityEditorAsync(dialog.FileName, requiredUnityVersion);
    }

    private async Task VerifyChosenUnityEditorAsync(string editorPath, string requiredUnityVersion)
    {
        try
        {
            StatusText.Text = $"Verifying Unity {requiredUnityVersion}…";
            _explicitlyVerifiedEditor = await _unityLaunchOperations.VerifyEditor(editorPath, requiredUnityVersion, CancellationToken.None);
            UnityEditorTextBox.Text = _explicitlyVerifiedEditor.ExecutablePath;
            StatusText.Text = "Exact Unity Editor verified. You can open the project now.";
            _diagnosticContext = _diagnosticContext with { UnityVersion = requiredUnityVersion, Operation = "unity_editor_verified" };
            AppendDiagnostic($"unity_editor_verified: {requiredUnityVersion}");
            ClearFailure();
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or InvalidDataException or InvalidOperationException or TimeoutException)
        {
            _explicitlyVerifiedEditor = null;
            ShowFailure($"That executable is not exactly Unity {requiredUnityVersion}.", "unity_version_mismatch", exception.Message);
        }
    }

    private async void OpenUnity_Click(object sender, RoutedEventArgs e)
    {
        await TryOpenUnityAsync();
    }

    private async void OpenExistingProjectRecovery_Click(object sender, RoutedEventArgs e)
    {
        await TryOpenExistingProjectAsync();
    }

    private async Task TryOpenExistingProjectAsync()
    {
        if (_existingVerifiedProject is null)
        {
            ShowFailure(
                "No previously verified project is available to open.",
                "existing_active_unavailable",
                "The last inspected managed root did not expose a validated current Active.");
            return;
        }

        try
        {
            var existing = await _unityLaunchOperations.ValidateExisting(_existingVerifiedProject, CancellationToken.None);
            var editor = _explicitlyVerifiedEditor;
            if (editor is null)
            {
                var standard = UnityLaunchPolicy.FindStandardEditor(existing.UnityVersion);
                editor = await _unityLaunchOperations.FindEditor(existing.UnityVersion, CancellationToken.None);
                if (editor is null)
                {
                    _diagnosticContext = _diagnosticContext with { UnityVersion = existing.UnityVersion };
                    ShowFailure(
                        "Unity version is not installed or cannot be found.",
                        "unity_editor_missing",
                        $"Expected Unity executable: {standard}");
                    return;
                }
            }

            var preparedPath = await _unityLaunchOperations.PrepareExisting(existing, CancellationToken.None);
            var startInfo = UnityLaunchPolicy.CreateExistingProjectOpenStartInfo(editor, existing, preparedPath);
            using var unity = _unityLaunchOperations.StartProcess(startInfo) ?? throw new InvalidOperationException("Unity did not start.");
            ClearPendingAccessCode();
            StatusText.Text = $"Opened the existing verified project in Unity {existing.UnityVersion} without joining the failed session. TeamForge optimized the project path when required.";
            _diagnosticContext = _diagnosticContext with { Operation = "existing_active_opened", StableErrorCode = "none" };
            AppendDiagnostic("existing_verified_active_open_started");
            ClearFailure();
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or InvalidDataException or InvalidOperationException or TimeoutException or Win32Exception)
        {
            ShowFailure(
                "Unity could not open the existing verified project safely.",
                "unity_open_failed",
                exception.Message);
        }
    }

    private async Task TryOpenUnityAsync()
    {
        if (_readyProject is null || _readyResult is null)
        {
            return;
        }

        try
        {
            _readyProject = await _unityLaunchOperations.ValidateActive(
                _readyProject.ProjectsRoot,
                _userPaths.StateDirectory,
                _readyResult.Value, CancellationToken.None);
            var editor = _explicitlyVerifiedEditor;
            if (editor is null)
            {
                var standardEditor = UnityLaunchPolicy.FindStandardEditor(_readyProject.UnityVersion);
                editor = await _unityLaunchOperations.FindEditor(_readyProject.UnityVersion, CancellationToken.None);
                if (editor is null)
                {
                    _diagnosticContext = _diagnosticContext with { UnityVersion = _readyProject.UnityVersion };
                    ShowFailure(
                        "Unity version is not installed or cannot be found.",
                        "unity_editor_missing",
                        $"Expected Unity executable: {standardEditor}");
                    AppendDiagnostic($"unity_editor_missing: {_readyProject.UnityVersion}");
                    return;
                }

            }

            var sourceProject = _readyProject;
            var launchProject = await _unityLaunchOperations.RefreshHandoff(sourceProject, CancellationToken.None);
            try
            {
                var preparedPath = await _unityLaunchOperations.PrepareActive(launchProject, CancellationToken.None);
                var startInfo = UnityLaunchPolicy.CreateUnityOpenStartInfo(editor, launchProject, _pendingAccessCode, preparedPath);
                try
                {
                    using var unity = _unityLaunchOperations.StartProcess(startInfo) ?? throw new InvalidOperationException("Unity did not start.");
                }
                finally
                {
                    startInfo.Environment.Remove(UnityLaunchPolicy.GuestAuthenticationEnvironmentVariable);
                }
            }
            catch
            {
                UnityLaunchPolicy.DeleteRefreshedHandoff(launchProject);
                throw;
            }

            var openedVersion = sourceProject.UnityVersion;
            ClearPendingAccessCode();
            InvalidateReadyProject();
            StatusText.Text = $"Opened the verified Active project in Unity {openedVersion}. TeamForge optimized the project path when required.";
            _diagnosticContext = _diagnosticContext with { Operation = "unity_open_started", StableErrorCode = "none" };
            AppendDiagnostic("unity_open_started");
            ClearFailure();
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or InvalidDataException or InvalidOperationException or TimeoutException or Win32Exception)
        {
            ClearPendingAccessCode();
            InvalidateReadyProject();
            ShowFailure(
                "Unity could not open the verified Active project safely. Receive it again before retrying.",
                "unity_open_failed",
                exception.Message);
        }
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

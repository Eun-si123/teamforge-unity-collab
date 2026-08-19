using Microsoft.Win32;
using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Windows;
using TeamForge.Launcher.Core;

namespace TeamForge.Launcher;

public partial class MainWindow : Window
{
    private readonly LauncherUserPaths _userPaths;
    private readonly LauncherStateStore _stateStore;
    private readonly DiagnosticHistory _diagnosticHistory = new();
    private BridgeClient? _bridge;
    private VerifiedActiveProject? _readyProject;
    private VerifiedExistingProject? _existingVerifiedProject;
    private JsonElement? _readyResult;
    private VerifiedUnityEditor? _explicitlyVerifiedEditor;
    private string? _verifiedServerHost;
    private string? _pendingAccessCode;
    private bool _runtimeReady;
    private bool _receiving;
    private bool _paused;
    private bool _closingAfterCleanup;
    private bool _trustDialogOpen;
    private DiagnosticContext _diagnosticContext = new()
    {
        ProductVersion = "0.5.1",
        LauncherVersion = "0.5.1",
        Role = "Guest",
        RuntimeManifestIdentity = RuntimePins.ManifestSha256,
    };

    public MainWindow()
    {
        InitializeComponent();
        _userPaths = LauncherPaths.ForCurrentUser();
        _stateStore = new LauncherStateStore(_userPaths);
        var state = _stateStore.Load();
        DestinationTextBox.Text = state.LastProjectsRoot ?? _userPaths.DefaultProjectsRoot;
        _diagnosticContext = _diagnosticContext with { ManagedRoot = DestinationTextBox.Text };
        UpdateButtons();
    }

    private async void Window_Loaded(object sender, RoutedEventArgs e)
    {
        if (!OperatingSystem.IsWindows() || RuntimeInformation.OSArchitecture != Architecture.X64)
        {
            SetFailure("This TeamForge Launcher package supports Windows x64 only.", "unsupported_platform", RuntimeInformation.OSDescription);
            return;
        }

        if (string.IsNullOrEmpty(_userPaths.StateDirectory))
        {
            SetFailure("Windows did not provide a safe local TeamForge data folder.", "local_state_unavailable", "Environment.SpecialFolder.LocalApplicationData was empty.");
            return;
        }

        try
        {
            AppendDiagnostic("runtime_verification_started");
            var trustPins = new RuntimeTrustPins(
                RuntimePins.ManifestSha256,
                RuntimePins.LoaderSha256,
                "0.5.1",
                1,
                "backend/project-peer/src/guest-orchestrator-cli.mjs");
            var runtime = await RuntimeLayoutVerifier.VerifyAsync(AppContext.BaseDirectory, trustPins);
            _bridge = BridgeClient.Start(runtime);
            _bridge.EventReceived += Bridge_EventReceived;
            _bridge.DiagnosticReceived += Bridge_DiagnosticReceived;
            var health = await _bridge.SendRequestAsync("health");
            var runtimeVersion = ReadString(health, "productVersion") ?? "unknown";
            _diagnosticContext = _diagnosticContext with
            {
                PackagedRuntimeVersion = runtimeVersion,
                RuntimeManifestIdentity = RuntimePins.ManifestSha256,
                Operation = "ready",
                StableErrorCode = "none",
                DetailedErrorMessage = string.Empty,
                TransferState = "idle",
            };
            _runtimeReady = true;
            StatusText.Text = "Ready. Paste the invite from your host.";
            AppendDiagnostic("runtime_verification_passed");
            UpdateButtons();
        }
        catch (RuntimeVerificationException exception)
        {
            _diagnosticContext = _diagnosticContext with { RuntimeVerificationStage = exception.Stage };
            SetFailure(
                "TeamForge Runtime is damaged.",
                "runtime_integrity_failed",
                exception.Message);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or InvalidDataException or InvalidOperationException or System.Security.Cryptography.CryptographicException)
        {
            SetFailure(
                "TeamForge's private runtime is missing, damaged, or incompatible. Reinstall this TeamForge Launcher package.",
                "runtime_integrity_failed",
                exception.Message);
        }
    }

    private async void Window_Closing(object? sender, CancelEventArgs e)
    {
        if (_closingAfterCleanup)
        {
            return;
        }

        e.Cancel = true;
        _closingAfterCleanup = true;
        ClearPendingAccessCode();
        try
        {
            if (_bridge is not null)
            {
                _bridge.EventReceived -= Bridge_EventReceived;
                _bridge.DiagnosticReceived -= Bridge_DiagnosticReceived;
                await _bridge.DisposeAsync();
                _bridge = null;
            }
        }
        catch (Exception exception) when (exception is IOException or InvalidOperationException or OperationCanceledException)
        {
            AppendDiagnostic($"runtime_shutdown_warning: {exception.Message}");
        }
        finally
        {
            Close();
        }
    }

    private void Invite_Changed(object sender, System.Windows.Controls.TextChangedEventArgs e)
    {
        PreviewBorder.Visibility = Visibility.Collapsed;
        InvalidateReadyProject();
        ClearFailure();
        UpdateButtons();
    }

    private void OpenInvite_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFileDialog
        {
            Title = "Open TeamForge invite",
            Filter = "TeamForge invite (*.json;*.teamforge)|*.json;*.teamforge|All files (*.*)|*.*",
            CheckFileExists = true,
            Multiselect = false,
        };
        if (dialog.ShowDialog(this) != true)
        {
            return;
        }

        try
        {
            var fullPath = Path.GetFullPath(dialog.FileName);
            PathSafety.RequireRegularFile(fullPath, 64 * 1024);
            InviteTextBox.Text = File.ReadAllText(fullPath, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true));
            StatusText.Text = "Invite loaded. Preview it before receiving the project.";
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or InvalidDataException)
        {
            ShowFailure("That invite file could not be opened safely.", "invite_file_invalid", exception.Message);
        }
    }

    private async void Preview_Click(object sender, RoutedEventArgs e)
    {
        if (_bridge is null)
        {
            return;
        }

        try
        {
            _diagnosticContext = _diagnosticContext with { Operation = "invite_inspection", TransferState = "inspecting" };
            var result = await InspectInviteAsync();
            RequireRealtimeSession(result);
            await CaptureInspectionStateAsync(result);
            _verifiedServerHost = ReadString(result, "serverHost");
            PreviewSummaryText.Text = FormatInvitePreview(result);
            PreviewBorder.Visibility = Visibility.Visible;
            StatusText.Text = "Invite verified. Review the publisher when TeamForge asks, then receive the project.";
            ClearFailure();
            AppendDiagnostic("invite_preview_verified");
        }
        catch (BridgeException exception)
        {
            ShowBridgeFailure(exception);
        }
        catch (Exception exception) when (exception is IOException or InvalidDataException or UnauthorizedAccessException or JsonException)
        {
            ShowFailure("This invite could not be verified safely.", "invite_invalid", exception.Message);
        }
    }

    private async Task<JsonElement> InspectInviteAsync()
    {
        var bridge = _bridge ?? throw new InvalidOperationException("The verified runtime is not ready.");
        var invite = RequireInviteText();
        var managedRoot = RequireManagedRoot();
        return await bridge.SendRequestAsync("inspect", new Dictionary<string, object?>
        {
            ["invite"] = invite,
            ["managedRoot"] = managedRoot,
            ["stateRoot"] = _userPaths.StateDirectory,
        });
    }

    private async Task CaptureInspectionStateAsync(JsonElement result)
    {
        var managedRoot = ReadString(result, "managedRoot") ?? RequireManagedRoot();
        var projectIdentity = ReadString(result, "projectIdentity") ?? ReadString(result, "projectUuid") ?? "unknown";
        var activePath = ReadString(result, "activePath") ?? string.Empty;
        var activeUnityVersion = ReadString(result, "activeUnityVersion") ?? string.Empty;
        var previousAvailable = ReadBoolean(result, "previousVerifiedActiveAvailable");
        _diagnosticContext = _diagnosticContext with
        {
            Operation = "invite_inspection",
            StableErrorCode = "none",
            DetailedErrorMessage = string.Empty,
            ProjectIdentity = projectIdentity,
            ManagedRoot = managedRoot,
            Endpoint = ReadString(result, "endpoint") ?? string.Empty,
            BaselineRevision = ReadInt64(result, "baselineRevision"),
            ActiveRevision = ReadInt64(result, "activeRevision"),
            ActivePath = activePath,
            UnityVersion = string.IsNullOrWhiteSpace(activeUnityVersion) ? _diagnosticContext.UnityVersion : activeUnityVersion,
            ProcessOwnershipState = "not_applicable_guest",
            CoordinatorSeedHealthIdentity = "not_connected",
            TransferState = "inspected",
            PreviousVerifiedActiveAvailable = previousAvailable,
        };

        _existingVerifiedProject = null;
        if (previousAvailable && !string.IsNullOrWhiteSpace(activePath) && !string.IsNullOrWhiteSpace(activeUnityVersion))
        {
            _existingVerifiedProject = await UnityLaunchPolicy.ValidateExistingActiveAsync(
                managedRoot,
                activePath,
                activeUnityVersion);
        }

        var projectUuid = ReadString(result, "projectUuid") ?? string.Empty;
        var localAssessment = UnityPathBudgetPolicy.Assess(managedRoot, projectUuid);
        if (ReadBoolean(result, "pathLengthHighRisk") || localAssessment.HighRisk)
        {
            _diagnosticContext = _diagnosticContext with
            {
                StableErrorCode = "none",
                DetailedErrorMessage = $"Estimated generated Unity path length: {Math.Max(ReadInt64(result, "estimatedGeneratedPathLength"), localAssessment.EstimatedGeneratedPathLength)}",
            };
            AppendDiagnostic("path_budget_risk_detected: automatic Unity path optimization will be selected after verification");
        }
    }

    private async void Receive_Click(object sender, RoutedEventArgs e)
    {
        if (_bridge is null || _receiving)
        {
            return;
        }

        var submittedAccessCode = string.IsNullOrWhiteSpace(AccessCodeBox.Password)
            ? null
            : AccessCodeBox.Password;
        AccessCodeBox.Clear();
        SetReceiving(true);
        InvalidateReadyProject();
        _pendingAccessCode = submittedAccessCode;
        submittedAccessCode = null;
        try
        {
            var invite = RequireInviteText();
            var managedRoot = RequireManagedRoot();
            var preview = await InspectInviteAsync();
            RequireRealtimeSession(preview);
            await CaptureInspectionStateAsync(preview);
            _verifiedServerHost = ReadString(preview, "serverHost");
            PreviewSummaryText.Text = FormatInvitePreview(preview);
            PreviewBorder.Visibility = Visibility.Visible;

            _stateStore.Save(new LauncherState(1, managedRoot, null));
            var values = new Dictionary<string, object?>
            {
                ["invite"] = invite,
                ["managedRoot"] = managedRoot,
                ["stateRoot"] = _userPaths.StateDirectory,
            };
            if (_pendingAccessCode is not null)
            {
                values["authenticationToken"] = _pendingAccessCode;
            }

            var receiveTask = _bridge.SendRequestAsync("start", values);
            values.Remove("authenticationToken");
            StatusText.Text = "Receiving the approved project…";
            _diagnosticContext = _diagnosticContext with { Operation = "project_receive", TransferState = "receiving" };
            var result = await receiveTask;
            _readyResult = result.Clone();
            _readyProject = await UnityLaunchPolicy.ValidateActiveResultAsync(managedRoot, _userPaths.StateDirectory, result);
            _diagnosticContext = _diagnosticContext with
            {
                Operation = "active_verified",
                StableErrorCode = "none",
                DetailedErrorMessage = string.Empty,
                UnityVersion = _readyProject.UnityVersion,
                ActivePath = _readyProject.ActivePath,
                BaselineRevision = ReadInt64(result, "baselineRevision"),
                ActiveRevision = ReadInt64(result, "baselineRevision"),
                TransferState = "complete",
                PreviousVerifiedActiveAvailable = true,
            };
            ReadySummaryText.Text = $"Approved project received and activated. Required Unity: {_readyProject.UnityVersion}";
            ReadyBorder.Visibility = Visibility.Visible;
            ClearFailure();
            UnityEditorTextBox.Text = UnityLaunchPolicy.FindStandardEditor(_readyProject.UnityVersion);
            StatusText.Text = "Project received and verified. Opening the exact Unity version…";
            AppendDiagnostic($"guest_active_verified: unity={_readyProject.UnityVersion}");
            SetReceiving(false);
            await TryOpenUnityAsync();
        }
        catch (BridgeException exception)
        {
            ClearPendingAccessCode();
            SetReceiving(false);
            ShowBridgeFailure(exception);
        }
        catch (Exception exception) when (exception is IOException or InvalidDataException or UnauthorizedAccessException or JsonException or InvalidOperationException)
        {
            ClearPendingAccessCode();
            SetReceiving(false);
            ShowFailure("TeamForge stopped before activating the project.", "guest_activation_failed", exception.Message);
        }
    }

    private async void Pause_Click(object sender, RoutedEventArgs e)
    {
        if (_bridge is null || !_receiving)
        {
            return;
        }

        try
        {
            var command = _paused ? "resume" : "pause";
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
            await _bridge.SendRequestAsync(command, cancellationToken: timeout.Token);
            _paused = !_paused;
            PauseButton.Content = _paused ? "Resume" : "Pause";
            StatusText.Text = _paused ? "Receiving paused. Verified progress is preserved." : "Receiving resumed.";
        }
        catch (BridgeException exception)
        {
            ShowBridgeFailure(exception);
        }
        catch (OperationCanceledException)
        {
            ShowFailure("TeamForge did not confirm the pause command.", "control_timeout", "The runtime control request timed out.");
        }
    }

    private async void Cancel_Click(object sender, RoutedEventArgs e)
    {
        if (_bridge is null || !_receiving)
        {
            return;
        }

        ClearPendingAccessCode();
        try
        {
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
            await _bridge.SendRequestAsync("cancel", cancellationToken: timeout.Token);
            StatusText.Text = "Receive cancelled. Verified progress is preserved for a later resume.";
        }
        catch (BridgeException exception)
        {
            ShowBridgeFailure(exception);
        }
        catch (OperationCanceledException)
        {
            ShowFailure("TeamForge did not confirm cancellation yet.", "control_timeout", "The runtime control request timed out.");
        }
    }

    private void ChooseDestination_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFolderDialog
        {
            Title = "Choose a TeamForge projects folder",
            Multiselect = false,
            InitialDirectory = Directory.Exists(DestinationTextBox.Text) ? DestinationTextBox.Text : _userPaths.DefaultProjectsRoot,
        };
        if (dialog.ShowDialog(this) != true)
        {
            return;
        }

        try
        {
            DestinationTextBox.Text = DestinationPolicy.ValidateManagedRoot(dialog.FolderName, AppContext.BaseDirectory);
            _diagnosticContext = _diagnosticContext with
            {
                ManagedRoot = DestinationTextBox.Text,
                Operation = "destination_selected",
                StableErrorCode = "none",
                DetailedErrorMessage = string.Empty,
            };
            _stateStore.Save(new LauncherState(1, DestinationTextBox.Text, null));
            InvalidateReadyProject();
            _existingVerifiedProject = null;
            ClearFailure();
            UpdateButtons();
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or InvalidDataException)
        {
            ShowFailure("Choose a regular local folder for TeamForge projects.", "destination_invalid", exception.Message);
        }
    }

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

        try
        {
            StatusText.Text = $"Verifying Unity {requiredUnityVersion}…";
            _explicitlyVerifiedEditor = await UnityLaunchPolicy.VerifyEditorAsync(dialog.FileName, requiredUnityVersion);
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

    private void RetryRecovery_Click(object sender, RoutedEventArgs e)
    {
        if (_runtimeReady && !_receiving)
        {
            Receive_Click(sender, e);
        }
    }

    private void PasteNewInviteRecovery_Click(object sender, RoutedEventArgs e)
    {
        InvalidateReadyProject();
        _existingVerifiedProject = null;
        InviteTextBox.Clear();
        InviteTextBox.Focus();
        StatusText.Text = "Paste the new signed Collaboration Invite from your Host.";
        ClearFailure();
    }

    private void EnterAccessCodeRecovery_Click(object sender, RoutedEventArgs e)
    {
        AdvancedExpander.IsExpanded = true;
        AccessCodeBox.Clear();
        AccessCodeBox.Focus();
        StatusText.Text = "Enter the access code again, then retry. It will remain only in memory.";
    }

    private void UseLatestProjectRecovery_Click(object sender, RoutedEventArgs e)
    {
        if (_runtimeReady && !_receiving)
        {
            Receive_Click(sender, e);
        }
    }

    private async void OpenExistingProjectRecovery_Click(object sender, RoutedEventArgs e)
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
            var existing = await UnityLaunchPolicy.ValidateExistingActiveAsync(
                _existingVerifiedProject.ProjectsRoot,
                _existingVerifiedProject.ActivePath,
                _existingVerifiedProject.UnityVersion);
            var editor = _explicitlyVerifiedEditor;
            if (editor is null)
            {
                var standard = UnityLaunchPolicy.FindStandardEditor(existing.UnityVersion);
                if (string.IsNullOrEmpty(standard) || !File.Exists(standard))
                {
                    _diagnosticContext = _diagnosticContext with { UnityVersion = existing.UnityVersion };
                    ShowFailure(
                        "Unity version is not installed or cannot be found.",
                        "unity_editor_missing",
                        $"Expected Unity executable: {standard}");
                    return;
                }
                editor = await UnityLaunchPolicy.VerifyEditorAsync(standard, existing.UnityVersion);
            }

            var startInfo = UnityLaunchPolicy.CreateExistingProjectOpenStartInfo(editor, existing);
            using var unity = Process.Start(startInfo) ?? throw new InvalidOperationException("Unity did not start.");
            ClearPendingAccessCode();
            StatusText.Text = $"Opened the existing verified project in Unity {existing.UnityVersion} without joining the failed session.";
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

    private void CopyDiagnostics_Click(object sender, RoutedEventArgs e)
    {
        var bundle = _diagnosticHistory.BuildCopyBundle(
            _diagnosticContext,
            _pendingAccessCode,
            AccessCodeBox.Password);
        Clipboard.SetText(bundle);
        StatusText.Text = "Diagnostics copied. Access codes and credentials were redacted.";
    }

    private async Task TryOpenUnityAsync()
    {
        if (_readyProject is null || _readyResult is null)
        {
            return;
        }

        try
        {
            _readyProject = await UnityLaunchPolicy.ValidateActiveResultAsync(
                _readyProject.ProjectsRoot,
                _userPaths.StateDirectory,
                _readyResult.Value);
            var editor = _explicitlyVerifiedEditor;
            if (editor is null)
            {
                var standardEditor = UnityLaunchPolicy.FindStandardEditor(_readyProject.UnityVersion);
                if (string.IsNullOrEmpty(standardEditor) || !File.Exists(standardEditor))
                {
                    _diagnosticContext = _diagnosticContext with { UnityVersion = _readyProject.UnityVersion };
                    ShowFailure(
                        "Unity version is not installed or cannot be found.",
                        "unity_editor_missing",
                        $"Expected Unity executable: {standardEditor}");
                    AppendDiagnostic($"unity_editor_missing: {_readyProject.UnityVersion}");
                    return;
                }

                editor = await UnityLaunchPolicy.VerifyEditorAsync(standardEditor, _readyProject.UnityVersion);
            }

            var sourceProject = _readyProject;
            var launchProject = await UnityLaunchPolicy.RefreshHandoffForUnityLaunchAsync(sourceProject);
            try
            {
                var preparedPath = await UnityPathStrategy.PrepareAsync(launchProject);
                var startInfo = UnityLaunchPolicy.CreateUnityOpenStartInfo(editor, launchProject, _pendingAccessCode, preparedPath);
                try
                {
                    using var unity = Process.Start(startInfo) ?? throw new InvalidOperationException("Unity did not start.");
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

    private void Bridge_EventReceived(object? sender, BridgeEventArgs e)
    {
        Dispatcher.BeginInvoke(async () => await HandleBridgeEventAsync(e));
    }

    private void Bridge_DiagnosticReceived(object? sender, string e)
    {
        Dispatcher.BeginInvoke(() => AppendDiagnostic("runtime_stderr: internal runtime reported a diagnostic"));
    }

    private async Task HandleBridgeEventAsync(BridgeEventArgs e)
    {
        var name = e.EventName.Replace('-', '_').ToLowerInvariant();
        switch (name)
        {
            case "progress":
                UpdateProgress(e.Message);
                _diagnosticContext = _diagnosticContext with { Operation = "project_receive", TransferState = "receiving" };
                break;
            case "state":
                var stateName = ReadString(e.Message, "state") ?? "receiving";
                StatusText.Text = ReadString(e.Message, "message") ?? stateName;
                _diagnosticContext = _diagnosticContext with { Operation = stateName, TransferState = stateName };
                AppendDiagnostic($"guest_state: {stateName}");
                break;
            case "trust":
                await HandleTrustAsync(e.Message);
                break;
            case "paused":
                _paused = true;
                PauseButton.Content = "Resume";
                StatusText.Text = "Receiving paused. Verified progress is preserved.";
                break;
            case "resumed":
                _paused = false;
                PauseButton.Content = "Pause";
                StatusText.Text = "Receiving resumed.";
                break;
            case "diagnostic":
                var diagnosticCode = ReadString(e.Message, "code") ?? "guest_diagnostic";
                AppendDiagnostic($"{diagnosticCode}: {ReadString(e.Message, "message") ?? string.Empty}");
                break;
        }
    }

    private async Task HandleTrustAsync(JsonElement message)
    {
        if (_bridge is null || _trustDialogOpen)
        {
            return;
        }

        _trustDialogOpen = true;
        try
        {
            var presentation = TrustPresentation.FromBridgeEvent(message);
            var hostLine = string.IsNullOrWhiteSpace(_verifiedServerHost) ? string.Empty : $"\nHost: {DisplayBounded(_verifiedServerHost, 256)}";
            var dialog = new TrustDialog(presentation.FriendlyText + hostLine, presentation.AdvancedText + hostLine) { Owner = this };
            var approved = dialog.ShowDialog() == true;
            await _bridge.SendRequestAsync("trust", new Dictionary<string, object?>
            {
                ["challengeId"] = presentation.ChallengeId,
                ["approved"] = approved,
            });
            AppendDiagnostic(approved ? "publisher_trust_approved" : "publisher_trust_declined");
        }
        catch (BridgeException exception)
        {
            ShowBridgeFailure(exception);
        }
        catch (InvalidDataException exception)
        {
            ShowFailure(
                "TeamForge could not confirm publisher trust safely. Receiving was stopped.",
                "trust_challenge_invalid",
                exception.Message);
            try
            {
                using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
                await _bridge.SendRequestAsync("cancel", cancellationToken: timeout.Token);
            }
            catch (Exception cancelException) when (cancelException is BridgeException or IOException or InvalidOperationException or OperationCanceledException)
            {
                AppendDiagnostic("trust_cancel_failed");
            }
        }
        finally
        {
            _trustDialogOpen = false;
        }
    }

    private void UpdateProgress(JsonElement message)
    {
        var percent = ReadDouble(message, "percent");
        if (percent is null)
        {
            var completed = ReadDouble(message, "completedBytes") ?? ReadDouble(message, "receivedBytes");
            var total = ReadDouble(message, "totalBytes");
            if (completed is not null && total is > 0)
            {
                percent = completed.Value / total.Value * 100.0;
            }
        }

        if (percent is not null)
        {
            ReceiveProgress.IsIndeterminate = false;
            ReceiveProgress.Value = Math.Clamp(percent.Value, 0, 100);
        }
        else
        {
            ReceiveProgress.IsIndeterminate = true;
        }

        var messageText = ReadString(message, "message") ?? ReadString(message, "stage");
        if (!string.IsNullOrWhiteSpace(messageText))
        {
            StatusText.Text = messageText;
        }
    }

    private string RequireInviteText()
    {
        var invite = InviteTextBox.Text.Trim();
        if (invite.Length == 0 || Encoding.UTF8.GetByteCount(invite) > 64 * 1024)
        {
            throw new InvalidDataException("Paste one TeamForge invite no larger than 64 KiB.");
        }

        return invite;
    }

    private string RequireManagedRoot()
    {
        return DestinationPolicy.ValidateManagedRoot(DestinationTextBox.Text, AppContext.BaseDirectory);
    }

    private void SetReceiving(bool receiving)
    {
        _receiving = receiving;
        _paused = false;
        PauseButton.Content = "Pause";
        ReceiveProgress.IsIndeterminate = receiving;
        if (!receiving && _readyProject is not null)
        {
            ReceiveProgress.IsIndeterminate = false;
            ReceiveProgress.Value = 100;
        }

        UpdateButtons();
    }

    private void UpdateButtons()
    {
        var hasInput = !string.IsNullOrWhiteSpace(InviteTextBox.Text) && !string.IsNullOrWhiteSpace(DestinationTextBox.Text);
        PreviewButton.IsEnabled = _runtimeReady && !_receiving && hasInput;
        ReceiveButton.IsEnabled = _runtimeReady && !_receiving && hasInput;
        PauseButton.IsEnabled = _runtimeReady && _receiving;
        CancelButton.IsEnabled = _runtimeReady && _receiving;
        InviteTextBox.IsEnabled = !_receiving;
        OpenInviteButton.IsEnabled = !_receiving;
        ChooseDestinationButton.IsEnabled = !_receiving;
        AccessCodeBox.IsEnabled = !_receiving && _readyProject is null;
        OpenUnityButton.IsEnabled = _readyProject is not null && !_receiving;
        ChooseUnityButton.IsEnabled = (_readyProject is not null || _existingVerifiedProject is not null) && !_receiving;
    }

    private void InvalidateReadyProject()
    {
        ClearPendingAccessCode();
        _readyProject = null;
        _existingVerifiedProject = null;
        _readyResult = null;
        _explicitlyVerifiedEditor = null;
        _verifiedServerHost = null;
        ReadyBorder.Visibility = Visibility.Collapsed;
        UpdateButtons();
    }

    private void ClearPendingAccessCode()
    {
        _pendingAccessCode = null;
        AccessCodeBox.Clear();
    }

    private static string FormatInvitePreview(JsonElement result)
    {
        var project = ReadString(result, "projectId") ?? ReadString(result, "projectName") ?? "TeamForge project";
        var uuid = ReadString(result, "projectUuid") ?? "unknown";
        var revision = ReadNumberText(result, "baselineRevision") ?? "unknown";
        var publisher = ReadString(result, "publisherFingerprint") ?? ReadString(result, "publisherKeyId") ?? "shown at trust confirmation";
        var serverHost = ReadString(result, "serverHost") ?? "unknown";
        if (publisher.Length > 20)
        {
            publisher = publisher[..20] + "…";
        }

        return $"Project: {project}\nProject UUID: {uuid}\nApproved Baseline: revision {revision}\nHost: {DisplayBounded(serverHost, 256)}\nPublisher: {publisher}";
    }

    private static void RequireRealtimeSession(JsonElement result)
    {
        if (!result.TryGetProperty("includesRealtimeSession", out var included) || included.ValueKind != JsonValueKind.True)
        {
            throw new BridgeException(
                "realtime_session_missing",
                "This is an older transfer-only invite and cannot complete one-click collaboration.",
                "Ask the host to create a new TeamForge Host Ready invite.",
                "inspect.includesRealtimeSession was not true");
        }
    }

    private void ShowBridgeFailure(BridgeException exception)
    {
        if (exception.Diagnostics is JsonElement diagnostics)
        {
            ApplyBridgeDiagnostics(diagnostics);
        }
        ShowFailure(exception.UserMessage, exception.Code, exception.AdvancedDetail);
    }

    private void SetFailure(string userMessage, string code, string advancedDetail)
    {
        _runtimeReady = false;
        ShowFailure(userMessage, code, advancedDetail);
        UpdateButtons();
    }

    private void ShowFailure(string userMessage, string code, string advancedDetail)
    {
        _diagnosticContext = _diagnosticContext with
        {
            StableErrorCode = code,
            DetailedErrorMessage = DiagnosticHistory.Redact(advancedDetail, _pendingAccessCode, AccessCodeBox.Password),
        };
        var presentation = RecoveryUx.Resolve(code, _diagnosticContext);
        FailureTitleText.Text = presentation.Title;
        FailureMessageText.Text = presentation.Message;
        FailureCodeText.Text = $"Code: {code}";
        FailureBorder.Visibility = Visibility.Visible;
        SetRecoveryActionVisibility(presentation.Actions);
        StatusText.Text = string.IsNullOrWhiteSpace(userMessage) ? presentation.Title : userMessage;
        AppendDiagnostic($"{code}: {advancedDetail}");
    }

    private void AppendDiagnostic(string line)
    {
        if (string.IsNullOrWhiteSpace(line))
        {
            return;
        }

        var codeSeparator = line.IndexOf(':');
        var code = codeSeparator > 0 ? line[..codeSeparator] : "event";
        var safeLine = DiagnosticHistory.Redact(line, _pendingAccessCode, AccessCodeBox.Password);
        _diagnosticHistory.Add(_diagnosticContext.Operation, code, safeLine, _pendingAccessCode, AccessCodeBox.Password);
        var combined = string.IsNullOrEmpty(DiagnosticsTextBox.Text)
            ? safeLine
            : DiagnosticsTextBox.Text + Environment.NewLine + safeLine;
        if (combined.Length > 64 * 1024)
        {
            combined = combined[^ (64 * 1024)..];
        }

        DiagnosticsTextBox.Text = combined;
        DiagnosticsTextBox.ScrollToEnd();
    }

    private void ApplyBridgeDiagnostics(JsonElement diagnostics)
    {
        _diagnosticContext = _diagnosticContext with
        {
            Operation = ReadString(diagnostics, "operation") ?? _diagnosticContext.Operation,
            ProjectIdentity = ReadString(diagnostics, "projectIdentity") ?? _diagnosticContext.ProjectIdentity,
            ManagedRoot = ReadString(diagnostics, "managedRoot") ?? _diagnosticContext.ManagedRoot,
            Endpoint = ReadString(diagnostics, "endpoint") ?? _diagnosticContext.Endpoint,
            ActivePath = ReadString(diagnostics, "activePath") ?? _diagnosticContext.ActivePath,
            UnityVersion = ReadString(diagnostics, "unityVersion") ?? _diagnosticContext.UnityVersion,
            ProcessOwnershipState = ReadString(diagnostics, "processOwnershipState") ?? _diagnosticContext.ProcessOwnershipState,
            CoordinatorSeedHealthIdentity = ReadString(diagnostics, "coordinatorSeedHealthIdentity") ?? _diagnosticContext.CoordinatorSeedHealthIdentity,
            TransferState = ReadString(diagnostics, "transferState") ?? _diagnosticContext.TransferState,
            StagingPath = ReadString(diagnostics, "stagingPath") ?? _diagnosticContext.StagingPath,
            RuntimeVerificationStage = ReadString(diagnostics, "runtimeVerificationStage") ?? _diagnosticContext.RuntimeVerificationStage,
            InviteProductVersion = ReadString(diagnostics, "inviteProductVersion") ?? _diagnosticContext.InviteProductVersion,
            PackagedRuntimeVersion = ReadString(diagnostics, "runtimeProductVersion") ?? _diagnosticContext.PackagedRuntimeVersion,
            BaselineRevision = ReadInt64(diagnostics, "baselineRevision", _diagnosticContext.BaselineRevision),
            ActiveRevision = ReadInt64(diagnostics, "activeRevision", _diagnosticContext.ActiveRevision),
            PreviousVerifiedActiveAvailable = ReadBoolean(
                diagnostics,
                "previousVerifiedActiveAvailable",
                _diagnosticContext.PreviousVerifiedActiveAvailable),
        };
    }

    private void SetRecoveryActionVisibility(IReadOnlyList<RecoveryActionKind> actions)
    {
        var selected = actions.ToHashSet();
        RetryButton.Visibility = selected.Contains(RecoveryActionKind.Retry) ? Visibility.Visible : Visibility.Collapsed;
        PasteNewInviteButton.Visibility = selected.Contains(RecoveryActionKind.PasteNewInvite) ? Visibility.Visible : Visibility.Collapsed;
        EnterAccessCodeButton.Visibility = selected.Contains(RecoveryActionKind.EnterAccessCodeAgain) ? Visibility.Visible : Visibility.Collapsed;
        UseLatestProjectButton.Visibility = selected.Contains(RecoveryActionKind.UseLatestProject) ? Visibility.Visible : Visibility.Collapsed;
        OpenExistingProjectButton.Visibility = selected.Contains(RecoveryActionKind.OpenExistingVerifiedProject) ? Visibility.Visible : Visibility.Collapsed;
        ChooseUnityRecoveryButton.Visibility = selected.Contains(RecoveryActionKind.ChooseUnityExecutable) ? Visibility.Visible : Visibility.Collapsed;
        ChooseShorterLocationButton.Visibility = selected.Contains(RecoveryActionKind.ChooseShorterProjectLocation) ? Visibility.Visible : Visibility.Collapsed;
        CopyDiagnosticsRecoveryButton.Visibility = Visibility.Visible;
    }

    private void ClearFailure()
    {
        FailureBorder.Visibility = Visibility.Collapsed;
    }

    private void Advanced_Expanded(object sender, RoutedEventArgs e)
    {
        DiagnosticsTextBox.ScrollToEnd();
    }

    private static string? ReadString(JsonElement element, string name)
    {
        return element.TryGetProperty(name, out var property) && property.ValueKind == JsonValueKind.String
            ? property.GetString()
            : null;
    }

    private static string? ReadNumberText(JsonElement element, string name)
    {
        return element.TryGetProperty(name, out var property) && property.ValueKind == JsonValueKind.Number
            ? property.GetRawText()
            : ReadString(element, name);
    }

    private static bool ReadBoolean(JsonElement element, string name, bool fallback = false)
    {
        return element.TryGetProperty(name, out var property)
            ? property.ValueKind switch
            {
                JsonValueKind.True => true,
                JsonValueKind.False => false,
                _ => fallback,
            }
            : fallback;
    }

    private static long ReadInt64(JsonElement element, string name, long fallback = 0)
    {
        if (element.TryGetProperty(name, out var property))
        {
            if (property.ValueKind == JsonValueKind.Number && property.TryGetInt64(out var number)) return number;
            if (property.ValueKind == JsonValueKind.String && long.TryParse(property.GetString(), out number)) return number;
        }
        return fallback;
    }

    private static double? ReadDouble(JsonElement element, string name)
    {
        if (element.TryGetProperty(name, out var property) && property.ValueKind == JsonValueKind.Number && property.TryGetDouble(out var value))
        {
            return value;
        }

        if (element.TryGetProperty(name, out property)
            && property.ValueKind == JsonValueKind.String
            && double.TryParse(property.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out value))
        {
            return value;
        }

        return null;
    }

    private static string DisplayBounded(string value, int maximumCharacters)
    {
        return value.Length <= maximumCharacters ? value : value[..maximumCharacters] + "…";
    }
}

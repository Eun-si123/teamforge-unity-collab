using Microsoft.Win32;
using System.ComponentModel;
using System.Diagnostics;
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
    private long _receiveEpoch;
    private bool _pauseCommandPending;
    private bool _cancelCommandPending;
    private bool _cancellingReceive;
    private bool _closing;
    private bool _closingAfterCleanup;
    private bool _trustDialogOpen;
    private PreviewOperation? _previewOperation;
    // Private WPF test seam; production always uses the modal TrustDialog.
    private Func<TrustPresentation, bool>? _confirmTrustForTests = null;
    // Private validation seam, matching the Unity-operation lifecycle tests.
    // Production always uses the existing Core policy, never caller code.
    private Func<string, JsonElement, CancellationToken, Task<VerifiedExistingProject>> _validateInspectionExisting =
        ValidateInspectionExistingAsync;
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
        if (_closing) return;

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
            await InitializeRuntimeAsync(
                () => RuntimeLayoutVerifier.VerifyAsync(AppContext.BaseDirectory, trustPins),
                BridgeClient.Start);
        }
        catch (RuntimeVerificationException exception)
        {
            if (_closing) return;
            _diagnosticContext = _diagnosticContext with { RuntimeVerificationStage = exception.Stage };
            SetFailure(
                "TeamForge Runtime is damaged.",
                "runtime_integrity_failed",
                exception.Message);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or InvalidDataException or InvalidOperationException or BridgeException or System.Security.Cryptography.CryptographicException)
        {
            if (_closing) return;
            SetFailure(
                "TeamForge's private runtime is missing, damaged, or incompatible. Reinstall this TeamForge Launcher package.",
                "runtime_integrity_failed",
                exception.Message);
        }
    }

    private async Task InitializeRuntimeAsync(
        Func<Task<VerifiedRuntimeLayout>> verifyRuntime,
        Func<VerifiedRuntimeLayout, BridgeClient> startBridge)
    {
        // Both delegates are private lifecycle seams. Production always supplies
        // the pinned verifier and BridgeClient.Start, never caller-provided code.
        if (_closing) return;
        var runtime = await verifyRuntime();
        if (_closing) return;
        _bridge = startBridge(runtime);
        _bridge.EventReceived += Bridge_EventReceived;
        _bridge.DiagnosticReceived += Bridge_DiagnosticReceived;
        JsonElement health;
        try
        {
            health = await _bridge.SendRequestAsync("health");
        }
        catch (BridgeException) when (_closing)
        {
            // Dispose settles a pending health request with runtime_shutdown.
            return;
        }
        if (_closing) return;
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

    private async void Window_Closing(object? sender, CancelEventArgs e)
    {
        if (_closingAfterCleanup)
        {
            return;
        }

        e.Cancel = true;
        if (_closing) return;
        _closing = true;
        RetirePreview();
        var unityOperation = _unityOperation;
        unityOperation?.Cancel();
        _runtimeReady = false;
        ((UIElement)Content).IsEnabled = false;
        StatusText.Text = "Closing TeamForge…";
        ClearPendingAccessCode(clearUserInput: true);
        UpdateButtons();
        try
        {
            if (_bridge is not null)
            {
                _bridge.EventReceived -= Bridge_EventReceived;
                _bridge.DiagnosticReceived -= Bridge_DiagnosticReceived;
                await _bridge.DisposeAsync();
            }
        }
        catch (Exception exception) when (exception is IOException or InvalidOperationException or OperationCanceledException)
        {
            AppendDiagnostic($"runtime_shutdown_warning: {exception.Message}");
        }
        finally
        {
            if (unityOperation is not null) await unityOperation.Completion.Task;
            _bridge = null;
            _closingAfterCleanup = true;
            // With no bridge, cleanup finishes inside the first Closing event.
            // Let that cancelled event unwind before issuing the final Close.
            _ = Dispatcher.BeginInvoke(new Action(Close));
        }
    }

    private void Invite_Changed(object sender, System.Windows.Controls.TextChangedEventArgs e)
    {
        // An access code for one signed invite must never be reused after the invite changes.
        ClearPendingAccessCode(clearUserInput: true);
        PreviewBorder.Visibility = Visibility.Collapsed;
        InvalidateReadyProject();
        ClearFailure();
        UpdateButtons();
    }

    private void RememberCodeForRetries_Unchecked(object sender, RoutedEventArgs e)
    {
        // The checkbox doubles as an explicit forget action, even before Receive.
        ClearPendingAccessCode(clearUserInput: true);
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

    private async void Preview_Click(object sender, RoutedEventArgs e) => await PreviewAsync();

    private async Task PreviewAsync()
    {
        if (_closing || _bridge is null || _receiving || _unityOperation is not null || _previewOperation is not null)
        {
            return;
        }

        var operation = new PreviewOperation(InviteTextBox.Text, DestinationTextBox.Text, _unityProjectContext);
        _previewOperation = operation;
        PreviewBorder.Visibility = Visibility.Collapsed;
        UpdateButtons();
        try
        {
            _diagnosticContext = _diagnosticContext with { Operation = "invite_inspection", TransferState = "inspecting" };
            var result = await InspectInviteAsync(operation.Token);
            if (!IsCurrentPreview(operation)) return;
            RequireRealtimeSession(result);
            await CaptureInspectionStateAsync(result, () => IsCurrentPreview(operation), operation.Token);
            if (!IsCurrentPreview(operation)) return;
            _verifiedServerHost = ReadString(result, "serverHost");
            PreviewSummaryText.Text = FormatInvitePreview(result);
            PreviewBorder.Visibility = Visibility.Visible;
            StatusText.Text = "Invite verified. Review the publisher when TeamForge asks, then receive the project.";
            ClearFailure();
            AppendDiagnostic("invite_preview_verified");
        }
        catch (OperationCanceledException) when (!IsCurrentPreview(operation)) { }
        catch (BridgeException exception)
        {
            if (IsCurrentPreview(operation)) ShowBridgeFailure(exception);
        }
        catch (Exception exception) when (exception is IOException or InvalidDataException or UnauthorizedAccessException or JsonException or InvalidOperationException)
        {
            if (IsCurrentPreview(operation))
                ShowFailure("This invite could not be verified safely.", "invite_invalid", exception.Message);
        }
        finally
        {
            if (ReferenceEquals(_previewOperation, operation))
            {
                _previewOperation = null;
                if (!_closing) UpdateButtons();
            }
            operation.Dispose();
        }
    }

    private bool IsCurrentPreview(PreviewOperation operation) =>
        !_closing && !_receiving && _unityOperation is null &&
        ReferenceEquals(_previewOperation, operation) &&
        ReferenceEquals(_unityProjectContext, operation.ProjectContext) &&
        !operation.Token.IsCancellationRequested &&
        string.Equals(InviteTextBox.Text, operation.Invite, StringComparison.Ordinal) &&
        string.Equals(DestinationTextBox.Text, operation.ManagedRoot, StringComparison.Ordinal);

    private void RetirePreview()
    {
        var operation = _previewOperation;
        _previewOperation = null;
        operation?.Cancel();
        PreviewBorder.Visibility = Visibility.Collapsed;
    }

    private sealed class PreviewOperation(string invite, string managedRoot, object projectContext) : IDisposable
    {
        private readonly CancellationTokenSource _cancellation = new();
        public string Invite { get; } = invite;
        public string ManagedRoot { get; } = managedRoot;
        public object ProjectContext { get; } = projectContext;
        public CancellationToken Token => _cancellation.Token;
        public void Cancel() => _cancellation.Cancel();
        public void Dispose() => _cancellation.Dispose();
    }

    private async Task<JsonElement> InspectInviteAsync(CancellationToken cancellationToken = default)
    {
        var bridge = _bridge ?? throw new InvalidOperationException("The verified runtime is not ready.");
        var invite = RequireInviteText();
        var managedRoot = RequireManagedRoot();
        return await bridge.SendRequestAsync("inspect", new Dictionary<string, object?>
        {
            ["invite"] = invite,
            ["managedRoot"] = managedRoot,
            ["stateRoot"] = _userPaths.StateDirectory,
        }, cancellationToken);
    }

    private async Task CaptureInspectionStateAsync(JsonElement result, Func<bool>? isCurrent = null, CancellationToken cancellationToken = default)
    {
        if (isCurrent is not null && !isCurrent()) return;
        var managedRoot = ReadString(result, "managedRoot") ?? RequireManagedRoot();
        var projectIdentity = ReadString(result, "projectIdentity") ?? ReadString(result, "projectUuid") ?? "unknown";
        var activePath = ReadString(result, "activePath") ?? string.Empty;
        var activeUnityVersion = ReadString(result, "activeUnityVersion") ?? string.Empty;
        var previousAvailable = ReadBoolean(result, "previousVerifiedActiveAvailable");
        VerifiedExistingProject? existing = null;
        if (previousAvailable && !string.IsNullOrWhiteSpace(activePath) && !string.IsNullOrWhiteSpace(activeUnityVersion))
            existing = await _validateInspectionExisting(managedRoot, result, cancellationToken);
        if (isCurrent is not null && !isCurrent()) return;
        var projectUuid = ReadString(result, "projectUuid") ?? string.Empty;
        var localAssessment = UnityPathBudgetPolicy.Assess(managedRoot, projectUuid);

        // Validation above can outlive the input or receive lifetime. Publish
        // the completed local snapshot only after its owner is still current.
        _existingVerifiedProject = existing;
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

    private static Task<VerifiedExistingProject> ValidateInspectionExistingAsync(
        string managedRoot, JsonElement result, CancellationToken cancellationToken) =>
        UnityLaunchPolicy.ValidateExistingActiveAsync(
            managedRoot,
            ReadString(result, "activePath") ?? string.Empty,
            ReadString(result, "activeUnityVersion") ?? string.Empty,
            ReadString(result, "projectUuid") ?? string.Empty,
            ReadInt64(result, "activeRevision"),
            ReadString(result, "activeManifestHash") ?? string.Empty,
            cancellationToken);

    private async void Receive_Click(object sender, RoutedEventArgs e) => await ReceiveAsync();

    private async Task ReceiveAsync()
    {
        if (_closing || _unityOperation is not null || _bridge is null || _receiving)
        {
            return;
        }

        var submittedAccessCode = string.IsNullOrWhiteSpace(AccessCodeBox.Password)
            ? null
            : AccessCodeBox.Password;
        if (RememberCodeForRetriesCheckBox.IsChecked != true)
        {
            AccessCodeBox.Clear();
        }
        SetReceiving(true);
        var epoch = _receiveEpoch;
        InvalidateReadyProject();
        _pendingAccessCode = submittedAccessCode;
        submittedAccessCode = null;
        try
        {
            var invite = RequireInviteText();
            var managedRoot = RequireManagedRoot();
            var preview = await InspectInviteAsync();
            if (!ContinueReceiveAfterInspection(epoch)) return;
            RequireRealtimeSession(preview);
            await CaptureInspectionStateAsync(preview, () => IsCurrentReceive(epoch) && !_cancellingReceive);
            if (!ContinueReceiveAfterInspection(epoch)) return;
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
            await CompleteReceiveAsync(managedRoot, result, epoch);
        }
        catch (BridgeException exception)
        {
            if (!IsCurrentReceive(epoch)) return;
            try
            {
                var wasCancelling = _cancellingReceive;
                SetReceiving(false);
                if (wasCancelling)
                    ShowFailure("Receive stopped while cancellation was pending. Check project state before retrying.",
                        "receive_interrupted", "The runtime receive ended during cancellation.");
                else ShowBridgeFailure(exception);
            }
            finally
            {
                // Keep the working code available for diagnostic redaction, then retire it.
                ClearPendingAccessCode();
            }
        }
        catch (Exception exception) when (exception is IOException or InvalidDataException or UnauthorizedAccessException or JsonException or InvalidOperationException)
        {
            if (!IsCurrentReceive(epoch)) return;
            try
            {
                var wasCancelling = _cancellingReceive;
                SetReceiving(false);
                if (wasCancelling)
                    ShowFailure("Receive stopped while cancellation was pending. Check project state before retrying.",
                        "receive_interrupted", "The local receive ended during cancellation.");
                else ShowFailure("TeamForge stopped before activating the project.", "guest_activation_failed", exception.Message);
            }
            finally
            {
                ClearPendingAccessCode();
            }
        }
    }

    private bool ContinueReceiveAfterInspection(long epoch)
    {
        if (!IsCurrentReceive(epoch)) return false;
        if (!_cancellingReceive) return true;
        ClearPendingAccessCode();
        _diagnosticContext = _diagnosticContext with { TransferState = "cancelled" };
        SetReceiving(false);
        StatusText.Text = "Receive cancelled before transfer started. Verified progress is preserved.";
        return false;
    }

    private async Task CompleteReceiveAsync(string managedRoot, JsonElement result, long epoch)
    {
        if (!IsCurrentReceive(epoch)) return;
        var project = await _unityLaunchOperations.ValidateActive(managedRoot, _userPaths.StateDirectory, result, CancellationToken.None);
        if (!IsCurrentReceive(epoch)) return;
        _readyResult = result.Clone();
        _readyProject = project;
        _diagnosticContext = _diagnosticContext with
        {
            Operation = "active_verified",
            StableErrorCode = "none",
            DetailedErrorMessage = string.Empty,
            UnityVersion = project.UnityVersion,
            ActivePath = project.ActivePath,
            BaselineRevision = ReadInt64(result, "baselineRevision"),
            ActiveRevision = ReadInt64(result, "baselineRevision"),
            TransferState = "complete",
            PreviousVerifiedActiveAvailable = true,
        };
        ReadySummaryText.Text = $"Approved project received and activated. Required Unity: {project.UnityVersion}";
        ReadyBorder.Visibility = Visibility.Visible;
        ClearFailure();
        UnityEditorTextBox.Text = UnityLaunchPolicy.FindStandardEditor(project.UnityVersion);
        var openAutomatically = !_cancellingReceive;
        StatusText.Text = openAutomatically ? "Project received and verified. Opening the exact Unity version…"
            : "Project received and verified. Automatic Unity opening was cancelled; you can open it when ready.";
        AppendDiagnostic($"guest_active_verified: unity={project.UnityVersion}");
        SetReceiving(false);
        if (openAutomatically) await TryOpenUnityAsync();
    }

    private async void Pause_Click(object sender, RoutedEventArgs e) => await SendReceiveControlAsync(false);

    private async void Cancel_Click(object sender, RoutedEventArgs e) => await SendReceiveControlAsync(true);

    private bool IsCurrentReceive(long epoch) => !_closing && _receiving && _receiveEpoch == epoch;

    private async Task SendReceiveControlAsync(bool cancel)
    {
        if (_closing || _bridge is null || !_receiving ||
            (cancel ? _cancelCommandPending : _pauseCommandPending || _cancellingReceive)) return;
        var epoch = _receiveEpoch;
        var command = cancel ? "cancel" : _paused ? "resume" : "pause";
        if (cancel)
        {
            _cancelCommandPending = true;
            _cancellingReceive = true;
            ClearPendingAccessCode();
            _diagnosticContext = _diagnosticContext with { TransferState = "cancelling" };
            StatusText.Text = "Cancelling receive. Verified progress will be preserved…";
        }
        else _pauseCommandPending = true;
        UpdateButtons();
        try
        {
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
            await _bridge.SendRequestAsync(command, cancellationToken: timeout.Token);
            if (!IsCurrentReceive(epoch) || (!cancel && _cancellingReceive)) return;
            if (cancel) StatusText.Text = "Receive cancelled. Verified progress is preserved for a later resume.";
            else
            {
                // A runtime event may precede its ACK; apply the requested state.
                _paused = command == "pause";
                PauseButton.Content = _paused ? "Resume" : "Pause";
                StatusText.Text = _paused ? "Receiving paused. Verified progress is preserved." : "Receiving resumed.";
            }
        }
        catch (BridgeException exception)
        {
            if (IsCurrentReceive(epoch) && (cancel || !_cancellingReceive))
            {
                // Cancel already retired the credential. Do not present untrusted
                // ACK diagnostics that might echo it after the redaction key is gone.
                if (cancel) ShowFailure("TeamForge could not confirm cancellation safely.",
                    "receive_control_failed", "The runtime rejected the cancellation request.");
                else ShowBridgeFailure(exception);
            }
        }
        catch (OperationCanceledException)
        {
            if (IsCurrentReceive(epoch) && (cancel || !_cancellingReceive))
                ShowFailure(cancel ? "TeamForge did not confirm cancellation yet." : "TeamForge did not confirm the pause/resume command.",
                    "control_timeout", "The runtime control request timed out.");
        }
        catch (Exception exception) when (exception is IOException or InvalidOperationException)
        {
            if (IsCurrentReceive(epoch) && (cancel || !_cancellingReceive))
                ShowFailure("TeamForge could not confirm the receive control request.", "receive_control_failed",
                    cancel ? "The runtime control channel failed during cancellation." : exception.Message);
        }
        finally
        {
            if (IsCurrentReceive(epoch))
            {
                if (cancel) _cancelCommandPending = false;
                else _pauseCommandPending = false;
                UpdateButtons();
            }
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

    private void CopyDiagnostics_Click(object sender, RoutedEventArgs e)
    {
        var bundle = _diagnosticHistory.BuildCopyBundle(
            _diagnosticContext,
            _pendingAccessCode,
            AccessCodeBox.Password);
        Clipboard.SetText(bundle);
        StatusText.Text = "Diagnostics copied. Access codes and credentials were redacted.";
    }

    private void Bridge_EventReceived(object? sender, BridgeEventArgs e)
    {
        var epoch = Interlocked.Read(ref _receiveEpoch);
        Dispatcher.BeginInvoke(async () =>
        {
            // Events arriving after receive retirement must not be rebound to
            // the idle UI after its transient redaction credential was cleared.
            if (_receiving && epoch == _receiveEpoch) await HandleBridgeEventAsync(e);
        });
    }

    private void Bridge_DiagnosticReceived(object? sender, string e)
    {
        Dispatcher.BeginInvoke(() => AppendDiagnostic("runtime_stderr: internal runtime reported a diagnostic"));
    }

    private async Task HandleBridgeEventAsync(BridgeEventArgs e)
    {
        if (_closing) return;
        var name = e.EventName.Replace('-', '_').ToLowerInvariant();
        if (_cancellingReceive)
        {
            // Cancellation retires the working code immediately. A late runtime
            // diagnostic cannot be safely redacted without that code.
            if (name == "diagnostic") AppendDiagnostic("guest_diagnostic_during_cancel");
            return;
        }
        switch (name)
        {
            case "progress":
                if (_paused) return;
                UpdateProgress(e.Message);
                break;
            case "state":
                var stateName = DiagnosticHistory.Redact(
                    ReadString(e.Message, "state") ?? "receiving", _pendingAccessCode, AccessCodeBox.Password);
                StatusText.Text = DiagnosticHistory.Redact(
                    ReadString(e.Message, "message") ?? stateName, _pendingAccessCode, AccessCodeBox.Password);
                _diagnosticContext = _diagnosticContext with { Operation = stateName, TransferState = stateName };
                AppendDiagnostic($"guest_state: {stateName}");
                break;
            case "trust":
                await HandleTrustAsync(e.Message);
                break;
            case "paused":
                _paused = true;
                _diagnosticContext = _diagnosticContext with { TransferState = "paused" };
                PauseButton.Content = "Resume";
                StatusText.Text = "Receiving paused. Verified progress is preserved.";
                break;
            case "resumed":
                _paused = false;
                _diagnosticContext = _diagnosticContext with { TransferState = "receiving" };
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
        if (_bridge is null || _trustDialogOpen || !_receiving || _cancellingReceive)
        {
            return;
        }

        var epoch = _receiveEpoch;
        _trustDialogOpen = true;
        try
        {
            var presentation = TrustPresentation.FromBridgeEvent(message);
            var hostLine = string.IsNullOrWhiteSpace(_verifiedServerHost) ? string.Empty : $"\nHost: {DisplayBounded(_verifiedServerHost, 256)}";
            var approved = _confirmTrustForTests is null
                ? new TrustDialog(presentation.FriendlyText + hostLine, presentation.AdvancedText + hostLine) { Owner = this }.ShowDialog() == true
                : _confirmTrustForTests(presentation);
            // The dialog and bridge ACK may outlive this receive. Never send a
            // stale trust decision or present an ACK after cancellation retires auth.
            if (!IsCurrentReceive(epoch) || _cancellingReceive) return;
            await _bridge.SendRequestAsync("trust", new Dictionary<string, object?>
            {
                ["challengeId"] = presentation.ChallengeId,
                ["approved"] = approved,
            });
            if (IsCurrentReceive(epoch) && !_cancellingReceive)
                AppendDiagnostic(approved ? "publisher_trust_approved" : "publisher_trust_declined");
        }
        catch (BridgeException exception)
        {
            if (IsCurrentReceive(epoch) && !_cancellingReceive)
                ShowBridgeFailure(exception);
        }
        catch (InvalidDataException exception)
        {
            if (!IsCurrentReceive(epoch) || _cancellingReceive) return;
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
        var progress = ReceiveProgressPresentation.FromMessage(message);
        ReceiveProgress.IsIndeterminate = progress.IsIndeterminate;
        if (progress.Percent is not null) ReceiveProgress.Value = progress.Percent.Value;
        StatusText.Text = DiagnosticHistory.Redact(progress.StatusText, _pendingAccessCode, AccessCodeBox.Password);
        _diagnosticContext = _diagnosticContext with { Operation = "project_receive", TransferState = progress.TransferState };
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
        if (receiving) RetirePreview();
        Interlocked.Increment(ref _receiveEpoch);
        _receiving = receiving;
        _paused = false;
        _pauseCommandPending = false;
        _cancelCommandPending = false;
        _cancellingReceive = false;
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
        var interactive = !_closing && _unityOperation is null;
        var hasInput = !string.IsNullOrWhiteSpace(InviteTextBox.Text) && !string.IsNullOrWhiteSpace(DestinationTextBox.Text);
        PreviewButton.IsEnabled = interactive && _runtimeReady && !_receiving && _previewOperation is null && hasInput;
        ReceiveButton.IsEnabled = interactive && _runtimeReady && !_receiving && hasInput;
        PauseButton.IsEnabled = interactive && _runtimeReady && _receiving && !_pauseCommandPending && !_cancellingReceive;
        CancelButton.IsEnabled = interactive && _runtimeReady && _receiving && !_cancelCommandPending;
        InviteTextBox.IsEnabled = interactive && !_receiving;
        OpenInviteButton.IsEnabled = interactive && !_receiving;
        ChooseDestinationButton.IsEnabled = interactive && !_receiving;
        AccessCodeBox.IsEnabled = interactive && !_receiving && _readyProject is null;
        RememberCodeForRetriesCheckBox.IsEnabled = interactive && !_receiving;
        OpenUnityButton.IsEnabled = interactive && _readyProject is not null && !_receiving;
        ChooseUnityButton.IsEnabled = interactive && (_readyProject is not null || _existingVerifiedProject is not null) && !_receiving;
    }

    private void InvalidateReadyProject()
    {
        RetirePreview();
        _unityProjectContext = new object();
        _unityOperation?.Cancel();
        ClearPendingAccessCode();
        _readyProject = null;
        _existingVerifiedProject = null;
        _readyResult = null;
        _explicitlyVerifiedEditor = null;
        _verifiedServerHost = null;
        ReadyBorder.Visibility = Visibility.Collapsed;
        UpdateButtons();
    }

    private void ClearPendingAccessCode(bool clearUserInput = false)
    {
        _pendingAccessCode = null;
        if (clearUserInput || RememberCodeForRetriesCheckBox.IsChecked != true)
        {
            AccessCodeBox.Clear();
        }
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
        if (_closing) return;
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
        // Runtime-provided error text and codes are untrusted diagnostic inputs.
        // Sanitize before displaying or retaining them, while the working code exists.
        var safeCode = DiagnosticHistory.Redact(code, _pendingAccessCode, AccessCodeBox.Password);
        var safeMessage = DiagnosticHistory.Redact(userMessage, _pendingAccessCode, AccessCodeBox.Password);
        _diagnosticContext = _diagnosticContext with
        {
            StableErrorCode = safeCode,
            DetailedErrorMessage = DiagnosticHistory.Redact(advancedDetail, _pendingAccessCode, AccessCodeBox.Password),
        };
        var presentation = RecoveryUx.Resolve(safeCode, _diagnosticContext);
        FailureTitleText.Text = presentation.Title;
        FailureMessageText.Text = presentation.Message;
        FailureCodeText.Text = $"Code: {safeCode}";
        FailureBorder.Visibility = Visibility.Visible;
        SetRecoveryActionVisibility(presentation.Actions);
        StatusText.Text = string.IsNullOrWhiteSpace(safeMessage) ? presentation.Title : safeMessage;
        AppendDiagnostic($"{safeCode}: {advancedDetail}");
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

    private string? ReadSafeBridgeDiagnostic(JsonElement diagnostics, string name)
    {
        var value = ReadString(diagnostics, name);
        return value is null ? null : DiagnosticHistory.Redact(value, _pendingAccessCode, AccessCodeBox.Password);
    }

    private void ApplyBridgeDiagnostics(JsonElement diagnostics)
    {
        _diagnosticContext = _diagnosticContext with
        {
            Operation = ReadSafeBridgeDiagnostic(diagnostics, "operation") ?? _diagnosticContext.Operation,
            ProjectIdentity = ReadSafeBridgeDiagnostic(diagnostics, "projectIdentity") ?? _diagnosticContext.ProjectIdentity,
            ManagedRoot = ReadSafeBridgeDiagnostic(diagnostics, "managedRoot") ?? _diagnosticContext.ManagedRoot,
            Endpoint = ReadSafeBridgeDiagnostic(diagnostics, "endpoint") ?? _diagnosticContext.Endpoint,
            ActivePath = ReadSafeBridgeDiagnostic(diagnostics, "activePath") ?? _diagnosticContext.ActivePath,
            UnityVersion = ReadSafeBridgeDiagnostic(diagnostics, "unityVersion") ?? _diagnosticContext.UnityVersion,
            ProcessOwnershipState = ReadSafeBridgeDiagnostic(diagnostics, "processOwnershipState") ?? _diagnosticContext.ProcessOwnershipState,
            CoordinatorSeedHealthIdentity = ReadSafeBridgeDiagnostic(diagnostics, "coordinatorSeedHealthIdentity") ?? _diagnosticContext.CoordinatorSeedHealthIdentity,
            TransferState = ReadSafeBridgeDiagnostic(diagnostics, "transferState") ?? _diagnosticContext.TransferState,
            StagingPath = ReadSafeBridgeDiagnostic(diagnostics, "stagingPath") ?? _diagnosticContext.StagingPath,
            RuntimeVerificationStage = ReadSafeBridgeDiagnostic(diagnostics, "runtimeVerificationStage") ?? _diagnosticContext.RuntimeVerificationStage,
            InviteProductVersion = ReadSafeBridgeDiagnostic(diagnostics, "inviteProductVersion") ?? _diagnosticContext.InviteProductVersion,
            PackagedRuntimeVersion = ReadSafeBridgeDiagnostic(diagnostics, "runtimeProductVersion") ?? _diagnosticContext.PackagedRuntimeVersion,
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

    private static string DisplayBounded(string value, int maximumCharacters)
    {
        return value.Length <= maximumCharacters ? value : value[..maximumCharacters] + "…";
    }
}

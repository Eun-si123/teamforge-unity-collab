using System.Text;
using System.Text.RegularExpressions;

namespace TeamForge.Launcher.Core;

public enum RecoveryActionKind
{
    Retry,
    PasteNewInvite,
    EnterAccessCodeAgain,
    UseLatestProject,
    OpenExistingVerifiedProject,
    ChooseUnityExecutable,
    ChooseShorterProjectLocation,
    CopyDiagnostics,
}

public sealed record DiagnosticContext
{
    public string ProductVersion { get; init; } = "0.5.1";
    public string LauncherVersion { get; init; } = "0.5.1";
    public string PackagedRuntimeVersion { get; init; } = "unknown";
    public string RuntimeManifestIdentity { get; init; } = "unknown";
    public string UnityVersion { get; init; } = "unknown";
    public string Operation { get; init; } = "idle";
    public string StableErrorCode { get; init; } = "none";
    public string DetailedErrorMessage { get; init; } = string.Empty;
    public string Role { get; init; } = "Guest";
    public string ProjectIdentity { get; init; } = "unknown";
    public string InviteProductVersion { get; init; } = string.Empty;
    public long BaselineRevision { get; init; }
    public long ActiveRevision { get; init; }
    public string ActivePath { get; init; } = string.Empty;
    public string ManagedRoot { get; init; } = string.Empty;
    public string Endpoint { get; init; } = string.Empty;
    public string ProcessOwnershipState { get; init; } = "not_applicable_guest";
    public string CoordinatorSeedHealthIdentity { get; init; } = "not_connected";
    public string TransferState { get; init; } = "idle";
    public string StagingPath { get; init; } = string.Empty;
    public string RuntimeVerificationStage { get; init; } = string.Empty;
    public bool PreviousVerifiedActiveAvailable { get; init; }
}

public sealed record RecoveryPresentation(
    string Title,
    string Message,
    IReadOnlyList<RecoveryActionKind> Actions);

public static class RecoveryUx
{
    public static RecoveryPresentation Resolve(string code, DiagnosticContext state)
    {
        ArgumentNullException.ThrowIfNull(state);
        var stableCode = string.IsNullOrWhiteSpace(code) ? "teamforge_operation_failed" : code.Trim();
        var actions = new List<RecoveryActionKind>();
        string title;
        string message;

        switch (stableCode)
        {
            case "teamforge_version_mismatch":
                title = "TeamForge version mismatch";
                var inviteVersion = string.IsNullOrWhiteSpace(state.InviteProductVersion) ? "unknown" : state.InviteProductVersion;
                message = $"Invite: TeamForge {inviteVersion}\nLauncher: TeamForge {state.LauncherVersion}\nUse the matching or newer supported Launcher.";
                actions.Add(RecoveryActionKind.PasteNewInvite);
                break;
            case "invalid_bootstrap_invite":
            case "invalid_invite":
            case "invalid_join_code":
            case "invite_file_invalid":
            case "invite_invalid":
                title = "Invite is invalid or damaged";
                message = "Copy a new signed Collaboration Invite from the Host and paste it again.";
                actions.Add(RecoveryActionKind.PasteNewInvite);
                break;
            case "access_code_incorrect":
            case "invalid_authentication_token":
                title = "Access code is incorrect";
                message = "Enter the access code again. TeamForge does not save or echo it.";
                actions.Add(RecoveryActionKind.EnterAccessCodeAgain);
                actions.Add(RecoveryActionKind.Retry);
                break;
            case "coordinator_error":
            case "coordinator_closed":
            case "coordinator_timeout":
            case "host_unreachable":
                title = "Host cannot be reached";
                message = "Check that the Host collaboration is running and reachable, then retry.";
                actions.Add(RecoveryActionKind.Retry);
                break;
            case "invite_conflict":
            case "untrusted_owner":
            case "guest_trust_project_conflict":
            case "project_uuid_mismatch":
            case "project_identity_mismatch":
                title = "This project belongs to a different collaboration";
                message = "TeamForge kept the existing project binding unchanged. Paste the correct signed Invite.";
                actions.Add(RecoveryActionKind.PasteNewInvite);
                AddExistingAction(actions, state);
                break;
            case "project_updated":
            case "scene_baseline_mismatch":
            case "baseline_revision_mismatch":
                title = stableCode == "scene_baseline_mismatch"
                    ? "Saved Scene does not match the current Host baseline"
                    : "Project has been updated";
                message = "Update or open the latest verified project. TeamForge will not bypass baseline validation.";
                actions.Add(RecoveryActionKind.UseLatestProject);
                AddExistingAction(actions, state);
                break;
            case "unity_editor_missing":
            case "unity_executable_unavailable":
            case "unity_version_mismatch":
                title = "Unity version is not installed or cannot be found";
                message = $"Install Unity {state.UnityVersion}, or choose its exact Unity.exe.";
                actions.Add(RecoveryActionKind.ChooseUnityExecutable);
                AddExistingAction(actions, state);
                break;
            case "destination_invalid":
            case "unsafe_guest_destination":
            case "invalid_guest_destination":
            case "destination_overlaps_runtime":
            case "path_length_risk":
                title = "Project path is too long or unsafe";
                message = "TeamForge could not establish a verified short Unity path on this PC. Choose another safe location or retry after checking Technical Details.";
                actions.Add(RecoveryActionKind.ChooseShorterProjectLocation);
                break;
            case "runtime_integrity_failed":
            case "runtime_missing":
            case "runtime_protocol_error":
            case "runtime_exited":
                title = "TeamForge Runtime is damaged";
                message = string.IsNullOrWhiteSpace(state.RuntimeVerificationStage)
                    ? "TeamForge stopped safely. Reinstall this exact Launcher package."
                    : $"Runtime verification stopped at: {state.RuntimeVerificationStage}. Reinstall this exact Launcher package.";
                break;
            case "direct_transfer_unavailable":
            case "peer_http_error":
            case "guest_activation_failed":
            case "required_revision_download_failed":
                title = "Required project revision could not be downloaded";
                message = state.PreviousVerifiedActiveAvailable
                    ? "Retry will reuse verified downloaded data where supported. Your previous verified project is still safe."
                    : "Keep the Host online and retry. Verified downloaded data will be reused where supported.";
                actions.Add(RecoveryActionKind.Retry);
                AddExistingAction(actions, state);
                break;
            case "port_conflict":
            case "lifecycle_identity_mismatch":
                title = "Collaboration service is already using this port";
                message = "TeamForge did not stop the unknown process. Close the owning application or choose another port, then retry.";
                actions.Add(RecoveryActionKind.Retry);
                break;
            default:
                title = "TeamForge could not finish this operation";
                message = state.PreviousVerifiedActiveAvailable
                    ? "The previous verified project is still safe. Copy diagnostics before retrying."
                    : "Copy diagnostics and retry only after checking the suggested details.";
                AddExistingAction(actions, state);
                break;
        }

        actions.Add(RecoveryActionKind.CopyDiagnostics);
        return new RecoveryPresentation(title, message, actions.Distinct().ToArray());
    }

    private static void AddExistingAction(List<RecoveryActionKind> actions, DiagnosticContext state)
    {
        if (state.PreviousVerifiedActiveAvailable && !string.IsNullOrWhiteSpace(state.ActivePath))
        {
            actions.Add(RecoveryActionKind.OpenExistingVerifiedProject);
        }
    }
}

public sealed class DiagnosticHistory
{
    private const int MaximumEntries = 32;
    private const int MaximumDetailCharacters = 2048;
    private readonly List<DiagnosticEntry> _entries = new();
    private string _lastOperation = string.Empty;
    private string _lastCode = string.Empty;
    private string _lastDetail = string.Empty;
    private int _lastRepeatCount;

    public IReadOnlyList<DiagnosticEntry> Entries => _entries;

    public void Add(string operation, string code, string detail, params string?[] secrets)
    {
        var safeOperation = Redact(operation, secrets);
        var safeCode = Redact(code, secrets);
        var safeDetail = Redact(detail, secrets);
        if (_entries.Count != 0 && string.Equals(_lastOperation, safeOperation, StringComparison.Ordinal) &&
            string.Equals(_lastCode, safeCode, StringComparison.Ordinal) && string.Equals(_lastDetail, safeDetail, StringComparison.Ordinal))
        {
            _lastRepeatCount++;
            _entries[^1] = new DiagnosticEntry(DateTimeOffset.UtcNow, safeOperation, safeCode, $"{safeDetail} (x{_lastRepeatCount})");
            return;
        }
        _lastOperation = safeOperation;
        _lastCode = safeCode;
        _lastDetail = safeDetail;
        _lastRepeatCount = 1;
        var entry = new DiagnosticEntry(DateTimeOffset.UtcNow, safeOperation, safeCode, safeDetail);
        _entries.Add(entry);
        if (_entries.Count > MaximumEntries)
        {
            _entries.RemoveRange(0, _entries.Count - MaximumEntries);
        }
    }

    public string BuildCopyBundle(DiagnosticContext state, params string?[] secrets)
    {
        ArgumentNullException.ThrowIfNull(state);
        var builder = new StringBuilder();
        builder.AppendLine("TeamForge Diagnostics (current run, secrets redacted)");
        Field(builder, "Timestamp UTC", DateTimeOffset.UtcNow.ToString("O"), secrets);
        Field(builder, "TeamForge product", state.ProductVersion, secrets);
        Field(builder, "Launcher", state.LauncherVersion, secrets);
        Field(builder, "Packaged Runtime", state.PackagedRuntimeVersion, secrets);
        Field(builder, "Runtime manifest", state.RuntimeManifestIdentity, secrets);
        Field(builder, "Unity", state.UnityVersion, secrets);
        Field(builder, "Operation", state.Operation, secrets);
        Field(builder, "Stable error code", state.StableErrorCode, secrets);
        Field(builder, "Detailed error", state.DetailedErrorMessage, secrets);
        Field(builder, "Role", state.Role, secrets);
        Field(builder, "Project", ShortIdentity(state.ProjectIdentity), secrets);
        Field(builder, "Current Baseline revision", state.BaselineRevision.ToString(), secrets);
        Field(builder, "Selected Active revision", state.ActiveRevision.ToString(), secrets);
        Field(builder, "Selected Active path", state.ActivePath, secrets);
        Field(builder, "Managed root", state.ManagedRoot, secrets);
        Field(builder, "Endpoint", state.Endpoint, secrets);
        Field(builder, "Process ownership", state.ProcessOwnershipState, secrets);
        Field(builder, "Coordinator / Seed health", state.CoordinatorSeedHealthIdentity, secrets);
        Field(builder, "Transfer / staging state", state.TransferState, secrets);
        Field(builder, "Retained staging path", state.StagingPath, secrets);
        Field(builder, "Previous verified Active available", state.PreviousVerifiedActiveAvailable ? "yes" : "no", secrets);
        Field(builder, "Runtime verification stage", state.RuntimeVerificationStage, secrets);
        builder.AppendLine("History:");
        foreach (var entry in _entries)
        {
            builder.Append(entry.TimestampUtc.ToString("O"))
                .Append(" | ").Append(Redact(entry.Operation, secrets))
                .Append(" | ").Append(Redact(entry.Code, secrets))
                .Append(" | ").AppendLine(Redact(entry.Detail, secrets));
        }
        return RedactCore(builder.ToString(), secrets, 64 * 1024);
    }

    public static string ShortIdentity(string value)
    {
        var trimmed = (value ?? string.Empty).Trim();
        return trimmed.Length <= 13 ? trimmed : $"{trimmed[..8]}…{trimmed[^4..]}";
    }

    public static string Redact(string? value, params string?[] secrets)
    {
        return RedactCore(value, secrets, MaximumDetailCharacters);
    }

    private static string RedactCore(string? value, string?[] secrets, int maximumCharacters)
    {
        var result = (value ?? string.Empty).Replace('\0', ' ');
        foreach (var secret in secrets)
        {
            if (!string.IsNullOrEmpty(secret)) result = result.Replace(secret, "[redacted]", StringComparison.Ordinal);
        }
        result = Regex.Replace(result, "(?i)(authorization\\s*:\\s*bearer\\s+)[^\\s]+", "$1[redacted]");
        result = Regex.Replace(result, "(?i)(access(?:[-_ ]?code)?|token|secret|private[-_ ]?key)\\s*[=:]\\s*[^\\s;,]+", "$1=[redacted]");
        result = Regex.Replace(result, @"(?i)([A-Z]:\\Users\\)[^\\\r\n]+", "$1[user]");
        return result.Length <= maximumCharacters ? result : result[..maximumCharacters] + "…";
    }

    private static void Field(StringBuilder builder, string label, string value, string?[] secrets)
    {
        builder.Append(label).Append(": ").AppendLine(Redact(value, secrets));
    }
}

public sealed record DiagnosticEntry(DateTimeOffset TimestampUtc, string Operation, string Code, string Detail);

public sealed record UnityPathRisk(
    bool HighRisk,
    string ExpectedActivePath,
    int ExpectedActivePathLength,
    int EstimatedGeneratedPathLength);

public static class UnityPathBudgetPolicy
{
    public static int UnityPackageCacheHeadroom => PathResilienceContract.Current.UnityPackageCacheHeadroom;
    public static int HighRiskPathLength => PathResilienceContract.Current.WindowsHighRiskPathLength;

    public static UnityPathRisk Assess(string managedRoot, string projectUuid, long expectedRevision = 9_999_999_999)
    {
        var root = Path.GetFullPath(managedRoot);
        var identity = string.IsNullOrWhiteSpace(projectUuid) ? "00000000-0000-0000-0000-000000000000" : projectUuid.Trim();
        var active = Path.GetFullPath(Path.Combine(root, identity, "active", $"{expectedRevision}-000000000000"));
        var assessment = PathBudgetAnalyzer.AssessActivePath(active);
        return new UnityPathRisk(assessment.HighRisk, active, active.Length, assessment.EstimatedGeneratedPathLength);
    }
}

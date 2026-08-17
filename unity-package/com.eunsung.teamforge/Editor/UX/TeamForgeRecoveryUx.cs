using System;
using System.Collections.Generic;
using System.Text;
using System.Text.RegularExpressions;

namespace EunSung.TeamForge
{
    internal sealed class TeamForgeRecoveryPresentation
    {
        public TeamForgeRecoveryPresentation(string code, string title, string message, string primaryAction)
        {
            Code = string.IsNullOrWhiteSpace(code) ? "teamforge_operation_failed" : code;
            Title = title ?? "TeamForge needs attention";
            Message = message ?? string.Empty;
            PrimaryAction = primaryAction ?? string.Empty;
        }

        public string Code { get; }
        public string Title { get; }
        public string Message { get; }
        public string PrimaryAction { get; }
    }

    internal static class TeamForgeRecoveryUx
    {
        private const int MaximumHistory = 32;
        private static readonly Queue<string> History = new Queue<string>();

        public static TeamForgeRecoveryPresentation FromStableCode(
            string code,
            bool previousVerifiedActiveAvailable = false)
        {
            switch (code ?? string.Empty)
            {
                case "scene_baseline_mismatch":
                    return new TeamForgeRecoveryPresentation(
                        code,
                        "Saved Scene does not match the current Host baseline",
                        "Update or open the latest verified project. TeamForge will not bypass Scene baseline validation.",
                        "Update Project");
                case "project_identity_mismatch":
                    return new TeamForgeRecoveryPresentation(
                        code,
                        "This project belongs to a different collaboration",
                        "Open the matching verified Host project. TeamForge did not change this Project identity.",
                        "Choose Matching Project");
                case "port_conflict":
                case "lifecycle_identity_mismatch":
                    return new TeamForgeRecoveryPresentation(
                        code,
                        "Collaboration service is already using this port",
                        "The listener was not terminated because TeamForge could not prove ownership. Close its owning application or choose another port, then retry.",
                        "Retry");
                case "access_code_incorrect":
                case "invalid_authentication_token":
                    return new TeamForgeRecoveryPresentation(
                        code,
                        "Access code is incorrect",
                        "Enter the access code again. TeamForge will not display or store the supplied code in diagnostics.",
                        "Enter Access Code Again");
                case "teamforge_version_mismatch":
                case "incompatible_project_descriptor":
                    return new TeamForgeRecoveryPresentation(
                        code,
                        "TeamForge version mismatch",
                        "Use the Launcher and Unity package version that matches the signed Collaboration Invite.",
                        "Copy Diagnostics");
                case "required_revision_download_failed":
                case "direct_transfer_unavailable":
                    return new TeamForgeRecoveryPresentation(
                        code,
                        "Required project revision could not be downloaded",
                        previousVerifiedActiveAvailable
                            ? "Retry the update. The previous verified project is still safe."
                            : "Keep the Host online and retry the project update.",
                        "Retry");
                default:
                    return new TeamForgeRecoveryPresentation(
                        code,
                        "TeamForge needs attention",
                        previousVerifiedActiveAvailable
                            ? "The previous verified project is still safe. Copy diagnostics before retrying."
                            : "Copy diagnostics before retrying.",
                        "Copy Diagnostics");
            }
        }

        public static void Record(string operation, string code, string detail)
        {
            var line = $"{DateTime.UtcNow:O} | {Safe(operation)} | {Safe(code)} | {Safe(detail)}";
            History.Enqueue(line);
            while (History.Count > MaximumHistory) History.Dequeue();
        }

        public static string BuildCopyDiagnostics(
            string role,
            string operation,
            string code,
            string detail,
            bool previousVerifiedActiveAvailable)
        {
            var settings = TeamForgeConnectionService.Settings;
            var descriptor = TeamForgeProjectService.Descriptor;
            var builder = new StringBuilder();
            builder.AppendLine("TeamForge Diagnostics (current run, secrets redacted)");
            builder.AppendLine($"Timestamp UTC: {DateTime.UtcNow:O}");
            builder.AppendLine($"TeamForge product: {TeamForgeProjectContract.ProductVersion}");
            builder.AppendLine($"Role: {Safe(role)}");
            builder.AppendLine($"Operation: {Safe(operation)}");
            builder.AppendLine($"Stable error code: {Safe(code)}");
            builder.AppendLine($"Detailed error: {Safe(detail)}");
            builder.AppendLine($"Project: {ShortIdentity(descriptor?.projectUuid)}");
            builder.AppendLine($"Current Baseline revision: {descriptor?.baselineRevision ?? 0}");
            builder.AppendLine($"Endpoint: {Safe(settings?.ServerAddress)}");
            builder.AppendLine($"Process ownership: {Safe(TeamForgeHostFlow.ProcessOwnershipState)}");
            builder.AppendLine($"Coordinator / Seed health: {Safe(TeamForgeHostFlow.HealthIdentity)}");
            builder.AppendLine($"Previous verified Active available: {(previousVerifiedActiveAvailable ? "yes" : "no")}");
            builder.AppendLine("History:");
            foreach (var entry in History) builder.AppendLine(Safe(entry));
            return Safe(builder.ToString());
        }

        private static string ShortIdentity(string value)
        {
            if (string.IsNullOrWhiteSpace(value)) return "unknown";
            var trimmed = value.Trim();
            return trimmed.Length <= 13 ? trimmed : trimmed.Substring(0, 8) + "…" + trimmed.Substring(trimmed.Length - 4);
        }

        private static string Safe(string value)
        {
            var result = (value ?? string.Empty).Replace('\0', ' ');
            var token = TeamForgeConnectionService.Settings?.EffectiveAuthenticationToken ?? string.Empty;
            if (!string.IsNullOrEmpty(token)) result = result.Replace(token, "[redacted]");
            result = Regex.Replace(result, "(?i)(authorization\\s*:\\s*bearer\\s+)[^\\s]+", "$1[redacted]");
            result = Regex.Replace(result, "(?i)(access(?:[-_ ]?code)?|token|secret|private[-_ ]?key)\\s*[=:]\\s*[^\\s;,]+", "$1=[redacted]");
            return result.Length <= 65536 ? result : result.Substring(0, 65536) + "…";
        }
    }
}

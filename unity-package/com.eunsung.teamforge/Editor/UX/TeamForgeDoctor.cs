using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace EunSung.TeamForge
{
    public enum TeamForgeDoctorLevel
    {
        Pass,
        Warning,
        Fail,
    }

    public sealed class TeamForgeDoctorResult
    {
        public TeamForgeDoctorResult(string name, TeamForgeDoctorLevel level, string message)
        {
            Name = name;
            Level = level;
            Message = message;
        }

        public string Name { get; }
        public TeamForgeDoctorLevel Level { get; }
        public string Message { get; }
    }

    public static class TeamForgeDoctor
    {
        public static List<TeamForgeDoctorResult> Run()
        {
            var results = new List<TeamForgeDoctorResult>();
            CheckUnity(results);
            CheckPackage(results);
            CheckProjectIdentity(results);
            CheckSceneBaseline(results);
            CheckConnectionSettings(results);
            CheckAuthentication(results);
            CheckProjectPath(results);
            CheckConnection(results);
            CheckProjectTransfer(results);
            CheckTestLab(results);
            return results;
        }

        public static string BuildReport(IEnumerable<TeamForgeDoctorResult> results)
        {
            var builder = new StringBuilder();
            builder.AppendLine($"TeamForge Doctor · {DateTime.UtcNow:O}");
            builder.AppendLine($"Unity: {Application.unityVersion}");
            builder.AppendLine($"TeamForge: {TeamForgeProjectContract.ProductVersion}");
            foreach (var result in results)
            {
                builder.AppendLine($"[{result.Level}] {result.Name}: {result.Message}");
            }
            return builder.ToString();
        }

        public static void Count(IEnumerable<TeamForgeDoctorResult> results, out int failures, out int warnings)
        {
            failures = 0;
            warnings = 0;
            foreach (var result in results)
            {
                if (result.Level == TeamForgeDoctorLevel.Fail) failures += 1;
                else if (result.Level == TeamForgeDoctorLevel.Warning) warnings += 1;
            }
        }

        public static string Summary(IEnumerable<TeamForgeDoctorResult> results)
        {
            Count(results, out var failures, out var warnings);
            if (failures > 0) return $"{failures} problem(s), {warnings} warning(s)";
            if (warnings > 0) return $"Ready with {warnings} warning(s)";
            return "All checks look good";
        }

        public static bool TryAutoFixSafeIssues(out string summary)
        {
            var fixedItems = new List<string>();
            var settings = TeamForgeConnectionService.Settings;
            settings.EnsureDefaults();
            settings.SaveSettings();

            if (TeamForgeProjectService.Descriptor == null)
            {
                if (!TeamForgeQuickStartUtility.TryEnsureProjectSetup(false, out var setupError))
                {
                    summary = setupError;
                    return false;
                }
                fixedItems.Add("Project identity");
            }
            else if (string.IsNullOrWhiteSpace(settings.ProjectId) ||
                     string.Equals(settings.ProjectId, "default-project", StringComparison.Ordinal) ||
                     string.IsNullOrWhiteSpace(settings.SessionId) ||
                     string.Equals(settings.SessionId, "default-session", StringComparison.Ordinal))
            {
                if (!TeamForgeQuickStartUtility.TryEnsureProjectSetup(false, out var setupError))
                {
                    summary = setupError;
                    return false;
                }
                fixedItems.Add("Project/session defaults");
            }

            var scene = SceneManager.GetActiveScene();
            if (scene.IsValid() && (string.IsNullOrWhiteSpace(scene.path) || scene.isDirty))
            {
                if (!TeamForgeQuickStartUtility.EnsureSavedActiveSceneInteractive(out var sceneError))
                {
                    summary = sceneError;
                    return false;
                }
                fixedItems.Add("Saved Scene baseline");
            }

            summary = fixedItems.Count == 0
                ? "No safe automatic fixes were needed."
                : "Fixed: " + string.Join(", ", fixedItems) + ".";
            return true;
        }

        private static void CheckUnity(List<TeamForgeDoctorResult> results)
        {
            var pass = Application.unityVersion.StartsWith("6000.3.", StringComparison.Ordinal);
            results.Add(new TeamForgeDoctorResult(
                "Unity",
                pass ? TeamForgeDoctorLevel.Pass : TeamForgeDoctorLevel.Warning,
                pass ? Application.unityVersion : $"{Application.unityVersion} · package targets Unity 6000.3"));
        }

        private static void CheckPackage(List<TeamForgeDoctorResult> results)
        {
            var packageInfo = UnityEditor.PackageManager.PackageInfo.FindForAssembly(typeof(TeamForgeDoctor).Assembly);
            var pass = packageInfo != null &&
                       string.Equals(packageInfo.name, "com.eunsung.teamforge", StringComparison.Ordinal) &&
                       string.Equals(packageInfo.version, TeamForgeProjectContract.ProductVersion, StringComparison.Ordinal);
            results.Add(new TeamForgeDoctorResult(
                "Package",
                pass ? TeamForgeDoctorLevel.Pass : TeamForgeDoctorLevel.Fail,
                pass ? $"{packageInfo.name} {packageInfo.version}" : "TeamForge package metadata does not match the running assembly."));
        }

        private static void CheckProjectIdentity(List<TeamForgeDoctorResult> results)
        {
            if (!string.IsNullOrWhiteSpace(TeamForgeProjectService.DescriptorError))
            {
                results.Add(new TeamForgeDoctorResult(
                    "Project identity",
                    TeamForgeDoctorLevel.Fail,
                    TeamForgeProjectService.DescriptorError));
                return;
            }

            var descriptor = TeamForgeProjectService.Descriptor;
            results.Add(new TeamForgeDoctorResult(
                "Project identity",
                descriptor == null ? TeamForgeDoctorLevel.Warning : TeamForgeDoctorLevel.Pass,
                descriptor == null
                    ? "Not initialized yet. Start Collaboration or use Fix Safe Issues."
                    : $"UUID {descriptor.projectUuid}"));
        }

        private static void CheckSceneBaseline(List<TeamForgeDoctorResult> results)
        {
            if (TeamForgeBaselineFingerprint.TryCaptureActiveScene(out var baseline, out var error))
            {
                results.Add(new TeamForgeDoctorResult(
                    "Scene baseline",
                    TeamForgeDoctorLevel.Pass,
                    $"{baseline.scenePath} · {baseline.sha256.Substring(0, 12)}…"));
                return;
            }

            results.Add(new TeamForgeDoctorResult(
                "Scene baseline",
                TeamForgeDoctorLevel.Warning,
                error));
        }

        private static void CheckConnectionSettings(List<TeamForgeDoctorResult> results)
        {
            var settings = TeamForgeConnectionService.Settings;
            settings.EnsureDefaults();
            if (!TeamForgeUriBuilder.TryBuildWebSocketUri(
                    settings.ServerAddress,
                    settings.RealtimePath,
                    out var uri,
                    out var error) ||
                !TeamForgeInputValidator.TryValidateIdentity(
                    settings.UserName,
                    settings.ProjectId,
                    settings.SessionId,
                    out error))
            {
                results.Add(new TeamForgeDoctorResult("Connection settings", TeamForgeDoctorLevel.Fail, error));
                return;
            }

            results.Add(new TeamForgeDoctorResult(
                "Connection settings",
                TeamForgeDoctorLevel.Pass,
                $"{uri} · project {settings.ProjectId} · session {settings.SessionId}"));
        }

        private static void CheckAuthentication(List<TeamForgeDoctorResult> results)
        {
            var settings = TeamForgeConnectionService.Settings;
            if (!TeamForgeUriBuilder.TryValidateBaseAddress(settings.ServerAddress, out var uri, out _))
            {
                return;
            }

            var hasToken = !string.IsNullOrWhiteSpace(settings.EffectiveAuthenticationToken);
            if (hasToken)
            {
                results.Add(new TeamForgeDoctorResult(
                    "Authentication",
                    TeamForgeDoctorLevel.Pass,
                    "A local Bearer token is configured (value hidden)."));
                return;
            }

            results.Add(new TeamForgeDoctorResult(
                "Authentication",
                uri.IsLoopback ? TeamForgeDoctorLevel.Warning : TeamForgeDoctorLevel.Fail,
                uri.IsLoopback
                    ? "No token configured. Acceptable only for a loopback development server."
                    : "No token configured for a non-loopback server."));
        }

        private static void CheckProjectPath(List<TeamForgeDoctorResult> results)
        {
            string root;
            try
            {
                root = Path.GetFullPath(Directory.GetCurrentDirectory());
            }
            catch (Exception exception)
            {
                results.Add(new TeamForgeDoctorResult(
                    "Project path",
                    TeamForgeDoctorLevel.Fail,
                    $"Could not resolve Project path ({exception.GetType().Name})."));
                return;
            }

            var level = root.Length >= 120 ? TeamForgeDoctorLevel.Warning : TeamForgeDoctorLevel.Pass;
            results.Add(new TeamForgeDoctorResult(
                "Project path",
                level,
                level == TeamForgeDoctorLevel.Warning
                    ? $"{root.Length} chars · a shorter Windows path is safer for managed copies/PackageCache."
                    : root));
        }

        private static void CheckConnection(List<TeamForgeDoctorResult> results)
        {
            if (TeamForgeConnectionService.State != TeamForgeConnectionState.Connected)
            {
                results.Add(new TeamForgeDoctorResult(
                    "Realtime",
                    TeamForgeDoctorLevel.Warning,
                    $"{TeamForgeConnectionService.State} · connect when you are ready to collaborate."));
                return;
            }

            var capabilities =
                $"Presence {Flag(TeamForgeConnectionService.PresenceAvailable)}, " +
                $"Transform {Flag(TeamForgeConnectionService.TransformSyncAvailable)}, " +
                $"Hierarchy {Flag(TeamForgeConnectionService.HierarchySyncAvailable)}, " +
                $"Project Transfer {Flag(TeamForgeConnectionService.ProjectTransferAvailable)}";
            var pass = TeamForgeConnectionService.PresenceAvailable &&
                       TeamForgeConnectionService.TransformSyncAvailable &&
                       TeamForgeConnectionService.HierarchySyncAvailable;
            results.Add(new TeamForgeDoctorResult(
                "Realtime",
                pass ? TeamForgeDoctorLevel.Pass : TeamForgeDoctorLevel.Warning,
                capabilities));
        }

        private static void CheckProjectTransfer(List<TeamForgeDoctorResult> results)
        {
            var state = TeamForgeProjectService.State;
            var problem = state == TeamForgeProjectBootstrapState.DescriptorInvalid ||
                          state == TeamForgeProjectBootstrapState.ProjectUuidMismatch ||
                          state == TeamForgeProjectBootstrapState.InvitationMismatch;
            if (problem)
            {
                var detail = string.IsNullOrWhiteSpace(TeamForgeProjectService.LastError)
                    ? state.ToString()
                    : TeamForgeQuickStartUtility.FriendlyConnectionError(TeamForgeProjectService.LastError);
                results.Add(new TeamForgeDoctorResult(
                    "Project Bootstrap",
                    TeamForgeDoctorLevel.Warning,
                    detail));
                return;
            }

            results.Add(new TeamForgeDoctorResult(
                "Project Bootstrap",
                TeamForgeDoctorLevel.Pass,
                state.ToString()));
        }

        private static void CheckTestLab(List<TeamForgeDoctorResult> results)
        {
            var role = TeamForgeQuickStartUtility.TestLabRole();
            if (string.IsNullOrWhiteSpace(role)) return;
            results.Add(new TeamForgeDoctorResult(
                "Test Lab",
                TeamForgeDoctorLevel.Pass,
                $"This Editor is Test Lab client {role}."));
        }

        private static string Flag(bool value) => value ? "✓" : "–";
    }
}

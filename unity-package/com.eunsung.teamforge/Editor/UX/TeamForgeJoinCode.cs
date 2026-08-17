using System;
using System.IO;
using System.Text;
using UnityEngine;

namespace EunSung.TeamForge
{
    public enum TeamForgeJoinProjectCompatibility
    {
        Compatible = 0,
        LocalProjectIdentityMissing = 1,
        ProjectIdentityMismatch = 2,
    }

    [Serializable]
    public sealed class TeamForgeJoinCodePayload
    {
        public string format = TeamForgeJoinCode.Format;
        public string serverAddress = string.Empty;
        public string realtimePath = string.Empty;
        public string projectId = string.Empty;
        public string sessionId = string.Empty;
        public string projectUuid = string.Empty;
        public string productVersion = string.Empty;
        public string hostDisplayName = string.Empty;
        public string createdUtc = string.Empty;
        public TeamForgeSceneBaseline sceneBaseline;
    }

    public static class TeamForgeJoinCode
    {
        public const string Format = "teamforge-join-v1";
        public const string Prefix = "TF1.";

        public static bool TryCreate(out string code, out string error)
        {
            return TryCreateCore(false, out code, out error);
        }

        internal static bool TryCreateFresh(out string code, out string error)
        {
            return TryCreateCore(true, out code, out error);
        }

        private static bool TryCreateCore(bool requireFreshSceneBaseline, out string code, out string error)
        {
            code = string.Empty;
            var settings = TeamForgeConnectionService.Settings;
            settings.EnsureDefaults();

            if (!TeamForgeUriBuilder.TryBuildWebSocketUri(
                    settings.ServerAddress,
                    settings.RealtimePath,
                    out _,
                    out error) ||
                !TeamForgeInputValidator.TryValidateIdentity(
                    settings.UserName,
                    settings.ProjectId,
                    settings.SessionId,
                    out error))
            {
                return false;
            }

            var descriptor = TeamForgeProjectService.Descriptor;
            var projectUuid = descriptor?.projectUuid ?? string.Empty;
            TeamForgeSceneBaseline sceneBaseline;
            string createdUtc;
            if (requireFreshSceneBaseline ||
                !TeamForgeInviteCache.TryGet(settings.SessionId.Trim(), projectUuid, out sceneBaseline, out createdUtc))
            {
                if (!TeamForgeBaselineFingerprint.TryCaptureActiveScene(out sceneBaseline, out error))
                {
                    return false;
                }
                createdUtc = DateTime.UtcNow.ToString("O");
                TeamForgeInviteCache.Store(settings.SessionId.Trim(), projectUuid, sceneBaseline, createdUtc);
            }

            var payload = new TeamForgeJoinCodePayload
            {
                serverAddress = settings.ServerAddress.Trim(),
                realtimePath = settings.RealtimePath.Trim(),
                projectId = settings.ProjectId.Trim(),
                sessionId = settings.SessionId.Trim(),
                projectUuid = projectUuid,
                productVersion = TeamForgeProjectContract.ProductVersion,
                hostDisplayName = settings.UserName.Trim(),
                createdUtc = createdUtc,
                sceneBaseline = sceneBaseline,
            };

            var json = JsonUtility.ToJson(payload, false);
            code = Prefix + ToBase64Url(Encoding.UTF8.GetBytes(json));
            error = string.Empty;
            return true;
        }

        public static bool TryParse(string code, out TeamForgeJoinCodePayload payload, out string error)
        {
            payload = null;
            var candidate = code?.Trim() ?? string.Empty;
            if (!candidate.StartsWith(Prefix, StringComparison.Ordinal) || candidate.Length > 8192)
            {
                error = "This is not a supported TeamForge join code.";
                return false;
            }

            try
            {
                var encoded = candidate.Substring(Prefix.Length);
                var json = Encoding.UTF8.GetString(FromBase64Url(encoded));
                payload = JsonUtility.FromJson<TeamForgeJoinCodePayload>(json);
            }
            catch (Exception)
            {
                payload = null;
                error = "The TeamForge join code is damaged or incomplete.";
                return false;
            }

            if (payload == null || !string.Equals(payload.format, Format, StringComparison.Ordinal))
            {
                payload = null;
                error = "The TeamForge join code format is not supported.";
                return false;
            }

            if (!string.Equals(payload.productVersion, TeamForgeProjectContract.ProductVersion, StringComparison.Ordinal))
            {
                var targetVersion = payload.productVersion;
                payload = null;
                error = $"This join code targets TeamForge {targetVersion ?? "unknown"}; this package is {TeamForgeProjectContract.ProductVersion}.";
                return false;
            }

            if (!TeamForgeUriBuilder.TryBuildWebSocketUri(
                    payload.serverAddress,
                    payload.realtimePath,
                    out _,
                    out error) ||
                !TeamForgeInputValidator.TryValidateText(payload.projectId, "Project ID", 128, out error) ||
                !TeamForgeInputValidator.TryValidateText(payload.sessionId, "Session ID", 128, out error))
            {
                payload = null;
                return false;
            }

            if (!string.IsNullOrEmpty(payload.projectUuid) &&
                !TeamForgeProjectValidation.TryValidateCanonicalProjectUuid(payload.projectUuid, out error))
            {
                payload = null;
                return false;
            }

            if (payload.sceneBaseline != null)
            {
                if (string.IsNullOrWhiteSpace(payload.sceneBaseline.scenePath) ||
                    !IsHex(payload.sceneBaseline.sceneGuid, 32) ||
                    !IsHex(payload.sceneBaseline.sha256, 64))
                {
                    payload = null;
                    error = "The join code contains an invalid Scene baseline fingerprint.";
                    return false;
                }
            }

            error = string.Empty;
            return true;
        }

        public static TeamForgeJoinProjectCompatibility EvaluateProjectCompatibility(
            TeamForgeJoinCodePayload payload,
            TeamForgeProjectDescriptor descriptor)
        {
            if (payload == null || string.IsNullOrWhiteSpace(payload.projectUuid))
            {
                return TeamForgeJoinProjectCompatibility.Compatible;
            }

            if (descriptor == null || string.IsNullOrWhiteSpace(descriptor.projectUuid))
            {
                return TeamForgeJoinProjectCompatibility.LocalProjectIdentityMissing;
            }

            return string.Equals(descriptor.projectUuid, payload.projectUuid, StringComparison.Ordinal)
                ? TeamForgeJoinProjectCompatibility.Compatible
                : TeamForgeJoinProjectCompatibility.ProjectIdentityMismatch;
        }

        public static bool TryApply(string code, out string error)
        {
            return TryApply(code, false, out error, out _);
        }

        public static bool TryApply(string code, bool allowOpenExpectedScene, out string error)
        {
            return TryApply(code, allowOpenExpectedScene, out error, out _);
        }

        public static bool TryApply(
            string code,
            bool allowOpenExpectedScene,
            out string error,
            out string failureCode)
        {
            failureCode = string.Empty;
            if (!TryParse(code, out var payload, out error))
            {
                failureCode = "invalid_join_code";
                return false;
            }

            if (TeamForgeConnectionService.ConnectionDesired ||
                TeamForgeConnectionService.State != TeamForgeConnectionState.Disconnected &&
                TeamForgeConnectionService.State != TeamForgeConnectionState.Faulted)
            {
                error = "Disconnect TeamForge before applying a join code.";
                failureCode = "collaboration_already_connected";
                return false;
            }

            var descriptor = TeamForgeProjectService.Descriptor;
            switch (EvaluateProjectCompatibility(payload, descriptor))
            {
                case TeamForgeJoinProjectCompatibility.LocalProjectIdentityMissing:
                    error =
                        "This local Unity Project has no TeamForge baseline identity. " +
                        "Open a copy/sync of the host Project, then use the join code again.";
                    failureCode = "project_identity_mismatch";
                    return false;
                case TeamForgeJoinProjectCompatibility.ProjectIdentityMismatch:
                    error =
                        "This local Unity Project does not match the host Project baseline. " +
                        "Use a copy/sync of the host Project instead of forcing the identity.";
                    failureCode = "project_identity_mismatch";
                    return false;
            }

            if (!TeamForgeBaselineFingerprint.TryValidateLocalScene(
                    payload.sceneBaseline,
                    allowOpenExpectedScene,
                    out error,
                    out failureCode))
            {
                return false;
            }

            var settings = TeamForgeConnectionService.Settings;
            settings.ServerAddress = payload.serverAddress;
            settings.RealtimePath = payload.realtimePath;
            settings.ProjectId = payload.projectId;
            settings.SessionId = payload.sessionId;
            settings.SaveSettings();
            TeamForgeInviteCache.Store(payload.sessionId, payload.projectUuid, payload.sceneBaseline, payload.createdUtc);
            TeamForgeConnectionService.CancelAutomaticResumeForConfigurationChange();
            error = string.Empty;
            return true;
        }

        public static string Describe(TeamForgeJoinCodePayload payload)
        {
            if (payload == null)
            {
                return "Unknown TeamForge session";
            }

            var host = string.IsNullOrWhiteSpace(payload.hostDisplayName) ? "TeamForge host" : payload.hostDisplayName.Trim();
            var scene = payload.sceneBaseline == null || string.IsNullOrWhiteSpace(payload.sceneBaseline.scenePath)
                ? "Scene baseline not included"
                : payload.sceneBaseline.scenePath;
            return $"Host: {host}\nProject: {payload.projectId}\nSession: {payload.sessionId}\nScene: {scene}\nServer: {payload.serverAddress}";
        }

        private static bool IsHex(string value, int length)
        {
            if (string.IsNullOrWhiteSpace(value) || value.Length != length)
            {
                return false;
            }

            for (var index = 0; index < value.Length; index += 1)
            {
                if (!Uri.IsHexDigit(value[index]))
                {
                    return false;
                }
            }
            return true;
        }

        private static string ToBase64Url(byte[] bytes)
        {
            return Convert.ToBase64String(bytes)
                .TrimEnd('=')
                .Replace('+', '-')
                .Replace('/', '_');
        }

        private static byte[] FromBase64Url(string value)
        {
            var normalized = (value ?? string.Empty)
                .Replace('-', '+')
                .Replace('_', '/');
            switch (normalized.Length % 4)
            {
                case 2:
                    normalized += "==";
                    break;
                case 3:
                    normalized += "=";
                    break;
                case 1:
                    throw new FormatException("Invalid base64url length.");
            }
            return Convert.FromBase64String(normalized);
        }
    }

    public static class TeamForgeJoinProjectLocator
    {
        private const long MaximumDescriptorBytes = 65536;

        public static bool TryValidateMatchingProjectFolder(
            string projectRoot,
            string expectedProjectUuid,
            out TeamForgeProjectDescriptor descriptor,
            out string error)
        {
            descriptor = null;
            if (string.IsNullOrWhiteSpace(projectRoot))
            {
                error = "No Unity Project folder was selected.";
                return false;
            }

            if (!TeamForgeProjectValidation.TryValidateCanonicalProjectUuid(expectedProjectUuid, out error))
            {
                return false;
            }

            try
            {
                var root = new DirectoryInfo(Path.GetFullPath(projectRoot));
                if (!root.Exists)
                {
                    error = "The selected folder does not exist.";
                    return false;
                }
                if ((root.Attributes & FileAttributes.ReparsePoint) != 0)
                {
                    error = "The selected Project root cannot be a symbolic link or reparse point.";
                    return false;
                }

                if (!Directory.Exists(Path.Combine(root.FullName, "Assets")) ||
                    !File.Exists(Path.Combine(root.FullName, "Packages", "manifest.json")) ||
                    !File.Exists(Path.Combine(root.FullName, "ProjectSettings", "ProjectVersion.txt")))
                {
                    error = "The selected folder is not a complete Unity Project root.";
                    return false;
                }

                var descriptorPath = Path.Combine(
                    root.FullName,
                    TeamForgeProjectContract.DescriptorRelativePath.Replace('/', Path.DirectorySeparatorChar));
                if (!File.Exists(descriptorPath))
                {
                    error =
                        "The selected Unity Project has no TeamForge Project identity. " +
                        "Choose a copy/sync of the host Project that contains ProjectSettings/TeamForgeProject.json.";
                    return false;
                }

                var descriptorInfo = new FileInfo(descriptorPath);
                if ((descriptorInfo.Attributes & FileAttributes.ReparsePoint) != 0 ||
                    descriptorInfo.Length <= 0 ||
                    descriptorInfo.Length > MaximumDescriptorBytes)
                {
                    error = "The selected TeamForge Project descriptor is not safe to read.";
                    return false;
                }

                var json = File.ReadAllText(descriptorPath, Encoding.UTF8);
                descriptor = JsonUtility.FromJson<TeamForgeProjectDescriptor>(json);
                if (!TeamForgeProjectValidation.TryValidateDescriptor(descriptor, out error))
                {
                    descriptor = null;
                    return false;
                }

                if (!string.Equals(descriptor.projectUuid, expectedProjectUuid, StringComparison.Ordinal))
                {
                    descriptor = null;
                    error =
                        "That Unity Project is also a different TeamForge Project. " +
                        "Choose the host Project copy/sync instead of changing either UUID.";
                    return false;
                }

                error = string.Empty;
                return true;
            }
            catch (Exception exception)
            {
                descriptor = null;
                error = $"The selected Unity Project could not be checked safely ({exception.GetType().Name}).";
                return false;
            }
        }
    }

}

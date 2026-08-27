using System;
using System.IO;
using System.Text;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace EunSung.TeamForge
{
    [Serializable]
    internal sealed class TeamForgeVerifiedGuestReconnectData
    {
        public int schemaVersion = 1;
        public string projectUuid = string.Empty;
        public string sessionId = string.Empty;
        public long baselineRevision;
        public string manifestHash = string.Empty;
        public string descriptorHash = string.Empty;
        public string activeProjectPath = string.Empty;
    }

    internal static class TeamForgeVerifiedGuestReconnect
    {
        private const int SchemaVersion = 1;
        private const long MaximumMarkerBytes = 65536;

        private static string MarkerPath()
        {
            return Path.GetFullPath(Path.Combine("Library", "TeamForge", "verified-guest-reconnect.json"));
        }

        internal static bool Matches(TeamForgeGuestHandoffData handoff)
        {
            if (handoff == null ||
                !TeamForgeJoinCode.TryParse(handoff.sessionJoinCode, out var session, out _))
            {
                return false;
            }

            try
            {
                var path = MarkerPath();
                if (!File.Exists(path))
                {
                    return false;
                }

                var information = new FileInfo(path);
                if ((information.Attributes & (FileAttributes.Directory | FileAttributes.ReparsePoint)) != 0 ||
                    information.Length <= 0 || information.Length > MaximumMarkerBytes)
                {
                    return false;
                }

                var json = File.ReadAllText(path, new UTF8Encoding(false, true));
                var marker = JsonUtility.FromJson<TeamForgeVerifiedGuestReconnectData>(json);
                if (marker == null || marker.schemaVersion != SchemaVersion)
                {
                    return false;
                }

                return string.Equals(marker.projectUuid, handoff.projectUuid, StringComparison.Ordinal) &&
                       string.Equals(marker.sessionId, session.sessionId, StringComparison.Ordinal) &&
                       marker.baselineRevision == handoff.baselineRevision &&
                       string.Equals(marker.manifestHash, handoff.manifestHash, StringComparison.Ordinal) &&
                       string.Equals(marker.descriptorHash, handoff.descriptorHash, StringComparison.Ordinal) &&
                       PathsEqual(marker.activeProjectPath, handoff.activeProjectPath);
            }
            catch (Exception)
            {
                return false;
            }
        }

        internal static bool TryApplyJoinCode(
            string code,
            bool allowOpenExpectedScene,
            out string error)
        {
            if (!TeamForgeJoinCode.TryParse(code, out var payload, out error))
            {
                return false;
            }

            if (TeamForgeConnectionService.ConnectionDesired ||
                TeamForgeConnectionService.State != TeamForgeConnectionState.Disconnected &&
                TeamForgeConnectionService.State != TeamForgeConnectionState.Faulted)
            {
                error = "Disconnect TeamForge before applying a join code.";
                return false;
            }

            var descriptor = TeamForgeProjectService.Descriptor;
            switch (TeamForgeJoinCode.EvaluateProjectCompatibility(payload, descriptor))
            {
                case TeamForgeJoinProjectCompatibility.LocalProjectIdentityMissing:
                    error =
                        "This local Unity Project has no TeamForge baseline identity. " +
                        "Open a copy/sync of the host Project, then use the join code again.";
                    return false;
                case TeamForgeJoinProjectCompatibility.ProjectIdentityMismatch:
                    error =
                        "This local Unity Project does not match the host Project baseline. " +
                        "Use a copy/sync of the host Project instead of forcing the identity.";
                    return false;
            }

            if (!TryValidateSavedReconnectScene(payload.sceneBaseline, allowOpenExpectedScene, out error))
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

        internal static void Store(TeamForgeGuestHandoffData handoff)
        {
            if (handoff == null ||
                !TeamForgeJoinCode.TryParse(handoff.sessionJoinCode, out var session, out _))
            {
                return;
            }

            try
            {
                var marker = new TeamForgeVerifiedGuestReconnectData
                {
                    schemaVersion = SchemaVersion,
                    projectUuid = handoff.projectUuid,
                    sessionId = session.sessionId,
                    baselineRevision = handoff.baselineRevision,
                    manifestHash = handoff.manifestHash,
                    descriptorHash = handoff.descriptorHash,
                    activeProjectPath = Path.GetFullPath(handoff.activeProjectPath),
                };
                var destination = MarkerPath();
                var directory = Path.GetDirectoryName(destination);
                if (string.IsNullOrWhiteSpace(directory))
                {
                    return;
                }

                Directory.CreateDirectory(directory);
                var temporary = destination + ".tmp";
                File.WriteAllText(temporary, JsonUtility.ToJson(marker, false), new UTF8Encoding(false));
                if (File.Exists(destination))
                {
                    File.Replace(temporary, destination, null);
                }
                else
                {
                    File.Move(temporary, destination);
                }
            }
            catch (Exception exception)
            {
                TeamForgeDiagnostics.Warning(
                    $"Verified Guest reconnect marker could not be updated ({exception.GetType().Name}). Future reconnect will remain fail-closed.");
            }
        }

        private static bool TryValidateSavedReconnectScene(
            TeamForgeSceneBaseline expected,
            bool allowOpenExpectedScene,
            out string error)
        {
            if (expected == null ||
                string.IsNullOrWhiteSpace(expected.scenePath) ||
                string.IsNullOrWhiteSpace(expected.sceneGuid) ||
                string.IsNullOrWhiteSpace(expected.sha256))
            {
                error = string.Empty;
                return true;
            }

            var expectedPath = NormalizeAssetPath(expected.scenePath);
            var guidPath = NormalizeAssetPath(AssetDatabase.GUIDToAssetPath(expected.sceneGuid));
            if (string.IsNullOrWhiteSpace(guidPath) ||
                !string.Equals(guidPath, expectedPath, StringComparison.Ordinal))
            {
                error =
                    $"This verified Project no longer contains the expected collaboration Scene ({expectedPath}). " +
                    "Receive the Project again instead of bypassing Scene identity.";
                return false;
            }

            var fullPath = Path.GetFullPath(Path.Combine(Directory.GetCurrentDirectory(), expectedPath));
            if (!File.Exists(fullPath))
            {
                error =
                    $"The verified collaboration Scene is missing ({expectedPath}). " +
                    "Receive the Project again before reconnecting.";
                return false;
            }

            var active = SceneManager.GetActiveScene();
            var activePath = active.IsValid() ? NormalizeAssetPath(active.path) : string.Empty;
            if (string.Equals(activePath, expectedPath, StringComparison.Ordinal))
            {
                if (active.isDirty)
                {
                    error = "The active Scene has unsaved local changes. Save or discard them before reconnecting.";
                    return false;
                }

                error = string.Empty;
                return true;
            }

            if (!allowOpenExpectedScene)
            {
                error = $"Open {expectedPath} before reconnecting this verified Guest.";
                return false;
            }

            if (HasDirtyLoadedScenes() && !EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo())
            {
                error = "Reconnect cancelled while handling unsaved Scene changes.";
                return false;
            }

            try
            {
                EditorSceneManager.OpenScene(expectedPath, OpenSceneMode.Single);
                error = string.Empty;
                return true;
            }
            catch (Exception exception)
            {
                error = $"TeamForge could not open the verified collaboration Scene ({exception.GetType().Name}).";
                return false;
            }
        }

        private static bool HasDirtyLoadedScenes()
        {
            for (var index = 0; index < SceneManager.sceneCount; index += 1)
            {
                var scene = SceneManager.GetSceneAt(index);
                if (scene.IsValid() && scene.isLoaded && scene.isDirty)
                {
                    return true;
                }
            }

            return false;
        }

        private static string NormalizeAssetPath(string path)
        {
            return (path ?? string.Empty).Replace('\\', '/').Trim();
        }

        private static bool PathsEqual(string left, string right)
        {
            try
            {
                return string.Equals(
                    Path.GetFullPath(left ?? string.Empty),
                    Path.GetFullPath(right ?? string.Empty),
                    Path.DirectorySeparatorChar == '\\'
                        ? StringComparison.OrdinalIgnoreCase
                        : StringComparison.Ordinal);
            }
            catch (Exception)
            {
                return false;
            }
        }
    }
}

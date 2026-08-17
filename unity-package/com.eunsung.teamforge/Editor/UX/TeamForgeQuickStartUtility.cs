using System;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace EunSung.TeamForge
{
    public static class TeamForgeQuickStartUtility
    {
        public static bool TryEnsureProjectSetup(bool createNewSession, out string error)
        {
            if (!TeamForgeProjectService.TryEnsureCurrentProjectDescriptor(out var descriptor, out error))
            {
                return false;
            }

            var settings = TeamForgeConnectionService.Settings;
            settings.EnsureDefaults();

            if (string.IsNullOrWhiteSpace(settings.ProjectId) ||
                string.Equals(settings.ProjectId.Trim(), "default-project", StringComparison.Ordinal))
            {
                settings.ProjectId = "project-" + descriptor.projectUuid.Substring(0, 8);
            }

            if (createNewSession ||
                string.IsNullOrWhiteSpace(settings.SessionId) ||
                string.Equals(settings.SessionId.Trim(), "default-session", StringComparison.Ordinal))
            {
                settings.SessionId = NewSessionId();
            }

            settings.SaveSettings();
            error = string.Empty;
            return true;
        }

        public static bool TryPrepareHost(out string joinCode, out string error)
        {
            joinCode = string.Empty;
            if (!EnsureSavedActiveSceneInteractive(out error))
            {
                return false;
            }
            if (!TryEnsureProjectSetup(true, out error))
            {
                return false;
            }
            if (!TeamForgeJoinCode.TryCreate(out joinCode, out error))
            {
                return false;
            }
            return true;
        }

        public static bool TryJoinFromClipboard(out string error)
        {
            return TryJoinCode(EditorGUIUtility.systemCopyBuffer, true, out error);
        }

        public static bool TryJoinCode(string code, bool allowOpenExpectedScene, out string error)
        {
            return TryJoinCode(code, allowOpenExpectedScene, out error, out _);
        }

        public static bool TryJoinCode(
            string code,
            bool allowOpenExpectedScene,
            out string error,
            out string failureCode)
        {
            failureCode = string.Empty;
            if (!TeamForgeJoinCode.TryParse(code, out var payload, out error))
            {
                failureCode = "invalid_join_code";
                return false;
            }

            if (!TeamForgeJoinCode.TryApply(code, allowOpenExpectedScene, out error, out failureCode))
            {
                return false;
            }

            TeamForgeDiagnostics.Info(
                $"Join settings applied for {payload.projectId}/{payload.sessionId}. Credentials were not imported from the join code.");
            return true;
        }

        public static bool EnsureSavedActiveSceneInteractive(out string error)
        {
            var scene = SceneManager.GetActiveScene();
            if (!scene.IsValid())
            {
                error = "Open a Scene before starting TeamForge.";
                return false;
            }

            if (string.IsNullOrWhiteSpace(scene.path) || scene.isDirty)
            {
                if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo())
                {
                    error = "TeamForge needs a saved Scene baseline. Setup was cancelled.";
                    return false;
                }
                scene = SceneManager.GetActiveScene();
            }

            if (!scene.IsValid() || string.IsNullOrWhiteSpace(scene.path) || scene.isDirty)
            {
                error = "Save the active Scene before starting TeamForge.";
                return false;
            }

            error = string.Empty;
            return true;
        }

        public static string NewSessionId()
        {
            return $"session-{DateTime.UtcNow:yyyyMMdd-HHmmss}-{Guid.NewGuid():N}".Substring(0, 38);
        }

        public static string ShortProjectIdentity()
        {
            var descriptor = TeamForgeProjectService.Descriptor;
            if (descriptor == null || string.IsNullOrEmpty(descriptor.projectUuid))
            {
                return "Not set up";
            }
            return descriptor.projectUuid.Length <= 12
                ? descriptor.projectUuid
                : descriptor.projectUuid.Substring(0, 12) + "…";
        }

        public static string TestLabRole()
        {
            if (!string.Equals(Environment.GetEnvironmentVariable("TEAMFORGE_TESTLAB"), "1", StringComparison.Ordinal))
            {
                return string.Empty;
            }
            return (Environment.GetEnvironmentVariable("TEAMFORGE_TESTLAB_ROLE") ?? string.Empty).Trim();
        }

        public static string FriendlyConnectionError(string error)
        {
            var value = error ?? string.Empty;
            if (value.IndexOf("hierarchy_object_deleted", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                return "An object was deleted while this Editor still had an older local edit. The server kept the deletion and discarded the stale edit.";
            }
            if (value.IndexOf("401", StringComparison.OrdinalIgnoreCase) >= 0 ||
                value.IndexOf("unauthorized", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                return "Authentication failed. Open Advanced and check the local Bearer token.";
            }
            if (value.IndexOf("Project registry requires a Project UUID", StringComparison.OrdinalIgnoreCase) >= 0 ||
                value.IndexOf("non-empty Project registry requires a Project UUID", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                return "Project transfer metadata is incomplete. Re-create or re-sync the Project baseline before using Project Bootstrap.";
            }
            if (value.IndexOf("GlobalObjectId", StringComparison.OrdinalIgnoreCase) >= 0 &&
                value.IndexOf("missing locally", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                return "This Editor is not on the same saved Scene baseline as the session. Use the host Project copy/sync before joining.";
            }
            return value;
        }
    }
}

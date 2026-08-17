using System;
using UnityEditor;

namespace EunSung.TeamForge
{
    [FilePath("UserSettings/TeamForgeInviteCache.asset", FilePathAttribute.Location.ProjectFolder)]
    public sealed class TeamForgeInviteCache : ScriptableSingleton<TeamForgeInviteCache>
    {
        public string SessionId = string.Empty;
        public string ProjectUuid = string.Empty;
        public string CreatedUtc = string.Empty;
        public string ScenePath = string.Empty;
        public string SceneGuid = string.Empty;
        public string SceneSha256 = string.Empty;

        public static void Store(string sessionId, string projectUuid, TeamForgeSceneBaseline baseline, string createdUtc = null)
        {
            if (baseline == null) return;
            var cache = instance;
            cache.SessionId = sessionId ?? string.Empty;
            cache.ProjectUuid = projectUuid ?? string.Empty;
            cache.CreatedUtc = string.IsNullOrWhiteSpace(createdUtc) ? DateTime.UtcNow.ToString("O") : createdUtc;
            cache.ScenePath = baseline.scenePath ?? string.Empty;
            cache.SceneGuid = baseline.sceneGuid ?? string.Empty;
            cache.SceneSha256 = baseline.sha256 ?? string.Empty;
            cache.Save(true);
        }

        public static bool TryGet(string sessionId, string projectUuid, out TeamForgeSceneBaseline baseline, out string createdUtc)
        {
            var cache = instance;
            baseline = null;
            createdUtc = string.Empty;
            if (!string.Equals(cache.SessionId, sessionId ?? string.Empty, StringComparison.Ordinal) ||
                !string.Equals(cache.ProjectUuid, projectUuid ?? string.Empty, StringComparison.Ordinal) ||
                string.IsNullOrWhiteSpace(cache.ScenePath) ||
                string.IsNullOrWhiteSpace(cache.SceneGuid) ||
                string.IsNullOrWhiteSpace(cache.SceneSha256))
            {
                return false;
            }

            baseline = new TeamForgeSceneBaseline
            {
                scenePath = cache.ScenePath,
                sceneGuid = cache.SceneGuid,
                sha256 = cache.SceneSha256,
            };
            createdUtc = cache.CreatedUtc;
            return true;
        }
    }
}

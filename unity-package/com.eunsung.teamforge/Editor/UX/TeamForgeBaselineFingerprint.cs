using System;
using System.IO;
using System.Security.Cryptography;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine.SceneManagement;

namespace EunSung.TeamForge
{
    [Serializable]
    public sealed class TeamForgeSceneBaseline
    {
        public string scenePath = string.Empty;
        public string sceneGuid = string.Empty;
        public string sha256 = string.Empty;
    }

    public static class TeamForgeBaselineFingerprint
    {
        public static bool TryCaptureActiveScene(out TeamForgeSceneBaseline baseline, out string error)
        {
            baseline = null;
            var scene = SceneManager.GetActiveScene();
            if (!scene.IsValid() || string.IsNullOrWhiteSpace(scene.path))
            {
                error = "Save the active Scene once before starting collaboration.";
                return false;
            }
            if (scene.isDirty)
            {
                error = "Save the active Scene before starting collaboration so everyone begins from the same baseline.";
                return false;
            }

            var scenePath = NormalizeAssetPath(scene.path);
            var sceneGuid = AssetDatabase.AssetPathToGUID(scenePath);
            if (string.IsNullOrWhiteSpace(sceneGuid))
            {
                error = "TeamForge could not resolve the active Scene asset GUID.";
                return false;
            }

            var fullPath = Path.GetFullPath(Path.Combine(Directory.GetCurrentDirectory(), scenePath));
            if (!File.Exists(fullPath))
            {
                error = "The active Scene file is missing on disk.";
                return false;
            }

            if (!TryHashFile(fullPath, out var sha256, out error))
            {
                return false;
            }

            baseline = new TeamForgeSceneBaseline
            {
                scenePath = scenePath,
                sceneGuid = sceneGuid,
                sha256 = sha256,
            };
            error = string.Empty;
            return true;
        }

        public static bool TryValidateLocalScene(
            TeamForgeSceneBaseline expected,
            bool allowOpenExpectedScene,
            out string error)
        {
            return TryValidateLocalScene(expected, allowOpenExpectedScene, out error, out _);
        }

        public static bool TryValidateLocalScene(
            TeamForgeSceneBaseline expected,
            bool allowOpenExpectedScene,
            out string error,
            out string failureCode)
        {
            failureCode = string.Empty;
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
                    $"This Project does not contain the host Scene baseline ({expectedPath}). " +
                    "Sync/copy the host Project, then join again.";
                failureCode = "scene_baseline_mismatch";
                return false;
            }

            var fullPath = Path.GetFullPath(Path.Combine(Directory.GetCurrentDirectory(), expectedPath));
            if (!File.Exists(fullPath))
            {
                error =
                    $"The saved Scene baseline file is missing ({expectedPath}). " +
                    "Sync/copy the host Project before joining.";
                failureCode = "scene_baseline_mismatch";
                return false;
            }
            if (!TryHashFile(fullPath, out var localHash, out error))
            {
                failureCode = "scene_baseline_unreadable";
                return false;
            }
            if (!string.Equals(localHash, expected.sha256, StringComparison.OrdinalIgnoreCase))
            {
                error =
                    $"The saved Scene baseline differs from the host ({expectedPath}). " +
                    "Sync/copy the host Project before joining instead of forcing the session.";
                failureCode = "scene_baseline_mismatch";
                return false;
            }

            var active = SceneManager.GetActiveScene();
            var activePath = active.IsValid() ? NormalizeAssetPath(active.path) : string.Empty;
            if (string.Equals(activePath, expectedPath, StringComparison.Ordinal))
            {
                if (active.isDirty)
                {
                    error = "The active Scene has unsaved local changes. Save or discard them before joining.";
                    failureCode = "scene_unsaved_changes";
                    return false;
                }
                error = string.Empty;
                return true;
            }

            if (!allowOpenExpectedScene)
            {
                error = $"Open {expectedPath} before joining this session.";
                failureCode = "scene_not_open";
                return false;
            }

            if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo())
            {
                error = "Join cancelled while handling unsaved Scene changes.";
                failureCode = "scene_open_cancelled";
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
                error = $"TeamForge could not open the host Scene ({exception.GetType().Name}).";
                failureCode = "scene_open_failed";
                return false;
            }
        }


        internal static bool TryPrepareAutomationScene(
            TeamForgeSceneBaseline expected,
            out bool retryable,
            out string error)
        {
            retryable = false;
            if (expected == null ||
                string.IsNullOrWhiteSpace(expected.scenePath) ||
                string.IsNullOrWhiteSpace(expected.sceneGuid) ||
                string.IsNullOrWhiteSpace(expected.sha256))
            {
                error = "Test Lab is missing the host Scene baseline fingerprint.";
                return false;
            }

            var expectedPath = NormalizeAssetPath(expected.scenePath);
            var guidPath = NormalizeAssetPath(AssetDatabase.GUIDToAssetPath(expected.sceneGuid));
            if (string.IsNullOrWhiteSpace(guidPath))
            {
                retryable = true;
                error = $"Unity has not indexed the host Scene baseline yet ({expectedPath}).";
                return false;
            }
            if (!string.Equals(guidPath, expectedPath, StringComparison.Ordinal))
            {
                error =
                    $"The clone's Scene GUID resolves to {guidPath}, not the host baseline {expectedPath}. " +
                    "The clone will stay offline instead of forcing a mismatched Scene.";
                return false;
            }

            var fullPath = Path.GetFullPath(Path.Combine(Directory.GetCurrentDirectory(), expectedPath));
            if (!File.Exists(fullPath))
            {
                error = $"The cloned Project is missing the host Scene baseline file ({expectedPath}).";
                return false;
            }
            if (!TryHashFile(fullPath, out var localHash, out error))
            {
                retryable = true;
                return false;
            }
            if (!string.Equals(localHash, expected.sha256, StringComparison.OrdinalIgnoreCase))
            {
                error =
                    $"The cloned Scene baseline differs from the host ({expectedPath}). " +
                    "The clone will stay offline instead of accepting a different GlobalObjectId baseline.";
                return false;
            }

            var active = SceneManager.GetActiveScene();
            var activePath = active.IsValid() ? NormalizeAssetPath(active.path) : string.Empty;
            if (string.Equals(activePath, expectedPath, StringComparison.Ordinal) && active.isLoaded)
            {
                if (active.isDirty)
                {
                    error = "The cloned host baseline Scene already has unsaved local changes; Test Lab will not overwrite them.";
                    return false;
                }

                error = string.Empty;
                return true;
            }

            if (HasDirtyLoadedScenes())
            {
                error =
                    $"The clone has unsaved Scene changes before {expectedPath} could be opened. " +
                    "Test Lab will stay offline rather than discard them.";
                return false;
            }

            try
            {
                var opened = EditorSceneManager.OpenScene(expectedPath, OpenSceneMode.Single);
                var openedPath = opened.IsValid() ? NormalizeAssetPath(opened.path) : string.Empty;
                if (!opened.IsValid() || !opened.isLoaded ||
                    !string.Equals(openedPath, expectedPath, StringComparison.Ordinal))
                {
                    retryable = true;
                    error = $"Unity did not finish loading the host Scene baseline yet ({expectedPath}).";
                    return false;
                }

                SceneManager.SetActiveScene(opened);
                error = string.Empty;
                return true;
            }
            catch (ArgumentException exception)
            {
                error = $"TeamForge could not open the host Scene baseline ({exception.GetType().Name}).";
                return false;
            }
            catch (Exception exception)
            {
                retryable = true;
                error = $"Unity is not ready to open the host Scene baseline yet ({exception.GetType().Name}).";
                return false;
            }
        }

        public static string HashBytes(byte[] bytes)
        {
            using (var sha = SHA256.Create())
            {
                return ToHex(sha.ComputeHash(bytes ?? Array.Empty<byte>()));
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

        private static bool TryHashFile(string fullPath, out string hash, out string error)
        {
            hash = string.Empty;
            try
            {
                using (var stream = new FileStream(fullPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
                using (var sha = SHA256.Create())
                {
                    hash = ToHex(sha.ComputeHash(stream));
                }
                error = string.Empty;
                return true;
            }
            catch (Exception exception)
            {
                error = $"TeamForge could not fingerprint the saved Scene ({exception.GetType().Name}).";
                return false;
            }
        }

        private static string ToHex(byte[] bytes)
        {
            return BitConverter.ToString(bytes).Replace("-", string.Empty).ToLowerInvariant();
        }

        private static string NormalizeAssetPath(string path)
        {
            return (path ?? string.Empty).Replace('\\', '/').Trim();
        }
    }
}

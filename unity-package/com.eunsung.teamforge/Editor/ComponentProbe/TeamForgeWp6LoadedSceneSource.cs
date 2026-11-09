using System;
using System.IO;
using System.Security.Cryptography;
using UnityEngine.SceneManagement;

namespace EunSung.TeamForge
{
    // WP6 Editor-only local source *consistency* observation. This neither
    // verifies a Publisher signature nor asserts that Unity's loaded
    // SerializedProperties were parsed from the checked file bytes.
    // No Scene writes, Undo, network calls or persistent state.
    internal static class TeamForgeWp6LoadedSceneSource
    {
        private const long MaximumSceneBytes = 128L * 1024 * 1024;
        private const int MaximumMetaBytes = 64 * 1024;

        internal sealed class Capture
        {
            internal Capture(TeamForgeWp6SceneInventory.Snapshot inventory,
                string scenePath, string sceneFileSha256, string metaSha256)
            {
                Inventory = inventory;
                ScenePath = scenePath;
                SceneFileSha256 = sceneFileSha256;
                MetaSha256 = metaSha256;
            }

            internal TeamForgeWp6SceneInventory.Snapshot Inventory { get; }
            internal string ScenePath { get; }
            internal string SceneFileSha256 { get; }
            internal string MetaSha256 { get; }
            internal string SceneGuid => Inventory.SceneId;
        }

        private static bool Hex(string text, int count)
        {
            if (text == null || text.Length != count)
                return false;
            foreach (var c in text)
            {
                if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')))
                    return false;
            }
            return true;
        }

        private static bool CanonicalScenePath(string text)
        {
            if (string.IsNullOrEmpty(text) || text.Length > 1024 ||
                !text.StartsWith("Assets/", StringComparison.Ordinal) ||
                !text.EndsWith(".unity", StringComparison.Ordinal) ||
                text.IndexOf('\\') >= 0 || text.IndexOf(':') >= 0)
                return false;
            foreach (var segment in text.Split('/'))
            {
                if (segment.Length == 0 || segment == "." || segment == "..")
                    return false;
            }
            return true;
        }

        internal static bool TryCapture(TeamForgeSceneBaseline expected,
            string expectedMetaSha256, out Capture capture, out string error)
        {
            capture = null;
            if (expected == null || !CanonicalScenePath(expected.scenePath) ||
                !Hex(expected.sceneGuid, 32) ||
                expected.sceneGuid == "00000000000000000000000000000000" ||
                !Hex(expected.sha256, 64) || !Hex(expectedMetaSha256, 64))
            {
                error = "An exact published Scene path, GUID and file/meta SHA-256 are required.";
                return false;
            }

            var scene = SceneManager.GetActiveScene();
            if (!scene.IsValid() || !scene.isLoaded || scene.isDirty ||
                !string.Equals(scene.path.Replace('\\', '/'), expected.scenePath,
                    StringComparison.Ordinal))
            {
                error = "Open the exact clean saved Scene before WP6 source observation.";
                return false;
            }

            try
            {
                var sceneFilePath = Path.GetFullPath(
                    Path.Combine(Directory.GetCurrentDirectory(), expected.scenePath));
                var metadataPath = sceneFilePath + ".meta";
                if (!SafeRegularFile(sceneFilePath, MaximumSceneBytes) ||
                    !SafeRegularFile(metadataPath, MaximumMetaBytes))
                {
                    error = "The saved Scene or Unity metadata file is missing, redirected or over budget.";
                    return false;
                }

                if (!TeamForgeBaselineFingerprint.TryCaptureActiveScene(
                        out var first, out error) ||
                    !SamePublishedSource(first, expected) ||
                    !TryHashBoundedMeta(metadataPath, out var firstMeta) ||
                    !string.Equals(firstMeta, expectedMetaSha256, StringComparison.Ordinal))
                {
                    error = "The loaded Scene's saved file or metadata differs from the expected Project source.";
                    return false;
                }

                if (!TeamForgeWp6SceneInventory.TryCapture(scene, out var inventory, out error))
                    return false;
                if (inventory.SceneDirty || !string.Equals(inventory.SceneId,
                        expected.sceneGuid, StringComparison.Ordinal))
                {
                    error = "The observed Scene is dirty or has a mismatched Unity GUID.";
                    return false;
                }

                // Recheck both asset files and the active loaded Scene after
                // enumeration. A changed on-disk source never silently
                // qualifies as the original baseline.
                if (!SafeRegularFile(sceneFilePath, MaximumSceneBytes) ||
                    !SafeRegularFile(metadataPath, MaximumMetaBytes) ||
                    !TeamForgeBaselineFingerprint.TryCaptureActiveScene(
                        out var second, out error) ||
                    !SamePublishedSource(second, expected) ||
                    !string.Equals(first.sha256, second.sha256, StringComparison.Ordinal) ||
                    !TryHashBoundedMeta(metadataPath, out var secondMeta) ||
                    !string.Equals(firstMeta, secondMeta, StringComparison.Ordinal) ||
                    !scene.IsValid() || !scene.isLoaded || scene.isDirty ||
                    scene != SceneManager.GetActiveScene())
                {
                    error = "Scene identity, dirty state or saved file bytes changed during WP6 observation.";
                    return false;
                }

                capture = new Capture(inventory, first.scenePath, first.sha256, firstMeta);
                error = string.Empty;
                return true;
            }
            catch (Exception)
            {
                error = "Unity saved-Scene source could not be read safely.";
                return false;
            }
        }

        private static bool SamePublishedSource(TeamForgeSceneBaseline actual,
            TeamForgeSceneBaseline expected)
        {
            return actual != null &&
                string.Equals(actual.scenePath, expected.scenePath, StringComparison.Ordinal) &&
                string.Equals(actual.sceneGuid, expected.sceneGuid, StringComparison.Ordinal) &&
                string.Equals(actual.sha256, expected.sha256, StringComparison.Ordinal);
        }

        private static bool SafeRegularFile(string path, long maximumBytes)
        {
            var attributes = File.GetAttributes(path);
            var info = new FileInfo(path);
            return (attributes & (FileAttributes.Directory | FileAttributes.ReparsePoint)) == 0 &&
                info.Length > 0 && info.Length <= maximumBytes;
        }

        private static bool TryHashBoundedMeta(string path, out string hash)
        {
            hash = string.Empty;
            using (var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read))
            using (var sha = SHA256.Create())
            {
                if (stream.Length < 1 || stream.Length > MaximumMetaBytes)
                    return false;
                // A bounded read loop prevents a concurrently growing file
                // from bypassing the metadata allocation/read ceiling.
                var bytes = new byte[MaximumMetaBytes + 1];
                var size = 0;
                int count;
                while (size < bytes.Length &&
                       (count = stream.Read(bytes, size, bytes.Length - size)) > 0)
                    size += count;
                if (size == 0 || size > MaximumMetaBytes ||
                    stream.Length != size)
                    return false;
                hash = BitConverter.ToString(sha.ComputeHash(bytes, 0, size))
                    .Replace("-", string.Empty).ToLowerInvariant();
                return true;
            }
        }
    }
}

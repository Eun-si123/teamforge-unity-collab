using System;
using UnityEditor;
using UnityEditor.SceneManagement;

namespace EunSung.TeamForge
{
    // Observe Unity's native Asset/Prefab import and Scene save actions.
    // This NEVER publishes, mutates a Project or opens a second transfer path:
    // the Host's existing pinned M5 preview remains the only read-only review.
    [InitializeOnLoad]
    internal sealed class TeamForgeSavedSourceChangeListener : AssetPostprocessor
    {
        static TeamForgeSavedSourceChangeListener()
        {
            EditorSceneManager.sceneSaved += _ => TeamForgeHostFlow.MarkLocalProjectSourceChanged();
        }

        private static void OnPostprocessAllAssets(string[] importedAssets,
            string[] deletedAssets, string[] movedAssets, string[] movedFromAssetPaths)
        {
            if (ContainsProjectSourceChange(importedAssets, deletedAssets, movedAssets, movedFromAssetPaths))
                TeamForgeHostFlow.MarkLocalProjectSourceChanged();
        }

        internal static bool ContainsProjectSourceChange(params string[][] batches)
        {
            if (batches == null) return false;
            foreach (var paths in batches)
            {
                if (paths == null) continue;
                foreach (var path in paths)
                {
                    // Unity path-only notification: do not read imported
                    // bytes, log private filenames, or inspect packages.
                    if (path == null ||
                        !(path.StartsWith("Assets/", StringComparison.Ordinal) ||
                          path.StartsWith("Packages/", StringComparison.Ordinal)) ||
                        (path.Length <= "Assets/".Length || path == "Packages/") ||
                        path.IndexOf('\\') >= 0 ||
                        path.IndexOf('\0') >= 0 || path.Contains("/../") || path.EndsWith("/..", StringComparison.Ordinal) ||
                        path.Contains("/./") || path.EndsWith("/.", StringComparison.Ordinal)) continue;
                    return true;
                }
            }
            return false;
        }
    }
}

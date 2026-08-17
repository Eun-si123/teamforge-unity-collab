using System;
using System.Linq;
using NUnit.Framework;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using Object = UnityEngine.Object;

namespace EunSung.TeamForge.Tests
{
    public sealed class TeamForgeGlobalObjectIdProbeTests
    {
        private const string TemporaryFolder = "Assets/__TeamForgePhase0Tests";

        [Test]
        public void SavedSceneObjectIdSurvivesReparentAndReloadWhileDuplicateGetsNewId()
        {
            EnsureTemporaryFolder();
            var scenePath = $"{TemporaryFolder}/{Guid.NewGuid():N}.unity";
            Scene workingScene = default;

            try
            {
                workingScene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                var root = new GameObject("TeamForge Root");
                SceneManager.MoveGameObjectToScene(root, workingScene);
                var child = new GameObject("Original Child");
                SceneManager.MoveGameObjectToScene(child, workingScene);
                child.transform.SetParent(root.transform);

                Assert.That(EditorSceneManager.SaveScene(workingScene, scenePath), Is.True);
                var originalId = GlobalObjectId.GetGlobalObjectIdSlow(child);
                Assert.That(TeamForgeObjectIdentity.TryGetGlobalObjectId(child, out var sharedId), Is.True);
                Assert.That(sharedId, Is.EqualTo(originalId.ToString()));
                Assert.That(TeamForgeObjectIdentity.TryResolveGameObject(sharedId, out var resolved), Is.True);
                Assert.That(resolved, Is.SameAs(child));

                var duplicate = Object.Instantiate(child, root.transform);
                duplicate.name = "Duplicate Child";
                Assert.That(EditorSceneManager.SaveScene(workingScene), Is.True);
                var duplicateId = GlobalObjectId.GetGlobalObjectIdSlow(duplicate);
                Assert.That(duplicateId, Is.Not.EqualTo(originalId));

                child.transform.SetParent(null);
                Assert.That(EditorSceneManager.SaveScene(workingScene), Is.True);
                Assert.That(GlobalObjectId.GetGlobalObjectIdSlow(child), Is.EqualTo(originalId));

                workingScene = EditorSceneManager.NewScene(
                    NewSceneSetup.EmptyScene,
                    NewSceneMode.Single);
                workingScene = EditorSceneManager.OpenScene(scenePath, OpenSceneMode.Single);
                var reloaded = workingScene.GetRootGameObjects().Single(gameObject => gameObject.name == "Original Child");
                Assert.That(GlobalObjectId.GetGlobalObjectIdSlow(reloaded), Is.EqualTo(originalId));
            }
            finally
            {
                if (workingScene.IsValid() && workingScene.isLoaded)
                {
                    workingScene = EditorSceneManager.NewScene(
                        NewSceneSetup.EmptyScene,
                        NewSceneMode.Single);
                }

                AssetDatabase.DeleteAsset(scenePath);
                if (AssetDatabase.IsValidFolder(TemporaryFolder) &&
                    AssetDatabase.FindAssets(string.Empty, new[] { TemporaryFolder }).Length == 0)
                {
                    AssetDatabase.DeleteAsset(TemporaryFolder);
                }
            }
        }

        private static void EnsureTemporaryFolder()
        {
            if (!AssetDatabase.IsValidFolder(TemporaryFolder))
            {
                AssetDatabase.CreateFolder("Assets", "__TeamForgePhase0Tests");
            }
        }
    }
}

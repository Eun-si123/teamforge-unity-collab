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

        [Test]
        public void SavedSameTypeComponentsKeepDistinctGlobalObjectIdsAcrossSceneReload()
        {
            EnsureTemporaryFolder();
            var scenePath = $"{TemporaryFolder}/{Guid.NewGuid():N}.unity";
            Scene workingScene = default;

            try
            {
                workingScene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                var host = new GameObject("TeamForge Component Identity Host");
                SceneManager.MoveGameObjectToScene(host, workingScene);

                // Component type and Inspector order cannot distinguish these two.
                var first = host.AddComponent<BoxCollider>();
                var second = host.AddComponent<BoxCollider>();
                first.center = new Vector3(1f, 2f, 3f);
                second.center = new Vector3(-1f, -2f, -3f);
                Assert.That(EditorSceneManager.SaveScene(workingScene, scenePath), Is.True);

                var firstIdentity = GlobalObjectId.GetGlobalObjectIdSlow(first).ToString();
                var secondIdentity = GlobalObjectId.GetGlobalObjectIdSlow(second).ToString();
                Assert.That(firstIdentity, Is.Not.EqualTo(secondIdentity));
                Assert.That(firstIdentity,
                    Does.Match("^GlobalObjectId_V1-[0-9]+-[0-9a-f]{32}-[0-9]+-[0-9]+$"));
                Assert.That(secondIdentity,
                    Does.Match("^GlobalObjectId_V1-[0-9]+-[0-9a-f]{32}-[0-9]+-[0-9]+$"));

                workingScene = EditorSceneManager.NewScene(
                    NewSceneSetup.EmptyScene, NewSceneMode.Single);
                workingScene = EditorSceneManager.OpenScene(scenePath, OpenSceneMode.Single);
                var reloaded = workingScene.GetRootGameObjects()
                    .Single(gameObject => gameObject.name == "TeamForge Component Identity Host");
                var reloadedColliders = reloaded.GetComponents<BoxCollider>();
                Assert.That(reloadedColliders.Length, Is.EqualTo(2));
                Assert.That(
                    reloadedColliders.Select(collider =>
                        GlobalObjectId.GetGlobalObjectIdSlow(collider).ToString()).ToArray(),
                    Is.EquivalentTo(new[] { firstIdentity, secondIdentity }));
            }
            finally
            {
                if (workingScene.IsValid() && workingScene.isLoaded)
                {
                    workingScene = EditorSceneManager.NewScene(
                        NewSceneSetup.EmptyScene, NewSceneMode.Single);
                }

                AssetDatabase.DeleteAsset(scenePath);
                if (AssetDatabase.IsValidFolder(TemporaryFolder) &&
                    AssetDatabase.FindAssets(string.Empty, new[] { TemporaryFolder }).Length == 0)
                {
                    AssetDatabase.DeleteAsset(TemporaryFolder);
                }
            }
        }

        [Test]
        public void InitialInspectorPropertyKindsMatchBoundedWp6CandidateShapes()
        {
            // This probes Unity's real SerializedProperty type classification, not
            // a realtime edit or a promise that these properties are synchronized.
            var host = new GameObject("TeamForge Inspector Type Probe");
            try
            {
                var box = host.AddComponent<BoxCollider>();
                var sphere = host.AddComponent<SphereCollider>();
                var boxProperties = new SerializedObject(box);
                var sphereProperties = new SerializedObject(sphere);

                var trigger = boxProperties.FindProperty("m_IsTrigger");
                var center = boxProperties.FindProperty("m_Center");
                var radius = sphereProperties.FindProperty("m_Radius");

                Assert.That(trigger, Is.Not.Null);
                Assert.That(center, Is.Not.Null);
                Assert.That(radius, Is.Not.Null);
                Assert.That(trigger.propertyType, Is.EqualTo(SerializedPropertyType.Boolean));
                Assert.That(center.propertyType, Is.EqualTo(SerializedPropertyType.Vector3));
                Assert.That(radius.propertyType, Is.EqualTo(SerializedPropertyType.Float));
            }
            finally
            {
                Object.DestroyImmediate(host);
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

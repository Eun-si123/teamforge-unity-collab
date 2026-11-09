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
    public sealed class TeamForgeWp6SceneInventoryTests
    {
        private const string TemporaryFolder = "Assets/__TeamForgeWp6SceneInventoryTests";

        [Test]
        public void MultipleCollidersProduceStableCompleteReadOnlyInventoryAcrossSceneReload()
        {
            var scenePath = PrepareScenePath();
            Scene scene = default;
            try
            {
                scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                var parent = new GameObject("inventory owner");
                SceneManager.MoveGameObjectToScene(parent, scene);
                var first = parent.AddComponent<BoxCollider>();
                var second = parent.AddComponent<BoxCollider>();
                first.center = new Vector3(1f, 2f, 3f);
                second.center = new Vector3(4f, 5f, 6f);
                var child = new GameObject("another owner");
                child.transform.SetParent(parent.transform);
                var sphere = child.AddComponent<SphereCollider>();
                sphere.radius = 2.25f;
                child.AddComponent<CapsuleCollider>(); // intentionally outside this allowlist
                var unrelatedRoot = new GameObject("unrelated root without allowed Colliders");
                SceneManager.MoveGameObjectToScene(unrelatedRoot, scene);

                Assert.That(EditorSceneManager.SaveScene(scene, scenePath), Is.True);
                var undoGroup = Undo.GetCurrentGroup();

                Assert.That(TeamForgeWp6SceneInventory.TryCapture(scene, out var captured, out var error),
                    Is.True, error);
                Assert.That(captured, Is.Not.Null);
                Assert.That(captured.SceneDirty, Is.False);
                Assert.That(captured.SceneId, Is.EqualTo(AssetDatabase.AssetPathToGUID(scenePath)));
                Assert.That(captured.Observations.Count, Is.EqualTo(3));
                var sortedIds = captured.Observations.Select(x => x.ComponentId).ToArray();
                Assert.That(sortedIds,
                    Is.EqualTo(sortedIds.OrderBy(x => x, StringComparer.Ordinal).ToArray()));
                Assert.That(captured.Observations.Select(x => x.ComponentId).Distinct().Count(),
                    Is.EqualTo(3));
                Assert.That(captured.Observations.Count(x => x.TypeName == "UnityEngine.BoxCollider"),
                    Is.EqualTo(2));
                Assert.That(captured.Observations.Count(x => x.TypeName == "UnityEngine.SphereCollider"),
                    Is.EqualTo(1));
                Assert.That(captured.Observations is System.Collections.Generic.List<TeamForgeWp6InspectorProbe.Observation>,
                    Is.False, "Do not publish a mutable inventory list.");
                Assert.That(scene.isDirty, Is.False);
                Assert.That(Undo.GetCurrentGroup(), Is.EqualTo(undoGroup));

                var beforeIds = captured.Observations.Select(x => x.ComponentId).ToArray();
                unrelatedRoot.transform.SetSiblingIndex(0);
                Assert.That(TeamForgeWp6SceneInventory.TryCapture(scene, out var reordered, out error),
                    Is.True, error);
                Assert.That(reordered.Observations.Select(x => x.ComponentId), Is.EqualTo(beforeIds),
                    "Moving an unrelated root cannot reorder Component inventory keys.");
                var beforeCenter = captured.Observations.Single(x =>
                    x.ComponentId == GlobalObjectId.GetGlobalObjectIdSlow(first).ToString())
                    .Properties.Single(x => x.Path == "m_Center").Vector;

                // The prior observation remains a value snapshot, not a live
                // reference that silently changes after the next Editor edit.
                first.center = new Vector3(8f, 9f, 10f);
                Assert.That(captured.Observations.Single(x =>
                    x.ComponentId == GlobalObjectId.GetGlobalObjectIdSlow(first).ToString())
                    .Properties.Single(x => x.Path == "m_Center").Vector,
                    Is.EqualTo(beforeCenter));

                Assert.That(EditorSceneManager.SaveScene(scene, scenePath), Is.True);
                scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                scene = EditorSceneManager.OpenScene(scenePath, OpenSceneMode.Single);

                Assert.That(TeamForgeWp6SceneInventory.TryCapture(scene, out var reloaded, out error),
                    Is.True, error);
                Assert.That(reloaded.Observations.Select(x => x.ComponentId), Is.EqualTo(beforeIds),
                    "Snapshot order and Component identity must survive Scene reload.");
                Assert.That(reloaded.SceneDirty, Is.False);
            }
            finally { CleanupScene(scene, scenePath); }
        }

        [Test]
        public void UnsupportedOrInvalidAllowedColliderNeverReturnsPartialInventory()
        {
            var scenePath = PrepareScenePath();
            Scene scene = default;
            try
            {
                scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                var good = new GameObject("valid BoxCollider");
                SceneManager.MoveGameObjectToScene(good, scene);
                good.AddComponent<BoxCollider>();
                var bad = new GameObject("invalid SphereCollider");
                SceneManager.MoveGameObjectToScene(bad, scene);
                var sphere = bad.AddComponent<SphereCollider>();
                Assert.That(EditorSceneManager.SaveScene(scene, scenePath), Is.True);

                sphere.radius = 101f; // existing WP6 probe rejects values above 100
                Assert.That(TeamForgeWp6SceneInventory.TryCapture(scene, out var failed, out _),
                    Is.False);
                Assert.That(failed, Is.Null, "No prefix of the Scene is returned on failure.");

                sphere.radius = 2f;
                EditorSceneManager.MarkSceneDirty(scene);
                Assert.That(TeamForgeWp6SceneInventory.TryCapture(scene, out var observed, out var error),
                    Is.True, error);
                Assert.That(observed.Observations.Count, Is.EqualTo(2));
                Assert.That(observed.SceneDirty, Is.True,
                    "An unsaved local edit may be observed but is not an authoritative baseline.");
            }
            finally { CleanupScene(scene, scenePath); }
        }

        [Test]
        public void PrefabColliderAndUnsavedSceneFailClosed()
        {
            var scenePath = PrepareScenePath();
            var prefabPath = TemporaryFolder + "/" + Guid.NewGuid().ToString("N") + ".prefab";
            Scene scene = default;
            try
            {
                scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                Assert.That(TeamForgeWp6SceneInventory.TryCapture(scene, out var unsaved, out _),
                    Is.False);
                Assert.That(unsaved, Is.Null);

                var ordinary = new GameObject("ordinary Collider");
                SceneManager.MoveGameObjectToScene(ordinary, scene);
                ordinary.AddComponent<BoxCollider>();
                var prefabSource = new GameObject("Prefab Collider");
                prefabSource.AddComponent<SphereCollider>();
                var prefabAsset = PrefabUtility.SaveAsPrefabAsset(prefabSource, prefabPath);
                Assert.That(prefabAsset, Is.Not.Null);
                Object.DestroyImmediate(prefabSource);
                var instance = PrefabUtility.InstantiatePrefab(prefabAsset) as GameObject;
                Assert.That(instance, Is.Not.Null);
                Assert.That(EditorSceneManager.SaveScene(scene, scenePath), Is.True);

                Assert.That(TeamForgeWp6SceneInventory.TryCapture(scene, out var incomplete, out _),
                    Is.False, "An unsupported Prefab Collider cannot silently disappear.");
                Assert.That(incomplete, Is.Null);
            }
            finally
            {
                if (scene.IsValid() && scene.isLoaded)
                    EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                AssetDatabase.DeleteAsset(prefabPath);
                CleanupScene(scene, scenePath);
            }
        }

        [Test]
        public void HardCapsRejectOversizedPartialSceneInventories()
        {
            Assert.That(TeamForgeWp6SceneInventory.WithinBudget(
                TeamForgeWp6SceneInventory.MaximumSceneObjects,
                TeamForgeWp6SceneInventory.MaximumAllowlistedColliders, out _), Is.True);
            Assert.That(TeamForgeWp6SceneInventory.WithinBudget(
                TeamForgeWp6SceneInventory.MaximumSceneObjects + 1, 0, out _), Is.False);
            Assert.That(TeamForgeWp6SceneInventory.WithinBudget(
                1, TeamForgeWp6SceneInventory.MaximumAllowlistedColliders + 1, out _), Is.False);
            Assert.That(TeamForgeWp6SceneInventory.WithinBudget(-1, 0, out _), Is.False);
            Assert.That(TeamForgeWp6SceneInventory.WithinBudget(1, -1, out _), Is.False);
        }

        private static string PrepareScenePath()
        {
            if (!AssetDatabase.IsValidFolder(TemporaryFolder))
                AssetDatabase.CreateFolder("Assets", "__TeamForgeWp6SceneInventoryTests");
            return TemporaryFolder + "/" + Guid.NewGuid().ToString("N") + ".unity";
        }

        private static void CleanupScene(Scene scene, string path)
        {
            if (scene.IsValid() && scene.isLoaded)
                EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            AssetDatabase.DeleteAsset(path);
            if (AssetDatabase.IsValidFolder(TemporaryFolder) &&
                AssetDatabase.FindAssets(string.Empty, new[] { TemporaryFolder }).Length == 0)
                AssetDatabase.DeleteAsset(TemporaryFolder);
        }
    }
}

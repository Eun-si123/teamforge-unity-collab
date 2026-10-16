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
    public sealed class TeamForgeWp6InspectorProbeTests
    {
        private const string TemporaryFolder = "Assets/__TeamForgeWp6ProbeTests";

        [Test]
        public void SavedColliderObservationsAreTypedUniqueAndSideEffectFree()
        {
            var scenePath = PrepareScenePath();
            Scene scene = default;
            try
            {
                scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                var owner = new GameObject("WP6 two same-type Component identities");
                SceneManager.MoveGameObjectToScene(owner, scene);
                var first = owner.AddComponent<BoxCollider>();
                var second = owner.AddComponent<BoxCollider>();
                var sphere = owner.AddComponent<SphereCollider>();
                first.isTrigger = true;
                first.center = new Vector3(2f, -3f, 4f);
                first.size = new Vector3(1f, 2f, 3f);
                second.isTrigger = false;
                second.center = new Vector3(-4f, 5f, -6f);
                sphere.radius = 3.25f;
                sphere.center = new Vector3(1f, 0f, -2f);
                Assert.That(EditorSceneManager.SaveScene(scene, scenePath), Is.True);
                Assert.That(scene.isDirty, Is.False);
                var undoGroup = Undo.GetCurrentGroup();

                Assert.That(TeamForgeWp6InspectorProbe.TryCapture(first, out var a, out var error),
                    Is.True, error);
                Assert.That(TeamForgeWp6InspectorProbe.TryCapture(second, out var b, out error),
                    Is.True, error);
                Assert.That(TeamForgeWp6InspectorProbe.TryCapture(sphere, out var c, out error),
                    Is.True, error);

                Assert.That(a.SceneId, Is.EqualTo(AssetDatabase.AssetPathToGUID(scenePath)));
                Assert.That(a.ObjectId, Is.EqualTo(b.ObjectId));
                Assert.That(a.ComponentId, Is.Not.EqualTo(b.ComponentId));
                Assert.That(c.ComponentId, Is.Not.EqualTo(a.ComponentId));
                Assert.That(a.ComponentId, Does.StartWith("GlobalObjectId_V1-2-"));
                Assert.That(a.TypeName, Is.EqualTo("UnityEngine.BoxCollider"));
                Assert.That(c.TypeName, Is.EqualTo("UnityEngine.SphereCollider"));
                Assert.That(a.SceneDirty, Is.False);
                Assert.That(a.Properties.Select(p => p.Path),
                    Is.EqualTo(new[] { "m_IsTrigger", "m_Center", "m_Size" }));
                Assert.That(a.Properties.Select(p => p.Kind),
                    Is.EqualTo(new[] { "boolean", "vector3", "vector3" }));
                Assert.That(a.Properties[0].Boolean, Is.True);
                Assert.That(a.Properties[1].Vector, Is.EqualTo(new Vector3(2f, -3f, 4f)));
                Assert.That(a.Properties[2].Vector, Is.EqualTo(new Vector3(1f, 2f, 3f)));
                Assert.That(b.Properties[0].Boolean, Is.False);
                Assert.That(b.Properties[1].Vector, Is.EqualTo(second.center));
                Assert.That(c.Properties.Select(p => p.Path),
                    Is.EqualTo(new[] { "m_IsTrigger", "m_Center", "m_Radius" }));
                Assert.That(c.Properties[2].Kind, Is.EqualTo("float"));
                Assert.That(c.Properties[2].Number, Is.EqualTo(3.25f));
                Assert.That(c.Properties is System.Collections.Generic.List<TeamForgeWp6InspectorProbe.PropertyObservation>,
                    Is.False, "Return a read-only collection rather than exposing a mutable backing list.");
                Assert.That(Undo.GetCurrentGroup(), Is.EqualTo(undoGroup));
                Assert.That(scene.isDirty, Is.False);
                Assert.That(first.isTrigger, Is.True);
                Assert.That(sphere.radius, Is.EqualTo(3.25f));

                first.center = Vector3.zero;
                Assert.That(a.Properties[1].Vector, Is.EqualTo(new Vector3(2f, -3f, 4f)),
                    "Captured observations cannot alias future Unity Component edits.");
            }
            finally { CleanupScene(scene, scenePath); }
        }

        [Test]
        public void SavedSameTypeIdsAndValuesSurviveSceneReloadWithoutReassigningOrdinalIdentities()
        {
            var scenePath = PrepareScenePath();
            Scene scene = default;
            try
            {
                scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                var owner = new GameObject("WP6 identities");
                SceneManager.MoveGameObjectToScene(owner, scene);
                var one = owner.AddComponent<BoxCollider>();
                var two = owner.AddComponent<BoxCollider>();
                one.center = new Vector3(-3f, 0f, 4f);
                two.center = new Vector3(5f, 6f, -7f);
                Assert.That(EditorSceneManager.SaveScene(scene, scenePath), Is.True);
                Assert.That(TeamForgeWp6InspectorProbe.TryCapture(one, out var beforeOne, out var error),
                    Is.True, error);
                Assert.That(TeamForgeWp6InspectorProbe.TryCapture(two, out var beforeTwo, out error),
                    Is.True, error);

                scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                scene = EditorSceneManager.OpenScene(scenePath, OpenSceneMode.Single);
                var reloaded = scene.GetRootGameObjects().Single(go => go.name == "WP6 identities")
                    .GetComponents<BoxCollider>();
                Assert.That(reloaded.Length, Is.EqualTo(2));
                Assert.That(TeamForgeWp6InspectorProbe.TryCapture(reloaded[0], out var afterOne, out error),
                    Is.True, error);
                Assert.That(TeamForgeWp6InspectorProbe.TryCapture(reloaded[1], out var afterTwo, out error),
                    Is.True, error);
                Assert.That(afterOne.ComponentId, Is.EqualTo(beforeOne.ComponentId));
                Assert.That(afterTwo.ComponentId, Is.EqualTo(beforeTwo.ComponentId));
                Assert.That(afterOne.Properties[1].Vector, Is.EqualTo(beforeOne.Properties[1].Vector));
                Assert.That(afterTwo.Properties[1].Vector, Is.EqualTo(beforeTwo.Properties[1].Vector));
            }
            finally { CleanupScene(scene, scenePath); }
        }

        [Test]
        public void UnsavedSceneAndUnsupportedComponentsFailClosedWithoutPartialData()
        {
            var scenePath = PrepareScenePath();
            Scene scene = default;
            try
            {
                scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                var owner = new GameObject("WP6 no saved Scene identity");
                SceneManager.MoveGameObjectToScene(owner, scene);
                var box = owner.AddComponent<BoxCollider>();
                Assert.That(TeamForgeWp6InspectorProbe.TryCapture(box, out var missing, out var reason),
                    Is.False);
                Assert.That(missing, Is.Null);
                Assert.That(reason, Does.Contain("saved Scene"));
                Assert.That(TeamForgeWp6InspectorProbe.TryCapture(null, out missing, out reason),
                    Is.False);
                Assert.That(missing, Is.Null);

                Assert.That(EditorSceneManager.SaveScene(scene, scenePath), Is.True);
                Assert.That(TeamForgeWp6InspectorProbe.TryCapture(owner.transform, out missing, out reason),
                    Is.False);
                Assert.That(reason, Does.Contain("Only BoxCollider and SphereCollider"));
                Assert.That(missing, Is.Null);
                Assert.That(TeamForgeWp6InspectorProbe.TryCapture(box, out var valid, out reason),
                    Is.True, reason);
                Assert.That(valid, Is.Not.Null);
            }
            finally { CleanupScene(scene, scenePath); }
        }

        [Test]
        public void InvalidScalarOrVectorAbortsWholeSnapshotWithoutSideEffects()
        {
            var scenePath = PrepareScenePath();
            Scene scene = default;
            try
            {
                scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                var owner = new GameObject("WP6 reject out-of-bounds");
                SceneManager.MoveGameObjectToScene(owner, scene);
                var box = owner.AddComponent<BoxCollider>();
                var sphere = owner.AddComponent<SphereCollider>();
                Assert.That(EditorSceneManager.SaveScene(scene, scenePath), Is.True);
                var undoGroup = Undo.GetCurrentGroup();

                box.center = new Vector3(101f, 0f, 0f);
                Assert.That(TeamForgeWp6InspectorProbe.TryCapture(box, out var invalid, out var reason),
                    Is.False);
                Assert.That(invalid, Is.Null);
                box.center = Vector3.zero;
                box.size = new Vector3(101f, 1f, 1f);
                Assert.That(TeamForgeWp6InspectorProbe.TryCapture(box, out invalid, out reason),
                    Is.False);
                Assert.That(invalid, Is.Null);
                box.size = Vector3.one;

                sphere.radius = 101f;
                Assert.That(TeamForgeWp6InspectorProbe.TryCapture(sphere, out invalid, out reason),
                    Is.False);
                Assert.That(invalid, Is.Null);
                sphere.radius = 1f;
                Assert.That(TeamForgeWp6InspectorProbe.TryCapture(sphere, out var valid, out reason),
                    Is.True, reason);
                Assert.That(valid.Properties.Count, Is.EqualTo(3));
                Assert.That(Undo.GetCurrentGroup(), Is.EqualTo(undoGroup));
            }
            finally { CleanupScene(scene, scenePath); }
        }

        private static string PrepareScenePath()
        {
            if (!AssetDatabase.IsValidFolder(TemporaryFolder))
                AssetDatabase.CreateFolder("Assets", "__TeamForgeWp6ProbeTests");
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

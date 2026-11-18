using System;
using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using Object = UnityEngine.Object;

namespace EunSung.TeamForge.Tests
{
    public sealed class TeamForgeWp6SceneComparisonTests
    {
        private const string TemporaryFolder = "Assets/__TeamForgeWp6SceneComparisonTests";

        [Test]
        public void SavedSceneComparisonDistinguishesAddRemoveAndPrecisePropertyChanges()
        {
            var path = PrepareScenePath();
            Scene scene = default;
            try
            {
                scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                var original = new GameObject("two BoxColliders");
                SceneManager.MoveGameObjectToScene(original, scene);
                var changed = original.AddComponent<BoxCollider>();
                var removed = original.AddComponent<BoxCollider>();
                var other = new GameObject("Sphere");
                SceneManager.MoveGameObjectToScene(other, scene);
                var sphere = other.AddComponent<SphereCollider>();
                Assert.That(EditorSceneManager.SaveScene(scene, path), Is.True);

                Assert.That(TeamForgeWp6SceneInventory.TryCapture(scene, out var before, out var error),
                    Is.True, error);
                var changedId = GlobalObjectId.GetGlobalObjectIdSlow(changed).ToString();
                var removedId = GlobalObjectId.GetGlobalObjectIdSlow(removed).ToString();
                var sphereId = GlobalObjectId.GetGlobalObjectIdSlow(sphere).ToString();

                changed.center = new Vector3(1, 2, 3);
                changed.isTrigger = true;
                sphere.radius = 4f;
                Object.DestroyImmediate(removed);
                var newcomer = new GameObject("new owner");
                SceneManager.MoveGameObjectToScene(newcomer, scene);
                var added = newcomer.AddComponent<BoxCollider>();
                Assert.That(EditorSceneManager.SaveScene(scene, path), Is.True);
                var addedId = GlobalObjectId.GetGlobalObjectIdSlow(added).ToString();

                Assert.That(TeamForgeWp6SceneInventory.TryCapture(scene, out var after, out error),
                    Is.True, error);
                Assert.That(TeamForgeWp6SceneComparison.TryCompare(before, after, out var comparison, out error),
                    Is.True, error);
                Assert.That(comparison, Is.Not.Null);
                Assert.That(comparison.SceneId, Is.EqualTo(before.SceneId));
                Assert.That(comparison.BeforeSceneDirty, Is.False);
                Assert.That(comparison.AfterSceneDirty, Is.False);
                Assert.That(comparison.Changes.Count, Is.EqualTo(4));
                Assert.That(comparison.Changes.Select(c => c.ComponentId),
                    Is.EqualTo(comparison.Changes.Select(c => c.ComponentId)
                        .OrderBy(v => v, StringComparer.Ordinal).ToArray()));
                var byId = comparison.Changes.ToDictionary(c => c.ComponentId, StringComparer.Ordinal);
                Assert.That(byId[addedId].Kind, Is.EqualTo(TeamForgeWp6SceneComparison.ChangeKind.Added));
                Assert.That(byId[removedId].Kind, Is.EqualTo(TeamForgeWp6SceneComparison.ChangeKind.Removed));
                Assert.That(byId[changedId].Kind,
                    Is.EqualTo(TeamForgeWp6SceneComparison.ChangeKind.PropertiesChanged));
                Assert.That(byId[changedId].ChangedPropertyPaths,
                    Is.EqualTo(new[] { "m_IsTrigger", "m_Center" }));
                Assert.That(byId[sphereId].Kind,
                    Is.EqualTo(TeamForgeWp6SceneComparison.ChangeKind.PropertiesChanged));
                Assert.That(byId[sphereId].ChangedPropertyPaths, Is.EqualTo(new[] { "m_Radius" }));
                Assert.That(byId[addedId].ChangedPropertyPaths, Is.Empty);
                Assert.That(comparison.Changes is List<TeamForgeWp6SceneComparison.Change>, Is.False);

                // The change report contains paths and identities, NOT property values.
                Assert.That(comparison.Changes.All(c =>
                    c.ChangedPropertyPaths.All(p => p.StartsWith("m_", StringComparison.Ordinal))), Is.True);
                Assert.That(TeamForgeWp6SceneComparison.TryCompare(after, after, out var same, out error),
                    Is.True, error);
                Assert.That(same.Changes, Is.Empty);
            }
            finally { Cleanup(scene, path); }
        }

        [Test]
        public void SiblingReorderAndDirtyFlagDoNotInventComponentPropertyEdits()
        {
            var path = PrepareScenePath();
            Scene scene = default;
            try
            {
                scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                var first = new GameObject("first owner");
                SceneManager.MoveGameObjectToScene(first, scene);
                first.AddComponent<BoxCollider>();
                var second = new GameObject("second owner");
                SceneManager.MoveGameObjectToScene(second, scene);
                second.AddComponent<SphereCollider>();
                Assert.That(EditorSceneManager.SaveScene(scene, path), Is.True);

                Assert.That(TeamForgeWp6SceneInventory.TryCapture(scene, out var before, out var error),
                    Is.True, error);
                first.transform.SetSiblingIndex(1);
                EditorSceneManager.MarkSceneDirty(scene);
                Assert.That(TeamForgeWp6SceneInventory.TryCapture(scene, out var after, out error),
                    Is.True, error);
                Assert.That(TeamForgeWp6SceneComparison.TryCompare(before, after, out var comparison,
                    out error), Is.True, error);
                Assert.That(comparison.Changes, Is.Empty);
                Assert.That(comparison.BeforeSceneDirty, Is.False);
                Assert.That(comparison.AfterSceneDirty, Is.True);
            }
            finally { Cleanup(scene, path); }
        }

        [Test]
        public void TinyFiniteVectorChangesAreDetectedWithoutUnityApproximateEquality()
        {
            var path = PrepareScenePath();
            Scene scene = default;
            try
            {
                scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                var owner = new GameObject("precision owner");
                SceneManager.MoveGameObjectToScene(owner, scene);
                var box = owner.AddComponent<BoxCollider>();
                Assert.That(EditorSceneManager.SaveScene(scene, path), Is.True);
                Assert.That(TeamForgeWp6SceneInventory.TryCapture(scene, out var before, out var error),
                    Is.True, error);
                box.center = new Vector3(0.000001f, 0f, 0f);
                EditorSceneManager.MarkSceneDirty(scene);
                Assert.That(TeamForgeWp6SceneInventory.TryCapture(scene, out var after, out error),
                    Is.True, error);
                Assert.That(TeamForgeWp6SceneComparison.TryCompare(before, after, out var report, out error),
                    Is.True, error);
                Assert.That(report.Changes.Count, Is.EqualTo(1));
                Assert.That(report.Changes[0].ChangedPropertyPaths, Is.EqualTo(new[] { "m_Center" }));
            }
            finally { Cleanup(scene, path); }
        }

        [Test]
        public void ComparisonRejectsForgedOwnerDuplicateIdentityAndInvalidPropertyShape()
        {
            var path = PrepareScenePath();
            Scene scene = default;
            try
            {
                scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                var original = new GameObject("owner");
                SceneManager.MoveGameObjectToScene(original, scene);
                var box = original.AddComponent<BoxCollider>();
                var anotherOwner = new GameObject("other owner");
                SceneManager.MoveGameObjectToScene(anotherOwner, scene);
                Assert.That(EditorSceneManager.SaveScene(scene, path), Is.True);

                Assert.That(TeamForgeWp6SceneInventory.TryCapture(scene, out var before, out var error),
                    Is.True, error);
                var obs = before.Observations.Single();
                var otherId = GlobalObjectId.GetGlobalObjectIdSlow(anotherOwner).ToString();

                var ownerForgery = new TeamForgeWp6InspectorProbe.Observation(obs.SceneId,
                    otherId, obs.ComponentId, obs.TypeName, false, obs.Properties.ToList());
                var conflict = Wrapped(before, ownerForgery);
                Assert.That(TeamForgeWp6SceneComparison.TryCompare(before, conflict,
                    out var failure, out error), Is.False);
                Assert.That(failure, Is.Null);
                Assert.That(error, Does.Contain("owner"));

                var duplicate = new TeamForgeWp6SceneInventory.Snapshot(before.SceneId, false,
                    new List<TeamForgeWp6InspectorProbe.Observation> { obs, obs });
                Assert.That(TeamForgeWp6SceneComparison.TryCompare(before, duplicate,
                    out failure, out error), Is.False);
                Assert.That(failure, Is.Null);
                Assert.That(error, Does.Contain("duplicate"));

                var corruptProperties = obs.Properties.ToList();
                corruptProperties[2] = new TeamForgeWp6InspectorProbe.PropertyObservation(
                    "m_Size", "vector3", false, 0f, new Vector3(float.NaN, 1f, 1f));
                var corrupt = new TeamForgeWp6InspectorProbe.Observation(obs.SceneId,
                    obs.ObjectId, obs.ComponentId, obs.TypeName, false, corruptProperties);
                Assert.That(TeamForgeWp6SceneComparison.TryCompare(before, Wrapped(before, corrupt),
                    out failure, out error), Is.False);
                Assert.That(failure, Is.Null);

                // A plausible exact component ID with a claimed different
                // supported Unity type must not be treated as an overwrite.
                var sphereProperties = obs.Properties.Take(2).ToList();
                sphereProperties.Add(new TeamForgeWp6InspectorProbe.PropertyObservation(
                    "m_Radius", "float", false, 1f, Vector3.zero));
                var wrongType = new TeamForgeWp6InspectorProbe.Observation(obs.SceneId,
                    obs.ObjectId, obs.ComponentId, "UnityEngine.SphereCollider", false,
                    sphereProperties);
                Assert.That(TeamForgeWp6SceneComparison.TryCompare(before, Wrapped(before, wrongType),
                    out failure, out error), Is.False);
                Assert.That(failure, Is.Null);

                var staleDirtyFlag = new TeamForgeWp6SceneInventory.Snapshot(
                    before.SceneId, true, new List<TeamForgeWp6InspectorProbe.Observation> { obs });
                Assert.That(TeamForgeWp6SceneComparison.TryCompare(before, staleDirtyFlag,
                    out failure, out error), Is.False,
                    "Component and envelope dirtiness cannot contradict one another.");
                Assert.That(failure, Is.Null);
                StringAssert.Contains("dirty state", error,
                    "Explain the actual inconsistency instead of claiming malformed property data.");

                var malformedPaths = obs.Properties.ToList();
                malformedPaths[1] = new TeamForgeWp6InspectorProbe.PropertyObservation(
                    "m_Size", "vector3", false, 0f, Vector3.zero);
                var wrongPath = new TeamForgeWp6InspectorProbe.Observation(obs.SceneId,
                    obs.ObjectId, obs.ComponentId, obs.TypeName, false, malformedPaths);
                Assert.That(TeamForgeWp6SceneComparison.TryCompare(before, Wrapped(before, wrongPath),
                    out failure, out error), Is.False,
                    "Two valid vector values are not interchangeable SerializedProperty paths.");
                Assert.That(failure, Is.Null);

                var overBudget = new TeamForgeWp6SceneInventory.Snapshot(before.SceneId, false,
                    Enumerable.Repeat(obs,
                        TeamForgeWp6SceneInventory.MaximumAllowlistedColliders + 1).ToList());
                Assert.That(TeamForgeWp6SceneComparison.TryCompare(before, overBudget,
                    out failure, out error), Is.False);
                Assert.That(failure, Is.Null);

                var otherScene = new TeamForgeWp6SceneInventory.Snapshot(
                    "ffffffffffffffffffffffffffffffff", false,
                    new List<TeamForgeWp6InspectorProbe.Observation>());
                Assert.That(TeamForgeWp6SceneComparison.TryCompare(before, otherScene,
                    out failure, out error), Is.False);
                Assert.That(failure, Is.Null);
                Assert.That(TeamForgeWp6SceneComparison.TryCompare(null, before,
                    out failure, out error), Is.False);
                Assert.That(failure, Is.Null);
            }
            finally { Cleanup(scene, path); }
        }

        private static TeamForgeWp6SceneInventory.Snapshot Wrapped(
            TeamForgeWp6SceneInventory.Snapshot snapshot, TeamForgeWp6InspectorProbe.Observation observation)
        {
            return new TeamForgeWp6SceneInventory.Snapshot(snapshot.SceneId, snapshot.SceneDirty,
                new List<TeamForgeWp6InspectorProbe.Observation> { observation });
        }

        private static string PrepareScenePath()
        {
            if (!AssetDatabase.IsValidFolder(TemporaryFolder))
                AssetDatabase.CreateFolder("Assets", "__TeamForgeWp6SceneComparisonTests");
            return TemporaryFolder + "/" + Guid.NewGuid().ToString("N") + ".unity";
        }

        private static void Cleanup(Scene scene, string path)
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

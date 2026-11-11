using System;
using System.IO;
using System.Security.Cryptography;
using NUnit.Framework;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace EunSung.TeamForge.Tests
{
    public sealed class TeamForgeWp6LocalInspectorApplyTests
    {
        private const string Folder = "Assets/__TeamForgeWp6LocalInspectorApplyTests";

        [Test]
        public void ExactBoundedColliderPropertyWriteIsUndoableAndIdenticalReplayDoesNotWriteAgain()
        {
            var scenePath = PrepareScenePath();
            Scene scene = default;
            try
            {
                scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                var owner = new GameObject("two same-type Colliders");
                SceneManager.MoveGameObjectToScene(owner, scene);
                var target = owner.AddComponent<BoxCollider>();
                var untouched = owner.AddComponent<BoxCollider>();
                untouched.center = new Vector3(5, 6, 7);
                var child = new GameObject("Sphere child");
                child.transform.SetParent(owner.transform);
                child.AddComponent<SphereCollider>();
                Assert.That(EditorSceneManager.SaveScene(scene, scenePath), Is.True);
                AssetDatabase.ImportAsset(scenePath, ImportAssetOptions.ForceSynchronousImport);
                Assert.That(TeamForgeBaselineFingerprint.TryCaptureActiveScene(
                    out var expected, out var error), Is.True, error);

                Assert.That(TeamForgeWp6LocalInspectorApply.TryBeginForLocalTest(
                    expected, HashMeta(scenePath), 11, out var preview, out error), Is.True, error);
                Assert.That(preview.Revision, Is.EqualTo(11));
                var record = Operation(target, expected.sceneGuid,
                    new TeamForgeWp6InspectorProbe.PropertyObservation(
                        "m_Center", "vector3", false, 0f, new Vector3(1f, 2f, 3f)),
                    11, 12);
                Assert.That(TeamForgeWp6LocalInspectorApply.TryApplyForLocalTest(
                    preview, record, out var outcome, out error), Is.True, error);
                Assert.That(outcome.Replayed, Is.False);
                Assert.That(outcome.ServerRevision, Is.EqualTo(12));
                Assert.That(preview.Revision, Is.EqualTo(12));
                Assert.That(preview.Consumed, Is.True);
                Assert.That(target.center, Is.EqualTo(new Vector3(1f, 2f, 3f)));
                Assert.That(untouched.center, Is.EqualTo(new Vector3(5f, 6f, 7f)));

                // Exact duplicate is idempotent while the post-state
                // remains present and cannot generate another Undo record.
                Assert.That(TeamForgeWp6LocalInspectorApply.TryApplyForLocalTest(
                    preview, record, out var replay, out error), Is.True, error);
                Assert.That(replay.Replayed, Is.True);
                Assert.That(replay.UndoGroup, Is.EqualTo(outcome.UndoGroup));
                Assert.That(preview.Revision, Is.EqualTo(12));
                var altered = new TeamForgeWp6LocalInspectorApply.AppliedRecord(
                    record.OperationId, record.BaseRevision, record.ServerRevision,
                    record.SceneId, record.ObjectId, record.ComponentId, record.TypeName,
                    new TeamForgeWp6InspectorProbe.PropertyObservation(
                        "m_Center", "vector3", false, 0f, new Vector3(9, 8, 7)));
                Assert.That(TeamForgeWp6LocalInspectorApply.TryApplyForLocalTest(
                    preview, altered, out var conflicting, out _), Is.False);
                Assert.That(conflicting, Is.Null, "Same ID with different data is never an idempotent replay.");

                Undo.PerformUndo();
                Assert.That(target.center, Is.EqualTo(Vector3.zero),
                    "The bounded Inspector change must live in exactly one Unity Undo step.");
                Assert.That(untouched.center, Is.EqualTo(new Vector3(5f, 6f, 7f)));
                Assert.That(TeamForgeWp6LocalInspectorApply.TryApplyForLocalTest(
                    preview, record, out var rolledBackReplay, out _), Is.False,
                    "A reverted local state cannot falsely acknowledge an old server operation.");
                Assert.That(rolledBackReplay, Is.Null);
            }
            finally { Cleanup(scene, scenePath); }
        }

        [Test]
        public void InvalidOperationFieldsAreRejectedBeforeAnyMutationOrUndo()
        {
            var scenePath = PrepareScenePath();
            Scene scene = default;
            try
            {
                scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                var owner = new GameObject("owner");
                SceneManager.MoveGameObjectToScene(owner, scene);
                var target = owner.AddComponent<SphereCollider>();
                Assert.That(EditorSceneManager.SaveScene(scene, scenePath), Is.True);
                AssetDatabase.ImportAsset(scenePath, ImportAssetOptions.ForceSynchronousImport);
                Assert.That(TeamForgeBaselineFingerprint.TryCaptureActiveScene(
                    out var expected, out var error), Is.True, error);
                Assert.That(TeamForgeWp6LocalInspectorApply.TryBeginForLocalTest(
                    expected, HashMeta(scenePath), 31, out var preview, out error), Is.True, error);
                var valid = new TeamForgeWp6InspectorProbe.PropertyObservation(
                    "m_Radius", "float", false, 2.5f, Vector3.zero);
                var baseline = Operation(target, expected.sceneGuid, valid, 31, 32);
                var invalid = new[] {
                    Modify(baseline, "wrong-scene", null, null, null, null, 31, 32),
                    Modify(baseline, null, "wrong-owner", null, null, null, 31, 32),
                    Modify(baseline, null, null, "wrong-component", null, null, 31, 32),
                    Modify(baseline, null, null, null, "UnityEngine.BoxCollider", null, 31, 32),
                    Modify(baseline, null, null, null, null, "not allowed", 31, 32),
                    Modify(baseline, null, null, null, null, null, 30, 31),
                    Modify(baseline, null, null, null, null, null, 31, 33),
                    NewProperty(baseline, "m_Size", "vector3", 0f, new Vector3(1, 1, 1)),
                    NewProperty(baseline, "m_Radius", "float", -1f, Vector3.zero),
                    NewProperty(baseline, "m_Radius", "float", float.NaN, Vector3.zero),
                    NewProperty(baseline, "m_Radius", "float", 2.5f, new Vector3(1, 0, 0)),
                    NewProperty(baseline, "m_Radius", "float", 0.5f, Vector3.zero),
                };
                foreach (var operation in invalid)
                {
                    var group = Undo.GetCurrentGroup();
                    Assert.That(TeamForgeWp6LocalInspectorApply.TryApplyForLocalTest(
                        preview, operation, out var refused, out _), Is.False);
                    Assert.That(refused, Is.Null);
                    Assert.That(Undo.GetCurrentGroup(), Is.EqualTo(group),
                        "Failing preflight may not open Undo.");
                    Assert.That(target.radius, Is.EqualTo(0.5f));
                    Assert.That(scene.isDirty, Is.False);
                    Assert.That(preview.Revision, Is.EqualTo(31));
                    Assert.That(preview.Consumed, Is.False);
                }
            }
            finally { Cleanup(scene, scenePath); }
        }

        [Test]
        public void DirtyOrDifferentLocalSceneRefusesOldBaselineWithoutEditing()
        {
            var scenePath = PrepareScenePath();
            Scene scene = default;
            try
            {
                scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                var owner = new GameObject("owner");
                SceneManager.MoveGameObjectToScene(owner, scene);
                var target = owner.AddComponent<BoxCollider>();
                Assert.That(EditorSceneManager.SaveScene(scene, scenePath), Is.True);
                AssetDatabase.ImportAsset(scenePath, ImportAssetOptions.ForceSynchronousImport);
                Assert.That(TeamForgeBaselineFingerprint.TryCaptureActiveScene(
                    out var expected, out var error), Is.True, error);
                Assert.That(TeamForgeWp6LocalInspectorApply.TryBeginForLocalTest(
                    expected, HashMeta(scenePath), 17, out var preview, out error), Is.True, error);
                var record = Operation(target, expected.sceneGuid,
                    new TeamForgeWp6InspectorProbe.PropertyObservation(
                        "m_IsTrigger", "boolean", true, 0f, Vector3.zero),
                    17, 18);
                target.center = new Vector3(2, 3, 4);
                EditorSceneManager.MarkSceneDirty(scene);
                var group = Undo.GetCurrentGroup();
                Assert.That(TeamForgeWp6LocalInspectorApply.TryApplyForLocalTest(
                    preview, record, out var refused, out _), Is.False);
                Assert.That(refused, Is.Null);
                Assert.That(target.isTrigger, Is.False);
                Assert.That(target.center, Is.EqualTo(new Vector3(2, 3, 4)));
                Assert.That(preview.Revision, Is.EqualTo(17));
                Assert.That(Undo.GetCurrentGroup(), Is.EqualTo(group));
            }
            finally { Cleanup(scene, scenePath); }
        }

        [Test]
        public void PreviewCreationRejectsInvalidRevisionAndDirtyScene()
        {
            var scenePath = PrepareScenePath();
            Scene scene = default;
            try
            {
                scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                var owner = new GameObject("owner");
                SceneManager.MoveGameObjectToScene(owner, scene);
                owner.AddComponent<BoxCollider>();
                Assert.That(EditorSceneManager.SaveScene(scene, scenePath), Is.True);
                AssetDatabase.ImportAsset(scenePath, ImportAssetOptions.ForceSynchronousImport);
                Assert.That(TeamForgeBaselineFingerprint.TryCaptureActiveScene(
                    out var expected, out var error), Is.True, error);
                var meta = HashMeta(scenePath);
                foreach (var invalid in new[] { -1L, long.MaxValue })
                {
                    Assert.That(TeamForgeWp6LocalInspectorApply.TryBeginForLocalTest(
                        expected, meta, invalid, out var refused, out _), Is.False);
                    Assert.That(refused, Is.Null);
                }
                EditorSceneManager.MarkSceneDirty(scene);
                Assert.That(TeamForgeWp6LocalInspectorApply.TryBeginForLocalTest(
                    expected, meta, 1, out var dirty, out _), Is.False);
                Assert.That(dirty, Is.Null);
            }
            finally { Cleanup(scene, scenePath); }
        }

        private static TeamForgeWp6LocalInspectorApply.AppliedRecord Operation(
            Component component, string sceneGuid,
            TeamForgeWp6InspectorProbe.PropertyObservation change,
            long before, long after)
        {
            return new TeamForgeWp6LocalInspectorApply.AppliedRecord(
                "local-op-one", before, after, sceneGuid,
                GlobalObjectId.GetGlobalObjectIdSlow(component.gameObject).ToString(),
                GlobalObjectId.GetGlobalObjectIdSlow(component).ToString(),
                component.GetType().FullName, change);
        }

        private static TeamForgeWp6LocalInspectorApply.AppliedRecord Modify(
            TeamForgeWp6LocalInspectorApply.AppliedRecord initial,
            string scene, string owner, string component, string type, string operationId,
            long before, long after)
        {
            return new TeamForgeWp6LocalInspectorApply.AppliedRecord(
                operationId ?? initial.OperationId, before, after,
                scene ?? initial.SceneId, owner ?? initial.ObjectId,
                component ?? initial.ComponentId, type ?? initial.TypeName,
                initial.Property);
        }

        private static TeamForgeWp6LocalInspectorApply.AppliedRecord NewProperty(
            TeamForgeWp6LocalInspectorApply.AppliedRecord initial,
            string path, string kind, float value, Vector3 vector)
        {
            return new TeamForgeWp6LocalInspectorApply.AppliedRecord(
                initial.OperationId, initial.BaseRevision, initial.ServerRevision,
                initial.SceneId, initial.ObjectId, initial.ComponentId, initial.TypeName,
                new TeamForgeWp6InspectorProbe.PropertyObservation(path, kind,
                    false, value, vector));
        }

        private static string HashMeta(string path)
        {
            using (var sha = SHA256.Create())
            using (var stream = File.OpenRead(path + ".meta"))
                return BitConverter.ToString(sha.ComputeHash(stream))
                    .Replace("-", string.Empty).ToLowerInvariant();
        }

        private static string PrepareScenePath()
        {
            if (!AssetDatabase.IsValidFolder(Folder))
                AssetDatabase.CreateFolder("Assets", "__TeamForgeWp6LocalInspectorApplyTests");
            return Folder + "/" + Guid.NewGuid().ToString("N") + ".unity";
        }

        private static void Cleanup(Scene scene, string path)
        {
            if (scene.IsValid() && scene.isLoaded)
                EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            AssetDatabase.DeleteAsset(path);
            if (AssetDatabase.IsValidFolder(Folder) &&
                AssetDatabase.FindAssets(string.Empty, new[] { Folder }).Length == 0)
                AssetDatabase.DeleteAsset(Folder);
        }
    }
}

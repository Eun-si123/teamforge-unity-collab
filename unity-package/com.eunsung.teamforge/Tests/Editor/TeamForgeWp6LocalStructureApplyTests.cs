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
    public sealed class TeamForgeWp6LocalStructureApplyTests
    {
        private const string Folder = "Assets/__TeamForgeM2LocalStructureTests";
        private const string LogicalId = "tf:c:0123456789abcdef0123456789abcdef";

        [Test]
        public void LocalAddPreservesExistingCollidersAndOwnUnityUndoRedo()
        {
            var scenePath = PathForTest();
            Scene scene = default;
            try
            {
                scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                var owner = new GameObject("multi Box owner");
                SceneManager.MoveGameObjectToScene(owner, scene);
                var before = owner.AddComponent<BoxCollider>();
                before.center = new Vector3(2, 3, 4);
                var other = new GameObject("other owner");
                SceneManager.MoveGameObjectToScene(other, scene);
                var otherSphere = other.AddComponent<SphereCollider>();
                otherSphere.radius = 3.5f;
                Save(scene, scenePath);
                var preview = Begin(scenePath, 17);
                var record = Intent("add_component", owner, LogicalId, "UnityEngine.BoxCollider", 17);
                Assert.That(TeamForgeWp6LocalStructureApply.TryApplyForLocalTest(
                    preview, record, out var outcome, out var error), Is.True, error);
                Assert.That(preview.Consumed, Is.True);
                Assert.That(outcome.NewLocalInstanceId, Is.Not.EqualTo(0));
                Assert.That(owner.GetComponents<BoxCollider>().Length, Is.EqualTo(2));
                Assert.That(before.center, Is.EqualTo(new Vector3(2, 3, 4)));
                Assert.That(otherSphere.radius, Is.EqualTo(3.5f));
                Assert.That(scene.isDirty, Is.True);
                Assert.That(TeamForgeWp6LocalStructureApply.TryApplyForLocalTest(
                    preview, record, out var replay, out _), Is.False,
                    "A local-only preview must not acknowledge a server replay.");
                Assert.That(replay, Is.Null);
                Undo.IncrementCurrentGroup();
                Undo.PerformUndo();
                Assert.That(owner.GetComponents<BoxCollider>().Length, Is.EqualTo(1));
                Assert.That(before.center, Is.EqualTo(new Vector3(2, 3, 4)));
                Undo.PerformRedo();
                Assert.That(owner.GetComponents<BoxCollider>().Length, Is.EqualTo(2));
            }
            finally { Cleanup(scene, scenePath); }
        }

        [Test]
        public void LocalRemoveTargetsExactSavedSiblingAndUndoRestoresIt()
        {
            var scenePath = PathForTest();
            Scene scene = default;
            try
            {
                scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                var owner = new GameObject("two saved Boxes");
                SceneManager.MoveGameObjectToScene(owner, scene);
                var target = owner.AddComponent<BoxCollider>();
                var untouched = owner.AddComponent<BoxCollider>();
                target.center = Vector3.one;
                untouched.center = new Vector3(7, 8, 9);
                Save(scene, scenePath);
                var targetId = GlobalObjectId.GetGlobalObjectIdSlow(target).ToString();
                var preview = Begin(scenePath, 20);
                var record = Intent("remove_component", owner, targetId, "UnityEngine.BoxCollider", 20);
                Assert.That(TeamForgeWp6LocalStructureApply.TryApplyForLocalTest(
                    preview, record, out var result, out var error), Is.True, error);
                Assert.That(result.NewLocalInstanceId, Is.Zero);
                Assert.That(owner.GetComponents<BoxCollider>().Length, Is.EqualTo(1));
                Assert.That(owner.GetComponent<BoxCollider>(), Is.SameAs(untouched));
                Assert.That(untouched.center, Is.EqualTo(new Vector3(7, 8, 9)));
                Undo.IncrementCurrentGroup();
                Undo.PerformUndo();
                Assert.That(owner.GetComponents<BoxCollider>().Length, Is.EqualTo(2));
                Assert.That(untouched.center, Is.EqualTo(new Vector3(7, 8, 9)));
            }
            finally { Cleanup(scene, scenePath); }
        }

        [Test]
        public void StaleOrForgedIntentAndDirtySceneAreRefusedBeforeOpeningUndo()
        {
            var scenePath = PathForTest();
            Scene scene = default;
            try
            {
                scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                var owner = new GameObject("owner");
                SceneManager.MoveGameObjectToScene(owner, scene);
                owner.AddComponent<SphereCollider>();
                Save(scene, scenePath);
                var preview = Begin(scenePath, 30);
                var baseIntent = Intent("add_component", owner, LogicalId, "UnityEngine.BoxCollider", 30);
                var cases = new[] {
                    new TeamForgeWp6LocalStructureApply.Intent("bad id!", baseIntent.Kind,
                        baseIntent.SceneId, baseIntent.ObjectId, baseIntent.ComponentId,
                        baseIntent.TypeName, 30, 31),
                    new TeamForgeWp6LocalStructureApply.Intent(baseIntent.OperationId, baseIntent.Kind,
                        baseIntent.SceneId, baseIntent.ObjectId, baseIntent.ComponentId,
                        baseIntent.TypeName, 29, 30),
                    new TeamForgeWp6LocalStructureApply.Intent(baseIntent.OperationId, baseIntent.Kind,
                        baseIntent.SceneId, baseIntent.ObjectId, baseIntent.ComponentId,
                        baseIntent.TypeName, 30, 32),
                    new TeamForgeWp6LocalStructureApply.Intent(baseIntent.OperationId, baseIntent.Kind,
                        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", baseIntent.ObjectId,
                        baseIntent.ComponentId, baseIntent.TypeName, 30, 31),
                    new TeamForgeWp6LocalStructureApply.Intent(baseIntent.OperationId, baseIntent.Kind,
                        baseIntent.SceneId, "not-an-owner", baseIntent.ComponentId,
                        baseIntent.TypeName, 30, 31),
                    new TeamForgeWp6LocalStructureApply.Intent(baseIntent.OperationId, baseIntent.Kind,
                        baseIntent.SceneId, baseIntent.ObjectId, "tf:c:bad",
                        baseIntent.TypeName, 30, 31),
                    new TeamForgeWp6LocalStructureApply.Intent(baseIntent.OperationId, baseIntent.Kind,
                        baseIntent.SceneId, baseIntent.ObjectId, baseIntent.ComponentId,
                        "UnityEngine.MonoBehaviour", 30, 31),
                    new TeamForgeWp6LocalStructureApply.Intent(baseIntent.OperationId, "remove_component",
                        baseIntent.SceneId, baseIntent.ObjectId, "not-a-saved-id",
                        baseIntent.TypeName, 30, 31),
                };
                foreach (var intent in cases)
                {
                    var undo = Undo.GetCurrentGroup();
                    Assert.That(TeamForgeWp6LocalStructureApply.TryApplyForLocalTest(
                        preview, intent, out var refused, out _), Is.False);
                    Assert.That(refused, Is.Null);
                    Assert.That(Undo.GetCurrentGroup(), Is.EqualTo(undo));
                    Assert.That(owner.GetComponents<Collider>().Length, Is.EqualTo(1));
                    Assert.That(preview.Consumed, Is.False);
                }
                // A local user can modify this Scene after the snapshot. Never
                // roll back their work to make an obsolete structure op pass.
                owner.GetComponent<SphereCollider>().radius = 8f;
                EditorSceneManager.MarkSceneDirty(scene);
                var prior = Undo.GetCurrentGroup();
                Assert.That(TeamForgeWp6LocalStructureApply.TryApplyForLocalTest(
                    preview, baseIntent, out _, out _), Is.False);
                Assert.That(Undo.GetCurrentGroup(), Is.EqualTo(prior));
                Assert.That(owner.GetComponent<SphereCollider>().radius, Is.EqualTo(8f));
            }
            finally { Cleanup(scene, scenePath); }
        }

        private static TeamForgeWp6LocalStructureApply.Preview Begin(string path, long revision)
        {
            Assert.That(TeamForgeBaselineFingerprint.TryCaptureActiveScene(
                out var expected, out var reason), Is.True, reason);
            Assert.That(TeamForgeWp6LocalStructureApply.TryBeginForLocalTest(
                expected, MetaHash(path), revision, out var preview, out reason), Is.True, reason);
            return preview;
        }

        private static TeamForgeWp6LocalStructureApply.Intent Intent(
            string kind, GameObject owner, string componentId, string type, long revision)
        {
            return new TeamForgeWp6LocalStructureApply.Intent("local-struct-one", kind,
                AssetDatabase.AssetPathToGUID(owner.scene.path),
                GlobalObjectId.GetGlobalObjectIdSlow(owner).ToString(),
                componentId, type, revision, revision + 1);
        }

        private static void Save(Scene scene, string path)
        {
            Assert.That(EditorSceneManager.SaveScene(scene, path), Is.True);
            AssetDatabase.ImportAsset(path, ImportAssetOptions.ForceSynchronousImport);
        }

        private static string MetaHash(string path)
        {
            using (var sha = SHA256.Create())
            using (var stream = File.OpenRead(path + ".meta"))
                return BitConverter.ToString(sha.ComputeHash(stream))
                    .Replace("-", string.Empty).ToLowerInvariant();
        }

        private static string PathForTest()
        {
            if (!AssetDatabase.IsValidFolder(Folder))
                AssetDatabase.CreateFolder("Assets", "__TeamForgeM2LocalStructureTests");
            return Folder + "/" + Guid.NewGuid().ToString("N") + ".unity";
        }

        private static void Cleanup(Scene scene, string path)
        {
            if (scene.IsValid() && scene.isLoaded)
                EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            AssetDatabase.DeleteAsset(path);
            if (AssetDatabase.IsValidFolder(Folder) &&
                AssetDatabase.FindAssets(string.Empty, new[] {Folder}).Length == 0)
                AssetDatabase.DeleteAsset(Folder);
        }
    }
}

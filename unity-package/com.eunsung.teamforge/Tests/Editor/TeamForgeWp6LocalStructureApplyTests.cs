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
                Assert.That(outcome.AddedLocally, Is.True);
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
                Assert.That(result.AddedLocally, Is.False);
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

        [Test]
        public void SavedAddMapsPendingIdToExactColliderAfterSceneReopen()
        {
            var scenePath = PathForTest();
            Scene scene = default;
            try
            {
                scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                var owner = new GameObject("saved logical ID owner");
                SceneManager.MoveGameObjectToScene(owner, scene);
                var untouched = owner.AddComponent<BoxCollider>();
                untouched.center = new Vector3(3, 2, 1);
                Save(scene, scenePath);
                var preview = Begin(scenePath, 40);
                var intent = Intent("add_component", owner, LogicalId, "UnityEngine.SphereCollider", 40);
                Assert.That(TeamForgeWp6LocalStructureApply.TryApplyForLocalTest(
                    preview, intent, out var applied, out var error), Is.True, error);
                Assert.That(TeamForgeWp6LocalStructureApply.TryConfirmSavedForLocalTest(
                    preview, intent, applied, out var early, out _), Is.False,
                    "An unsaved local Editor mutation is not a persistent identity.");
                Assert.That(early, Is.Null);
                Save(scene, scenePath);
                Assert.That(TeamForgeWp6LocalStructureApply.TryConfirmSavedForLocalTest(
                    preview, intent, applied, out var saved, out error), Is.True, error);
                Assert.That(saved.Kind, Is.EqualTo("add_component"));
                Assert.That(saved.PendingOrRemovedId, Is.EqualTo(LogicalId));
                Assert.That(saved.SavedComponentId, Does.StartWith("GlobalObjectId_V1-2-"));
                Assert.That(saved.SavedComponentId, Is.Not.EqualTo(LogicalId));
                Assert.That(saved.SavedSceneSha256, Has.Length.EqualTo(64));
                var sceneGuid = AssetDatabase.AssetPathToGUID(scenePath);
                var ownerId = GlobalObjectId.GetGlobalObjectIdSlow(owner).ToString();
                scene = EditorSceneManager.OpenScene(scenePath, OpenSceneMode.Single);
                var exact = new TeamForgeWp6ComponentIdentity.Record(
                    sceneGuid, ownerId, saved.SavedComponentId, "UnityEngine.SphereCollider");
                Assert.That(TeamForgeWp6ComponentIdentity.TryResolve(
                    exact, out var restored, out error), Is.True, error);
                Assert.That(restored, Is.TypeOf<SphereCollider>());
                Assert.That(restored.gameObject.GetComponents<BoxCollider>().Length, Is.EqualTo(1));
                Assert.That(restored.gameObject.GetComponent<BoxCollider>().center,
                    Is.EqualTo(new Vector3(3, 2, 1)));
            }
            finally { Cleanup(scene, scenePath); }
        }

        [Test]
        public void SavedRemovalProducesExactAbsentTombstoneAfterReopen()
        {
            var scenePath = PathForTest();
            Scene scene = default;
            try
            {
                scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                var owner = new GameObject("saved removal owner");
                SceneManager.MoveGameObjectToScene(owner, scene);
                var removed = owner.AddComponent<BoxCollider>();
                var survivor = owner.AddComponent<BoxCollider>();
                survivor.center = new Vector3(9, 8, 7);
                Save(scene, scenePath);
                var ownerId = GlobalObjectId.GetGlobalObjectIdSlow(owner).ToString();
                var removedId = GlobalObjectId.GetGlobalObjectIdSlow(removed).ToString();
                var survivorId = GlobalObjectId.GetGlobalObjectIdSlow(survivor).ToString();
                var sceneGuid = AssetDatabase.AssetPathToGUID(scenePath);
                var preview = Begin(scenePath, 52);
                var intent = Intent("remove_component", owner, removedId, "UnityEngine.BoxCollider", 52);
                Assert.That(TeamForgeWp6LocalStructureApply.TryApplyForLocalTest(
                    preview, intent, out var applied, out var error), Is.True, error);
                Save(scene, scenePath);
                Assert.That(TeamForgeWp6LocalStructureApply.TryConfirmSavedForLocalTest(
                    preview, intent, applied, out var saved, out error), Is.True, error);
                Assert.That(saved.Kind, Is.EqualTo("remove_component"));
                Assert.That(saved.SavedComponentId, Is.EqualTo(removedId));
                Assert.That(saved.PendingOrRemovedId, Is.EqualTo(removedId));
                scene = EditorSceneManager.OpenScene(scenePath, OpenSceneMode.Single);
                var gone = new TeamForgeWp6ComponentIdentity.Record(
                    sceneGuid, ownerId, removedId, "UnityEngine.BoxCollider");
                Assert.That(TeamForgeWp6ComponentIdentity.TryResolve(
                    gone, out var absent, out _), Is.False);
                Assert.That(absent, Is.Null);
                var kept = new TeamForgeWp6ComponentIdentity.Record(
                    sceneGuid, ownerId, survivorId, "UnityEngine.BoxCollider");
                Assert.That(TeamForgeWp6ComponentIdentity.TryResolve(
                    kept, out var live, out error), Is.True, error);
                Assert.That(((BoxCollider)live).center, Is.EqualTo(new Vector3(9, 8, 7)));
            }
            finally { Cleanup(scene, scenePath); }
        }

        [Test]
        public void SavedIdentityConfirmationRefusesForeignColliderEdit()
        {
            var scenePath = PathForTest();
            Scene scene = default;
            try
            {
                scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                var owner = new GameObject("foreign change owner");
                SceneManager.MoveGameObjectToScene(owner, scene);
                var survivor = owner.AddComponent<SphereCollider>();
                Save(scene, scenePath);
                var preview = Begin(scenePath, 60);
                var intent = Intent("add_component", owner, LogicalId, "UnityEngine.BoxCollider", 60);
                Assert.That(TeamForgeWp6LocalStructureApply.TryApplyForLocalTest(
                    preview, intent, out var applied, out var error), Is.True, error);
                survivor.radius = 3f;
                EditorSceneManager.MarkSceneDirty(scene);
                Save(scene, scenePath);
                Assert.That(TeamForgeWp6LocalStructureApply.TryConfirmSavedForLocalTest(
                    preview, intent, applied, out var rejected, out _), Is.False);
                Assert.That(rejected, Is.Null);
                Assert.That(survivor.radius, Is.EqualTo(3f),
                    "Rejecting a stale mapping must not roll back user edits.");
                Assert.That(owner.GetComponents<BoxCollider>().Length, Is.EqualTo(1));
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

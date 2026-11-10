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
    public sealed class TeamForgeWp6LoadedSceneSourceTests
    {
        private const string Folder = "Assets/__TeamForgeWp6LoadedSceneSourceTests";

        [Test]
        public void CleanActiveSavedSceneMatchesExpectedSceneAndMetaBytesWithoutChangingUndo()
        {
            var scenePath = PrepareScenePath();
            Scene scene = default;
            try
            {
                scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                var root = new GameObject("saved WP6 source");
                SceneManager.MoveGameObjectToScene(root, scene);
                root.AddComponent<BoxCollider>();
                root.AddComponent<BoxCollider>();
                var child = new GameObject("nested Collider");
                child.transform.SetParent(root.transform);
                child.AddComponent<SphereCollider>();
                Assert.That(EditorSceneManager.SaveScene(scene, scenePath), Is.True);
                AssetDatabase.ImportAsset(scenePath, ImportAssetOptions.ForceSynchronousImport);
                Assert.That(TeamForgeBaselineFingerprint.TryCaptureActiveScene(
                    out var expected, out var error), Is.True, error);
                var meta = HashMeta(scenePath);
                var undoGroup = Undo.GetCurrentGroup();

                Assert.That(TeamForgeWp6LoadedSceneSource.TryCapture(
                    expected, meta, out var source, out error), Is.True, error);
                Assert.That(source.ScenePath, Is.EqualTo(scenePath));
                Assert.That(source.SceneGuid, Is.EqualTo(expected.sceneGuid));
                Assert.That(source.SceneFileSha256, Is.EqualTo(expected.sha256));
                Assert.That(source.MetaSha256, Is.EqualTo(meta));
                Assert.That(source.Inventory.SceneDirty, Is.False);
                Assert.That(source.Inventory.Observations.Count, Is.EqualTo(3));
                Assert.That(Undo.GetCurrentGroup(), Is.EqualTo(undoGroup));
                Assert.That(scene.isDirty, Is.False);
            }
            finally { Cleanup(scene, scenePath); }
        }

        [Test]
        public void WrongExpectedProjectSourceFieldsAndDirtyEditorStateFailClosed()
        {
            var scenePath = PrepareScenePath();
            Scene scene = default;
            try
            {
                scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                var go = new GameObject("source owner");
                SceneManager.MoveGameObjectToScene(go, scene);
                go.AddComponent<BoxCollider>();
                Assert.That(EditorSceneManager.SaveScene(scene, scenePath), Is.True);
                AssetDatabase.ImportAsset(scenePath, ImportAssetOptions.ForceSynchronousImport);
                Assert.That(TeamForgeBaselineFingerprint.TryCaptureActiveScene(
                    out var expected, out var error), Is.True, error);
                var meta = HashMeta(scenePath);
                var wrongHash = Copy(expected);
                wrongHash.sha256 = "a".PadRight(64, 'a');
                var wrongGuid = Copy(expected);
                wrongGuid.sceneGuid = "f".PadRight(32, 'f');
                var wrongPath = Copy(expected);
                wrongPath.scenePath = "Assets/Scenes/Different.unity";
                foreach (var wrong in new [] { wrongHash, wrongGuid, wrongPath })
                {
                    Assert.That(TeamForgeWp6LoadedSceneSource.TryCapture(
                        wrong, meta, out var refused, out _), Is.False);
                    Assert.That(refused, Is.Null);
                }
                Assert.That(TeamForgeWp6LoadedSceneSource.TryCapture(
                    expected, "b".PadRight(64, 'b'), out var wrongMeta, out _), Is.False);
                Assert.That(wrongMeta, Is.Null);

                EditorSceneManager.MarkSceneDirty(scene);
                Assert.That(TeamForgeWp6LoadedSceneSource.TryCapture(
                    expected, meta, out var dirty, out _), Is.False);
                Assert.That(dirty, Is.Null, "Unsaved Inspector values cannot claim saved-source consistency.");
            }
            finally { Cleanup(scene, scenePath); }
        }

        [Test]
        public void ExternalSavedFileOrMetadataMutationInvalidatesExpectedSource()
        {
            foreach (var mutateMeta in new[] { false, true })
            {
                var scenePath = PrepareScenePath();
                Scene scene = default;
                try
                {
                    scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                    var owner = new GameObject("source owner");
                    SceneManager.MoveGameObjectToScene(owner, scene);
                    owner.AddComponent<SphereCollider>();
                    Assert.That(EditorSceneManager.SaveScene(scene, scenePath), Is.True);
                    AssetDatabase.ImportAsset(scenePath, ImportAssetOptions.ForceSynchronousImport);
                    Assert.That(TeamForgeBaselineFingerprint.TryCaptureActiveScene(
                        out var expected, out var error), Is.True, error);
                    var meta = HashMeta(scenePath);
                    File.AppendAllText(scenePath + (mutateMeta ? ".meta" : string.Empty),
                        "\n# external file modification\n");
                    Assert.That(TeamForgeWp6LoadedSceneSource.TryCapture(
                        expected, meta, out var changed, out _), Is.False,
                        "An edited on-disk Scene/.meta is not the published source.");
                    Assert.That(changed, Is.Null);
                }
                finally { Cleanup(scene, scenePath); }
            }
        }

        [Test]
        public void OversizedMetadataWithItsCurrentMatchingHashIsRejectedBeforeSourceCapture()
        {
            var scenePath = PrepareScenePath();
            Scene scene = default;
            try
            {
                scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                var owner = new GameObject("bounded metadata");
                SceneManager.MoveGameObjectToScene(owner, scene);
                owner.AddComponent<BoxCollider>();
                Assert.That(EditorSceneManager.SaveScene(scene, scenePath), Is.True);
                AssetDatabase.ImportAsset(scenePath, ImportAssetOptions.ForceSynchronousImport);
                Assert.That(TeamForgeBaselineFingerprint.TryCaptureActiveScene(
                    out var expected, out var error), Is.True, error);

                // Keep the original Scene .meta GUID and calculate the *new*
                // matching hash: the rejection must come from the 64 KiB
                // file limit, not a stale expected metadata fingerprint.
                File.AppendAllText(scenePath + ".meta",
                    "\n# oversized synthetic metadata\n" + new string('x', 65536));
                Assert.That(new FileInfo(scenePath + ".meta").Length, Is.GreaterThan(64 * 1024));
                var matchingOversizedMetaHash = HashMeta(scenePath);
                Assert.That(TeamForgeWp6LoadedSceneSource.TryCapture(
                    expected, matchingOversizedMetaHash, out var refused, out _),
                    Is.False, "An oversized .meta must fail even when its hash matches.");
                Assert.That(refused, Is.Null);
            }
            finally { Cleanup(scene, scenePath); }
        }

        [Test]
        public void MissingOrMalformedExpectedSourceNeverObservesComponentProperties()
        {
            Assert.That(TeamForgeWp6LoadedSceneSource.TryCapture(null, null, out var missing, out _),
                Is.False);
            Assert.That(missing, Is.Null);
            var invalid = new TeamForgeSceneBaseline {
                scenePath = "Assets/../Another.unity",
                sceneGuid = "0".PadRight(32, '0'),
                sha256 = "a".PadRight(64, 'a'),
            };
            Assert.That(TeamForgeWp6LoadedSceneSource.TryCapture(invalid,
                "b".PadRight(64, 'b'), out var forged, out _), Is.False);
            Assert.That(forged, Is.Null);
        }

        private static TeamForgeSceneBaseline Copy(TeamForgeSceneBaseline source)
        {
            return new TeamForgeSceneBaseline {
                scenePath = source.scenePath, sceneGuid = source.sceneGuid, sha256 = source.sha256,
            };
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
                AssetDatabase.CreateFolder("Assets", "__TeamForgeWp6LoadedSceneSourceTests");
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

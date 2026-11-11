using System;
using System.IO;
using NUnit.Framework;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace EunSung.TeamForge.Tests
{
    public sealed class TeamForgeWp6PreviewSourceGateTests
    {
        private const string Folder = "Assets/__TeamForgeWp6PreviewSourceGateTests";

        [Test]
        public void RealSavedTwoColliderScenePassesBeforeReadOnlyPreviewWithoutUndoOrSceneMutation()
        {
            var path = PrepareScenePath();
            Scene scene = default;
            try
            {
                scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                var owner = new GameObject("read only preview");
                SceneManager.MoveGameObjectToScene(owner, scene);
                var box = owner.AddComponent<BoxCollider>();
                box.isTrigger = true;
                box.center = new Vector3(0.000001f, 1, -2);
                box.size = new Vector3(2, 3, 4);
                var nested = new GameObject("sphere");
                nested.transform.SetParent(owner.transform);
                var sphere = nested.AddComponent<SphereCollider>();
                sphere.radius = 0.75f;
                Assert.That(EditorSceneManager.SaveScene(scene, path), Is.True);
                AssetDatabase.ImportAsset(path, ImportAssetOptions.ForceSynchronousImport);
                Assert.That(TeamForgeBaselineFingerprint.TryCaptureActiveScene(
                    out var baseline, out var error), Is.True, error);
                var undoBefore = Undo.GetCurrentGroup();

                Assert.That(TeamForgeWp6PreviewSourceGate.TryCaptureForReadOnlyPreview(
                    baseline.sceneGuid, out var result, out error), Is.True, error);
                Assert.That(result.SceneGuid, Is.EqualTo(baseline.sceneGuid));
                Assert.That(result.SceneFileSha256, Is.EqualTo(baseline.sha256));
                Assert.That(result.MetaSha256, Does.Match("^[0-9a-f]{64}$"));
                Assert.That(result.ColliderCount, Is.EqualTo(2));
                Assert.That(TeamForgeWp6PreviewSourceGate.CanReuseCachedPreview(
                    result, result.SceneGuid,
                    result.SceneFileSha256, result.MetaSha256), Is.True);
                Assert.That(TeamForgeWp6PreviewSourceGate.CanReuseCachedPreview(
                    result, result.SceneGuid,
                    result.SceneFileSha256 + "0", result.MetaSha256), Is.False);
                Assert.That(TeamForgeWp6PreviewSourceGate.CanReuseCachedPreview(
                    result, result.SceneGuid,
                    result.SceneFileSha256, result.MetaSha256 + "0"), Is.False);
                Assert.That(TeamForgeWp6PreviewSourceGate.CanReuseCachedPreview(
                    result, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                    result.SceneFileSha256, result.MetaSha256), Is.False);
                Assert.That(scene.isDirty, Is.False);
                Assert.That(Undo.GetCurrentGroup(), Is.EqualTo(undoBefore));

                Assert.That(TeamForgeWp6PreviewSourceGate.TryCaptureForReadOnlyPreview(
                    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", out var mismatch, out _), Is.False);
                Assert.That(mismatch, Is.Null);
                Assert.That(TeamForgeWp6PreviewSourceGate.TryCaptureForReadOnlyPreview(
                    "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF", out _, out _), Is.False);
                Assert.That(TeamForgeWp6PreviewSourceGate.TryCaptureForReadOnlyPreview(
                    "00000000000000000000000000000000", out _, out _), Is.False);
            }
            finally { Cleanup(scene, path); }
        }

        [Test]
        public void DirtyUnityEditorSceneCannotSendReadOnlyPreviewEvenIfSavedFileIsUnchanged()
        {
            var path = PrepareScenePath();
            Scene scene = default;
            try
            {
                scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                var owner = new GameObject("dirty");
                SceneManager.MoveGameObjectToScene(owner, scene);
                owner.AddComponent<BoxCollider>();
                Assert.That(EditorSceneManager.SaveScene(scene, path), Is.True);
                AssetDatabase.ImportAsset(path, ImportAssetOptions.ForceSynchronousImport);
                var guid = AssetDatabase.AssetPathToGUID(path);
                EditorSceneManager.MarkSceneDirty(scene);
                Assert.That(TeamForgeWp6PreviewSourceGate.TryCaptureForReadOnlyPreview(
                    guid, out var refused, out _), Is.False);
                Assert.That(refused, Is.Null);
                Assert.That(scene.isDirty, Is.True);
            }
            finally { Cleanup(scene, path); }
        }

        [Test]
        public void OutOfBandSceneFileRewriteRefusesPreviewAndNeverEditsUnityScene()
        {
            var path = PrepareScenePath();
            Scene scene = default;
            byte[] original = null;
            try
            {
                scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                var owner = new GameObject("out of band edit");
                SceneManager.MoveGameObjectToScene(owner, scene);
                owner.AddComponent<SphereCollider>();
                Assert.That(EditorSceneManager.SaveScene(scene, path), Is.True);
                AssetDatabase.ImportAsset(path, ImportAssetOptions.ForceSynchronousImport);
                var guid = AssetDatabase.AssetPathToGUID(path);
                original = File.ReadAllBytes(path);
                File.AppendAllText(path, "\n--- !u!1001 &123456\nPrefabInstance:\n");
                Assert.That(TeamForgeWp6PreviewSourceGate.TryCaptureForReadOnlyPreview(
                    guid, out var refused, out _), Is.False);
                Assert.That(refused, Is.Null);
                Assert.That(scene.isDirty, Is.False,
                    "A rejected preflight must not save, reload, or modify the loaded Scene.");
            }
            finally
            {
                if (original != null) File.WriteAllBytes(path, original);
                Cleanup(scene, path);
            }
        }

        [Test]
        public void TamperedOrDuplicatedOnDiskMetaGuidCannotUseCachedUnityAssetDatabaseGuid()
        {
            var path = PrepareScenePath();
            Scene scene = default;
            byte[] original = null;
            try
            {
                scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                var owner = new GameObject("meta spoof");
                SceneManager.MoveGameObjectToScene(owner, scene);
                owner.AddComponent<BoxCollider>();
                Assert.That(EditorSceneManager.SaveScene(scene, path), Is.True);
                AssetDatabase.ImportAsset(path, ImportAssetOptions.ForceSynchronousImport);
                var guid = AssetDatabase.AssetPathToGUID(path);
                var metaPath = path + ".meta";
                original = File.ReadAllBytes(metaPath);
                var contents = System.Text.Encoding.UTF8.GetString(original);
                Assert.That(contents, Does.Contain("guid: " + guid));

                File.WriteAllText(metaPath, contents.Replace(
                    "guid: " + guid,
                    "guid: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"));
                Assert.That(TeamForgeWp6PreviewSourceGate.TryCaptureForReadOnlyPreview(
                    guid, out var spoofed, out _), Is.False);
                Assert.That(spoofed, Is.Null);

                File.WriteAllText(metaPath, contents +
                    "guid: " + guid + "\n");
                Assert.That(TeamForgeWp6PreviewSourceGate.TryCaptureForReadOnlyPreview(
                    guid, out var duplicated, out _), Is.False);
                Assert.That(duplicated, Is.Null);
                Assert.That(scene.isDirty, Is.False);
            }
            finally
            {
                if (original != null) File.WriteAllBytes(path + ".meta", original);
                Cleanup(scene, path);
            }
        }

        private static string PrepareScenePath()
        {
            if (!AssetDatabase.IsValidFolder(Folder))
                AssetDatabase.CreateFolder("Assets", "__TeamForgeWp6PreviewSourceGateTests");
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

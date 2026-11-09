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

        [Test]
        public void ConnectedProjectBaselinePinTracksOwnerPublisherEpochAndConnectionExactly()
        {
            var descriptor = new TeamForgeProjectDescriptor
            {
                projectUuid = "c1d815a9-3f04-4db1-82f2-50d5fa37e1bf",
                baselineRevision = 4,
                manifestHash = new string('a', 64),
                descriptorHash = new string('b', 64),
                unityVersion = "6000.3.21f1",
                teamForgePackageVersion = TeamForgeProjectContract.ProductVersion,
                realtimeProtocolVersion = TeamForgeProtocol.Version,
                transferProtocolVersion = TeamForgeProjectContract.TransferProtocolVersion,
                manifestSchemaVersion = TeamForgeProjectContract.ManifestSchemaVersion,
            };
            var baseline = new ProjectBaselineRecord
            {
                projectUuid = descriptor.projectUuid,
                baselineRevision = descriptor.baselineRevision,
                manifestHash = descriptor.manifestHash,
                descriptorHash = descriptor.descriptorHash,
                unityVersion = descriptor.unityVersion,
                teamForgePackageVersion = descriptor.teamForgePackageVersion,
                realtimeProtocolVersion = descriptor.realtimeProtocolVersion,
                transferProtocolVersion = descriptor.transferProtocolVersion,
                manifestSchemaVersion = descriptor.manifestSchemaVersion,
                ownerKeyId = new string('c', 64),
                ownerPublicKey = "owner-key",
                publisherKeyId = new string('d', 64),
                publisherPublicKey = "publisher-key",
                publisherAuthorization = "publisher-delegation",
                baselineSignature = "signed-baseline",
                publishedByConnectionId = "original-publisher",
                publishedAtUnixMs = 1700000000000,
            };
            Func<TeamForgeWp6PreviewSourceGate.ProjectPin> capture = () =>
                new TeamForgeWp6PreviewSourceGate.ProjectPin(
                    "editor-connection", "project-1", "session-1", descriptor, baseline);

            var original = capture();
            Assert.That(original.DescriptorMatchesBaseline, Is.True);
            Assert.That(original.Same(capture()), Is.True);
            Assert.That(original.Same(null), Is.False);
            Assert.That(original.Same(new TeamForgeWp6PreviewSourceGate.ProjectPin(
                "replacement-connection", "project-1", "session-1", descriptor, baseline)), Is.False);
            Assert.That(original.Same(new TeamForgeWp6PreviewSourceGate.ProjectPin(
                "editor-connection", "project-1", "new-session", descriptor, baseline)), Is.False);

            baseline.publisherKeyId = new string('e', 64);
            Assert.That(original.Same(capture()), Is.False,
                "A rotated Publisher key must not retain an old preview cache or accept a late reply.");
            baseline.publisherKeyId = new string('d', 64);
            baseline.manifestHash = new string('f', 64);
            Assert.That(capture().DescriptorMatchesBaseline, Is.False);
            Assert.That(original.Same(capture()), Is.False);
            baseline.manifestHash = descriptor.manifestHash;
            baseline.unityVersion = "6000.3.28f1";
            Assert.That(capture().DescriptorMatchesBaseline, Is.False);
            Assert.That(original.Same(capture()), Is.False);
            baseline.unityVersion = descriptor.unityVersion;
            baseline.baselineSignature = "different-signature";
            Assert.That(original.Same(capture()), Is.False,
                "A new signed baseline identity cannot reuse an earlier source pin.");
            Assert.That(original.ManifestHash, Is.EqualTo(descriptor.manifestHash),
                "Captured pins must not mutate when registry records are changed.");
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

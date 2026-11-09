using System;
using NUnit.Framework;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace EunSung.TeamForge.Tests
{
    public sealed class TeamForgeWp6ActiveSourceReportComparisonTests
    {
        private const string Folder = "Assets/__TeamForgeWp6ActiveReportTests";
        private const string Uuid = "c1d815a9-3f04-4db1-82f2-50d5fa37e1bf";

        private static TeamForgeWp6PreviewSourceGate.ProjectPin Project()
        {
            var descriptor = new TeamForgeProjectDescriptor
            {
                schemaVersion = TeamForgeProjectContract.DescriptorSchemaVersion,
                projectUuid = Uuid,
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
                publisherKeyId = new string('d', 64),
                ownerPublicKey = "local-owner",
                publisherPublicKey = "local-publisher",
                baselineSignature = "signed-local-fixture",
                publishedByConnectionId = "publisher",
                publishedAtUnixMs = 1700000000000,
            };
            return new TeamForgeWp6PreviewSourceGate.ProjectPin(
                "editor-1", "project-1", "session-1", descriptor, baseline);
        }

        private static TeamForgeWp6ActiveSourceReportComparison.LocalReference Report(
            TeamForgeWp6PreviewSourceGate.ProjectPin project,
            TeamForgeWp6PreviewSourceGate.Verified editor, string path)
        {
            return new TeamForgeWp6ActiveSourceReportComparison.LocalReference
            {
                schemaVersion = 1,
                status = "signed_active_scene_file_bytes_verified_local",
                projectId = project.ProjectId,
                projectUuid = project.ProjectUuid,
                baselineRevision = project.BaselineRevision,
                manifestHash = project.ManifestHash,
                descriptorHash = project.DescriptorHash,
                ownerKeyId = project.OwnerKeyId,
                publisherKeyId = project.PublisherKeyId,
                sceneId = editor.SceneGuid,
                scenePath = path,
                sceneFileSha256 = editor.SceneFileSha256,
                sceneMetaSha256 = editor.MetaSha256,
                sceneFileBytes = 123,
                manifestMembershipVerified = true,
                signedActiveFileBytesVerified = true,
                inspectorValuesVerified = false,
                currentServerSessionVerified = false,
                editorApplyVerified = false,
                networkWriteAuthorized = false,
            };
        }

        [Test]
        public void ExactProjectPeerReportMatchesOnlyTheCurrentLocalSourceNotRemoteAuthority()
        {
            var project = Project();
            var editor = new TeamForgeWp6PreviewSourceGate.Verified(
                new string('e', 32), new string('f', 64), new string('1', 64), 2);
            var report = Report(project, editor, "Assets/Scenes/Proof.unity");
            var json = JsonUtility.ToJson(report);
            Assert.That(TeamForgeWp6ActiveSourceReportComparison.TryMatchReport(
                json, project, editor, report.scenePath, out var error), Is.True, error);
            Assert.That(report.networkWriteAuthorized, Is.False);
            Assert.That(report.currentServerSessionVerified, Is.False);
            Assert.That(report.editorApplyVerified, Is.False);
        }

        [Test]
        public void MissingMalformedOversizedOrClaimedAuthorityReportsAreRefused()
        {
            var project = Project();
            var editor = new TeamForgeWp6PreviewSourceGate.Verified(
                new string('e', 32), new string('f', 64), new string('1', 64), 2);
            var path = "Assets/Scenes/Proof.unity";
            foreach (var bad in new[] {
                string.Empty, " ", "{", "[]", new string('a', 8193),
                "not JSON", "{}",
            })
                Assert.That(TeamForgeWp6ActiveSourceReportComparison.TryMatchReport(
                    bad, project, editor, path, out _), Is.False, bad);

            var report = Report(project, editor, path);
            foreach (var key in new[] {
                "manifestMembershipVerified", "signedActiveFileBytesVerified",
                "inspectorValuesVerified", "currentServerSessionVerified",
                "editorApplyVerified", "networkWriteAuthorized",
            })
            {
                var json = JsonUtility.ToJson(report);
                var original = key == "manifestMembershipVerified" ||
                               key == "signedActiveFileBytesVerified";
                json = json.Replace("\"" + key + "\":" + (original ? "true" : "false"),
                    "\"" + key + "\":" + (original ? "false" : "true"));
                Assert.That(TeamForgeWp6ActiveSourceReportComparison.TryMatchReport(
                    json, project, editor, path, out _), Is.False, key);
            }
        }

        [Test]
        public void DifferentProjectPublisherEpochOrSavedSceneCannotReuseTheReference()
        {
            var project = Project();
            var editor = new TeamForgeWp6PreviewSourceGate.Verified(
                new string('e', 32), new string('f', 64), new string('1', 64), 2);
            var path = "Assets/Scenes/Proof.unity";
            var report = Report(project, editor, path);
            foreach (Action<TeamForgeWp6ActiveSourceReportComparison.LocalReference> mutate in
                new Action<TeamForgeWp6ActiveSourceReportComparison.LocalReference>[] {
                    r => r.projectId = "different-project",
                    r => r.projectUuid = "0db86a96-0b89-4e1f-94ba-8dc58917a0f0",
                    r => r.baselineRevision++,
                    r => r.manifestHash = new string('2', 64),
                    r => r.descriptorHash = new string('2', 64),
                    r => r.ownerKeyId = new string('2', 64),
                    r => r.publisherKeyId = new string('2', 64),
                    r => r.sceneId = new string('2', 32),
                    r => r.scenePath = "Assets/Scenes/Other.unity",
                    r => r.sceneFileSha256 = new string('2', 64),
                    r => r.sceneMetaSha256 = new string('2', 64),
                    r => r.sceneFileBytes = 0,
                    r => r.schemaVersion = 2,
                    r => r.status = "signed_remote_inspector_applied",
                })
            {
                var altered = JsonUtility.FromJson<TeamForgeWp6ActiveSourceReportComparison.LocalReference>(
                    JsonUtility.ToJson(report));
                mutate(altered);
                Assert.That(TeamForgeWp6ActiveSourceReportComparison.TryMatchReport(
                    JsonUtility.ToJson(altered), project, editor, path, out _),
                    Is.False, JsonUtility.ToJson(altered));
            }
            Assert.That(TeamForgeWp6ActiveSourceReportComparison.TryMatchReport(
                JsonUtility.ToJson(report), project, editor, "Assets/Scenes/Different.unity", out _),
                Is.False);
        }

        [Test]
        public void RealEditorSavedColliderSceneCanBeComparedWithoutMutationOrUndo()
        {
            if (!AssetDatabase.IsValidFolder(Folder))
                AssetDatabase.CreateFolder("Assets", "__TeamForgeWp6ActiveReportTests");
            var path = Folder + "/" + Guid.NewGuid().ToString("N") + ".unity";
            Scene scene = default;
            try
            {
                scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                var owner = new GameObject("source compare test");
                SceneManager.MoveGameObjectToScene(owner, scene);
                var collider = owner.AddComponent<BoxCollider>();
                collider.isTrigger = true;
                collider.size = new Vector3(2, 3, 4);
                Assert.That(EditorSceneManager.SaveScene(scene, path), Is.True);
                AssetDatabase.ImportAsset(path, ImportAssetOptions.ForceSynchronousImport);

                var guid = AssetDatabase.AssetPathToGUID(path);
                Assert.That(TeamForgeWp6PreviewSourceGate.TryCaptureForReadOnlyPreview(
                    guid, out var editor, out var error), Is.True, error);
                var undoBefore = Undo.GetCurrentGroup();
                var project = Project();
                var report = Report(project, editor, path);
                Assert.That(TeamForgeWp6ActiveSourceReportComparison.TryMatchReport(
                    JsonUtility.ToJson(report), project, editor, path, out error),
                    Is.True, error);
                Assert.That(scene.isDirty, Is.False);
                Assert.That(Undo.GetCurrentGroup(), Is.EqualTo(undoBefore));
                report.sceneFileSha256 = new string('a', 64);
                Assert.That(TeamForgeWp6ActiveSourceReportComparison.TryMatchReport(
                    JsonUtility.ToJson(report), project, editor, path, out _), Is.False);
            }
            finally
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
}

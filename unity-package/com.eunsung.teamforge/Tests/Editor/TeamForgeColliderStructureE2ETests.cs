using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Text;
using NUnit.Framework;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.TestTools;

namespace EunSung.TeamForge.Tests
{
    // Drives production authority/transport/apply paths in one actual Editor.
    // The other participant is Node; this is not two-Editor field evidence.
    public sealed class TeamForgeColliderStructureE2ETests
    {
        private const string Folder = "Assets/__TeamForgeM2E2E";
        private const string BoxType = "UnityEngine.BoxCollider";
        private const string SphereType = "UnityEngine.SphereCollider";
        private CleanupState _cleanup;
        private string _diagnostics = string.Empty;
        private string _sourceSha = string.Empty;
        private bool _primitiveEnabled;
        private bool _primitiveCreate;
        private bool _primitiveRemoteApply;
        private bool _primitiveColliderEdit;
        private bool _primitiveReconnectDelete;

        private sealed class CleanupState
        {
            internal TeamForgeConnectionSettings Settings;
            internal string OriginalSettings;
            internal bool WasPropertyOptedIn;
            internal bool WasStructureOptedIn;
            internal bool WasPrimitiveOptedIn;
            internal string DescriptorPath;
            internal byte[] OriginalDescriptor;
            internal string ScenePath;
        }

        [UnityTest]
        public IEnumerator RealServer_ColliderAddEditSaveReopenRemoveAndReconnect()
        {
            var enabled = false;
            foreach (var argument in Environment.GetCommandLineArgs())
            {
                if (string.Equals(argument, "-teamforgeComponentStructureE2E", StringComparison.OrdinalIgnoreCase))
                    enabled = true;
                if (string.Equals(argument, "-teamforgePrimitiveE2E", StringComparison.OrdinalIgnoreCase))
                    _primitiveEnabled = true;
            }
            if (!enabled)
                Assert.Ignore("Production Collider lifecycle E2E requires its Node fixture and -teamforgeComponentStructureE2E.");
            for (var index = 0; index < SceneManager.sceneCount; index++)
            {
                var openScene = SceneManager.GetSceneAt(index);
                if (openScene.IsValid() && openScene.isLoaded && openScene.isDirty)
                    Assert.Ignore("M2 E2E requires clean open Scenes; existing unsaved work was preserved.");
            }

            var settings = TeamForgeConnectionService.Settings;
            var projectRoot = Directory.GetParent(Application.dataPath).FullName;
            var descriptorPath = Path.Combine(projectRoot, "ProjectSettings", "TeamForgeProject.json");
            var fixtureRoot = Path.GetFullPath(Path.Combine(projectRoot, "..", "test-results", "component-structure-e2e"));
            _cleanup = new CleanupState
            {
                Settings = settings, OriginalSettings = EditorJsonUtility.ToJson(settings),
                WasPropertyOptedIn = TeamForgeConnectionService.ComponentPropertySyncOptIn,
                WasStructureOptedIn = TeamForgeConnectionService.ComponentStructureSyncOptIn,
                WasPrimitiveOptedIn = TeamForgeConnectionService.PrimitiveTemplateSyncOptIn,
                DescriptorPath = descriptorPath,
                OriginalDescriptor = File.Exists(descriptorPath) ? File.ReadAllBytes(descriptorPath) : null,
            };
            // Arm cleanup before Disconnect mutates ResumeAfterAssemblyReload.
            BeginCleanupDisconnect();
            yield return Wait(() => TeamForgeConnectionService.State == TeamForgeConnectionState.Disconnected,
                10, "Disconnect before M2 E2E");
            var appliedProperties = new List<string>();
            var appliedTransforms = new List<string>();
            Action<string, string> capture = (type, json) =>
            {
                if (type == "component_property_applied") appliedProperties.Add(json);
            };
            Action<string, string> captureTransform = (type, json) =>
            {
                if (type == "transform_applied") appliedTransforms.Add(json);
            };
            TeamForgeConnectionService.ComponentMessageReceived += capture;
            TeamForgeConnectionService.TransformMessageReceived += captureTransform;
            var passed = false;
            try
            {
                Assert.That(TeamForgeColliderSyncService.LeaveScene(true, out var error), Is.True, error);
                Assert.That(TeamForgeConnectionService.TrySetComponentPropertySyncOptIn(true, out error), Is.True, error);
                Assert.That(TeamForgeConnectionService.TrySetComponentStructureSyncOptIn(true, out error), Is.True, error);
                Assert.That(TeamForgeConnectionService.TrySetPrimitiveTemplateSyncOptIn(_primitiveEnabled, out error), Is.True, error);
                using (TeamForgeTransformSyncService.SuppressSelectionLock()) Selection.activeObject = null;
                if (!AssetDatabase.IsValidFolder(Folder))
                    AssetDatabase.CreateFolder("Assets", "__TeamForgeM2E2E");
                var scenePath = Folder + "/" + Guid.NewGuid().ToString("N") + ".unity";
                _cleanup.ScenePath = scenePath;
                var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                var owner = new GameObject("M2 exact Collider owner");
                var initialBox = owner.AddComponent<BoxCollider>();
                Assert.That(EditorSceneManager.SaveScene(scene, scenePath), Is.True);
                AssetDatabase.ImportAsset(scenePath, ImportAssetOptions.ForceSynchronousImport);
                Assert.That(TeamForgeWp6SceneInventory.TryCapture(scene, out var inventory, out error), Is.True, error);
                Assert.That(TeamForgeWp6ComponentIdentity.TryCapture(initialBox, out var initialIdentity, out error),
                    Is.True, error);
                var sceneId = inventory.SceneId;
                var objectId = initialIdentity.ObjectId;
                var savedSceneFile = Path.Combine(projectRoot, scenePath);
                var originalSavedSceneBytes = File.ReadAllBytes(savedSceneFile);
                var originalSavedMetaBytes = File.ReadAllBytes(savedSceneFile + ".meta");
                Directory.CreateDirectory(fixtureRoot);
                WriteFixtureRequest(fixtureRoot, scenePath, inventory, initialIdentity, owner, _primitiveEnabled);
                var readyPath = Path.Combine(fixtureRoot, "ready.json");
                yield return Wait(() => File.Exists(readyPath), 90, "M2 signed real Scene publication");
                var ready = JsonUtility.FromJson<FixtureReady>(File.ReadAllText(readyPath));
                Assert.That(ready, Is.Not.Null);
                Assert.That(ready.serverAddress, Is.EqualTo("http://127.0.0.1:5084"));
                Assert.That(ready.lateJoinServerRevision, Is.GreaterThan(0));
                Assert.That(ready.primitiveEnabled, Is.EqualTo(_primitiveEnabled),
                    "The Node fixture and real Editor must exercise the same negotiated feature scope.");
                Assert.That(TeamForgeProjectValidation.TryValidateDescriptor(ready.descriptor, out error), Is.True, error);
                _sourceSha = ready.sourceSha;
                File.WriteAllText(descriptorPath, JsonUtility.ToJson(ready.descriptor), new UTF8Encoding(false));
                TeamForgeProjectService.ReloadDescriptor();
                settings.ServerAddress = ready.serverAddress; settings.RealtimePath = "ws";
                settings.UserId = "ci-m2-unity"; settings.UserName = "CI M2 Unity";
                settings.UserColorHtml = "#E57373"; settings.ProjectId = ready.projectId;
                settings.SessionId = ready.sessionId; settings.AuthenticationToken = string.Empty;
                settings.AutoReconnect = false; settings.ConnectionTimeoutSeconds = 10;
                settings.ResumeAfterAssemblyReload = false; settings.LogLevel = TeamForgeLogLevel.Info;
                settings.SaveSettings();
                Assert.That(scene.isDirty, Is.False, "A genuinely fresh Editor starts from the clean saved source.");
                Assert.That(owner.name, Is.EqualTo("M2 exact Collider owner"));
                Assert.That(owner.transform.localPosition, Is.EqualTo(Vector3.zero));
                Assert.That(TeamForgeColliderSyncService.SceneId, Is.Empty,
                    "This Editor must not reuse a prior local Collider admission.");
                Assert.That(TeamForgeColliderSyncService.CatalogRows(), Is.Empty);
                TeamForgeConnectionService.Connect();
                yield return Wait(ConnectionReady, 30, "Negotiated M2 connection and Project/Hierarchy registry");
                yield return Wait(() => owner.name == ready.lateJoinOwnerName &&
                    owner.transform.localPosition == ready.lateJoinLocalPosition && scene.isDirty,
                    30, "Retained authority changes dirty the fresh Scene before Collider admission");
                Assert.That(TeamForgeAuthorityView.Current.SessionRevision,
                    Is.GreaterThanOrEqualTo(ready.lateJoinServerRevision));
                Assert.That(TeamForgeColliderSyncService.Ready, Is.False,
                    "Hierarchy/Transform snapshot apply must precede this Editor's first Collider join.");
                Assert.That(owner.GetComponent<BoxCollider>(), Is.SameAs(initialBox));
                Assert.That(owner.GetComponents<BoxCollider>(), Has.Length.EqualTo(1));
                Assert.That(initialBox.center, Is.EqualTo(Vector3.zero));
                Assert.That(initialBox.size, Is.EqualTo(Vector3.one));
                Assert.That(File.ReadAllBytes(savedSceneFile), Is.EqualTo(originalSavedSceneBytes),
                    "Authoritative loaded-Scene changes must not rewrite the signed source on disk.");
                Assert.That(File.ReadAllBytes(savedSceneFile + ".meta"), Is.EqualTo(originalSavedMetaBytes));
                Assert.That(TeamForgeWp6PreviewSourceGate.TryCaptureCurrentProjectPin(out _, out error), Is.True, error);
                Assert.That(TeamForgeColliderSyncService.JoinActiveScene(out error), Is.True, error);
                yield return Wait(() => CatalogReady(1), 30, "Fresh dirty-Scene join to the retained signed M2 catalog");
                Assert.That(FindRow(initialIdentity.ComponentId), Is.Not.Null);
                Assert.That(Resolve<BoxCollider>(FindRow(initialIdentity.ComponentId)), Is.SameAs(initialBox));
                Assert.That(owner.name, Is.EqualTo(ready.lateJoinOwnerName));
                Assert.That(owner.transform.localPosition, Is.EqualTo(ready.lateJoinLocalPosition));
                Assert.That(scene.isDirty, Is.True);
                Assert.That(File.ReadAllBytes(savedSceneFile), Is.EqualTo(originalSavedSceneBytes));
                Assert.That(File.ReadAllBytes(savedSceneFile + ".meta"), Is.EqualTo(originalSavedMetaBytes));
                Selection.activeGameObject = owner;
                yield return Wait(OwnsSelectedLock, 15, "M2 owner lock");

                var beforeIds = CatalogIds();
                Assert.That(TeamForgeColliderSyncService.AddColliderToSelection(BoxType, out error), Is.True, error);
                yield return Wait(() => CatalogReady(2), 15, "First authorized BoxCollider add");
                var first = NewlyAdded(beforeIds, BoxType, objectId);
                var firstId = first.componentId;
                var firstBox = Resolve<BoxCollider>(first);
                beforeIds = CatalogIds();
                Assert.That(TeamForgeColliderSyncService.AddColliderToSelection(BoxType, out error), Is.True, error);
                yield return Wait(() => CatalogReady(3), 15, "Second same-type authorized BoxCollider add");
                var second = NewlyAdded(beforeIds, BoxType, objectId);
                var secondId = second.componentId;
                var secondBox = Resolve<BoxCollider>(second);
                Assert.That(firstId, Is.Not.EqualTo(secondId));
                Assert.That(firstBox, Is.Not.SameAs(secondBox));
                Assert.That(owner.GetComponents<BoxCollider>(), Has.Length.EqualTo(3));

                var propertyCount = appliedProperties.Count;
                firstBox.center = new Vector3(1f, 2f, 3f);
                EditorSceneManager.MarkSceneDirty(scene);
                yield return Wait(() => appliedProperties.Count > propertyCount && !TeamForgeColliderSyncService.Pending,
                    15, "Property commit on the first logical Component");
                propertyCount = appliedProperties.Count;
                firstBox.size = new Vector3(2f, 3f, 4f);
                yield return Wait(() => appliedProperties.Count > propertyCount && !TeamForgeColliderSyncService.Pending,
                    15, "Continuous logical Component property commit");
                Assert.That(secondBox.center, Is.EqualTo(Vector3.zero));
                Assert.That(initialBox.center, Is.EqualTo(Vector3.zero));
                Assert.That(EditorSceneManager.SaveScene(scene, scenePath), Is.True);
                Assert.That(TeamForgeColliderComponentBindings.RefreshSavedBindings(out error), Is.True, error);
                TeamForgeConnectionService.Disconnect();
                yield return Wait(() => TeamForgeConnectionService.State == TeamForgeConnectionState.Disconnected,
                    10, "Disconnect after saving native aliases");
                using (TeamForgeTransformSyncService.SuppressSelectionLock()) Selection.activeObject = null;
                scene = EditorSceneManager.OpenScene(scenePath, OpenSceneMode.Single);
                Assert.That(TeamForgeObjectIdentity.TryResolveGameObject(objectId, out owner), Is.True);
                Assert.That(AssetDatabase.AssetPathToGUID(scene.path), Is.EqualTo(sceneId));
                TeamForgeConnectionService.Connect();
                yield return Wait(ConnectionReady, 30, "Reconnect after actual Scene reopen");
                Assert.That(TeamForgeColliderSyncService.JoinActiveScene(out error), Is.True, error);
                yield return Wait(() => CatalogReady(3), 30, "Runtime catalog after saved Scene reopen");
                first = FindRow(firstId); second = FindRow(secondId);
                Assert.That(first, Is.Not.Null); Assert.That(second, Is.Not.Null);
                firstBox = Resolve<BoxCollider>(first); secondBox = Resolve<BoxCollider>(second);
                Assert.That(firstBox.center, Is.EqualTo(new Vector3(1f, 2f, 3f)));
                Assert.That(firstBox.size, Is.EqualTo(new Vector3(2f, 3f, 4f)));
                Assert.That(secondBox.center, Is.EqualTo(Vector3.zero));
                Assert.That(owner.GetComponents<BoxCollider>(), Has.Length.EqualTo(3),
                    "Reopen must recover exact aliases instead of adding duplicate Colliders.");
                Selection.activeGameObject = owner;
                yield return Wait(OwnsSelectedLock, 15, "Reopened owner lock");
                Assert.That(TeamForgeColliderSyncService.RemoveCollider(first, out error), Is.True, error);
                yield return Wait(() => CatalogReady(2) && FindRow(firstId) == null, 15, "Remove the exact first logical Collider");
                Assert.That(TeamForgeColliderComponentBindings.TryResolve(sceneId, objectId, firstId, BoxType,
                    out _, out _), Is.False);
                Assert.That(Resolve<BoxCollider>(FindRow(secondId)), Is.SameAs(secondBox));
                Assert.That(secondBox.center, Is.EqualTo(Vector3.zero));
                Assert.That(owner.GetComponents<BoxCollider>(), Has.Length.EqualTo(2));

                Assert.That(TeamForgeColliderSyncService.UndoOwnEdit(), Is.True);
                yield return Wait(() => CatalogReady(3) && FindRow(firstId) != null, 15, "Conditional own remove compensation");
                firstBox = Resolve<BoxCollider>(FindRow(firstId));
                Assert.That(firstBox.center, Is.EqualTo(new Vector3(1f, 2f, 3f)));
                Assert.That(firstBox.size, Is.EqualTo(new Vector3(2f, 3f, 4f)));
                Assert.That(Resolve<BoxCollider>(FindRow(secondId)), Is.SameAs(secondBox));
                Assert.That(TeamForgeColliderSyncService.RedoOwnEdit(), Is.True);
                yield return Wait(() => CatalogReady(2) && FindRow(firstId) == null, 15, "Conditional own structural Redo");
                Assert.That(owner.GetComponents<BoxCollider>(), Has.Length.EqualTo(2));

                Assert.That(TeamForgeTransformSyncService.ReleaseSelectedLock(), Is.True);
                Selection.activeObject = null;
                WriteAtomic(Path.Combine(fixtureRoot, "phase.json"), JsonUtility.ToJson(new FixturePhase
                { phase = "remote", sceneId = sceneId, objectId = objectId, componentId = secondId }));
                var peerResultPath = Path.Combine(fixtureRoot, "peer-result.json");
                yield return Wait(() => File.Exists(peerResultPath) && secondBox.center == new Vector3(7f, 8f, 9f) &&
                    CatalogReady(3), 30, "Remote Node structure add and logical property apply");
                var peerResult = JsonUtility.FromJson<PeerResult>(File.ReadAllText(peerResultPath));
                Assert.That(peerResult.remoteCommitted, Is.True);
                var remoteSphere = Resolve<SphereCollider>(FindRow(peerResult.addedComponentId));
                Assert.That(remoteSphere.radius, Is.EqualTo(1.75f));
                Assert.That(Resolve<BoxCollider>(FindRow(secondId)), Is.SameAs(secondBox));

                WriteAtomic(Path.Combine(fixtureRoot, "phase.json"), JsonUtility.ToJson(new FixturePhase
                { phase = "hold_next_ack", sceneId = sceneId, objectId = objectId, componentId = secondId }));
                yield return Wait(() => File.Exists(Path.Combine(fixtureRoot, "fault-ready.json")),
                    15, "Owned relay armed for structural ACK loss");
                Selection.activeGameObject = owner;
                yield return Wait(OwnsSelectedLock, 15, "Lock before lost structural ACK");
                Assert.That(TeamForgeColliderSyncService.AddColliderToSelection(BoxType, out error), Is.True, error);
                var heldPath = Path.Combine(fixtureRoot, "held-ack.json");
                yield return Wait(() => TeamForgeColliderSyncService.Pending && File.Exists(heldPath),
                    15, "Server accepted an add whose origin ACK is held");
                var held = JsonUtility.FromJson<HeldAcknowledgement>(File.ReadAllText(heldPath));
                Assert.That(TeamForgeColliderComponentCatalogRow.IsLogicalComponentId(held.componentId), Is.True);
                TeamForgeConnectionService.Disconnect();
                yield return Wait(() => TeamForgeConnectionService.State == TeamForgeConnectionState.Disconnected,
                    10, "Disconnect as the last peer after the accepted add");
                TeamForgeConnectionService.Connect();
                yield return Wait(ConnectionReady, 30, "Reconnect after accepted add ACK loss");
                Assert.That(TeamForgeColliderSyncService.JoinActiveScene(out error), Is.True, error);
                yield return Wait(() => CatalogReady(4) && FindRow(held.componentId) != null,
                    30, "Recover the accepted logical addition exactly once");
                Assert.That(Resolve<BoxCollider>(FindRow(held.componentId)), Is.Not.Null);
                Assert.That(owner.GetComponents<BoxCollider>(), Has.Length.EqualTo(3));
                Assert.That(owner.GetComponents<SphereCollider>(), Has.Length.EqualTo(1));
                Assert.That(secondBox.center, Is.EqualTo(new Vector3(7f, 8f, 9f)));

                // Exercise the zero-state transition as the sole remaining peer.
                Selection.activeGameObject = owner;
                yield return Wait(OwnsSelectedLock, 15, "Lock before removing the remaining catalog");
                while (TeamForgeColliderSyncService.CatalogRows().Count > 0)
                {
                    var row = TeamForgeColliderSyncService.CatalogRows()[0];
                    var remaining = TeamForgeColliderSyncService.CatalogRows().Count - 1;
                    Assert.That(TeamForgeColliderSyncService.RemoveCollider(row, out error), Is.True, error);
                    yield return Wait(() => CatalogReady(remaining), 15, "Remove remaining exact catalog target");
                }
                Assert.That(owner.GetComponents<Collider>(), Is.Empty);
                Assert.That(EditorSceneManager.SaveScene(scene, scenePath), Is.True);
                TeamForgeConnectionService.Disconnect();
                yield return Wait(() => TeamForgeConnectionService.State == TeamForgeConnectionState.Disconnected,
                    10, "Last peer disconnect with an empty catalog");
                using (TeamForgeTransformSyncService.SuppressSelectionLock()) Selection.activeObject = null;
                scene = EditorSceneManager.OpenScene(scenePath, OpenSceneMode.Single);
                Assert.That(TeamForgeObjectIdentity.TryResolveGameObject(objectId, out owner), Is.True);
                Assert.That(owner.GetComponents<Collider>(), Is.Empty,
                    "Saving and reopening must preserve the exact removals.");
                TeamForgeConnectionService.Connect();
                yield return Wait(ConnectionReady, 30, "Reconnect to retained empty catalog after Scene reopen");
                Assert.That(TeamForgeColliderSyncService.JoinActiveScene(out error), Is.True, error);
                yield return Wait(() => CatalogReady(0), 30, "Apply retained empty catalog");
                Assert.That(owner.GetComponents<Collider>(), Is.Empty,
                    "Applying retained tombstones after reopen must be idempotent.");
                Selection.activeGameObject = owner;
                yield return Wait(OwnsSelectedLock, 15, "Empty catalog owner lock");
                Assert.That(TeamForgeColliderSyncService.AddColliderToSelection(SphereType, out error), Is.True, error);
                yield return Wait(() => CatalogReady(1), 15, "Add after empty-catalog reconnect");
                var finalRow = TeamForgeColliderSyncService.CatalogRows()[0];
                Assert.That(finalRow.typeName, Is.EqualTo(SphereType));
                Assert.That(Resolve<SphereCollider>(finalRow).radius, Is.EqualTo(0.5f));
                Assert.That(owner.GetComponents<Collider>(), Has.Length.EqualTo(1));
                Assert.That(EditorSceneManager.SaveScene(scene, scenePath), Is.True);
                if (_primitiveEnabled)
                    yield return ExerciseSharedPrimitives(sceneId, scene, owner, finalRow.componentId,
                        fixtureRoot, appliedProperties, appliedTransforms);
                passed = true;
                WriteAtomic(Path.Combine(fixtureRoot, "result.json"), JsonUtility.ToJson(new FixtureResult
                {
                    passed = true, sourceSha = _sourceSha, unityVersion = Application.unityVersion,
                    editorCount = 1, nodePeerCount = 1, logicalAddRemove = true, multipleSameType = true,
                    propertyEdit = true, saveReopenBinding = true, conditionalUndoRedo = true,
                    reconnectRecovery = true, pendingAckLossRecovery = true, diagnostics = _diagnostics,
                    primitiveCreate = _primitiveCreate, primitiveRemoteApply = _primitiveRemoteApply,
                    primitiveColliderEdit = _primitiveColliderEdit, primitiveReconnectDelete = _primitiveReconnectDelete,
                }));
            }
            finally
            {
                TeamForgeConnectionService.ComponentMessageReceived -= capture;
                TeamForgeConnectionService.TransformMessageReceived -= captureTransform;
                BeginCleanupDisconnect();
                if (!passed && Directory.Exists(fixtureRoot))
                    WriteAtomic(Path.Combine(fixtureRoot, "result.json"), JsonUtility.ToJson(new FixtureResult
                    {
                        passed = false, sourceSha = _sourceSha, unityVersion = Application.unityVersion,
                        editorCount = 1, nodePeerCount = 1,
                        diagnostics = _diagnostics + " | " + TeamForgeColliderSyncService.Status,
                    }));
            }
        }

        [UnityTearDown]
        public IEnumerator RestoreAfterActualTransportDisconnect()
        {
            var cleanup = _cleanup;
            if (cleanup == null) yield break;
            try
            {
                BeginCleanupDisconnect();
                yield return Wait(() => TeamForgeConnectionService.State == TeamForgeConnectionState.Disconnected,
                    10, "M2 cleanup waits for the actual transport close");
                yield return null;
                Assert.That(TeamForgeColliderSyncService.LeaveScene(true, out var error), Is.True, error);
                Assert.That(TeamForgeConnectionService.TrySetPrimitiveTemplateSyncOptIn(cleanup.WasPrimitiveOptedIn, out error),
                    Is.True, error);
                Assert.That(TeamForgeConnectionService.TrySetComponentStructureSyncOptIn(cleanup.WasStructureOptedIn, out error),
                    Is.True, error);
                Assert.That(TeamForgeConnectionService.TrySetComponentPropertySyncOptIn(cleanup.WasPropertyOptedIn, out error),
                    Is.True, error);
                EditorJsonUtility.FromJsonOverwrite(cleanup.OriginalSettings, cleanup.Settings);
                cleanup.Settings.SaveSettings();
                if (cleanup.OriginalDescriptor != null)
                    File.WriteAllBytes(cleanup.DescriptorPath, cleanup.OriginalDescriptor);
                else if (File.Exists(cleanup.DescriptorPath)) File.Delete(cleanup.DescriptorPath);
                TeamForgeProjectService.ReloadDescriptor();
                using (TeamForgeTransformSyncService.SuppressSelectionLock()) Selection.activeObject = null;
                EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                if (!string.IsNullOrEmpty(cleanup.ScenePath)) AssetDatabase.DeleteAsset(cleanup.ScenePath);
                if (AssetDatabase.IsValidFolder(Folder) &&
                    AssetDatabase.FindAssets(string.Empty, new[] { Folder }).Length == 0)
                    AssetDatabase.DeleteAsset(Folder);
                Assert.That(TeamForgeConnectionService.State, Is.EqualTo(TeamForgeConnectionState.Disconnected));
                yield return null;
            }
            finally { _cleanup = null; }
        }

        private IEnumerator ExerciseSharedPrimitives(string sceneId, Scene scene, GameObject originalOwner,
            string originalColliderId, string fixtureRoot, List<string> appliedProperties, List<string> appliedTransforms)
        {
            Assert.That(TeamForgeConnectionService.PrimitiveTemplateSyncAvailable, Is.True);
            var beforeIds = CatalogIds();
            var objectsBeforeApproval = CountSceneObjects(scene);
            Assert.That(TeamForgeHierarchySyncService.CreateSharedPrimitive("cube-v1", out var error), Is.True, error);
            Assert.That(CountSceneObjects(scene), Is.EqualTo(objectsBeforeApproval),
                "Sending a primitive intent must not create a native GameObject before the authority reply.");
            Assert.That(TeamForgeColliderSyncService.CatalogRows(), Has.Count.EqualTo(beforeIds.Count));
            yield return Wait(() => CatalogReady(2), 20, "Authoritative Cube template and Collider creation");
            var cubeRow = NewlyCreatedPrimitive(beforeIds, BoxType);
            var cubeId = cubeRow.objectId;
            var cubeColliderId = cubeRow.componentId;
            var cube = ResolvePrimitiveOwner(cubeRow);
            AssertPrimitive(cube, cubeRow, "Cube");
            var cubeBox = Resolve<BoxCollider>(cubeRow);
            _primitiveCreate = true;

            Selection.activeGameObject = cube;
            yield return Wait(OwnsSelectedLock, 15, "Shared Cube edit lease");
            var propertiesBefore = appliedProperties.Count;
            cubeBox.size = new Vector3(2f, 3f, 4f);
            EditorSceneManager.MarkSceneDirty(scene);
            yield return Wait(() => appliedProperties.Count > propertiesBefore && !TeamForgeColliderSyncService.Pending,
                15, "Shared primitive Collider property commit");
            var cubePosition = new Vector3(4f, 1f, -2f);
            var cubeScale = new Vector3(1.5f, 2f, 0.75f);
            cube.transform.localPosition = cubePosition;
            cube.transform.localRotation = Quaternion.Euler(0f, 30f, 0f);
            cube.transform.localScale = cubeScale;
            EditorSceneManager.MarkSceneDirty(scene);
            yield return Wait(() => HasTransformCommit(appliedTransforms, cubeId, cubePosition, cubeScale),
                20, "Shared primitive Transform commit");
            Assert.That(TeamForgeTransformSyncService.ReleaseSelectedLock(), Is.True);
            Selection.activeObject = null;
            WriteAtomic(Path.Combine(fixtureRoot, "phase.json"), JsonUtility.ToJson(new FixturePhase
            { phase = "primitive", sceneId = sceneId, objectId = cubeId, componentId = cubeColliderId }));
            var peerPath = Path.Combine(fixtureRoot, "primitive-peer-result.json");
            yield return Wait(() => File.Exists(peerPath) && CatalogReady(3), 30,
                "Node verifies the Cube and creates a remote shared Sphere");
            var remote = JsonUtility.FromJson<PrimitivePeerResult>(File.ReadAllText(peerPath));
            Assert.That(remote.primitiveVerified, Is.True);
            Assert.That(remote.cubeObjectId, Is.EqualTo(cubeId));
            Assert.That(remote.cubeComponentId, Is.EqualTo(cubeColliderId));
            _primitiveColliderEdit = true;
            var sphereRow = FindRow(remote.sphereComponentId);
            Assert.That(sphereRow, Is.Not.Null);
            Assert.That(sphereRow.objectId, Is.EqualTo(remote.sphereObjectId));
            Assert.That(sphereRow.typeName, Is.EqualTo(SphereType));
            var sphere = ResolvePrimitiveOwner(sphereRow);
            AssertPrimitive(sphere, sphereRow, "Sphere");
            yield return Wait(() => Resolve<SphereCollider>(FindRow(remote.sphereComponentId)).radius == 1.25f &&
                sphere.transform.localPosition == new Vector3(-3f, 2f, 1f), 15,
                "Remote primitive Sphere geometry, transform and Collider property apply");
            Assert.That(cubeBox.size, Is.EqualTo(new Vector3(2f, 3f, 4f)));
            _primitiveRemoteApply = true;

            // The fixture's Node peer closes before publishing its result.
            // This disconnect therefore tests retained templates and topology
            // while no Editor or Node peer remains in the Session.
            var scenePath = scene.path;
            Assert.That(TeamForgeObjectIdentity.TryGetCollaborativeObjectId(originalOwner, out var originalOwnerId), Is.True);
            Assert.That(EditorSceneManager.SaveScene(scene, scenePath), Is.True);
            Assert.That(TeamForgeColliderComponentBindings.RefreshSavedBindings(out error), Is.True, error);
            TeamForgeHierarchyIdentityRegistry.RefreshAndPersist();
            TeamForgeConnectionService.Disconnect();
            yield return Wait(() => TeamForgeConnectionService.State == TeamForgeConnectionState.Disconnected,
                10, "Last peer disconnect with both shared primitive templates");
            using (TeamForgeTransformSyncService.SuppressSelectionLock()) Selection.activeObject = null;
            TeamForgeHierarchyIdentityRegistry.ForgetLiveObject(cubeId);
            TeamForgeHierarchyIdentityRegistry.ForgetLiveObject(remote.sphereObjectId);
            TeamForgeColliderComponentBindings.ClearContext();
            scene = EditorSceneManager.OpenScene(scenePath, OpenSceneMode.Single);
            Assert.That(AssetDatabase.AssetPathToGUID(scene.path), Is.EqualTo(sceneId));
            Assert.That(TeamForgeObjectIdentity.TryResolveGameObject(originalOwnerId, out originalOwner), Is.True);
            Assert.That(TeamForgeObjectIdentity.TryResolveGameObject(cubeId, out var reopenedCube), Is.True);
            Assert.That(TeamForgeObjectIdentity.TryResolveGameObject(remote.sphereObjectId, out var reopenedSphere), Is.True);
            Assert.That(reopenedCube.GetComponents<BoxCollider>(), Has.Length.EqualTo(1),
                "The saved primitive must reopen with its single exact native Collider.");
            Assert.That(reopenedSphere.GetComponents<SphereCollider>(), Has.Length.EqualTo(1));
            Assert.That(reopenedCube.GetComponent<MeshFilter>().sharedMesh, Is.Not.Null);
            Assert.That(reopenedSphere.GetComponent<MeshRenderer>().sharedMaterial, Is.Not.Null);
            TeamForgeConnectionService.Connect();
            yield return Wait(ConnectionReady, 30, "Shared primitive reconnect registry after real Scene reopen");
            Assert.That(TeamForgeColliderSyncService.JoinActiveScene(out error), Is.True, error);
            yield return Wait(() => CatalogReady(3), 30, "Reload saved primitive aliases and recover their exact catalog");
            cubeRow = FindRow(cubeColliderId); sphereRow = FindRow(remote.sphereComponentId);
            cube = ResolvePrimitiveOwner(cubeRow); sphere = ResolvePrimitiveOwner(sphereRow);
            AssertPrimitive(cube, cubeRow, "Cube"); AssertPrimitive(sphere, sphereRow, "Sphere");
            Assert.That(Resolve<BoxCollider>(cubeRow).size, Is.EqualTo(new Vector3(2f, 3f, 4f)));
            Assert.That(Resolve<SphereCollider>(sphereRow).radius, Is.EqualTo(1.25f));
            Assert.That(cube.transform.localPosition, Is.EqualTo(cubePosition));
            Assert.That(cube.transform.localScale, Is.EqualTo(cubeScale));
            Assert.That(Quaternion.Angle(cube.transform.localRotation, Quaternion.Euler(0f, 30f, 0f)),
                Is.LessThan(0.01f));
            Selection.activeGameObject = cube;
            yield return Wait(OwnsSelectedLock, 15, "Shared Cube deletion lease");
            Assert.That(TeamForgeHierarchySyncService.DeleteSelectedSharedPrimitive(out error), Is.True, error);
            yield return Wait(() => CatalogReady(2) && FindRow(cubeColliderId) == null &&
                !TeamForgeObjectIdentity.TryResolveGameObject(cubeId, out _), 20,
                "Atomic shared Cube and Collider deletion");
            AssertPrimitive(sphere, FindRow(remote.sphereComponentId), "Sphere");
            Selection.activeGameObject = sphere;
            yield return Wait(OwnsSelectedLock, 15, "Shared Sphere deletion lease");
            Assert.That(TeamForgeHierarchySyncService.DeleteSelectedSharedPrimitive(out error), Is.True, error);
            yield return Wait(() => CatalogReady(1) && FindRow(remote.sphereComponentId) == null &&
                !TeamForgeObjectIdentity.TryResolveGameObject(remote.sphereObjectId, out _), 20,
                "Atomic shared Sphere and Collider deletion");
            Assert.That(FindRow(originalColliderId), Is.Not.Null);
            Assert.That(Resolve<SphereCollider>(FindRow(originalColliderId)).gameObject, Is.SameAs(originalOwner));
            Assert.That(originalOwner.GetComponents<Collider>(), Has.Length.EqualTo(1));
            Assert.That(EditorSceneManager.SaveScene(scene, scene.path), Is.True);
            _primitiveReconnectDelete = true;
        }

        private static TeamForgeColliderComponentCatalogRow NewlyCreatedPrimitive(HashSet<string> previous, string type)
        {
            TeamForgeColliderComponentCatalogRow found = null;
            foreach (var row in TeamForgeColliderSyncService.CatalogRows())
            {
                if (previous.Contains(row.componentId)) continue;
                Assert.That(found, Is.Null, "A primitive template must admit exactly one Collider.");
                Assert.That(row.typeName, Is.EqualTo(type));
                Assert.That(TeamForgeHierarchyIdentityRegistry.IsLogicalId(row.objectId), Is.True);
                Assert.That(TeamForgeColliderComponentCatalogRow.IsLogicalComponentId(row.componentId), Is.True);
                found = row;
            }
            Assert.That(found, Is.Not.Null);
            return found;
        }

        private static GameObject ResolvePrimitiveOwner(TeamForgeColliderComponentCatalogRow row)
        {
            Assert.That(row, Is.Not.Null);
            Assert.That(TeamForgeObjectIdentity.TryResolveGameObject(row.objectId, out var owner), Is.True);
            Assert.That(TeamForgeObjectIdentity.TryGetCollaborativeObjectId(owner, out var id), Is.True);
            Assert.That(id, Is.EqualTo(row.objectId));
            return owner;
        }

        private static void AssertPrimitive(GameObject owner, TeamForgeColliderComponentCatalogRow row, string meshName)
        {
            var filter = owner.GetComponent<MeshFilter>();
            var renderer = owner.GetComponent<MeshRenderer>();
            Assert.That(filter, Is.Not.Null, "A shared primitive must contain a real MeshFilter.");
            Assert.That(filter.sharedMesh, Is.Not.Null);
            Assert.That(filter.sharedMesh.vertexCount, Is.GreaterThan(0));
            var builtinMeshPath = meshName == "Cube" ? "Cube.fbx" : "New-Sphere.fbx";
            Assert.That(filter.sharedMesh, Is.EqualTo(Resources.GetBuiltinResource<Mesh>(builtinMeshPath)),
                "The primitive must reference the concrete built-in mesh.");
            Assert.That(renderer, Is.Not.Null, "A shared primitive must contain a real MeshRenderer.");
            Assert.That(renderer.enabled, Is.True);
            Assert.That(renderer.sharedMaterial, Is.Not.Null);
            Assert.That(renderer.sharedMaterial.shader, Is.Not.Null);
            Assert.That(owner.GetComponents<Collider>(), Has.Length.EqualTo(1));
            Assert.That(Resolve<Collider>(row).gameObject, Is.SameAs(owner));
            if (meshName == "Cube") Assert.That(owner.GetComponent<BoxCollider>(), Is.Not.Null);
            else Assert.That(owner.GetComponent<SphereCollider>(), Is.Not.Null);
        }

        private static bool HasTransformCommit(List<string> frames, string objectId, Vector3 position, Vector3 scale)
        {
            foreach (var json in frames)
            {
                var committed = JsonUtility.FromJson<PrimitiveTransformCommit>(json);
                if (committed != null && committed.objectId == objectId &&
                    committed.localPosition == position && committed.localScale == scale) return true;
            }
            return false;
        }

        private static int CountSceneObjects(Scene scene)
        {
            var count = 0;
            foreach (var root in scene.GetRootGameObjects())
                count += root.GetComponentsInChildren<Transform>(true).Length;
            return count;
        }

        private static void WriteFixtureRequest(string root, string scenePath,
            TeamForgeWp6SceneInventory.Snapshot inventory, TeamForgeWp6ComponentIdentity.Record initial,
            GameObject owner, bool primitiveEnabled)
        {
            var identities = new StringBuilder(); var properties = new StringBuilder();
            foreach (var observation in inventory.Observations)
            {
                if (identities.Length > 0) identities.Append(',');
                identities.Append(JsonUtility.ToJson(new IdentityRow
                { objectId = observation.ObjectId, componentId = observation.ComponentId, typeName = observation.TypeName }));
                foreach (var property in observation.Properties)
                {
                    if (properties.Length > 0) properties.Append(',');
                    properties.Append(TeamForgeColliderProperty.FromObservation(observation, property).ToWireJson(false));
                }
            }
            var json = JsonUtility.ToJson(new FixtureRequest
            {
                scenePath = scenePath, sceneId = inventory.SceneId,
                objectId = initial.ObjectId, unityVersion = Application.unityVersion,
                ownerName = owner.name, localPosition = owner.transform.localPosition,
                localRotation = owner.transform.localRotation, localScale = owner.transform.localScale,
                primitiveEnabled = primitiveEnabled,
            });
            json = json.Substring(0, json.Length - 1) + ",\"components\":[" + identities +
                "],\"properties\":[" + properties + "]}";
            WriteAtomic(Path.Combine(root, "request.json"), json);
        }

        private static HashSet<string> CatalogIds()
        {
            var ids = new HashSet<string>(StringComparer.Ordinal);
            foreach (var row in TeamForgeColliderSyncService.CatalogRows()) ids.Add(row.componentId);
            return ids;
        }

        private static TeamForgeColliderComponentCatalogRow NewlyAdded(HashSet<string> previous, string type, string owner)
        {
            TeamForgeColliderComponentCatalogRow found = null;
            foreach (var row in TeamForgeColliderSyncService.CatalogRows())
            {
                if (previous.Contains(row.componentId)) continue;
                Assert.That(found, Is.Null, "Exactly one catalog entry must be added per accepted operation.");
                Assert.That(row.typeName, Is.EqualTo(type));
                Assert.That(row.objectId, Is.EqualTo(owner));
                Assert.That(TeamForgeColliderComponentCatalogRow.IsLogicalComponentId(row.componentId), Is.True);
                found = row;
            }
            Assert.That(found, Is.Not.Null);
            return found;
        }

        private static TeamForgeColliderComponentCatalogRow FindRow(string componentId)
        {
            foreach (var row in TeamForgeColliderSyncService.CatalogRows())
                if (row.componentId == componentId) return row;
            return null;
        }

        private static T Resolve<T>(TeamForgeColliderComponentCatalogRow row) where T : Component
        {
            Assert.That(row, Is.Not.Null, "The expected canonical Component must be in the current catalog.");
            Assert.That(TeamForgeColliderComponentBindings.TryResolve(row.sceneId, row.objectId,
                row.componentId, row.typeName, out var component, out var error), Is.True, error);
            var target = component as T;
            Assert.That(target, Is.Not.Null, "The logical Component must resolve to the exact allowlisted native type.");
            return target;
        }

        private static bool CatalogReady(int count) => TeamForgeColliderSyncService.Ready &&
            !TeamForgeColliderSyncService.Pending && TeamForgeColliderSyncService.CatalogRows().Count == count;

        private bool ConnectionReady() => TeamForgeConnectionService.State == TeamForgeConnectionState.Connected &&
            TeamForgeConnectionService.ComponentPropertySyncAvailable && TeamForgeConnectionService.ComponentStructureSyncAvailable &&
            (!_primitiveEnabled || TeamForgeConnectionService.PrimitiveTemplateSyncAvailable) &&
            TeamForgeProjectService.RegistrySnapshotReceived && TeamForgeHierarchySyncService.SnapshotReady;

        private static bool OwnsSelectedLock() => TeamForgeTransformSyncService.TryGetSelectedLock(out var lease) &&
            lease.ownerConnectionId == TeamForgeConnectionService.ConnectionId;

        private static void BeginCleanupDisconnect()
        {
            if (TeamForgeConnectionService.State != TeamForgeConnectionState.Disconnecting &&
                TeamForgeConnectionService.State != TeamForgeConnectionState.Disconnected)
                TeamForgeConnectionService.Disconnect();
        }

        private IEnumerator Wait(Func<bool> predicate, double seconds, string step)
        {
            var until = EditorApplication.timeSinceStartup + seconds;
            while (!predicate() && EditorApplication.timeSinceStartup < until) yield return null;
            _diagnostics = step + " | " + TeamForgeConnectionService.State + " | " +
                TeamForgeColliderSyncService.Status + " | pending=" + TeamForgeColliderSyncService.Pending +
                " ready=" + TeamForgeColliderSyncService.Ready + " catalog=" + TeamForgeColliderSyncService.CatalogRows().Count;
            Assert.That(predicate(), Is.True, _diagnostics + " | " + TeamForgeConnectionService.LastError);
        }

        private static void WriteAtomic(string path, string json)
        {
            var temporary = path + ".tmp";
            File.WriteAllText(temporary, json, new UTF8Encoding(false));
            if (File.Exists(path)) File.Delete(path);
            File.Move(temporary, path);
        }

        [Serializable] private sealed class FixtureRequest
        {
            public string scenePath; public string sceneId; public string objectId; public string unityVersion;
            public string ownerName; public Vector3 localPosition; public Quaternion localRotation; public Vector3 localScale;
            public bool primitiveEnabled;
        }
        [Serializable] private sealed class IdentityRow
        { public string objectId; public string componentId; public string typeName; }
        [Serializable] private sealed class FixtureReady
        {
            public string serverAddress; public string projectId; public string sessionId;
            public TeamForgeProjectDescriptor descriptor; public string sourceSha;
            public string lateJoinOwnerName; public Vector3 lateJoinLocalPosition; public long lateJoinServerRevision;
            public bool primitiveEnabled;
        }
        [Serializable] private sealed class FixturePhase
        { public string phase; public string sceneId; public string objectId; public string componentId; }
        [Serializable] private sealed class HeldAcknowledgement
        { public string componentId; public string operationId; public long serverRevision; }
        [Serializable] private sealed class PeerResult
        { public bool remoteCommitted; public string addedComponentId; }
        [Serializable] private sealed class PrimitivePeerResult
        {
            public bool primitiveVerified; public string cubeObjectId; public string cubeComponentId;
            public string sphereObjectId; public string sphereComponentId; public long serverRevision;
        }
        [Serializable] private sealed class PrimitiveTransformCommit
        { public string objectId; public Vector3 localPosition; public Vector3 localScale; }
        [Serializable] private sealed class FixtureResult
        {
            public bool passed; public string sourceSha; public string unityVersion;
            public int editorCount; public int nodePeerCount;
            public bool logicalAddRemove; public bool multipleSameType; public bool propertyEdit;
            public bool saveReopenBinding; public bool conditionalUndoRedo; public bool reconnectRecovery;
            public bool pendingAckLossRecovery; public string diagnostics;
            public bool primitiveCreate; public bool primitiveRemoteApply; public bool primitiveColliderEdit;
            public bool primitiveReconnectDelete;
        }
    }
}

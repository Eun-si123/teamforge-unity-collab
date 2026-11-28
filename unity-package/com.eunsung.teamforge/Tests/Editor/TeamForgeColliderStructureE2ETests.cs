using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
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
        private const string InterruptedOwnerName = "M4 unconfirmed name before disconnect";
        private const string RecoveredOwnerName = "M4 reviewed local Hierarchy name";
        private static readonly Vector3 RecoveredChildPosition = new Vector3(0.25f, 0.5f, 0.75f);
        private CleanupState _cleanup;
        private string _diagnostics = string.Empty;
        private string _sourceSha = string.Empty;
        private bool _primitiveEnabled;
        private bool _primitiveCreate;
        private bool _primitiveRemoteApply;
        private bool _primitiveColliderEdit;
        private bool _primitiveReconnectDelete;
        private bool _durableEnabled;
        private bool _durableRestartVerified;
        private bool _durableTransformEnabled;
        private bool _durableTransformVerified;
        private bool _durableHierarchyEnabled;
        private bool _durableHierarchyVerified;
        private bool _durableReparentEnabled;
        private bool _durableReparentVerified;
        private bool _durableSiblingEnabled;
        private bool _durableSiblingVerified;
        private bool _durableDeleteVerified;

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
                if (string.Equals(argument, "-teamforgeDurableE2E", StringComparison.OrdinalIgnoreCase))
                    _durableEnabled = true;
                if (string.Equals(argument, "-teamforgeDurableTransformE2E", StringComparison.OrdinalIgnoreCase))
                    _durableTransformEnabled = true;
                if (string.Equals(argument, "-teamforgeDurableHierarchyE2E", StringComparison.OrdinalIgnoreCase))
                    _durableHierarchyEnabled = true;
                if (string.Equals(argument, "-teamforgeDurableReparentE2E", StringComparison.OrdinalIgnoreCase))
                    _durableReparentEnabled = true;
                if (string.Equals(argument, "-teamforgeDurableSiblingE2E", StringComparison.OrdinalIgnoreCase))
                    _durableSiblingEnabled = true;
            }
            if (!enabled)
                Assert.Ignore("Production Collider lifecycle E2E requires its Node fixture and -teamforgeComponentStructureE2E.");
            Assert.That(!_durableEnabled || _primitiveEnabled, Is.True,
                "Durable restart E2E requires the full shared primitive E2E.");
            Assert.That(!_durableTransformEnabled || _durableEnabled, Is.True,
                "Transform recovery E2E requires durable restart E2E.");
            Assert.That(!_durableHierarchyEnabled || _durableTransformEnabled, Is.True,
                "Hierarchy recovery E2E requires the full durable recovery sequence.");
            Assert.That(!_durableReparentEnabled || _durableHierarchyEnabled, Is.True,
                "Reparent recovery E2E requires the full durable recovery sequence.");
            Assert.That(!_durableSiblingEnabled || _durableReparentEnabled, Is.True,
                "Sibling recovery E2E follows restored root placement.");
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
            var appliedRenames = new List<HierarchyAppliedMessage>();
            var appliedPlacements = new List<HierarchyAppliedMessage>();
            Action<string, string> capture = (type, json) =>
            {
                if (type == "component_property_applied") appliedProperties.Add(json);
            };
            Action<string, string> captureTransform = (type, json) =>
            {
                if (type == "transform_applied") appliedTransforms.Add(json);
            };
            Action<string, string> captureHierarchy = (type, json) =>
            {
                if (!_durableHierarchyEnabled || type != "hierarchy_applied") return;
                var applied = JsonUtility.FromJson<HierarchyAppliedMessage>(json);
                if (applied.kind == "rename_object" && !applied.replayed) appliedRenames.Add(applied);
                if (_durableReparentEnabled && applied.kind == "reparent_object" && !applied.replayed)
                    appliedPlacements.Add(applied);
                if (_durableSiblingEnabled && applied.kind == "reorder_sibling" && !applied.replayed)
                    appliedPlacements.Add(applied);
            };
            TeamForgeConnectionService.ComponentMessageReceived += capture;
            TeamForgeConnectionService.TransformMessageReceived += captureTransform;
            TeamForgeConnectionService.HierarchyMessageReceived += captureHierarchy;
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
                WriteFixtureRequest(fixtureRoot, scenePath, inventory, initialIdentity, owner,
                    _primitiveEnabled, _durableEnabled, _durableTransformEnabled, _durableHierarchyEnabled, _durableReparentEnabled,
                    _durableSiblingEnabled);
                var readyPath = Path.Combine(fixtureRoot, "ready.json");
                yield return Wait(() => File.Exists(readyPath), 90, "M2 signed real Scene publication");
                var ready = JsonUtility.FromJson<FixtureReady>(File.ReadAllText(readyPath));
                Assert.That(ready, Is.Not.Null);
                Assert.That(ready.serverAddress, Is.EqualTo("http://127.0.0.1:5084"));
                Assert.That(ready.lateJoinServerRevision, Is.GreaterThan(0));
                Assert.That(ready.primitiveEnabled, Is.EqualTo(_primitiveEnabled),
                    "The Node fixture and real Editor must exercise the same negotiated feature scope.");
                Assert.That(ready.durableEnabled, Is.EqualTo(_durableEnabled));
                Assert.That(ready.durableTransformEnabled, Is.EqualTo(_durableTransformEnabled));
                Assert.That(ready.durableHierarchyEnabled, Is.EqualTo(_durableHierarchyEnabled));
                Assert.That(ready.durableReparentEnabled, Is.EqualTo(_durableReparentEnabled));
                Assert.That(ready.durableSiblingEnabled, Is.EqualTo(_durableSiblingEnabled));
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
                if (_durableEnabled)
                {
                    Assert.That(TeamForgeConnectionService.AuthorityEpoch, Is.EqualTo(ready.authorityEpoch));
                    Assert.That(TeamForgeConnectionService.DurableSessionId, Is.EqualTo(ready.durableSessionId));
                }
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
                        fixtureRoot, appliedProperties, appliedTransforms, appliedRenames, appliedPlacements);
                passed = true;
                WriteAtomic(Path.Combine(fixtureRoot, "result.json"), JsonUtility.ToJson(new FixtureResult
                {
                    passed = true, sourceSha = _sourceSha, unityVersion = Application.unityVersion,
                    editorCount = 1, nodePeerCount = 1, logicalAddRemove = true, multipleSameType = true,
                    propertyEdit = true, saveReopenBinding = true, conditionalUndoRedo = true,
                    reconnectRecovery = true, pendingAckLossRecovery = true, diagnostics = _diagnostics,
                    primitiveCreate = _primitiveCreate, primitiveRemoteApply = _primitiveRemoteApply,
                    primitiveColliderEdit = _primitiveColliderEdit, primitiveReconnectDelete = _primitiveReconnectDelete,
                    durableRestartVerified = _durableRestartVerified,
                    durableTransformVerified = _durableTransformVerified,
                    durableHierarchyVerified = _durableHierarchyVerified,
                    durableReparentVerified = _durableReparentVerified,
                    durableSiblingVerified = _durableSiblingVerified,
                    durableDeleteVerified = _durableDeleteVerified,
                }));
            }
            finally
            {
                TeamForgeConnectionService.ComponentMessageReceived -= capture;
                TeamForgeConnectionService.TransformMessageReceived -= captureTransform;
                TeamForgeConnectionService.HierarchyMessageReceived -= captureHierarchy;
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
                if (_durableTransformEnabled)
                    foreach (var row in TeamForgeTransformSyncService.RecoveryRows())
                        if (row.scenePath == cleanup.ScenePath)
                            Assert.That(TeamForgeTransformSyncService.DiscardRecovery(row.Key, out error), Is.True, error);
                if (_durableHierarchyEnabled)
                    foreach (var row in TeamForgeHierarchySyncService.RecoveryRenameRows())
                        if (row.scenePath == cleanup.ScenePath)
                            Assert.That(TeamForgeHierarchySyncService.DiscardRecoveryRename(row.Key, out error), Is.True, error);
                if (_durableReparentEnabled)
                    foreach (var row in TeamForgeHierarchySyncService.RecoveryReparentRows())
                        if (row.scenePath == cleanup.ScenePath)
                            Assert.That(TeamForgeHierarchySyncService.DiscardRecoveryReparent(row.Key, out error), Is.True, error);
                if (_durableSiblingEnabled)
                {
                    foreach (var row in TeamForgeHierarchySyncService.RecoverySiblingRows())
                        if (row.scenePath == cleanup.ScenePath)
                            Assert.That(TeamForgeHierarchySyncService.DiscardRecoverySibling(row.Key, out error), Is.True, error);
                    foreach (var row in TeamForgeHierarchySyncService.RecoveryPrimitiveDeletes())
                        if (row.scenePath == cleanup.ScenePath)
                            Assert.That(TeamForgeHierarchySyncService.DiscardRecoveryPrimitiveDelete(row.Key, out error), Is.True, error);
                }
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
            string originalColliderId, string fixtureRoot, List<string> appliedProperties, List<string> appliedTransforms,
            List<HierarchyAppliedMessage> appliedRenames, List<HierarchyAppliedMessage> appliedPlacements)
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
            var oldAuthorityEpoch = TeamForgeConnectionService.AuthorityEpoch;
            var durableSessionId = TeamForgeConnectionService.DurableSessionId;
            var savedObjectCount = CountSceneObjects(scene);
            Assert.That(TeamForgeObjectIdentity.TryGetCollaborativeObjectId(originalOwner, out var originalOwnerId), Is.True);
            var confirmedOwnerName = originalOwner.name;
            const float unconfirmedRadius = 2.5f;
            var unconfirmedPosition = new Vector3(6f, 1f, -2f);
            if (_durableTransformEnabled)
            {
                Selection.activeGameObject = cube;
                yield return Wait(OwnsSelectedLock, 15, "Cube lease before preserving an unsent Transform intent");
                Assert.That(cube.transform.localPosition, Is.EqualTo(cubePosition));
            }
            if (_durableEnabled)
            {
                Assert.That(EditorSceneManager.SaveScene(scene, scenePath), Is.True);
                yield return Wait(() => TeamForgeHierarchyIdentityRegistry.HasCurrentSavedAlias(cubeId, cube) &&
                    TeamForgeHierarchyIdentityRegistry.HasCurrentSavedAlias(remote.sphereObjectId, sphere), 10,
                    "Persist exact native aliases for both accepted primitives");
                if (!_durableTransformEnabled) Assert.That(Selection.activeObject, Is.Null);
                Assert.That(TeamForgeColliderSyncService.Pending, Is.False);
                if (_durableTransformEnabled) cube.transform.localPosition = unconfirmedPosition;
                if (_durableHierarchyEnabled) originalOwner.name = InterruptedOwnerName;
                if (_durableReparentEnabled)
                {
                    sphere.transform.SetParent(cube.transform, false);
                    sphere.transform.SetSiblingIndex(0);
                    sphere.transform.localPosition = RecoveredChildPosition;
                }
                Resolve<SphereCollider>(sphereRow).radius = unconfirmedRadius;
                EditorSceneManager.MarkSceneDirty(scene);
            }
            // Save while the approved owner bindings are active. No Editor
            // update runs between the unconfirmed value, save, and disconnect.
            Assert.That(EditorSceneManager.SaveScene(scene, scenePath), Is.True);
            Assert.That(TeamForgeColliderComponentBindings.RefreshSavedBindings(out error), Is.True, error);
            TeamForgeHierarchyIdentityRegistry.RefreshAndPersist();
            Assert.That(TeamForgeHierarchyIdentityRegistry.TryGetLogicalId(cube, out var savedCubeLogical), Is.True,
                "The accepted Cube must retain its live identity through save.");
            Assert.That(savedCubeLogical, Is.EqualTo(cubeId));
            Assert.That(TeamForgeObjectIdentity.TryGetGlobalObjectId(cube, out var savedCubeGlobal), Is.True,
                "Saving the Scene must give the native Cube a GlobalObjectId.");
            var aliasAfterSave = TeamForgeHierarchyIdentityRegistry.SavedAliasFor(cubeId);
            TeamForgeConnectionService.Disconnect();
            yield return Wait(() => TeamForgeConnectionService.State == TeamForgeConnectionState.Disconnected,
                10, "Last peer disconnect with both shared primitive templates");
            if (_durableEnabled)
            {
                Assert.That(FindRecovery(remote.sphereComponentId, "m_Radius"), Is.Not.Null);
                Assert.That(FindRecovery(remote.sphereComponentId, "m_Radius").Number, Is.EqualTo(unconfirmedRadius));
            }
            if (_durableTransformEnabled)
            {
                var unsent = FindTransformRecovery(sceneId, cubeId);
                Assert.That(unsent, Is.Not.Null, "Disconnect must preserve the selected Cube's unsent native pose.");
                Assert.That(unsent.desired.LocalPosition, Is.EqualTo(unconfirmedPosition));
                Assert.That(unsent.before.LocalPosition, Is.EqualTo(cubePosition));
                Assert.That(unsent.authorityEpoch, Is.EqualTo(oldAuthorityEpoch));
                Assert.That(unsent.scope.durableSessionId, Is.EqualTo(durableSessionId));
            }
            if (_durableHierarchyEnabled)
            {
                var archived = TeamForgeHierarchySyncService.RecoveryRenameRows().Single(
                    row => row.sceneId == sceneId && row.objectId == originalOwnerId);
                Assert.That(archived.beforeName, Is.EqualTo(confirmedOwnerName));
                Assert.That(archived.desiredName, Is.EqualTo(InterruptedOwnerName));
                var archivePath = Path.Combine(Directory.GetParent(Application.dataPath).FullName,
                    "Library", "TeamForge", "HierarchyRenameRecovery-v1.json");
                Assert.That(File.Exists(archivePath), Is.True, "Disconnect must write the archive to disk before recovery.");
                StringAssert.Contains(InterruptedOwnerName, File.ReadAllText(archivePath));
                originalOwner.name = RecoveredOwnerName;
                EditorSceneManager.MarkSceneDirty(scene);
                Assert.That(EditorSceneManager.SaveScene(scene, scenePath), Is.True);
            }
            if (_durableReparentEnabled)
            {
                var archived = TeamForgeHierarchySyncService.RecoveryReparentRows().Single(
                    row => row.sceneId == sceneId && row.objectId == remote.sphereObjectId);
                Assert.That(archived.before.parentObjectId, Is.Empty);
                Assert.That(archived.desired.parentObjectId, Is.EqualTo(cubeId));
                Assert.That(archived.desired.siblingIndex, Is.Zero);
                Assert.That(archived.desired.pose.LocalPosition, Is.EqualTo(RecoveredChildPosition));
                var archivePath = Path.Combine(Directory.GetParent(Application.dataPath).FullName,
                    "Library", "TeamForge", "HierarchyReparentRecovery-v1.json");
                Assert.That(File.Exists(archivePath), Is.True, "The unconfirmed placement must be saved before reconnect.");
            }
            using (TeamForgeTransformSyncService.SuppressSelectionLock()) Selection.activeObject = null;
            var aliasAfterDisconnect = TeamForgeHierarchyIdentityRegistry.SavedAliasFor(cubeId);
            TeamForgeHierarchyIdentityRegistry.ForgetLiveObject(cubeId);
            TeamForgeHierarchyIdentityRegistry.ForgetLiveObject(remote.sphereObjectId);
            TeamForgeColliderComponentBindings.ClearContext();
            var aliasAfterClearingLiveHints = TeamForgeHierarchyIdentityRegistry.SavedAliasFor(cubeId);
            scene = EditorSceneManager.OpenScene(scenePath, OpenSceneMode.Single);
            Assert.That(AssetDatabase.AssetPathToGUID(scene.path), Is.EqualTo(sceneId));
            Assert.That(TeamForgeObjectIdentity.TryResolveGameObject(originalOwnerId, out originalOwner), Is.True);
            if (_durableHierarchyEnabled)
                Assert.That(originalOwner.name, Is.EqualTo(RecoveredOwnerName),
                    "The reopened Scene still holds the unconfirmed local name before recovery.");
            Assert.That(TeamForgeObjectIdentity.TryResolveGameObject(savedCubeGlobal, out var savedCube), Is.True,
                "Unity must reopen the saved Cube by its direct GlobalObjectId.");
            Assert.That(TeamForgeObjectIdentity.TryResolveGameObject(cubeId, out var reopenedCube), Is.True,
                $"Stored Cube alias must resolve. Native={savedCubeGlobal}; saved={aliasAfterSave}; disconnected={aliasAfterDisconnect}; " +
                $"cleared={aliasAfterClearingLiveHints}; reopened={TeamForgeHierarchyIdentityRegistry.SavedAliasFor(cubeId)}");
            Assert.That(reopenedCube, Is.SameAs(savedCube));
            Assert.That(TeamForgeObjectIdentity.TryResolveGameObject(remote.sphereObjectId, out var reopenedSphere), Is.True,
                "The saved Sphere logical alias must resolve before connecting to the Coordinator.");
            if (_durableReparentEnabled)
            {
                Assert.That(reopenedSphere.transform.parent, Is.SameAs(reopenedCube.transform));
                Assert.That(reopenedSphere.transform.localPosition, Is.EqualTo(RecoveredChildPosition));
            }
            Assert.That(reopenedCube.GetComponents<BoxCollider>(), Has.Length.EqualTo(1),
                "The saved primitive must reopen with its single exact native Collider.");
            Assert.That(reopenedSphere.GetComponents<SphereCollider>(), Has.Length.EqualTo(1));
            if (_durableTransformEnabled)
                Assert.That(reopenedCube.transform.localPosition, Is.EqualTo(unconfirmedPosition));
            if (_durableEnabled)
                Assert.That(reopenedSphere.GetComponent<SphereCollider>().radius, Is.EqualTo(unconfirmedRadius),
                    "The reopened Scene contains the unconfirmed local value before recovery applies server state.");
            Assert.That(reopenedCube.GetComponent<MeshFilter>().sharedMesh, Is.Not.Null);
            Assert.That(reopenedSphere.GetComponent<MeshRenderer>().sharedMaterial, Is.Not.Null);
            DurableRestartResult restart = null;
            if (_durableEnabled)
            {
                WriteAtomic(Path.Combine(fixtureRoot, "phase.json"), JsonUtility.ToJson(new FixturePhase
                { phase = "durable-restart", sceneId = sceneId, objectId = cubeId, componentId = cubeColliderId }));
                var restartPath = Path.Combine(fixtureRoot, "durable-restart-result.json");
                yield return Wait(() => File.Exists(restartPath), 90, "Actual Node authority stop and SQLite restart");
                restart = JsonUtility.FromJson<DurableRestartResult>(File.ReadAllText(restartPath));
                Assert.That(restart.durableRestartVerified, Is.True);
                Assert.That(restart.sourceSha, Is.EqualTo(_sourceSha));
                Assert.That(restart.oldEpoch, Is.EqualTo(oldAuthorityEpoch));
                Assert.That(Guid.TryParseExact(restart.newEpoch, "D", out var epoch) && epoch != Guid.Empty, Is.True);
                Assert.That(restart.newEpoch, Is.Not.EqualTo(oldAuthorityEpoch));
                Assert.That(restart.durableSessionId, Is.EqualTo(durableSessionId));
                Assert.That(restart.serverRevision, Is.GreaterThanOrEqualTo(remote.serverRevision));
                Assert.That(restart.cubeObjectId, Is.EqualTo(cubeId));
                Assert.That(restart.cubeComponentId, Is.EqualTo(cubeColliderId));
                Assert.That(restart.sphereObjectId, Is.EqualTo(remote.sphereObjectId));
                Assert.That(restart.sphereComponentId, Is.EqualTo(remote.sphereComponentId));
            }
            TeamForgeConnectionService.Connect();
            yield return Wait(ConnectionReady, 30, "Shared primitive reconnect registry after real Scene reopen");
            Assert.That(TeamForgeColliderSyncService.JoinActiveScene(out error), Is.True, error);
            yield return Wait(() => CatalogReady(3), 30, "Reload saved primitive aliases and recover their exact catalog");
            cubeRow = FindRow(cubeColliderId); sphereRow = FindRow(remote.sphereComponentId);
            cube = ResolvePrimitiveOwner(cubeRow); sphere = ResolvePrimitiveOwner(sphereRow);
            AssertPrimitive(cube, cubeRow, "Cube"); AssertPrimitive(sphere, sphereRow, "Sphere");
            Assert.That(Resolve<BoxCollider>(cubeRow).size, Is.EqualTo(new Vector3(2f, 3f, 4f)));
            Assert.That(Resolve<SphereCollider>(sphereRow).radius, Is.EqualTo(1.25f));
            if (_durableTransformEnabled)
            {
                var unsent = FindTransformRecovery(sceneId, cubeId);
                Assert.That(unsent, Is.Not.Null);
                Assert.That(unsent.desired.LocalPosition, Is.EqualTo(unconfirmedPosition));
                Assert.That(TeamForgeTransformSyncService.TryRecoveryShared(unsent.Key, out var shared, out _), Is.True);
                Assert.That(shared.LocalPosition, Is.EqualTo(cubePosition),
                    "The restarted authority retains the confirmed Transform separately from local unsent work.");
                Assert.That(TeamForgeTransformSyncService.RestoreSharedRecoveryTarget(unsent.Key, out error), Is.True, error);
                Assert.That(FindTransformRecovery(sceneId, cubeId).desired.LocalPosition, Is.EqualTo(unconfirmedPosition),
                    "Explicitly restoring the shared pose must retain the user's desired pose for review.");
            }
            Assert.That(cube.transform.localPosition, Is.EqualTo(cubePosition));
            Assert.That(cube.transform.localScale, Is.EqualTo(cubeScale));
            Assert.That(Quaternion.Angle(cube.transform.localRotation, Quaternion.Euler(0f, 30f, 0f)),
                Is.LessThan(0.01f));
            if (_durableEnabled)
            {
                Assert.That(TeamForgeConnectionService.AuthorityEpoch, Is.EqualTo(restart.newEpoch));
                Assert.That(TeamForgeConnectionService.AuthorityEpoch, Is.Not.EqualTo(oldAuthorityEpoch));
                Assert.That(TeamForgeConnectionService.DurableSessionId, Is.EqualTo(durableSessionId));
                Assert.That(cube, Is.SameAs(reopenedCube));
                Assert.That(sphere, Is.SameAs(reopenedSphere));
                Assert.That(CountSceneObjects(scene), Is.EqualTo(savedObjectCount),
                    "Durable recovery must reuse the saved native owners rather than duplicate primitives.");
                var recovered = FindRecovery(remote.sphereComponentId, "m_Radius");
                Assert.That(recovered, Is.Not.Null,
                    "Restoring the confirmed radius must preserve the unconfirmed local intent for review.");
                Assert.That(recovered.Number, Is.EqualTo(unconfirmedRadius));
                Selection.activeGameObject = sphere;
                yield return Wait(OwnsSelectedLock, 15, "Fresh epoch lease for explicit recovery resubmission");
                propertiesBefore = appliedProperties.Count;
                Assert.That(TeamForgeColliderSyncService.ResubmitRecovery(recovered.Key), Is.True);
                yield return Wait(() => appliedProperties.Count > propertiesBefore && !TeamForgeColliderSyncService.Pending &&
                    Resolve<SphereCollider>(FindRow(remote.sphereComponentId)).radius == unconfirmedRadius,
                    20, "Explicit recovery commits the preserved Inspector value against the fresh authority");
                var committed = JsonUtility.FromJson<RecoveryPropertyCommit>(appliedProperties[appliedProperties.Count - 1]);
                Assert.That(committed.epoch, Is.EqualTo(restart.newEpoch));
                Assert.That(committed.objectId, Is.EqualTo(remote.sphereObjectId));
                Assert.That(committed.componentId, Is.EqualTo(remote.sphereComponentId));
                Assert.That(committed.propertyPath, Is.EqualTo("m_Radius"));
                Assert.That(committed.value, Is.EqualTo(unconfirmedRadius));
                Assert.That(committed.serverRevision, Is.GreaterThan(restart.serverRevision));
                Assert.That(FindRecovery(remote.sphereComponentId, "m_Radius"), Is.Null);
                WriteAtomic(Path.Combine(fixtureRoot, "phase.json"), JsonUtility.ToJson(new FixturePhase
                { phase = "durable-resubmit", sceneId = sceneId, objectId = remote.sphereObjectId,
                    componentId = remote.sphereComponentId }));
                var resubmitPath = Path.Combine(fixtureRoot, "durable-resubmit-result.json");
                yield return Wait(() => File.Exists(resubmitPath), 30, "Node independently verifies the recovered value commit");
                var resubmit = JsonUtility.FromJson<DurableResubmitResult>(File.ReadAllText(resubmitPath));
                Assert.That(resubmit.durableResubmitVerified, Is.True);
                Assert.That(resubmit.sourceSha, Is.EqualTo(_sourceSha));
                Assert.That(resubmit.authorityEpoch, Is.EqualTo(restart.newEpoch));
                Assert.That(resubmit.componentId, Is.EqualTo(remote.sphereComponentId));
                Assert.That(resubmit.value, Is.EqualTo(unconfirmedRadius));
                Assert.That(resubmit.serverRevision, Is.EqualTo(committed.serverRevision));
            }
            if (_durableTransformEnabled)
            {
                var unsent = FindTransformRecovery(sceneId, cubeId);
                Assert.That(unsent, Is.Not.Null);
                Assert.That(TeamForgeTransformSyncService.SelectRecoveryTarget(unsent.Key, out error), Is.True, error);
                Assert.That(TeamForgeTransformSyncService.RestoreSharedRecoveryTarget(unsent.Key, out error), Is.True, error);
                Assert.That(TeamForgeTransformSyncService.RequestSelectedLock(), Is.True);
                yield return Wait(OwnsSelectedLock, 15, "Fresh Cube lease for explicit Transform recovery");
                Assert.That(TeamForgeTransformSyncService.TryRecoveryShared(unsent.Key, out var shared,
                    out var reviewedRevision), Is.True);
                Assert.That(shared.LocalPosition, Is.EqualTo(cubePosition));
                var transformsBefore = appliedTransforms.Count;
                Assert.That(TeamForgeTransformSyncService.ResubmitRecovery(unsent.Key, reviewedRevision, out error), Is.True, error);
                var submitted = FindTransformRecovery(sceneId, cubeId);
                Assert.That(submitted, Is.Not.Null);
                Assert.That(submitted.authorityEpoch, Is.EqualTo(restart.newEpoch));
                Assert.That(submitted.operationId, Is.Not.Empty);
                var submittedOperationId = submitted.operationId;
                yield return Wait(() => appliedTransforms.Count > transformsBefore &&
                    HasTransformCommit(appliedTransforms, cubeId, unconfirmedPosition, cubeScale) &&
                    cube.transform.localPosition == unconfirmedPosition && FindTransformRecovery(sceneId, cubeId) == null,
                    20, "Reviewed Transform CAS commits under the restarted authority");
                var committed = JsonUtility.FromJson<PrimitiveTransformCommit>(appliedTransforms[appliedTransforms.Count - 1]);
                Assert.That(committed.operationId, Is.EqualTo(submittedOperationId));
                Assert.That(committed.objectId, Is.EqualTo(cubeId));
                Assert.That(committed.localPosition, Is.EqualTo(unconfirmedPosition));
                Assert.That(committed.serverRevision, Is.GreaterThan(reviewedRevision));
                WriteAtomic(Path.Combine(fixtureRoot, "phase.json"), JsonUtility.ToJson(new FixturePhase
                { phase = "durable-transform-resubmit", sceneId = sceneId, objectId = cubeId, componentId = cubeColliderId }));
                var transformPath = Path.Combine(fixtureRoot, "durable-transform-result.json");
                yield return Wait(() => File.Exists(transformPath), 30, "Node independently verifies the recovered Transform");
                var result = JsonUtility.FromJson<DurableTransformResult>(File.ReadAllText(transformPath));
                Assert.That(result.durableTransformVerified, Is.True);
                Assert.That(result.sourceSha, Is.EqualTo(_sourceSha));
                Assert.That(result.authorityEpoch, Is.EqualTo(restart.newEpoch));
                Assert.That(result.durableSessionId, Is.EqualTo(durableSessionId));
                Assert.That(result.objectId, Is.EqualTo(cubeId));
                Assert.That(result.localPosition, Is.EqualTo(unconfirmedPosition));
                Assert.That(result.localScale, Is.EqualTo(cubeScale));
                Assert.That(Quaternion.Angle(result.localRotation, Quaternion.Euler(0f, 30f, 0f)), Is.LessThan(0.01f));
                Assert.That(result.serverRevision, Is.EqualTo(committed.serverRevision));
                _durableTransformVerified = true;
            }
            if (_durableHierarchyEnabled)
                yield return ExerciseReviewedRename(sceneId, originalOwnerId, originalOwner, confirmedOwnerName,
                    restart, fixtureRoot, appliedRenames);
            if (_durableReparentEnabled)
                yield return ExerciseReviewedReparent(sceneId, remote.sphereObjectId, cubeId, sphere, cube,
                    restart, fixtureRoot, appliedPlacements);
            if (_durableSiblingEnabled)
            {
                yield return ExerciseReviewedSibling(scene, sceneId, originalOwnerId, cubeId, remote.sphereObjectId,
                    originalOwner, restart, fixtureRoot, appliedPlacements);
                scene = SceneManager.GetActiveScene();
                Assert.That(TeamForgeObjectIdentity.TryResolveGameObject(originalOwnerId, out originalOwner), Is.True);
                cube = ResolvePrimitiveOwner(FindRow(cubeColliderId));
                sphere = ResolvePrimitiveOwner(FindRow(remote.sphereComponentId));
            }
            if (_durableSiblingEnabled)
            {
                yield return ExerciseRecoveredPrimitiveDelete(scene, sceneId, cube, cubeId, cubeColliderId, restart, fixtureRoot);
                scene = SceneManager.GetActiveScene();
                Assert.That(TeamForgeObjectIdentity.TryResolveGameObject(originalOwnerId, out originalOwner), Is.True);
                sphere = ResolvePrimitiveOwner(FindRow(remote.sphereComponentId));
            }
            else
            {
                Selection.activeGameObject = cube;
                yield return Wait(OwnsSelectedLock, 15, "Shared Cube deletion lease");
                Assert.That(TeamForgeHierarchySyncService.DeleteSelectedSharedPrimitive(out error), Is.True, error);
                yield return Wait(() => CatalogReady(2) && FindRow(cubeColliderId) == null &&
                    !TeamForgeObjectIdentity.TryResolveGameObject(cubeId, out _), 20,
                    "Atomic shared Cube and Collider deletion");
            }
            AssertPrimitive(sphere, FindRow(remote.sphereComponentId), "Sphere");
            Assert.That(Resolve<SphereCollider>(FindRow(remote.sphereComponentId)).radius,
                Is.EqualTo(_durableEnabled ? unconfirmedRadius : 1.25f));
            Selection.activeGameObject = sphere;
            yield return Wait(OwnsSelectedLock, 15, "Shared Sphere deletion lease");
            Assert.That(TeamForgeHierarchySyncService.DeleteSelectedSharedPrimitive(out error), Is.True, error);
            yield return Wait(() => CatalogReady(1) && FindRow(remote.sphereComponentId) == null &&
                !TeamForgeObjectIdentity.TryResolveGameObject(remote.sphereObjectId, out _), 20,
                "Atomic shared Sphere and Collider deletion");
            Assert.That(FindRow(originalColliderId), Is.Not.Null);
            Assert.That(Resolve<SphereCollider>(FindRow(originalColliderId)).gameObject, Is.SameAs(originalOwner));
            Assert.That(originalOwner.GetComponents<Collider>(), Has.Length.EqualTo(1));

            // Exercise the actual Unity GameObject > 3D Object > Cube creation
            // path, without invoking the TeamForge-specific M3 menu. The
            // existing local Cube/Collider must survive the signed M3 ack.
            var nativeIds = CatalogIds();
            var nativeCube = GameObject.CreatePrimitive(PrimitiveType.Cube);
            var nativeBox = nativeCube.GetComponent<BoxCollider>();
            Assert.That(nativeBox, Is.Not.Null);
            Assert.That(TeamForgePrimitiveTemplateRuntime.TryIdentifyNativeDefault(
                nativeCube, out var nativeTemplate), Is.True);
            Assert.That(nativeTemplate, Is.EqualTo(TeamForgePrimitiveTemplateRuntime.Cube));
            EditorSceneManager.MarkSceneDirty(scene);
            yield return Wait(() => CatalogReady(2), 20,
                "Normal Unity Cube creation receives signed M3 Component admission");
            var nativeRow = NewlyCreatedPrimitive(nativeIds, BoxType);
            Assert.That(ResolvePrimitiveOwner(nativeRow), Is.SameAs(nativeCube),
                "Approval must reuse the exact GameObject the user made through Unity.");
            Assert.That(Resolve<BoxCollider>(nativeRow), Is.SameAs(nativeBox),
                "Approved Collider identity must reuse the original native component, not create a duplicate.");
            Assert.That(nativeCube.GetComponents<BoxCollider>(), Has.Length.EqualTo(1));
            Assert.That(nativeCube.GetComponents<MeshRenderer>(), Has.Length.EqualTo(1));
            Selection.activeGameObject = nativeCube;
            yield return Wait(OwnsSelectedLock, 15, "Native Unity Cube exact shared deletion lease");
            Assert.That(TeamForgeHierarchySyncService.DeleteSelectedSharedPrimitive(out error), Is.True, error);
            yield return Wait(() => CatalogReady(1) && FindRow(nativeRow.componentId) == null &&
                !TeamForgeObjectIdentity.TryResolveGameObject(nativeRow.objectId, out _), 20,
                "Normal Unity Cube exact shared deletion after M3 adoption");
            Assert.That(originalOwner.GetComponents<Collider>(), Has.Length.EqualTo(1));
            Assert.That(EditorSceneManager.SaveScene(scene, scene.path), Is.True);
            _primitiveReconnectDelete = true;
            _durableRestartVerified = _durableEnabled;
        }

        private IEnumerator ExerciseReviewedRename(string sceneId, string objectId, GameObject target, string confirmedName,
            DurableRestartResult restart, string fixtureRoot, List<HierarchyAppliedMessage> appliedRenames)
        {
            var archived = TeamForgeHierarchySyncService.RecoveryRenameRows().Single(
                row => row.sceneId == sceneId && row.objectId == objectId);
            Assert.That(archived.desiredName, Is.EqualTo(RecoveredOwnerName));
            Assert.That(TeamForgeHierarchySyncService.TryRecoveryRenameShared(archived.Key, out var shared, out var revision), Is.True);
            Assert.That(shared, Is.EqualTo(confirmedName), "A reconnect must never submit the archived name automatically.");
            Assert.That(TeamForgeHierarchySyncService.SelectRecoveryRenameTarget(archived.Key, out var error), Is.True, error);
            Assert.That(TeamForgeHierarchySyncService.RestoreSharedRecoveryName(archived.Key, out error), Is.True, error);
            Assert.That(target.name, Is.EqualTo(confirmedName));
            Assert.That(TeamForgeHierarchySyncService.RecoveryRenameRows().Any(
                row => row.objectId == objectId && row.desiredName == RecoveredOwnerName), Is.True);
            yield return Wait(() => TeamForgeTransformSyncService.TrackedObject == target, 15,
                "The original owner becomes the explicitly selected lock target");
            Assert.That(TeamForgeTransformSyncService.RequestSelectedLock(), Is.True);
            yield return Wait(OwnsSelectedLock, 15, "Fresh original owner lease for explicit Hierarchy recovery");

            WriteAtomic(Path.Combine(fixtureRoot, "phase.json"), JsonUtility.ToJson(new FixturePhase
            { phase = "durable-hierarchy-before", sceneId = sceneId, objectId = objectId }));
            var readyPath = Path.Combine(fixtureRoot, "durable-hierarchy-ready.json");
            yield return Wait(() => File.Exists(readyPath), 30, "Node observes the confirmed name before explicit review");
            var before = JsonUtility.FromJson<DurableHierarchyResult>(File.ReadAllText(readyPath));
            Assert.That(before.name, Is.EqualTo(confirmedName));
            Assert.That(before.sourceSha, Is.EqualTo(_sourceSha));
            Assert.That(before.authorityEpoch, Is.EqualTo(restart.newEpoch));
            Assert.That(before.objectId, Is.EqualTo(objectId));
            Assert.That(before.hierarchyRevision, Is.EqualTo(revision));

            var renameCount = appliedRenames.Count;
            Assert.That(TeamForgeHierarchySyncService.ResubmitRecoveryRename(archived.Key, revision, out error), Is.True, error);
            yield return Wait(() => appliedRenames.Count == renameCount + 1 && target.name == RecoveredOwnerName &&
                !TeamForgeHierarchySyncService.RecoveryRenameRows().Any(row => row.objectId == objectId),
                20, "Reviewed Hierarchy rename commits and applies to the same native owner");
            var committed = appliedRenames[renameCount];
            Assert.That(committed.objectId, Is.EqualTo(objectId));
            Assert.That(committed.sceneId, Is.EqualTo(sceneId));
            Assert.That(committed.serverRevision, Is.GreaterThan(before.serverRevision));
            Assert.That(committed.changedObjects, Has.Length.EqualTo(1));
            Assert.That(committed.changedObjects[0].name, Is.EqualTo(RecoveredOwnerName));

            var resultPath = Path.Combine(fixtureRoot, "durable-hierarchy-result.json");
            yield return Wait(() => File.Exists(resultPath), 30, "Node verifies the reviewed rename broadcast and shared snapshot");
            var result = JsonUtility.FromJson<DurableHierarchyResult>(File.ReadAllText(resultPath));
            Assert.That(result.durableHierarchyVerified, Is.True);
            Assert.That(result.sourceSha, Is.EqualTo(_sourceSha));
            Assert.That(result.authorityEpoch, Is.EqualTo(restart.newEpoch));
            Assert.That(result.durableSessionId, Is.EqualTo(restart.durableSessionId));
            Assert.That(result.objectId, Is.EqualTo(objectId));
            Assert.That(result.name, Is.EqualTo(RecoveredOwnerName));
            Assert.That(result.operationId, Is.EqualTo(committed.operationId));
            Assert.That(result.serverRevision, Is.EqualTo(committed.serverRevision));
            _durableHierarchyVerified = true;
        }

        private IEnumerator ExerciseReviewedReparent(string sceneId, string childId, string parentId, GameObject child,
            GameObject parent, DurableRestartResult restart, string fixtureRoot, List<HierarchyAppliedMessage> appliedReparents)
        {
            var archived = TeamForgeHierarchySyncService.RecoveryReparentRows().Single(
                row => row.sceneId == sceneId && row.objectId == childId);
            Assert.That(archived.desired.parentObjectId, Is.EqualTo(parentId));
            Assert.That(archived.desired.pose.LocalPosition, Is.EqualTo(RecoveredChildPosition));
            Assert.That(TeamForgeHierarchySyncService.RestoreSharedRecoveryPlacement(archived.Key, out var error), Is.True, error);
            Assert.That(child.transform.parent, Is.Null);
            var confirmedPosition = child.transform.localPosition;
            var parentPosition = parent.transform.localPosition;
            Assert.That(TeamForgeHierarchySyncService.SelectRecoveryReparentTarget(archived.Key, out error), Is.True, error);
            yield return Wait(() => TeamForgeTransformSyncService.TrackedObject == child, 15,
                "The recovered placement target becomes the selected lock target");
            Assert.That(TeamForgeTransformSyncService.RequestSelectedLock(), Is.True);
            yield return Wait(OwnsSelectedLock, 15, "Fresh child lease for explicit placement recovery");

            WriteAtomic(Path.Combine(fixtureRoot, "phase.json"), JsonUtility.ToJson(new FixturePhase
            { phase = "durable-reparent-before", sceneId = sceneId, objectId = childId }));
            var readyPath = Path.Combine(fixtureRoot, "durable-reparent-ready.json");
            yield return Wait(() => File.Exists(readyPath), 30, "Node observes the confirmed root before review");
            var before = JsonUtility.FromJson<DurableReparentResult>(File.ReadAllText(readyPath));
            Assert.That(before.sourceSha, Is.EqualTo(_sourceSha));
            Assert.That(before.authorityEpoch, Is.EqualTo(restart.newEpoch));
            Assert.That(before.durableSessionId, Is.EqualTo(restart.durableSessionId));
            Assert.That(before.objectId, Is.EqualTo(childId));
            Assert.That(before.parentObjectId, Is.Empty);
            Assert.That(before.localPosition, Is.EqualTo(confirmedPosition));
            Assert.That(TeamForgeHierarchySyncService.TryRecoveryReparentShared(archived.Key, out var shared,
                out var reviewedSessionRevision, out var reviewedTransformRevision), Is.True);
            Assert.That(shared.ParentObjectId, Is.Empty);
            Assert.That(shared.HierarchyRevision, Is.EqualTo(before.hierarchyRevision));
            Assert.That(reviewedSessionRevision, Is.EqualTo(before.serverRevision));
            Assert.That(reviewedTransformRevision, Is.EqualTo(before.transformRevision));

            var appliedBefore = appliedReparents.Count;
            Assert.That(TeamForgeHierarchySyncService.ResubmitRecoveryReparent(archived.Key,
                reviewedSessionRevision, shared.HierarchyRevision, reviewedTransformRevision, out error), Is.True, error);
            yield return Wait(() => appliedReparents.Count == appliedBefore + 1 && child.transform.parent == parent.transform &&
                child.transform.localPosition == RecoveredChildPosition &&
                !TeamForgeHierarchySyncService.RecoveryReparentRows().Any(row => row.objectId == childId),
                25, "Reviewed placement commits to the same native child and exact parent");
            var committed = appliedReparents[appliedBefore];
            var accepted = committed.changedObjects.Single(row => row.objectId == childId);
            Assert.That(accepted.parentObjectId, Is.EqualTo(parentId));
            Assert.That(accepted.siblingIndex, Is.Zero);
            Assert.That(parent.transform.localPosition, Is.EqualTo(parentPosition), "The parent pose survives the child move.");
            var resultPath = Path.Combine(fixtureRoot, "durable-reparent-result.json");
            yield return Wait(() => File.Exists(resultPath), 30, "Node checks the placement broadcast and a fresh snapshot");
            var result = JsonUtility.FromJson<DurableReparentResult>(File.ReadAllText(resultPath));
            Assert.That(result.durableReparentVerified, Is.True);
            Assert.That(result.sourceSha, Is.EqualTo(_sourceSha));
            Assert.That(result.authorityEpoch, Is.EqualTo(restart.newEpoch));
            Assert.That(result.durableSessionId, Is.EqualTo(restart.durableSessionId));
            Assert.That(result.objectId, Is.EqualTo(childId));
            Assert.That(result.parentObjectId, Is.EqualTo(parentId));
            Assert.That(result.localPosition, Is.EqualTo(RecoveredChildPosition));
            Assert.That(result.operationId, Is.EqualTo(committed.operationId));
            Assert.That(result.serverRevision, Is.EqualTo(committed.serverRevision));
            _durableReparentVerified = true;

            // Return the Sphere to the Scene root through the normal live
            // operation so both existing primitive deletion checks still run.
            child.transform.SetParent(null, false);
            child.transform.localPosition = confirmedPosition;
            child.transform.SetAsLastSibling();
            EditorSceneManager.MarkSceneDirty(child.scene);
            yield return Wait(() => appliedReparents.Count == appliedBefore + 2 &&
                !TeamForgeHierarchySyncService.HasPendingOperation, 20, "Normal live reparent restores the Sphere to the root");
            Assert.That(appliedReparents[appliedBefore + 1].changedObjects.Single(row => row.objectId == childId).parentObjectId,
                Is.Empty);
        }

        private IEnumerator ExerciseReviewedSibling(Scene scene, string sceneId, string ownerId, string cubeId,
            string sphereId, GameObject owner, DurableRestartResult restart, string fixtureRoot,
            List<HierarchyAppliedMessage> appliedPlacements)
        {
            var sharedOrder = new[] { ownerId, cubeId, sphereId };
            var draftOrder = new[] { cubeId, sphereId, ownerId };
            CollectionAssert.AreEqual(sharedOrder, RootIds(scene));
            Selection.activeGameObject = owner;
            yield return Wait(OwnsSelectedLock, 15, "Owner lease before the interrupted sibling order change");
            var committedCount = appliedPlacements.Count;
            owner.transform.SetAsLastSibling();
            EditorSceneManager.MarkSceneDirty(scene);
            var scenePath = scene.path;
            Assert.That(EditorSceneManager.SaveScene(scene, scenePath), Is.True);
            TeamForgeConnectionService.Disconnect();
            yield return Wait(() => TeamForgeConnectionService.State == TeamForgeConnectionState.Disconnected,
                15, "Disconnect before the native sibling order reaches the Coordinator");
            Assert.That(appliedPlacements, Has.Count.EqualTo(committedCount));
            var archived = TeamForgeHierarchySyncService.RecoverySiblingRows().Single(
                row => row.sceneId == sceneId && row.objectId == ownerId);
            Assert.That(archived.needsReview, Is.True);
            var archivePath = Path.Combine(Directory.GetCurrentDirectory(), "Library", "TeamForge", "HierarchySiblingRecovery-v1.json");
            var diskArchive = new TeamForgeHierarchySiblingRecoveryStore(archivePath);
            Assert.That(diskArchive.Load(out var error), Is.True, error);
            Assert.That(diskArchive.TryGet(archived.Key, out var onDisk), Is.True);
            Assert.That(onDisk.parentObjectId, Is.Empty);
            CollectionAssert.AreEqual(sharedOrder, onDisk.beforeOrder.Select(member => member.objectId));
            CollectionAssert.AreEqual(draftOrder, onDisk.desiredOrder.Select(member => member.objectId));
            using (TeamForgeTransformSyncService.SuppressSelectionLock()) Selection.activeObject = null;
            scene = EditorSceneManager.OpenScene(scenePath, OpenSceneMode.Single);
            CollectionAssert.AreEqual(draftOrder, RootIds(scene), "The local Scene retained the native draft order.");
            TeamForgeConnectionService.Connect();
            yield return Wait(ConnectionReady, 30, "Rejoin the same durable Session with a pending sibling order");
            Assert.That(TeamForgeConnectionService.AuthorityEpoch, Is.EqualTo(restart.newEpoch));
            Assert.That(TeamForgeConnectionService.DurableSessionId, Is.EqualTo(restart.durableSessionId));
            Assert.That(TeamForgeColliderSyncService.JoinActiveScene(out error), Is.True, error);
            yield return Wait(() => CatalogReady(3), 30, "Rejoin the same Collider catalog before reviewing sibling order");
            CollectionAssert.AreEqual(sharedOrder, RootIds(scene), "The archived order must await explicit review.");
            Assert.That(appliedPlacements, Has.Count.EqualTo(committedCount));
            Assert.That(TeamForgeObjectIdentity.TryResolveGameObject(ownerId, out owner), Is.True);
            var nativePoses = scene.GetRootGameObjects().ToDictionary(
                target => target, target => target.transform.localToWorldMatrix);
            Assert.That(TeamForgeHierarchySyncService.TryRecoverySiblingShared(archived.Key, out var shared, out var reviewRevision), Is.True);
            Assert.That(shared.SiblingIndex, Is.Zero);
            Assert.That(TeamForgeHierarchySyncService.RestoreSharedRecoverySiblingOrder(archived.Key, out error), Is.True, error);
            Assert.That(TeamForgeHierarchySyncService.SelectRecoverySiblingTarget(archived.Key, out error), Is.True, error);
            yield return Wait(() => TeamForgeTransformSyncService.TrackedObject == owner, 15, "Select the exact saved owner");
            Assert.That(TeamForgeHierarchySyncService.RequestRecoverySiblingLock(archived.Key, out error), Is.True, error);
            yield return Wait(OwnsSelectedLock, 15, "New owner lease for the reviewed sibling order");

            WriteAtomic(Path.Combine(fixtureRoot, "phase.json"), JsonUtility.ToJson(new FixturePhase
            { phase = "durable-sibling-before", sceneId = sceneId, objectId = ownerId }));
            var readyPath = Path.Combine(fixtureRoot, "durable-sibling-ready.json");
            yield return Wait(() => File.Exists(readyPath), 30, "Independent Node peer confirms the original order");
            var before = JsonUtility.FromJson<DurableSiblingResult>(File.ReadAllText(readyPath));
            Assert.That(before.sourceSha, Is.EqualTo(_sourceSha));
            Assert.That(before.authorityEpoch, Is.EqualTo(restart.newEpoch));
            Assert.That(before.durableSessionId, Is.EqualTo(restart.durableSessionId));
            Assert.That(before.objectId, Is.EqualTo(ownerId));
            Assert.That(before.serverRevision, Is.EqualTo(reviewRevision));
            Assert.That(before.hierarchyRevision, Is.EqualTo(shared.HierarchyRevision));
            CollectionAssert.AreEqual(sharedOrder, before.order);
            Assert.That(TeamForgeHierarchySyncService.ResubmitRecoverySibling(archived.Key,
                before.serverRevision - 1, before.hierarchyRevision, out _), Is.False);
            Assert.That(TeamForgeHierarchySyncService.RecoverySiblingRows().Any(row => row.Key == archived.Key), Is.True);
            Assert.That(TeamForgeHierarchySyncService.ResubmitRecoverySibling(archived.Key,
                before.serverRevision, before.hierarchyRevision, out error), Is.True, error);
            yield return Wait(() => appliedPlacements.Count == committedCount + 1 && RootIds(scene).SequenceEqual(draftOrder) &&
                !TeamForgeHierarchySyncService.RecoverySiblingRows().Any(row => row.Key == archived.Key),
                20, "A single reviewed sibling move applies to the exact native root group");
            var committed = appliedPlacements[committedCount];
            Assert.That(committed.kind, Is.EqualTo("reorder_sibling"));
            Assert.That(committed.objectId, Is.EqualTo(ownerId));
            Assert.That(committed.serverRevision, Is.EqualTo(before.serverRevision + 1));
            foreach (var entry in nativePoses)
                Assert.That(entry.Key.transform.localToWorldMatrix, Is.EqualTo(entry.Value));
            var resultPath = Path.Combine(fixtureRoot, "durable-sibling-result.json");
            yield return Wait(() => File.Exists(resultPath), 30, "Node independently verifies the reviewed order and retained poses");
            var result = JsonUtility.FromJson<DurableSiblingResult>(File.ReadAllText(resultPath));
            Assert.That(result.durableSiblingVerified, Is.True);
            Assert.That(result.transformUnchanged, Is.True);
            Assert.That(result.sourceSha, Is.EqualTo(_sourceSha));
            Assert.That(result.authorityEpoch, Is.EqualTo(restart.newEpoch));
            Assert.That(result.durableSessionId, Is.EqualTo(restart.durableSessionId));
            Assert.That(result.operationId, Is.EqualTo(committed.operationId));
            Assert.That(result.serverRevision, Is.EqualTo(committed.serverRevision));
            CollectionAssert.AreEqual(draftOrder, result.order);
            yield return ExerciseConcurrentSiblingDelete(scene, sceneId, cubeId, draftOrder, restart, fixtureRoot, appliedPlacements);
            _durableSiblingVerified = true;
        }

        private IEnumerator ExerciseConcurrentSiblingDelete(Scene scene, string sceneId, string movedId, string[] sharedOrder,
            DurableRestartResult restart, string fixtureRoot, List<HierarchyAppliedMessage> appliedPlacements)
        {
            WriteAtomic(Path.Combine(fixtureRoot, "phase.json"), JsonUtility.ToJson(new FixturePhase
            { phase = "durable-sibling-concurrent-arm", sceneId = sceneId, objectId = movedId }));
            var readyPath = Path.Combine(fixtureRoot, "durable-sibling-concurrent-ready.json");
            yield return Wait(() => File.Exists(readyPath), 30, "Node creates an ordinary last root and locks the first root");
            var before = JsonUtility.FromJson<DurableSiblingConcurrentResult>(File.ReadAllText(readyPath));
            Assert.That(before.movedObjectId, Is.EqualTo(movedId));
            yield return Wait(() => RootIds(scene).SequenceEqual(before.beforeOrder) &&
                TeamForgeAuthorityView.Current.Locks.TryGet(sceneId, movedId, out var lease) &&
                lease.ownerConnectionId != TeamForgeConnectionService.ConnectionId, 20, "Observe the exact root group and foreign mover lease");
            Assert.That(TeamForgeObjectIdentity.TryResolveGameObject(movedId, out var mover), Is.True);
            CollectionAssert.AreEqual(sharedOrder.Concat(new[] { before.deletedObjectId }), RootIds(scene));
            var committedCount = appliedPlacements.Count;
            mover.transform.SetAsLastSibling();
            CollectionAssert.AreEqual(before.draftOrder, RootIds(scene));
            WriteAtomic(Path.Combine(fixtureRoot, "phase.json"), JsonUtility.ToJson(new FixturePhase
            { phase = "durable-sibling-concurrent-delete", sceneId = sceneId, objectId = before.deletedObjectId }));
            var resultPath = Path.Combine(fixtureRoot, "durable-sibling-concurrent-result.json");
            yield return Wait(() => File.Exists(resultPath) && RootIds(scene).SequenceEqual(sharedOrder) &&
                TeamForgeHierarchySyncService.SnapshotReady, 30, "Restore the previous root order before applying Node's deletion");
            Assert.That(appliedPlacements, Has.Count.EqualTo(committedCount));
            Assert.That(TeamForgeObjectIdentity.TryResolveGameObject(before.deletedObjectId, out _), Is.False);
            var archived = TeamForgeHierarchySyncService.RecoverySiblingRows().Single(
                row => row.sceneId == sceneId && row.objectId == movedId);
            Assert.That(archived.needsReview, Is.True);
            CollectionAssert.AreEqual(before.beforeOrder, archived.beforeOrder.Select(member => member.objectId));
            CollectionAssert.AreEqual(before.draftOrder, archived.desiredOrder.Select(member => member.objectId));
            var result = JsonUtility.FromJson<DurableSiblingConcurrentResult>(File.ReadAllText(resultPath));
            Assert.That(result.sourceSha, Is.EqualTo(_sourceSha));
            Assert.That(result.authorityEpoch, Is.EqualTo(restart.newEpoch));
            Assert.That(result.durableSessionId, Is.EqualTo(restart.durableSessionId));
            Assert.That(result.serverRevision, Is.EqualTo(before.serverRevision + 1));
            CollectionAssert.AreEqual(sharedOrder, result.finalOrder);
            Assert.That(TeamForgeHierarchySyncService.TryRecoverySiblingShared(archived.Key, out var shared, out var revision), Is.True);
            Assert.That(TeamForgeHierarchySyncService.ResubmitRecoverySibling(archived.Key, revision, shared.HierarchyRevision, out _), Is.False,
                "The draft's roster has changed and its old destination index cannot be reused.");
            Assert.That(TeamForgeHierarchySyncService.DiscardRecoverySibling(archived.Key, out var error), Is.True, error);
        }

        private IEnumerator ExerciseRecoveredPrimitiveDelete(Scene scene, string sceneId, GameObject cube, string cubeId,
            string colliderId, DurableRestartResult restart, string fixtureRoot)
        {
            var scenePath = scene.path;
            Assert.That(EditorSceneManager.SaveScene(scene, scenePath), Is.True);
            TeamForgeConnectionService.Disconnect();
            yield return Wait(() => TeamForgeConnectionService.State == TeamForgeConnectionState.Disconnected,
                15, "Disconnect before recording a primitive deletion");
            using (TeamForgeTransformSyncService.SuppressSelectionLock()) Selection.activeGameObject = cube;
            var localChild = new GameObject("Local work outside the shared deletion");
            localChild.transform.SetParent(cube.transform, false);
            Assert.That(TeamForgeHierarchySyncService.DeleteSelectedSharedPrimitive(out _), Is.False);
            Assert.That(localChild.transform.parent, Is.EqualTo(cube.transform));
            UnityEngine.Object.DestroyImmediate(localChild);
            Assert.That(TeamForgeHierarchySyncService.DeleteSelectedSharedPrimitive(out var error), Is.True, error);
            Assert.That(TeamForgeHierarchySyncService.DeleteSelectedSharedPrimitive(out _), Is.False);
            Assert.That(cube.GetComponent<BoxCollider>(), Is.Not.Null);
            var archive = TeamForgeHierarchySyncService.RecoveryPrimitiveDeletes().Single(row => row.sceneId == sceneId && row.objectId == cubeId);
            var path = Path.Combine(Directory.GetCurrentDirectory(), "Library", "TeamForge", "PrimitiveDeleteRecovery-v1.json");
            var disk = new TeamForgePrimitiveDeleteRecoveryStore(path);
            Assert.That(disk.Load(out error), Is.True, error);
            Assert.That(disk.TryGet(archive.Key, out var saved), Is.True);
            Assert.That(saved.createdRevision, Is.EqualTo(archive.createdRevision));
            Assert.That(saved.CanDiscard, Is.True, "An offline draft can still be discarded before submission.");
            Assert.That(saved.scope.durableSessionId, Is.EqualTo(restart.durableSessionId));
            Assert.That(TeamForgeObjectIdentity.TryGetGlobalObjectId(cube, out var savedNativeId), Is.True);
            Assert.That(saved.savedObjectId, Is.EqualTo(savedNativeId));
            Assert.That(EditorSceneManager.SaveScene(scene, scenePath), Is.True);

            using (TeamForgeTransformSyncService.SuppressSelectionLock()) Selection.activeObject = null;
            EditorSceneManager.OpenScene(scenePath, OpenSceneMode.Single);
            TeamForgeConnectionService.Connect();
            yield return Wait(ConnectionReady, 30, "Reconnect with an offline deletion preserved");
            Assert.That(TeamForgeColliderSyncService.JoinActiveScene(out error), Is.True, error);
            yield return Wait(() => CatalogReady(3), 25, "Rejoin Collider collaboration before reviewing the deletion");
            cube = ResolvePrimitiveOwner(FindRow(colliderId));
            Assert.That(cube.GetComponent<BoxCollider>(), Is.Not.Null, "A preserved deletion must await review.");
            Assert.That(TeamForgeHierarchySyncService.TryRecoveryPrimitiveDeleteShared(archive.Key, out var shared, out var revision, out error), Is.True, error);
            Assert.That(shared.CreatedRevision, Is.EqualTo(archive.createdRevision));
            Assert.That(TeamForgeHierarchySyncService.SelectRecoveryPrimitiveDelete(archive.Key, out error), Is.True, error);
            yield return Wait(() => TeamForgeTransformSyncService.TrackedObject == cube, 15, "Select the exact preserved primitive");
            Assert.That(TeamForgeHierarchySyncService.RequestRecoveryPrimitiveDeleteLock(archive.Key, out error), Is.True, error);
            yield return Wait(OwnsSelectedLock, 15, "Acquire the new connection's primitive deletion lock");
            Assert.That(TeamForgeHierarchySyncService.ResubmitRecoveryPrimitiveDelete(archive.Key, revision - 1, out _), Is.False);

            WriteAtomic(Path.Combine(fixtureRoot, "phase.json"), JsonUtility.ToJson(new FixturePhase
            { phase = "durable-delete-before", sceneId = sceneId, objectId = cubeId, componentId = colliderId }));
            var beforePath = Path.Combine(fixtureRoot, "durable-delete-before.json");
            yield return Wait(() => File.Exists(beforePath), 25, "Independent peer observes the exact undeleted object and arms receipt loss");
            var before = JsonUtility.FromJson<DurableDeleteResult>(File.ReadAllText(beforePath));
            Assert.That(before.objectId, Is.EqualTo(cubeId));
            Assert.That(before.createdRevision, Is.EqualTo(archive.createdRevision));
            Assert.That(before.serverRevision, Is.EqualTo(revision));
            Assert.That(TeamForgeHierarchySyncService.ResubmitRecoveryPrimitiveDelete(archive.Key, revision, out error), Is.True, error);
            Assert.That(cube, Is.Not.Null, "The native primitive remains until authority acts.");
            var heldPath = Path.Combine(fixtureRoot, "durable-delete-held.json");
            var resultPath = Path.Combine(fixtureRoot, "durable-delete-result.json");
            yield return Wait(() => File.Exists(heldPath) && File.Exists(resultPath), 25, "Node verifies the committed deletion while the Editor receipts are held");
            var held = JsonUtility.FromJson<DurableDeleteResult>(File.ReadAllText(heldPath));
            var result = JsonUtility.FromJson<DurableDeleteResult>(File.ReadAllText(resultPath));
            Assert.That(result.sourceSha, Is.EqualTo(_sourceSha));
            Assert.That(result.authorityEpoch, Is.EqualTo(restart.newEpoch));
            Assert.That(result.durableSessionId, Is.EqualTo(restart.durableSessionId));
            Assert.That(held.operationId, Is.EqualTo(result.operationId));
            Assert.That(result.serverRevision, Is.EqualTo(revision + 1));
            Assert.That(held.serverRevision, Is.EqualTo(result.serverRevision));
            Assert.That(result.hierarchyTombstone && result.colliderTombstone, Is.True);
            Assert.That(cube.GetComponent<BoxCollider>(), Is.Not.Null);
            Assert.That(TeamForgeHierarchySyncService.RecoveryPrimitiveDeletes().Any(row => row.Key == archive.Key), Is.True);

            TeamForgeConnectionService.Disconnect();
            yield return Wait(() => TeamForgeConnectionService.State == TeamForgeConnectionState.Disconnected,
                15, "Disconnect without receiving the committed deletion");
            Assert.That(disk.Load(out error), Is.True, error);
            Assert.That(disk.TryGet(archive.Key, out var submitted), Is.True);
            Assert.That(submitted.CanDiscard, Is.False, "Submit must persist the recovery guard before sending.");
            Assert.That(TeamForgeHierarchySyncService.DiscardRecoveryPrimitiveDelete(archive.Key, out error), Is.False);
            Assert.That(error, Does.Contain("may already have been submitted"));

            // The disk row describes the submitted native identities and values. An old
            // inbox row is still readable but cannot approve a destructive reconciliation.
            Assert.That(TeamForgeHierarchySyncService.MatchesReviewedColliders(saved, cube, out error), Is.True, error);
            var legacy = saved.Copy();
            legacy.colliderDigest = null;
            Assert.That(TeamForgeHierarchySyncService.MatchesReviewedColliders(legacy, cube, out _), Is.False);
            var originalBox = cube.GetComponent<BoxCollider>();
            var originalSize = originalBox.size;
            originalBox.size = originalSize + Vector3.one;
            Assert.That(TeamForgeHierarchySyncService.MatchesReviewedColliders(saved, cube, out _), Is.False);
            originalBox.size = originalSize;

            // Even a replacement with the exact same serialized properties has a different native identity.
            var originalEntityId = originalBox.GetEntityId();
            var originalCenter = originalBox.center;
            var originalTrigger = originalBox.isTrigger;
            UnityEngine.Object.DestroyImmediate(originalBox);
            var replacementBox = cube.AddComponent<BoxCollider>();
            replacementBox.size = originalSize;
            replacementBox.center = originalCenter;
            replacementBox.isTrigger = originalTrigger;
            Assert.That(replacementBox.GetEntityId(), Is.Not.EqualTo(originalEntityId));
            Assert.That(TeamForgeHierarchySyncService.MatchesReviewedColliders(saved, cube, out _), Is.False);
            // Discard only these unsaved edits to the disposable fixture by reopening the saved Scene.
            EditorSceneManager.OpenScene(scenePath, OpenSceneMode.Single);
            Assert.That(TeamForgeObjectIdentity.TryResolveGameObject(cubeId, out cube), Is.True);
            Assert.That(TeamForgeHierarchySyncService.MatchesReviewedColliders(saved, cube, out error), Is.True, error);

            foreach (var localType in new[] { typeof(AudioSource), typeof(BoxCollider) })
            {
                var localWork = cube.AddComponent(localType);
                Assert.That(EditorSceneManager.SaveScene(SceneManager.GetActiveScene(), scenePath), Is.True);
                var localId = GlobalObjectId.GetGlobalObjectIdSlow(localWork);
                using (TeamForgeTransformSyncService.SuppressSelectionLock()) Selection.activeObject = null;
                EditorSceneManager.OpenScene(scenePath, OpenSceneMode.Single);
                if (localType == typeof(BoxCollider))
                {
                    Assert.That(TeamForgeConnectionService.PrimitiveTemplateSyncAvailable, Is.False);
                    var apply = typeof(TeamForgeHierarchySyncService).GetMethod("TryApplyAuthoritativeTombstones",
                        BindingFlags.Static | BindingFlags.NonPublic);
                    Assert.That(apply, Is.Not.Null);
                    var tombstone = new TeamForgeHierarchyTombstoneRecord
                    { sceneId = sceneId, objectId = cubeId, deletedRevision = result.serverRevision };
                    var arguments = new object[] { new[] { tombstone }, null };
                    Assert.That(apply.Invoke(null, arguments), Is.EqualTo(false),
                        "A retained deletion must preserve the added Collider even when M3 is unavailable.");
                    Assert.That(arguments[1], Does.Contain("durable Session for this preserved deletion could not be verified"));
                    Assert.That(GlobalObjectId.GlobalObjectIdentifierToObjectSlow(localId), Is.Not.Null);
                }
                TeamForgeConnectionService.Connect();
                yield return Wait(() => TeamForgeConnectionService.State == TeamForgeConnectionState.Connected &&
                    TeamForgeHierarchySyncService.Status.Contains("snapshot rejected"), 30,
                    "The reconnect tombstone must preserve the local " + localType.Name + " added after submission");
                Assert.That(TeamForgeObjectIdentity.TryResolveGameObject(cubeId, out cube), Is.True);
                localWork = GlobalObjectId.GlobalObjectIdentifierToObjectSlow(localId) as Component;
                Assert.That(localWork, Is.Not.Null);
                Assert.That(localWork.gameObject, Is.SameAs(cube));
                Assert.That(TeamForgeHierarchySyncService.RecoveryPrimitiveDeletes().Any(row => row.Key == archive.Key), Is.True);
                TeamForgeConnectionService.Disconnect();
                yield return Wait(() => TeamForgeConnectionService.State == TeamForgeConnectionState.Disconnected,
                    15, "Disconnect before moving the test's local-only work out of the shared primitive");
                UnityEngine.Object.DestroyImmediate(localWork);
                Assert.That(EditorSceneManager.SaveScene(SceneManager.GetActiveScene(), scenePath), Is.True);
            }
            TeamForgeConnectionService.Connect();
            yield return Wait(ConnectionReady, 30, "Reconnect after lost deletion receipt");
            Assert.That(TeamForgeColliderSyncService.JoinActiveScene(out error), Is.True, error);
            yield return Wait(() => CatalogReady(2) && FindRow(colliderId) == null &&
                !TeamForgeObjectIdentity.TryResolveGameObject(cubeId, out _) &&
                !TeamForgeHierarchySyncService.RecoveryPrimitiveDeletes().Any(row => row.Key == archive.Key), 25,
                "Reconcile the committed native and Collider tombstones and retire the review entry");
            Assert.That(TeamForgeAuthorityView.Current.SessionRevision, Is.EqualTo(result.serverRevision));
            _durableDeleteVerified = true;
        }

        private static string[] RootIds(Scene scene) => scene.GetRootGameObjects()
            .OrderBy(target => target.transform.GetSiblingIndex())
            .Select(target => TeamForgeHierarchyIdentityRegistry.TryGetKnownId(target, out var id) ? id : string.Empty)
            .ToArray();

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

        private static TeamForgeColliderProperty FindRecovery(string componentId, string propertyPath)
        {
            foreach (var row in TeamForgeColliderSyncService.RecoveryRows())
                if (row.ComponentId == componentId && row.Path == propertyPath) return row;
            return null;
        }

        private static TeamForgeTransformRecoveryRow FindTransformRecovery(string sceneId, string objectId)
        {
            foreach (var row in TeamForgeTransformSyncService.RecoveryRows())
                if (row.sceneId == sceneId && row.objectId == objectId) return row;
            return null;
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
            GameObject owner, bool primitiveEnabled, bool durableEnabled, bool durableTransformEnabled,
            bool durableHierarchyEnabled, bool durableReparentEnabled, bool durableSiblingEnabled)
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
                durableEnabled = durableEnabled,
                durableTransformEnabled = durableTransformEnabled,
                durableHierarchyEnabled = durableHierarchyEnabled,
                durableReparentEnabled = durableReparentEnabled,
                durableSiblingEnabled = durableSiblingEnabled,
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
            (!_durableEnabled || TeamForgeConnectionService.DurableSessionRecoveryAvailable) &&
            (!_durableHierarchyEnabled || TeamForgeConnectionService.HierarchyRenameRecoveryAvailable) &&
            (!_durableReparentEnabled || TeamForgeConnectionService.HierarchyReparentRecoveryAvailable) &&
            (!_durableSiblingEnabled || TeamForgeConnectionService.HierarchySiblingRecoveryAvailable) &&
            TeamForgeProjectService.RegistrySnapshotReceived && TeamForgeHierarchySyncService.SnapshotReady;

        private static bool OwnsSelectedLock()
        {
            var selected = Selection.activeGameObject;
            return selected != null &&
                TeamForgeObjectIdentity.TryGetCollaborativeObjectId(selected, out var objectId) &&
                TeamForgeTransformSyncService.TryGetSelectedLock(out var lease) &&
                lease.sceneId == AssetDatabase.AssetPathToGUID(selected.scene.path) && lease.objectId == objectId &&
                lease.ownerConnectionId == TeamForgeConnectionService.ConnectionId;
        }

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
                " ready=" + TeamForgeColliderSyncService.Ready + " catalog=" + TeamForgeColliderSyncService.CatalogRows().Count +
                " | Hierarchy=" + TeamForgeHierarchySyncService.Status;
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
            public bool primitiveEnabled; public bool durableEnabled; public bool durableTransformEnabled;
            public bool durableHierarchyEnabled;
            public bool durableReparentEnabled;
            public bool durableSiblingEnabled;
        }
        [Serializable] private sealed class IdentityRow
        { public string objectId; public string componentId; public string typeName; }
        [Serializable] private sealed class FixtureReady
        {
            public string serverAddress; public string projectId; public string sessionId;
            public TeamForgeProjectDescriptor descriptor; public string sourceSha;
            public string lateJoinOwnerName; public Vector3 lateJoinLocalPosition; public long lateJoinServerRevision;
            public bool primitiveEnabled; public bool durableEnabled; public bool durableTransformEnabled;
            public bool durableHierarchyEnabled;
            public bool durableReparentEnabled;
            public bool durableSiblingEnabled;
            public string authorityEpoch; public string durableSessionId;
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
        {
            public string operationId; public string objectId; public Vector3 localPosition; public Vector3 localScale;
            public long serverRevision;
        }
        [Serializable] private sealed class DurableRestartResult
        {
            public bool durableRestartVerified; public string sourceSha; public string oldEpoch; public string newEpoch;
            public string durableSessionId; public long serverRevision;
            public string cubeObjectId; public string cubeComponentId; public string sphereObjectId; public string sphereComponentId;
        }
        [Serializable] private sealed class RecoveryPropertyCommit
        {
            public string epoch; public string objectId; public string componentId; public string propertyPath;
            public float value; public long serverRevision;
        }
        [Serializable] private sealed class DurableResubmitResult
        {
            public bool durableResubmitVerified; public string sourceSha; public string authorityEpoch;
            public string componentId; public float value; public long serverRevision;
        }
        [Serializable] private sealed class DurableTransformResult
        {
            public bool durableTransformVerified; public string sourceSha; public string authorityEpoch; public string durableSessionId;
            public string objectId; public Vector3 localPosition; public Quaternion localRotation; public Vector3 localScale;
            public long serverRevision;
        }
        [Serializable] private sealed class DurableHierarchyResult
        {
            public bool durableHierarchyVerified; public string sourceSha; public string authorityEpoch; public string durableSessionId;
            public string objectId; public string name; public string operationId;
            public long hierarchyRevision; public long serverRevision;
        }
        [Serializable] private sealed class DurableReparentResult
        {
            public bool durableReparentVerified; public string sourceSha; public string authorityEpoch; public string durableSessionId;
            public string objectId; public string parentObjectId; public string operationId;
            public long hierarchyRevision; public long transformRevision; public long serverRevision;
            public Vector3 localPosition;
        }
        [Serializable] private sealed class DurableSiblingResult
        {
            public bool durableSiblingVerified; public bool transformUnchanged;
            public string sourceSha; public string authorityEpoch; public string durableSessionId;
            public string objectId; public string operationId; public string[] order;
            public long hierarchyRevision; public long serverRevision;
        }
        [Serializable] private sealed class DurableSiblingConcurrentResult
        {
            public string sourceSha; public string authorityEpoch; public string durableSessionId;
            public string movedObjectId; public string deletedObjectId;
            public string[] beforeOrder; public string[] draftOrder; public string[] finalOrder;
            public long serverRevision;
        }
        [Serializable] private sealed class DurableDeleteResult
        {
            public string sourceSha, authorityEpoch, durableSessionId, objectId, componentId, operationId;
            public long createdRevision, serverRevision;
            public bool hierarchyTombstone, colliderTombstone;
        }
        [Serializable] private sealed class FixtureResult
        {
            public bool passed; public string sourceSha; public string unityVersion;
            public int editorCount; public int nodePeerCount;
            public bool logicalAddRemove; public bool multipleSameType; public bool propertyEdit;
            public bool saveReopenBinding; public bool conditionalUndoRedo; public bool reconnectRecovery;
            public bool pendingAckLossRecovery; public string diagnostics;
            public bool primitiveCreate; public bool primitiveRemoteApply; public bool primitiveColliderEdit;
            public bool primitiveReconnectDelete;
            public bool durableRestartVerified;
            public bool durableTransformVerified;
            public bool durableHierarchyVerified;
            public bool durableReparentVerified;
            public bool durableSiblingVerified;
            public bool durableDeleteVerified;
        }
    }
}

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

        private sealed class CleanupState
        {
            internal TeamForgeConnectionSettings Settings;
            internal string OriginalSettings;
            internal bool WasPropertyOptedIn;
            internal bool WasStructureOptedIn;
            internal string DescriptorPath;
            internal byte[] OriginalDescriptor;
            internal string ScenePath;
        }

        [UnityTest]
        public IEnumerator RealServer_ColliderAddEditSaveReopenRemoveAndReconnect()
        {
            var enabled = false;
            foreach (var argument in Environment.GetCommandLineArgs())
                if (string.Equals(argument, "-teamforgeComponentStructureE2E", StringComparison.OrdinalIgnoreCase))
                    enabled = true;
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
                DescriptorPath = descriptorPath,
                OriginalDescriptor = File.Exists(descriptorPath) ? File.ReadAllBytes(descriptorPath) : null,
            };
            // Arm cleanup before Disconnect mutates ResumeAfterAssemblyReload.
            BeginCleanupDisconnect();
            yield return Wait(() => TeamForgeConnectionService.State == TeamForgeConnectionState.Disconnected,
                10, "Disconnect before M2 E2E");
            var appliedProperties = new List<string>();
            Action<string, string> capture = (type, json) =>
            {
                if (type == "component_property_applied") appliedProperties.Add(json);
            };
            TeamForgeConnectionService.ComponentMessageReceived += capture;
            var passed = false;
            try
            {
                Assert.That(TeamForgeColliderSyncService.LeaveScene(true, out var error), Is.True, error);
                Assert.That(TeamForgeConnectionService.TrySetComponentPropertySyncOptIn(true, out error), Is.True, error);
                Assert.That(TeamForgeConnectionService.TrySetComponentStructureSyncOptIn(true, out error), Is.True, error);
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
                Directory.CreateDirectory(fixtureRoot);
                WriteFixtureRequest(fixtureRoot, scenePath, inventory, initialIdentity);
                var readyPath = Path.Combine(fixtureRoot, "ready.json");
                yield return Wait(() => File.Exists(readyPath), 90, "M2 signed real Scene publication");
                var ready = JsonUtility.FromJson<FixtureReady>(File.ReadAllText(readyPath));
                Assert.That(ready, Is.Not.Null);
                Assert.That(ready.serverAddress, Is.EqualTo("http://127.0.0.1:5084"));
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
                TeamForgeConnectionService.Connect();
                yield return Wait(ConnectionReady, 30, "Negotiated M2 connection and Project/Hierarchy registry");
                Assert.That(TeamForgeWp6PreviewSourceGate.TryCaptureCurrentProjectPin(out _, out error), Is.True, error);
                Assert.That(TeamForgeColliderSyncService.JoinActiveScene(out error), Is.True, error);
                yield return Wait(() => CatalogReady(1), 30, "Signed initial M2 catalog");
                Assert.That(FindRow(initialIdentity.ComponentId), Is.Not.Null);
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
                TeamForgeConnectionService.Connect();
                yield return Wait(ConnectionReady, 30, "Reconnect to retained empty catalog");
                Assert.That(TeamForgeColliderSyncService.JoinActiveScene(out error), Is.True, error);
                yield return Wait(() => CatalogReady(0), 30, "Apply retained empty catalog");
                Selection.activeGameObject = owner;
                yield return Wait(OwnsSelectedLock, 15, "Empty catalog owner lock");
                Assert.That(TeamForgeColliderSyncService.AddColliderToSelection(SphereType, out error), Is.True, error);
                yield return Wait(() => CatalogReady(1), 15, "Add after empty-catalog reconnect");
                var finalRow = TeamForgeColliderSyncService.CatalogRows()[0];
                Assert.That(finalRow.typeName, Is.EqualTo(SphereType));
                Assert.That(Resolve<SphereCollider>(finalRow).radius, Is.EqualTo(0.5f));
                Assert.That(owner.GetComponents<Collider>(), Has.Length.EqualTo(1));
                Assert.That(EditorSceneManager.SaveScene(scene, scenePath), Is.True);
                passed = true;
                WriteAtomic(Path.Combine(fixtureRoot, "result.json"), JsonUtility.ToJson(new FixtureResult
                {
                    passed = true, sourceSha = _sourceSha, unityVersion = Application.unityVersion,
                    editorCount = 1, nodePeerCount = 1, logicalAddRemove = true, multipleSameType = true,
                    propertyEdit = true, saveReopenBinding = true, conditionalUndoRedo = true,
                    reconnectRecovery = true, pendingAckLossRecovery = true, diagnostics = _diagnostics,
                }));
            }
            finally
            {
                TeamForgeConnectionService.ComponentMessageReceived -= capture;
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

        private static void WriteFixtureRequest(string root, string scenePath,
            TeamForgeWp6SceneInventory.Snapshot inventory, TeamForgeWp6ComponentIdentity.Record initial)
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

        private static bool ConnectionReady() => TeamForgeConnectionService.State == TeamForgeConnectionState.Connected &&
            TeamForgeConnectionService.ComponentPropertySyncAvailable && TeamForgeConnectionService.ComponentStructureSyncAvailable &&
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
        { public string scenePath; public string sceneId; public string objectId; public string unityVersion; }
        [Serializable] private sealed class IdentityRow
        { public string objectId; public string componentId; public string typeName; }
        [Serializable] private sealed class FixtureReady
        {
            public string serverAddress; public string projectId; public string sessionId;
            public TeamForgeProjectDescriptor descriptor; public string sourceSha;
        }
        [Serializable] private sealed class FixturePhase
        { public string phase; public string sceneId; public string objectId; public string componentId; }
        [Serializable] private sealed class HeldAcknowledgement
        { public string componentId; public string operationId; public long serverRevision; }
        [Serializable] private sealed class PeerResult
        { public bool remoteCommitted; public string addedComponentId; }
        [Serializable] private sealed class FixtureResult
        {
            public bool passed; public string sourceSha; public string unityVersion;
            public int editorCount; public int nodePeerCount;
            public bool logicalAddRemove; public bool multipleSameType; public bool propertyEdit;
            public bool saveReopenBinding; public bool conditionalUndoRedo; public bool reconnectRecovery;
            public bool pendingAckLossRecovery; public string diagnostics;
        }
    }
}

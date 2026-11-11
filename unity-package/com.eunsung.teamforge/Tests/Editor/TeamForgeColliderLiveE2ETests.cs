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
    // One real Unity Editor and a Node peer over the production WebSocket
    // transport. This does not constitute two-Unity or physical PC evidence.
    public sealed class TeamForgeColliderLiveE2ETests
    {
        private const string Folder = "Assets/__TeamForgeM1E2E";

        [UnityTest]
        public IEnumerator RealServer_ContinuousColliderUndoRemoteApplyAndReconnectRecovery()
        {
            var enabled = false;
            foreach (var argument in Environment.GetCommandLineArgs())
                if (string.Equals(argument, "-teamforgeComponentE2E", StringComparison.OrdinalIgnoreCase)) enabled = true;
            if (!enabled) Assert.Ignore("Production Collider E2E requires the isolated Node fixture and -teamforgeComponentE2E.");

            TeamForgeConnectionService.Disconnect();
            yield return Wait(() => TeamForgeConnectionService.State == TeamForgeConnectionState.Disconnected,
                10, "Disconnect before M1 E2E");
            var settings = TeamForgeConnectionService.Settings;
            var originalSettings = EditorJsonUtility.ToJson(settings);
            var wasOptedIn = TeamForgeConnectionService.ComponentPropertySyncOptIn;
            var projectRoot = Directory.GetParent(Application.dataPath).FullName;
            var descriptorPath = Path.Combine(projectRoot, "ProjectSettings", "TeamForgeProject.json");
            var originalDescriptor = File.Exists(descriptorPath) ? File.ReadAllBytes(descriptorPath) : null;
            var fixtureRoot = Path.GetFullPath(Path.Combine(projectRoot, "..", "test-results", "component-e2e"));
            var scenePath = string.Empty;
            var messages = new List<string>();
            Action<string, string> capture = (type, json) => { if (type == "component_property_applied") messages.Add(json); };
            TeamForgeConnectionService.ComponentMessageReceived += capture;
            var passed = false;
            try
            {
                Assert.That(TeamForgeColliderSyncService.LeaveScene(true, out var error), Is.True, error);
                Assert.That(TeamForgeConnectionService.TrySetComponentPropertySyncOptIn(true, out error), Is.True, error);
                Selection.activeObject = null;
                if (!AssetDatabase.IsValidFolder(Folder)) AssetDatabase.CreateFolder("Assets", "__TeamForgeM1E2E");
                scenePath = Folder + "/" + Guid.NewGuid().ToString("N") + ".unity";
                var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                var owner = new GameObject("M1 production Collider target");
                var box = owner.AddComponent<BoxCollider>();
                var sphere = owner.AddComponent<SphereCollider>();
                Assert.That(EditorSceneManager.SaveScene(scene, scenePath), Is.True);
                AssetDatabase.ImportAsset(scenePath, ImportAssetOptions.ForceSynchronousImport);
                Assert.That(TeamForgeWp6SceneInventory.TryCapture(scene, out var inventory, out error), Is.True, error);
                Assert.That(TeamForgeWp6ComponentIdentity.TryCapture(box, out var boxId, out error), Is.True, error);

                Directory.CreateDirectory(fixtureRoot);
                var request = new FixtureRequest
                {
                    scenePath = scenePath, sceneId = inventory.SceneId,
                    objectId = boxId.ObjectId, componentId = boxId.ComponentId,
                    typeName = boxId.TypeName, unityVersion = Application.unityVersion,
                };
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
                var requestJson = JsonUtility.ToJson(request);
                requestJson = requestJson.Substring(0, requestJson.Length - 1) + ",\"components\":[" + identities +
                    "],\"properties\":[" + properties + "]}";
                WriteAtomic(Path.Combine(fixtureRoot, "request.json"), requestJson);
                var readyPath = Path.Combine(fixtureRoot, "ready.json");
                yield return Wait(() => File.Exists(readyPath), 90, "Node signed Scene fixture publication");
                var ready = JsonUtility.FromJson<FixtureReady>(File.ReadAllText(readyPath));
                Assert.That(ready, Is.Not.Null);
                Assert.That(ready.serverAddress, Does.StartWith("http://127.0.0.1:"));
                Assert.That(TeamForgeProjectValidation.TryValidateDescriptor(ready.descriptor, out error), Is.True, error);
                File.WriteAllText(descriptorPath, JsonUtility.ToJson(ready.descriptor), new UTF8Encoding(false));
                TeamForgeProjectService.ReloadDescriptor();

                settings.ServerAddress = ready.serverAddress; settings.RealtimePath = "ws";
                settings.UserId = "ci-m1-unity"; settings.UserName = "CI M1 Unity";
                settings.UserColorHtml = "#E57373"; settings.ProjectId = ready.projectId; settings.SessionId = ready.sessionId;
                settings.AuthenticationToken = string.Empty; settings.AutoReconnect = false;
                settings.ConnectionTimeoutSeconds = 10; settings.ResumeAfterAssemblyReload = false;
                settings.LogLevel = TeamForgeLogLevel.Info; settings.SaveSettings();
                TeamForgeConnectionService.Connect();
                yield return Wait(() => TeamForgeConnectionService.State == TeamForgeConnectionState.Connected &&
                    TeamForgeConnectionService.ComponentPropertySyncAvailable && TeamForgeProjectService.RegistrySnapshotReceived &&
                    TeamForgeHierarchySyncService.SnapshotReady, 30, "Production M1 connection and Project/Hierarchy registry");
                Assert.That(TeamForgeWp6PreviewSourceGate.TryCaptureCurrentProjectPin(out _, out error), Is.True, error);
                Assert.That(TeamForgeColliderSyncService.JoinActiveScene(out error), Is.True, error);
                yield return Wait(() => TeamForgeColliderSyncService.Ready, 30, "Signed Collider Scene admission and Editor snapshot apply");
                Selection.activeGameObject = owner;
                yield return Wait(OwnsSelectedLock, 15, "Unity Collider GameObject lock");

                var count = messages.Count;
                box.center = new Vector3(0.1f, 0.2f, 0.3f);
                // This test drives the same observed native property through
                // code; emulate the Inspector's normal dirty-Scene marking.
                EditorSceneManager.MarkSceneDirty(scene);
                yield return Wait(() => messages.Count > count && !TeamForgeColliderSyncService.Pending,
                    15, "First production Inspector Collider commit");
                Assert.That(box.center, Is.EqualTo(new Vector3(0.1f, 0.2f, 0.3f)),
                    "Decimal binary32 values must converge through the production wire codec.");
                count = messages.Count;
                Undo.IncrementCurrentGroup();
                Undo.RecordObject(box, "M1 local center before a newer shared value");
                box.center = new Vector3(4f, 5f, 6f);
                Undo.FlushUndoRecordObjects();
                Undo.IncrementCurrentGroup();
                yield return Wait(() => messages.Count > count && !TeamForgeColliderSyncService.Pending,
                    15, "Continuous dirty-Scene Collider commit");
                Assert.That(scene.isDirty, Is.True, "No Scene save should be required between shared edits.");
                count = messages.Count;
                box.isTrigger = true;
                yield return Wait(() => messages.Count > count && !TeamForgeColliderSyncService.Pending,
                    15, "Collider trigger commit");
                count = messages.Count;
                sphere.radius = 2.5f;
                yield return Wait(() => messages.Count > count && !TeamForgeColliderSyncService.Pending,
                    15, "Sphere radius commit");
                box.contactOffset = 0.02f; // An unsupported property remains local.
                count = messages.Count;
                Assert.That(TeamForgeColliderSyncService.UndoOwnEdit(), Is.True);
                yield return Wait(() => messages.Count > count && !TeamForgeColliderSyncService.Pending && sphere.radius == 0.5f,
                    15, "Conditional own Collider Undo");
                count = messages.Count;
                Assert.That(TeamForgeColliderSyncService.RedoOwnEdit(), Is.True);
                yield return Wait(() => messages.Count > count && !TeamForgeColliderSyncService.Pending && sphere.radius == 2.5f,
                    15, "Conditional own Collider Redo");
                Assert.That(box.center, Is.EqualTo(new Vector3(4f, 5f, 6f)));
                Assert.That(box.isTrigger, Is.True);
                Assert.That(box.contactOffset, Is.EqualTo(0.02f));

                Assert.That(TeamForgeTransformSyncService.ReleaseSelectedLock(), Is.True);
                Selection.activeObject = null;
                WriteAtomic(Path.Combine(fixtureRoot, "phase.json"), JsonUtility.ToJson(new FixturePhase
                { phase = "remote", sceneId = inventory.SceneId, objectId = boxId.ObjectId, componentId = boxId.ComponentId }));
                yield return Wait(() => box.center == new Vector3(7f, 8f, 9f) &&
                    File.Exists(Path.Combine(fixtureRoot, "peer-result.json")), 30, "Node peer Collider commit and real Unity remote apply");
                var peerResult = JsonUtility.FromJson<PeerResult>(File.ReadAllText(Path.Combine(fixtureRoot, "peer-result.json")));
                Assert.That(peerResult.remoteCommitted, Is.True);
                Assert.That(box.contactOffset, Is.EqualTo(0.02f), "Remote apply must preserve unrelated local Inspector work.");
                Assert.That(sphere.radius, Is.EqualTo(2.5f));
                Assert.That(box.isTrigger, Is.True);

                // Native Unity Undo can restore an old Component before-image.
                // The service must preserve the newer remote center and every
                // other current shared field, and retain the stale local intent
                // for review instead of sending it as a fresh authoritative edit.
                Selection.activeGameObject = owner;
                yield return Wait(OwnsSelectedLock, 15, "Unity lock before native Undo conflict");
                count = messages.Count;
                Undo.PerformUndo();
                yield return Wait(() => TeamForgeColliderSyncService.Ready &&
                    TeamForgeColliderSyncService.RecoveryCount > 0 && box.center == new Vector3(7f, 8f, 9f),
                    15, "Native Undo preserves a newer shared Collider value");
                Assert.That(box.isTrigger, Is.True, "Native Undo must not overwrite an unrelated current shared trigger.");
                Assert.That(sphere.radius, Is.EqualTo(2.5f));
                var quietUntil = EditorApplication.timeSinceStartup + 0.6;
                while (EditorApplication.timeSinceStartup < quietUntil) yield return null;
                Assert.That(messages.Count, Is.EqualTo(count), "A stale native Undo must not become a new server commit.");
                // Unsupported local fields, such as contactOffset, retain Unity's
                // native Undo semantics. This service reconstructs shared fields only.
                TeamForgeColliderSyncService.DiscardRecovery();
                Assert.That(TeamForgeColliderSyncService.RecoveryCount, Is.Zero);
                Undo.ClearUndo(box);

                // The fixture relay holds only this Editor's next commit ACK.
                // A newer Inspector value must survive disconnect even though
                // the older in-flight value has already committed on the server.
                WriteAtomic(Path.Combine(fixtureRoot, "phase.json"), JsonUtility.ToJson(new FixturePhase
                { phase = "hold_next_ack", sceneId = inventory.SceneId, objectId = boxId.ObjectId, componentId = boxId.ComponentId }));
                yield return Wait(() => File.Exists(Path.Combine(fixtureRoot, "fault-ready.json")),
                    15, "Fixture armed for origin commit acknowledgement loss");
                box.size = new Vector3(2f, 3f, 4f);
                yield return Wait(() => TeamForgeColliderSyncService.Pending &&
                    File.Exists(Path.Combine(fixtureRoot, "held-ack.json")),
                    15, "Server committed size A while origin acknowledgement is held");
                box.size = new Vector3(3f, 4f, 5f);
                TeamForgeConnectionService.Disconnect();
                yield return Wait(() => TeamForgeConnectionService.State == TeamForgeConnectionState.Disconnected,
                    10, "Disconnect with acknowledged-later size A and newer local size B");
                TeamForgeConnectionService.Connect();
                yield return Wait(() => TeamForgeConnectionService.State == TeamForgeConnectionState.Connected &&
                    TeamForgeProjectService.RegistrySnapshotReceived && TeamForgeHierarchySyncService.SnapshotReady,
                    30, "M1 reconnect registry");
                Assert.That(TeamForgeColliderSyncService.JoinActiveScene(out error), Is.True, error);
                yield return Wait(() => TeamForgeColliderSyncService.Ready && TeamForgeColliderSyncService.RecoveryCount > 0,
                    30, "Runtime Collider snapshot and preserved newer local intent after ACK loss");
                Assert.That(box.center, Is.EqualTo(new Vector3(7f, 8f, 9f)));
                Assert.That(box.size, Is.EqualTo(new Vector3(2f, 3f, 4f)),
                    "Reconnect must recover server-committed size A while retaining size B for explicit review.");
                Selection.activeGameObject = owner;
                yield return Wait(OwnsSelectedLock, 15, "Unity reconnect lock reacquisition");
                count = messages.Count;
                Assert.That(TeamForgeColliderSyncService.ResubmitRecovery(), Is.True);
                yield return Wait(() => messages.Count > count && !TeamForgeColliderSyncService.Pending &&
                    TeamForgeColliderSyncService.RecoveryCount == 0 && box.size == new Vector3(3f, 4f, 5f),
                    20, "Explicit resubmission confirms newer local size B after lost size A acknowledgement");
                yield return Wait(() => TeamForgeColliderSyncService.ReportStatus.StartsWith("Server received Editor apply report", StringComparison.Ordinal),
                    15, "Distinct Editor apply report acknowledgement");
                Assert.That(EditorSceneManager.SaveScene(scene, scenePath), Is.True);
                Assert.That(scene.isDirty, Is.False);
                passed = true;
                WriteAtomic(Path.Combine(fixtureRoot, "result.json"), JsonUtility.ToJson(new FixtureResult
                { passed = true, unityVersion = Application.unityVersion, editorCount = 1, nodePeerCount = 1,
                  continuousEdit = true, conditionalUndoRedo = true, remoteApply = true, reconnectRecovery = true, nativeUndoConflict = true, pendingAckLossRecovery = true }));
            }
            finally
            {
                TeamForgeConnectionService.ComponentMessageReceived -= capture;
                Selection.activeObject = null;
                TeamForgeConnectionService.Disconnect();
                TeamForgeColliderSyncService.LeaveScene(true, out _);
                TeamForgeConnectionService.TrySetComponentPropertySyncOptIn(wasOptedIn, out _);
                EditorJsonUtility.FromJsonOverwrite(originalSettings, settings); settings.SaveSettings();
                if (originalDescriptor != null) File.WriteAllBytes(descriptorPath, originalDescriptor);
                else if (File.Exists(descriptorPath)) File.Delete(descriptorPath);
                TeamForgeProjectService.ReloadDescriptor();
                EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                if (!string.IsNullOrEmpty(scenePath)) AssetDatabase.DeleteAsset(scenePath);
                if (AssetDatabase.IsValidFolder(Folder) && AssetDatabase.FindAssets(string.Empty, new[] { Folder }).Length == 0)
                    AssetDatabase.DeleteAsset(Folder);
                if (!passed && Directory.Exists(fixtureRoot))
                    WriteAtomic(Path.Combine(fixtureRoot, "result.json"), JsonUtility.ToJson(new FixtureResult
                    { passed = false, unityVersion = Application.unityVersion, editorCount = 1, nodePeerCount = 1 }));
            }
        }

        private static IEnumerator Wait(Func<bool> predicate, double timeout, string step)
        {
            var until = EditorApplication.timeSinceStartup + timeout;
            while (!predicate() && EditorApplication.timeSinceStartup < until) yield return null;
            Assert.That(predicate(), Is.True, step + ": " + TeamForgeColliderSyncService.Status +
                " | " + TeamForgeConnectionService.LastError);
        }
        private static bool OwnsSelectedLock() => TeamForgeTransformSyncService.TryGetSelectedLock(out var lease) &&
            lease.ownerConnectionId == TeamForgeConnectionService.ConnectionId;
        private static void WriteAtomic(string path, string json)
        {
            var temporary = path + ".tmp";
            File.WriteAllText(temporary, json, new UTF8Encoding(false));
            if (File.Exists(path)) File.Delete(path);
            File.Move(temporary, path);
        }
        [Serializable] private sealed class FixtureRequest
        {
            public string scenePath; public string sceneId; public string objectId;
            public string componentId; public string typeName; public string unityVersion;
        }
        [Serializable] private sealed class IdentityRow
        { public string objectId; public string componentId; public string typeName; }
        [Serializable] private sealed class FixtureReady
        { public string serverAddress; public string projectId; public string sessionId; public TeamForgeProjectDescriptor descriptor; }
        [Serializable] private sealed class FixturePhase
        { public string phase; public string sceneId; public string objectId; public string componentId; }
        [Serializable] private sealed class PeerResult
        { public bool remoteCommitted; }
        [Serializable] private sealed class FixtureResult
        {
            public bool passed; public string unityVersion; public int editorCount; public int nodePeerCount;
            public bool continuousEdit; public bool conditionalUndoRedo; public bool remoteApply; public bool reconnectRecovery;
            public bool nativeUndoConflict; public bool pendingAckLossRecovery;
        }
    }
}

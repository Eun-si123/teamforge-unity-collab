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
        private CleanupState _cleanup;
        private string _diagnostics = string.Empty;

        private sealed class CleanupState
        {
            internal TeamForgeConnectionSettings Settings;
            internal string OriginalSettings;
            internal bool WasOptedIn;
            internal string DescriptorPath;
            internal byte[] OriginalDescriptor;
            internal string ScenePath;
        }

        [UnityTest]
        public IEnumerator RealServer_ContinuousColliderUndoRemoteApplyAndReconnectRecovery()
        {
            var enabled = false;
            foreach (var argument in Environment.GetCommandLineArgs())
                if (string.Equals(argument, "-teamforgeComponentE2E", StringComparison.OrdinalIgnoreCase)) enabled = true;
            if (!enabled) Assert.Ignore("Production Collider E2E requires the isolated Node fixture and -teamforgeComponentE2E.");

            for (var index = 0; index < SceneManager.sceneCount; index++)
            {
                var openScene = SceneManager.GetSceneAt(index);
                if (openScene.IsValid() && openScene.isLoaded && openScene.isDirty)
                    Assert.Ignore("M1 E2E requires clean open Scenes before creating its disposable test Scene.");
            }

            var settings = TeamForgeConnectionService.Settings;
            var originalSettings = EditorJsonUtility.ToJson(settings);
            var wasOptedIn = TeamForgeConnectionService.ComponentPropertySyncOptIn;
            var projectRoot = Directory.GetParent(Application.dataPath).FullName;
            var descriptorPath = Path.Combine(projectRoot, "ProjectSettings", "TeamForgeProject.json");
            var originalDescriptor = File.Exists(descriptorPath) ? File.ReadAllBytes(descriptorPath) : null;
            var fixtureRoot = Path.GetFullPath(Path.Combine(projectRoot, "..", "test-results", "component-e2e"));
            var scenePath = string.Empty;
            _cleanup = new CleanupState
            {
                Settings = settings, OriginalSettings = originalSettings, WasOptedIn = wasOptedIn,
                DescriptorPath = descriptorPath, OriginalDescriptor = originalDescriptor,
            };
            // Disconnect also clears ResumeAfterAssemblyReload. Snapshot all
            // original settings and arm asynchronous cleanup before that mutation.
            BeginCleanupDisconnect();
            yield return Wait(() => TeamForgeConnectionService.State == TeamForgeConnectionState.Disconnected,
                10, "Disconnect before M1 E2E");
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
                _cleanup.ScenePath = scenePath;
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

                // Transform/Hierarchy handoff intentionally retires its own
                // object Undo groups. Build this fixture's isolated Component
                // record only after handoff. The real subscribed production
                // callback must preserve both historical values in recovery
                // while retaining the newer shared state in this Editor.
                Selection.activeGameObject = owner;
                yield return Wait(OwnsSelectedLock, 15, "Unity lock before native Undo conflict");
                count = messages.Count;
                var remoteCenter = box.center;
                var remoteTrigger = box.isTrigger;
                var historicalCenter = new Vector3(0.1f, 0.2f, 0.3f);
                const string nativeUndoName = "M1 isolated historical Collider before-image";
                Undo.ClearUndo(box);
                Undo.IncrementCurrentGroup();
                var nativeUndoGroup = Undo.GetCurrentGroup();
                // These synchronous fixture writes never yield an Editor frame,
                // so the collaboration observer cannot publish the setup values.
                box.center = historicalCenter;
                box.isTrigger = false;
                Undo.RegisterCompleteObjectUndo(box, nativeUndoName);
                box.center = remoteCenter;
                box.isTrigger = remoteTrigger;
                Undo.FlushUndoRecordObjects();
                Undo.SetCurrentGroupName(nativeUndoName);
                Assert.That(Undo.GetCurrentGroup(), Is.EqualTo(nativeUndoGroup));
                Assert.That(Undo.GetCurrentGroupName(), Is.EqualTo(nativeUndoName),
                    "The intended complete-object Undo record must exist immediately before native Undo.");
                Undo.IncrementCurrentGroup();
                var nativeEvents = 0;
                Undo.UndoRedoCallback observeNativeUndo = () => nativeEvents += 1;
                // Observe only. Do not replace or manually invoke the production
                // subscription: its recovery side effects are the assertion.
                Undo.undoRedoPerformed += observeNativeUndo;
                try
                {
                    Undo.PerformUndo();
                    yield return Wait(() => nativeEvents > 0, 5, "Actual native Collider Undo callback");
                }
                finally
                {
                    Undo.undoRedoPerformed -= observeNativeUndo;
                }
                yield return Wait(() => TeamForgeColliderSyncService.Ready &&
                    TeamForgeColliderSyncService.RecoveryCount > 0 && box.center == remoteCenter,
                    15, "Native Undo preserves a newer shared Collider value");
                var recoveredCenter = false;
                var recoveredTrigger = false;
                foreach (var recovered in TeamForgeColliderSyncService.RecoveryRows())
                {
                    if (recovered.ObjectId != boxId.ObjectId || recovered.ComponentId != boxId.ComponentId) continue;
                    if (recovered.Path == "m_Center" && recovered.Kind == "vector3" &&
                        recovered.Vector.Equals(historicalCenter)) recoveredCenter = true;
                    if (recovered.Path == "m_IsTrigger" && recovered.Kind == "boolean" &&
                        !recovered.Boolean) recoveredTrigger = true;
                }
                _diagnostics = "Native Undo group=" + nativeUndoGroup + " callbacks=" + nativeEvents +
                    " finalCenter=" + box.center + " finalTrigger=" + box.isTrigger +
                    " recoveredHistoricalCenter=" + recoveredCenter + " recoveredHistoricalTrigger=" + recoveredTrigger +
                    " ready=" + TeamForgeColliderSyncService.Ready +
                    " recovery=" + TeamForgeColliderSyncService.RecoveryCount;
                Assert.That(nativeEvents, Is.EqualTo(1), _diagnostics);
                Assert.That(recoveredCenter, Is.True, _diagnostics);
                Assert.That(recoveredTrigger, Is.True, _diagnostics);
                Assert.That(box.center, Is.EqualTo(new Vector3(7f, 8f, 9f)), _diagnostics);
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
                  continuousEdit = true, conditionalUndoRedo = true, remoteApply = true, reconnectRecovery = true,
                  nativeUndoConflict = true, pendingAckLossRecovery = true, diagnostics = _diagnostics }));
            }
            finally
            {
                TeamForgeConnectionService.ComponentMessageReceived -= capture;
                BeginCleanupDisconnect();
                if (!passed && Directory.Exists(fixtureRoot))
                    WriteAtomic(Path.Combine(fixtureRoot, "result.json"), JsonUtility.ToJson(new FixtureResult
                    { passed = false, unityVersion = Application.unityVersion, editorCount = 1, nodePeerCount = 1,
                        diagnostics = _diagnostics + " | " + TeamForgeColliderSyncService.Status }));
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
                    10, "E2E cleanup waits for the real socket-close generation");
                // Let the connection/authority/hierarchy services observe the
                // completed close before another fixture snapshots shared state.
                yield return null;
                Assert.That(TeamForgeColliderSyncService.LeaveScene(true, out var error), Is.True,
                    "E2E Collider cleanup: " + error);
                Assert.That(TeamForgeConnectionService.TrySetComponentPropertySyncOptIn(cleanup.WasOptedIn, out error), Is.True,
                    "E2E capability cleanup: " + error);
                EditorJsonUtility.FromJsonOverwrite(cleanup.OriginalSettings, cleanup.Settings);
                cleanup.Settings.SaveSettings();
                if (cleanup.OriginalDescriptor != null) File.WriteAllBytes(cleanup.DescriptorPath, cleanup.OriginalDescriptor);
                else if (File.Exists(cleanup.DescriptorPath)) File.Delete(cleanup.DescriptorPath);
                TeamForgeProjectService.ReloadDescriptor();
                using (TeamForgeTransformSyncService.SuppressSelectionLock()) Selection.activeObject = null;
                EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                if (!string.IsNullOrEmpty(cleanup.ScenePath)) AssetDatabase.DeleteAsset(cleanup.ScenePath);
                if (AssetDatabase.IsValidFolder(Folder) && AssetDatabase.FindAssets(string.Empty, new[] { Folder }).Length == 0)
                    AssetDatabase.DeleteAsset(Folder);
                Assert.That(TeamForgeConnectionService.State, Is.EqualTo(TeamForgeConnectionState.Disconnected));
                yield return null;
            }
            finally { _cleanup = null; }
        }
        private static void BeginCleanupDisconnect()
        {
            // Calling Disconnect again while already Disconnecting would take
            // its null-transport shortcut and falsely settle the visible state
            // while an earlier close callback can still arrive in a later test.
            if (TeamForgeConnectionService.State != TeamForgeConnectionState.Disconnecting &&
                TeamForgeConnectionService.State != TeamForgeConnectionState.Disconnected)
                TeamForgeConnectionService.Disconnect();
        }

        private IEnumerator Wait(Func<bool> predicate, double timeout, string step)
        {
            var until = EditorApplication.timeSinceStartup + timeout;
            while (!predicate() && EditorApplication.timeSinceStartup < until) yield return null;
            Assert.That(predicate(), Is.True, step + ": " + TeamForgeColliderSyncService.Status +
                " | " + TeamForgeConnectionService.LastError + " | " + _diagnostics +
                " | Connection=" + TeamForgeConnectionService.State + " pending=" + TeamForgeColliderSyncService.Pending +
                " ready=" + TeamForgeColliderSyncService.Ready + " recovery=" + TeamForgeColliderSyncService.RecoveryCount);
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
            public bool nativeUndoConflict; public bool pendingAckLossRecovery; public string diagnostics;
        }
    }
}

using System;
using System.Collections;
using System.Collections.Generic;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace EunSung.TeamForge.Tests
{
    public sealed class TeamForgeColliderSceneReadinessTests
    {
        private const BindingFlags PrivateStatic = BindingFlags.Static | BindingFlags.NonPublic;

        [Test]
        public void KnownColliderSceneRequiresCurrentConnectionApplyBeforeEditsResume()
        {
            using (var scenario = new ReadinessScenario())
            {
                scenario.KnownSource();
                Assert.That(TeamForgeColliderSyncService.IsSceneEditReady(scenario.SceneId), Is.False);
                scenario.ColliderField("_ready", true);
                scenario.ColliderField("_joinedConnection", "previous-connection");
                Assert.That(TeamForgeColliderSyncService.IsSceneEditReady(scenario.SceneId), Is.False,
                    "A restored ready flag must not authorize the replacement socket before its snapshot applies.");
                scenario.ColliderField("_joinedConnection", TeamForgeConnectionService.ConnectionId);
                Assert.That(TeamForgeColliderSyncService.IsSceneEditReady(scenario.SceneId), Is.True);
            }
        }

        [Test]
        public void FreshServerRequiredSceneWaitsWithoutBlockingOtherScenesOrLegacyClients()
        {
            using (var scenario = new ReadinessScenario())
            {
                scenario.ColliderField("_source", null);
                scenario.ColliderField("_sceneId", string.Empty);
                scenario.RequiredScene(scenario.SceneId);
                Assert.That(TeamForgeColliderSyncService.IsSceneEditReady(scenario.SceneId), Is.False);
                Assert.That(TeamForgeColliderSyncService.IsSceneEditReady("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"), Is.True);
                scenario.ConnectionField("<ComponentPropertySyncAvailable>k__BackingField", false);
                Assert.That(TeamForgeColliderSyncService.IsSceneEditReady(scenario.SceneId), Is.True,
                    "Clients that did not negotiate Collider property synchronization retain their prior behavior.");
            }
        }

        [Test]
        public void SourceFromADifferentProjectOrSessionDoesNotGateCurrentUnrelatedScene()
        {
            using (var scenario = new ReadinessScenario())
            {
                scenario.KnownSource();
                scenario.ColliderField("_stateProjectId", TeamForgeConnectionService.Settings.ProjectId + "-other");
                Assert.That(TeamForgeColliderSyncService.IsSceneEditReady(scenario.SceneId), Is.True);
                scenario.ColliderField("_stateProjectId", TeamForgeConnectionService.Settings.ProjectId);
                scenario.ColliderField("_stateSessionId", TeamForgeConnectionService.Settings.SessionId + "-other");
                Assert.That(TeamForgeColliderSyncService.IsSceneEditReady(scenario.SceneId), Is.True);
            }
        }

        [Test]
        public void ColliderReadinessBlocksLockAndTransformUntilOneAutomaticRearmForUnchangedSelection()
        {
            using (var scenario = new ReadinessScenario())
            {
                scenario.KnownSource();
                var localB = new Vector3(3f, 4f, 5f);
                scenario.Box.center = localB;
                scenario.TransformField("_dirty", true);
                var selectedId = TeamForgeTransformSyncService.SelectedObjectId;
                Assert.That(scenario.SendLock(), Is.False);
                scenario.TransformField("_selectedLockGranted", true);
                Assert.That(scenario.SendTransform(), Is.False);
                scenario.TransformField("_selectedLockGranted", false);
                scenario.UpdateTransform();
                Assert.That(scenario.Transport.Messages, Is.Empty);
                Assert.That(Selection.activeGameObject, Is.SameAs(scenario.Box.gameObject));
                Assert.That(TeamForgeTransformSyncService.TrackedObject, Is.SameAs(scenario.Box.gameObject));
                Assert.That(TeamForgeTransformSyncService.SelectedObjectId, Is.EqualTo(selectedId));
                Assert.That(scenario.ReadTransform<bool>("_dirty"), Is.True);
                Assert.That(scenario.Box.center, Is.EqualTo(localB), "Readiness gating must preserve unsent Inspector work.");

                scenario.ColliderField("_ready", true);
                scenario.ColliderField("_joinedConnection", TeamForgeConnectionService.ConnectionId);
                scenario.UpdateTransform();
                scenario.UpdateTransform();
                Assert.That(scenario.Transport.Messages, Has.Count.EqualTo(1));
                Assert.That(TeamForgeProtocol.TryReadEnvelope(scenario.Transport.Messages[0], out var envelope, out var error), Is.True, error);
                Assert.That(envelope.type, Is.EqualTo("lock_request"));
                var request = TeamForgeProtocol.Deserialize<LockRequestMessage>(scenario.Transport.Messages[0]);
                Assert.That(request.sceneId, Is.EqualTo(scenario.SceneId));
                Assert.That(request.objectId, Is.EqualTo(selectedId));
                Assert.That(Selection.activeGameObject, Is.SameAs(scenario.Box.gameObject),
                    "The same selected object must automatically re-arm after Collider reconciliation.");
                Assert.That(scenario.ReadTransform<bool>("_dirty"), Is.True);
                Assert.That(scenario.Box.center, Is.EqualTo(localB));
            }
        }

        [Test]
        public void InflightTransformAdmissionRefusalRetainsLocalDeltaAndResendsAfterColliderApply()
        {
            using (var scenario = new ReadinessScenario())
            {
                scenario.KnownSource();
                scenario.ColliderField("_ready", true);
                scenario.ColliderField("_joinedConnection", TeamForgeConnectionService.ConnectionId);
                scenario.TransformField("_selectedLockGranted", true);
                var movedX = new Vector3(11f, 12f, 13f);
                var colliderB = new Vector3(3f, 4f, 5f);
                scenario.Box.transform.localPosition = movedX;
                scenario.Box.center = colliderB;
                Assert.That(scenario.SendTransform(), Is.True, "The initial operation must enter the actual production pending registry.");
                Assert.That(scenario.Transport.Messages, Has.Count.EqualTo(1));
                var sent = TeamForgeProtocol.Deserialize<TransformUpdateMessage>(scenario.Transport.Messages[0]);
                Assert.That(scenario.HasPendingTransform(sent.requestId), Is.True);

                scenario.RequiredScene(scenario.SceneId);
                scenario.ColliderField("_ready", false);
                scenario.RejectTransformRequest(new ProtocolErrorMessage
                {
                    type = "error", protocolVersion = TeamForgeProtocol.Version,
                    requestId = sent.requestId, code = "component_sync_required",
                    message = "Collider Scene admission is required before this edit.",
                });
                Assert.That(scenario.HasPendingTransform(sent.requestId), Is.False);
                Assert.That(scenario.HasProtectedSelectedConflict(), Is.False,
                    "A correlated Collider admission race must not become a permanent Transform conflict.");
                Assert.That(scenario.ReadTransform<bool>("_syncBlocked"), Is.False);
                Assert.That(scenario.ReadTransform<bool>("_awaitingColliderScene"), Is.True);
                Assert.That(scenario.ReadTransform<bool>("_dirty"), Is.True);
                Assert.That(scenario.Box.transform.localPosition, Is.EqualTo(movedX));
                Assert.That(scenario.Box.center, Is.EqualTo(colliderB));
                Assert.That(scenario.ReadTransform<string>("_pendingLockRequestId"), Is.Empty);

                scenario.Transport.Messages.Clear();
                scenario.ColliderField("_ready", true);
                scenario.ColliderField("_joinedConnection", TeamForgeConnectionService.ConnectionId);
                scenario.UpdateTransform();
                Assert.That(scenario.Transport.Messages, Has.Count.EqualTo(1));
                var lockRequest = TeamForgeProtocol.Deserialize<LockRequestMessage>(scenario.Transport.Messages[0]);
                Assert.That(lockRequest.type, Is.EqualTo("lock_request"));
                scenario.GrantSelectedLock(lockRequest.requestId);
                scenario.TransformField("_nextTransformSendAt", 0d);
                scenario.UpdateTransform();

                Assert.That(scenario.Transport.Messages, Has.Count.EqualTo(2));
                var retried = TeamForgeProtocol.Deserialize<TransformUpdateMessage>(scenario.Transport.Messages[1]);
                Assert.That(retried.type, Is.EqualTo("transform_update"));
                Assert.That(retried.localPosition.x, Is.EqualTo(movedX.x));
                Assert.That(retried.localPosition.y, Is.EqualTo(movedX.y));
                Assert.That(retried.localPosition.z, Is.EqualTo(movedX.z));
                Assert.That(retried.operationId, Is.Not.EqualTo(sent.operationId),
                    "A server-refused edit is resubmitted against the recovered authority as a new operation.");
                Assert.That(scenario.HasPendingTransform(retried.requestId), Is.True);
                Assert.That(scenario.HasProtectedSelectedConflict(), Is.False);
                Assert.That(Selection.activeGameObject, Is.SameAs(scenario.Box.gameObject));
                Assert.That(scenario.Box.transform.localPosition, Is.EqualTo(movedX));
                Assert.That(scenario.Box.center, Is.EqualTo(colliderB));
            }
        }

        [Test]
        public void InflightLockAdmissionRefusalAutomaticallyRearmsTheSameSelectionAfterColliderApply()
        {
            using (var scenario = new ReadinessScenario())
            {
                scenario.KnownSource();
                scenario.ColliderField("_ready", true);
                scenario.ColliderField("_joinedConnection", TeamForgeConnectionService.ConnectionId);
                var colliderB = new Vector3(3f, 4f, 5f);
                scenario.Box.center = colliderB;
                Assert.That(scenario.SendLock(), Is.True);
                var sent = TeamForgeProtocol.Deserialize<LockRequestMessage>(scenario.Transport.Messages[0]);
                Assert.That(scenario.ReadTransform<string>("_pendingLockRequestId"), Is.EqualTo(sent.requestId));
                scenario.RequiredScene(scenario.SceneId);
                scenario.ColliderField("_ready", false);
                scenario.RejectTransformRequest(new ProtocolErrorMessage
                {
                    type = "error", protocolVersion = TeamForgeProtocol.Version,
                    requestId = sent.requestId, code = "component_sync_required",
                    message = "Collider Scene admission is required before this lock request.",
                });
                Assert.That(scenario.ReadTransform<string>("_pendingLockRequestId"), Is.Empty);
                Assert.That(scenario.ReadTransform<bool>("_awaitingColliderScene"), Is.True);
                Assert.That(scenario.ReadTransform<bool>("_syncBlocked"), Is.False);
                Assert.That(scenario.HasProtectedSelectedConflict(), Is.False);
                Assert.That(scenario.Box.center, Is.EqualTo(colliderB));

                scenario.Transport.Messages.Clear();
                scenario.ColliderField("_ready", true);
                scenario.ColliderField("_joinedConnection", TeamForgeConnectionService.ConnectionId);
                scenario.UpdateTransform();
                scenario.UpdateTransform();
                Assert.That(scenario.Transport.Messages, Has.Count.EqualTo(1));
                var rearmed = TeamForgeProtocol.Deserialize<LockRequestMessage>(scenario.Transport.Messages[0]);
                Assert.That(rearmed.type, Is.EqualTo("lock_request"));
                Assert.That(rearmed.requestId, Is.Not.EqualTo(sent.requestId));
                Assert.That(rearmed.objectId, Is.EqualTo(sent.objectId));
                Assert.That(Selection.activeGameObject, Is.SameAs(scenario.Box.gameObject));
                Assert.That(scenario.Box.center, Is.EqualTo(colliderB));
            }
        }

        [Test]
        public void HierarchySendWaitsForColliderReadinessWithoutDiscardingTheLocalRename()
        {
            using (var scenario = new ReadinessScenario())
            {
                scenario.KnownSource();
                scenario.Box.gameObject.name = "Local rename awaiting Collider reconciliation";
                scenario.Box.center = new Vector3(3f, 4f, 5f);
                scenario.SendHierarchy(new HierarchyOperationMessage
                {
                    type = "hierarchy_operation", protocolVersion = TeamForgeProtocol.Version,
                    requestId = "readiness-hierarchy-request", operationId = "readiness-hierarchy-operation",
                    kind = "rename_object", sceneId = scenario.SceneId,
                    objectId = TeamForgeTransformSyncService.SelectedObjectId,
                    name = scenario.Box.gameObject.name,
                });
                Assert.That(scenario.Transport.Messages, Is.Empty);
                Assert.That(TeamForgeHierarchySyncService.HasPendingOperation, Is.False);
                Assert.That(TeamForgeHierarchySyncService.Status, Does.Contain("Collider Scene admission"));
                Assert.That(scenario.Box.gameObject.name, Is.EqualTo("Local rename awaiting Collider reconciliation"));
                Assert.That(scenario.Box.center, Is.EqualTo(new Vector3(3f, 4f, 5f)));
                scenario.ColliderField("_ready", true);
                scenario.ColliderField("_joinedConnection", TeamForgeConnectionService.ConnectionId);
                scenario.HierarchyField("_wasConnected", true);
                scenario.HierarchyField("_receivedSnapshot", true);
                scenario.HierarchyField("_recoveryBlocked", false);
                scenario.HierarchyField("_scanScheduled", false);
                scenario.ColliderReadinessChanged();
                Assert.That(scenario.ReadHierarchy<bool>("_scanScheduled"), Is.True,
                    "Reconciliation must re-arm local Hierarchy observation without changing selection or dirty data.");
                scenario.HierarchyField("_scanScheduled", false);
                scenario.ColliderReadinessChanged();
                Assert.That(scenario.ReadHierarchy<bool>("_scanScheduled"), Is.False,
                    "Ordinary property status notifications must not repeatedly scan the full Hierarchy.");
                Assert.That(scenario.Box.gameObject.name, Is.EqualTo("Local rename awaiting Collider reconciliation"));
            }
        }

        [Test]
        public void OptionalHelloMetadataDeserializesWithoutChangingLegacyWireInterpretation()
        {
            var legacy = TeamForgeProtocol.Deserialize<HelloAckMessage>("{\"type\":\"hello_ack\",\"protocolVersion\":1}");
            Assert.That(string.IsNullOrEmpty(legacy.componentPropertySceneId), Is.True);
            var required = TeamForgeProtocol.Deserialize<HelloAckMessage>(
                "{\"type\":\"hello_ack\",\"protocolVersion\":1,\"componentPropertySceneId\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"}");
            Assert.That(required.componentPropertySceneId, Is.EqualTo("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"));
        }

        [Test]
        public void HelloRequirementIsPinnedBeforeConnectedObserversCanRequestEditAuthority()
        {
            using (var scenario = new ReadinessScenario())
            {
                var observed = false;
                var observedScene = string.Empty;
                var observedReady = true;
                Action observeFirstConnected = () =>
                {
                    if (observed || TeamForgeConnectionService.State != TeamForgeConnectionState.Connected) return;
                    observed = true;
                    observedScene = TeamForgeConnectionService.RequiredComponentSceneId;
                    observedReady = TeamForgeColliderSyncService.IsSceneEditReady(scenario.SceneId);
                };
                TeamForgeConnectionService.Changed += observeFirstConnected;
                try { scenario.AcknowledgeHello(scenario.SceneId); }
                finally { TeamForgeConnectionService.Changed -= observeFirstConnected; }
                Assert.That(observed, Is.True);
                Assert.That(observedScene, Is.EqualTo(scenario.SceneId));
                Assert.That(observedReady, Is.False,
                    "The first Connected notification must already gate the required Scene, before Hierarchy/selection observers run.");
                foreach (var json in scenario.Transport.Messages)
                {
                    Assert.That(TeamForgeProtocol.TryReadEnvelope(json, out var envelope, out var error), Is.True, error);
                    Assert.That(envelope.type, Is.Not.EqualTo("lock_request"));
                    Assert.That(envelope.type, Is.Not.EqualTo("transform_update"));
                    Assert.That(envelope.type, Is.Not.EqualTo("hierarchy_operation"));
                }
            }
        }

        [Test]
        public void ServerSceneRequiredNoticeOnlyUpdatesCurrentConnectionMetadataBeforeEditorApply()
        {
            using (var scenario = new ReadinessScenario())
            {
                var localB = new Vector3(3f, 4f, 5f);
                scenario.Box.center = localB;
                scenario.Notice(scenario.SceneId);
                Assert.That(TeamForgeConnectionService.RequiredComponentSceneId, Is.EqualTo(scenario.SceneId));
                Assert.That(TeamForgeColliderSyncService.IsSceneEditReady(scenario.SceneId), Is.False);
                Assert.That(TeamForgeColliderSyncService.Ready, Is.False);
                Assert.That(scenario.Box.center, Is.EqualTo(localB));
                Assert.That(scenario.Transport.Messages, Is.Empty);
                scenario.ResetConnectionComponentState();
                Assert.That(string.IsNullOrEmpty(TeamForgeConnectionService.RequiredComponentSceneId), Is.True,
                    "Required Scene metadata belongs to one connection and must not leak into its replacement.");
            }
        }

        [TestCase("not-a-scene-guid")]
        [TestCase("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")]
        [TestCase("00000000000000000000000000000000")]
        public void InvalidRequiredSceneNoticeCannotAuthorizeSceneEdits(string invalidSceneId)
        {
            using (var scenario = new ReadinessScenario())
            {
                scenario.Notice(invalidSceneId);
                Assert.That(TeamForgeConnectionService.State, Is.EqualTo(TeamForgeConnectionState.Faulted));
                Assert.That(string.IsNullOrEmpty(TeamForgeConnectionService.RequiredComponentSceneId), Is.True);
                Assert.That(scenario.Transport.Messages, Is.Empty);
            }
        }

        private sealed class ReadinessScenario : IDisposable
        {
            private const string Folder = "Assets/__TeamForgeColliderSceneReadinessTests";
            private readonly TeamForgeSharedEditorStateScope shared;
            private readonly Dictionary<FieldInfo, object> scalarValues = new Dictionary<FieldInfo, object>();
            private readonly List<CollectionSnapshot> collections = new List<CollectionSnapshot>();
            private readonly string scenePath = Folder + "/" + Guid.NewGuid().ToString("N") + ".unity";
            private bool disposed;

            internal ReadinessScenario()
            {
                for (var index = 0; index < SceneManager.sceneCount; index++)
                    if (SceneManager.GetSceneAt(index).isDirty)
                        Assert.Ignore("Collider readiness tests require clean open Scenes; unsaved work was preserved.");
                shared = new TeamForgeSharedEditorStateScope();
                try
                {
                    Snapshot(typeof(TeamForgeColliderSyncService), true);
                    Snapshot(typeof(TeamForgeConnectionService), false);
                    Snapshot(typeof(TeamForgeTransformSyncService), false);
                    Snapshot(typeof(TeamForgeHierarchySyncService), true);
                    var pingSnapshot = new CollectionSnapshot(Field(typeof(TeamForgeConnectionService), "PendingPings").GetValue(null));
                    collections.Add(pingSnapshot); pingSnapshot.Clear();
                    Field(typeof(TeamForgeHierarchySyncService), "_wasConnected").SetValue(null, false);
                    Field(typeof(TeamForgeHierarchySyncService), "_pendingOperation").SetValue(null, null);
                    ColliderField("_pending", null); ColliderField("_ready", false); ColliderField("_source", null);
                    ColliderField("_sceneId", string.Empty); ColliderField("_scenePath", string.Empty);
                    ColliderField("_wasConnected", false); ColliderField("_rejoinRequested", false);
                    ColliderField("_snapshotRequest", string.Empty); ColliderField("_manualRetryRequired", false);
                    ConnectionField("<State>k__BackingField", TeamForgeConnectionState.Disconnected);
                    ConnectionField("<ComponentPropertySyncAvailable>k__BackingField", true);
                    ConnectionField("<RequiredComponentSceneId>k__BackingField", string.Empty);
                    ConnectionField("_connectionDesired", false);
                    using (TeamForgeTransformSyncService.SuppressSelectionLock())
                        TeamForgeSharedEditorStateScope.SetSingleSelection(null);
                    if (!AssetDatabase.IsValidFolder(Folder)) AssetDatabase.CreateFolder("Assets", "__TeamForgeColliderSceneReadinessTests");
                    var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                    Box = new GameObject("Collider readiness target").AddComponent<BoxCollider>();
                    Assert.That(EditorSceneManager.SaveScene(scene, scenePath), Is.True);
                    SceneId = AssetDatabase.AssetPathToGUID(scenePath);
                    Assert.That(TeamForgeObjectIdentity.TryGetGlobalObjectId(Box.gameObject, out var objectId), Is.True);
                    TeamForgeTransformSyncService.SelectionBaseline.Upsert(SceneId, objectId, string.Empty);
                    using (TeamForgeTransformSyncService.SuppressSelectionLock())
                        TeamForgeSharedEditorStateScope.SetSingleSelection(Box.gameObject);
                    ConnectionField("_transport", Transport);
                    ConnectionField("<ConnectionId>k__BackingField", "readiness-" + Guid.NewGuid().ToString("N"));
                    ConnectionField("<State>k__BackingField", TeamForgeConnectionState.Connected);
                    ConnectionField("<PresenceAvailable>k__BackingField", true);
                    ConnectionField("<TransformSyncAvailable>k__BackingField", true);
                    ConnectionField("<HierarchySyncAvailable>k__BackingField", false);
                    ConnectionField("<ProjectTransferAvailable>k__BackingField", false);
                    Invoke(typeof(TeamForgeAuthorityView), "ObserveConnection");
                    Invoke(typeof(TeamForgeTransformSyncService), "BeginTrackingSelection", false);
                    TransformField("_wasConnected", true);
                    TransformField("_awaitingColliderScene", false);
                    TransformField("_nextIdentityValidationAt", double.MaxValue);
                }
                catch { Dispose(); throw; }
            }

            internal BoxCollider Box { get; }
            internal string SceneId { get; }
            internal RecordingTransport Transport { get; } = new RecordingTransport();
            internal void KnownSource()
            {
                ColliderField("_sceneId", SceneId);
                ColliderField("_scenePath", scenePath);
                ColliderField("_stateProjectId", TeamForgeConnectionService.Settings.ProjectId);
                ColliderField("_stateSessionId", TeamForgeConnectionService.Settings.SessionId);
                ColliderField("_source", new TeamForgeComponentSource { projectUuid = "315b1ce0-5da1-4336-83ba-8ad070f38231" });
                ColliderField("_ready", false); ColliderField("_joinedConnection", string.Empty);
            }
            internal void RequiredScene(string sceneId) => ConnectionField("<RequiredComponentSceneId>k__BackingField", sceneId);
            internal void ColliderField(string name, object value) => Field(typeof(TeamForgeColliderSyncService), name).SetValue(null, value);
            internal void ConnectionField(string name, object value) => Field(typeof(TeamForgeConnectionService), name).SetValue(null, value);
            internal void TransformField(string name, object value) => Field(typeof(TeamForgeTransformSyncService), name).SetValue(null, value);
            internal T ReadTransform<T>(string name) => (T)Field(typeof(TeamForgeTransformSyncService), name).GetValue(null);
            internal bool SendLock() => (bool)Invoke(typeof(TeamForgeTransformSyncService), "SendLockRequest", false);
            internal bool SendTransform() => (bool)Invoke(typeof(TeamForgeTransformSyncService), "TrySendCurrentTransform", true);
            internal void UpdateTransform() => Invoke(typeof(TeamForgeTransformSyncService), "Update");
            internal void RejectTransformRequest(ProtocolErrorMessage message) =>
                Invoke(typeof(TeamForgeTransformSyncService), "OnProtocolErrorReceived", message);
            internal bool HasPendingTransform(string requestId) =>
                ((IDictionary)Field(typeof(TeamForgeTransformSyncService), "PendingOperationByRequestId").GetValue(null)).Contains(requestId);
            internal bool HasProtectedSelectedConflict() =>
                ((HashSet<string>)Field(typeof(TeamForgeTransformSyncService), "ProtectedConflictKeys").GetValue(null)).Contains(
                    SceneId + "\n" + TeamForgeTransformSyncService.SelectedObjectId);
            internal void GrantSelectedLock(string requestId)
            {
                var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                Invoke(typeof(TeamForgeTransformSyncService), "HandleLockGranted", new LockStateMessage
                {
                    type = "lock_granted", protocolVersion = TeamForgeProtocol.Version,
                    requestId = requestId, serverTimestampUnixMs = now,
                    lockState = new TeamForgeLockRecord
                    {
                        sceneId = SceneId, objectId = TeamForgeTransformSyncService.SelectedObjectId,
                        ownerUserId = TeamForgeConnectionService.Settings.UserId,
                        ownerConnectionId = TeamForgeConnectionService.ConnectionId,
                        ownerDisplayName = "Readiness fixture owner", ownerColor = "#E57373", expiresAtUnixMs = now + 60000,
                    },
                });
            }
            internal void SendHierarchy(HierarchyOperationMessage message) => Invoke(typeof(TeamForgeHierarchySyncService), "SendOperation", message);
            internal void Notice(string sceneId)
            {
                var json = "{\"type\":\"component_scene_required\",\"protocolVersion\":1,\"sceneId\":\"" + sceneId + "\",\"serverRevision\":7}";
                var epoch = (int)Field(typeof(TeamForgeConnectionService), "_connectionEpoch").GetValue(null);
                Invoke(typeof(TeamForgeConnectionService), "HandleComponentSceneRequired", epoch, Transport, json);
            }
            internal void AcknowledgeHello(string sceneId)
            {
                const string requestId = "readiness-hello-current";
                ConnectionField("_helloRequestId", requestId);
                ConnectionField("_componentPropertyOffered", true);
                ConnectionField("_componentPreviewOffered", false);
                ConnectionField("<State>k__BackingField", TeamForgeConnectionState.Handshaking);
                var acknowledgement = new HelloAckMessage
                {
                    type = "hello_ack", protocolVersion = TeamForgeProtocol.Version, requestId = requestId,
                    connectionId = "readiness-hello-connection", serverVersion = "test",
                    userId = TeamForgeConnectionService.Settings.UserId.Trim(), presenceEnabled = true,
                    transformSyncEnabled = true, hierarchySyncEnabled = true, projectTransferEnabled = true,
                    componentPropertySyncEnabled = true, componentPropertySceneId = sceneId,
                };
                var epoch = (int)Field(typeof(TeamForgeConnectionService), "_connectionEpoch").GetValue(null);
                Invoke(typeof(TeamForgeConnectionService), "HandleHelloAck", epoch, Transport, JsonUtility.ToJson(acknowledgement));
            }
            internal void HierarchyField(string name, object value) => Field(typeof(TeamForgeHierarchySyncService), name).SetValue(null, value);
            internal T ReadHierarchy<T>(string name) => (T)Field(typeof(TeamForgeHierarchySyncService), name).GetValue(null);
            internal void ColliderReadinessChanged() => Invoke(typeof(TeamForgeHierarchySyncService), "OnColliderSceneChanged");
            internal void ResetConnectionComponentState() => Invoke(typeof(TeamForgeConnectionService), "ResetComponentRecoveryPreviewState");
            private void Snapshot(Type type, bool clearCollections)
            {
                foreach (var field in type.GetFields(PrivateStatic))
                {
                    if (field.IsLiteral) continue;
                    var value = field.GetValue(null);
                    if (!field.IsInitOnly) scalarValues[field] = value;
                    else if (clearCollections && value is IEnumerable)
                    {
                        var snapshot = new CollectionSnapshot(value);
                        collections.Add(snapshot); snapshot.Clear();
                    }
                }
            }
            private static FieldInfo Field(Type type, string name) => type.GetField(name, PrivateStatic)
                ?? throw new MissingFieldException(type.FullName, name);
            private static object Invoke(Type type, string name, params object[] args) =>
                (type.GetMethod(name, PrivateStatic) ?? throw new MissingMethodException(type.FullName, name)).Invoke(null, args);
            public void Dispose()
            {
                if (disposed) return;
                disposed = true;
                try
                {
                    ColliderField("_ready", false); ColliderField("_pending", null); ColliderField("_scenePath", string.Empty);
                    ConnectionField("<State>k__BackingField", TeamForgeConnectionState.Disconnected);
                    if (Box != null) EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                    AssetDatabase.DeleteAsset(scenePath);
                    if (AssetDatabase.IsValidFolder(Folder) && AssetDatabase.FindAssets(string.Empty, new[] { Folder }).Length == 0)
                        AssetDatabase.DeleteAsset(Folder);
                }
                finally
                {
                    foreach (var collection in collections) collection.Restore();
                    foreach (var scalar in scalarValues) scalar.Key.SetValue(null, scalar.Value);
                    shared.Dispose();
                }
            }
        }

        private sealed class RecordingTransport : IRealtimeTransport
        {
            internal readonly List<string> Messages = new List<string>();
            public event Action Connected { add { } remove { } }
            public event Action<string> TextReceived { add { } remove { } }
            public event Action<string> Closed { add { } remove { } }
            public event Action<Exception> Faulted { add { } remove { } }
            public Task ConnectAsync(CancellationToken cancellationToken) => Task.CompletedTask;
            public Task DisconnectAsync(CancellationToken cancellationToken) => Task.CompletedTask;
            public Task SendTextAsync(string text, CancellationToken cancellationToken) { Messages.Add(text); return Task.CompletedTask; }
            public void Dispose() { }
        }
        private sealed class CollectionSnapshot
        {
            private readonly object collection;
            private readonly List<DictionaryEntry> entries;
            private readonly List<object> items;
            internal CollectionSnapshot(object value)
            {
                collection = value;
                if (value is IDictionary dictionary)
                {
                    entries = new List<DictionaryEntry>();
                    foreach (DictionaryEntry entry in dictionary) entries.Add(entry);
                }
                else
                {
                    items = new List<object>();
                    foreach (var item in (IEnumerable)value) items.Add(item);
                }
            }
            internal void Clear() => collection.GetType().GetMethod("Clear").Invoke(collection, null);
            internal void Restore()
            {
                Clear();
                if (collection is IDictionary dictionary)
                    foreach (var entry in entries) dictionary.Add(entry.Key, entry.Value);
                else foreach (var item in items) collection.GetType().GetMethod("Add").Invoke(collection, new[] { item });
            }
        }
    }
}

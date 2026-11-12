using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
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
    // Exercises production request handling and retry scheduling against a real
    // saved Collider. Reflection isolates static Editor state without adding
    // test-only authorization or mutation entry points to production code.
    public sealed class TeamForgeColliderRequestLifecycleTests
    {
        private const BindingFlags StaticFields = BindingFlags.Static | BindingFlags.NonPublic;

        [TestCase("", "component_join_source_mismatch")]
        [TestCase("", "component_signed_source_unavailable")]
        [TestCase("11111111-1111-4111-8111-111111111111", "component_property_stale_revision")]
        [TestCase("11111111-1111-4111-8111-111111111111", "component_admission_busy")]
        [TestCase("11111111-1111-4111-8111-111111111111", "component_snapshot_size_limit")]
        [TestCase("11111111-1111-4111-8111-111111111111", "component_owner_missing")]
        public void JoinOrSnapshotRefusalPausesWithoutAnUnboundedResnapshotLoop(string previousEpoch, string error)
        {
            using (var scenario = new RequestScenario())
            {
                scenario.Set("_epoch", previousEpoch);
                scenario.Set("_snapshotRequest", "join-or-snapshot-current");
                scenario.Set("_awaitingJoinSnapshot", true);
                scenario.Set("_rejoinRequested", true);
                scenario.Set("_requestDeadline", EditorApplication.timeSinceStartup + 15);
                scenario.Reject(new TeamForgeComponentMessage
                {
                    requestId = "join-or-snapshot-current", sceneId = scenario.Before.SceneId,
                    epoch = string.Empty, error = error, reason = "Correct the source before retrying.",
                });

                scenario.AssertPaused();
                Assert.That(TeamForgeColliderSyncService.Status, Does.Contain(error));
                for (var index = 0; index < 6; index++) scenario.Update();
                scenario.AssertPaused();
                Assert.That(scenario.Transport.Messages, Is.Empty,
                    "A refused join/snapshot must not produce a new recovery request on every Editor frame.");
                Assert.That(scenario.Get<string>("_epoch"), Is.EqualTo(previousEpoch),
                    "A refusal must be handled before a missing or new response epoch can retire useful local state.");
            }
        }

        [Test]
        public void TerminalPropertyRefusalPreservesNewerLiveValueRatherThanImmutablePendingValue()
        {
            using (var scenario = new RequestScenario())
            {
                var desiredA = scenario.Before.WithValue(new Vector3(1f, 2f, 3f));
                var newerB = new Vector3(4f, 5f, 6f);
                scenario.Pending(desiredA);
                scenario.Set("_epoch", "11111111-1111-4111-8111-111111111111");
                scenario.Box.center = newerB;
                scenario.Set("_ready", true);
                scenario.Reject(new TeamForgeComponentMessage
                {
                    requestId = "property-current", operationId = "operation-current",
                    sceneId = scenario.Before.SceneId, epoch = "11111111-1111-4111-8111-111111111111",
                    error = "component_snapshot_size_limit", reason = "The complete snapshot exceeds its budget.",
                });

                scenario.AssertPaused();
                Assert.That(scenario.Recovery[scenario.Before.Key].Vector, Is.EqualTo(newerB));
                Assert.That(scenario.Box.center, Is.EqualTo(newerB));
                Assert.That(scenario.Authoritative[scenario.Before.Key].Vector, Is.EqualTo(Vector3.zero));
                Assert.That(scenario.Transport.Messages, Is.Empty);
                Assert.That(TeamForgeColliderSyncService.Status, Does.Contain("component_snapshot_size_limit"));
            }
        }

        [TestCase("older-property-request", "operation-current")]
        [TestCase("property-current", "older-operation")]
        [TestCase("older-property-request", "older-operation")]
        public void UncorrelatedPropertyRefusalCannotCancelCurrentOperationOrNewSnapshot(string requestId, string operationId)
        {
            using (var scenario = new RequestScenario())
            {
                var pending = scenario.Pending(scenario.Before.WithValue(Vector3.one));
                scenario.Set("_ready", true);
                scenario.Set("_snapshotRequest", "newer-snapshot-request");
                scenario.Set("_awaitingJoinSnapshot", true);
                scenario.Set("_requestDeadline", EditorApplication.timeSinceStartup + 15);
                scenario.Reject(new TeamForgeComponentMessage
                {
                    requestId = requestId, operationId = operationId, sceneId = scenario.Before.SceneId,
                    error = "component_property_conflict", reason = "An older request was refused.",
                });

                Assert.That(scenario.Get<object>("_pending"), Is.SameAs(pending));
                Assert.That(scenario.Get<string>("_snapshotRequest"), Is.EqualTo("newer-snapshot-request"));
                Assert.That(TeamForgeColliderSyncService.Ready, Is.True);
                Assert.That(scenario.Get<bool>("_manualRetryRequired"), Is.False);
                Assert.That(scenario.Recovery, Is.Empty);
                Assert.That(scenario.Transport.Messages, Is.Empty);
            }
        }

        [Test]
        public void EditorReportRefusalDoesNotCancelAnUnrelatedEditOrSnapshot()
        {
            using (var scenario = new RequestScenario())
            {
                var pending = scenario.Pending(scenario.Before.WithValue(Vector3.one));
                scenario.Set("_ready", true);
                scenario.Set("_snapshotRequest", "snapshot-current");
                scenario.Set("_reportRequest", "report-current");
                scenario.Reject(new TeamForgeComponentMessage
                {
                    requestId = "report-current", sceneId = scenario.Before.SceneId,
                    error = "component_apply_report_stale", reason = "A newer server snapshot exists.",
                });

                Assert.That(scenario.Get<string>("_reportRequest"), Is.Empty);
                Assert.That(scenario.Get<object>("_pending"), Is.SameAs(pending));
                Assert.That(scenario.Get<string>("_snapshotRequest"), Is.EqualTo("snapshot-current"));
                Assert.That(TeamForgeColliderSyncService.Ready, Is.True);
                Assert.That(TeamForgeColliderSyncService.ReportStatus, Does.Contain("component_apply_report_stale"));
                Assert.That(scenario.Transport.Messages, Is.Empty);
            }
        }

        [Test]
        public void AdmissionTimeoutPreservesLocalWorkAndRequiresManualRetry()
        {
            using (var scenario = new RequestScenario())
            {
                scenario.Box.center = new Vector3(7f, 8f, 9f);
                scenario.Set("_snapshotRequest", "timed-out-join");
                scenario.Set("_awaitingJoinSnapshot", true);
                scenario.Set("_rejoinRequested", true);
                scenario.Set("_requestDeadline", EditorApplication.timeSinceStartup - 1);
                scenario.Update();

                scenario.AssertPaused();
                Assert.That(scenario.Recovery[scenario.Before.Key].Vector, Is.EqualTo(new Vector3(7f, 8f, 9f)));
                for (var index = 0; index < 6; index++) scenario.Update();
                Assert.That(scenario.Transport.Messages, Is.Empty);
            }
        }

        [Test]
        public void LostAcknowledgementRetriesSamePayloadTwiceThenPausesAndKeepsLatestInspectorIntent()
        {
            using (var scenario = new RequestScenario())
            {
                var pending = scenario.Pending(scenario.Before.WithValue(new Vector3(1f, 2f, 3f)));
                scenario.Set("_ready", true);
                var latest = new Vector3(4f, 5f, 6f);
                scenario.Box.center = latest;
                scenario.Tick(14);
                scenario.Tick(18);
                Assert.That(scenario.Transport.Messages, Has.Count.EqualTo(2));
                Assert.That(scenario.Transport.Messages[0], Is.EqualTo(scenario.Transport.Messages[1]),
                    "ACK loss retries must retain the exact operation ID, revision, before-image, and value.");
                Assert.That(RequestScenario.PendingField(pending, "SendAttempts"), Is.EqualTo(3),
                    "The original attempt and two retries exhaust the same bounded operation budget.");
                scenario.Tick(22);

                scenario.AssertPaused();
                Assert.That(scenario.Recovery[scenario.Before.Key].Vector, Is.EqualTo(latest));
                for (var index = 0; index < 6; index++) scenario.Update();
                Assert.That(scenario.Transport.Messages, Has.Count.EqualTo(2),
                    "The expired operation cannot resume sending simply because the Editor continues updating.");
            }
        }

        [Test]
        public void EnteringPlayModePausesBeforeRuntimeObjectsCanReceiveSharedWrites()
        {
            using (var scenario = new RequestScenario())
            {
                scenario.Pending(scenario.Before.WithValue(Vector3.one));
                var latest = new Vector3(4f, 5f, 6f);
                scenario.Box.center = latest;
                scenario.Set("_ready", true);
                scenario.EnteringPlayMode();
                scenario.AssertPaused();
                Assert.That(scenario.Recovery[scenario.Before.Key].Vector, Is.EqualTo(latest));
                Assert.That(scenario.Box.center, Is.EqualTo(latest));
                Assert.That(scenario.Transport.Messages, Is.Empty);
                Assert.That(TeamForgeColliderSyncService.Status, Does.Contain("Play Mode"));
            }
        }


        [TestCase("timeout")]
        [TestCase("reject")]
        [TestCase("disconnect")]
        public void UnappliedUiResubmissionPreservesDesiredValueWhenLiveValueHasNotChanged(string outcome)
        {
            using (var scenario = new RequestScenario())
            {
                var liveA = scenario.Before.Vector;
                var desiredB = new Vector3(4f, 5f, 6f);
                scenario.Box.center = liveA;
                var pending = scenario.Pending(scenario.Before.WithValue(desiredB));
                scenario.Set("_ready", true);
                scenario.Set("_epoch", "11111111-1111-4111-8111-111111111111");
                if (outcome == "timeout")
                {
                    RequestScenario.SetPendingField(pending, "SendAttempts", 3);
                    scenario.Tick(22);
                }
                else if (outcome == "reject")
                    scenario.Reject(new TeamForgeComponentMessage
                    {
                        requestId = "property-current", operationId = "operation-current",
                        sceneId = scenario.Before.SceneId, epoch = "11111111-1111-4111-8111-111111111111",
                        error = "component_snapshot_size_limit", reason = "The server did not admit the resubmission.",
                    });
                else scenario.PreserveDisconnect();

                Assert.That(TeamForgeColliderSyncService.Pending, Is.False);
                Assert.That(TeamForgeColliderSyncService.Ready, Is.False);
                Assert.That(scenario.Box.center, Is.EqualTo(liveA), "An unconfirmed UI action must not change the live Scene.");
                Assert.That(scenario.Recovery[scenario.Before.Key].Vector, Is.EqualTo(desiredB),
                    "The unchanged live value is not a new user edit and must not replace the UI's pending desired value.");
                Assert.That(scenario.Transport.Messages, Is.Empty);
                Assert.That(ReadRecoveryCheckpoint(scenario)[scenario.Before.Key].Vector, Is.EqualTo(desiredB));
            }
        }

        [TestCase(false)]
        [TestCase(true)]
        public void PendingCheckpointForDomainReloadContainsUnappliedUiDesiredValue(bool staleInboxEntry)
        {
            using (var scenario = new RequestScenario())
            {
                var liveA = scenario.Before.Vector;
                var desiredB = new Vector3(4f, 5f, 6f);
                scenario.Box.center = liveA;
                scenario.Pending(scenario.Before.WithValue(desiredB));
                if (staleInboxEntry) scenario.Recovery[scenario.Before.Key] = scenario.Before.WithValue(liveA);
                else Assert.That(scenario.Recovery, Is.Empty, "The pending intent has not yet been copied to the recovery inbox.");
                scenario.SaveCheckpoint();

                Assert.That(ReadRecoveryCheckpoint(scenario)[scenario.Before.Key].Vector, Is.EqualTo(desiredB),
                    "Immediate Save must serialize the UI intent for domain reload even before failure/disconnect handling runs.");
                Assert.That(scenario.Box.center, Is.EqualTo(liveA));
                Assert.That(TeamForgeColliderSyncService.Pending, Is.True);
            }
        }

        [Test]
        public void NewInspectorEditAfterUiResubmissionWinsOverItsUnappliedDesiredValue()
        {
            using (var scenario = new RequestScenario())
            {
                scenario.Box.center = scenario.Before.Vector;
                var pending = scenario.Pending(scenario.Before.WithValue(new Vector3(4f, 5f, 6f)));
                var newLocalC = new Vector3(7f, 8f, 9f);
                scenario.Box.center = newLocalC;
                scenario.SaveCheckpoint();
                Assert.That(ReadRecoveryCheckpoint(scenario)[scenario.Before.Key].Vector, Is.EqualTo(newLocalC));
                RequestScenario.SetPendingField(pending, "SendAttempts", 3);
                scenario.Tick(22);

                scenario.AssertPaused();
                Assert.That(scenario.Recovery[scenario.Before.Key].Vector, Is.EqualTo(newLocalC));
                Assert.That(scenario.Box.center, Is.EqualTo(newLocalC));
            }
        }

        [Test]
        public void UserRevertToBeforeImageAfterObservedSendRemainsTheLatestLocalIntent()
        {
            using (var scenario = new RequestScenario())
            {
                var observedA = new Vector3(1f, 2f, 3f);
                scenario.Box.center = observedA;
                var pending = scenario.Pending(scenario.Before.WithValue(observedA));
                scenario.Box.center = scenario.Before.Vector;
                scenario.SaveCheckpoint();
                Assert.That(ReadRecoveryCheckpoint(scenario)[scenario.Before.Key].Vector, Is.EqualTo(scenario.Before.Vector));
                RequestScenario.SetPendingField(pending, "SendAttempts", 3);
                scenario.Tick(22);

                scenario.AssertPaused();
                Assert.That(scenario.Recovery[scenario.Before.Key].Vector, Is.EqualTo(scenario.Before.Vector),
                    "Reverting to the old server before-image is still a newer edit than the in-flight observed value.");
                Assert.That(scenario.Box.center, Is.EqualTo(scenario.Before.Vector));
            }
        }

        [Test]
        public void DirtySceneGuardIgnoresNestedFixtureBeforeMutatingTheOwnedSceneOrService()
        {
            using (var outer = new RequestScenario())
            {
                var pending = outer.Pending(outer.Before.WithValue(Vector3.one));
                outer.Set("_ready", true);
                outer.Set("_snapshotRequest", "outer-request-must-survive");
                var scene = outer.Box.gameObject.scene;
                var activeScene = SceneManager.GetActiveScene();
                var boxInstance = outer.Box.GetInstanceID();
                var beforeRows = new Dictionary<string, TeamForgeColliderProperty>(outer.Authoritative);
                EditorSceneManager.MarkSceneDirty(scene);

                IgnoreException refusal = null;
                try { using (var ignored = new RequestScenario()) { } }
                catch (IgnoreException exception) { refusal = exception; }
                Assert.That(refusal, Is.Not.Null, "A dirty open Scene must stop fixture construction before any mutation.");

                Assert.That(scene.IsValid() && scene.isLoaded && scene.isDirty, Is.True);
                Assert.That(SceneManager.GetActiveScene().handle, Is.EqualTo(activeScene.handle));
                Assert.That(outer.Box.GetInstanceID(), Is.EqualTo(boxInstance));
                Assert.That(outer.Get<object>("_pending"), Is.SameAs(pending));
                Assert.That(outer.Get<string>("_snapshotRequest"), Is.EqualTo("outer-request-must-survive"));
                Assert.That(TeamForgeColliderSyncService.Ready, Is.True);
                Assert.That(outer.Authoritative, Has.Count.EqualTo(beforeRows.Count));
                foreach (var pair in beforeRows) Assert.That(outer.Authoritative[pair.Key], Is.SameAs(pair.Value));
                Assert.That(outer.Recovery, Is.Empty);
                Assert.That(outer.Transport.Messages, Is.Empty);
            }
        }

        private static Dictionary<string, TeamForgeColliderProperty> ReadRecoveryCheckpoint(RequestScenario scenario)
        {
            var json = scenario.CheckpointJson;
            Assert.That(json, Is.Not.Empty);
            var checkpoint = JsonUtility.FromJson<RecoveryCheckpoint>(json);
            Assert.That(checkpoint, Is.Not.Null);
            Assert.That(checkpoint.recovery, Is.Not.Null);
            var result = new Dictionary<string, TeamForgeColliderProperty>(StringComparer.Ordinal);
            foreach (var rowJson in checkpoint.recovery)
            {
                Assert.That(TeamForgeColliderProperty.TryParseRow(rowJson, out var row, out var error), Is.True, error);
                Assert.That(result.ContainsKey(row.Key), Is.False, "A pending value must not duplicate an existing recovery key.");
                result.Add(row.Key, row);
            }
            return result;
        }
        [Serializable] private sealed class RecoveryCheckpoint { public string[] recovery; }

        private sealed class RequestScenario : IDisposable
        {
            private const string Folder = "Assets/__TeamForgeColliderRequestLifecycleTests";
            private readonly TeamForgeSharedEditorStateScope shared;
            private readonly Dictionary<FieldInfo, object> scalarValues = new Dictionary<FieldInfo, object>();
            private readonly List<CollectionSnapshot> collections = new List<CollectionSnapshot>();
            private readonly FieldInfo availability;
            private readonly object previousAvailability;
            private readonly string scenePath = Folder + "/" + Guid.NewGuid().ToString("N") + ".unity";
            private string recoveryPath;
            private string sessionStateKey;
            private bool disposed;

            internal RequestScenario()
            {
                // This guard precedes all shared-state snapshots, service access,
                // connection changes, asset writes, or Scene replacement.
                for (var index = 0; index < SceneManager.sceneCount; index++)
                    if (SceneManager.GetSceneAt(index).isDirty)
                        Assert.Ignore("Collider lifecycle tests require clean open Scenes; unsaved user work was preserved.");
                shared = new TeamForgeSharedEditorStateScope();
                availability = ConnectionField("<ComponentPropertySyncAvailable>k__BackingField");
                previousAvailability = availability.GetValue(null);
                try
                {
                    // Accessing the fields also initializes the production service.
                    foreach (var field in typeof(TeamForgeColliderSyncService).GetFields(StaticFields))
                    {
                        if (field.IsLiteral) continue;
                        var value = field.GetValue(null);
                        if (field.IsInitOnly && value is IEnumerable)
                        {
                            var snapshot = new CollectionSnapshot(value);
                            collections.Add(snapshot); snapshot.Clear();
                        }
                        else if (!field.IsInitOnly) scalarValues.Add(field, value);
                    }
                    Set("_pending", null); Set("_ready", false); Set("_pin", null);
                    Set("_snapshotRequest", string.Empty); Set("_reportRequest", string.Empty);
                    Set("_awaitingJoinSnapshot", false); Set("_rejoinRequested", false);
                    Set("_manualRetryRequired", false); Set("_wasConnected", false);
                    Set("_epoch", string.Empty); Set("_requestDeadline", 0d);
                    Set("_stateProjectId", "collider-request-tests-" + Guid.NewGuid().ToString("N"));
                    Set("_stateSessionId", "isolated-lifecycle-tests");
                    ConnectionField("<State>k__BackingField").SetValue(null, TeamForgeConnectionState.Disconnected);
                    ConnectionField("_transport").SetValue(null, Transport);
                    availability.SetValue(null, true);
                    using (TeamForgeTransformSyncService.SuppressSelectionLock())
                        TeamForgeSharedEditorStateScope.SetSingleSelection(null);
                    if (!AssetDatabase.IsValidFolder(Folder)) AssetDatabase.CreateFolder("Assets", "__TeamForgeColliderRequestLifecycleTests");
                    var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                    Box = new GameObject("Lifecycle Collider target").AddComponent<BoxCollider>();
                    Assert.That(EditorSceneManager.SaveScene(scene, scenePath), Is.True);
                    Assert.That(TeamForgeWp6InspectorProbe.TryCapture(Box, out var observed, out var error), Is.True, error);
                    foreach (var value in observed.Properties)
                    {
                        var row = TeamForgeColliderProperty.FromObservation(observed, value);
                        Authoritative.Add(row.Key, row);
                        if (row.Path == "m_Center") Before = row;
                    }
                    Set("_sceneId", observed.SceneId); Set("_scenePath", scenePath);
                    recoveryPath = (string)Invoke("LocalStatePath");
                    sessionStateKey = (string)RequiredField("StateKey").GetRawConstantValue() + Path.GetFileName(recoveryPath);
                    ConnectionField("<State>k__BackingField").SetValue(null, TeamForgeConnectionState.Connected);
                }
                catch { Dispose(); throw; }
            }

            internal BoxCollider Box { get; }
            internal TeamForgeColliderProperty Before { get; }
            internal RecordingTransport Transport { get; } = new RecordingTransport();
            internal Dictionary<string, TeamForgeColliderProperty> Authoritative => Get<Dictionary<string, TeamForgeColliderProperty>>("Authoritative");
            internal Dictionary<string, TeamForgeColliderProperty> Recovery => Get<Dictionary<string, TeamForgeColliderProperty>>("Recovery");
            internal T Get<T>(string name) => (T)RequiredField(name).GetValue(null);
            internal void Set(string name, object value) => RequiredField(name).SetValue(null, value);
            internal void Reject(TeamForgeComponentMessage message) => Invoke("HandleRejection", message);
            internal void Update() => Invoke("Update");
            internal void Tick(double now) => Invoke("TickPendingRequest", now);
            internal void EnteringPlayMode() => Invoke("OnPlayModeStateChanged", PlayModeStateChange.ExitingEditMode);
            internal void PreserveDisconnect() => Invoke("PreserveBeforeDisconnect");
            internal void SaveCheckpoint() => Invoke("Save");
            internal string CheckpointJson => SessionState.GetString(sessionStateKey, string.Empty);
            internal object Pending(TeamForgeColliderProperty desired)
            {
                var type = typeof(TeamForgeColliderSyncService).GetNestedType("PendingOperation", BindingFlags.NonPublic);
                Assert.That(type, Is.Not.Null);
                var pending = Activator.CreateInstance(type, true);
                Assert.That(TeamForgeColliderProperty.TryRead(desired, out var liveAtSend, out var error), Is.True, error);
                var fields = new Dictionary<string, object>
                {
                    { "Before", Before }, { "Desired", desired }, { "LiveAtSend", liveAtSend }, { "RequestId", "property-current" },
                    { "OperationId", "operation-current" }, { "SendAttempts", 1 }, { "SentAt", 10d },
                    { "Json", "{\"type\":\"component_property_set\",\"protocolVersion\":1,\"requestId\":\"property-current\",\"operationId\":\"operation-current\"}" },
                };
                foreach (var field in fields)
                    type.GetField(field.Key, BindingFlags.Instance | BindingFlags.NonPublic).SetValue(pending, field.Value);
                Set("_pending", pending); return pending;
            }
            internal static object PendingField(object pending, string name) =>
                pending.GetType().GetField(name, BindingFlags.Instance | BindingFlags.NonPublic).GetValue(pending);
            internal static void SetPendingField(object pending, string name, object value) =>
                pending.GetType().GetField(name, BindingFlags.Instance | BindingFlags.NonPublic).SetValue(pending, value);
            internal void AssertPaused()
            {
                Assert.That(TeamForgeColliderSyncService.Ready, Is.False);
                Assert.That(TeamForgeColliderSyncService.Pending, Is.False);
                Assert.That(Get<string>("_snapshotRequest"), Is.Empty);
                Assert.That(Get<bool>("_awaitingJoinSnapshot"), Is.False);
                Assert.That(Get<bool>("_rejoinRequested"), Is.False);
                Assert.That(Get<bool>("_manualRetryRequired"), Is.True);
                Assert.That(Get<double>("_requestDeadline"), Is.Zero);
            }
            private static FieldInfo RequiredField(string name) => typeof(TeamForgeColliderSyncService).GetField(name, StaticFields)
                ?? throw new MissingFieldException(typeof(TeamForgeColliderSyncService).FullName, name);
            private static FieldInfo ConnectionField(string name) => typeof(TeamForgeConnectionService).GetField(name, StaticFields)
                ?? throw new MissingFieldException(typeof(TeamForgeConnectionService).FullName, name);
            private static object Invoke(string name, params object[] arguments)
            {
                var method = typeof(TeamForgeColliderSyncService).GetMethod(name, StaticFields)
                    ?? throw new MissingMethodException(typeof(TeamForgeColliderSyncService).FullName, name);
                return method.Invoke(null, arguments);
            }
            public void Dispose()
            {
                if (disposed) return;
                disposed = true;
                try
                {
                    Set("_ready", false); Set("_pending", null); Set("_scenePath", string.Empty);
                    ConnectionField("<State>k__BackingField").SetValue(null, TeamForgeConnectionState.Disconnected);
                    if (Box != null) EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                    AssetDatabase.DeleteAsset(scenePath);
                    if (AssetDatabase.IsValidFolder(Folder) && AssetDatabase.FindAssets(string.Empty, new[] { Folder }).Length == 0)
                        AssetDatabase.DeleteAsset(Folder);
                    if (!string.IsNullOrEmpty(recoveryPath) && File.Exists(recoveryPath)) File.Delete(recoveryPath);
                    if (!string.IsNullOrEmpty(sessionStateKey)) SessionState.EraseString(sessionStateKey);
                }
                finally
                {
                    foreach (var collection in collections) collection.Restore();
                    foreach (var scalar in scalarValues) scalar.Key.SetValue(null, scalar.Value);
                    availability.SetValue(null, previousAvailability);
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
                else
                    foreach (var item in items) collection.GetType().GetMethod("Add").Invoke(collection, new[] { item });
            }
        }
    }
}

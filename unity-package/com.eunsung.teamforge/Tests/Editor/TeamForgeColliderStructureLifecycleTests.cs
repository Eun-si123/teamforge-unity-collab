using System;
using System.Collections.Generic;
using System.Reflection;
using NUnit.Framework;
using UnityEngine;

namespace EunSung.TeamForge.Tests
{
    public sealed class TeamForgeColliderStructureLifecycleTests
    {
        private const BindingFlags Static = BindingFlags.Static | BindingFlags.NonPublic;
        private const BindingFlags Instance = BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public;

        [Test]
        public void CatalogWireRequiresNativeRevisionAndExactIdentityFields()
        {
            const string scene = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
            var owner = "GlobalObjectId_V1-2-" + scene + "-10-0";
            var row = "{\"sceneId\":\"" + scene + "\",\"objectId\":\"" + owner +
                "\",\"componentId\":\"tf:c:11111111111111111111111111111111\",\"typeName\":\"UnityEngine.BoxCollider\",\"serverRevision\":1}";
            var json = "{\"structureVersion\":1,\"structureRevision\":1,\"components\":[" + row + "]}";
            Assert.That(TeamForgeColliderPropertyWire.TryParseCatalog(json, "components", 512, out var rows, out var error), Is.True, error);
            Assert.That(rows, Has.Count.EqualTo(1));
            foreach (var invalid in new[]
            {
                json.Replace("\"serverRevision\":1", "\"serverRevision\":\"1\""),
                json.Replace("\"serverRevision\":1", "\"serverRevision\":1,\"serverRevision\":2"),
                json.Replace("\"serverRevision\":1", "\"serverRevision\":1,\"arbitraryField\":true"),
                json.Replace("\"typeName\":\"UnityEngine.BoxCollider\",", string.Empty),
                json.Replace("\"structureRevision\":1", "\"structureRevision\":\"1\""),
                json.Replace("\"structureVersion\":1", "\"structureVersion\":\"1\""),
                json.Replace("tf:c:11111111111111111111111111111111", "tf:c:1111111111111111111111111111111X"),
            })
                Assert.That(TeamForgeColliderPropertyWire.TryParseCatalog(invalid, "components", 512, out _, out _), Is.False, invalid);
            Assert.That(TeamForgeColliderPropertyWire.TryParseCatalog(json, "components", 0, out _, out _), Is.False,
                "The same valid native row still requires the caller's catalog count budget.");
            Assert.That(TeamForgeColliderPropertyWire.TryParseCatalog(
                "{\"structureVersion\":1,\"structureRevision\":2,\"components\":[]}", "components", 512, out rows, out error), Is.True, error);
            Assert.That(rows, Is.Empty, "Removing the last Component must remain a valid runtime catalog.");
        }

        [Test]
        public void PendingStructureLostAckRetriesExactPayloadThenPreservesIntentAndUnrelatedInspectorEdit()
        {
            using (var scenario = new Scenario())
            {
                var intent = scenario.InstallPending();
                scenario.Box.center = new Vector3(7f, 8f, 9f);
                Invoke("TickPendingStructure", 14d); Invoke("TickPendingStructure", 18d);
                Assert.That(scenario.Messages, Has.Count.EqualTo(2));
                Assert.That(scenario.Messages[0], Is.EqualTo(scenario.Messages[1]));
                Assert.That(scenario.Messages[0], Does.Contain(intent.operationId));
                Invoke("TickPendingStructure", 22d);
                Assert.That(TeamForgeColliderSyncService.Pending, Is.False);
                Assert.That(TeamForgeColliderSyncService.Ready, Is.False);
                Assert.That(TeamForgeColliderSyncService.StructureRecoveryCount, Is.EqualTo(1));
                Assert.That(scenario.Box.gameObject.GetComponents<Collider>(), Has.Length.EqualTo(1),
                    "A lost structural ACK cannot create an unapproved local Component.");
                Assert.That(scenario.Box.center, Is.EqualTo(new Vector3(7f, 8f, 9f)));
                var recovery = Get<Dictionary<string, TeamForgeColliderProperty>>("Recovery");
                Assert.That(recovery[scenario.Before.Key].Vector, Is.EqualTo(scenario.Box.center));
                var saved = JsonUtility.FromJson<IntentCheckpoint>(scenario.CheckpointJson);
                Assert.That(saved.structureRecovery, Has.Length.EqualTo(1));
                Assert.That(saved.structureRecovery[0].operationId, Is.EqualTo(intent.operationId));
                Assert.That(saved.structureRecovery[0].componentId, Is.EqualTo(intent.componentId));
                Assert.That(saved.structureRecovery[0].kind, Is.EqualTo("add_component"));
            }
        }

        [Test]
        public void UnrelatedStructureRefusalCannotCancelTheCurrentPendingIntent()
        {
            using (var scenario = new Scenario())
            {
                var intent = scenario.InstallPending();
                var pending = Get<object>("_structurePending");
                Invoke("HandleRejection", new TeamForgeComponentMessage
                { requestId = "older-request", operationId = intent.operationId, error = "component_structure_stale_revision" });
                Invoke("HandleRejection", new TeamForgeComponentMessage
                { requestId = intent.requestId, operationId = "older-operation", error = "component_structure_stale_revision" });
                Assert.That(Get<object>("_structurePending"), Is.SameAs(pending));
                Assert.That(TeamForgeColliderSyncService.StructureRecoveryCount, Is.Zero);
                Assert.That(scenario.Messages, Is.Empty);
            }
        }

        [TestCase(false)]
        [TestCase(true)]
        public void KnownStructureReceiptIgnoresOnlyOldOrExactSnapshotWithoutOverwritingNewLocalIntent(bool newerSnapshot)
        {
            using (var scenario = new Scenario())
            {
                var latestLocal = new Vector3(7f, 8f, 9f);
                scenario.Box.center = latestLocal;
                Set("_revision", 5L); Set("_snapshotHash", new string('a', 64));
                Get<HashSet<string>>("ReceivedOperations").Add("accepted-structure-operation");
                var message = new TeamForgeComponentMessage
                {
                    type = "component_structure_applied", protocolVersion = 1,
                    operationId = "accepted-structure-operation", operationRevision = 2,
                    kind = "add_component", epoch = Get<string>("_epoch"), sceneId = scenario.Before.SceneId,
                    serverRevision = newerSnapshot ? 6 : 5, snapshotHash = new string('a', 64),
                };
                Invoke("ApplyStructureOperation", message, "{}");
                Assert.That(scenario.Box.center, Is.EqualTo(latestLocal));
                Assert.That(scenario.Box.gameObject.GetComponents<Collider>(), Has.Length.EqualTo(1));
                if (!newerSnapshot)
                {
                    Assert.That(TeamForgeColliderSyncService.Ready, Is.True);
                    Assert.That(TeamForgeColliderSyncService.RecoveryCount, Is.Zero,
                        "An exact accepted duplicate must leave a fresh local edit eligible for the normal observer.");
                }
                else
                {
                    Assert.That(TeamForgeColliderSyncService.Ready, Is.False);
                    Assert.That(TeamForgeColliderSyncService.Status, Does.Contain("snapshot refused"),
                        "A known receipt at a NEWER snapshot revision must still validate the complete source/catalog.");
                }
                Assert.That(scenario.Messages, Is.Empty);
            }
        }

        [TestCase("add_component")]
        [TestCase("remove_component")]
        public void UnconfirmedConditionalInverseRetainsItsProofAndCannotBecomeAnOrdinaryOperation(string kind)
        {
            using (var scenario = new Scenario())
            {
                var intent = scenario.InstallPending(kind, "owned-previous-operation", 12, -1);
                Invoke("PreserveBeforeDisconnect");
                var saved = JsonUtility.FromJson<IntentCheckpoint>(scenario.CheckpointJson);
                Assert.That(saved.structureRecovery, Has.Length.EqualTo(1));
                var recovered = saved.structureRecovery[0];
                Assert.That(recovered.componentId, Is.EqualTo(intent.componentId));
                Assert.That(recovered.epoch, Is.EqualTo(intent.epoch));
                Assert.That(recovered.compensatesOperationId, Is.EqualTo("owned-previous-operation"));
                Assert.That(recovered.expectedComponentRevision, Is.EqualTo(12));
                Assert.That(recovered.historyDirection, Is.EqualTo(-1));
                Set("_ready", true);
                Assert.That(TeamForgeColliderSyncService.ResubmitStructureRecovery(out var error), Is.False);
                Assert.That(error, Does.Contain("conditional inverse"));
                Assert.That(TeamForgeColliderSyncService.StructureRecoveryCount, Is.EqualTo(1));
                Assert.That(TeamForgeColliderSyncService.Pending, Is.False);
                Assert.That(scenario.Messages, Is.Empty,
                    "A missing original inverse condition must never become default Add or current-version Remove.");
                Assert.That(scenario.Box.gameObject.GetComponents<Collider>(), Has.Length.EqualTo(1));
            }
        }

        [TestCase("digest")]
        [TestCase("file")]
        [TestCase("meta")]
        [TestCase("omitted-component")]
        [TestCase("older-structure")]
        public void ForgedStructureSourceOrDigestCannotBindOrCreateAnyComponent(string altered)
        {
            using (var scenario = new Scenario())
            {
                var source = new TeamForgeComponentSource
                {
                    projectUuid = "11111111-1111-4111-8111-111111111111", baselineRevision = 1,
                    manifestHash = new string('a', 64), descriptorHash = new string('b', 64),
                    scenePath = Get<string>("_scenePath"), sceneFileSha256 = new string('c', 64), sceneMetaSha256 = new string('d', 64),
                };
                Set("_source", source); Set("_snapshotRequest", "snapshot-current"); Set("_awaitingJoinSnapshot", true);
                var original = new TeamForgeColliderComponentCatalogRow
                { sceneId = scenario.Before.SceneId, objectId = scenario.Before.ObjectId, componentId = scenario.Before.ComponentId,
                    typeName = scenario.Before.TypeName, serverRevision = 1 };
                var added = new TeamForgeColliderComponentCatalogRow
                { sceneId = original.sceneId, objectId = original.objectId, componentId = "tf:c:11111111111111111111111111111111",
                    typeName = "UnityEngine.BoxCollider", serverRevision = 1 };
                var components = new List<TeamForgeColliderComponentCatalogRow> { original, added };
                components.Sort((a, b) => string.CompareOrdinal(a.componentId, b.componentId));
                var incomingSource = JsonUtility.FromJson<TeamForgeComponentSource>(JsonUtility.ToJson(source));
                if (altered == "file") incomingSource.sceneFileSha256 = new string('f', 64);
                if (altered == "meta") incomingSource.sceneMetaSha256 = new string('f', 64);
                var message = new TeamForgeComponentMessage
                {
                    type = "component_snapshot", protocolVersion = 1, requestId = "snapshot-current", source = incomingSource,
                    epoch = "11111111-1111-4111-8111-111111111111", sceneId = original.sceneId,
                    structureVersion = 1, structureRevision = 1, serverRevision = 1,
                    components = components.ToArray(), tombstones = Array.Empty<TeamForgeColliderComponentCatalogRow>(), snapshotHash = new string('e', 64),
                };
                var rows = new List<string>();
                var digestRows = new List<TeamForgeColliderProperty>();
                foreach (var row in Get<Dictionary<string, TeamForgeColliderProperty>>("Authoritative").Values)
                {
                    var existing = row.WithRevision(1);
                    var created = new TeamForgeColliderProperty(row.SceneId, row.ObjectId, added.componentId,
                        row.TypeName, row.Path, row.Kind, row.Boolean, row.Number, row.Vector, 1);
                    rows.Add(WithRevision(existing)); rows.Add(WithRevision(created));
                    digestRows.Add(existing); digestRows.Add(created);
                }
                if (altered == "omitted-component")
                {
                    Get<Dictionary<string, TeamForgeColliderComponentCatalogRow>>("Catalog").Add(original.componentId, original.Copy());
                    components.Clear(); rows.Clear(); digestRows.Clear(); message.components = components.ToArray();
                }
                if (altered == "older-structure") Set("_structureRevision", 2L);
                if (altered != "digest")
                    message.snapshotHash = TeamForgeColliderSnapshotDigest.ComputeV2(incomingSource, message.epoch,
                        message.sceneId, message.serverRevision, message.structureRevision, components,
                        Array.Empty<TeamForgeColliderComponentCatalogRow>(), digestRows);
                var json = JsonUtility.ToJson(message);
                json = json.Substring(0, json.Length - 1) + ",\"properties\":[" + string.Join(",", rows) + "]}";
                var bindingContext = TeamForgeColliderComponentBindings.ContextIdentity;
                var entity = scenario.Box.GetEntityId();
                Assert.That((bool)Invoke("ApplyStructureSnapshot", message, json, true), Is.False);
                Assert.That(TeamForgeColliderSyncService.Status, Does.Contain(altered == "digest" ? "digest mismatch" : "snapshot refused"));
                Assert.That(TeamForgeColliderComponentBindings.ContextIdentity, Is.EqualTo(bindingContext));
                Assert.That(scenario.Box.GetEntityId(), Is.EqualTo(entity));
                Assert.That(scenario.Box.gameObject.GetComponents<Collider>(), Has.Length.EqualTo(1));
                Assert.That(scenario.Messages, Is.Empty);
            }
        }

        private static string WithRevision(TeamForgeColliderProperty row)
        { var json = row.ToWireJson(); return json.Substring(0, json.Length - 1) + ",\"serverRevision\":1}"; }
        private static T Get<T>(string name) => (T)typeof(TeamForgeColliderSyncService).GetField(name, Static).GetValue(null);
        private static void Set(string name, object value) => typeof(TeamForgeColliderSyncService).GetField(name, Static).SetValue(null, value);
        private static object Invoke(string method, params object[] args) => typeof(TeamForgeColliderSyncService).GetMethod(method, Static).Invoke(null, args);
        [Serializable] private sealed class IntentCheckpoint { public Intent[] structureRecovery; }
        [Serializable] private sealed class Intent
        {
            public string operationId; public string componentId; public string kind;
            public string epoch; public string compensatesOperationId; public long expectedComponentRevision; public int historyDirection;
        }

        // Reuse the existing isolated real saved-Scene fixture through reflection;
        // no production authorization or mutation APIs are introduced for tests.
        private sealed class Scenario : IDisposable
        {
            private readonly object inner;
            private readonly Type type;
            private readonly FieldInfo structureAvailability = typeof(TeamForgeConnectionService).GetField("<ComponentStructureSyncAvailable>k__BackingField", Static);
            private readonly object oldAvailability;
            internal Scenario()
            {
                type = typeof(TeamForgeColliderRequestLifecycleTests).GetNestedType("RequestScenario", BindingFlags.NonPublic);
                try { inner = Activator.CreateInstance(type, true); }
                catch (TargetInvocationException exception) when (exception.InnerException is IgnoreException)
                { throw exception.InnerException; }
                oldAvailability = structureAvailability.GetValue(null);
                structureAvailability.SetValue(null, true);
                Set("_structurePending", null); Set("_structureVersion", 1); Set("_structureRevision", 0L);
                Set("_ready", true); Set("_epoch", "11111111-1111-4111-8111-111111111111");
            }
            internal BoxCollider Box => (BoxCollider)type.GetProperty("Box", Instance).GetValue(inner);
            internal TeamForgeColliderProperty Before => (TeamForgeColliderProperty)type.GetProperty("Before", Instance).GetValue(inner);
            internal string CheckpointJson => (string)type.GetProperty("CheckpointJson", Instance).GetValue(inner);
            internal List<string> Messages
            {
                get
                {
                    var transport = type.GetProperty("Transport", Instance).GetValue(inner);
                    return (List<string>)transport.GetType().GetField("Messages", Instance).GetValue(transport);
                }
            }
            internal TeamForgeComponentStructureSet InstallPending(string kind = "add_component", string compensation = "", long expected = 0, int direction = 0)
            {
                var intent = new TeamForgeComponentStructureSet
                {
                    type = "component_structure_set", protocolVersion = 1, requestId = "structure-current",
                    operationId = "structure-operation-current", epoch = Get<string>("_epoch"), sceneId = Before.SceneId,
                    kind = kind, objectId = Before.ObjectId, componentId = "tf:c:11111111111111111111111111111111",
                    typeName = "UnityEngine.BoxCollider", baseRevision = 1, expectedComponentRevision = expected, compensatesOperationId = compensation,
                };
                var pendingType = typeof(TeamForgeColliderSyncService).GetNestedType("PendingStructure", BindingFlags.NonPublic);
                var pending = Activator.CreateInstance(pendingType, true);
                foreach (var pair in new Dictionary<string, object>
                { { "Intent", intent }, { "Json", JsonUtility.ToJson(intent) }, { "SentAt", 10d }, { "Attempts", 1 }, { "HistoryDirection", direction } })
                    pendingType.GetField(pair.Key, Instance).SetValue(pending, pair.Value);
                Set("_structurePending", pending); return intent;
            }
            public void Dispose()
            {
                try { structureAvailability.SetValue(null, oldAvailability); }
                finally { ((IDisposable)inner).Dispose(); }
            }
        }
    }
}

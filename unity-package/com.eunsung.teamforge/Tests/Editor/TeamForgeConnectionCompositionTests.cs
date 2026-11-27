using System;
using System.Collections;
using System.Net.WebSockets;
using System.Reflection;
using System.Threading;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;

namespace EunSung.TeamForge.Tests
{
    public sealed class TeamForgeConnectionCompositionTests
    {
        private const BindingFlags InstanceMembers =
            BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;

        [Test]
        public void NativeDeleteWitnessSurvivesHierarchyAckUntilExactSignedColliderTombstone()
        {
            if (TeamForgeConnectionService.State != TeamForgeConnectionState.Disconnected)
                Assert.Ignore("The native deletion regression cannot disturb a live shared Editor Session.");
            // The server commits M3 Hierarchy+Collider atomically but delivers
            // separate receipts. Never clear the only proof of native deletion
            // between those two frames, even after a normal Editor Update.
            const BindingFlags flags = BindingFlags.Static | BindingFlags.NonPublic;
            var field = typeof(TeamForgeHierarchySyncService).GetField("_nativeDeletionWitness", flags);
            var observer = typeof(TeamForgeHierarchySyncService).GetMethod(
                "ObserveNativePrimitiveDeletionWitness", flags);
            Assert.That(field, Is.Not.Null);
            Assert.That(observer, Is.Not.Null);
            var saved = field.GetValue(null);
            var fixture = Activator.CreateInstance(field.FieldType, true);
            var memberFlags = BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public;
            var sceneId = Guid.NewGuid().ToString("N");
            var objectId = "tf:" + Guid.NewGuid().ToString("N");
            var epoch = Guid.NewGuid().ToString("D");
            field.FieldType.GetField("SceneId", memberFlags).SetValue(fixture, sceneId);
            field.FieldType.GetField("ObjectId", memberFlags).SetValue(fixture, objectId);
            field.FieldType.GetField("Epoch", memberFlags).SetValue(fixture, epoch);
            field.FieldType.GetField("Template", memberFlags).SetValue(
                fixture, TeamForgePrimitiveTemplateRuntime.Cube);
            field.FieldType.GetField("OperationId", memberFlags).SetValue(fixture, "native-delete-ack-test");
            var accepted = field.FieldType.GetField("HierarchyAccepted", memberFlags);
            Assert.That(accepted, Is.Not.Null);
            var tombstone = new TeamForgeColliderComponentCatalogRow
            {
                sceneId = sceneId, objectId = objectId,
                componentId = "tf:c:" + Guid.NewGuid().ToString("N"),
                typeName = "UnityEngine.BoxCollider",
            };
            try
            {
                field.SetValue(null, fixture);
                observer.Invoke(null, null);
                Assert.That(field.GetValue(null), Is.SameAs(fixture),
                    "An in-flight native deletion witness must survive observation before final M2 approval.");
                accepted.SetValue(fixture, true);
                observer.Invoke(null, null);
                Assert.That(field.GetValue(null), Is.SameAs(fixture),
                    "The Hierarchy ACK alone is not the signed Collider tombstone.");
                TeamForgeHierarchySyncService.RetireNativeDeletionAfterVerifiedTopology(
                    sceneId, epoch, Array.Empty<TeamForgeColliderComponentCatalogRow>(),
                    Array.Empty<TeamForgeColliderComponentCatalogRow>());
                Assert.That(field.GetValue(null), Is.SameAs(fixture),
                    "An unrelated M2 snapshot cannot retire native deletion authority.");
                TeamForgeHierarchySyncService.RetireNativeDeletionAfterVerifiedTopology(
                    sceneId, Guid.NewGuid().ToString("D"),
                    Array.Empty<TeamForgeColliderComponentCatalogRow>(), new[] { tombstone });
                Assert.That(field.GetValue(null), Is.SameAs(fixture),
                    "A different Coordinator epoch must never consume the witness.");
                TeamForgeHierarchySyncService.RetireNativeDeletionAfterVerifiedTopology(
                    sceneId, epoch, new[] { tombstone }, new[] { tombstone });
                Assert.That(field.GetValue(null), Is.SameAs(fixture),
                    "An active Collider is not deleted, even if an invalid matching tombstone is offered.");
                TeamForgeHierarchySyncService.RetireNativeDeletionAfterVerifiedTopology(
                    sceneId, epoch, Array.Empty<TeamForgeColliderComponentCatalogRow>(), new[] { tombstone });
                Assert.That(field.GetValue(null), Is.Null,
                    "Only the exactly matching verified Collider removal finishes the native delete flow.");
            }
            finally { field.SetValue(null, saved); }
        }

        [Test]
        public void NativeAddWithLostReceiptDoesNotBlockFutureInspectorAddsAfterVerifiedSnapshot()
        {
            if (TeamForgeConnectionService.State != TeamForgeConnectionState.Disconnected)
                Assert.Ignore("The native origin lifecycle fixture must not disturb an active Editor Session.");
            var service = typeof(TeamForgeConnectionService).Assembly.GetType(
                "EunSung.TeamForge.TeamForgeColliderSyncService", true);
            const BindingFlags flags = BindingFlags.Static | BindingFlags.NonPublic;
            var originField = service.GetField("_nativeAddition", flags);
            var pendingField = service.GetField("_structurePending", flags);
            var retire = service.GetMethod("RetireUnconfirmedNativeAdditionAfterSnapshot", flags);
            Assert.That(new object[] { originField, pendingField, retire }, Does.Not.Contain(null));
            var original = originField.GetValue(null);
            var existingPending = pendingField.GetValue(null);
            var origin = Activator.CreateInstance(originField.FieldType, true);
            var id = originField.FieldType.GetField("ComponentId",
                BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public);
            Assert.That(id, Is.Not.Null);
            id.SetValue(origin, "tf:c:" + Guid.NewGuid().ToString("N"));
            try
            {
                originField.SetValue(null, origin);
                pendingField.SetValue(null, Activator.CreateInstance(pendingField.FieldType, true));
                retire.Invoke(null, null);
                Assert.That(originField.GetValue(null), Is.SameAs(origin),
                    "A verified snapshot may not drop an origin while its exact M2 operation is pending.");
                pendingField.SetValue(null, null);
                retire.Invoke(null, null);
                Assert.That(originField.GetValue(null), Is.Null,
                    "An unaccepted origin must not poison every subsequent Unity Inspector addition.");
            }
            finally
            {
                originField.SetValue(null, original);
                pendingField.SetValue(null, existingPending);
            }
        }

        [Test]
        public void UnverifiedSelectionNeverGrowsTheSignedColliderOwnerCache()
        {
            // This selection handler is global even when there is no signed
            // Collider Scene. A long Editor session must not pin every local
            // GameObject ever clicked, nor assume its Components were shared.
            var service = typeof(TeamForgeConnectionService).Assembly.GetType(
                "EunSung.TeamForge.TeamForgeColliderSyncService", true);
            var cacheField = service.GetField("NativeOwnerColliderBaselines",
                BindingFlags.Static | BindingFlags.NonPublic);
            var prime = service.GetMethod("PrimeNativeColliderObservation",
                BindingFlags.Static | BindingFlags.NonPublic);
            var remember = service.GetMethod("RememberObservedNativeCollider",
                BindingFlags.Static | BindingFlags.NonPublic);
            Assert.That(cacheField, Is.Not.Null);
            Assert.That(prime, Is.Not.Null);
            Assert.That(remember, Is.Not.Null);
            var cache = cacheField.GetValue(null) as IDictionary;
            Assert.That(cache, Is.Not.Null);
            var originalSelection = Selection.activeObject;
            var owner = new GameObject("Unverified TeamForge selection only");
            var localCollider = owner.AddComponent<BoxCollider>();
            try
            {
                var before = cache.Count;
                using (TeamForgeTransformSyncService.SuppressSelectionLock())
                    Selection.activeGameObject = owner;
                prime.Invoke(null, null);
                remember.Invoke(null, new object[] { owner, localCollider.GetEntityId() });
                Assert.That(cache.Contains(owner), Is.False,
                    "Only an authenticated Scene catalog may seed the persistent native owner cache.");
                Assert.That(cache.Count, Is.EqualTo(before));
            }
            finally
            {
                using (TeamForgeTransformSyncService.SuppressSelectionLock())
                    Selection.activeObject = originalSelection;
                UnityEngine.Object.DestroyImmediate(owner);
            }
        }

        [Test]
        public void HistoricHiddenSessionFlagsCannotDisableNativeUnityCollaboration()
        {
            const string propertyKey = "EunSung.TeamForge.ColliderSync.Enabled.v1";
            const string structureKey = "EunSung.TeamForge.ColliderStructureSync.Enabled.v1";
            const string primitiveKey = "EunSung.TeamForge.PrimitiveTemplateSync.Enabled.v1";
            var priorProperty = SessionState.GetBool(propertyKey, true);
            var priorStructure = SessionState.GetBool(structureKey, true);
            var priorPrimitive = SessionState.GetBool(primitiveKey, true);
            var availableProperty = TeamForgeConnectionService.ComponentPropertySyncOptIn;
            var availableStructure = TeamForgeConnectionService.ComponentStructureSyncOptIn;
            var availablePrimitive = TeamForgeConnectionService.PrimitiveTemplateSyncOptIn;
            try
            {
                // These keys were set by experimental opt-in UI in earlier
                // builds. They must no longer affect the current native path.
                SessionState.SetBool(propertyKey, false);
                SessionState.SetBool(structureKey, false);
                SessionState.SetBool(primitiveKey, false);
                Assert.That(TeamForgeConnectionService.ComponentPropertySyncOptIn,
                    Is.EqualTo(availableProperty));
                Assert.That(TeamForgeConnectionService.ComponentStructureSyncOptIn,
                    Is.EqualTo(availableStructure));
                Assert.That(TeamForgeConnectionService.PrimitiveTemplateSyncOptIn,
                    Is.EqualTo(availablePrimitive));
            }
            finally
            {
                SessionState.SetBool(propertyKey, priorProperty);
                SessionState.SetBool(structureKey, priorStructure);
                SessionState.SetBool(primitiveKey, priorPrimitive);
            }
        }

        [Test]
        public void LegacyServerStrategyProducesExactlyOneConfiguredAttempt()
        {
            var strategyType = RequiredEditorType("EunSung.TeamForge.LegacyServerStrategy");
            var strategy = Activator.CreateInstance(strategyType, true);
            var createAttempts = strategyType.GetMethod("TryCreateAttempts", InstanceMembers) ??
                                 throw new MissingMethodException(strategyType.FullName, "TryCreateAttempts");
            var arguments = new object[]
            {
                "https://teamforge.example/base",
                "/ws/",
                " local-token ",
                2,
                null,
                string.Empty,
            };

            Assert.That(createAttempts.Invoke(strategy, arguments), Is.EqualTo(true), arguments[5] as string);
            var attempts = arguments[4] as Array;
            Assert.That(attempts, Is.Not.Null);
            Assert.That(attempts.Length, Is.EqualTo(1));

            var attempt = attempts.GetValue(0);
            Assert.That(ReadProperty<Uri>(attempt, "Endpoint").AbsoluteUri,
                Is.EqualTo("wss://teamforge.example/base/ws"));
            Assert.That(ReadProperty<string>(attempt, "BearerToken"), Is.EqualTo(" local-token "));
            Assert.That(ReadProperty<int>(attempt, "KeepAliveSeconds"), Is.EqualTo(5));
        }

        [Test]
        public void WebSocketTransportFactoryCreatesTheConfiguredExistingAdapter()
        {
            var attemptType = RequiredEditorType("EunSung.TeamForge.RealtimeConnectionAttempt");
            var constructor = attemptType.GetConstructor(
                InstanceMembers,
                null,
                new[] { typeof(Uri), typeof(string), typeof(int) },
                null) ?? throw new MissingMethodException(attemptType.FullName, ".ctor");
            var attempt = constructor.Invoke(new object[]
            {
                new Uri("ws://127.0.0.1:5080/ws"),
                string.Empty,
                17,
            });
            var factoryType = RequiredEditorType("EunSung.TeamForge.WebSocketTransportFactory");
            var factory = Activator.CreateInstance(factoryType, true);
            var create = factoryType.GetMethod("Create", InstanceMembers) ??
                         throw new MissingMethodException(factoryType.FullName, "Create");
            var transport = create.Invoke(factory, new[] { attempt });

            try
            {
                Assert.That(transport.GetType().FullName,
                    Is.EqualTo("EunSung.TeamForge.ClientWebSocketTransport"));
                Assert.That(ReadField<Uri>(transport, "_endpoint").AbsoluteUri,
                    Is.EqualTo("ws://127.0.0.1:5080/ws"));
                Assert.That(ReadField<ClientWebSocket>(transport, "_socket").Options.KeepAliveInterval,
                    Is.EqualTo(TimeSpan.FromSeconds(17)));
            }
            finally
            {
                (transport as IDisposable)?.Dispose();
            }
        }

        [Test]
        public void RealtimeTransportConnectContractIsAttemptConfiguredAndTextFocused()
        {
            var transportType = RequiredEditorType("EunSung.TeamForge.IRealtimeTransport");
            var connect = transportType.GetMethod("ConnectAsync") ??
                          throw new MissingMethodException(transportType.FullName, "ConnectAsync");
            var parameters = connect.GetParameters();

            Assert.That(parameters.Length, Is.EqualTo(1));
            Assert.That(parameters[0].ParameterType, Is.EqualTo(typeof(CancellationToken)));
            Assert.That(transportType.GetMethod("SendTextAsync"), Is.Not.Null);
            Assert.That(transportType.GetMethod("DisconnectAsync"), Is.Not.Null);
        }

        private static Type RequiredEditorType(string name)
        {
            return typeof(TeamForgeConnectionService).Assembly.GetType(name, true);
        }

        private static T ReadProperty<T>(object instance, string name)
        {
            var property = instance.GetType().GetProperty(name, InstanceMembers) ??
                           throw new MissingMemberException(instance.GetType().FullName, name);
            return (T)property.GetValue(instance);
        }

        private static T ReadField<T>(object instance, string name)
        {
            var field = instance.GetType().GetField(name, InstanceMembers) ??
                        throw new MissingFieldException(instance.GetType().FullName, name);
            return (T)field.GetValue(instance);
        }
    }
}

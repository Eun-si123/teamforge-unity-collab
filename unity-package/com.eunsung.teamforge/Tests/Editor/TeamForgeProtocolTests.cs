using NUnit.Framework;

namespace EunSung.TeamForge.Tests
{
    public sealed class TeamForgeProtocolTests
    {
        [Test]
        public void PingRoundTripsThroughJsonUtility()
        {
            var source = new PingMessage
            {
                type = "ping",
                protocolVersion = TeamForgeProtocol.Version,
                requestId = "ping-42",
                clientTimestampUnixMs = 1786000000000,
            };

            var json = TeamForgeProtocol.Serialize(source);
            var envelopeRead = TeamForgeProtocol.TryReadEnvelope(json, out var envelope, out var error);
            var restored = TeamForgeProtocol.Deserialize<PingMessage>(json);

            Assert.That(envelopeRead, Is.True, error);
            Assert.That(envelope.type, Is.EqualTo("ping"));
            Assert.That(restored.requestId, Is.EqualTo(source.requestId));
            Assert.That(restored.clientTimestampUnixMs, Is.EqualTo(source.clientTimestampUnixMs));
        }

        [Test]
        public void RejectsDifferentProtocolVersion()
        {
            const string json = "{\"type\":\"pong\",\"protocolVersion\":999,\"requestId\":\"x\"}";

            var success = TeamForgeProtocol.TryReadEnvelope(json, out _, out var error);

            Assert.That(success, Is.False);
            Assert.That(error, Does.Contain("mismatch"));
        }

        [Test]
        public void PresenceSnapshotRoundTripsNestedCameraAndSelectionData()
        {
            var source = new PresenceSnapshotMessage
            {
                type = "presence_snapshot",
                protocolVersion = TeamForgeProtocol.Version,
                requestId = "hello-1",
                members = new[]
                {
                    new PresenceRecord
                    {
                        userId = "editor-a",
                        connectionId = "connection-a",
                        displayName = "Editor A",
                        color = "#64B5F6",
                        sceneId = "scene-guid",
                        sceneName = "SampleScene",
                        selectedObjectId = "GlobalObjectId_V1-2-scene-guid-1-0",
                        selectedObjectName = "Cube",
                        hasSceneView = true,
                        cameraPosition = new TeamForgeVector3Dto { x = 1, y = 2, z = 3 },
                        cameraRotation = new TeamForgeQuaternionDto { w = 1 },
                        cameraPivot = new TeamForgeVector3Dto { x = 4, y = 5, z = 6 },
                        cameraSize = 8,
                        activity = "Selecting",
                        lastHeartbeatUnixMs = 1786000000000,
                    },
                },
            };

            var restored = TeamForgeProtocol.Deserialize<PresenceSnapshotMessage>(TeamForgeProtocol.Serialize(source));

            Assert.That(restored.members, Has.Length.EqualTo(1));
            Assert.That(restored.members[0].selectedObjectName, Is.EqualTo("Cube"));
            Assert.That(restored.members[0].cameraPivot.y, Is.EqualTo(5));
            Assert.That(restored.members[0].cameraRotation.w, Is.EqualTo(1));
        }

        [Test]
        public void TransformSnapshotRoundTripsRevisionStateAndLock()
        {
            var source = new TransformSnapshotMessage
            {
                type = "transform_snapshot",
                protocolVersion = TeamForgeProtocol.Version,
                requestId = "hello-phase-2",
                serverRevision = 7,
                transforms = new[]
                {
                    new TransformAppliedMessage
                    {
                        type = "transform_applied",
                        protocolVersion = TeamForgeProtocol.Version,
                        requestId = "update-1",
                        operationId = "operation-1",
                        userId = "editor-a",
                        sceneId = "scene-guid",
                        objectId = "GlobalObjectId_V1-2-scene-guid-1-0",
                        baseRevision = 6,
                        serverRevision = 7,
                        localPosition = new TeamForgeVector3Dto { x = 1, y = 2, z = 3 },
                        localRotation = new TeamForgeQuaternionDto { w = 1 },
                        localScale = new TeamForgeVector3Dto { x = 2, y = 2, z = 2 },
                    },
                },
                locks = new[]
                {
                    new TeamForgeLockRecord
                    {
                        sceneId = "scene-guid",
                        objectId = "GlobalObjectId_V1-2-scene-guid-1-0",
                        ownerUserId = "editor-a",
                        ownerConnectionId = "connection-a",
                        ownerDisplayName = "Editor A",
                        ownerColor = "#64B5F6",
                        expiresAtUnixMs = 1786000015000,
                    },
                },
            };

            var restored =
                TeamForgeProtocol.Deserialize<TransformSnapshotMessage>(TeamForgeProtocol.Serialize(source));

            Assert.That(restored.serverRevision, Is.EqualTo(7));
            Assert.That(restored.transforms, Has.Length.EqualTo(1));
            Assert.That(restored.transforms[0].localScale.x, Is.EqualTo(2));
            Assert.That(restored.locks, Has.Length.EqualTo(1));
            Assert.That(restored.locks[0].ownerDisplayName, Is.EqualTo("Editor A"));
        }
        [Test]
        public void ComponentRecoveryPreviewHelloRequiresExplicitDerivedMessageAndLeavesLegacyHelloShapeAlone()
        {
            var legacy = new HelloMessage
            {
                type = "hello",
                protocolVersion = TeamForgeProtocol.Version,
                requestId = "legacy",
                userId = "editor-a",
                supportsPresence = true,
                supportsTransformSync = true,
                supportsHierarchySync = true,
            };
            var legacyJson = TeamForgeProtocol.Serialize(legacy);
            Assert.That(legacyJson, Does.Not.Contain("supportsComponentRecoveryPreview"));

            var offered = new ComponentRecoveryPreviewHelloMessage
            {
                type = "hello",
                protocolVersion = TeamForgeProtocol.Version,
                requestId = "offered",
                userId = "editor-a",
                supportsPresence = true,
                supportsTransformSync = true,
                supportsHierarchySync = true,
            };
            var offeredJson = TeamForgeProtocol.Serialize(offered);
            Assert.That(offeredJson, Does.Contain("\"supportsComponentRecoveryPreview\":true"));
            var restored = TeamForgeProtocol.Deserialize<ComponentRecoveryPreviewHelloMessage>(offeredJson);
            Assert.That(restored.supportsComponentRecoveryPreview, Is.True);
            Assert.That(restored.supportsHierarchySync, Is.True);

            var oldAck = TeamForgeProtocol.Deserialize<HelloAckMessage>(
                "{\"type\":\"hello_ack\",\"protocolVersion\":1,\"requestId\":\"legacy\",\"hierarchySyncEnabled\":true}");
            Assert.That(oldAck.componentRecoveryPreviewEnabled, Is.False,
                "Old servers cannot silently negotiate the new opt-in.");
            var newAck = TeamForgeProtocol.Deserialize<HelloAckMessage>(
                "{\"type\":\"hello_ack\",\"protocolVersion\":1,\"requestId\":\"offered\",\"componentRecoveryPreviewEnabled\":true}");
            Assert.That(newAck.componentRecoveryPreviewEnabled, Is.True);
        }

        [Test]
        public void ComponentRecoveryPreviewRequestAndMetadataDoNotMaterializeInspectorValues()
        {
            var request = new ComponentRecoveryPreviewRequestMessage
            {
                type = "component_recovery_preview_request",
                protocolVersion = TeamForgeProtocol.Version,
                requestId = "wp6-read",
                sceneId = "0123456789abcdef0123456789abcdef",
                knownRevision = 4,
                knownFingerprint = new string('a', 64),
            };
            var json = TeamForgeProtocol.Serialize(request);
            Assert.That(json, Does.Contain("\"knownFingerprint\""));
            var result = TeamForgeProtocol.Deserialize<ComponentRecoveryPreviewRequestMessage>(json);
            Assert.That(result.sceneId, Is.EqualTo(request.sceneId));
            Assert.That(result.knownRevision, Is.EqualTo(4));

            var rawReply =
                "{\"type\":\"component_recovery_preview\",\"protocolVersion\":1," +
                "\"requestId\":\"wp6-read\",\"sceneId\":\"0123456789abcdef0123456789abcdef\"," +
                "\"status\":\"local_preview_resnapshot\",\"serverRevision\":5," +
                "\"fingerprint\":\"" + new string('b', 64) + "\"," +
                "\"observedProperties\":[{\"value\":true,\"componentId\":\"untrusted\"}]}";
            var metadata = TeamForgeProtocol.Deserialize<ComponentRecoveryPreviewMetadataMessage>(rawReply);
            Assert.That(metadata.serverRevision, Is.EqualTo(5));
            Assert.That(metadata.fingerprint, Has.Length.EqualTo(64));
            Assert.That(metadata.status, Is.EqualTo("local_preview_resnapshot"));
            Assert.That(typeof(ComponentRecoveryPreviewMetadataMessage).GetField("observedProperties"),
                Is.Null, "The read-only client must not hydrate remote Component values.");
        }

        [Test]
        public void ColliderDeclarationHelloRequiresSecondIndependentOptIn()
        {
            var offered = new ComponentDeclarationPreviewHelloMessage
            {
                type = "hello",
                protocolVersion = TeamForgeProtocol.Version,
                requestId = "collider-offered",
                supportsPresence = true,
                supportsTransformSync = true,
                supportsHierarchySync = true,
            };
            var json = TeamForgeProtocol.Serialize(offered);
            Assert.That(json, Does.Contain("\"supportsComponentRecoveryPreview\":true"));
            Assert.That(json, Does.Contain("\"supportsComponentDeclarationPreview\":true"));

            var onlyRead = TeamForgeProtocol.Serialize(new ComponentRecoveryPreviewHelloMessage
            {
                type = "hello",
                protocolVersion = TeamForgeProtocol.Version,
                requestId = "read-only",
            });
            Assert.That(onlyRead, Does.Not.Contain("supportsComponentDeclarationPreview"));

            var ack = TeamForgeProtocol.Deserialize<HelloAckMessage>(
                "{\"type\":\"hello_ack\",\"protocolVersion\":1," +
                "\"componentRecoveryPreviewEnabled\":true,\"componentDeclarationPreviewEnabled\":true}");
            Assert.That(ack.componentRecoveryPreviewEnabled, Is.True);
            Assert.That(ack.componentDeclarationPreviewEnabled, Is.True);
        }

        [Test]
        public void ColliderDeclarationPropertyRowsSerializeWithExactTypedValues()
        {
            var boolean = TeamForgeProtocol.Serialize(new ComponentDeclarationBooleanRow
            {
                propertyPath = "m_IsTrigger",
                value = false,
            });
            var center = TeamForgeProtocol.Serialize(new ComponentDeclarationVector3Row
            {
                propertyPath = "m_Center",
                value = new TeamForgeVector3Dto { x = 1f, y = 2f, z = 3f },
            });
            var radius = TeamForgeProtocol.Serialize(new ComponentDeclarationFloatRow
            {
                propertyPath = "m_Radius", value = 1.25f,
            });
            Assert.That(boolean, Does.Contain("\"value\":false"));
            Assert.That(center, Does.Contain("\"value\":{"));
            Assert.That(center, Does.Contain("\"x\":1"));
            Assert.That(radius, Does.Contain("\"value\":1.25"));

            var envelope = TeamForgeProtocol.Serialize(new ComponentDeclarationPreviewSeedEnvelope
            {
                type = "component_declaration_preview_seed",
                protocolVersion = 1, requestId = "collider",
                userId = "first-editor",
                sceneId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                objectId = "GlobalObjectId_V1-2-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-10-0",
                componentId = "GlobalObjectId_V1-2-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-20-0",
                typeName = "UnityEngine.SphereCollider",
                baseRevision = 0,
                sceneDirty = false,
            });
            Assert.That(envelope, Does.Not.Contain("properties"));
            Assert.That(envelope, Does.Contain("\"sceneDirty\":false"));
        }

        [Test]
        public void UnverifiedColliderPeerSummaryHasCountsButNeverContainsPeerOrRemotePropertyValues()
        {
            var result = TeamForgeProtocol.Deserialize<ComponentRecoveryCompareResultMessage>(
                "{\"type\":\"component_recovery_compare_result\",\"protocolVersion\":1," +
                "\"evidenceLevel\":\"unverified_peer_observations\"," +
                "\"agreeingPeerCount\":2,\"divergingPeerCount\":1," +
                "\"status\":\"observations_differ\",\"differingPaths\":[\"m_Radius\"]}");
            Assert.That(result.evidenceLevel, Is.EqualTo("unverified_peer_observations"));
            Assert.That(result.agreeingPeerCount, Is.EqualTo(2));
            Assert.That(result.divergingPeerCount, Is.EqualTo(1));
            Assert.That(result.differingPaths, Is.EqualTo(new[] { "m_Radius" }));
            Assert.That(typeof(ComponentRecoveryCompareResultMessage).GetField("peerUserIds"), Is.Null);
            Assert.That(typeof(ComponentRecoveryCompareResultMessage).GetField("observedProperties"), Is.Null);
            Assert.That(typeof(ComponentRecoveryCompareResultMessage).GetField("value"), Is.Null);
        }

        [Test]
        public void ColliderReadOnlyComparisonReplyCanReportMismatchPathsWithoutValueHydration()
        {
            var json =
                "{\"type\":\"component_recovery_compare_result\",\"protocolVersion\":1," +
                "\"requestId\":\"compare-1\",\"status\":\"observations_differ\"," +
                "\"sceneId\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"," +
                "\"objectId\":\"GlobalObjectId_V1-2-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-10-0\"," +
                "\"componentId\":\"GlobalObjectId_V1-2-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-20-0\"," +
                "\"typeName\":\"UnityEngine.BoxCollider\",\"serverRevision\":0," +
                "\"comparedProperties\":3,\"differingPaths\":[\"m_IsTrigger\",\"m_Center\"]}";
            var result = TeamForgeProtocol.Deserialize<ComponentRecoveryCompareResultMessage>(json);
            Assert.That(result.status, Is.EqualTo("observations_differ"));
            Assert.That(result.serverRevision, Is.EqualTo(0));
            Assert.That(result.comparedProperties, Is.EqualTo(3));
            Assert.That(result.differingPaths, Is.EqualTo(new[] { "m_IsTrigger", "m_Center" }));
            Assert.That(result.agreeingPeerCount, Is.EqualTo(0));
            Assert.That(result.divergingPeerCount, Is.EqualTo(0),
                "Older source-only server comparison replies have no peer evidence.");
            Assert.That(typeof(ComponentRecoveryCompareResultMessage).GetField("observedProperties"),
                Is.Null, "No remote Unity SerializedProperty values may be hydrated.");
            Assert.That(typeof(ComponentRecoveryCompareResultMessage).GetField("value"),
                Is.Null, "The remote observation is never an Inspector mutation payload.");

            var requestEnvelope = new ComponentDeclarationPreviewSeedEnvelope
            {
                type = "component_recovery_compare_request",
                requestId = "compare-1",
                protocolVersion = TeamForgeProtocol.Version,
                userId = "guest",
                sceneId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                objectId = "GlobalObjectId_V1-2-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-10-0",
                componentId = "GlobalObjectId_V1-2-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-20-0",
                typeName = "UnityEngine.BoxCollider",
                baseRevision = 0,
                sceneDirty = false,
            };
            var sent = TeamForgeProtocol.Serialize(requestEnvelope);
            Assert.That(sent, Does.Contain("component_recovery_compare_request"));
            Assert.That(sent, Does.Contain("\"baseRevision\":0"));
            Assert.That(sent, Does.Not.Contain("differingPaths"));
        }

    }
}

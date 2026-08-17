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
    }
}

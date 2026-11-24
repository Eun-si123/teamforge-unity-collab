using System;
using NUnit.Framework;

namespace EunSung.TeamForge.Tests
{
    public sealed class TeamForgeEditorPauseGateTests
    {
        private const string ProjectUuid = "ee5354d0-1a55-4961-ac9e-249ef7dc218b";
        private const string Epoch = "a28a0ad1-4208-4d0c-b65e-ae379f7dd752";
        private const string SessionId = "c011c588-7a3c-498f-8c7f-6d19f6b931df";
        private const string PauseId = "ebfdf870-6a38-480e-a796-c746ac586e2b";
        private const long Now = 1_000_000;

        private static ProjectBaselineRecord Baseline() => new ProjectBaselineRecord
        {
            projectUuid = ProjectUuid, baselineRevision = 3,
            manifestHash = new string('a', 64), descriptorHash = new string('b', 64),
        };

        private static ProjectEditPauseRequestMessage Request() => new ProjectEditPauseRequestMessage
        {
            type = "project_edit_pause_request", protocolVersion = TeamForgeProtocol.Version,
            pauseId = PauseId, projectUuid = ProjectUuid, baselineRevision = 3,
            manifestHash = new string('a', 64), descriptorHash = new string('b', 64),
            authorityEpoch = Epoch, durableSessionId = SessionId, serverRevision = 9,
            expiresAtUnixMs = Now + 15000,
        };

        private static bool Begin(TeamForgeEditorPauseGate gate,
            ProjectEditPauseRequestMessage request = null,
            ProjectBaselineRecord baseline = null, bool ready = true, long now = Now)
        {
            return gate.TryBegin(request ?? Request(), baseline ?? Baseline(),
                "actual-connected-editor", Epoch, SessionId, 9, ready, now);
        }

        [Test]
        public void OnlyCleanExactSignedConnectionAndDurableCursorStartsPause()
        {
            var gate = new TeamForgeEditorPauseGate();
            Assert.That(Begin(gate, ready: false), Is.False,
                "Dirty Scenes, in-flight writes, locks and incomplete recovery must reject pause.");
            Assert.That(gate.IsPaused, Is.False);
            Assert.That(Begin(gate), Is.True);
            Assert.That(gate.IsPaused, Is.True);
            Assert.That(gate.PauseId, Is.EqualTo(PauseId));
            Assert.That(Begin(gate), Is.False, "An overlapping request cannot replace the active pause.");
            Assert.That(gate.IsCurrent("actual-connected-editor", Epoch, SessionId, 9, Now), Is.True);
        }

        [Test]
        public void AnySignedPinOrSessionMismatchRefusesWithoutMutatingTheGuard()
        {
            foreach (Action<ProjectEditPauseRequestMessage> change in new Action<ProjectEditPauseRequestMessage>[]
            {
                r => r.projectUuid = "ffffffff-ffff-4fff-8fff-ffffffffffff",
                r => r.descriptorHash = new string('d', 64),
                r => r.manifestHash = new string('e', 64),
                r => r.baselineRevision = 4,
                r => r.authorityEpoch = "11111111-1111-4111-8111-111111111111",
                r => r.durableSessionId = "22222222-2222-4222-8222-222222222222",
                r => r.serverRevision = 10,
                r => r.pauseId = "NOT-A-UUID",
                r => r.pauseId = PauseId.ToUpperInvariant(),
                r => r.expiresAtUnixMs = Now - 1,
                r => r.expiresAtUnixMs = Now + 90000,
            })
            {
                var request = Request(); change(request);
                var gate = new TeamForgeEditorPauseGate();
                Assert.That(Begin(gate, request: request), Is.False);
                Assert.That(gate.IsPaused, Is.False);
                Assert.That(gate.AllowsOutbound("hierarchy_operation"), Is.True);
            }
        }

        [Test]
        public void PausedEditorSuppressesAllNativeWritesButAllowsOnlyPingAndExactAck()
        {
            var gate = new TeamForgeEditorPauseGate();
            Assert.That(Begin(gate), Is.True);
            foreach (var command in new[]
            {
                "hierarchy_seed", "hierarchy_operation", "transform_update", "lock_request",
                "lock_release", "component_scene_join", "component_property_set",
                "component_structure_set", "project_baseline_publish", "project_peer_announce",
                "presence_update", "component_snapshot_request", "unknown_future_write",
            })
                Assert.That(gate.AllowsOutbound(command), Is.False, command);
            Assert.That(gate.AllowsOutbound("ping"), Is.True);
            Assert.That(gate.AllowsOutbound("project_edit_pause_ack"), Is.True);
        }

        [Test]
        public void UnityLocalChangeOrChangedGenerationInvalidatesPauseUntilRealCancel()
        {
            var gate = new TeamForgeEditorPauseGate();
            Assert.That(Begin(gate), Is.True);
            Assert.That(gate.IsCurrent("another-connection", Epoch, SessionId, 9, Now), Is.False);
            Assert.That(gate.IsCurrent("actual-connected-editor", Epoch, SessionId, 10, Now), Is.False);
            Assert.That(gate.IsCurrent("actual-connected-editor", Epoch, SessionId, 9, Now + 15001), Is.False);
            Assert.That(gate.Cancel("a-stale-pause-id"), Is.False);
            Assert.That(gate.IsPaused, Is.True,
                "A delayed cancellation from an older pause must not unblock writes.");
            gate.ObserveLocalChange();
            Assert.That(gate.LocallyChanged, Is.True);
            Assert.That(gate.IsCurrent("actual-connected-editor", Epoch, SessionId, 9, Now), Is.False);
            Assert.That(gate.AllowsOutbound("transform_update"), Is.False);
            Assert.That(gate.Cancel(PauseId), Is.True);
            Assert.That(gate.IsPaused, Is.False);
            Assert.That(gate.AllowsOutbound("transform_update"), Is.True);
            Assert.That(gate.Cancel(PauseId), Is.False);
        }

        [Test]
        public void DisconnectionClearsOnlyInMemoryPauseAndNeverTouchesUnitySceneOrRecoveryState()
        {
            var gate = new TeamForgeEditorPauseGate();
            Assert.That(Begin(gate), Is.True);
            gate.ObserveLocalChange();
            gate.Clear();
            Assert.That(gate.IsPaused, Is.False);
            Assert.That(gate.LocallyChanged, Is.False);
            Assert.That(gate.AllowsOutbound("hierarchy_operation"), Is.True);
            Assert.That(Begin(gate), Is.True, "A new current connection can use a fresh challenge.");
        }

        [Test]
        public void HelloOptInOnlyChangesTheNewWireDtoAndACKCannotClaimCommit()
        {
            var legacy = TeamForgeProtocol.Serialize(new PrimitiveTemplateHelloMessage
            {
                type = "hello", protocolVersion = TeamForgeProtocol.Version,
            });
            Assert.That(legacy, Does.Not.Contain("supportsProjectEditPause"));
            var optIn = TeamForgeProtocol.Serialize(new ProjectEditPauseHelloMessage
            {
                type = "hello", protocolVersion = TeamForgeProtocol.Version,
                supportsComponentPropertySync = true,
                supportsComponentStructureSync = true,
                supportsPrimitiveTemplateSync = true,
            });
            Assert.That(optIn, Does.Contain("\\\"supportsProjectEditPause\\\":true"));
            Assert.That(optIn, Does.Contain("\\\"supportsPrimitiveTemplateSync\\\":true"));
            var ack = TeamForgeProtocol.Serialize(new ProjectEditPauseAckMessage
            {
                type = "project_edit_pause_ack", protocolVersion = 1,
                requestId = "correlated", status = "ready", pauseId = PauseId,
                serverRevision = 9, authorityEpoch = Epoch, durableSessionId = SessionId,
            });
            Assert.That(ack, Does.Contain("\\\"status\\\":\\\"ready\\\""));
            Assert.That(ack, Does.Not.Contain("commitPermitted"),
                "An Editor pause acknowledgement is never a Project switch authority.");
        }
    }
}

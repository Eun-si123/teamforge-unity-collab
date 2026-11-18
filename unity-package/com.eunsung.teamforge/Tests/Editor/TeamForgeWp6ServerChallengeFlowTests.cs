using System;
using NUnit.Framework;

namespace EunSung.TeamForge.Tests
{
    public sealed class TeamForgeWp6ServerChallengeFlowTests
    {
        private const string SceneGuid = "0123456789abcdef0123456789abcdef";
        private const string ProjectUuid = "c1d815a9-3f04-4db1-82f2-50d5fa37e1bf";
        private readonly DateTime _now = new DateTime(2026, 11, 10, 0, 0, 0, DateTimeKind.Utc);

        private static TeamForgeWp6PreviewSourceGate.ProjectPin Project()
        {
            var descriptor = new TeamForgeProjectDescriptor
            {
                projectUuid = ProjectUuid,
                baselineRevision = 5,
                manifestHash = new string('a', 64),
                descriptorHash = new string('b', 64),
                unityVersion = "6000.3.21f1",
                teamForgePackageVersion = TeamForgeProjectContract.ProductVersion,
                realtimeProtocolVersion = TeamForgeProtocol.Version,
                transferProtocolVersion = TeamForgeProjectContract.TransferProtocolVersion,
                manifestSchemaVersion = TeamForgeProjectContract.ManifestSchemaVersion,
            };
            var baseline = new ProjectBaselineRecord
            {
                projectUuid = descriptor.projectUuid,
                baselineRevision = descriptor.baselineRevision,
                manifestHash = descriptor.manifestHash,
                descriptorHash = descriptor.descriptorHash,
                unityVersion = descriptor.unityVersion,
                teamForgePackageVersion = descriptor.teamForgePackageVersion,
                realtimeProtocolVersion = descriptor.realtimeProtocolVersion,
                transferProtocolVersion = descriptor.transferProtocolVersion,
                manifestSchemaVersion = descriptor.manifestSchemaVersion,
                ownerKeyId = new string('c', 64),
                publisherKeyId = new string('d', 64),
                ownerPublicKey = "owner-stub",
                publisherPublicKey = "publisher-stub",
                baselineSignature = "test-signed",
            };
            return new TeamForgeWp6PreviewSourceGate.ProjectPin(
                "editor-current", "project-1", "session-1",
                descriptor, baseline);
        }

        private static TeamForgeWp6PreviewSourceGate.Verified Scene()
        {
            return new TeamForgeWp6PreviewSourceGate.Verified(
                SceneGuid, new string('e', 64), new string('f', 64), 2);
        }

        private static ComponentSourceChallengeMessage Issued(
            ComponentSourceChallengeRequestMessage request,
            TeamForgeWp6PreviewSourceGate.ProjectPin project)
        {
            return new ComponentSourceChallengeMessage
            {
                type = "component_source_challenge",
                protocolVersion = TeamForgeProtocol.Version,
                requestId = request.requestId,
                status = "server_source_freshness_probe_unverified",
                sceneId = request.sceneId,
                nonce = new string('1', 64),
                projectUuid = project.ProjectUuid,
                baselineRevision = project.BaselineRevision,
                sessionRevision = 0,
                manifestHash = project.ManifestHash,
                descriptorHash = project.DescriptorHash,
                expiresAtUnixMs = 1790000000000,
                sceneBytesAttested = false,
                editorApplyVerified = false,
                networkWriteAuthorized = false,
            };
        }

        private static ComponentSourceChallengeEchoResultMessage EchoResult(
            ComponentSourceChallengeEchoMessage echo,
            TeamForgeWp6PreviewSourceGate.ProjectPin project)
        {
            return new ComponentSourceChallengeEchoResultMessage
            {
                type = "component_source_challenge_echo_result",
                protocolVersion = TeamForgeProtocol.Version,
                requestId = echo.requestId,
                status = "same_connection_challenge_echo_unverified",
                challengeConsumed = true,
                sceneId = echo.sceneId,
                projectUuid = project.ProjectUuid,
                baselineRevision = project.BaselineRevision,
                manifestHash = project.ManifestHash,
                descriptorHash = project.DescriptorHash,
                sessionRevision = 0,
                sceneBytesAttested = false,
                editorApplyVerified = false,
                networkWriteAuthorized = false,
            };
        }

        [Test]
        public void ValidServerNonceIsEchoedExactlyOnceButNeverTreatedAsInspectorSourceProof()
        {
            var project = Project();
            var scene = Scene();
            var flow = new TeamForgeWp6ServerChallengeFlow();
            Assert.That(flow.TryBegin(
                project, scene, _now, out var request, out var error), Is.True, error);
            Assert.That(request.type, Is.EqualTo("component_source_challenge_request"));
            Assert.That(request.sceneId, Is.EqualTo(SceneGuid));
            Assert.That(flow.Pending, Is.True);
            Assert.That(flow.MatchesCurrent(Project(), Scene()), Is.True);
            Assert.That(flow.TryBegin(
                project, scene, _now, out _, out _), Is.False);

            var issued = Issued(request, project);
            Assert.That(flow.TryAcceptIssued(
                issued, _now.AddSeconds(1), out var echo, out error), Is.True, error);
            Assert.That(echo.type, Is.EqualTo("component_source_challenge_echo"));
            Assert.That(echo.nonce, Is.EqualTo(issued.nonce));
            Assert.That(flow.IgnoreExpired(request.requestId), Is.True);
            Assert.That(flow.Pending, Is.True);
            var result = EchoResult(echo, project);
            Assert.That(flow.TryAcceptEchoed(
                result, _now.AddSeconds(2), out error), Is.True, error);
            Assert.That(flow.Pending, Is.False);
            Assert.That(flow.Status, Does.Contain("NOT authenticated").IgnoreCase);
            Assert.That(flow.Status, Does.Contain("NOT verified").IgnoreCase);
            Assert.That(result.sceneBytesAttested, Is.False);
            Assert.That(result.editorApplyVerified, Is.False);
            Assert.That(result.networkWriteAuthorized, Is.False);
            Assert.That(flow.IgnoreExpired(echo.requestId), Is.True);
            Assert.That(flow.TryAcceptEchoed(
                result, _now.AddSeconds(3), out _), Is.False);
        }

        [Test]
        public void ForgedOrWrongEpochServerChallengeCannotTriggerNonceEcho()
        {
            var project = Project();
            var scene = Scene();
            foreach (Action<ComponentSourceChallengeMessage> mutate in
                new Action<ComponentSourceChallengeMessage>[] {
                    m => m.requestId = "unsolicited",
                    m => m.sceneId = new string('2', 32),
                    m => m.nonce = new string('z', 64),
                    m => m.nonce = new string('1', 63),
                    m => m.projectUuid = "invalid",
                    m => m.baselineRevision += 1,
                    m => m.manifestHash = new string('2', 64),
                    m => m.descriptorHash = new string('2', 64),
                    m => m.sessionRevision = -1,
                    m => m.sceneBytesAttested = true,
                    m => m.editorApplyVerified = true,
                    m => m.networkWriteAuthorized = true,
                    m => m.status = "trusted_provenance_verified",
                    m => m.protocolVersion = 2,
                    m => m.expiresAtUnixMs = 0,
                })
            {
                var flow = new TeamForgeWp6ServerChallengeFlow();
                Assert.That(flow.TryBegin(
                    project, scene, _now, out var request, out _), Is.True);
                var response = Issued(request, project);
                mutate(response);
                Assert.That(flow.TryAcceptIssued(
                    response, _now.AddSeconds(1), out var echo, out _),
                    Is.False, response.status);
                Assert.That(echo, Is.Null);
            }
        }

        [Test]
        public void MutatedOrUncorrelatedEchoResultIsRejectedAndNeverAcknowledgesInspectorApply()
        {
            var project = Project();
            foreach (Action<ComponentSourceChallengeEchoResultMessage> mutate in
                new Action<ComponentSourceChallengeEchoResultMessage>[] {
                    m => m.requestId = "wrong",
                    m => m.sceneId = new string('2', 32),
                    m => m.projectUuid = "other",
                    m => m.baselineRevision++,
                    m => m.manifestHash = new string('2', 64),
                    m => m.descriptorHash = new string('2', 64),
                    m => m.sceneBytesAttested = true,
                    m => m.editorApplyVerified = true,
                    m => m.networkWriteAuthorized = true,
                    m => m.challengeConsumed = false,
                    m => m.status = "inspector_applied",
                    m => m.protocolVersion = 2,
                })
            {
                var flow = new TeamForgeWp6ServerChallengeFlow();
                Assert.That(flow.TryBegin(
                    project, Scene(), _now, out var request, out _), Is.True);
                Assert.That(flow.TryAcceptIssued(
                    Issued(request, project), _now.AddSeconds(1),
                    out var echo, out _), Is.True);
                var result = EchoResult(echo, project);
                mutate(result);
                Assert.That(flow.TryAcceptEchoed(result, _now.AddSeconds(2), out _),
                    Is.False, result.status);
            }
        }

        [Test]
        public void TimeoutRefusalProjectRotationAndSceneEditsInvalidateOldChallenge()
        {
            var project = Project();
            var scene = Scene();
            var flow = new TeamForgeWp6ServerChallengeFlow();
            Assert.That(flow.TryBegin(
                project, scene, _now, out var request, out _), Is.True);
            Assert.That(flow.Expire(_now.AddSeconds(14)), Is.False);
            Assert.That(flow.Expire(_now.AddSeconds(15)), Is.True);
            Assert.That(flow.Pending, Is.False);
            Assert.That(flow.Status, Does.StartWith("TIMEOUT"));
            Assert.That(flow.IgnoreExpired(request.requestId), Is.True);
            Assert.That(flow.TryAcceptIssued(
                Issued(request, project), _now.AddSeconds(16), out _, out _), Is.False);
            var olderRequestId = request.requestId;

            Assert.That(flow.TryBegin(project, scene, _now, out request, out _), Is.True);
            Assert.That(flow.IgnoreExpired(olderRequestId), Is.True,
                "A stale response must remain harmless while the next request is active.");
            // An older timed-out result remains safely ignored while a new
            // challenge is already being issued on the same socket.
            Assert.That(flow.IgnoreExpired(request.requestId), Is.False);
            Assert.That(flow.TryRefuse(request.requestId,
                "component_recovery_signed_baseline_required"), Is.True);
            Assert.That(flow.Status, Does.StartWith("REFUSED"));
            Assert.That(flow.Pending, Is.False);
            Assert.That(flow.TryRefuse(request.requestId, "other"), Is.False);
            Assert.That(flow.TryBegin(project, scene, _now, out _, out _), Is.True);
            Assert.That(flow.MatchesCurrent(project,
                new TeamForgeWp6PreviewSourceGate.Verified(
                    SceneGuid, new string('2', 64), scene.MetaSha256, 2)), Is.False);
            Assert.That(flow.MatchesCurrent(Project(), scene), Is.True);
            flow.RefuseStale();
            Assert.That(flow.Status, Does.StartWith("STALE"));
            Assert.That(flow.Pending, Is.False);
            flow.Reset();
            Assert.That(flow.Status, Does.StartWith("OFF"));
            Assert.That(flow.IgnoreExpired(request.requestId), Is.False);
        }
    }
}

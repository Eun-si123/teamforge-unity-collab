using System;
using System.Collections;
using System.Collections.Generic;
using NUnit.Framework;
using UnityEditor;
using UnityEngine.TestTools;

namespace EunSung.TeamForge.Tests
{
    public sealed class TeamForgeRealServerE2ETests
    {
        private const string PeerUserId = "ci-peer-b";
        private const string UnityUserId = "ci-unity-a";
        private const string TargetSceneId = "ci-transform-scene";
        private const string TargetObjectId = "GlobalObjectId_V1-2-ci-transform-scene-4242-0";

        [UnityTest]
        public IEnumerator RealServer_ConnectsPresenceAndEnforcesTransformLockAuthority()
        {
            if (!IsRealServerE2EEnabled())
            {
                Assert.Ignore("Real-server E2E is enabled only by the GitHub Actions Unity workflow.");
            }

            TeamForgeConnectionService.Disconnect();
            TeamForgePresenceService.Registry.Clear();

            var settings = TeamForgeConnectionService.Settings;
            settings.ServerAddress = "http://127.0.0.1:5080";
            settings.RealtimePath = "ws";
            settings.UserName = "CI Unity A";
            settings.UserId = UnityUserId;
            settings.UserColorHtml = "#E57373";
            settings.ProjectId = "ci-e2e-project";
            settings.SessionId = "ci-e2e-session";
            settings.AuthenticationToken = string.Empty;
            settings.ConnectionTimeoutSeconds = 10;
            settings.AutoReconnect = false;
            settings.LogLevel = TeamForgeLogLevel.Info;
            settings.SaveSettings();

            var transformMessages = new List<CapturedTransformMessage>();
            Action<string, string> transformHandler = (type, json) =>
                transformMessages.Add(new CapturedTransformMessage(type, json));
            TeamForgeConnectionService.TransformMessageReceived += transformHandler;

            try
            {
                TeamForgeConnectionService.Connect();

                var deadline = EditorApplication.timeSinceStartup + 20.0;
                while (TeamForgeConnectionService.State != TeamForgeConnectionState.Connected &&
                       EditorApplication.timeSinceStartup < deadline)
                {
                    yield return null;
                }

                Assert.That(
                    TeamForgeConnectionService.State,
                    Is.EqualTo(TeamForgeConnectionState.Connected),
                    $"Unity did not connect to the real TeamForge server. LastError: {TeamForgeConnectionService.LastError}");
                Assert.That(TeamForgeConnectionService.ConnectionId, Is.Not.Empty);
                Assert.That(TeamForgeConnectionService.ServerVersion, Is.Not.Empty);
                Assert.That(TeamForgeConnectionService.PresenceAvailable, Is.True);
                Assert.That(TeamForgeConnectionService.TransformSyncAvailable, Is.True);
                Assert.That(TeamForgeConnectionService.HierarchySyncAvailable, Is.True);
                Assert.That(TeamForgeConnectionService.ProjectTransferAvailable, Is.True);

                TransformSnapshotMessage snapshot = null;
                deadline = EditorApplication.timeSinceStartup + 10.0;
                while (!TryFindTransformMessage(
                           transformMessages,
                           "transform_snapshot",
                           _ => true,
                           out snapshot) &&
                       EditorApplication.timeSinceStartup < deadline)
                {
                    yield return null;
                }

                Assert.That(snapshot, Is.Not.Null, "Unity did not receive the authoritative Transform snapshot.");
                Assert.That(snapshot.serverRevision, Is.GreaterThanOrEqualTo(1));

                var peerLock = FindLock(snapshot.locks, TargetSceneId, TargetObjectId);
                Assert.That(peerLock, Is.Not.Null, "The initial Transform snapshot did not contain CI Peer B's lock.");
                Assert.That(peerLock.ownerUserId, Is.EqualTo(PeerUserId));

                var peerTransform = FindTransform(snapshot.transforms, TargetSceneId, TargetObjectId);
                Assert.That(peerTransform, Is.Not.Null, "The initial Transform snapshot did not contain CI Peer B's transform.");
                Assert.That(peerTransform.userId, Is.EqualTo(PeerUserId));
                Assert.That(peerTransform.localPosition.x, Is.EqualTo(2f).Within(0.001f));
                Assert.That(peerTransform.localPosition.y, Is.EqualTo(4f).Within(0.001f));
                Assert.That(peerTransform.localPosition.z, Is.EqualTo(6f).Within(0.001f));

                deadline = EditorApplication.timeSinceStartup + 10.0;
                while (!TeamForgeConnectionService.LastRoundTripMilliseconds.HasValue &&
                       EditorApplication.timeSinceStartup < deadline)
                {
                    yield return null;
                }

                Assert.That(
                    TeamForgeConnectionService.LastRoundTripMilliseconds.HasValue,
                    Is.True,
                    "Unity connected but the real server did not complete Ping/Pong.");
                Assert.That(TeamForgeConnectionService.MessagesSent, Is.GreaterThan(0));
                Assert.That(TeamForgeConnectionService.MessagesReceived, Is.GreaterThan(0));

                PresenceRecord peer = null;
                deadline = EditorApplication.timeSinceStartup + 10.0;
                while (peer == null && EditorApplication.timeSinceStartup < deadline)
                {
                    TeamForgePresenceService.Registry.TryGet(PeerUserId, out peer);
                    if (peer == null)
                    {
                        yield return null;
                    }
                }

                Assert.That(peer, Is.Not.Null, "Unity did not receive CI Peer B through the real server Presence path.");
                Assert.That(peer.displayName, Is.EqualTo("CI Peer B"));
                Assert.That(peer.sceneName, Is.EqualTo("CI Scene"));
                Assert.That(peer.activity, Is.EqualTo("CI Ready"));
                Assert.That(TeamForgePresenceService.RemoteMembers().Count, Is.GreaterThanOrEqualTo(1));

                const string deniedRequestId = "ci-unity-lock-conflict";
                Assert.That(
                    TeamForgeConnectionService.SendTransform(
                        new LockRequestMessage
                        {
                            type = "lock_request",
                            protocolVersion = TeamForgeProtocol.Version,
                            requestId = deniedRequestId,
                            userId = UnityUserId,
                            sceneId = TargetSceneId,
                            objectId = TargetObjectId,
                        },
                        "CI lock conflict"),
                    Is.True,
                    "Unity could not send the competing lock request.");

                LockDeniedMessage denied = null;
                deadline = EditorApplication.timeSinceStartup + 10.0;
                while (!TryFindTransformMessage(
                           transformMessages,
                           "lock_denied",
                           message => message.requestId == deniedRequestId,
                           out denied) &&
                       EditorApplication.timeSinceStartup < deadline)
                {
                    yield return null;
                }

                Assert.That(denied, Is.Not.Null, "The real server did not reject Unity's competing lock request.");
                Assert.That(denied.lockState, Is.Not.Null);
                Assert.That(denied.lockState.ownerUserId, Is.EqualTo(PeerUserId));
                Assert.That(denied.reason, Is.Not.Empty);

                LockReleasedMessage peerRelease = null;
                deadline = EditorApplication.timeSinceStartup + 15.0;
                while (!TryFindTransformMessage(
                           transformMessages,
                           "lock_released",
                           message =>
                               message.sceneId == TargetSceneId &&
                               message.objectId == TargetObjectId &&
                               message.previousOwnerUserId == PeerUserId,
                           out peerRelease) &&
                       EditorApplication.timeSinceStartup < deadline)
                {
                    yield return null;
                }

                Assert.That(peerRelease, Is.Not.Null, "CI Peer B did not release the contested lock.");

                const string grantedRequestId = "ci-unity-lock-after-release";
                Assert.That(
                    TeamForgeConnectionService.SendTransform(
                        new LockRequestMessage
                        {
                            type = "lock_request",
                            protocolVersion = TeamForgeProtocol.Version,
                            requestId = grantedRequestId,
                            userId = UnityUserId,
                            sceneId = TargetSceneId,
                            objectId = TargetObjectId,
                        },
                        "CI lock acquire"),
                    Is.True,
                    "Unity could not request the released lock.");

                LockStateMessage granted = null;
                deadline = EditorApplication.timeSinceStartup + 10.0;
                while (!TryFindTransformMessage(
                           transformMessages,
                           "lock_granted",
                           message => message.requestId == grantedRequestId,
                           out granted) &&
                       EditorApplication.timeSinceStartup < deadline)
                {
                    yield return null;
                }

                Assert.That(granted, Is.Not.Null, "Unity did not acquire the lock after CI Peer B released it.");
                Assert.That(granted.lockState, Is.Not.Null);
                Assert.That(granted.lockState.ownerUserId, Is.EqualTo(UnityUserId));

                const string operationId = "ci-unity-transform-1";
                Assert.That(
                    TeamForgeConnectionService.SendTransform(
                        new TransformUpdateMessage
                        {
                            type = "transform_update",
                            protocolVersion = TeamForgeProtocol.Version,
                            requestId = "ci-unity-transform-request",
                            operationId = operationId,
                            userId = UnityUserId,
                            sceneId = TargetSceneId,
                            objectId = TargetObjectId,
                            baseRevision = snapshot.serverRevision,
                            localPosition = new TeamForgeVector3Dto { x = 9f, y = 8f, z = 7f },
                            localRotation = new TeamForgeQuaternionDto { x = 0f, y = 0f, z = 0f, w = 1f },
                            localScale = new TeamForgeVector3Dto { x = 1f, y = 1f, z = 1f },
                        },
                        "CI authoritative transform"),
                    Is.True,
                    "Unity could not send the authoritative Transform update.");

                TransformAppliedMessage applied = null;
                deadline = EditorApplication.timeSinceStartup + 10.0;
                while (!TryFindTransformMessage(
                           transformMessages,
                           "transform_applied",
                           message => message.operationId == operationId,
                           out applied) &&
                       EditorApplication.timeSinceStartup < deadline)
                {
                    yield return null;
                }

                Assert.That(applied, Is.Not.Null, "The server did not apply Unity's Transform update.");
                Assert.That(applied.userId, Is.EqualTo(UnityUserId));
                Assert.That(applied.serverRevision, Is.GreaterThan(snapshot.serverRevision));
                Assert.That(applied.localPosition.x, Is.EqualTo(9f).Within(0.001f));
                Assert.That(applied.localPosition.y, Is.EqualTo(8f).Within(0.001f));
                Assert.That(applied.localPosition.z, Is.EqualTo(7f).Within(0.001f));

                Assert.That(
                    TeamForgeConnectionService.SendTransform(
                        new LockReleaseMessage
                        {
                            type = "lock_release",
                            protocolVersion = TeamForgeProtocol.Version,
                            requestId = "ci-unity-release",
                            userId = UnityUserId,
                            sceneId = TargetSceneId,
                            objectId = TargetObjectId,
                        },
                        "CI lock release"),
                    Is.True);

                TeamForgeConnectionService.Disconnect();
                deadline = EditorApplication.timeSinceStartup + 10.0;
                while (TeamForgeConnectionService.State != TeamForgeConnectionState.Disconnected &&
                       EditorApplication.timeSinceStartup < deadline)
                {
                    yield return null;
                }

                Assert.That(
                    TeamForgeConnectionService.State,
                    Is.EqualTo(TeamForgeConnectionState.Disconnected),
                    "Unity did not cleanly disconnect after the real-server E2E test.");
            }
            finally
            {
                TeamForgeConnectionService.TransformMessageReceived -= transformHandler;
                TeamForgeConnectionService.Disconnect();
            }
        }

        private static TeamForgeLockRecord FindLock(
            TeamForgeLockRecord[] locks,
            string sceneId,
            string objectId)
        {
            if (locks == null)
            {
                return null;
            }
            foreach (var candidate in locks)
            {
                if (candidate != null && candidate.sceneId == sceneId && candidate.objectId == objectId)
                {
                    return candidate;
                }
            }
            return null;
        }

        private static TransformAppliedMessage FindTransform(
            TransformAppliedMessage[] transforms,
            string sceneId,
            string objectId)
        {
            if (transforms == null)
            {
                return null;
            }
            foreach (var candidate in transforms)
            {
                if (candidate != null && candidate.sceneId == sceneId && candidate.objectId == objectId)
                {
                    return candidate;
                }
            }
            return null;
        }

        private static bool TryFindTransformMessage<T>(
            List<CapturedTransformMessage> messages,
            string type,
            Func<T, bool> predicate,
            out T result)
            where T : class
        {
            foreach (var message in messages)
            {
                if (!string.Equals(message.Type, type, StringComparison.Ordinal))
                {
                    continue;
                }

                var parsed = TeamForgeProtocol.Deserialize<T>(message.Json);
                if (parsed != null && (predicate == null || predicate(parsed)))
                {
                    result = parsed;
                    return true;
                }
            }

            result = null;
            return false;
        }

        private static bool IsRealServerE2EEnabled()
        {
            foreach (var argument in Environment.GetCommandLineArgs())
            {
                if (string.Equals(argument, "-teamforgeCiE2E", StringComparison.OrdinalIgnoreCase))
                {
                    return true;
                }
            }
            return false;
        }

        private sealed class CapturedTransformMessage
        {
            public CapturedTransformMessage(string type, string json)
            {
                Type = type;
                Json = json;
            }

            public string Type { get; }
            public string Json { get; }
        }
    }
}

using System;
using System.Collections;
using System.Collections.Generic;
using NUnit.Framework;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.TestTools;

namespace EunSung.TeamForge.Tests
{
    public sealed class TeamForgeRealServerE2ETests
    {
        private const string PeerUserId = "ci-peer-b";
        private const string UnityUserId = "ci-unity-a";
        private const string TemporaryFolder = "Assets/__TeamForgeCiE2E";

        [UnityTest]
        public IEnumerator RealServer_RealObjectLockHandoffAndTransformAuthorityRoundTrip()
        {
            if (!IsRealServerE2EEnabled())
            {
                Assert.Ignore("Real-server E2E is enabled only by the GitHub Actions Unity workflow.");
            }

            TeamForgeConnectionService.Disconnect();
            TeamForgePresenceService.Registry.Clear();
            Selection.activeObject = null;

            var settings = TeamForgeConnectionService.Settings;
            var previousSettings = new SettingsSnapshot(settings);
            Scene workingScene = default;
            GameObject target = null;
            var scenePath = string.Empty;
            var transformMessages = new List<CapturedTransformMessage>();
            Action<string, string> transformHandler = (type, json) =>
                transformMessages.Add(new CapturedTransformMessage(type, json));
            TeamForgeConnectionService.TransformMessageReceived += transformHandler;

            try
            {
                EnsureTemporaryFolder();
                scenePath = $"{TemporaryFolder}/{Guid.NewGuid():N}.unity";
                // GitHub-hosted Unity starts with an untitled unsaved Scene. Unity rejects
                // additive Scene creation in that state, so make this E2E own a clean single
                // Scene just like the other isolated EditMode Scene tests.
                workingScene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                Assert.That(SceneManager.GetActiveScene().handle, Is.EqualTo(workingScene.handle));
                target = new GameObject("TeamForge CI Authority Target");
                SceneManager.MoveGameObjectToScene(target, workingScene);
                Assert.That(EditorSceneManager.SaveScene(workingScene, scenePath), Is.True);
                Assert.That(workingScene.isDirty, Is.False);
                Assert.That(
                    TeamForgeObjectIdentity.TryGetCollaborativeObjectId(target, out var initialTargetId),
                    Is.True,
                    "The saved CI target did not receive a collaborative identity.");
                Assert.That(initialTargetId, Is.Not.Empty);

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
                settings.ResumeAfterAssemblyReload = false;
                settings.SaveSettings();

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

                deadline = EditorApplication.timeSinceStartup + 10.0;
                while (!TeamForgeHierarchySyncService.SnapshotReady &&
                       EditorApplication.timeSinceStartup < deadline)
                {
                    yield return null;
                }
                Assert.That(
                    TeamForgeHierarchySyncService.SnapshotReady,
                    Is.True,
                    "Unity did not receive the authoritative Hierarchy snapshot.");

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
                Assert.That(peer.activity, Is.EqualTo("CI Ready"));

                // Trigger the same path a user takes: select a real saved object and let the
                // Transform Sync service request the lock itself.
                Selection.activeGameObject = target;

                deadline = EditorApplication.timeSinceStartup + 10.0;
                TeamForgeLockRecord unityLock = null;
                while (EditorApplication.timeSinceStartup < deadline)
                {
                    if (TeamForgeTransformSyncService.TryGetSelectedLock(out var candidate) &&
                        candidate.ownerConnectionId == TeamForgeConnectionService.ConnectionId)
                    {
                        unityLock = candidate;
                        break;
                    }
                    yield return null;
                }
                Assert.That(unityLock, Is.Not.Null, "Unity did not acquire the selected object's real server lock.");
                Assert.That(unityLock.ownerUserId, Is.EqualTo(UnityUserId));
                Assert.That(TeamForgeTransformSyncService.SelectedObjectId, Is.Not.Empty);

                var firstRevision = TeamForgeTransformSyncService.CurrentRevision;
                target.transform.localPosition = new Vector3(9f, 8f, 7f);
                deadline = EditorApplication.timeSinceStartup + 10.0;
                while (TeamForgeTransformSyncService.CurrentRevision <= firstRevision &&
                       EditorApplication.timeSinceStartup < deadline)
                {
                    yield return null;
                }
                Assert.That(
                    TeamForgeTransformSyncService.CurrentRevision,
                    Is.GreaterThan(firstRevision),
                    "The real Unity Transform edit was not acknowledged by the authoritative server.");
                Assert.That(VectorApproximately(target.transform.localPosition, new Vector3(9f, 8f, 7f)), Is.True);

                // Release through the production service. Peer B watches this exact target,
                // takes the lock, publishes a remote transform, and keeps renewing its lease.
                Assert.That(TeamForgeTransformSyncService.ReleaseSelectedLock(), Is.True);

                deadline = EditorApplication.timeSinceStartup + 15.0;
                TeamForgeLockRecord peerLock = null;
                while (EditorApplication.timeSinceStartup < deadline)
                {
                    if (TeamForgeTransformSyncService.TryGetSelectedLock(out var candidate) &&
                        candidate.ownerUserId == PeerUserId &&
                        VectorApproximately(target.transform.localPosition, new Vector3(2f, 4f, 6f)))
                    {
                        peerLock = candidate;
                        break;
                    }
                    yield return null;
                }
                Assert.That(peerLock, Is.Not.Null, "CI Peer B did not take over the real Unity target lock.");
                Assert.That(
                    VectorApproximately(target.transform.localPosition, new Vector3(2f, 4f, 6f)),
                    Is.True,
                    "Unity did not apply CI Peer B's authoritative remote Transform.");

                // B owns the actual selected target now. Bypass the local fast-fail once so
                // the real server also proves its lock-denial path against Unity's connection.
                const string deniedRequestId = "ci-unity-real-object-lock-conflict";
                Assert.That(
                    TeamForgeConnectionService.SendTransform(
                        new LockRequestMessage
                        {
                            type = "lock_request",
                            protocolVersion = TeamForgeProtocol.Version,
                            requestId = deniedRequestId,
                            userId = UnityUserId,
                            sceneId = peerLock.sceneId,
                            objectId = peerLock.objectId,
                        },
                        "CI real-object lock conflict"),
                    Is.True);

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
                Assert.That(denied, Is.Not.Null, "The server did not reject Unity's competing real-object lock request.");
                Assert.That(denied.lockState.ownerUserId, Is.EqualTo(PeerUserId));
                Assert.That(denied.reason, Is.EqualTo("locked_by_other_user"));

                // Peer B releases automatically after its remote Transform has been observed.
                deadline = EditorApplication.timeSinceStartup + 15.0;
                while (TeamForgeTransformSyncService.TryGetSelectedLock(out _) &&
                       EditorApplication.timeSinceStartup < deadline)
                {
                    yield return null;
                }
                Assert.That(
                    TeamForgeTransformSyncService.TryGetSelectedLock(out _),
                    Is.False,
                    "CI Peer B did not release the selected object's lock.");

                Assert.That(
                    TeamForgeTransformSyncService.RequestSelectedLock(),
                    Is.True,
                    "Unity could not request the released real-object lock through the production service.");
                deadline = EditorApplication.timeSinceStartup + 10.0;
                unityLock = null;
                while (EditorApplication.timeSinceStartup < deadline)
                {
                    if (TeamForgeTransformSyncService.TryGetSelectedLock(out var candidate) &&
                        candidate.ownerConnectionId == TeamForgeConnectionService.ConnectionId)
                    {
                        unityLock = candidate;
                        break;
                    }
                    yield return null;
                }
                Assert.That(unityLock, Is.Not.Null, "Unity did not reacquire the real target after Peer B released it.");

                var peerRevision = TeamForgeTransformSyncService.CurrentRevision;
                target.transform.localPosition = new Vector3(11f, 12f, 13f);
                deadline = EditorApplication.timeSinceStartup + 10.0;
                while (TeamForgeTransformSyncService.CurrentRevision <= peerRevision &&
                       EditorApplication.timeSinceStartup < deadline)
                {
                    yield return null;
                }
                Assert.That(
                    TeamForgeTransformSyncService.CurrentRevision,
                    Is.GreaterThan(peerRevision),
                    "Unity's post-handoff Transform was not acknowledged by the server.");
                Assert.That(VectorApproximately(target.transform.localPosition, new Vector3(11f, 12f, 13f)), Is.True);

                Assert.That(TeamForgeTransformSyncService.ReleaseSelectedLock(), Is.True);
                Selection.activeObject = null;

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
                    "Unity did not cleanly disconnect after the real-server authority E2E test.");
            }
            finally
            {
                TeamForgeConnectionService.TransformMessageReceived -= transformHandler;
                Selection.activeObject = null;
                TeamForgeConnectionService.Disconnect();

                previousSettings.Restore(settings);
                settings.SaveSettings();

                if (workingScene.IsValid() && workingScene.isLoaded)
                {
                    workingScene = EditorSceneManager.NewScene(
                        NewSceneSetup.EmptyScene,
                        NewSceneMode.Single);
                }
                if (!string.IsNullOrWhiteSpace(scenePath))
                {
                    AssetDatabase.DeleteAsset(scenePath);
                }
                RemoveTemporaryFolderIfEmpty();
            }
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

        private static bool VectorApproximately(Vector3 left, Vector3 right)
        {
            return (left - right).sqrMagnitude <= 0.0001f;
        }

        private static void EnsureTemporaryFolder()
        {
            if (!AssetDatabase.IsValidFolder(TemporaryFolder))
            {
                AssetDatabase.CreateFolder("Assets", "__TeamForgeCiE2E");
            }
        }

        private static void RemoveTemporaryFolderIfEmpty()
        {
            if (!AssetDatabase.IsValidFolder(TemporaryFolder))
            {
                return;
            }
            var absolute = System.IO.Path.GetFullPath(TemporaryFolder);
            if (System.IO.Directory.Exists(absolute) &&
                System.IO.Directory.GetFiles(absolute, "*", System.IO.SearchOption.AllDirectories).Length == 0)
            {
                AssetDatabase.DeleteAsset(TemporaryFolder);
            }
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

        private sealed class SettingsSnapshot
        {
            private readonly string _serverAddress;
            private readonly string _realtimePath;
            private readonly string _userName;
            private readonly string _userId;
            private readonly string _userColorHtml;
            private readonly string _projectId;
            private readonly string _sessionId;
            private readonly string _authenticationToken;
            private readonly int _connectionTimeoutSeconds;
            private readonly bool _autoReconnect;
            private readonly TeamForgeLogLevel _logLevel;
            private readonly bool _resumeAfterAssemblyReload;

            public SettingsSnapshot(TeamForgeConnectionSettings settings)
            {
                _serverAddress = settings.ServerAddress;
                _realtimePath = settings.RealtimePath;
                _userName = settings.UserName;
                _userId = settings.UserId;
                _userColorHtml = settings.UserColorHtml;
                _projectId = settings.ProjectId;
                _sessionId = settings.SessionId;
                _authenticationToken = settings.AuthenticationToken;
                _connectionTimeoutSeconds = settings.ConnectionTimeoutSeconds;
                _autoReconnect = settings.AutoReconnect;
                _logLevel = settings.LogLevel;
                _resumeAfterAssemblyReload = settings.ResumeAfterAssemblyReload;
            }

            public void Restore(TeamForgeConnectionSettings settings)
            {
                settings.ServerAddress = _serverAddress;
                settings.RealtimePath = _realtimePath;
                settings.UserName = _userName;
                settings.UserId = _userId;
                settings.UserColorHtml = _userColorHtml;
                settings.ProjectId = _projectId;
                settings.SessionId = _sessionId;
                settings.AuthenticationToken = _authenticationToken;
                settings.ConnectionTimeoutSeconds = _connectionTimeoutSeconds;
                settings.AutoReconnect = _autoReconnect;
                settings.LogLevel = _logLevel;
                settings.ResumeAfterAssemblyReload = _resumeAfterAssemblyReload;
            }
        }
    }
}

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
    public sealed class TeamForgeLockContentionE2ETests
    {
        private const string PeerUserId = "ci-contention-peer-b";
        private const string UnityUserId = "ci-contention-unity-a";
        private const string TemporaryFolder = "Assets/__TeamForgeCiContentionE2E";
        private static readonly Vector3 PeerAuthoritativePosition = new Vector3(20f, 30f, 40f);

        [UnityTest]
        public IEnumerator RemoteLock_BlocksTransformAndHierarchyThrash_ThenRecoversCleanly()
        {
            if (!IsContentionE2EEnabled())
            {
                Assert.Ignore("Lock-contention E2E is enabled only by the GitHub Actions contention workflow.");
            }

            TeamForgeConnectionService.Disconnect();
            TeamForgePresenceService.Registry.Clear();
            Selection.activeObject = null;

            var settings = TeamForgeConnectionService.Settings;
            var previousSettings = new SettingsSnapshot(settings);
            Scene workingScene = default;
            GameObject target = null;
            GameObject alternateParent = null;
            GameObject decoy = null;
            var scenePath = string.Empty;
            var unexpectedErrors = new List<string>();
            Application.LogCallback logHandler = (condition, stackTrace, type) =>
            {
                if (type == LogType.Error || type == LogType.Exception || type == LogType.Assert)
                {
                    unexpectedErrors.Add($"{type}: {condition}\n{stackTrace}");
                }
            };
            Application.logMessageReceived += logHandler;

            try
            {
                EnsureTemporaryFolder();
                scenePath = $"{TemporaryFolder}/{Guid.NewGuid():N}.unity";
                workingScene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                Assert.That(SceneManager.GetActiveScene().handle, Is.EqualTo(workingScene.handle));

                target = new GameObject("TeamForge CI Locked Target");
                alternateParent = new GameObject("TeamForge CI Alternate Parent");
                decoy = new GameObject("TeamForge CI Hierarchy Decoy");
                SceneManager.MoveGameObjectToScene(target, workingScene);
                SceneManager.MoveGameObjectToScene(alternateParent, workingScene);
                SceneManager.MoveGameObjectToScene(decoy, workingScene);
                Assert.That(EditorSceneManager.SaveScene(workingScene, scenePath), Is.True);
                Assert.That(workingScene.isDirty, Is.False);
                Assert.That(
                    TeamForgeObjectIdentity.TryGetCollaborativeObjectId(target, out var targetId),
                    Is.True,
                    "The saved contention target did not receive a collaborative identity.");
                Assert.That(targetId, Is.Not.Empty);

                settings.ServerAddress = "http://127.0.0.1:5080";
                settings.RealtimePath = "ws";
                settings.UserName = "CI Contention Unity A";
                settings.UserId = UnityUserId;
                settings.UserColorHtml = "#FFB74D";
                settings.ProjectId = "ci-contention-project";
                settings.SessionId = "ci-contention-session";
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
                Assert.That(TeamForgeConnectionService.TransformSyncAvailable, Is.True);
                Assert.That(TeamForgeConnectionService.HierarchySyncAvailable, Is.True);

                deadline = EditorApplication.timeSinceStartup + 10.0;
                while ((!TeamForgeHierarchySyncService.SnapshotReady ||
                        TeamForgeHierarchySyncService.TrackedObjectCount < 3) &&
                       EditorApplication.timeSinceStartup < deadline)
                {
                    yield return null;
                }
                Assert.That(TeamForgeHierarchySyncService.SnapshotReady, Is.True);
                Assert.That(
                    TeamForgeHierarchySyncService.TrackedObjectCount,
                    Is.GreaterThanOrEqualTo(3),
                    "The clean contention Scene was not seeded into authoritative Hierarchy state.");

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
                Assert.That(peer, Is.Not.Null, "The contention peer did not join the real session.");

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
                Assert.That(unityLock, Is.Not.Null, "Unity A did not acquire the initial contention target lock.");

                var initialRevision = TeamForgeTransformSyncService.CurrentRevision;
                target.transform.localPosition = new Vector3(5f, 6f, 7f);
                deadline = EditorApplication.timeSinceStartup + 10.0;
                while (TeamForgeTransformSyncService.CurrentRevision <= initialRevision &&
                       EditorApplication.timeSinceStartup < deadline)
                {
                    yield return null;
                }
                Assert.That(TeamForgeTransformSyncService.CurrentRevision, Is.GreaterThan(initialRevision));
                Assert.That(TeamForgeTransformSyncService.ReleaseSelectedLock(), Is.True);

                deadline = EditorApplication.timeSinceStartup + 15.0;
                TeamForgeLockRecord peerLock = null;
                while (EditorApplication.timeSinceStartup < deadline)
                {
                    if (TeamForgeTransformSyncService.TryGetSelectedLock(out var candidate) &&
                        candidate.ownerUserId == PeerUserId &&
                        VectorApproximately(target.transform.localPosition, PeerAuthoritativePosition))
                    {
                        peerLock = candidate;
                        break;
                    }
                    yield return null;
                }
                Assert.That(peerLock, Is.Not.Null, "Peer B did not take the target lock for contention testing.");
                Assert.That(
                    VectorApproximately(target.transform.localPosition, PeerAuthoritativePosition),
                    Is.True,
                    "Unity did not apply Peer B's authoritative contention Transform.");

                var contentionRevision = TeamForgeTransformSyncService.CurrentRevision;

                // Repeatedly bounce selection through the Hierarchy, then try to drag the locked object.
                // Each unauthorized local edit must be restored to Peer B's authoritative Transform and
                // must not advance the server revision.
                for (var attempt = 0; attempt < 5; attempt += 1)
                {
                    Selection.activeGameObject = decoy;
                    yield return null;
                    Selection.activeGameObject = target;
                    yield return null;

                    Undo.RecordObject(target.transform, $"CI locked Transform contention {attempt}");
                    target.transform.localPosition = new Vector3(100f + attempt, 200f + attempt, 300f + attempt);
                    EditorUtility.SetDirty(target.transform);

                    deadline = EditorApplication.timeSinceStartup + 3.0;
                    while (!VectorApproximately(target.transform.localPosition, PeerAuthoritativePosition) &&
                           EditorApplication.timeSinceStartup < deadline)
                    {
                        yield return null;
                    }
                    Assert.That(
                        VectorApproximately(target.transform.localPosition, PeerAuthoritativePosition),
                        Is.True,
                        $"Locked Transform attempt {attempt} escaped local rollback.");
                    Assert.That(
                        TeamForgeTransformSyncService.TryGetSelectedLock(out var stillPeerOwned) &&
                        stillPeerOwned.ownerUserId == PeerUserId,
                        Is.True,
                        $"Peer B lost authority unexpectedly during Transform contention attempt {attempt}.");
                }

                // Harder race: mutate the locked Transform and switch Hierarchy selection immediately,
                // before the regular Editor update loop gets a chance to perform the normal rollback.
                Selection.activeGameObject = decoy;
                yield return null;
                Selection.activeGameObject = target;
                yield return null;
                var selectionSwitchRevision = TeamForgeTransformSyncService.CurrentRevision;
                Undo.RecordObject(target.transform, "CI locked Transform immediate selection switch");
                target.transform.localPosition = new Vector3(901f, 902f, 903f);
                EditorUtility.SetDirty(target.transform);
                Selection.activeGameObject = decoy;
                yield return null;
                Assert.That(
                    VectorApproximately(target.transform.localPosition, PeerAuthoritativePosition),
                    Is.True,
                    "A locked Transform escaped rollback when the user changed Hierarchy selection in the same frame.");
                Assert.That(
                    TeamForgeTransformSyncService.CurrentRevision,
                    Is.EqualTo(selectionSwitchRevision),
                    "Immediate selection switching published an unauthorized Transform.");

                Selection.activeGameObject = target;
                yield return null;
                Assert.That(
                    TeamForgeTransformSyncService.TryGetSelectedLock(out var stillOwnedAfterSelectionRace) &&
                    stillOwnedAfterSelectionRace.ownerUserId == PeerUserId,
                    Is.True,
                    "Peer B lost authority after the immediate-selection race.");

                Assert.That(
                    TeamForgeTransformSyncService.CurrentRevision,
                    Is.EqualTo(contentionRevision),
                    "Unauthorized local Transform thrash advanced authoritative server revision.");
                Assert.That(TeamForgeTransformSyncService.SelectedObjectBlocked, Is.False);

                // Now attempt a destructive-ish Hierarchy edit while the target is still locked by B,
                // then switch away and back before the Hierarchy update can reconcile it. The authority
                // path must reject the edit and the Unity Hierarchy service must Undo it cleanly.
                var conflictCountBefore = TeamForgeHierarchySyncService.ConflictCount;
                Assert.That(target.transform.parent, Is.Null);
                Undo.SetTransformParent(target.transform, alternateParent.transform, "CI locked Hierarchy reparent contention");
                Selection.activeGameObject = decoy;
                Selection.activeGameObject = target;
                deadline = EditorApplication.timeSinceStartup + 8.0;
                while ((TeamForgeHierarchySyncService.ConflictCount <= conflictCountBefore ||
                        target.transform.parent != null) &&
                       EditorApplication.timeSinceStartup < deadline)
                {
                    yield return null;
                }
                Assert.That(
                    TeamForgeHierarchySyncService.ConflictCount,
                    Is.GreaterThan(conflictCountBefore),
                    "Locked reparent did not produce an authoritative Hierarchy conflict.");
                Assert.That(target.transform.parent, Is.Null, "Rejected locked reparent was not undone locally.");
                Assert.That(
                    VectorApproximately(target.transform.localPosition, PeerAuthoritativePosition),
                    Is.True,
                    "Hierarchy conflict recovery disturbed the authoritative Transform.");
                Assert.That(TeamForgeHierarchySyncService.HasPendingOperation, Is.False);
                Assert.That(
                    Selection.activeGameObject,
                    Is.SameAs(target),
                    "Hierarchy rejection Undo did not preserve the user's active target selection.");
                Assert.That(
                    TeamForgeTransformSyncService.TrackedObject,
                    Is.SameAs(target),
                    "Transform tracking was permanently dropped while Hierarchy Sync was reconciling a rejected reparent. " +
                    $"ActiveSelection={Selection.activeGameObject?.name ?? "<null>"}, " +
                    $"SelectedObjectId={TeamForgeTransformSyncService.SelectedObjectId}, " +
                    $"Blocked={TeamForgeTransformSyncService.SelectedObjectBlocked}, " +
                    $"Status={TeamForgeTransformSyncService.SelectedLockStatus}");
                Assert.That(
                    TeamForgeTransformSyncService.TryGetSelectedLock(out var peerLockAfterReconciliation) &&
                    peerLockAfterReconciliation.ownerUserId == PeerUserId,
                    Is.True,
                    "Hierarchy reconciliation left stale or missing foreign-lock state.");
                Assert.That(
                    TeamForgeTransformSyncService.SelectedObjectBlocked,
                    Is.False,
                    $"Rejected reparent left Transform Sync blocked: {TeamForgeTransformSyncService.SelectedLockStatus}");

                // Peer B releases on a timer after holding the lock long enough for the contention window.
                deadline = EditorApplication.timeSinceStartup + 20.0;
                while (TeamForgeTransformSyncService.TryGetSelectedLock(out var currentLock) &&
                       currentLock.ownerUserId == PeerUserId &&
                       EditorApplication.timeSinceStartup < deadline)
                {
                    yield return null;
                }
                Assert.That(
                    TeamForgeTransformSyncService.TryGetSelectedLock(out var afterPeerRelease) &&
                    afterPeerRelease.ownerUserId == PeerUserId,
                    Is.False,
                    "Peer B did not release after the contention window.");

                Selection.activeGameObject = target;
                yield return null;
                var requestedAfterContention = false;
                deadline = EditorApplication.timeSinceStartup + 5.0;
                while (!requestedAfterContention && EditorApplication.timeSinceStartup < deadline)
                {
                    requestedAfterContention = TeamForgeTransformSyncService.RequestSelectedLock();
                    if (!requestedAfterContention)
                    {
                        yield return null;
                    }
                }
                Assert.That(
                    requestedAfterContention,
                    Is.True,
                    $"Unity could not request the released object after contention recovery. " +
                    $"Tracked={TeamForgeTransformSyncService.TrackedObject != null}, " +
                    $"Blocked={TeamForgeTransformSyncService.SelectedObjectBlocked}, " +
                    $"Status={TeamForgeTransformSyncService.SelectedLockStatus}");
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
                Assert.That(unityLock, Is.Not.Null, "Unity A could not recover authority after contention ended.");

                var recoveryRevision = TeamForgeTransformSyncService.CurrentRevision;
                target.transform.localPosition = new Vector3(50f, 60f, 70f);
                deadline = EditorApplication.timeSinceStartup + 10.0;
                while (TeamForgeTransformSyncService.CurrentRevision <= recoveryRevision &&
                       EditorApplication.timeSinceStartup < deadline)
                {
                    yield return null;
                }
                Assert.That(
                    TeamForgeTransformSyncService.CurrentRevision,
                    Is.GreaterThan(recoveryRevision),
                    "Post-contention Transform did not resume normal authoritative synchronization.");
                Assert.That(TeamForgeTransformSyncService.ReleaseSelectedLock(), Is.True);

                Assert.That(
                    unexpectedErrors,
                    Is.Empty,
                    "Unity emitted Error/Exception/Assert logs during lock-contention recovery:\n" +
                    string.Join("\n---\n", unexpectedErrors));

                Selection.activeObject = null;
                TeamForgeConnectionService.Disconnect();
                deadline = EditorApplication.timeSinceStartup + 10.0;
                while (TeamForgeConnectionService.State != TeamForgeConnectionState.Disconnected &&
                       EditorApplication.timeSinceStartup < deadline)
                {
                    yield return null;
                }
                Assert.That(TeamForgeConnectionService.State, Is.EqualTo(TeamForgeConnectionState.Disconnected));
            }
            finally
            {
                Application.logMessageReceived -= logHandler;
                Selection.activeObject = null;
                TeamForgeConnectionService.Disconnect();
                previousSettings.Restore(settings);
                settings.SaveSettings();

                if (workingScene.IsValid() && workingScene.isLoaded)
                {
                    EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                }
                if (!string.IsNullOrWhiteSpace(scenePath))
                {
                    AssetDatabase.DeleteAsset(scenePath);
                }
                RemoveTemporaryFolderIfEmpty();
            }
        }

        private static bool VectorApproximately(Vector3 left, Vector3 right)
        {
            return (left - right).sqrMagnitude <= 0.0001f;
        }

        private static bool IsContentionE2EEnabled()
        {
            foreach (var argument in Environment.GetCommandLineArgs())
            {
                if (string.Equals(argument, "-teamforgeCiLockContentionE2E", StringComparison.OrdinalIgnoreCase))
                {
                    return true;
                }
            }
            return false;
        }

        private static void EnsureTemporaryFolder()
        {
            if (!AssetDatabase.IsValidFolder(TemporaryFolder))
            {
                AssetDatabase.CreateFolder("Assets", "__TeamForgeCiContentionE2E");
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

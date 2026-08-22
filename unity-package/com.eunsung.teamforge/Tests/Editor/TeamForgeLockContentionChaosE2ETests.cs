using System;
using System.Collections;
using System.Collections.Generic;
using System.Reflection;
using NUnit.Framework;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.TestTools;

namespace EunSung.TeamForge.Tests
{
    public sealed class TeamForgeLockContentionChaosE2ETests
    {
        private const string PeerUserId = "ci-contention-peer-b";
        private const string UnityUserId = "ci-contention-unity-a";
        private const string TemporaryFolder = "Assets/__TeamForgeCiContentionChaosE2E";
        private static readonly Vector3 PeerAuthoritativePosition = new Vector3(20f, 30f, 40f);
        private static readonly uint[] ChaosSeeds = { 12648430u, 3735928559u, 195936478u };

        [UnityTest]
        public IEnumerator ForeignLock_RapidTransformThrash_NeverEscapesOrCreatesProtectedConflict()
        {
            if (!IsChaosE2EEnabled())
            {
                Assert.Ignore("Unity authority chaos E2E is enabled only by the dedicated GitHub Actions workflow.");
            }

            TeamForgeConnectionService.Disconnect();
            TeamForgePresenceService.Registry.Clear();
            Selection.activeObject = null;

            var settings = TeamForgeConnectionService.Settings;
            var previousSettings = new SettingsSnapshot(settings);
            Scene workingScene = default;
            GameObject target = null;
            GameObject decoy = null;
            var scenePath = string.Empty;
            var teamForgeWarnings = new List<string>();
            Application.LogCallback logHandler = (condition, stackTrace, type) =>
            {
                if (type == LogType.Warning && condition != null && condition.Contains("[TeamForge]"))
                {
                    teamForgeWarnings.Add(condition);
                }
            };
            Application.logMessageReceived += logHandler;

            try
            {
                EnsureTemporaryFolder();
                scenePath = $"{TemporaryFolder}/{Guid.NewGuid():N}.unity";
                workingScene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                target = new GameObject("TeamForge CI Chaos Locked Target");
                decoy = new GameObject("TeamForge CI Chaos Decoy");
                SceneManager.MoveGameObjectToScene(target, workingScene);
                SceneManager.MoveGameObjectToScene(decoy, workingScene);
                Assert.That(EditorSceneManager.SaveScene(workingScene, scenePath), Is.True);
                Assert.That(workingScene.isDirty, Is.False);
                Assert.That(
                    TeamForgeObjectIdentity.TryGetCollaborativeObjectId(target, out var targetId),
                    Is.True,
                    "The saved chaos target did not receive a collaborative identity.");
                Assert.That(targetId, Is.Not.Empty);

                settings.ServerAddress = "http://127.0.0.1:5080";
                settings.RealtimePath = "ws";
                settings.UserName = "CI Chaos Unity A";
                settings.UserId = UnityUserId;
                settings.UserColorHtml = "#FFB74D";
                settings.ProjectId = "ci-contention-project";
                settings.SessionId = "ci-contention-session";
                settings.AuthenticationToken = string.Empty;
                settings.ConnectionTimeoutSeconds = 10;
                settings.AutoReconnect = false;
                settings.TransformUpdatesPerSecond = 30;
                settings.LockRenewalSeconds = 1;
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
                        TeamForgeHierarchySyncService.TrackedObjectCount < 2) &&
                       EditorApplication.timeSinceStartup < deadline)
                {
                    yield return null;
                }
                Assert.That(TeamForgeHierarchySyncService.SnapshotReady, Is.True);
                Assert.That(TeamForgeHierarchySyncService.TrackedObjectCount, Is.GreaterThanOrEqualTo(2));

                PresenceRecord peer = null;
                deadline = EditorApplication.timeSinceStartup + 10.0;
                while (peer == null && EditorApplication.timeSinceStartup < deadline)
                {
                    TeamForgePresenceService.Registry.TryGet(PeerUserId, out peer);
                    if (peer == null) yield return null;
                }
                Assert.That(peer, Is.Not.Null, "The chaos contention peer did not join the real session.");

                // Give Peer B a concrete target by acquiring once, publishing one legitimate Transform,
                // then explicitly releasing. The peer takes over and continuously renews the same lock.
                Selection.activeGameObject = target;
                deadline = EditorApplication.timeSinceStartup + 10.0;
                while (EditorApplication.timeSinceStartup < deadline)
                {
                    if (TeamForgeTransformSyncService.TryGetSelectedLock(out var candidate) &&
                        candidate.ownerConnectionId == TeamForgeConnectionService.ConnectionId)
                    {
                        break;
                    }
                    yield return null;
                }
                Assert.That(
                    TeamForgeTransformSyncService.TryGetSelectedLock(out var initialUnityLock) &&
                    initialUnityLock.ownerConnectionId == TeamForgeConnectionService.ConnectionId,
                    Is.True,
                    "Unity A did not acquire the initial chaos target lock.");

                var initialRevision = TeamForgeTransformSyncService.CurrentRevision;
                Undo.RecordObject(target.transform, "CI chaos initial authorized Transform");
                target.transform.localPosition = new Vector3(5f, 6f, 7f);
                EditorUtility.SetDirty(target.transform);
                deadline = EditorApplication.timeSinceStartup + 10.0;
                while (TeamForgeTransformSyncService.CurrentRevision <= initialRevision &&
                       EditorApplication.timeSinceStartup < deadline)
                {
                    yield return null;
                }
                Assert.That(TeamForgeTransformSyncService.CurrentRevision, Is.GreaterThan(initialRevision));
                Assert.That(TeamForgeTransformSyncService.ReleaseSelectedLock(), Is.True);

                deadline = EditorApplication.timeSinceStartup + 15.0;
                while (EditorApplication.timeSinceStartup < deadline)
                {
                    if (TeamForgeTransformSyncService.TryGetSelectedLock(out var candidate) &&
                        candidate.ownerUserId == PeerUserId &&
                        VectorApproximately(target.transform.localPosition, PeerAuthoritativePosition))
                    {
                        break;
                    }
                    yield return null;
                }
                AssertForeignLockAndHealthy(target, "before chaos");

                var authorityRevision = TeamForgeTransformSyncService.CurrentRevision;
                for (var seedIndex = 0; seedIndex < ChaosSeeds.Length; seedIndex += 1)
                {
                    var seed = ChaosSeeds[seedIndex];
                    var random = new System.Random(unchecked((int)seed));
                    for (var burst = 0; burst < 8; burst += 1)
                    {
                        Selection.activeGameObject = target;
                        yield return null;
                        AssertForeignLockAndHealthy(target, $"seed {seed} burst {burst} precondition");

                        var operations = 48 + random.Next(80);
                        for (var operation = 0; operation < operations; operation += 1)
                        {
                            Undo.RecordObject(target.transform, $"CI chaos {seed}-{burst}-{operation}");
                            target.transform.localPosition = new Vector3(
                                1000f + seedIndex * 100f + burst * 10f + operation,
                                2000f + random.Next(-500, 501),
                                3000f + random.Next(-500, 501));
                            EditorUtility.SetDirty(target.transform);

                            // Mix same-frame selection churn into some bursts. This intentionally gives
                            // the lock/Undo/selection callbacks adversarial ordering instead of waiting
                            // for the normal rollback after every attempted drag.
                            if (operation > 0 && operation % 17 == 0)
                            {
                                Selection.activeGameObject = decoy;
                                Selection.activeGameObject = target;
                            }

                            if (operation > 0 && operation % 11 == 0)
                            {
                                yield return null;
                            }

                            if (ProtectedConflictCount() > 0 || TeamForgeTransformSyncService.SelectedObjectBlocked)
                            {
                                Assert.Fail(
                                    $"Chaos reproduced a protected Transform conflict during seed {seed}, " +
                                    $"burst {burst}, operation {operation}. Status={TeamForgeTransformSyncService.SelectedLockStatus}\n" +
                                    WarningSummary(teamForgeWarnings));
                            }
                        }

                        // Let normal Editor updates reconcile the final attempted local value. While B
                        // still owns the lock the attempted value must not stick, authority must not
                        // advance, and the local client must not enter ProtectedConflictKeys.
                        deadline = EditorApplication.timeSinceStartup + 2.0;
                        while (!VectorApproximately(target.transform.localPosition, PeerAuthoritativePosition) &&
                               EditorApplication.timeSinceStartup < deadline)
                        {
                            yield return null;
                        }

                        AssertForeignLockAndHealthy(target, $"seed {seed} burst {burst} postcondition");
                        Assert.That(
                            TeamForgeTransformSyncService.CurrentRevision,
                            Is.EqualTo(authorityRevision),
                            $"Unauthorized chaos edits advanced server revision during seed {seed}, burst {burst}.");
                    }
                }

                Assert.That(
                    teamForgeWarnings.Exists(message =>
                        message.Contains("Protected unresolved local Transform conflict", StringComparison.Ordinal)),
                    Is.False,
                    "Chaos emitted the field-reported protected-conflict warning:\n" + WarningSummary(teamForgeWarnings));

                // The peer eventually releases. Unity must then be able to acquire and publish normally;
                // this catches hidden stale lock/protected state even if it did not surface in the UI.
                deadline = EditorApplication.timeSinceStartup + 40.0;
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
                    "Chaos peer did not release the target within the configured hold window.");

                Selection.activeGameObject = target;
                yield return null;
                var requested = false;
                deadline = EditorApplication.timeSinceStartup + 5.0;
                while (!requested && EditorApplication.timeSinceStartup < deadline)
                {
                    requested = TeamForgeTransformSyncService.RequestSelectedLock();
                    if (!requested) yield return null;
                }
                Assert.That(requested, Is.True, $"Post-chaos lock request failed. Status={TeamForgeTransformSyncService.SelectedLockStatus}");

                deadline = EditorApplication.timeSinceStartup + 10.0;
                while (EditorApplication.timeSinceStartup < deadline)
                {
                    if (TeamForgeTransformSyncService.TryGetSelectedLock(out var candidate) &&
                        candidate.ownerConnectionId == TeamForgeConnectionService.ConnectionId)
                    {
                        break;
                    }
                    yield return null;
                }
                Assert.That(
                    TeamForgeTransformSyncService.TryGetSelectedLock(out var recoveredLock) &&
                    recoveredLock.ownerConnectionId == TeamForgeConnectionService.ConnectionId,
                    Is.True,
                    "Unity could not reacquire authority after chaos contention.");
                Assert.That(ProtectedConflictCount(), Is.EqualTo(0));
                Assert.That(TeamForgeTransformSyncService.SelectedObjectBlocked, Is.False);

                var recoveryRevision = TeamForgeTransformSyncService.CurrentRevision;
                Undo.RecordObject(target.transform, "CI chaos recovery Transform");
                target.transform.localPosition = new Vector3(50f, 60f, 70f);
                EditorUtility.SetDirty(target.transform);
                deadline = EditorApplication.timeSinceStartup + 10.0;
                while (TeamForgeTransformSyncService.CurrentRevision <= recoveryRevision &&
                       EditorApplication.timeSinceStartup < deadline)
                {
                    yield return null;
                }
                Assert.That(
                    TeamForgeTransformSyncService.CurrentRevision,
                    Is.GreaterThan(recoveryRevision),
                    "Normal Transform synchronization did not recover after chaos contention.");
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

        private static void AssertForeignLockAndHealthy(GameObject target, string phase)
        {
            Assert.That(
                TeamForgeTransformSyncService.TryGetSelectedLock(out var lockState) &&
                lockState.ownerUserId == PeerUserId,
                Is.True,
                $"Foreign lock authority was lost during {phase}. Status={TeamForgeTransformSyncService.SelectedLockStatus}");
            Assert.That(
                ProtectedConflictCount(),
                Is.EqualTo(0),
                $"ProtectedConflictKeys became non-empty during {phase}. Status={TeamForgeTransformSyncService.SelectedLockStatus}");
            Assert.That(
                TeamForgeTransformSyncService.SelectedObjectBlocked,
                Is.False,
                $"Transform tracking became blocked during {phase}. Status={TeamForgeTransformSyncService.SelectedLockStatus}");
            Assert.That(
                VectorApproximately(target.transform.localPosition, PeerAuthoritativePosition),
                Is.True,
                $"Unauthorized local Transform escaped rollback during {phase}: {target.transform.localPosition}");
        }

        private static int ProtectedConflictCount()
        {
            var field = typeof(TeamForgeTransformSyncService).GetField(
                "ProtectedConflictKeys",
                BindingFlags.Static | BindingFlags.NonPublic);
            Assert.That(field, Is.Not.Null, "ProtectedConflictKeys field was not found.");
            var value = field.GetValue(null);
            Assert.That(value, Is.Not.Null);
            var countProperty = value.GetType().GetProperty("Count", BindingFlags.Instance | BindingFlags.Public);
            Assert.That(countProperty, Is.Not.Null, "ProtectedConflictKeys.Count was not found.");
            return (int)countProperty.GetValue(value);
        }

        private static bool VectorApproximately(Vector3 left, Vector3 right)
        {
            return (left - right).sqrMagnitude <= 0.0001f;
        }

        private static string WarningSummary(List<string> warnings)
        {
            if (warnings == null || warnings.Count == 0) return "No TeamForge warnings captured.";
            var start = Math.Max(0, warnings.Count - 12);
            return string.Join("\n", warnings.GetRange(start, warnings.Count - start));
        }

        private static bool IsChaosE2EEnabled()
        {
            foreach (var argument in Environment.GetCommandLineArgs())
            {
                if (string.Equals(argument, "-teamforgeCiAuthorityChaosE2E", StringComparison.OrdinalIgnoreCase))
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
                AssetDatabase.CreateFolder("Assets", "__TeamForgeCiContentionChaosE2E");
            }
        }

        private static void RemoveTemporaryFolderIfEmpty()
        {
            if (!AssetDatabase.IsValidFolder(TemporaryFolder)) return;
            var assets = AssetDatabase.FindAssets(string.Empty, new[] { TemporaryFolder });
            if (assets.Length == 0)
            {
                AssetDatabase.DeleteAsset(TemporaryFolder);
            }
        }

        private readonly struct SettingsSnapshot
        {
            private readonly string _serverAddress;
            private readonly string _realtimePath;
            private readonly string _userName;
            private readonly string _userId;
            private readonly string _userColor;
            private readonly string _projectId;
            private readonly string _sessionId;
            private readonly string _authenticationToken;
            private readonly int _connectionTimeoutSeconds;
            private readonly bool _autoReconnect;
            private readonly int _transformUpdatesPerSecond;
            private readonly int _lockRenewalSeconds;
            private readonly TeamForgeLogLevel _logLevel;
            private readonly bool _resumeAfterAssemblyReload;

            public SettingsSnapshot(TeamForgeConnectionSettings settings)
            {
                _serverAddress = settings.ServerAddress;
                _realtimePath = settings.RealtimePath;
                _userName = settings.UserName;
                _userId = settings.UserId;
                _userColor = settings.UserColorHtml;
                _projectId = settings.ProjectId;
                _sessionId = settings.SessionId;
                _authenticationToken = settings.AuthenticationToken;
                _connectionTimeoutSeconds = settings.ConnectionTimeoutSeconds;
                _autoReconnect = settings.AutoReconnect;
                _transformUpdatesPerSecond = settings.TransformUpdatesPerSecond;
                _lockRenewalSeconds = settings.LockRenewalSeconds;
                _logLevel = settings.LogLevel;
                _resumeAfterAssemblyReload = settings.ResumeAfterAssemblyReload;
            }

            public void Restore(TeamForgeConnectionSettings settings)
            {
                settings.ServerAddress = _serverAddress;
                settings.RealtimePath = _realtimePath;
                settings.UserName = _userName;
                settings.UserId = _userId;
                settings.UserColorHtml = _userColor;
                settings.ProjectId = _projectId;
                settings.SessionId = _sessionId;
                settings.AuthenticationToken = _authenticationToken;
                settings.ConnectionTimeoutSeconds = _connectionTimeoutSeconds;
                settings.AutoReconnect = _autoReconnect;
                settings.TransformUpdatesPerSecond = _transformUpdatesPerSecond;
                settings.LockRenewalSeconds = _lockRenewalSeconds;
                settings.LogLevel = _logLevel;
                settings.ResumeAfterAssemblyReload = _resumeAfterAssemblyReload;
            }
        }
    }
}

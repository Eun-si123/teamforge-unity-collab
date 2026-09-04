using System;
using System.Collections;
using System.Collections.Generic;
using System.Reflection;
using System.Threading;
using NUnit.Framework;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.TestTools;

namespace EunSung.TeamForge.Tests
{
    public sealed class TeamForgeLeaseStallChaosE2ETests
    {
        private const string UnityUserId = "ci-lease-stall-unity-a";
        private const string PeerUserId = "ci-lease-stall-peer-b";
        private const string TemporaryFolder = "Assets/__TeamForgeCiLeaseStallChaosE2E";
        private const string TargetName = "TeamForge CI Lease Stall Target";
        private static readonly Vector3 InitialUnityPosition = new Vector3(5f, 6f, 7f);
        private static readonly Vector3 PeerTakeoverPosition = new Vector3(80f, 90f, 100f);
        private static readonly Vector3 RecoveryPosition = new Vector3(150f, 160f, 170f);

        [UnityTest]
        public IEnumerator MainThreadStall_AcrossLeaseExpiry_ConvergesWithoutStaleAuthority()
        {
            if (!IsEnabled())
            {
                Assert.Ignore("Unity lease-stall chaos E2E is enabled only by the dedicated chaos workflow.");
            }

            TeamForgeConnectionService.Disconnect();
            TeamForgePresenceService.Registry.Clear();
            Selection.activeObject = null;

            var settings = TeamForgeConnectionService.Settings;
            var previousSettings = new SettingsSnapshot(settings);
            Scene workingScene = default;
            var scenePath = string.Empty;
            var warnings = new List<string>();
            Application.LogCallback logHandler = (condition, stackTrace, type) =>
            {
                if ((type == LogType.Warning || type == LogType.Error) &&
                    condition != null && condition.Contains("[TeamForge]"))
                {
                    warnings.Add(condition);
                }
            };
            Application.logMessageReceived += logHandler;

            try
            {
                EnsureTemporaryFolder();
                scenePath = $"{TemporaryFolder}/{Guid.NewGuid():N}.unity";
                workingScene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                var target = new GameObject(TargetName);
                var decoy = new GameObject("TeamForge CI Lease Stall Decoy");
                SceneManager.MoveGameObjectToScene(target, workingScene);
                SceneManager.MoveGameObjectToScene(decoy, workingScene);
                Assert.That(EditorSceneManager.SaveScene(workingScene, scenePath), Is.True);
                Assert.That(TeamForgeObjectIdentity.TryGetCollaborativeObjectId(target, out var targetId), Is.True);
                Assert.That(targetId, Is.Not.Empty);

                Configure(settings);
                TeamForgeConnectionService.Connect();
                yield return WaitForConnected("initial connect");
                yield return WaitForHierarchyReady();
                yield return WaitForPeerPresence();

                Selection.activeGameObject = target;
                yield return WaitForOwnedLock("initial lock");

                var revision = TeamForgeTransformSyncService.CurrentRevision;
                Undo.RecordObject(target.transform, "CI lease-stall initial Transform");
                target.transform.localPosition = InitialUnityPosition;
                EditorUtility.SetDirty(target.transform);
                yield return WaitForRevisionGreaterThan(revision, "initial authorized Transform");
                Assert.That(ProtectedConflictCount(), Is.EqualTo(0));
                Assert.That(TeamForgeTransformSyncService.SelectedObjectBlocked, Is.False);

                // Simulate a genuinely frozen Editor main thread: long GC, synchronous import,
                // debugger pause, OS scheduling hiccup, or an expensive editor callback. No Update,
                // selection callback, or TeamForge lock-renew callback can run during this window.
                // The workflow server uses a 2200 ms lease; 3600 ms crosses the deadline decisively.
                var stallStartedAt = EditorApplication.timeSinceStartup;
                Thread.Sleep(3600);
                var stalledFor = EditorApplication.timeSinceStartup - stallStartedAt;
                Assert.That(stalledFor, Is.GreaterThanOrEqualTo(3.4), "The intended lease-crossing Editor stall was too short.");

                // Let queued socket/editor callbacks drain. Peer B should have observed lease expiry,
                // acquired authority, and published a new Transform while Unity was frozen.
                var deadline = EditorApplication.timeSinceStartup + 12.0;
                while (EditorApplication.timeSinceStartup < deadline)
                {
                    var peerOwns = TeamForgeTransformSyncService.TryGetSelectedLock(out var currentLock) &&
                                   currentLock.ownerUserId == PeerUserId;
                    if (peerOwns && VectorApproximately(target.transform.localPosition, PeerTakeoverPosition))
                    {
                        break;
                    }
                    yield return null;
                }

                Assert.That(
                    TeamForgeTransformSyncService.TryGetSelectedLock(out var takeoverLock) &&
                    takeoverLock.ownerUserId == PeerUserId,
                    Is.True,
                    "Unity did not converge on Peer B authority after the main-thread stall. " +
                    $"Status={TeamForgeTransformSyncService.SelectedLockStatus}\n{WarningSummary(warnings)}");
                Assert.That(
                    VectorApproximately(target.transform.localPosition, PeerTakeoverPosition),
                    Is.True,
                    $"Unity did not apply the post-expiry authoritative Transform; actual={target.transform.localPosition}.\n" +
                    WarningSummary(warnings));

                // There was no local edit during the frozen interval. Missing a renewal must not leave
                // a phantom local conflict or stale-owned UI state once the new owner is known.
                Assert.That(
                    ProtectedConflictCount(),
                    Is.EqualTo(0),
                    "A pure Editor stall created a protected conflict despite no divergent local edit.\n" + WarningSummary(warnings));
                Assert.That(
                    TeamForgeTransformSyncService.SelectedObjectBlocked,
                    Is.False,
                    "Transform sync remained blocked after authoritative takeover with no local divergence.\n" + WarningSummary(warnings));
                Assert.That(
                    warnings.Exists(message => message.Contains("Protected unresolved local Transform conflict", StringComparison.Ordinal)),
                    Is.False,
                    "Lease-stall recovery emitted the field #68 protected-conflict symptom.\n" + WarningSummary(warnings));

                // While the peer still owns the lock, hammer one local edit and immediately churn
                // selection. It must roll back and must not resurrect Unity's expired authority.
                Undo.RecordObject(target.transform, "CI lease-stall stale local probe");
                target.transform.localPosition = new Vector3(999f, 998f, 997f);
                EditorUtility.SetDirty(target.transform);
                Selection.activeGameObject = decoy;
                Selection.activeGameObject = target;
                yield return null;
                yield return null;
                Assert.That(VectorApproximately(target.transform.localPosition, PeerTakeoverPosition), Is.True,
                    "A stale post-stall local edit escaped rollback while Peer B owned the lock.");
                Assert.That(ProtectedConflictCount(), Is.EqualTo(0));

                // Peer B releases after its hold window. Unity must be able to reacquire and publish,
                // proving that expiry/takeover did not poison the client state machine permanently.
                deadline = EditorApplication.timeSinceStartup + 15.0;
                while (TeamForgeTransformSyncService.TryGetSelectedLock(out var held) &&
                       held.ownerUserId == PeerUserId &&
                       EditorApplication.timeSinceStartup < deadline)
                {
                    yield return null;
                }
                Assert.That(
                    TeamForgeTransformSyncService.TryGetSelectedLock(out var afterRelease) && afterRelease.ownerUserId == PeerUserId,
                    Is.False,
                    "Peer B did not release the lease-stall target.");

                Selection.activeGameObject = target;
                yield return WaitForOwnedLock("post-stall recovery lock");
                var recoveryRevision = TeamForgeTransformSyncService.CurrentRevision;
                Undo.RecordObject(target.transform, "CI lease-stall recovery Transform");
                target.transform.localPosition = RecoveryPosition;
                EditorUtility.SetDirty(target.transform);
                yield return WaitForRevisionGreaterThan(recoveryRevision, "post-stall recovery Transform");
                Assert.That(ProtectedConflictCount(), Is.EqualTo(0));
                Assert.That(TeamForgeTransformSyncService.SelectedObjectBlocked, Is.False);
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
                if (!string.IsNullOrWhiteSpace(scenePath)) AssetDatabase.DeleteAsset(scenePath);
                RemoveTemporaryFolderIfEmpty();
            }
        }

        private static void Configure(TeamForgeConnectionSettings settings)
        {
            settings.ServerAddress = "http://127.0.0.1:5080";
            settings.RealtimePath = "ws";
            settings.UserName = "CI Lease Stall Unity A";
            settings.UserId = UnityUserId;
            settings.UserColorHtml = "#FFB74D";
            settings.ProjectId = "ci-lease-stall-project";
            settings.SessionId = "ci-lease-stall-session";
            settings.AuthenticationToken = string.Empty;
            settings.ConnectionTimeoutSeconds = 10;
            settings.AutoReconnect = false;
            settings.TransformUpdatesPerSecond = 30;
            settings.LockRenewalSeconds = 1;
            settings.LogLevel = TeamForgeLogLevel.Info;
            settings.ResumeAfterAssemblyReload = false;
            settings.SaveSettings();
        }

        private static IEnumerator WaitForConnected(string phase)
        {
            var deadline = EditorApplication.timeSinceStartup + 20.0;
            while (TeamForgeConnectionService.State != TeamForgeConnectionState.Connected &&
                   EditorApplication.timeSinceStartup < deadline)
            {
                yield return null;
            }
            Assert.That(TeamForgeConnectionService.State, Is.EqualTo(TeamForgeConnectionState.Connected),
                $"TeamForge did not connect during {phase}. LastError={TeamForgeConnectionService.LastError}");
        }

        private static IEnumerator WaitForHierarchyReady()
        {
            var deadline = EditorApplication.timeSinceStartup + 10.0;
            while (!TeamForgeHierarchySyncService.SnapshotReady && EditorApplication.timeSinceStartup < deadline)
            {
                yield return null;
            }
            Assert.That(TeamForgeHierarchySyncService.SnapshotReady, Is.True, "Hierarchy snapshot never became ready.");
        }

        private static IEnumerator WaitForPeerPresence()
        {
            PresenceRecord peer = null;
            var deadline = EditorApplication.timeSinceStartup + 10.0;
            while (peer == null && EditorApplication.timeSinceStartup < deadline)
            {
                TeamForgePresenceService.Registry.TryGet(PeerUserId, out peer);
                if (peer == null) yield return null;
            }
            Assert.That(peer, Is.Not.Null, "Lease-stall peer did not join the session.");
        }

        private static IEnumerator WaitForOwnedLock(string phase)
        {
            var requestDeadline = EditorApplication.timeSinceStartup + 8.0;
            while (EditorApplication.timeSinceStartup < requestDeadline)
            {
                if (TeamForgeTransformSyncService.TryGetSelectedLock(out var existing) &&
                    existing.ownerConnectionId == TeamForgeConnectionService.ConnectionId)
                {
                    yield break;
                }
                TeamForgeTransformSyncService.RequestSelectedLock();
                yield return null;
            }
            Assert.Fail($"Unity did not own the selected lock during {phase}. Status={TeamForgeTransformSyncService.SelectedLockStatus}");
        }

        private static IEnumerator WaitForRevisionGreaterThan(long revision, string phase)
        {
            var deadline = EditorApplication.timeSinceStartup + 10.0;
            while (TeamForgeTransformSyncService.CurrentRevision <= revision && EditorApplication.timeSinceStartup < deadline)
            {
                yield return null;
            }
            Assert.That(TeamForgeTransformSyncService.CurrentRevision, Is.GreaterThan(revision),
                $"Server revision did not advance during {phase}.");
        }

        private static int ProtectedConflictCount()
        {
            var field = typeof(TeamForgeTransformSyncService).GetField("ProtectedConflictKeys", BindingFlags.Static | BindingFlags.NonPublic);
            Assert.That(field, Is.Not.Null, "ProtectedConflictKeys field was not found.");
            var value = field.GetValue(null);
            Assert.That(value, Is.Not.Null);
            var countProperty = value.GetType().GetProperty("Count", BindingFlags.Instance | BindingFlags.Public);
            Assert.That(countProperty, Is.Not.Null);
            return (int)countProperty.GetValue(value);
        }

        private static bool VectorApproximately(Vector3 left, Vector3 right)
        {
            return (left - right).sqrMagnitude <= 0.0001f;
        }

        private static string WarningSummary(List<string> warnings)
        {
            if (warnings == null || warnings.Count == 0) return "No TeamForge warnings captured.";
            var start = Math.Max(0, warnings.Count - 20);
            return string.Join("\n", warnings.GetRange(start, warnings.Count - start));
        }

        private static bool IsEnabled()
        {
            foreach (var argument in Environment.GetCommandLineArgs())
            {
                if (string.Equals(argument, "-teamforgeCiLeaseStallChaosE2E", StringComparison.OrdinalIgnoreCase)) return true;
            }
            return false;
        }

        private static void EnsureTemporaryFolder()
        {
            if (!AssetDatabase.IsValidFolder(TemporaryFolder)) AssetDatabase.CreateFolder("Assets", "__TeamForgeCiLeaseStallChaosE2E");
        }

        private static void RemoveTemporaryFolderIfEmpty()
        {
            if (!AssetDatabase.IsValidFolder(TemporaryFolder)) return;
            var assets = AssetDatabase.FindAssets(string.Empty, new[] { TemporaryFolder });
            if (assets.Length == 0) AssetDatabase.DeleteAsset(TemporaryFolder);
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

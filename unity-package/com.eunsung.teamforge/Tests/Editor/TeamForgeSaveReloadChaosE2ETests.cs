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
    public sealed class TeamForgeSaveReloadChaosE2ETests
    {
        private const string UnityUserId = "ci-save-reload-unity-a";
        private const string PeerUserId = "ci-save-reload-peer-b";
        private const string TemporaryFolder = "Assets/__TeamForgeCiSaveReloadChaosE2E";
        private const string TargetName = "TeamForge CI Save Reload Target";
        private static readonly Vector3 FirstPeerPosition = new Vector3(20f, 30f, 40f);
        private static readonly Vector3 DirtyLocalPosition = new Vector3(55f, 66f, 77f);
        private static readonly Vector3 SecondPeerPosition = new Vector3(80f, 90f, 100f);

        [UnityTest]
        public IEnumerator UndoRedo_SaveReload_DirtyReconnect_ReconcilesAuthoritativeState()
        {
            if (!IsEnabled())
            {
                Assert.Ignore("Unity save/reload chaos E2E is enabled only by the dedicated workflow lane.");
            }

            TeamForgeConnectionService.Disconnect();
            TeamForgePresenceService.Registry.Clear();
            Selection.activeObject = null;
            Undo.ClearAll();

            var settings = TeamForgeConnectionService.Settings;
            var previousSettings = new SettingsSnapshot(settings);
            var scenePath = string.Empty;
            Scene workingScene = default;
            var warnings = new List<string>();
            Application.LogCallback logHandler = (condition, stackTrace, type) =>
            {
                if (type == LogType.Warning && condition != null && condition.Contains("[TeamForge]"))
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
                var decoy = new GameObject("TeamForge CI Save Reload Decoy");
                SceneManager.MoveGameObjectToScene(target, workingScene);
                SceneManager.MoveGameObjectToScene(decoy, workingScene);
                Assert.That(EditorSceneManager.SaveScene(workingScene, scenePath), Is.True);
                Assert.That(workingScene.isDirty, Is.False);
                Assert.That(TeamForgeObjectIdentity.TryGetCollaborativeObjectId(target, out var targetId), Is.True);
                Assert.That(targetId, Is.Not.Empty);

                Configure(settings);
                TeamForgeConnectionService.Connect();
                yield return WaitForConnected("initial connect");
                yield return WaitForHierarchyReady("initial snapshot");
                yield return WaitForPeerPresence();

                Selection.activeGameObject = target;
                yield return WaitForOwnedLock("initial local lock");

                // Exercise Unity's real Undo stack while TeamForge owns the authoritative lock.
                var revisionBeforeUndoChaos = TeamForgeTransformSyncService.CurrentRevision;
                Undo.RecordObject(target.transform, "CI save/reload authorized Transform");
                target.transform.localPosition = new Vector3(5f, 6f, 7f);
                EditorUtility.SetDirty(target.transform);
                yield return WaitForRevisionGreaterThan(revisionBeforeUndoChaos, "initial authorized Transform");

                for (var cycle = 0; cycle < 3; cycle += 1)
                {
                    Undo.PerformUndo();
                    yield return null;
                    yield return null;
                    AssertHealthy($"undo cycle {cycle}");

                    Undo.PerformRedo();
                    yield return null;
                    yield return null;
                    AssertHealthy($"redo cycle {cycle}");
                }

                Assert.That(VectorApproximately(target.transform.localPosition, new Vector3(5f, 6f, 7f)), Is.True,
                    $"Undo/Redo chaos ended at unexpected Transform {target.transform.localPosition}.");
                Assert.That(TeamForgeTransformSyncService.ReleaseSelectedLock(), Is.True);

                // Peer B takes over, publishes an authoritative Transform, and releases it.
                yield return WaitForPosition(target, FirstPeerPosition, 15.0, "first peer authoritative Transform");
                AssertHealthy("after first peer authoritative Transform");

                // Persist the collaborative result, then force a real Scene reload while connection remains alive.
                Assert.That(EditorSceneManager.SaveScene(workingScene), Is.True);
                Assert.That(workingScene.isDirty, Is.False);
                workingScene = EditorSceneManager.OpenScene(scenePath, OpenSceneMode.Single);
                yield return null;
                yield return null;
                Assert.That(TeamForgeConnectionService.State, Is.EqualTo(TeamForgeConnectionState.Connected),
                    $"Scene reload unexpectedly dropped TeamForge: {TeamForgeConnectionService.LastError}");

                target = GameObject.Find(TargetName);
                Assert.That(target, Is.Not.Null, "Target disappeared after Scene reload.");
                Assert.That(TeamForgeObjectIdentity.TryGetCollaborativeObjectId(target, out var reloadedId), Is.True);
                Assert.That(reloadedId, Is.EqualTo(targetId), "Collaborative identity changed across Save/Reload.");
                Assert.That(VectorApproximately(target.transform.localPosition, FirstPeerPosition), Is.True,
                    $"Saved authoritative Transform did not survive reload: {target.transform.localPosition}");
                AssertHealthy("after Save/Reload");

                // Make one authorized post-reload edit and deliberately leave the Scene dirty.
                Selection.activeGameObject = target;
                yield return WaitForOwnedLock("post-reload local lock");
                var revisionBeforeDirtyEdit = TeamForgeTransformSyncService.CurrentRevision;
                Undo.RecordObject(target.transform, "CI dirty reconnect Transform");
                target.transform.localPosition = DirtyLocalPosition;
                EditorUtility.SetDirty(target.transform);
                yield return WaitForRevisionGreaterThan(revisionBeforeDirtyEdit, "post-reload dirty edit");
                Assert.That(workingScene.isDirty, Is.True, "Post-reload collaborative edit did not leave the Scene dirty.");
                Assert.That(VectorApproximately(target.transform.localPosition, DirtyLocalPosition), Is.True);
                AssertHealthy("before dirty disconnect");

                // Release authority but DO NOT save. Disconnect only TeamForge. Peer B moves the target while offline.
                Assert.That(TeamForgeTransformSyncService.ReleaseSelectedLock(), Is.True);
                TeamForgeConnectionService.Disconnect();
                var disconnectedDeadline = EditorApplication.timeSinceStartup + 5.0;
                while (TeamForgeConnectionService.State != TeamForgeConnectionState.Disconnected &&
                       EditorApplication.timeSinceStartup < disconnectedDeadline)
                {
                    yield return null;
                }
                Assert.That(TeamForgeConnectionService.State, Is.EqualTo(TeamForgeConnectionState.Disconnected));
                Assert.That(workingScene.isDirty, Is.True, "Disconnect unexpectedly cleared the dirty Scene state.");

                // Give the real peer time to acquire after disconnect cleanup and publish 80/90/100.
                var offlineDeadline = EditorApplication.timeSinceStartup + 1.5;
                while (EditorApplication.timeSinceStartup < offlineDeadline) yield return null;

                TeamForgeConnectionService.Connect();
                yield return WaitForConnected("dirty reconnect");

                var convergenceDeadline = EditorApplication.timeSinceStartup + 10.0;
                while (EditorApplication.timeSinceStartup < convergenceDeadline)
                {
                    if (TeamForgeHierarchySyncService.SnapshotReady &&
                        ProtectedConflictCount() == 0 &&
                        VectorApproximately(target.transform.localPosition, SecondPeerPosition))
                    {
                        break;
                    }
                    yield return null;
                }

                Assert.That(
                    TeamForgeHierarchySyncService.SnapshotReady &&
                    ProtectedConflictCount() == 0 &&
                    VectorApproximately(target.transform.localPosition, SecondPeerPosition),
                    Is.True,
                    "Dirty reconnect failed to reconcile to the peer's authoritative state. " +
                    $"SnapshotReady={TeamForgeHierarchySyncService.SnapshotReady}, " +
                    $"Position={target.transform.localPosition}, " +
                    $"ProtectedConflictCount={ProtectedConflictCount()}, " +
                    $"LastError={TeamForgeConnectionService.LastError}\n" + WarningSummary(warnings));

                AssertHealthy("after dirty reconnect convergence");
            }
            finally
            {
                Application.logMessageReceived -= logHandler;
                Selection.activeObject = null;
                TeamForgeConnectionService.Disconnect();
                previousSettings.Restore(settings);
                settings.SaveSettings();
                Undo.ClearAll();

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
            settings.UserName = "CI Save Reload Unity A";
            settings.UserId = UnityUserId;
            settings.UserColorHtml = "#FFB74D";
            settings.ProjectId = "ci-save-reload-project";
            settings.SessionId = "ci-save-reload-session";
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

        private static IEnumerator WaitForHierarchyReady(string phase)
        {
            var deadline = EditorApplication.timeSinceStartup + 10.0;
            while (!TeamForgeHierarchySyncService.SnapshotReady && EditorApplication.timeSinceStartup < deadline)
            {
                yield return null;
            }
            Assert.That(TeamForgeHierarchySyncService.SnapshotReady, Is.True, $"Hierarchy snapshot not ready during {phase}.");
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
            Assert.That(peer, Is.Not.Null, "Save/reload chaos peer did not join the session.");
        }

        private static IEnumerator WaitForOwnedLock(string phase)
        {
            var requested = false;
            var requestDeadline = EditorApplication.timeSinceStartup + 5.0;
            while (!requested && EditorApplication.timeSinceStartup < requestDeadline)
            {
                if (TeamForgeTransformSyncService.TryGetSelectedLock(out var existing) &&
                    existing.ownerConnectionId == TeamForgeConnectionService.ConnectionId)
                {
                    requested = true;
                    break;
                }
                requested = TeamForgeTransformSyncService.RequestSelectedLock();
                if (!requested) yield return null;
            }
            Assert.That(requested, Is.True, $"Could not request lock during {phase}. Status={TeamForgeTransformSyncService.SelectedLockStatus}");

            var deadline = EditorApplication.timeSinceStartup + 10.0;
            while (EditorApplication.timeSinceStartup < deadline)
            {
                if (TeamForgeTransformSyncService.TryGetSelectedLock(out var candidate) &&
                    candidate.ownerConnectionId == TeamForgeConnectionService.ConnectionId)
                {
                    yield break;
                }
                yield return null;
            }
            Assert.Fail($"Did not own selected lock during {phase}. Status={TeamForgeTransformSyncService.SelectedLockStatus}");
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

        private static IEnumerator WaitForPosition(GameObject target, Vector3 expected, double seconds, string phase)
        {
            var deadline = EditorApplication.timeSinceStartup + seconds;
            while (!VectorApproximately(target.transform.localPosition, expected) && EditorApplication.timeSinceStartup < deadline)
            {
                yield return null;
            }
            Assert.That(VectorApproximately(target.transform.localPosition, expected), Is.True,
                $"Target did not reach {expected} during {phase}; actual={target.transform.localPosition}.");
        }

        private static void AssertHealthy(string phase)
        {
            Assert.That(ProtectedConflictCount(), Is.EqualTo(0),
                $"ProtectedConflictKeys became non-empty during {phase}. Status={TeamForgeTransformSyncService.SelectedLockStatus}");
            Assert.That(TeamForgeTransformSyncService.SelectedObjectBlocked, Is.False,
                $"Transform sync became blocked during {phase}. Status={TeamForgeTransformSyncService.SelectedLockStatus}");
        }

        private static int ProtectedConflictCount()
        {
            var field = typeof(TeamForgeTransformSyncService).GetField("ProtectedConflictKeys", BindingFlags.Static | BindingFlags.NonPublic);
            Assert.That(field, Is.Not.Null);
            var value = field.GetValue(null);
            Assert.That(value, Is.Not.Null);
            var count = value.GetType().GetProperty("Count", BindingFlags.Instance | BindingFlags.Public);
            Assert.That(count, Is.Not.Null);
            return (int)count.GetValue(value);
        }

        private static bool VectorApproximately(Vector3 left, Vector3 right)
        {
            return (left - right).sqrMagnitude <= 0.0001f;
        }

        private static string WarningSummary(List<string> warnings)
        {
            if (warnings == null || warnings.Count == 0) return "No TeamForge warnings captured.";
            var start = Math.Max(0, warnings.Count - 16);
            return string.Join("\n", warnings.GetRange(start, warnings.Count - start));
        }

        private static bool IsEnabled()
        {
            foreach (var argument in Environment.GetCommandLineArgs())
            {
                if (string.Equals(argument, "-teamforgeCiSaveReloadChaosE2E", StringComparison.OrdinalIgnoreCase)) return true;
            }
            return false;
        }

        private static void EnsureTemporaryFolder()
        {
            if (!AssetDatabase.IsValidFolder(TemporaryFolder)) AssetDatabase.CreateFolder("Assets", "__TeamForgeCiSaveReloadChaosE2E");
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

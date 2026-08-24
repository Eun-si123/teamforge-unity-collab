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
    public sealed class TeamForgeLockMarathonChaosE2ETests
    {
        private const string UnityUserId = "ci-lock-marathon-unity-a";
        private const string PeerUserId = "ci-lock-marathon-peer-b";
        private const string TemporaryFolder = "Assets/__TeamForgeCiLockMarathonChaosE2E";
        private static readonly Vector3 PeerPosition = new Vector3(20f, 30f, 40f);
        private static readonly Vector3 RecoveryPosition = new Vector3(150f, 160f, 170f);
        private static readonly uint[] Seeds = { 0xC0FFEEu, 0xDEADBEEFu, 0x0BADC0DEu, 0x1234ABCDu };

        [UnityTest]
        public IEnumerator ForeignLock_MixedCadenceMarathon_NeverEscapesOrSplitsClientState()
        {
            if (!IsEnabled())
            {
                Assert.Ignore("Unity lock-marathon chaos E2E is enabled only by the dedicated chaos workflow.");
            }

            TeamForgeConnectionService.Disconnect();
            TeamForgePresenceService.Registry.Clear();
            Selection.activeObject = null;
            Undo.ClearAll();

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
                var target = new GameObject("TeamForge CI Lock Marathon Target");
                var decoyA = new GameObject("TeamForge CI Lock Marathon Decoy A");
                var decoyB = new GameObject("TeamForge CI Lock Marathon Decoy B");
                SceneManager.MoveGameObjectToScene(target, workingScene);
                SceneManager.MoveGameObjectToScene(decoyA, workingScene);
                SceneManager.MoveGameObjectToScene(decoyB, workingScene);
                Assert.That(EditorSceneManager.SaveScene(workingScene, scenePath), Is.True);
                Assert.That(TeamForgeObjectIdentity.TryGetCollaborativeObjectId(target, out var targetId), Is.True);
                Assert.That(targetId, Is.Not.Empty);

                Configure(settings);
                TeamForgeConnectionService.Connect();
                yield return WaitForConnected();
                yield return WaitForHierarchyReady();
                yield return WaitForPeerPresence();

                Selection.activeGameObject = target;
                yield return WaitForOwnedLock("initial local authority");
                var initialRevision = TeamForgeTransformSyncService.CurrentRevision;
                Undo.RecordObject(target.transform, "CI lock-marathon initial Transform");
                target.transform.localPosition = new Vector3(5f, 6f, 7f);
                EditorUtility.SetDirty(target.transform);
                yield return WaitForRevisionGreaterThan(initialRevision, "initial authorized Transform");
                Assert.That(TeamForgeTransformSyncService.ReleaseSelectedLock(), Is.True);

                var takeoverDeadline = EditorApplication.timeSinceStartup + 15.0;
                while (EditorApplication.timeSinceStartup < takeoverDeadline)
                {
                    var peerOwns = TeamForgeTransformSyncService.TryGetSelectedLock(out var currentLock) &&
                                   currentLock.ownerUserId == PeerUserId;
                    if (peerOwns && VectorApproximately(target.transform.localPosition, PeerPosition)) break;
                    yield return null;
                }
                AssertForeignLockHealthy(target, "marathon start", warnings);
                var authorityRevision = TeamForgeTransformSyncService.CurrentRevision;

                // Profile 1: near-zero-yield microbursts. This is the closest synthetic equivalent to
                // repeatedly hammering a blocked SceneView gizmo before rollback/UI callbacks settle.
                for (var seedIndex = 0; seedIndex < Seeds.Length; seedIndex += 1)
                {
                    var random = new System.Random(unchecked((int)Seeds[seedIndex]));
                    for (var operation = 0; operation < 192; operation += 1)
                    {
                        MutateAllTransformChannels(target, seedIndex, operation, random);
                        if (operation % 17 == 0)
                        {
                            Selection.activeGameObject = decoyA;
                            Selection.activeGameObject = target;
                        }
                        if (operation % 31 == 0)
                        {
                            Undo.IncrementCurrentGroup();
                        }
                        if (operation % 64 == 63)
                        {
                            yield return null;
                            AssertNoSplitBrain(target, authorityRevision, $"microburst seed {Seeds[seedIndex]} op {operation}", warnings);
                        }
                    }
                    yield return WaitForPeerState(target, 0.8);
                    AssertNoSplitBrain(target, authorityRevision, $"microburst seed {Seeds[seedIndex]} completion", warnings);
                }

                // Profile 2: mixed frame cadence across many real lock-renew cycles. The peer intentionally
                // renews with deterministic jitter, so Unity sees lock-state traffic at irregular times while
                // local callbacks are also churning.
                var cadenceRandom = new System.Random(unchecked((int)0x51A11EED));
                for (var phase = 0; phase < 14; phase += 1)
                {
                    Selection.activeGameObject = target;
                    var operationCount = 48 + cadenceRandom.Next(65);
                    var undoGroup = Undo.GetCurrentGroup();
                    Undo.SetCurrentGroupName($"CI lock-marathon phase {phase}");

                    for (var operation = 0; operation < operationCount; operation += 1)
                    {
                        MutateAllTransformChannels(target, phase, operation, cadenceRandom);

                        if (operation % 7 == 0)
                        {
                            Selection.activeGameObject = (operation % 14 == 0) ? decoyA : decoyB;
                            Selection.activeGameObject = null;
                            Selection.activeGameObject = target;
                        }
                        if (operation % 11 == 5)
                        {
                            Undo.PerformUndo();
                            Undo.PerformRedo();
                        }
                        if (operation % 13 == 3)
                        {
                            EditorSceneManager.MarkSceneDirty(workingScene);
                            EditorApplication.QueuePlayerLoopUpdate();
                            EditorApplication.RepaintHierarchyWindow();
                            SceneView.RepaintAll();
                        }
                        if (operation % 29 == 9)
                        {
                            GC.Collect();
                        }
                        if (operation % 23 == 22)
                        {
                            yield return null;
                            AssertNoSplitBrain(target, authorityRevision, $"cadence phase {phase} op {operation}", warnings);
                        }
                    }

                    Undo.CollapseUndoOperations(undoGroup);
                    yield return WaitForPeerState(target, 0.35);
                    AssertNoSplitBrain(target, authorityRevision, $"cadence phase {phase} settle", warnings);

                    // Intentionally vary quiet gaps from ~0.35 to ~0.95 sec. Together with the peer's
                    // 0.45-1.75 sec renewal jitter this sweeps many callback orderings around renew ACKs.
                    var quietUntil = EditorApplication.timeSinceStartup + 0.35 + cadenceRandom.NextDouble() * 0.60;
                    while (EditorApplication.timeSinceStartup < quietUntil)
                    {
                        if (cadenceRandom.Next(5) == 0)
                        {
                            Selection.activeGameObject = target;
                            EditorApplication.QueuePlayerLoopUpdate();
                        }
                        yield return null;
                    }
                    AssertNoSplitBrain(target, authorityRevision, $"cadence phase {phase} post-gap", warnings);
                }

                Assert.That(
                    warnings.Exists(message => message.Contains("Protected unresolved local Transform conflict", StringComparison.Ordinal)),
                    Is.False,
                    "Marathon emitted the field #68 protected-conflict symptom.\n" + WarningSummary(warnings));

                // The peer holds authority for ~26 seconds. Wait for its deliberate release, then prove
                // the client can acquire cleanly and publish again after thousands of hostile callbacks.
                var releaseDeadline = EditorApplication.timeSinceStartup + 30.0;
                while (TeamForgeTransformSyncService.TryGetSelectedLock(out var held) &&
                       held.ownerUserId == PeerUserId &&
                       EditorApplication.timeSinceStartup < releaseDeadline)
                {
                    yield return null;
                }
                Assert.That(
                    TeamForgeTransformSyncService.TryGetSelectedLock(out var afterRelease) && afterRelease.ownerUserId == PeerUserId,
                    Is.False,
                    "Long-hold peer never released the target.");

                Selection.activeGameObject = target;
                yield return WaitForOwnedLock("post-marathon recovery authority");
                Assert.That(ProtectedConflictCount(), Is.EqualTo(0));
                Assert.That(TeamForgeTransformSyncService.SelectedObjectBlocked, Is.False);

                var recoveryRevision = TeamForgeTransformSyncService.CurrentRevision;
                Undo.RecordObject(target.transform, "CI lock-marathon recovery Transform");
                target.transform.localPosition = RecoveryPosition;
                target.transform.localRotation = Quaternion.Euler(10f, 20f, 30f);
                target.transform.localScale = new Vector3(1.5f, 1.25f, 0.75f);
                EditorUtility.SetDirty(target.transform);
                yield return WaitForRevisionGreaterThan(recoveryRevision, "post-marathon recovery Transform");
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

        private static void MutateAllTransformChannels(GameObject target, int phase, int operation, System.Random random)
        {
            Undo.RecordObject(target.transform, $"CI lock-marathon hostile edit {phase}-{operation}");
            target.transform.localPosition = new Vector3(
                1000f + phase * 100f + operation,
                2000f + random.Next(-750, 751),
                3000f + random.Next(-750, 751));
            target.transform.localRotation = Quaternion.Euler(
                random.Next(-180, 181), random.Next(-180, 181), random.Next(-180, 181));
            target.transform.localScale = new Vector3(
                0.25f + (float)random.NextDouble() * 3f,
                0.25f + (float)random.NextDouble() * 3f,
                0.25f + (float)random.NextDouble() * 3f);
            EditorUtility.SetDirty(target.transform);
        }

        private static IEnumerator WaitForPeerState(GameObject target, double seconds)
        {
            var deadline = EditorApplication.timeSinceStartup + seconds;
            while (!VectorApproximately(target.transform.localPosition, PeerPosition) &&
                   EditorApplication.timeSinceStartup < deadline)
            {
                yield return null;
            }
        }

        private static void AssertForeignLockHealthy(GameObject target, string phase, List<string> warnings)
        {
            Assert.That(
                TeamForgeTransformSyncService.TryGetSelectedLock(out var currentLock) && currentLock.ownerUserId == PeerUserId,
                Is.True,
                $"Foreign lock authority was lost during {phase}. Status={TeamForgeTransformSyncService.SelectedLockStatus}\n" +
                WarningSummary(warnings));
            Assert.That(VectorApproximately(target.transform.localPosition, PeerPosition), Is.True,
                $"Target was not at peer authority during {phase}: {target.transform.localPosition}");
            Assert.That(ProtectedConflictCount(), Is.EqualTo(0),
                $"Protected conflict appeared during {phase}.\n" + WarningSummary(warnings));
            Assert.That(TeamForgeTransformSyncService.SelectedObjectBlocked, Is.False,
                $"Transform sync became blocked during {phase}.\n" + WarningSummary(warnings));
        }

        private static void AssertNoSplitBrain(GameObject target, long authorityRevision, string phase, List<string> warnings)
        {
            AssertForeignLockHealthy(target, phase, warnings);
            Assert.That(
                TeamForgeTransformSyncService.CurrentRevision,
                Is.EqualTo(authorityRevision),
                $"Unauthorized local chaos advanced authority revision during {phase}: " +
                $"expected={authorityRevision}, actual={TeamForgeTransformSyncService.CurrentRevision}.");
        }

        private static void Configure(TeamForgeConnectionSettings settings)
        {
            settings.ServerAddress = "http://127.0.0.1:5080";
            settings.RealtimePath = "ws";
            settings.UserName = "CI Lock Marathon Unity A";
            settings.UserId = UnityUserId;
            settings.UserColorHtml = "#FFB74D";
            settings.ProjectId = "ci-lock-marathon-project";
            settings.SessionId = "ci-lock-marathon-session";
            settings.AuthenticationToken = string.Empty;
            settings.ConnectionTimeoutSeconds = 10;
            settings.AutoReconnect = false;
            settings.TransformUpdatesPerSecond = 60;
            settings.LockRenewalSeconds = 1;
            settings.LogLevel = TeamForgeLogLevel.Info;
            settings.ResumeAfterAssemblyReload = false;
            settings.SaveSettings();
        }

        private static IEnumerator WaitForConnected()
        {
            var deadline = EditorApplication.timeSinceStartup + 20.0;
            while (TeamForgeConnectionService.State != TeamForgeConnectionState.Connected &&
                   EditorApplication.timeSinceStartup < deadline)
            {
                yield return null;
            }
            Assert.That(TeamForgeConnectionService.State, Is.EqualTo(TeamForgeConnectionState.Connected),
                $"Unity did not connect to TeamForge. LastError={TeamForgeConnectionService.LastError}");
        }

        private static IEnumerator WaitForHierarchyReady()
        {
            var deadline = EditorApplication.timeSinceStartup + 10.0;
            while (!TeamForgeHierarchySyncService.SnapshotReady && EditorApplication.timeSinceStartup < deadline)
            {
                yield return null;
            }
            Assert.That(TeamForgeHierarchySyncService.SnapshotReady, Is.True);
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
            Assert.That(peer, Is.Not.Null, "Lock-marathon peer did not join the session.");
        }

        private static IEnumerator WaitForOwnedLock(string phase)
        {
            var deadline = EditorApplication.timeSinceStartup + 10.0;
            while (EditorApplication.timeSinceStartup < deadline)
            {
                if (TeamForgeTransformSyncService.TryGetSelectedLock(out var currentLock) &&
                    currentLock.ownerConnectionId == TeamForgeConnectionService.ConnectionId)
                {
                    yield break;
                }
                TeamForgeTransformSyncService.RequestSelectedLock();
                yield return null;
            }
            Assert.Fail($"Unity did not acquire lock during {phase}. Status={TeamForgeTransformSyncService.SelectedLockStatus}");
        }

        private static IEnumerator WaitForRevisionGreaterThan(long revision, string phase)
        {
            var deadline = EditorApplication.timeSinceStartup + 10.0;
            while (TeamForgeTransformSyncService.CurrentRevision <= revision && EditorApplication.timeSinceStartup < deadline)
            {
                yield return null;
            }
            Assert.That(TeamForgeTransformSyncService.CurrentRevision, Is.GreaterThan(revision),
                $"Authority revision did not advance during {phase}.");
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
            var start = Math.Max(0, warnings.Count - 24);
            return string.Join("\n", warnings.GetRange(start, warnings.Count - start));
        }

        private static bool IsEnabled()
        {
            foreach (var argument in Environment.GetCommandLineArgs())
            {
                if (string.Equals(argument, "-teamforgeCiLockMarathonChaosE2E", StringComparison.OrdinalIgnoreCase)) return true;
            }
            return false;
        }

        private static void EnsureTemporaryFolder()
        {
            if (!AssetDatabase.IsValidFolder(TemporaryFolder)) AssetDatabase.CreateFolder("Assets", "__TeamForgeCiLockMarathonChaosE2E");
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

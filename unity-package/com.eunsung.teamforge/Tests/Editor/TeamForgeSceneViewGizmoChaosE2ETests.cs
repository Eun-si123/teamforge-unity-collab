using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using NUnit.Framework;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.TestTools;

namespace EunSung.TeamForge.Tests
{
    /// <summary>
    /// Replays the field-reported foreign-lock SceneView path through Unity's built-in Move tool:
    /// Hierarchy-style selection, rapid X/Y handle switching, IMGUI hotControl churn, and real Transform writes.
    /// The server remains authoritative throughout; this fixture only changes test/diagnostic code.
    /// </summary>
    public sealed class TeamForgeSceneViewGizmoChaosE2ETests
    {
        private const string PeerUserId = "ci-contention-peer-b";
        private const string UnityUserId = "ci-contention-unity-a";
        private const string TemporaryFolder = "Assets/__TeamForgeCiSceneViewGizmoChaosE2E";
        private const string TraceFolder = "test-results/sceneview-gizmo-e2e";
        private static readonly Vector3 PeerAuthoritativePosition = new Vector3(20f, 30f, 40f);

        [UnityTest]
        public IEnumerator ForeignLock_HierarchySelection_RapidSceneViewAxisSwitching_NeverEscapesLocally()
        {
            if (!IsSceneViewGizmoChaosEnabled())
            {
                Assert.Ignore("SceneView gizmo chaos E2E is enabled only by its dedicated GitHub Actions lane.");
            }

            TeamForgeConnectionService.Disconnect();
            TeamForgePresenceService.Registry.Clear();
            Selection.activeObject = null;

            var settings = TeamForgeConnectionService.Settings;
            var previousSettings = new SettingsSnapshot(settings);
            var previousTool = Tools.current;
            var previousPivotMode = Tools.pivotMode;
            var previousPivotRotation = Tools.pivotRotation;
            Scene workingScene = default;
            GameObject target = null;
            GameObject decoy = null;
            SceneView sceneView = null;
            SceneViewHandleProbe probe = null;
            var scenePath = string.Empty;
            var tracePath = PrepareTracePath();
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
                target = new GameObject("TeamForge CI SceneView Locked Target");
                decoy = new GameObject("TeamForge CI SceneView Decoy");
                SceneManager.MoveGameObjectToScene(target, workingScene);
                SceneManager.MoveGameObjectToScene(decoy, workingScene);
                Assert.That(EditorSceneManager.SaveScene(workingScene, scenePath), Is.True);
                Assert.That(workingScene.isDirty, Is.False);
                Assert.That(
                    TeamForgeObjectIdentity.TryGetCollaborativeObjectId(target, out var targetId),
                    Is.True,
                    "The saved SceneView chaos target did not receive a collaborative identity.");
                Assert.That(targetId, Is.Not.Empty);

                settings.ServerAddress = "http://127.0.0.1:5080";
                settings.RealtimePath = "ws";
                settings.UserName = "CI SceneView Contender B";
                settings.UserId = UnityUserId;
                settings.UserColorHtml = "#FFB74D";
                settings.ProjectId = "ci-contention-project";
                settings.SessionId = "ci-contention-session";
                settings.AuthenticationToken = string.Empty;
                settings.ConnectionTimeoutSeconds = 10;
                settings.AutoReconnect = false;
                settings.TransformUpdatesPerSecond = 60;
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
                Assert.That(peer, Is.Not.Null, "The foreign-lock peer did not join the real session.");

                // Bootstrap one authoritative Transform, release, then wait for the second peer to own it.
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
                    "Unity did not acquire the initial target lock required to bootstrap the contention peer.");

                var bootstrapRevision = TeamForgeTransformSyncService.CurrentRevision;
                Undo.RecordObject(target.transform, "CI SceneView bootstrap Transform");
                target.transform.localPosition = new Vector3(5f, 6f, 7f);
                EditorUtility.SetDirty(target.transform);
                deadline = EditorApplication.timeSinceStartup + 10.0;
                while (TeamForgeTransformSyncService.CurrentRevision <= bootstrapRevision &&
                       EditorApplication.timeSinceStartup < deadline)
                {
                    yield return null;
                }
                Assert.That(TeamForgeTransformSyncService.CurrentRevision, Is.GreaterThan(bootstrapRevision));
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
                AssertForeignLockAndHealthy(target, "foreign-owner handoff");

                // Match the physical report: B clicks A's locked object in the Hierarchy, then leaves it selected.
                Selection.activeGameObject = decoy;
                yield return null;
                Selection.activeGameObject = target;
                yield return null;
                Assert.That(Selection.activeGameObject, Is.SameAs(target));
                AssertForeignLockAndHealthy(target, "post-hierarchy-selection");

                sceneView = EditorWindow.GetWindow<SceneView>();
                Assert.That(sceneView, Is.Not.Null, "Unity did not provide a SceneView window in the test runner.");
                sceneView.wantsMouseMove = true;
                sceneView.Show();
                sceneView.Focus();
                sceneView.LookAt(target.transform.position, Quaternion.identity, 8f, true, true);
                Tools.current = Tool.Move;
                Tools.pivotMode = PivotMode.Pivot;
                Tools.pivotRotation = PivotRotation.Global;

                probe = new SceneViewHandleProbe(sceneView, target, tracePath);
                SceneView.duringSceneGui += probe.OnSceneGui;
                sceneView.Repaint();

                deadline = EditorApplication.timeSinceStartup + 5.0;
                while (!probe.HasUsableCoordinates && EditorApplication.timeSinceStartup < deadline)
                {
                    sceneView.Repaint();
                    yield return null;
                }
                Assert.That(
                    probe.HasUsableCoordinates,
                    Is.True,
                    "SceneView never produced usable Move-tool coordinates; the gizmo chaos lane did not exercise its intended path.");

                var authorityRevision = TeamForgeTransformSyncService.CurrentRevision;
                WriteTrace(tracePath, "phase", "begin-axis-thrash", target, probe);

                // Pattern A: clean but very fast alternating X/Y grabs.
                for (var burst = 0; burst < 12; burst += 1)
                {
                    for (var cycle = 0; cycle < 20; cycle += 1)
                    {
                        var useX = (cycle & 1) == 0;
                        var origin = useX ? probe.XAxisPoint : probe.YAxisPoint;
                        var along = useX
                            ? new Vector2(26f + (cycle % 5) * 3f, 0f)
                            : new Vector2(0f, -26f - (cycle % 5) * 3f);
                        SendMouse(sceneView, EventType.MouseMove, origin, Vector2.zero, 0);
                        SendMouse(sceneView, EventType.MouseDown, origin, Vector2.zero, 0);
                        SendMouse(sceneView, EventType.MouseDrag, origin + along, along, 0);
                        SendMouse(sceneView, EventType.MouseUp, origin + along, Vector2.zero, 0);
                    }

                    sceneView.Repaint();
                    yield return null;
                    AssertSelectionStillTargets(target, $"clean-axis burst {burst}");
                    AssertStillForeignOwned(target, $"clean-axis burst {burst}");
                    FailIfConflictOrPersistentEscape(target, probe, tracePath, $"clean-axis burst {burst}");
                }

                // Pattern B: hotControl handoff pressure while crossing from one axis to another.
                for (var burst = 0; burst < 10; burst += 1)
                {
                    for (var cycle = 0; cycle < 16; cycle += 1)
                    {
                        var first = (cycle & 1) == 0 ? probe.XAxisPoint : probe.YAxisPoint;
                        var second = (cycle & 1) == 0 ? probe.YAxisPoint : probe.XAxisPoint;
                        SendMouse(sceneView, EventType.MouseMove, first, Vector2.zero, 0);
                        SendMouse(sceneView, EventType.MouseDown, first, Vector2.zero, 0);
                        SendMouse(sceneView, EventType.MouseDrag, Vector2.Lerp(first, second, 0.35f), second - first, 0);
                        SendMouse(sceneView, EventType.MouseMove, second, Vector2.zero, 0);
                        SendMouse(sceneView, EventType.MouseDown, second, Vector2.zero, 0);
                        SendMouse(
                            sceneView,
                            EventType.MouseDrag,
                            second + new Vector2((cycle % 3) * 9f, -(cycle % 4) * 7f),
                            second - first,
                            0);
                        SendMouse(sceneView, EventType.MouseUp, second, Vector2.zero, 0);
                    }

                    sceneView.Repaint();
                    yield return null;
                    AssertSelectionStillTargets(target, $"hot-control burst {burst}");
                    AssertStillForeignOwned(target, $"hot-control burst {burst}");
                    FailIfConflictOrPersistentEscape(target, probe, tracePath, $"hot-control burst {burst}");
                }

                Assert.That(
                    probe.SceneGuiEventCount,
                    Is.GreaterThan(100),
                    $"Too few SceneView GUI events were observed ({probe.SceneGuiEventCount}). See {tracePath}.");
                Assert.That(
                    probe.NonZeroHotControlSamples,
                    Is.GreaterThan(0),
                    "GUIUtility.hotControl never became non-zero; the test did not grab a real SceneView control.");

                deadline = EditorApplication.timeSinceStartup + 1.5;
                while (!VectorApproximately(target.transform.localPosition, PeerAuthoritativePosition) &&
                       EditorApplication.timeSinceStartup < deadline)
                {
                    yield return null;
                }

                AssertForeignLockAndHealthy(target, "final SceneView convergence");
                Assert.That(
                    TeamForgeTransformSyncService.CurrentRevision,
                    Is.EqualTo(authorityRevision),
                    "Unauthorized SceneView gizmo edits advanced the server Transform revision while the peer owned the lock.");
                Assert.That(
                    teamForgeWarnings.Exists(message =>
                        message.Contains("Protected unresolved local Transform conflict", StringComparison.Ordinal)),
                    Is.False,
                    "SceneView chaos emitted the field-reported protected-conflict warning:\n" + WarningSummary(teamForgeWarnings));

                WriteTrace(tracePath, "phase", "pass", target, probe);
                Debug.Log(
                    $"[TeamForge CI] SceneView gizmo chaos PASS: events={probe.SceneGuiEventCount}, " +
                    $"observedTransformChanges={probe.ObservedTransformChangeCount}, " +
                    $"hotControlSamples={probe.NonZeroHotControlSamples}, " +
                    $"maxEscapeSqr={probe.MaximumLocalEscapeSqr:F6}, trace={tracePath}");
            }
            finally
            {
                if (probe != null)
                {
                    SceneView.duringSceneGui -= probe.OnSceneGui;
                }
                Application.logMessageReceived -= logHandler;
                Tools.current = previousTool;
                Tools.pivotMode = previousPivotMode;
                Tools.pivotRotation = previousPivotRotation;
                Selection.activeObject = null;
                TeamForgeConnectionService.Disconnect();
                previousSettings.Restore(settings);
                settings.SaveSettings();

                if (sceneView != null)
                {
                    sceneView.Close();
                }
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

        private static void SendMouse(SceneView sceneView, EventType type, Vector2 position, Vector2 delta, int button)
        {
            var evt = new Event
            {
                type = type,
                mousePosition = position,
                delta = delta,
                button = button,
            };

            // SendEvent's bool is not a delivery oracle for arbitrary IMGUI mouse events. Coverage is
            // established by SceneView event counts and hotControl observations instead.
            sceneView.SendEvent(evt);
        }

        private static void AssertSelectionStillTargets(GameObject target, string phase)
        {
            Assert.That(
                Selection.activeGameObject,
                Is.SameAs(target),
                $"SceneView input changed Selection during {phase}; this run no longer matches the field reproduction.");
        }

        private static void AssertStillForeignOwned(GameObject target, string phase)
        {
            Assert.That(
                TeamForgeTransformSyncService.TryGetSelectedLock(out var lockState) &&
                lockState.ownerUserId == PeerUserId,
                Is.True,
                $"Foreign authority was lost during {phase}. Status={TeamForgeTransformSyncService.SelectedLockStatus}, " +
                $"local={target.transform.localPosition}");
        }

        private static void FailIfConflictOrPersistentEscape(
            GameObject target,
            SceneViewHandleProbe probe,
            string tracePath,
            string phase)
        {
            var conflictCount = ProtectedConflictCount();
            var escaped = !VectorApproximately(target.transform.localPosition, PeerAuthoritativePosition);
            if (conflictCount > 0 || TeamForgeTransformSyncService.SelectedObjectBlocked || escaped)
            {
                WriteTrace(tracePath, "failure", phase, target, probe);
                Assert.Fail(
                    $"SceneView gizmo chaos reproduced an unhealthy foreign-lock state during {phase}. " +
                    $"local={target.transform.localPosition}, expected={PeerAuthoritativePosition}, " +
                    $"protectedConflicts={conflictCount}, blocked={TeamForgeTransformSyncService.SelectedObjectBlocked}, " +
                    $"lockStatus={TeamForgeTransformSyncService.SelectedLockStatus}, hotControl={GUIUtility.hotControl}, " +
                    $"observedTransformChanges={probe.ObservedTransformChangeCount}, " +
                    $"maxEscapeSqr={probe.MaximumLocalEscapeSqr:F6}. Trace={tracePath}");
            }
        }

        private static void AssertForeignLockAndHealthy(GameObject target, string phase)
        {
            Assert.That(
                TeamForgeTransformSyncService.TryGetSelectedLock(out var lockState) &&
                lockState.ownerUserId == PeerUserId,
                Is.True,
                $"Foreign lock authority was not present during {phase}. Status={TeamForgeTransformSyncService.SelectedLockStatus}");
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

        private static bool IsSceneViewGizmoChaosEnabled()
        {
            foreach (var argument in Environment.GetCommandLineArgs())
            {
                if (string.Equals(argument, "-teamforgeCiSceneViewGizmoChaosE2E", StringComparison.OrdinalIgnoreCase))
                {
                    return true;
                }
            }
            return false;
        }

        private static string PrepareTracePath()
        {
            var repositoryRoot = Path.GetFullPath(Path.Combine(Application.dataPath, "..", ".."));
            var folder = Path.Combine(repositoryRoot, TraceFolder.Replace('/', Path.DirectorySeparatorChar));
            Directory.CreateDirectory(folder);
            var tracePath = Path.Combine(folder, "unity-sceneview-trace.jsonl");
            File.WriteAllText(tracePath, string.Empty);
            return tracePath;
        }

        private static void WriteTrace(
            string tracePath,
            string kind,
            string phase,
            GameObject target,
            SceneViewHandleProbe probe)
        {
            try
            {
                var sample = new TraceRecord
                {
                    utc = DateTime.UtcNow.ToString("O"),
                    kind = kind,
                    phase = phase,
                    eventType = probe?.LastEventType ?? string.Empty,
                    rawEventType = probe?.LastRawEventType ?? string.Empty,
                    hotControl = GUIUtility.hotControl,
                    nearestControl = HandleUtility.nearestControl,
                    selectedObject = Selection.activeGameObject != null ? Selection.activeGameObject.name : string.Empty,
                    lockStatus = TeamForgeTransformSyncService.SelectedLockStatus,
                    protectedConflictCount = ProtectedConflictCount(),
                    blocked = TeamForgeTransformSyncService.SelectedObjectBlocked,
                    localPosition = target != null ? target.transform.localPosition : Vector3.zero,
                    sceneGuiEventCount = probe?.SceneGuiEventCount ?? 0,
                    observedTransformChangeCount = probe?.ObservedTransformChangeCount ?? 0,
                    nonZeroHotControlSamples = probe?.NonZeroHotControlSamples ?? 0,
                    maximumLocalEscapeSqr = probe?.MaximumLocalEscapeSqr ?? 0f,
                };
                File.AppendAllText(tracePath, JsonUtility.ToJson(sample) + Environment.NewLine);
            }
            catch (Exception ex)
            {
                Debug.LogWarning($"[TeamForge CI] Failed to write SceneView chaos trace: {ex.Message}");
            }
        }

        private static void EnsureTemporaryFolder()
        {
            if (!AssetDatabase.IsValidFolder(TemporaryFolder))
            {
                AssetDatabase.CreateFolder("Assets", "__TeamForgeCiSceneViewGizmoChaosE2E");
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

        private sealed class SceneViewHandleProbe
        {
            private readonly SceneView _sceneView;
            private readonly GameObject _target;
            private readonly string _tracePath;
            private Vector3 _lastSampledLocalPosition;

            public SceneViewHandleProbe(SceneView sceneView, GameObject target, string tracePath)
            {
                _sceneView = sceneView;
                _target = target;
                _tracePath = tracePath;
                _lastSampledLocalPosition = target.transform.localPosition;
            }

            public Vector2 CenterPoint { get; private set; }
            public Vector2 XAxisPoint { get; private set; }
            public Vector2 YAxisPoint { get; private set; }
            public bool HasUsableCoordinates { get; private set; }
            public int SceneGuiEventCount { get; private set; }
            public int ObservedTransformChangeCount { get; private set; }
            public int NonZeroHotControlSamples { get; private set; }
            public float MaximumLocalEscapeSqr { get; private set; }
            public string LastEventType { get; private set; } = string.Empty;
            public string LastRawEventType { get; private set; } = string.Empty;

            public void OnSceneGui(SceneView sceneView)
            {
                if (sceneView != _sceneView || _target == null) return;
                var evt = Event.current;
                if (evt == null) return;

                SceneGuiEventCount += 1;
                LastEventType = evt.type.ToString();
                LastRawEventType = evt.rawType.ToString();

                var worldPosition = _target.transform.position;
                var handleSize = HandleUtility.GetHandleSize(worldPosition);
                CenterPoint = HandleUtility.WorldToGUIPoint(worldPosition);
                XAxisPoint = HandleUtility.WorldToGUIPoint(worldPosition + Vector3.right * handleSize * 0.78f);
                YAxisPoint = HandleUtility.WorldToGUIPoint(worldPosition + Vector3.up * handleSize * 0.78f);
                HasUsableCoordinates =
                    IsFinite(CenterPoint) && IsFinite(XAxisPoint) && IsFinite(YAxisPoint) &&
                    (XAxisPoint - CenterPoint).sqrMagnitude > 16f &&
                    (YAxisPoint - CenterPoint).sqrMagnitude > 16f;

                if (GUIUtility.hotControl != 0)
                {
                    NonZeroHotControlSamples += 1;
                }

                var currentLocalPosition = _target.transform.localPosition;
                if ((currentLocalPosition - _lastSampledLocalPosition).sqrMagnitude > 0.000001f)
                {
                    ObservedTransformChangeCount += 1;
                }
                _lastSampledLocalPosition = currentLocalPosition;

                var escapeSqr = (currentLocalPosition - PeerAuthoritativePosition).sqrMagnitude;
                MaximumLocalEscapeSqr = Mathf.Max(MaximumLocalEscapeSqr, escapeSqr);

                if (evt.type == EventType.MouseDown ||
                    evt.type == EventType.MouseDrag ||
                    evt.type == EventType.MouseUp ||
                    GUIUtility.hotControl != 0 ||
                    escapeSqr > 0.0001f)
                {
                    WriteTrace(_tracePath, "scene-gui", $"{evt.type}:{evt.rawType}", _target, this);
                }
            }

            private static bool IsFinite(Vector2 value)
            {
                return !float.IsNaN(value.x) && !float.IsInfinity(value.x) &&
                       !float.IsNaN(value.y) && !float.IsInfinity(value.y);
            }
        }

        [Serializable]
        private sealed class TraceRecord
        {
            public string utc;
            public string kind;
            public string phase;
            public string eventType;
            public string rawEventType;
            public int hotControl;
            public int nearestControl;
            public string selectedObject;
            public string lockStatus;
            public int protectedConflictCount;
            public bool blocked;
            public Vector3 localPosition;
            public int sceneGuiEventCount;
            public int observedTransformChangeCount;
            public int nonZeroHotControlSamples;
            public float maximumLocalEscapeSqr;
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

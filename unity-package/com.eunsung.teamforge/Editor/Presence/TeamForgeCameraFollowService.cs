using System;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace EunSung.TeamForge
{
    // A purely local, opt-in camera-view convenience. Does not take locks,
    // modify Scenes or send operations to the authoritative Server.
    public static class TeamForgeCameraFollowPolicy
    {
        public static bool TryValidateTarget(
            PresenceRecord member,
            string expectedUserId,
            string expectedConnectionId,
            string localSceneGuid,
            out string error)
        {
            if (string.IsNullOrWhiteSpace(localSceneGuid))
            {
                error = "Save and open the same Scene as your teammate before following.";
                return false;
            }
            if (!TeamForgePresenceValidation.TryValidate(member, out _))
            {
                error = "The teammate has no valid Presence state.";
                return false;
            }
            if (string.IsNullOrEmpty(expectedUserId) ||
                !string.Equals(member.userId, expectedUserId, StringComparison.Ordinal) ||
                string.IsNullOrEmpty(expectedConnectionId) ||
                !string.Equals(member.connectionId, expectedConnectionId, StringComparison.Ordinal))
            {
                error = "The teammate has changed connection. Choose Follow again.";
                return false;
            }
            if (string.IsNullOrEmpty(member.sceneId) ||
                !string.Equals(member.sceneId, localSceneGuid, StringComparison.Ordinal))
            {
                error = "Camera follow requires the same saved Scene identity; it will not switch Scenes.";
                return false;
            }
            if (!member.hasSceneView)
            {
                error = "The teammate is not sharing a Scene View camera right now.";
                return false;
            }
            var rotation = member.cameraRotation;
            var lengthSquared = (double)rotation.x * rotation.x +
                                (double)rotation.y * rotation.y +
                                (double)rotation.z * rotation.z +
                                (double)rotation.w * rotation.w;
            if (lengthSquared < 0.25 || lengthSquared > 4)
            {
                error = "The teammate's Scene View rotation is not a usable quaternion.";
                return false;
            }
            error = string.Empty;
            return true;
        }

        // We cannot know the sender's 2..60-second Presence heartbeat from
        // the received record. Using the *local* Editor setting can falsely
        // retire a healthy 60-second sender after just 12..15 seconds.
        // Allow bounded jitter around the maximum supported remote period,
        // while still retiring an unreachable/stale teammate after 150s.
        public static bool IsFresh(double now, double lastObserved)
        {
            if (double.IsNaN(now) || double.IsInfinity(now) ||
                double.IsNaN(lastObserved) || double.IsInfinity(lastObserved) ||
                now < lastObserved)
            {
                return false;
            }
            const double MaximumPresenceSilenceSeconds = 150;
            return now - lastObserved <= MaximumPresenceSilenceSeconds;
        }
    }

    [InitializeOnLoad]
    public static class TeamForgeCameraFollowService
    {
        private const double ApplyIntervalSeconds = 0.2;
        private const float OverlayTop = 58f;
        private static readonly Rect OverlayArea = new Rect(12, OverlayTop, 360, 50);

        private static string _userId = string.Empty;
        private static string _remoteConnectionId = string.Empty;
        private static string _localConnectionId = string.Empty;
        private static string _sceneGuid = string.Empty;
        private static string _displayName = string.Empty;
        private static SceneView _targetView;
        private static double _nextApplyAt;
        private static double _lastObservedAt;
        private static long _lastHeartbeat;
        private static long _lastAppliedHeartbeat;
        private static string _message = "Select Follow Camera beside a teammate to start.";

        static TeamForgeCameraFollowService()
        {
            EditorApplication.update += Update;
            SceneView.duringSceneGui += DuringSceneGui;
            TeamForgeConnectionService.Changed += CheckConnection;
            TeamForgePresenceService.Registry.Changed += OnPresenceChanged;
            EditorSceneManager.activeSceneChangedInEditMode += (_, __) => Stop("Scene changed; camera follow stopped.");
            EditorApplication.playModeStateChanged += _ => Stop("Editor mode changed; camera follow stopped.");
            AssemblyReloadEvents.beforeAssemblyReload += () => Stop("Camera follow ended for assembly reload.");
            EditorApplication.quitting += () => Stop("Editor closing; camera follow stopped.");
        }

        public static event Action Changed;
        public static long Version { get; private set; }
        public static bool IsFollowing => !string.IsNullOrEmpty(_userId);
        public static string FollowingUserId => _userId;
        public static string Status => IsFollowing
            ? $"Following {_displayName} · Esc / Scene View input / Stop to exit"
            : _message;

        public static bool IsFollowingUser(string userId) =>
            IsFollowing && string.Equals(_userId, userId, StringComparison.Ordinal);

        public static bool CanFollow(PresenceRecord member)
        {
            return TeamForgeConnectionService.State == TeamForgeConnectionState.Connected &&
                   TeamForgeConnectionService.PresenceAvailable &&
                   !EditorApplication.isPlayingOrWillChangePlaymode &&
                   member != null &&
                   member.userId != TeamForgePresenceService.LocalUserId &&
                   TeamForgeCameraFollowPolicy.TryValidateTarget(
                       member, member.userId, member.connectionId, CurrentSceneGuid(), out _);
        }

        public static bool TryStart(string userId, out string error)
        {
            if (TeamForgeConnectionService.State != TeamForgeConnectionState.Connected ||
                !TeamForgeConnectionService.PresenceAvailable ||
                EditorApplication.isPlayingOrWillChangePlaymode ||
                string.IsNullOrWhiteSpace(userId) ||
                userId == TeamForgePresenceService.LocalUserId ||
                !TeamForgePresenceService.Registry.TryGet(userId, out var member))
            {
                error = "Connect to a Presence-capable session with an active teammate first.";
                return false;
            }

            var sceneGuid = CurrentSceneGuid();
            if (!TeamForgeCameraFollowPolicy.TryValidateTarget(
                    member, userId, member.connectionId, sceneGuid, out error))
            {
                return false;
            }

            var view = SceneView.lastActiveSceneView ?? EditorWindow.GetWindow<SceneView>();
            if (view == null)
            {
                error = "Open a Scene View to follow your teammate.";
                return false;
            }

            var localConnectionId = TeamForgeConnectionService.ConnectionId;
            if (string.IsNullOrEmpty(localConnectionId))
            {
                error = "Wait until the local connection is ready.";
                return false;
            }

            // A deliberate switch to a different teammate retires the old
            // SceneView overlay before binding the new viewport owner.
            if (IsFollowing) Stop("Switched to a different teammate.");

            _userId = member.userId;
            _remoteConnectionId = member.connectionId;
            _localConnectionId = localConnectionId;
            _sceneGuid = sceneGuid;
            _displayName = member.displayName;
            _targetView = view;
            _lastHeartbeat = member.lastHeartbeatUnixMs;
            _lastAppliedHeartbeat = member.lastHeartbeatUnixMs;
            _lastObservedAt = EditorApplication.timeSinceStartup;
            _nextApplyAt = 0;
            _message = string.Empty;
            Version++;
            Changed?.Invoke();
            Apply(member);
            view.ShowNotification(new GUIContent("Following teammate camera · Esc or use Scene View to stop"));
            error = string.Empty;
            return true;
        }

        public static void Stop()
        {
            Stop("Camera follow stopped.");
        }

        private static void Stop(string reason)
        {
            if (!IsFollowing) return;

            var previousView = _targetView;
            _userId = string.Empty;
            _remoteConnectionId = string.Empty;
            _localConnectionId = string.Empty;
            _sceneGuid = string.Empty;
            _displayName = string.Empty;
            _targetView = null;
            _lastHeartbeat = 0;
            _lastAppliedHeartbeat = 0;
            _nextApplyAt = 0;
            _lastObservedAt = 0;
            _message = reason;
            Version++;
            Changed?.Invoke();
            if (previousView != null) previousView.Repaint();
        }

        private static void CheckConnection()
        {
            if (!IsFollowing) return;
            if (TeamForgeConnectionService.State != TeamForgeConnectionState.Connected ||
                !TeamForgeConnectionService.PresenceAvailable ||
                TeamForgeConnectionService.ConnectionId != _localConnectionId)
            {
                Stop("Connection changed; camera follow stopped.");
            }
        }

        private static void OnPresenceChanged()
        {
            if (!IsFollowing) return;
            if (!TeamForgePresenceService.Registry.TryGet(_userId, out var member) ||
                !TeamForgeCameraFollowPolicy.TryValidateTarget(
                    member, _userId, _remoteConnectionId, _sceneGuid, out _))
            {
                Stop("Teammate unavailable or changed Scene; camera follow stopped.");
                return;
            }
            if (member.lastHeartbeatUnixMs > _lastHeartbeat)
            {
                _lastHeartbeat = member.lastHeartbeatUnixMs;
                _lastObservedAt = EditorApplication.timeSinceStartup;
            }
        }

        private static void Update()
        {
            if (!IsFollowing) return;
            CheckConnection();
            if (!IsFollowing) return;

            if (_targetView == null || EditorApplication.isPlayingOrWillChangePlaymode ||
                !string.Equals(CurrentSceneGuid(), _sceneGuid, StringComparison.Ordinal))
            {
                Stop("Local Scene or Editor mode changed; camera follow stopped.");
                return;
            }

            if (!TeamForgePresenceService.Registry.TryGet(_userId, out var member) ||
                !TeamForgeCameraFollowPolicy.TryValidateTarget(
                    member, _userId, _remoteConnectionId, _sceneGuid, out _))
            {
                Stop("Teammate camera unavailable; camera follow stopped.");
                return;
            }

            var now = EditorApplication.timeSinceStartup;
            if (!TeamForgeCameraFollowPolicy.IsFresh(
                    now, _lastObservedAt))
            {
                Stop("Teammate Presence updates went stale; camera follow stopped.");
                return;
            }
            if (now < _nextApplyAt || member.lastHeartbeatUnixMs == _lastAppliedHeartbeat) return;
            _nextApplyAt = now + ApplyIntervalSeconds;
            _lastAppliedHeartbeat = member.lastHeartbeatUnixMs;
            Apply(member);
        }

        private static void Apply(PresenceRecord member)
        {
            if (!IsFollowing || _targetView == null) return;
            TeamForgePresenceService.ApplyRemoteCamera(_targetView, member);
        }

        private static string CurrentSceneGuid()
        {
            var scene = SceneManager.GetActiveScene();
            return scene.IsValid() && !string.IsNullOrEmpty(scene.path)
                ? AssetDatabase.AssetPathToGUID(scene.path)
                : string.Empty;
        }

        private static void DuringSceneGui(SceneView view)
        {
            if (!IsFollowing || view == null || view != _targetView) return;
            var current = Event.current;
            if (current == null) return;

            if (current.type == EventType.KeyDown && current.keyCode == KeyCode.Escape)
            {
                Stop();
                current.Use();
                return;
            }
            if ((current.type == EventType.MouseDown ||
                 current.type == EventType.MouseDrag ||
                 current.type == EventType.ScrollWheel) &&
                !OverlayArea.Contains(current.mousePosition))
            {
                Stop("Manual Scene View navigation; camera follow stopped.");
                return;
            }

            Handles.BeginGUI();
            GUI.Box(OverlayArea, GUIContent.none, EditorStyles.helpBox);
            GUI.Label(new Rect(24, OverlayTop + 6, 260, 32),
                $"TeamForge · following {_displayName}", EditorStyles.boldLabel);
            if (GUI.Button(new Rect(295, OverlayTop + 10, 66, 27), "Stop"))
            {
                Stop();
            }
            Handles.EndGUI();
        }
    }
}

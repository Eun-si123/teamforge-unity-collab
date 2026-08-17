using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace EunSung.TeamForge
{
    [InitializeOnLoad]
    public static class TeamForgePresenceService
    {
        private const float PositionThresholdSquared = 0.0001f;
        private const float RotationThresholdDegrees = 0.1f;
        private const float SizeThreshold = 0.001f;

        private static readonly Dictionary<string, GameObject> ResolvedObjects =
            new Dictionary<string, GameObject>(StringComparer.Ordinal);

        private static PresenceSample _lastSentSample;
        private static GameObject _cachedSelectedObject;
        private static string _cachedSelectedObjectId = string.Empty;
        private static GUIStyle _remoteLabelStyle;
        private static bool _dirty = true;
        private static bool _wasPresenceConnected;
        private static double _nextSampleAt;
        private static double _lastSentAt = double.NegativeInfinity;

        static TeamForgePresenceService()
        {
            Registry.Changed += OnRegistryChanged;
            TeamForgeHierarchyIdentityRegistry.SessionIdentityChanged += OnSessionIdentityChanged;
            TeamForgeConnectionService.Changed += OnConnectionChanged;
            TeamForgeConnectionService.PresenceMessageReceived += OnPresenceMessageReceived;
            Selection.selectionChanged += InvalidateSelection;
            EditorSceneManager.activeSceneChangedInEditMode += (_, __) => InvalidateSelection();
            EditorSceneManager.sceneSaved += _ => InvalidateSelection();
            EditorSceneManager.sceneOpened += (_, __) => InvalidateSelection();
            EditorApplication.playModeStateChanged += _ => InvalidateSelection();
            EditorApplication.update += Update;
            SceneView.duringSceneGui += DuringSceneGui;
        }

        public static TeamForgePresenceRegistry Registry { get; } = new TeamForgePresenceRegistry();

        public static string LocalUserId => TeamForgeConnectionService.Settings.UserId;

        public static List<PresenceRecord> RemoteMembers()
        {
            var members = Registry.Snapshot();
            members.RemoveAll(member => member.userId == LocalUserId);
            return members;
        }

        public static bool TryFrameRemoteSelection(string userId)
        {
            if (!Registry.TryGet(userId, out var member) ||
                !TryResolveObject(member.selectedObjectId, out var gameObject))
            {
                return false;
            }

            using (TeamForgeTransformSyncService.SuppressSelectionLock())
            {
                Selection.activeGameObject = gameObject;
            }
            var sceneView = SceneView.lastActiveSceneView;
            if (sceneView != null)
            {
                sceneView.FrameSelected();
                sceneView.Repaint();
            }
            return true;
        }

        public static bool TryMoveToRemoteCamera(string userId)
        {
            if (!Registry.TryGet(userId, out var member) ||
                !member.hasSceneView ||
                !TeamForgePresenceValidation.TryValidate(member, out _))
            {
                return false;
            }

            var sceneView = SceneView.lastActiveSceneView ?? EditorWindow.GetWindow<SceneView>();
            sceneView.orthographic = member.cameraOrthographic;
            sceneView.LookAtDirect(
                ToVector3(member.cameraPivot),
                ToQuaternion(member.cameraRotation),
                Mathf.Max(0.001f, member.cameraSize));
            sceneView.Repaint();
            return true;
        }

        private static void OnConnectionChanged()
        {
            var connected = TeamForgeConnectionService.State == TeamForgeConnectionState.Connected &&
                            TeamForgeConnectionService.PresenceAvailable;
            var identityEpochChanged = TeamForgeHierarchyIdentityRegistry.BeginConnectionIdentityEpoch(
                TeamForgeConnectionService.State == TeamForgeConnectionState.Connected
                    ? TeamForgeConnectionService.ConnectionId
                    : string.Empty);
            if (identityEpochChanged)
            {
                ResolvedObjects.Clear();
                InvalidateSelection();
            }
            if (connected && !_wasPresenceConnected)
            {
                _dirty = true;
                _nextSampleAt = 0;
                _lastSentAt = double.NegativeInfinity;
                _lastSentSample = null;
            }
            else if (!connected && _wasPresenceConnected)
            {
                Registry.Clear();
                ResolvedObjects.Clear();
                _lastSentSample = null;
            }

            _wasPresenceConnected = connected;
        }

        private static void OnPresenceMessageReceived(string messageType, string json)
        {
            switch (messageType)
            {
                case "presence_snapshot":
                {
                    var snapshot = TeamForgeProtocol.Deserialize<PresenceSnapshotMessage>(json);
                    var error = "message was empty";
                    if (snapshot == null || snapshot.members == null ||
                        !Registry.ReplaceAll(snapshot.members, out error))
                    {
                        TeamForgeDiagnostics.Warning($"Rejected Presence snapshot: {error}");
                    }
                    break;
                }
                case "user_joined":
                case "presence_updated":
                {
                    var changed = TeamForgeProtocol.Deserialize<PresenceChangedMessage>(json);
                    var error = "message was empty";
                    if (changed == null || !Registry.Upsert(changed.presence, out error))
                    {
                        TeamForgeDiagnostics.Warning($"Rejected Presence update: {error}");
                    }
                    break;
                }
                case "user_left":
                {
                    var left = TeamForgeProtocol.Deserialize<PresenceLeftMessage>(json);
                    if (left == null || string.IsNullOrWhiteSpace(left.userId) || left.userId.Length > 128)
                    {
                        TeamForgeDiagnostics.Warning("Rejected invalid Presence leave event.");
                    }
                    else
                    {
                        Registry.Remove(left.userId);
                    }
                    break;
                }
            }
        }

        private static void Update()
        {
            if (TeamForgeConnectionService.State != TeamForgeConnectionState.Connected ||
                !TeamForgeConnectionService.PresenceAvailable)
            {
                return;
            }

            var now = EditorApplication.timeSinceStartup;
            if (now < _nextSampleAt)
            {
                return;
            }

            var settings = TeamForgeConnectionService.Settings;
            var connectionPolicy = TeamForgeConnectionService.ResolvedProfile.Connection;
            _nextSampleAt = now + 1.0 / connectionPolicy.PresenceUpdatesPerSecond;
            var sample = CaptureSample();
            var heartbeatDue = now - _lastSentAt >= connectionPolicy.PresenceHeartbeatSeconds;
            if (!_dirty && !heartbeatDue && AreEquivalent(_lastSentSample, sample))
            {
                return;
            }

            var update = sample.ToMessage(settings.UserId);
            if (TeamForgeConnectionService.SendPresence(update))
            {
                _lastSentSample = sample;
                _lastSentAt = now;
                _dirty = false;
            }
        }

        private static PresenceSample CaptureSample()
        {
            var activeScene = SceneManager.GetActiveScene();
            var selected = Selection.activeGameObject;
            var selectedObjectId = string.Empty;
            var selectedObjectName = string.Empty;
            if (selected != null)
            {
                selectedObjectName = TrimPrintable(selected.name, 128);
                if (!EditorApplication.isPlayingOrWillChangePlaymode)
                {
                    if (_cachedSelectedObject != selected)
                    {
                        _cachedSelectedObject = selected;
                        _cachedSelectedObjectId = TeamForgeObjectIdentity.TryGetCollaborativeObjectId(selected, out var objectId)
                            ? objectId
                            : string.Empty;
                    }
                    selectedObjectId = _cachedSelectedObjectId;
                }
            }

            // Presence has a single sceneId field. When a selection is included, bind that
            // routing identity to the selected object's Scene rather than an unrelated active
            // additive Scene so delete/tombstone cleanup remains exact and direction-neutral.
            var presenceScene = !string.IsNullOrEmpty(selectedObjectId) && selected != null
                ? selected.scene
                : activeScene;
            var scenePath = presenceScene.IsValid() ? presenceScene.path : string.Empty;
            var sceneId = string.IsNullOrWhiteSpace(scenePath)
                ? string.Empty
                : AssetDatabase.AssetPathToGUID(scenePath);

            var sample = new PresenceSample
            {
                SceneId = sceneId ?? string.Empty,
                SceneName = presenceScene.IsValid() ? TrimPrintable(presenceScene.name, 128) : string.Empty,
                SelectedObjectId = selectedObjectId,
                SelectedObjectName = selectedObjectName,
                Activity = EditorApplication.isPlayingOrWillChangePlaymode
                    ? "Play Mode"
                    : selected != null ? "Selecting" : "Viewing",
                CameraRotation = Quaternion.identity,
                CameraSize = 10f,
            };

            var sceneView = SceneView.lastActiveSceneView;
            if (sceneView != null && sceneView.camera != null)
            {
                sample.HasSceneView = true;
                sample.CameraPosition = sceneView.camera.transform.position;
                sample.CameraRotation = sceneView.rotation;
                sample.CameraPivot = sceneView.pivot;
                sample.CameraSize = Mathf.Max(0.001f, sceneView.size);
                sample.CameraOrthographic = sceneView.orthographic;
            }
            return sample;
        }

        private static bool AreEquivalent(PresenceSample left, PresenceSample right)
        {
            if (left == null || right == null ||
                left.SceneId != right.SceneId ||
                left.SceneName != right.SceneName ||
                left.SelectedObjectId != right.SelectedObjectId ||
                left.SelectedObjectName != right.SelectedObjectName ||
                left.Activity != right.Activity ||
                left.HasSceneView != right.HasSceneView ||
                left.CameraOrthographic != right.CameraOrthographic)
            {
                return false;
            }

            if (!left.HasSceneView)
            {
                return true;
            }

            return (left.CameraPosition - right.CameraPosition).sqrMagnitude <= PositionThresholdSquared &&
                   (left.CameraPivot - right.CameraPivot).sqrMagnitude <= PositionThresholdSquared &&
                   Quaternion.Angle(left.CameraRotation, right.CameraRotation) <= RotationThresholdDegrees &&
                   Mathf.Abs(left.CameraSize - right.CameraSize) <= SizeThreshold;
        }

        private static void InvalidateSelection()
        {
            _cachedSelectedObject = null;
            _cachedSelectedObjectId = string.Empty;
            _dirty = true;
        }

        private static void OnSessionIdentityChanged()
        {
            ResolvedObjects.Clear();
            InvalidateSelection();
            SceneView.RepaintAll();
        }

        private static void OnRegistryChanged()
        {
            SceneView.RepaintAll();
        }

        private static void DuringSceneGui(SceneView sceneView)
        {
            if (Event.current == null ||
                Event.current.type != EventType.Repaint ||
                TeamForgeConnectionService.State != TeamForgeConnectionState.Connected ||
                !TeamForgeConnectionService.PresenceAvailable)
            {
                return;
            }

            foreach (var member in RemoteMembers())
            {
                if (!TryResolveObject(member.selectedObjectId, out var selectedObject) ||
                    !ColorUtility.TryParseHtmlString(member.color, out var color))
                {
                    continue;
                }

                var bounds = CalculateBounds(selectedObject);
                var previousColor = Handles.color;
                Handles.color = color;
                Handles.DrawWireCube(bounds.center, bounds.size);

                if (_remoteLabelStyle == null)
                {
                    _remoteLabelStyle = new GUIStyle(EditorStyles.miniBoldLabel);
                }
                _remoteLabelStyle.normal.textColor = color;
                Handles.Label(
                    bounds.center + Vector3.up * (bounds.extents.y + HandleUtility.GetHandleSize(bounds.center) * 0.08f),
                    member.displayName,
                    _remoteLabelStyle);
                Handles.color = previousColor;
            }
        }

        private static bool TryResolveObject(string objectId, out GameObject gameObject)
        {
            gameObject = null;
            if (string.IsNullOrWhiteSpace(objectId))
            {
                return false;
            }

            if (TeamForgeHierarchyIdentityRegistry.IsLogicalId(objectId) &&
                !TeamForgeHierarchyIdentityRegistry.IsSessionCanonicalLogicalId(objectId))
            {
                ResolvedObjects.Remove(objectId);
                return false;
            }

            if (ResolvedObjects.TryGetValue(objectId, out gameObject) && gameObject != null)
            {
                return true;
            }

            if (!TeamForgeObjectIdentity.TryResolveGameObject(objectId, out gameObject))
            {
                ResolvedObjects.Remove(objectId);
                return false;
            }

            ResolvedObjects[objectId] = gameObject;
            return true;
        }

        private static Bounds CalculateBounds(GameObject gameObject)
        {
            var renderers = gameObject.GetComponentsInChildren<Renderer>(true);
            var hasBounds = false;
            var bounds = new Bounds(gameObject.transform.position, Vector3.zero);
            foreach (var renderer in renderers)
            {
                if (renderer == null)
                {
                    continue;
                }

                if (!hasBounds)
                {
                    bounds = renderer.bounds;
                    hasBounds = true;
                }
                else
                {
                    bounds.Encapsulate(renderer.bounds);
                }
            }

            if (!hasBounds || bounds.size.sqrMagnitude < 0.000001f)
            {
                var size = HandleUtility.GetHandleSize(gameObject.transform.position) * 0.25f;
                bounds = new Bounds(gameObject.transform.position, Vector3.one * size);
            }
            return bounds;
        }

        private static Vector3 ToVector3(TeamForgeVector3Dto value)
        {
            return value == null ? Vector3.zero : new Vector3(value.x, value.y, value.z);
        }

        private static Quaternion ToQuaternion(TeamForgeQuaternionDto value)
        {
            return value == null ? Quaternion.identity : new Quaternion(value.x, value.y, value.z, value.w);
        }

        private static string TrimPrintable(string value, int maximumLength)
        {
            var source = value?.Trim() ?? string.Empty;
            var characters = new char[Mathf.Min(source.Length, maximumLength)];
            var length = 0;
            foreach (var character in source)
            {
                if (length >= characters.Length)
                {
                    break;
                }
                if (!char.IsControl(character))
                {
                    characters[length++] = character;
                }
            }
            return new string(characters, 0, length);
        }

        private sealed class PresenceSample
        {
            public string SceneId;
            public string SceneName;
            public string SelectedObjectId;
            public string SelectedObjectName;
            public bool HasSceneView;
            public Vector3 CameraPosition;
            public Quaternion CameraRotation;
            public Vector3 CameraPivot;
            public float CameraSize;
            public bool CameraOrthographic;
            public string Activity;

            public PresenceUpdateMessage ToMessage(string userId)
            {
                return new PresenceUpdateMessage
                {
                    type = "presence_update",
                    protocolVersion = TeamForgeProtocol.Version,
                    requestId = Guid.NewGuid().ToString("N"),
                    userId = userId,
                    sceneId = SceneId,
                    sceneName = SceneName,
                    selectedObjectId = SelectedObjectId,
                    selectedObjectName = SelectedObjectName,
                    hasSceneView = HasSceneView,
                    cameraPosition = FromVector3(CameraPosition),
                    cameraRotation = FromQuaternion(CameraRotation),
                    cameraPivot = FromVector3(CameraPivot),
                    cameraSize = CameraSize,
                    cameraOrthographic = CameraOrthographic,
                    activity = Activity,
                };
            }

            private static TeamForgeVector3Dto FromVector3(Vector3 value)
            {
                return new TeamForgeVector3Dto { x = value.x, y = value.y, z = value.z };
            }

            private static TeamForgeQuaternionDto FromQuaternion(Quaternion value)
            {
                return new TeamForgeQuaternionDto { x = value.x, y = value.y, z = value.z, w = value.w };
            }
        }
    }
}

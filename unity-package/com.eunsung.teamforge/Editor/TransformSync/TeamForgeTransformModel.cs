using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace EunSung.TeamForge
{
    public sealed class TeamForgeTransformState
    {
        private const float PositionThresholdSquared = 0.00000001f;
        private const float ScaleThresholdSquared = 0.00000001f;
        private const float RotationThresholdDegrees = 0.01f;

        public Vector3 LocalPosition;
        public Quaternion LocalRotation = Quaternion.identity;
        public Vector3 LocalScale = Vector3.one;

        public static TeamForgeTransformState Capture(Transform transform)
        {
            if (transform == null)
            {
                return null;
            }

            return new TeamForgeTransformState
            {
                LocalPosition = transform.localPosition,
                LocalRotation = transform.localRotation,
                LocalScale = transform.localScale,
            };
        }

        public static bool TryFromMessage(
            TransformAppliedMessage message,
            out TeamForgeTransformState state,
            out string error)
        {
            state = null;
            if (message == null ||
                !IsFinite(message.localPosition) ||
                !IsFinite(message.localRotation) ||
                !IsFinite(message.localScale))
            {
                error = "Transform message contains invalid numeric data.";
                return false;
            }

            var rotation = new Quaternion(
                message.localRotation.x,
                message.localRotation.y,
                message.localRotation.z,
                message.localRotation.w);
            var magnitudeSquared =
                rotation.x * rotation.x +
                rotation.y * rotation.y +
                rotation.z * rotation.z +
                rotation.w * rotation.w;
            if (magnitudeSquared < 0.000001f || magnitudeSquared > 4f)
            {
                error = "Transform rotation is not a usable quaternion.";
                return false;
            }

            state = new TeamForgeTransformState
            {
                LocalPosition = ToVector3(message.localPosition),
                LocalRotation = rotation.normalized,
                LocalScale = ToVector3(message.localScale),
            };
            error = string.Empty;
            return true;
        }

        public bool ApproximatelyEquals(TeamForgeTransformState other)
        {
            return other != null &&
                   (LocalPosition - other.LocalPosition).sqrMagnitude <= PositionThresholdSquared &&
                   Quaternion.Angle(LocalRotation, other.LocalRotation) <= RotationThresholdDegrees &&
                   (LocalScale - other.LocalScale).sqrMagnitude <= ScaleThresholdSquared;
        }

        public TeamForgeTransformState Clone()
        {
            return new TeamForgeTransformState
            {
                LocalPosition = LocalPosition,
                LocalRotation = LocalRotation,
                LocalScale = LocalScale,
            };
        }

        public static bool ApplyRemote(GameObject target, TeamForgeTransformState state)
        {
            if (target == null || state == null || !target.scene.IsValid() || !target.scene.isLoaded)
            {
                return false;
            }

            var current = Capture(target.transform);
            if (current != null && current.ApproximatelyEquals(state))
            {
                using (TeamForgeRemoteApplyScope.Enter())
                {
                    ClearLocalUndo(target);
                }
                return true;
            }

            using (TeamForgeRemoteApplyScope.Enter())
            {
                // A local Undo record created before this authoritative remote value could
                // otherwise resurrect stale state later. Clear only this target's history.
                ClearLocalUndo(target);
                target.transform.localPosition = state.LocalPosition;
                target.transform.localRotation = state.LocalRotation;
                target.transform.localScale = state.LocalScale;
                if (PrefabUtility.IsPartOfPrefabInstance(target))
                {
                    PrefabUtility.RecordPrefabInstancePropertyModifications(target.transform);
                }
                EditorSceneManager.MarkSceneDirty(target.scene);
            }
            return true;
        }

        private static void ClearLocalUndo(GameObject target)
        {
            Undo.ClearUndo(target.transform);
            Undo.ClearUndo(target);
        }

        public TeamForgeVector3Dto PositionDto()
        {
            return FromVector3(LocalPosition);
        }

        public TeamForgeQuaternionDto RotationDto()
        {
            return new TeamForgeQuaternionDto
            {
                x = LocalRotation.x,
                y = LocalRotation.y,
                z = LocalRotation.z,
                w = LocalRotation.w,
            };
        }

        public TeamForgeVector3Dto ScaleDto()
        {
            return FromVector3(LocalScale);
        }

        private static TeamForgeVector3Dto FromVector3(Vector3 value)
        {
            return new TeamForgeVector3Dto { x = value.x, y = value.y, z = value.z };
        }

        private static Vector3 ToVector3(TeamForgeVector3Dto value)
        {
            return new Vector3(value.x, value.y, value.z);
        }

        private static bool IsFinite(TeamForgeVector3Dto value)
        {
            return value != null &&
                   IsCoordinate(value.x) &&
                   IsCoordinate(value.y) &&
                   IsCoordinate(value.z);
        }

        private static bool IsFinite(TeamForgeQuaternionDto value)
        {
            return value != null &&
                   IsCoordinate(value.x) &&
                   IsCoordinate(value.y) &&
                   IsCoordinate(value.z) &&
                   IsCoordinate(value.w);
        }

        private static bool IsCoordinate(float value)
        {
            return !float.IsNaN(value) &&
                   !float.IsInfinity(value) &&
                   Mathf.Abs(value) <= 1000000000f;
        }
    }

    public static class TeamForgeRemoteApplyScope
    {
        private static int _depth;

        public static bool IsActive => _depth > 0;

        public static IDisposable Enter()
        {
            _depth += 1;
            return new Scope();
        }

        private sealed class Scope : IDisposable
        {
            private bool _disposed;

            public void Dispose()
            {
                if (_disposed)
                {
                    return;
                }

                _disposed = true;
                _depth = Math.Max(0, _depth - 1);
            }
        }
    }

    internal enum TeamForgeTransformSelectionRejection
    {
        None,
        PlayMode,
        NoSelection,
        MultipleSelection,
        PrefabStage,
        AwaitingHierarchySnapshot,
        SceneIdentityUnavailable,
        ObjectIdentityUnavailable,
        ParentIdentityUnavailable,
        HierarchyBlocked,
        BaselineMissing,
        ParentMismatch,
        ProtectedConflict,
    }

    internal sealed class TeamForgeTransformSelectionResolution
    {
        internal TeamForgeTransformSelectionResolution(
            GameObject target,
            string sceneId,
            string objectId,
            string parentObjectId,
            TeamForgeTransformSelectionRejection rejection)
        {
            Target = target;
            SceneId = sceneId ?? string.Empty;
            ObjectId = objectId ?? string.Empty;
            ParentObjectId = parentObjectId ?? string.Empty;
            Rejection = rejection;
        }

        public GameObject Target { get; }
        public string SceneId { get; }
        public string ObjectId { get; }
        public string ParentObjectId { get; }
        public TeamForgeTransformSelectionRejection Rejection { get; }
        public bool HasCanonicalObjectIdentity =>
            Target != null &&
            !string.IsNullOrWhiteSpace(SceneId) &&
            !string.IsNullOrWhiteSpace(ObjectId);
        public bool CanTrack => Rejection == TeamForgeTransformSelectionRejection.None;
    }

    public sealed class TeamForgeObjectBaselineRegistry
    {
        private readonly Dictionary<string, Dictionary<string, string>> _objectsByScene =
            new Dictionary<string, Dictionary<string, string>>(StringComparer.Ordinal);

        public int SceneCount => _objectsByScene.Count;

        public bool RegisterCleanSceneIfMissing(Scene scene, out string error)
        {
            if (scene.IsValid() && !string.IsNullOrWhiteSpace(scene.path))
            {
                var sceneId = AssetDatabase.AssetPathToGUID(scene.path);
                if (!string.IsNullOrWhiteSpace(sceneId) && _objectsByScene.ContainsKey(sceneId))
                {
                    error = string.Empty;
                    return true;
                }
            }
            return RegisterCleanScene(scene, out error);
        }

        public bool RegisterCleanScene(Scene scene, out string error)
        {
            if (!scene.IsValid() || !scene.isLoaded || string.IsNullOrWhiteSpace(scene.path))
            {
                error = "Scene must be loaded and saved before its collaboration baseline is captured.";
                return false;
            }
            if (scene.isDirty)
            {
                error = "Scene has unsaved changes; reload or save and reopen it before joining Transform Sync.";
                return false;
            }

            var sceneId = AssetDatabase.AssetPathToGUID(scene.path);
            if (string.IsNullOrWhiteSpace(sceneId))
            {
                error = "Scene Asset GUID could not be resolved.";
                return false;
            }

            var objectIds = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (var root in scene.GetRootGameObjects())
            {
                foreach (var transform in root.GetComponentsInChildren<Transform>(true))
                {
                    var gameObject = transform.gameObject;
                    if (PrefabStageUtility.GetPrefabStage(gameObject) == null &&
                        TeamForgeObjectIdentity.TryGetGlobalObjectId(gameObject, out var objectId) &&
                        TryGetParentObjectId(gameObject, out var parentObjectId))
                    {
                        objectIds[objectId] = parentObjectId;
                    }
                }
            }

            _objectsByScene[sceneId] = objectIds;
            error = string.Empty;
            return true;
        }

        public bool Contains(string sceneId, string objectId)
        {
            return !string.IsNullOrWhiteSpace(sceneId) &&
                   !string.IsNullOrWhiteSpace(objectId) &&
                   _objectsByScene.TryGetValue(sceneId, out var objectIds) &&
                   objectIds.ContainsKey(objectId);
        }

        public bool TryGetCanonicalObjectId(string sceneId, GameObject target, out string objectId)
        {
            objectId = string.Empty;
            if (target == null || string.IsNullOrWhiteSpace(sceneId))
            {
                return false;
            }

            // A logical ID is canonical only when it belongs to the current connection
            // identity epoch and Hierarchy authority has inserted the exact key into this
            // Transform baseline. A persisted Library alias alone never authorizes wire use.
            return TeamForgeObjectIdentity.TryGetCanonicalObjectId(
                target,
                logicalId => Contains(sceneId, logicalId),
                out objectId);
        }

        public bool TryGetCanonicalParentObjectId(
            string sceneId,
            GameObject target,
            out string parentObjectId)
        {
            parentObjectId = string.Empty;
            if (target == null)
            {
                return false;
            }

            var parent = target.transform.parent;
            return parent == null ||
                   TryGetCanonicalObjectId(sceneId, parent.gameObject, out parentObjectId);
        }

        public bool MatchesParent(string sceneId, string objectId, string parentObjectId)
        {
            return _objectsByScene.TryGetValue(sceneId ?? string.Empty, out var objectIds) &&
                   objectIds.TryGetValue(objectId ?? string.Empty, out var baselineParentObjectId) &&
                   baselineParentObjectId == (parentObjectId ?? string.Empty);
        }

        public void Upsert(string sceneId, string objectId, string parentObjectId)
        {
            if (string.IsNullOrWhiteSpace(sceneId) || string.IsNullOrWhiteSpace(objectId))
            {
                return;
            }
            if (!_objectsByScene.TryGetValue(sceneId, out var objectIds))
            {
                objectIds = new Dictionary<string, string>(StringComparer.Ordinal);
                _objectsByScene[sceneId] = objectIds;
            }
            objectIds[objectId] = parentObjectId ?? string.Empty;
        }

        public void Remove(string sceneId, string objectId)
        {
            if (!_objectsByScene.TryGetValue(sceneId ?? string.Empty, out var objectIds))
            {
                return;
            }
            objectIds.Remove(objectId ?? string.Empty);
            if (objectIds.Count == 0)
            {
                _objectsByScene.Remove(sceneId ?? string.Empty);
            }
        }

        public List<TeamForgeBaselineEntry> Snapshot()
        {
            var entries = new List<TeamForgeBaselineEntry>();
            foreach (var scene in _objectsByScene)
            {
                foreach (var pair in scene.Value)
                {
                    entries.Add(new TeamForgeBaselineEntry
                    {
                        sceneId = scene.Key,
                        objectId = pair.Key,
                        parentObjectId = pair.Value,
                    });
                }
            }
            return entries;
        }

        public void ReplaceAll(IEnumerable<TeamForgeBaselineEntry> entries)
        {
            _objectsByScene.Clear();
            if (entries == null)
            {
                return;
            }

            foreach (var entry in entries)
            {
                if (entry == null ||
                    string.IsNullOrWhiteSpace(entry.sceneId) ||
                    string.IsNullOrWhiteSpace(entry.objectId))
                {
                    continue;
                }
                if (!_objectsByScene.TryGetValue(entry.sceneId, out var objectIds))
                {
                    objectIds = new Dictionary<string, string>(StringComparer.Ordinal);
                    _objectsByScene.Add(entry.sceneId, objectIds);
                }
                objectIds[entry.objectId] = entry.parentObjectId ?? string.Empty;
            }
        }

        public void Clear()
        {
            _objectsByScene.Clear();
        }

        private static bool TryGetParentObjectId(GameObject gameObject, out string parentObjectId)
        {
            parentObjectId = string.Empty;
            var parent = gameObject == null ? null : gameObject.transform.parent;
            return gameObject != null &&
                   (parent == null ||
                    TeamForgeObjectIdentity.TryGetGlobalObjectId(parent.gameObject, out parentObjectId));
        }
    }

    [Serializable]
    public sealed class TeamForgeBaselineEntry
    {
        public string sceneId;
        public string objectId;
        public string parentObjectId;
    }

    public sealed class TeamForgeLockRegistry
    {
        private const long MaximumUnixMilliseconds = 253402300799999;

        private readonly Dictionary<string, TeamForgeLockRecord> _locks =
            new Dictionary<string, TeamForgeLockRecord>(StringComparer.Ordinal);

        public event Action Changed;

        public int Count => _locks.Count;
        public long Version { get; private set; }

        public bool ReplaceAll(IEnumerable<TeamForgeLockRecord> locks, out string error)
        {
            var replacement = new Dictionary<string, TeamForgeLockRecord>(StringComparer.Ordinal);
            if (locks != null)
            {
                foreach (var lockState in locks)
                {
                    if (!TryValidate(lockState, out error))
                    {
                        return false;
                    }

                    var key = Key(lockState.sceneId, lockState.objectId);
                    if (replacement.ContainsKey(key))
                    {
                        error = "Lock snapshot contains a duplicate Scene/Object pair.";
                        return false;
                    }
                    replacement.Add(key, lockState);
                }
            }

            _locks.Clear();
            foreach (var pair in replacement)
            {
                _locks.Add(pair.Key, pair.Value);
            }
            error = string.Empty;
            Version += 1;
            Changed?.Invoke();
            return true;
        }

        public bool Upsert(TeamForgeLockRecord lockState, out string error)
        {
            if (!TryValidate(lockState, out error))
            {
                return false;
            }

            _locks[Key(lockState.sceneId, lockState.objectId)] = lockState;
            Version += 1;
            Changed?.Invoke();
            return true;
        }

        public bool Remove(string sceneId, string objectId)
        {
            if (!_locks.Remove(Key(sceneId, objectId)))
            {
                return false;
            }

            Version += 1;
            Changed?.Invoke();
            return true;
        }

        public bool TryGet(string sceneId, string objectId, out TeamForgeLockRecord lockState)
        {
            return _locks.TryGetValue(Key(sceneId, objectId), out lockState);
        }

        public List<TeamForgeLockRecord> Snapshot()
        {
            return new List<TeamForgeLockRecord>(_locks.Values);
        }

        public void Clear()
        {
            if (_locks.Count == 0)
            {
                return;
            }

            _locks.Clear();
            Version += 1;
            Changed?.Invoke();
        }

        public static bool TryValidate(TeamForgeLockRecord lockState, out string error)
        {
            if (lockState == null ||
                !ValidText(lockState.sceneId, 128) ||
                !ValidText(lockState.objectId, 512) ||
                !ValidText(lockState.ownerUserId, 128) ||
                !ValidText(lockState.ownerConnectionId, 128) ||
                !ValidText(lockState.ownerDisplayName, 64) ||
                lockState.expiresAtUnixMs < 0 ||
                lockState.expiresAtUnixMs > MaximumUnixMilliseconds ||
                string.IsNullOrWhiteSpace(lockState.ownerColor) ||
                lockState.ownerColor.Length != 7 ||
                !ColorUtility.TryParseHtmlString(lockState.ownerColor, out _))
            {
                error = "Lock state is invalid.";
                return false;
            }

            error = string.Empty;
            return true;
        }

        private static string Key(string sceneId, string objectId)
        {
            return (sceneId ?? string.Empty) + "\n" + (objectId ?? string.Empty);
        }

        private static bool ValidText(string value, int maximumLength)
        {
            var candidate = value?.Trim() ?? string.Empty;
            if (candidate.Length == 0 || candidate.Length > maximumLength)
            {
                return false;
            }
            foreach (var character in candidate)
            {
                if (char.IsControl(character))
                {
                    return false;
                }
            }
            return true;
        }
    }
}

using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace EunSung.TeamForge
{
    [InitializeOnLoad]
    public static class TeamForgeHierarchySyncService
    {
        private const int MaximumPendingSeedRequests = 16;
        private static readonly TeamForgeHierarchyRegistry Authoritative = new TeamForgeHierarchyRegistry();
        private static readonly Dictionary<string, TeamForgePendingHierarchyOperation> PendingByRequestId =
            new Dictionary<string, TeamForgePendingHierarchyOperation>(StringComparer.Ordinal);
        private static readonly Dictionary<string, SeedRequest> PendingSeeds =
            new Dictionary<string, SeedRequest>(StringComparer.Ordinal);
        private static readonly Dictionary<string, GameObject> LocalObjectByKey =
            new Dictionary<string, GameObject>(StringComparer.Ordinal);
        private static readonly HashSet<string> UnsafePrefabKeys = new HashSet<string>(StringComparer.Ordinal);
        private static readonly HashSet<string> AuthoritativeSceneIds = new HashSet<string>(StringComparer.Ordinal);
        private static IAuthorityView Authority => TeamForgeAuthorityView.Current;

        private static TeamForgePendingHierarchyOperation _pendingOperation;
        private static bool _wasConnected;
        private static bool _receivedSnapshot;
        private static bool _scanScheduled;
        private static bool _suppressLocalChanges;
        private static string _status = "Offline";
        private static int _conflictCount;

        static TeamForgeHierarchySyncService()
        {
            TeamForgeConnectionService.Changed += OnConnectionChanged;
            TeamForgeConnectionService.HierarchyMessageReceived += OnHierarchyMessageReceived;
            TeamForgeConnectionService.ProtocolErrorReceived += OnProtocolErrorReceived;
            ObjectChangeEvents.changesPublished += OnObjectChangesPublished;
            EditorApplication.hierarchyChanged += OnHierarchyChanged;
            EditorSceneManager.sceneOpened += OnSceneOpened;
            EditorSceneManager.sceneClosed += OnSceneClosed;
            EditorSceneManager.sceneSaved += OnSceneSaved;
            Undo.undoRedoPerformed += OnUndoRedo;
            EditorApplication.update += Update;
        }

        public static event Action Changed;
        public static string Status => _status;
        public static bool SnapshotReady => _receivedSnapshot;
        public static int ConflictCount => _conflictCount;
        public static int TrackedObjectCount => Authoritative.Count;
        public static int TombstoneCount => Authoritative.TombstoneCount;
        public static bool HasPendingOperation => _pendingOperation != null;

        internal static bool IsOperationPendingFor(string sceneId, string objectId)
        {
            return _pendingOperation != null &&
                   _pendingOperation.SceneId == sceneId &&
                   _pendingOperation.ObjectId == objectId;
        }

        private static void OnConnectionChanged()
        {
            var connected = Authority.IsConnected && Authority.HierarchySyncAvailable;
            TeamForgeHierarchyIdentityRegistry.BeginConnectionIdentityEpoch(
                Authority.IsConnected ? Authority.ConnectionId : string.Empty);
            if (connected == _wasConnected)
            {
                return;
            }

            _wasConnected = connected;
            if (connected)
            {
                Authoritative.Clear();
                PendingByRequestId.Clear();
                PendingSeeds.Clear();
                LocalObjectByKey.Clear();
                UnsafePrefabKeys.Clear();
                AuthoritativeSceneIds.Clear();
                _pendingOperation = null;
                _receivedSnapshot = false;
                _scanScheduled = false;
                _conflictCount = 0;
                SetStatus("Connected; waiting for authoritative Hierarchy snapshot.");
            }
            else
            {
                PendingByRequestId.Clear();
                PendingSeeds.Clear();
                _pendingOperation = null;
                _receivedSnapshot = false;
                _scanScheduled = false;
                SetStatus(
                    Authority.IsConnected
                        ? "Server does not support Hierarchy Sync."
                        : "Offline");
            }
        }

        private static void OnObjectChangesPublished(ref ObjectChangeEventStream stream)
        {
            if (!_wasConnected || TeamForgeRemoteApplyScope.IsActive || _suppressLocalChanges)
            {
                return;
            }

            for (var index = 0; index < stream.length; index += 1)
            {
                switch (stream.GetEventType(index))
                {
                    case ObjectChangeKind.CreateGameObjectHierarchy:
                    case ObjectChangeKind.DestroyGameObjectHierarchy:
                    case ObjectChangeKind.ChangeGameObjectParent:
                    case ObjectChangeKind.ChangeChildrenOrder:
                        _scanScheduled = true;
                        return;
                }
            }
        }

        private static void OnHierarchyChanged()
        {
            if (_wasConnected && !TeamForgeRemoteApplyScope.IsActive && !_suppressLocalChanges)
            {
                _scanScheduled = true;
            }
        }

        private static void OnUndoRedo()
        {
            if (_wasConnected && !TeamForgeRemoteApplyScope.IsActive && !_suppressLocalChanges)
            {
                _scanScheduled = true;
            }
        }

        private static void OnSceneOpened(Scene scene, OpenSceneMode mode)
        {
            if (_wasConnected)
            {
                _scanScheduled = true;
                if (_receivedSnapshot)
                {
                    TrySeedMissingCleanScenes();
                }
            }
        }

        private static void OnSceneClosed(Scene scene)
        {
            _scanScheduled = _wasConnected;
        }

        private static void OnSceneSaved(Scene scene)
        {
            TeamForgeHierarchyIdentityRegistry.RefreshAndPersist();
            if (_wasConnected)
            {
                _scanScheduled = true;
            }
        }

        private static void Update()
        {
            if (!_wasConnected || !_receivedSnapshot || _pendingOperation != null || PendingSeeds.Count > 0)
            {
                return;
            }
            if (!_scanScheduled)
            {
                return;
            }

            _scanScheduled = false;
            ProcessOneLocalDifference();
        }

        private static void OnHierarchyMessageReceived(string messageType, string json)
        {
            switch (messageType)
            {
                case "hierarchy_snapshot":
                    HandleHierarchySnapshot(TeamForgeProtocol.Deserialize<HierarchySnapshotMessage>(json));
                    break;
                case "hierarchy_seed_accepted":
                    HandleSeedAccepted(TeamForgeProtocol.Deserialize<HierarchySeedAcceptedMessage>(json));
                    break;
                case "hierarchy_applied":
                    HandleHierarchyApplied(TeamForgeProtocol.Deserialize<HierarchyAppliedMessage>(json));
                    break;
                case "hierarchy_conflict":
                    HandleHierarchyConflict(TeamForgeProtocol.Deserialize<HierarchyConflictMessage>(json));
                    break;
            }
        }

        private static void HandleHierarchySnapshot(HierarchySnapshotMessage snapshot)
        {
            if (snapshot == null || snapshot.serverRevision < 0 || snapshot.objects == null || snapshot.tombstones == null)
            {
                RejectSnapshot("Hierarchy snapshot envelope is invalid.");
                return;
            }

            var snapshotSceneIds = new HashSet<string>(StringComparer.Ordinal);
            foreach (var sceneId in snapshot.sceneIds ?? Array.Empty<string>())
            {
                if (!ValidText(sceneId, 128) || !snapshotSceneIds.Add(sceneId.Trim()))
                {
                    RejectSnapshot("Hierarchy snapshot contains an invalid or duplicate Scene identity.");
                    return;
                }
            }

            var states = new List<TeamForgeHierarchyState>();
            var keys = new HashSet<string>(StringComparer.Ordinal);
            foreach (var record in snapshot.objects)
            {
                if (!TeamForgeHierarchyState.TryFromRecord(record, out var state, out var error))
                {
                    RejectSnapshot(error);
                    return;
                }
                var key = Key(state.SceneId, state.ObjectId);
                if (!keys.Add(key))
                {
                    RejectSnapshot("Hierarchy snapshot contains a duplicate Scene/Object identity.");
                    return;
                }
                states.Add(state);
                snapshotSceneIds.Add(state.SceneId);
            }

            foreach (var tombstone in snapshot.tombstones)
            {
                if (tombstone == null ||
                    !ValidText(tombstone.sceneId, 128) ||
                    !ValidText(tombstone.objectId, 512) ||
                    tombstone.deletedRevision < 1 ||
                    tombstone.deletedRevision > snapshot.serverRevision)
                {
                    RejectSnapshot("Hierarchy snapshot contains an invalid tombstone.");
                    return;
                }
                if (!keys.Add(Key(tombstone.sceneId, tombstone.objectId)))
                {
                    RejectSnapshot("Hierarchy snapshot contains a live/tombstone identity collision.");
                    return;
                }
                snapshotSceneIds.Add(tombstone.sceneId.Trim());
            }

            if (!ValidateParentGraph(states, out var graphError))
            {
                RejectSnapshot(graphError);
                return;
            }

            var firstSnapshot = !_receivedSnapshot;
            if (firstSnapshot && !PrepareInitialSnapshot(states, snapshot.tombstones, snapshotSceneIds, out var safetyError))
            {
                RejectSnapshot(safetyError);
                return;
            }

            if (!ApplyAuthoritativeSnapshot(states, snapshot.tombstones, firstSnapshot, out var applyError))
            {
                RejectSnapshot(applyError);
                return;
            }

            Authoritative.ReplaceAll(states, snapshot.tombstones);
            AuthoritativeSceneIds.Clear();
            foreach (var sceneId in snapshotSceneIds)
            {
                AuthoritativeSceneIds.Add(sceneId);
            }
            RebuildLocalReferenceIndex(states);
            _receivedSnapshot = true;
            TeamForgeAuthorityView.ObserveRevision(snapshot.serverRevision);
            TeamForgeTransformSyncService.ApplyHierarchyAuthoritativeState(states, string.Empty, null);
            SetStatus(
                $"Hierarchy snapshot ready at revision {snapshot.serverRevision} " +
                $"({states.Count} object(s), {snapshot.tombstones.Length} tombstone(s)).");
            TrySeedMissingCleanScenes();
            _scanScheduled = true;
        }

        private static void HandleSeedAccepted(HierarchySeedAcceptedMessage message)
        {
            if (message == null || string.IsNullOrWhiteSpace(message.requestId) ||
                !PendingSeeds.TryGetValue(message.requestId, out var pending))
            {
                return;
            }
            PendingSeeds.Remove(message.requestId);
            AuthoritativeSceneIds.Add(pending.SceneId);
            foreach (var state in pending.States)
            {
                Authoritative.Upsert(state);
                if (pending.LocalObjects.TryGetValue(state.ObjectId, out var target) && target != null)
                {
                    LocalObjectByKey[Key(state.SceneId, state.ObjectId)] = target;
                }
            }
            TeamForgeAuthorityView.ObserveRevision(message.serverRevision);
            TeamForgeTransformSyncService.ApplyHierarchyAuthoritativeState(pending.States, pending.SceneId, null);
            SetStatus(message.idempotent
                ? $"Hierarchy baseline for {ShortId(pending.SceneId)} already matched the server."
                : $"Hierarchy baseline for {ShortId(pending.SceneId)} was seeded.");
            if (PendingSeeds.Count == 0)
            {
                _scanScheduled = true;
                TrySeedMissingCleanScenes();
            }
        }

        private static void HandleHierarchyApplied(HierarchyAppliedMessage message)
        {
            if (message == null ||
                !ValidText(message.operationId, 128) ||
                !ValidText(message.sceneId, 128) ||
                !ValidText(message.objectId, 512) ||
                message.serverRevision < 1 ||
                message.changedObjects == null ||
                message.deletedObjectIds == null)
            {
                TeamForgeDiagnostics.Warning("Rejected invalid Hierarchy applied message.");
                return;
            }

            var changed = new List<TeamForgeHierarchyState>();
            foreach (var record in message.changedObjects)
            {
                if (!TeamForgeHierarchyState.TryFromRecord(record, out var state, out var error))
                {
                    TeamForgeDiagnostics.Warning($"Rejected Hierarchy applied message: {error}");
                    return;
                }
                changed.Add(state);
            }

            var ownPending = _pendingOperation != null && _pendingOperation.OperationId == message.operationId;
            if (!ownPending)
            {
                if (!ApplyRemoteAppliedMessage(message, changed, out var applyError))
                {
                    _conflictCount += 1;
                    SetStatus($"Hierarchy apply blocked: {applyError}");
                    TeamForgeDiagnostics.Warning(applyError);
                    RaiseChanged();
                    return;
                }
            }

            foreach (var state in changed)
            {
                Authoritative.Upsert(state);
                AuthoritativeSceneIds.Add(state.SceneId);
                if (TeamForgeObjectIdentity.TryResolveGameObject(state.ObjectId, out var target))
                {
                    LocalObjectByKey[Key(state.SceneId, state.ObjectId)] = target;
                    if (TeamForgeHierarchyIdentityRegistry.IsLogicalId(state.ObjectId))
                    {
                        TeamForgeHierarchyIdentityRegistry.BindLogical(state.ObjectId, target);
                    }
                }
            }
            foreach (var deletedObjectId in message.deletedObjectIds)
            {
                Authoritative.Remove(message.sceneId, deletedObjectId, true);
                LocalObjectByKey.Remove(Key(message.sceneId, deletedObjectId));
                UnsafePrefabKeys.Remove(Key(message.sceneId, deletedObjectId));
                TeamForgeHierarchyIdentityRegistry.ForgetLiveObject(deletedObjectId);
            }

            TeamForgeAuthorityView.ObserveRevision(message.serverRevision);
            TeamForgeTransformSyncService.ApplyHierarchyAuthoritativeState(changed, message.sceneId, message.deletedObjectIds);
            if (ownPending)
            {
                PendingByRequestId.Remove(_pendingOperation.RequestId);
                _pendingOperation = null;
            }
            SetStatus($"Hierarchy synchronized at revision {message.serverRevision}: {message.kind}.");
            _scanScheduled = true;
            RaiseChanged();
        }

        private static void HandleHierarchyConflict(HierarchyConflictMessage message)
        {
            if (message == null)
            {
                return;
            }
            TeamForgeAuthorityView.ObserveRevision(message.serverRevision);
            _conflictCount += 1;

            if (_pendingOperation != null &&
                (!string.IsNullOrWhiteSpace(message.operationId) && message.operationId == _pendingOperation.OperationId))
            {
                var rejected = _pendingOperation;
                PendingByRequestId.Remove(rejected.RequestId);
                _pendingOperation = null;
                RevertLastLocalHierarchyChange(rejected, message.reason);
            }
            else if (PendingSeeds.ContainsKey(message.requestId ?? string.Empty))
            {
                PendingSeeds.Remove(message.requestId);
                SetStatus(
                    $"Hierarchy baseline seed conflicted ({message.reason}). Disconnect/reconnect after resolving the Scene state.");
            }
            else
            {
                SetStatus($"Hierarchy conflict ({message.reason}) at server revision {message.serverRevision}.");
            }
            TeamForgeDiagnostics.Warning(
                $"Hierarchy conflict {message.reason}: {message.detail} (server revision {message.serverRevision}).");
            RaiseChanged();
        }

        private static void OnProtocolErrorReceived(ProtocolErrorMessage message)
        {
            if (message == null || string.IsNullOrWhiteSpace(message.requestId))
            {
                return;
            }
            if (PendingByRequestId.TryGetValue(message.requestId, out var pending))
            {
                PendingByRequestId.Remove(message.requestId);
                if (_pendingOperation?.RequestId == message.requestId)
                {
                    _pendingOperation = null;
                }
                _conflictCount += 1;
                RevertLastLocalHierarchyChange(pending, message.code);
                return;
            }
            if (PendingSeeds.Remove(message.requestId))
            {
                _conflictCount += 1;
                SetStatus($"Hierarchy baseline seed rejected ({message.code}).");
            }
        }

        private static void RevertLastLocalHierarchyChange(TeamForgePendingHierarchyOperation pending, string reason)
        {
            try
            {
                _suppressLocalChanges = true;
                using (TeamForgeRemoteApplyScope.Enter())
                {
                    Undo.PerformUndo();
                }
                SetStatus(
                    $"Local {pending.Kind} was rejected ({reason}) and reverted with Unity Undo. " +
                    "Review the authoritative Hierarchy before retrying.");
            }
            catch (Exception exception)
            {
                SetStatus(
                    $"Local {pending.Kind} was rejected ({reason}); automatic Undo failed. " +
                    "Stop editing and reconnect before continuing.");
                TeamForgeDiagnostics.Error($"Hierarchy rejection Undo failed: {exception.Message}");
            }
            finally
            {
                _suppressLocalChanges = false;
                _scanScheduled = true;
            }
        }

        private static void ProcessOneLocalDifference()
        {
            if (EditorApplication.isPlayingOrWillChangePlaymode)
            {
                SetStatus("Hierarchy Sync is disabled in Play Mode.");
                return;
            }

            if (!TryCaptureAllLoadedScenes(false, out var currentByScene, out var currentObjects, out var captureError))
            {
                SetStatus(captureError);
                return;
            }

            foreach (var pair in LocalObjectByKey)
            {
                var previous = pair.Value;
                if (previous == null || !previous.scene.IsValid() || !previous.scene.isLoaded)
                {
                    continue;
                }
                var parts = SplitKey(pair.Key);
                if (parts == null || !TryGetSceneId(previous.scene, out var currentSceneId))
                {
                    continue;
                }
                if (currentSceneId != parts.Item1)
                {
                    RevertUnsafeLocalChange(
                        "Cross-Scene GameObject moves are outside Phase 4 scope and were reverted.");
                    return;
                }
            }

            foreach (var sceneId in AuthoritativeSceneIds)
            {
                var previous = Authoritative.SceneSnapshot(sceneId);
                var current = currentByScene.TryGetValue(sceneId, out var value)
                    ? value
                    : new List<TeamForgeHierarchyState>();
                var previousById = ToDictionary(previous);
                var currentById = ToDictionary(current);

                // Delete a missing subtree root first. One server operation deletes the full subtree.
                foreach (var state in previous)
                {
                    if (currentById.ContainsKey(state.ObjectId))
                    {
                        continue;
                    }
                    if (!string.IsNullOrEmpty(state.ParentObjectId) && !currentById.ContainsKey(state.ParentObjectId))
                    {
                        continue;
                    }
                    if (UnsafePrefabKeys.Contains(Key(sceneId, state.ObjectId)))
                    {
                        RevertUnsafeLocalChange("Prefab instance Hierarchy deletion is outside Phase 4 MVP scope.");
                        return;
                    }
                    SendOperation(CreateOperation("delete_object", state, null));
                    return;
                }

                // Create parents before children so every destination parent already exists authoritatively.
                foreach (var state in current)
                {
                    if (previousById.ContainsKey(state.ObjectId))
                    {
                        continue;
                    }
                    if (!string.IsNullOrEmpty(state.ParentObjectId) && !previousById.ContainsKey(state.ParentObjectId))
                    {
                        continue;
                    }
                    if (!currentObjects.TryGetValue(Key(sceneId, state.ObjectId), out var target) || IsUnsafePrefabContext(target))
                    {
                        RevertUnsafeLocalChange("Prefab instance/Prefab Mode Hierarchy creation is outside Phase 4 MVP scope.");
                        return;
                    }
                    if (ParentLockedByOther(state.SceneId, state.ParentObjectId))
                    {
                        RevertUnsafeLocalChange("Create was reverted because the destination parent is locked by another editor.");
                        return;
                    }
                    SendOperation(CreateOperation("create_object", state, null));
                    return;
                }

                foreach (var currentState in current)
                {
                    if (!previousById.TryGetValue(currentState.ObjectId, out var previousState))
                    {
                        continue;
                    }
                    if (currentState.ParentObjectId != previousState.ParentObjectId)
                    {
                        if (!ValidateEditableTarget(currentObjects, currentState, out var editError) ||
                            ParentLockedByOther(currentState.SceneId, currentState.ParentObjectId))
                        {
                            RevertUnsafeLocalChange(editError ?? "Reparent was blocked by another editor's parent lock.");
                            return;
                        }
                        SendOperation(CreateOperation("reparent_object", currentState, previousState));
                        return;
                    }
                }

                foreach (var currentState in current)
                {
                    if (!previousById.TryGetValue(currentState.ObjectId, out var previousState))
                    {
                        continue;
                    }
                    if (currentState.Name != previousState.Name)
                    {
                        if (!ValidateEditableTarget(currentObjects, currentState, out var editError))
                        {
                            RevertUnsafeLocalChange(editError);
                            return;
                        }
                        SendOperation(CreateOperation("rename_object", currentState, previousState));
                        return;
                    }
                }

                foreach (var currentState in current)
                {
                    if (!previousById.TryGetValue(currentState.ObjectId, out var previousState))
                    {
                        continue;
                    }
                    if (currentState.SiblingIndex != previousState.SiblingIndex)
                    {
                        if (!ValidateEditableTarget(currentObjects, currentState, out var editError) ||
                            ParentLockedByOther(currentState.SceneId, currentState.ParentObjectId))
                        {
                            RevertUnsafeLocalChange(editError ?? "Sibling reorder was blocked by another editor's parent lock.");
                            return;
                        }
                        SendOperation(CreateOperation("reorder_sibling", currentState, previousState));
                        return;
                    }
                }
            }
        }

        private static HierarchyOperationMessage CreateOperation(
            string kind,
            TeamForgeHierarchyState current,
            TeamForgeHierarchyState previous)
        {
            var operationId = Guid.NewGuid().ToString("N");
            var requestId = Guid.NewGuid().ToString("N");
            var source = current ?? previous;
            var message = new HierarchyOperationMessage
            {
                type = "hierarchy_operation",
                protocolVersion = TeamForgeProtocol.Version,
                requestId = requestId,
                operationId = operationId,
                userId = TeamForgeConnectionService.Settings.UserId,
                kind = kind,
                sceneId = source.SceneId,
                objectId = source.ObjectId,
                baseRevision = Authority.SessionRevision,
                name = current?.Name ?? string.Empty,
                parentObjectId = current?.ParentObjectId ?? string.Empty,
                siblingIndex = current?.SiblingIndex ?? 0,
            };
            if (kind == "create_object" || kind == "reparent_object")
            {
                var transform = current.Transform;
                message.localPosition = transform.PositionDto();
                message.localRotation = transform.RotationDto();
                message.localScale = transform.ScaleDto();
            }
            return message;
        }

        private static void SendOperation(HierarchyOperationMessage message)
        {
            if (message == null || _pendingOperation != null)
            {
                return;
            }
            var pending = new TeamForgePendingHierarchyOperation(
                message.operationId,
                message.requestId,
                message.sceneId,
                message.objectId,
                message.kind);
            _pendingOperation = pending;
            PendingByRequestId[message.requestId] = pending;
            if (!TeamForgeConnectionService.SendHierarchy(message, "Hierarchy operation"))
            {
                PendingByRequestId.Remove(message.requestId);
                _pendingOperation = null;
                SetStatus("Hierarchy operation could not be sent; local change remains pending review.");
                return;
            }
            SetStatus($"Waiting for authoritative {message.kind} acknowledgement.");
            RaiseChanged();
        }

        private static bool ValidateEditableTarget(
            Dictionary<string, GameObject> currentObjects,
            TeamForgeHierarchyState state,
            out string error)
        {
            error = string.Empty;
            if (!currentObjects.TryGetValue(Key(state.SceneId, state.ObjectId), out var target) || target == null)
            {
                error = "Hierarchy target is not loaded.";
                return false;
            }
            if (IsUnsafePrefabContext(target))
            {
                error = "Prefab instance/Prefab Mode Hierarchy editing is outside Phase 4 MVP scope.";
                return false;
            }
            if (Authority.Locks.TryGet(state.SceneId, state.ObjectId, out var lockState) &&
                lockState.ownerConnectionId != Authority.ConnectionId)
            {
                error = $"Hierarchy edit is locked by {lockState.ownerDisplayName}.";
                return false;
            }
            return true;
        }

        private static bool ParentLockedByOther(string sceneId, string parentObjectId)
        {
            return !string.IsNullOrWhiteSpace(parentObjectId) &&
                   Authority.Locks.TryGet(sceneId, parentObjectId, out var lockState) &&
                   lockState.ownerConnectionId != Authority.ConnectionId;
        }

        private static void RevertUnsafeLocalChange(string reason)
        {
            _conflictCount += 1;
            try
            {
                _suppressLocalChanges = true;
                using (TeamForgeRemoteApplyScope.Enter())
                {
                    Undo.PerformUndo();
                }
                SetStatus(reason);
            }
            finally
            {
                _suppressLocalChanges = false;
                _scanScheduled = true;
            }
        }

        private static bool TryCaptureAllLoadedScenes(
            bool seedMode,
            out Dictionary<string, List<TeamForgeHierarchyState>> byScene,
            out Dictionary<string, GameObject> objects,
            out string error)
        {
            byScene = new Dictionary<string, List<TeamForgeHierarchyState>>(StringComparer.Ordinal);
            objects = new Dictionary<string, GameObject>(StringComparer.Ordinal);
            for (var index = 0; index < SceneManager.sceneCount; index += 1)
            {
                var scene = SceneManager.GetSceneAt(index);
                if (!scene.IsValid() || !scene.isLoaded || string.IsNullOrWhiteSpace(scene.path))
                {
                    continue;
                }
                if (!TryCaptureScene(scene, seedMode, out var states, out var localObjects, out error))
                {
                    return false;
                }
                if (!TryGetSceneId(scene, out var sceneId))
                {
                    error = "Loaded Scene GUID could not be resolved.";
                    return false;
                }
                byScene[sceneId] = states;
                foreach (var pair in localObjects)
                {
                    objects[pair.Key] = pair.Value;
                }
            }
            error = string.Empty;
            return true;
        }

        private static bool TryCaptureScene(
            Scene scene,
            bool seedMode,
            out List<TeamForgeHierarchyState> states,
            out Dictionary<string, GameObject> localObjects,
            out string error)
        {
            states = new List<TeamForgeHierarchyState>();
            localObjects = new Dictionary<string, GameObject>(StringComparer.Ordinal);
            if (!TryGetSceneId(scene, out var sceneId))
            {
                error = "Scene must be loaded and saved before Hierarchy Sync can identify it.";
                return false;
            }

            var gameObjects = new List<GameObject>();
            foreach (var root in scene.GetRootGameObjects())
            {
                foreach (var transform in root.GetComponentsInChildren<Transform>(true))
                {
                    if (PrefabStageUtility.GetPrefabStage(transform.gameObject) == null)
                    {
                        gameObjects.Add(transform.gameObject);
                    }
                }
            }

            var idsByInstance = new Dictionary<int, string>();
            foreach (var gameObject in gameObjects)
            {
                string objectId;
                if (seedMode)
                {
                    if (!TeamForgeObjectIdentity.TryGetGlobalObjectId(gameObject, out objectId))
                    {
                        error = $"Saved baseline object '{gameObject.name}' has no stable GlobalObjectId.";
                        return false;
                    }
                }
                else if (TeamForgeObjectIdentity.TryGetGlobalObjectId(gameObject, out var globalObjectId) &&
                         Authoritative.Contains(sceneId, globalObjectId))
                {
                    objectId = globalObjectId;
                }
                else if (TeamForgeHierarchyIdentityRegistry.TryGetSessionLogicalId(gameObject, out var logicalId))
                {
                    objectId = logicalId;
                }
                else
                {
                    objectId = TeamForgeHierarchyIdentityRegistry.GetOrCreateLogicalId(gameObject);
                }
                idsByInstance[gameObject.GetInstanceID()] = objectId;
            }

            foreach (var gameObject in gameObjects)
            {
                var objectId = idsByInstance[gameObject.GetInstanceID()];
                var parent = gameObject.transform.parent;
                var parentObjectId = string.Empty;
                if (parent != null && !idsByInstance.TryGetValue(parent.gameObject.GetInstanceID(), out parentObjectId))
                {
                    error = $"Parent identity for '{gameObject.name}' could not be resolved.";
                    return false;
                }
                var state = new TeamForgeHierarchyState
                {
                    SceneId = sceneId,
                    ObjectId = objectId,
                    Name = gameObject.name,
                    ParentObjectId = parentObjectId ?? string.Empty,
                    SiblingIndex = gameObject.transform.GetSiblingIndex(),
                    Transform = TeamForgeTransformState.Capture(gameObject.transform),
                    CreatedRevision = 0,
                    HierarchyRevision = Authority.SessionRevision,
                };
                states.Add(state);
                var key = Key(sceneId, objectId);
                localObjects[key] = gameObject;
                if (IsUnsafePrefabContext(gameObject))
                {
                    UnsafePrefabKeys.Add(key);
                }
                else
                {
                    UnsafePrefabKeys.Remove(key);
                }
            }

            states.Sort(CompareHierarchyStates);
            error = string.Empty;
            return true;
        }

        private static void TrySeedMissingCleanScenes()
        {
            if (!_wasConnected || !_receivedSnapshot || PendingSeeds.Count >= MaximumPendingSeedRequests)
            {
                return;
            }

            for (var index = 0; index < SceneManager.sceneCount; index += 1)
            {
                var scene = SceneManager.GetSceneAt(index);
                if (!scene.IsValid() || !scene.isLoaded || string.IsNullOrWhiteSpace(scene.path) || scene.isDirty ||
                    !TryGetSceneId(scene, out var sceneId) || AuthoritativeSceneIds.Contains(sceneId) ||
                    SeedRequestExists(sceneId))
                {
                    continue;
                }
                if (!TryCaptureScene(scene, true, out var states, out var objects, out var error))
                {
                    TeamForgeDiagnostics.Warning($"Hierarchy baseline seed skipped for '{scene.name}': {error}");
                    continue;
                }
                var requestId = Guid.NewGuid().ToString("N");
                var message = new HierarchySeedMessage
                {
                    type = "hierarchy_seed",
                    protocolVersion = TeamForgeProtocol.Version,
                    requestId = requestId,
                    userId = TeamForgeConnectionService.Settings.UserId,
                    sceneId = sceneId,
                    baseRevision = Authority.SessionRevision,
                    objects = states.ConvertAll(state => state.ToRecord()).ToArray(),
                };
                if (!TeamForgeConnectionService.SendHierarchy(message, "Hierarchy baseline seed"))
                {
                    return;
                }
                PendingSeeds[requestId] = new SeedRequest(sceneId, states, objects);
                SetStatus($"Seeding clean Hierarchy baseline for '{scene.name}'.");
            }
        }

        private static bool SeedRequestExists(string sceneId)
        {
            foreach (var pending in PendingSeeds.Values)
            {
                if (pending.SceneId == sceneId)
                {
                    return true;
                }
            }
            return false;
        }

        private static bool PrepareInitialSnapshot(
            List<TeamForgeHierarchyState> states,
            TeamForgeHierarchyTombstoneRecord[] tombstones,
            IEnumerable<string> authoritativeSceneIds,
            out string error)
        {
            // A server tombstone is authoritative even if this Editor was offline long enough to
            // dirty the stale local object. Apply only tombstone deletes before the dirty-scene
            // safety gate; live objects are still protected from silent overwrite below.
            _suppressLocalChanges = true;
            try
            {
                using (TeamForgeRemoteApplyScope.Enter())
                {
                    if (!TryApplyAuthoritativeTombstones(tombstones, out error))
                    {
                        return false;
                    }
                }
            }
            finally
            {
                _suppressLocalChanges = false;
            }
            TeamForgeHierarchyIdentityRegistry.RefreshAndPersist();
            return CanApplyInitialSnapshot(states, tombstones, authoritativeSceneIds, out error);
        }

        private static bool CanApplyInitialSnapshot(
            List<TeamForgeHierarchyState> states,
            TeamForgeHierarchyTombstoneRecord[] tombstones,
            IEnumerable<string> authoritativeSceneIds,
            out string error)
        {
            var scenes = new HashSet<string>(authoritativeSceneIds ?? Array.Empty<string>(), StringComparer.Ordinal);
            foreach (var state in states) scenes.Add(state.SceneId);
            foreach (var tombstone in tombstones) scenes.Add(tombstone.sceneId);
            foreach (var sceneId in scenes)
            {
                if (!TryFindLoadedScene(sceneId, out var scene))
                {
                    continue;
                }
                if (scene.isDirty && !DirtySceneHierarchyMatchesAuthoritative(scene, sceneId, states, out error))
                {
                    return false;
                }

                var authoritativeIds = new HashSet<string>(StringComparer.Ordinal);
                foreach (var state in states)
                {
                    if (state.SceneId == sceneId) authoritativeIds.Add(state.ObjectId);
                }
                foreach (var tombstone in tombstones)
                {
                    if (tombstone.sceneId == sceneId) authoritativeIds.Add(tombstone.objectId);
                }

                foreach (var root in scene.GetRootGameObjects())
                {
                    foreach (var transform in root.GetComponentsInChildren<Transform>(true))
                    {
                        var target = transform.gameObject;
                        if (PrefabStageUtility.GetPrefabStage(target) != null)
                        {
                            continue;
                        }
                        if (TeamForgeHierarchyIdentityRegistry.TryGetLogicalId(target, out var logicalId) &&
                            authoritativeIds.Contains(logicalId))
                        {
                            continue;
                        }
                        if (TeamForgeObjectIdentity.TryGetGlobalObjectId(target, out var globalObjectId) &&
                            authoritativeIds.Contains(globalObjectId))
                        {
                            continue;
                        }

                        error =
                            $"Scene '{scene.name}' contains clean local object '{target.name}' that is not in the authoritative " +
                            "Hierarchy snapshot. TeamForge will not guess identity or duplicate the object; open the matching " +
                            "Project baseline or start a new Hierarchy session.";
                        return false;
                    }
                }
            }
            error = string.Empty;
            return true;
        }

        private static bool DirtySceneHierarchyMatchesAuthoritative(
            Scene scene,
            string sceneId,
            List<TeamForgeHierarchyState> states,
            out string error)
        {
            var authoritativeById = new Dictionary<string, TeamForgeHierarchyState>(StringComparer.Ordinal);
            foreach (var state in states)
            {
                if (state.SceneId == sceneId)
                {
                    authoritativeById[state.ObjectId] = state;
                }
            }

            var localById = new Dictionary<string, GameObject>(StringComparer.Ordinal);
            foreach (var root in scene.GetRootGameObjects())
            {
                foreach (var transform in root.GetComponentsInChildren<Transform>(true))
                {
                    var target = transform.gameObject;
                    if (PrefabStageUtility.GetPrefabStage(target) != null)
                    {
                        continue;
                    }

                    string objectId = null;
                    if (TeamForgeHierarchyIdentityRegistry.TryGetLogicalId(target, out var logicalId) &&
                        authoritativeById.ContainsKey(logicalId))
                    {
                        objectId = logicalId;
                    }
                    else if (TeamForgeObjectIdentity.TryGetGlobalObjectId(target, out var globalObjectId) &&
                             authoritativeById.ContainsKey(globalObjectId))
                    {
                        objectId = globalObjectId;
                    }

                    if (string.IsNullOrEmpty(objectId))
                    {
                        error =
                            $"Scene '{scene.name}' contains unsaved local object '{target.name}' that is not in the " +
                            "authoritative Hierarchy snapshot. Save/revert and reconnect; TeamForge will not overwrite it silently.";
                        return false;
                    }
                    if (!localById.TryAdd(objectId, target))
                    {
                        error = $"Scene '{scene.name}' contains duplicate local identity {ShortId(objectId)}.";
                        return false;
                    }
                }
            }

            if (localById.Count != authoritativeById.Count)
            {
                error =
                    $"Scene '{scene.name}' has unsaved local Hierarchy changes that do not match the authoritative snapshot. " +
                    "Save/revert and reconnect; TeamForge will not recreate or overwrite live objects silently.";
                return false;
            }

            foreach (var pair in authoritativeById)
            {
                var state = pair.Value;
                if (!localById.TryGetValue(pair.Key, out var target) || target == null)
                {
                    error =
                        $"Scene '{scene.name}' is missing authoritative live object {ShortId(pair.Key)} while it has unsaved changes. " +
                        "Save/revert and reconnect before continuing.";
                    return false;
                }

                var localParentId = string.Empty;
                if (target.transform.parent != null)
                {
                    var parent = target.transform.parent.gameObject;
                    foreach (var localPair in localById)
                    {
                        if (localPair.Value == parent)
                        {
                            localParentId = localPair.Key;
                            break;
                        }
                    }
                    if (string.IsNullOrEmpty(localParentId))
                    {
                        error = $"Scene '{scene.name}' has an unresolved local parent for '{target.name}'.";
                        return false;
                    }
                }

                var currentTransform = TeamForgeTransformState.Capture(target.transform);
                if (target.name != state.Name ||
                    localParentId != state.ParentObjectId ||
                    target.transform.GetSiblingIndex() != state.SiblingIndex ||
                    currentTransform == null ||
                    !currentTransform.ApproximatelyEquals(state.Transform ?? new TeamForgeTransformState()))
                {
                    error =
                        $"Scene '{scene.name}' has unsaved Hierarchy/Transform changes on live object '{target.name}'. " +
                        "Only authoritative tombstone cleanup can bypass the dirty-scene guard; save/revert other live edits and reconnect.";
                    return false;
                }
            }

            error = string.Empty;
            return true;
        }

        private static bool TryApplyAuthoritativeTombstones(
            TeamForgeHierarchyTombstoneRecord[] tombstones,
            out string error)
        {
            foreach (var tombstone in tombstones ?? Array.Empty<TeamForgeHierarchyTombstoneRecord>())
            {
                if (!TeamForgeObjectIdentity.TryResolveGameObject(tombstone.objectId, out var target))
                {
                    continue;
                }
                if (!TryGetSceneId(target.scene, out var actualSceneId) || actualSceneId != tombstone.sceneId)
                {
                    error = "Tombstone target Scene identity does not match the authoritative snapshot.";
                    return false;
                }
                ClearLocalUndo(target);
                UnityEngine.Object.DestroyImmediate(target);
                TeamForgeHierarchyIdentityRegistry.ForgetLiveObject(tombstone.objectId);
            }
            error = string.Empty;
            return true;
        }

        private static bool ApplyAuthoritativeSnapshot(
            List<TeamForgeHierarchyState> states,
            TeamForgeHierarchyTombstoneRecord[] tombstones,
            bool initial,
            out string error)
        {
            _suppressLocalChanges = true;
            try
            {
                using (TeamForgeRemoteApplyScope.Enter())
                {
                    if (!TryApplyAuthoritativeTombstones(tombstones, out error))
                    {
                        return false;
                    }

                    var remaining = new List<TeamForgeHierarchyState>(states);
                    var appliedIds = new HashSet<string>(StringComparer.Ordinal);
                    var guard = remaining.Count + 1;
                    while (remaining.Count > 0 && guard-- > 0)
                    {
                        var progress = false;
                        for (var index = remaining.Count - 1; index >= 0; index -= 1)
                        {
                            var state = remaining[index];
                            if (!string.IsNullOrEmpty(state.ParentObjectId) &&
                                !appliedIds.Contains(Key(state.SceneId, state.ParentObjectId)) &&
                                !TeamForgeObjectIdentity.TryResolveGameObject(state.ParentObjectId, out _))
                            {
                                continue;
                            }
                            if (!EnsureAndApplyObject(state, out var target, out error, true))
                            {
                                return false;
                            }
                            LocalObjectByKey[Key(state.SceneId, state.ObjectId)] = target;
                            appliedIds.Add(Key(state.SceneId, state.ObjectId));
                            remaining.RemoveAt(index);
                            progress = true;
                        }
                        if (!progress)
                        {
                            error = "Hierarchy snapshot parent ordering could not be materialized safely.";
                            return false;
                        }
                    }
                }
            }
            finally
            {
                _suppressLocalChanges = false;
            }
            TeamForgeHierarchyIdentityRegistry.RefreshAndPersist();
            error = string.Empty;
            return true;
        }

        private static bool ApplyRemoteAppliedMessage(
            HierarchyAppliedMessage message,
            List<TeamForgeHierarchyState> changed,
            out string error)
        {
            _suppressLocalChanges = true;
            try
            {
                using (TeamForgeRemoteApplyScope.Enter())
                {
                    foreach (var deletedObjectId in message.deletedObjectIds)
                    {
                        if (!TeamForgeObjectIdentity.TryResolveGameObject(deletedObjectId, out var target))
                        {
                            continue;
                        }
                        if (!TryGetSceneId(target.scene, out var actualSceneId) || actualSceneId != message.sceneId)
                        {
                            error = "Remote delete target changed Scene ownership locally.";
                            return false;
                        }
                        if (IsUnsafePrefabContext(target))
                        {
                            error = "Remote Prefab instance hierarchy deletion was blocked by the Phase 4 safety policy.";
                            return false;
                        }
                        ClearLocalUndo(target);
                        UnityEngine.Object.DestroyImmediate(target);
                    }

                    foreach (var state in changed)
                    {
                        var applyTransform =
                            (message.kind == "create_object" || message.kind == "reparent_object") &&
                            state.ObjectId == message.objectId;
                        if (!EnsureAndApplyObject(state, out var target, out error, applyTransform))
                        {
                            return false;
                        }
                        LocalObjectByKey[Key(state.SceneId, state.ObjectId)] = target;
                    }
                }
            }
            finally
            {
                _suppressLocalChanges = false;
            }
            TeamForgeHierarchyIdentityRegistry.RefreshAndPersist();
            error = string.Empty;
            return true;
        }

        private static bool EnsureAndApplyObject(
            TeamForgeHierarchyState state,
            out GameObject target,
            out string error,
            bool applyTransform)
        {
            target = null;
            error = string.Empty;
            if (!TryFindLoadedScene(state.SceneId, out var scene))
            {
                error = $"Authoritative Scene {ShortId(state.SceneId)} is not loaded.";
                return false;
            }

            if (!TeamForgeObjectIdentity.TryResolveGameObject(state.ObjectId, out target))
            {
                if (!TeamForgeHierarchyIdentityRegistry.IsLogicalId(state.ObjectId))
                {
                    error = $"Saved baseline object {ShortId(state.ObjectId)} is missing locally; refusing to fabricate a GlobalObjectId.";
                    return false;
                }
                target = new GameObject(state.Name);
                SceneManager.MoveGameObjectToScene(target, scene);
                TeamForgeHierarchyIdentityRegistry.BindLogical(state.ObjectId, target);
            }
            if (!TryGetSceneId(target.scene, out var actualSceneId) || actualSceneId != state.SceneId)
            {
                error = "Authoritative object is loaded in a different Scene; cross-Scene movement is outside Phase 4 scope.";
                return false;
            }

            Transform parentTransform = null;
            if (!string.IsNullOrEmpty(state.ParentObjectId))
            {
                if (!TeamForgeObjectIdentity.TryResolveGameObject(state.ParentObjectId, out var parent) || parent == null)
                {
                    error = $"Authoritative parent {ShortId(state.ParentObjectId)} is not loaded.";
                    return false;
                }
                if (parent == target || parent.transform.IsChildOf(target.transform))
                {
                    error = "Authoritative parent would create a local Hierarchy cycle.";
                    return false;
                }
                parentTransform = parent.transform;
            }

            var transformState = state.Transform ?? new TeamForgeTransformState();
            var capturedTransform = TeamForgeTransformState.Capture(target.transform);
            var transformChanged =
                applyTransform &&
                capturedTransform != null &&
                !capturedTransform.ApproximatelyEquals(transformState);
            var nameChanged = target.name != state.Name;
            var parentChanged = target.transform.parent != parentTransform;
            var siblingChanged = target.transform.GetSiblingIndex() != state.SiblingIndex;
            var changed = nameChanged || parentChanged || siblingChanged || transformChanged;
            if (!changed)
            {
                if (TeamForgeHierarchyIdentityRegistry.IsLogicalId(state.ObjectId))
                {
                    TeamForgeHierarchyIdentityRegistry.BindLogical(state.ObjectId, target);
                }
                return true;
            }

            ClearLocalUndo(target);
            if (nameChanged)
            {
                target.name = state.Name;
            }
            if (parentChanged)
            {
                target.transform.SetParent(parentTransform, false);
            }
            if (applyTransform)
            {
                target.transform.localPosition = transformState.LocalPosition;
                target.transform.localRotation = transformState.LocalRotation;
                target.transform.localScale = transformState.LocalScale;
            }
            if (siblingChanged)
            {
                target.transform.SetSiblingIndex(Mathf.Max(0, state.SiblingIndex));
            }
            if (PrefabUtility.IsPartOfPrefabInstance(target) &&
                (parentChanged || siblingChanged || transformChanged))
            {
                PrefabUtility.RecordPrefabInstancePropertyModifications(target.transform);
            }
            EditorSceneManager.MarkSceneDirty(scene);
            if (TeamForgeHierarchyIdentityRegistry.IsLogicalId(state.ObjectId))
            {
                TeamForgeHierarchyIdentityRegistry.BindLogical(state.ObjectId, target);
            }
            return true;
        }

        private static void RebuildLocalReferenceIndex(IEnumerable<TeamForgeHierarchyState> states)
        {
            LocalObjectByKey.Clear();
            UnsafePrefabKeys.Clear();
            foreach (var state in states)
            {
                if (TeamForgeObjectIdentity.TryResolveGameObject(state.ObjectId, out var target))
                {
                    var key = Key(state.SceneId, state.ObjectId);
                    LocalObjectByKey[key] = target;
                    if (IsUnsafePrefabContext(target))
                    {
                        UnsafePrefabKeys.Add(key);
                    }
                }
            }
        }

        private static bool ValidateParentGraph(List<TeamForgeHierarchyState> states, out string error)
        {
            var byKey = new Dictionary<string, TeamForgeHierarchyState>(StringComparer.Ordinal);
            foreach (var state in states)
            {
                byKey[Key(state.SceneId, state.ObjectId)] = state;
            }
            foreach (var state in states)
            {
                var seen = new HashSet<string>(StringComparer.Ordinal) { state.ObjectId };
                var parentObjectId = state.ParentObjectId;
                var depth = 0;
                while (!string.IsNullOrEmpty(parentObjectId))
                {
                    depth += 1;
                    if (depth > 256)
                    {
                        error = "Hierarchy snapshot exceeds the supported parent depth.";
                        return false;
                    }
                    if (!seen.Add(parentObjectId))
                    {
                        error = "Hierarchy snapshot contains a parent cycle.";
                        return false;
                    }
                    if (!byKey.TryGetValue(Key(state.SceneId, parentObjectId), out var parent))
                    {
                        error = "Hierarchy snapshot references a missing parent.";
                        return false;
                    }
                    parentObjectId = parent.ParentObjectId;
                }
            }
            error = string.Empty;
            return true;
        }

        private static Dictionary<string, TeamForgeHierarchyState> ToDictionary(IEnumerable<TeamForgeHierarchyState> states)
        {
            var result = new Dictionary<string, TeamForgeHierarchyState>(StringComparer.Ordinal);
            foreach (var state in states)
            {
                result[state.ObjectId] = state;
            }
            return result;
        }

        private static bool TryGetSceneId(Scene scene, out string sceneId)
        {
            sceneId = string.Empty;
            if (!scene.IsValid() || !scene.isLoaded || string.IsNullOrWhiteSpace(scene.path))
            {
                return false;
            }
            sceneId = AssetDatabase.AssetPathToGUID(scene.path);
            return !string.IsNullOrWhiteSpace(sceneId);
        }

        private static bool TryFindLoadedScene(string sceneId, out Scene scene)
        {
            for (var index = 0; index < SceneManager.sceneCount; index += 1)
            {
                var candidate = SceneManager.GetSceneAt(index);
                if (TryGetSceneId(candidate, out var candidateId) && candidateId == sceneId)
                {
                    scene = candidate;
                    return true;
                }
            }
            scene = default;
            return false;
        }

        private static bool IsUnsafePrefabContext(GameObject target)
        {
            return target != null &&
                   (PrefabStageUtility.GetPrefabStage(target) != null || PrefabUtility.IsPartOfPrefabInstance(target));
        }

        private static void ClearLocalUndo(GameObject target)
        {
            if (target == null)
            {
                return;
            }
            Undo.ClearUndo(target.transform);
            Undo.ClearUndo(target);
        }

        private static void RejectSnapshot(string error)
        {
            _conflictCount += 1;
            SetStatus($"Hierarchy snapshot rejected: {error}");
            TeamForgeDiagnostics.Warning($"Hierarchy snapshot rejected: {error}");
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
                if (char.IsControl(character)) return false;
            }
            return true;
        }

        private static string Key(string sceneId, string objectId)
        {
            return (sceneId ?? string.Empty) + "\n" + (objectId ?? string.Empty);
        }

        private static Tuple<string, string> SplitKey(string key)
        {
            var index = key?.IndexOf('\n') ?? -1;
            return index < 0 ? null : Tuple.Create(key.Substring(0, index), key.Substring(index + 1));
        }

        private static int CompareHierarchyStates(TeamForgeHierarchyState left, TeamForgeHierarchyState right)
        {
            var parent = string.CompareOrdinal(left.ParentObjectId, right.ParentObjectId);
            if (parent != 0) return parent;
            var sibling = left.SiblingIndex.CompareTo(right.SiblingIndex);
            return sibling != 0 ? sibling : string.CompareOrdinal(left.ObjectId, right.ObjectId);
        }

        private static string ShortId(string value)
        {
            if (string.IsNullOrWhiteSpace(value) || value.Length <= 16)
            {
                return value ?? string.Empty;
            }
            return value.Substring(0, 8) + "…" + value.Substring(value.Length - 8);
        }

        private static void SetStatus(string status)
        {
            if (_status == status)
            {
                return;
            }
            _status = status;
            RaiseChanged();
        }

        private static void RaiseChanged()
        {
            Changed?.Invoke();
        }

        private sealed class SeedRequest
        {
            public SeedRequest(
                string sceneId,
                List<TeamForgeHierarchyState> states,
                Dictionary<string, GameObject> localObjects)
            {
                SceneId = sceneId;
                States = states;
                LocalObjects = new Dictionary<string, GameObject>(StringComparer.Ordinal);
                foreach (var state in states)
                {
                    var key = Key(sceneId, state.ObjectId);
                    if (localObjects.TryGetValue(key, out var target))
                    {
                        LocalObjects[state.ObjectId] = target;
                    }
                }
            }

            public string SceneId { get; }
            public List<TeamForgeHierarchyState> States { get; }
            public Dictionary<string, GameObject> LocalObjects { get; }
        }
    }
}

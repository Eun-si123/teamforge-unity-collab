using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace EunSung.TeamForge
{
    [InitializeOnLoad]
    public static class TeamForgeTransformSyncService
    {
        private const int MaximumRememberedOperations = 2048;
        private const int MaximumPendingLocalOperations = 64;
        private const double IdentityValidationIntervalSeconds = 0.5;
        private const string BaselineSessionStateKey = "EunSung.TeamForge.TransformBaseline.v1";

        private static readonly HashSet<string> AppliedOperationIds =
            new HashSet<string>(StringComparer.Ordinal);
        private static readonly Queue<string> AppliedOperationOrder = new Queue<string>();
        private static readonly HashSet<string> PendingLocalOperations =
            new HashSet<string>(StringComparer.Ordinal);
        private static readonly Dictionary<string, PendingTransformOperation> PendingOperationByRequestId =
            new Dictionary<string, PendingTransformOperation>(StringComparer.Ordinal);
        private static readonly Dictionary<string, long> LatestObjectRevisions =
            new Dictionary<string, long>(StringComparer.Ordinal);
        private static readonly HashSet<string> ProtectedConflictKeys =
            new HashSet<string>(StringComparer.Ordinal);
        private static readonly TeamForgeTransformConflictRecoveryRegistry RecoverableTransformConflicts =
            new TeamForgeTransformConflictRecoveryRegistry();
        private static readonly HashSet<string> HierarchyBlockedKeys =
            new HashSet<string>(StringComparer.Ordinal);
        private static readonly TeamForgeObjectBaselineRegistry Baseline =
            new TeamForgeObjectBaselineRegistry();
        private static IAuthorityView Authority => TeamForgeAuthorityView.Current;

        private static GameObject _selectedObject;
        private static string _selectedSceneId = string.Empty;
        private static string _selectedObjectId = string.Empty;
        private static string _selectedParentObjectId = string.Empty;
        private static string _pendingLockRequestId = string.Empty;
        private static TeamForgeTransformState _lastObservedState;
        private static TeamForgeTransformState _lastConfirmedState;
        private static TeamForgeTransformState _stateAtLockRequest;
        private static bool _selectedLockGranted;
        private static bool _wasConnected;
        private static bool _dirty;
        private static bool _syncBlocked;
        private static int _selectionLockSuppressionDepth;
        private static GameObject _hierarchyRecoveryObject;
        private static string _hierarchyRecoverySceneId = string.Empty;
        private static string _hierarchyRecoveryObjectId = string.Empty;
        private static string _hierarchyRecoveryParentObjectId = string.Empty;
        private static TeamForgeTransformState _hierarchyRecoveryObservedState;
        private static TeamForgeTransformState _hierarchyRecoveryConfirmedState;
        private static TeamForgeTransformState _hierarchyRecoveryLockRequestState;
        private static double _nextTransformSendAt;
        private static double _nextLockRenewalAt;
        private static double _selectedLockExpiresAt;
        private static double _nextIdentityValidationAt;
        private static string _selectedLockStatus = "Offline";

        static TeamForgeTransformSyncService()
        {
            RestoreBaseline();
            TeamForgeAuthorityView.Changed += RaiseChanged;
            TeamForgeConnectionService.Changed += OnConnectionChanged;
            TeamForgeConnectionService.Disconnecting += OnDisconnecting;
            TeamForgeConnectionService.TransformMessageReceived += OnTransformMessageReceived;
            TeamForgeConnectionService.ProtocolErrorReceived += OnProtocolErrorReceived;
            Selection.selectionChanged += OnSelectionChanged;
            EditorApplication.hierarchyChanged += OnHierarchyChanged;
            EditorSceneManager.activeSceneChangedInEditMode += (_, __) => OnSelectionChanged();
            EditorSceneManager.sceneOpened += OnSceneOpened;
            EditorSceneManager.sceneSaved += _ => OnSelectionChanged();
            EditorApplication.playModeStateChanged += _ => OnSelectionChanged();
            Undo.postprocessModifications += OnPostprocessModifications;
            Undo.undoRedoPerformed += OnUndoRedo;
            AssemblyReloadEvents.beforeAssemblyReload += PersistBaseline;
            EditorApplication.update += Update;
        }

        public static event Action Changed;

        public static TeamForgeLockRegistry Locks => Authority.Locks;
        public static long CurrentRevision => Authority.SessionRevision;
        public static int SnapshotConflictCount { get; private set; }
        public static string SelectedObjectId => _selectedObjectId;
        public static string SelectedLockStatus => _selectedLockStatus;
        public static bool SelectedObjectBlocked => _syncBlocked;
        internal static GameObject TrackedObject => _selectedObject;
        internal static TeamForgeObjectBaselineRegistry SelectionBaseline => Baseline;

        internal static void ObserveAuthoritativeRevision(long revision)
        {
            TeamForgeAuthorityView.ObserveRevision(revision);
        }

        internal static void ApplyHierarchyAuthoritativeState(
            IEnumerable<TeamForgeHierarchyState> changedObjects,
            string sceneId,
            IEnumerable<string> deletedObjectIds)
        {
            TeamForgeHierarchyState selectedAuthoritativeState = null;
            var activeSelection = Selection.activeGameObject;
            var activeObjectId = string.Empty;
            var activeSceneId = string.Empty;
            var canMatchActiveSelection =
                _selectedObject == null &&
                activeSelection != null &&
                Selection.gameObjects != null &&
                Selection.gameObjects.Length == 1 &&
                TryGetSceneId(activeSelection, out activeSceneId);

            if (changedObjects != null)
            {
                foreach (var state in changedObjects)
                {
                    if (state == null)
                    {
                        continue;
                    }
                    Baseline.Upsert(state.SceneId, state.ObjectId, state.ParentObjectId);
                    HierarchyBlockedKeys.Remove(ObjectKey(state.SceneId, state.ObjectId));
                    if (state.SceneId == _selectedSceneId && state.ObjectId == _selectedObjectId)
                    {
                        _selectedParentObjectId = state.ParentObjectId;
                        _syncBlocked = false;
                    }
                    else if (canMatchActiveSelection &&
                             state.SceneId == activeSceneId &&
                             Baseline.TryGetCanonicalObjectId(
                                 activeSceneId,
                                 activeSelection,
                                 out activeObjectId) &&
                             MatchesAuthoritativeSelection(activeSceneId, activeObjectId, state))
                    {
                        selectedAuthoritativeState = state;
                    }
                }
            }
            if (deletedObjectIds != null)
            {
                foreach (var objectId in deletedObjectIds)
                {
                    Baseline.Remove(sceneId, objectId);
                    HierarchyBlockedKeys.Remove(ObjectKey(sceneId, objectId));
                    ProtectedConflictKeys.Remove(ObjectKey(sceneId, objectId));
                    RecoverableTransformConflicts.Remove(sceneId, objectId);
                    LatestObjectRevisions.Remove(ObjectKey(sceneId, objectId));
                }
            }
            PersistBaseline();

            // A freshly-created object is selected by Unity before its create_object operation
            // is acknowledged. The initial selection callback therefore sees no Transform
            // baseline entry and intentionally refuses to track it. Once Hierarchy authority
            // accepts that same object, retry selection tracking immediately. If the user
            // moved it while create_object was in flight, retain the server-approved create
            // transform as the last confirmed value so the post-lock delta is sent instead
            // of being silently adopted as a new local baseline.
            if (selectedAuthoritativeState != null &&
                _selectedObject == null &&
                Selection.activeGameObject == activeSelection)
            {
                BeginTrackingSelection(_wasConnected);
                if (_selectedObject == activeSelection && selectedAuthoritativeState.Transform != null)
                {
                    var authoritativeTransform = selectedAuthoritativeState.Transform.Clone();
                    var currentTransform = TeamForgeTransformState.Capture(activeSelection.transform);
                    if (currentTransform != null &&
                        !authoritativeTransform.ApproximatelyEquals(currentTransform))
                    {
                        _lastObservedState = authoritativeTransform.Clone();
                        _lastConfirmedState = authoritativeTransform.Clone();
                        _stateAtLockRequest = authoritativeTransform.Clone();
                        _dirty = true;
                    }
                }
            }
        }

        internal static void CompleteHierarchyReconciliation(string sceneId, string objectId)
        {
            if (string.IsNullOrWhiteSpace(sceneId) || string.IsNullOrWhiteSpace(objectId))
            {
                return;
            }

            if (_selectedObject != null &&
                _selectedSceneId == sceneId &&
                _selectedObjectId == objectId &&
                Baseline.TryGetCanonicalParentObjectId(
                    sceneId,
                    _selectedObject,
                    out var trackedParentObjectId) &&
                Baseline.MatchesParent(sceneId, objectId, trackedParentObjectId))
            {
                HierarchyBlockedKeys.Remove(ObjectKey(sceneId, objectId));
                _selectedParentObjectId = trackedParentObjectId;
                _syncBlocked = false;
                _nextIdentityValidationAt = 0;
                ValidateTrackedTargetOrSuspend();
                ClearHierarchyRecovery(sceneId, objectId);
                return;
            }

            var activeSelection = Selection.activeGameObject;
            if (activeSelection == null ||
                Selection.gameObjects == null ||
                Selection.gameObjects.Length != 1 ||
                !TryGetSceneId(activeSelection, out var activeSceneId) ||
                activeSceneId != sceneId ||
                !Baseline.TryGetCanonicalObjectId(sceneId, activeSelection, out var activeObjectId) ||
                activeObjectId != objectId ||
                !Baseline.TryGetCanonicalParentObjectId(sceneId, activeSelection, out var activeParentObjectId) ||
                !Baseline.MatchesParent(sceneId, objectId, activeParentObjectId))
            {
                ClearHierarchyRecovery(sceneId, objectId);
                return;
            }

            HierarchyBlockedKeys.Remove(ObjectKey(sceneId, objectId));
            BeginTrackingSelection(_wasConnected);
            ClearHierarchyRecovery(sceneId, objectId);
        }

        public static bool TryGetSelectedLock(out TeamForgeLockRecord lockState)
        {
            return Authority.Locks.TryGet(_selectedSceneId, _selectedObjectId, out lockState);
        }

        public static bool RequestSelectedLock()
        {
            return SendLockRequest(false);
        }

        public static bool ReleaseSelectedLock()
        {
            if (_selectedObject == null ||
                string.IsNullOrWhiteSpace(_selectedObjectId) ||
                !Authority.TransformSyncAvailable)
            {
                return false;
            }

            TrySendCurrentTransform(true);
            var message = new LockReleaseMessage
            {
                type = "lock_release",
                protocolVersion = TeamForgeProtocol.Version,
                requestId = Guid.NewGuid().ToString("N"),
                userId = TeamForgeConnectionService.Settings.UserId,
                sceneId = _selectedSceneId,
                objectId = _selectedObjectId,
            };
            var sent = TeamForgeConnectionService.SendTransform(message, "Lock release");
            if (sent)
            {
                _selectedLockGranted = false;
                _selectedLockExpiresAt = 0;
                _pendingLockRequestId = string.Empty;
                SetStatus("Lock release requested.");
            }
            return sent;
        }

        internal static IDisposable SuppressSelectionLock()
        {
            _selectionLockSuppressionDepth += 1;
            return new SelectionLockSuppressionScope();
        }

        private static void OnConnectionChanged()
        {
            TeamForgeHierarchyIdentityRegistry.BeginConnectionIdentityEpoch(
                Authority.IsConnected ? Authority.ConnectionId : string.Empty);
            var connected =
                Authority.IsConnected &&
                Authority.TransformSyncAvailable;
            var wasConnected = _wasConnected;
            _wasConnected = connected;

            if (connected && !wasConnected)
            {
                ClearHierarchyRecovery();
                AppliedOperationIds.Clear();
                AppliedOperationOrder.Clear();
                PendingLocalOperations.Clear();
                PendingOperationByRequestId.Clear();
                LatestObjectRevisions.Clear();
                ProtectedConflictKeys.Clear();
                RecoverableTransformConflicts.Clear();
                SnapshotConflictCount = 0;
                CaptureLoadedCleanSceneBaselines();
                BeginTrackingSelection(true);
            }
            else if (!connected && wasConnected)
            {
                ClearHierarchyRecovery();
                ResetSelectionTracking();
                AppliedOperationIds.Clear();
                AppliedOperationOrder.Clear();
                PendingLocalOperations.Clear();
                PendingOperationByRequestId.Clear();
                LatestObjectRevisions.Clear();
                ProtectedConflictKeys.Clear();
                RecoverableTransformConflicts.Clear();
                SnapshotConflictCount = 0;
                SetStatus(
                    Authority.IsConnected
                        ? "Server does not support Transform Sync."
                        : "Offline");
            }
            else if (!connected &&
                     Authority.IsConnected)
            {
                SetStatus("Server does not support Transform Sync.");
            }

            RaiseChanged();
        }

        private static void OnDisconnecting()
        {
            FinishTrackingSelection(true);
        }

        private static void OnSelectionChanged()
        {
            var suppressAutomaticLock = _selectionLockSuppressionDepth > 0;

            if (_selectedObject != null &&
                (TeamForgeRemoteApplyScope.IsActive ||
                 (Selection.activeGameObject == _selectedObject &&
                  Selection.gameObjects != null &&
                  Selection.gameObjects.Length == 1 &&
                  IsHierarchyReconciliationInProgress())))
            {
                return;
            }

            FinishTrackingSelection();
            BeginTrackingSelection(!suppressAutomaticLock);
        }

        private static void OnHierarchyChanged()
        {
            _nextIdentityValidationAt = 0;
            if (_selectedObject == null || IsHierarchyReconciliationInProgress())
            {
                return;
            }
            ValidateTrackedTargetOrSuspend();
        }

        private static void OnSceneOpened(Scene scene, OpenSceneMode mode)
        {
            if (!Baseline.RegisterCleanScene(scene, out var error) && _wasConnected)
            {
                TeamForgeDiagnostics.Warning($"Scene was not added to the Transform baseline: {error}");
            }
            OnSelectionChanged();
        }

        private static void BeginTrackingSelection(bool requestImmediately)
        {
            ResetSelectionTracking();
            var selected = Selection.activeGameObject;
            var resolution = ResolveTransformSelectionIdentity(selected);
            if (!resolution.CanTrack)
            {
                if (TryResumeHierarchyRecovery(selected))
                {
                    return;
                }
                ApplySelectionRejection(resolution);
                return;
            }

            _selectedObject = selected;
            _selectedObjectId = resolution.ObjectId;
            _selectedSceneId = resolution.SceneId;
            _selectedParentObjectId = resolution.ParentObjectId;
            _lastObservedState = TeamForgeTransformState.Capture(selected.transform);
            _lastConfirmedState = _lastObservedState?.Clone();
            _stateAtLockRequest = _lastObservedState?.Clone();
            _dirty = false;
            _syncBlocked = false;
            _nextTransformSendAt = 0;
            _nextIdentityValidationAt = 0;

            if (!Authority.IsConnected ||
                !Authority.TransformSyncAvailable)
            {
                SetStatus("Selected object is ready; connect to a Phase 2 server.");
                return;
            }

            if (requestImmediately)
            {
                SendLockRequest(false);
            }
            else
            {
                SetStatus("Navigation selection; lock will be requested on edit.");
            }
        }

        internal static TeamForgeTransformSelectionResolution ResolveTransformSelectionIdentity(
            GameObject selected)
        {
            if (EditorApplication.isPlayingOrWillChangePlaymode)
            {
                return SelectionResolution(selected, TeamForgeTransformSelectionRejection.PlayMode);
            }
            if (selected == null)
            {
                return SelectionResolution(null, TeamForgeTransformSelectionRejection.NoSelection);
            }
            if (Selection.gameObjects == null || Selection.gameObjects.Length != 1)
            {
                return SelectionResolution(selected, TeamForgeTransformSelectionRejection.MultipleSelection);
            }
            if (PrefabStageUtility.GetPrefabStage(selected) != null)
            {
                return SelectionResolution(selected, TeamForgeTransformSelectionRejection.PrefabStage);
            }
            if (Authority.IsConnected &&
                Authority.HierarchySyncAvailable &&
                !TeamForgeHierarchySyncService.SnapshotReady)
            {
                return SelectionResolution(
                    selected,
                    TeamForgeTransformSelectionRejection.AwaitingHierarchySnapshot);
            }
            if (!TryGetSceneId(selected, out var sceneId))
            {
                return SelectionResolution(
                    selected,
                    TeamForgeTransformSelectionRejection.SceneIdentityUnavailable);
            }
            if (!Baseline.TryGetCanonicalObjectId(sceneId, selected, out var objectId))
            {
                return new TeamForgeTransformSelectionResolution(
                    selected,
                    sceneId,
                    string.Empty,
                    string.Empty,
                    TeamForgeTransformSelectionRejection.ObjectIdentityUnavailable);
            }
            if (!Baseline.TryGetCanonicalParentObjectId(sceneId, selected, out var parentObjectId))
            {
                return new TeamForgeTransformSelectionResolution(
                    selected,
                    sceneId,
                    objectId,
                    string.Empty,
                    TeamForgeTransformSelectionRejection.ParentIdentityUnavailable);
            }
            if (HierarchyBlockedKeys.Contains(ObjectKey(sceneId, objectId)))
            {
                return new TeamForgeTransformSelectionResolution(
                    selected,
                    sceneId,
                    objectId,
                    parentObjectId,
                    TeamForgeTransformSelectionRejection.HierarchyBlocked);
            }
            if (!Baseline.Contains(sceneId, objectId))
            {
                return new TeamForgeTransformSelectionResolution(
                    selected,
                    sceneId,
                    objectId,
                    parentObjectId,
                    TeamForgeTransformSelectionRejection.BaselineMissing);
            }
            if (!Baseline.MatchesParent(sceneId, objectId, parentObjectId))
            {
                return new TeamForgeTransformSelectionResolution(
                    selected,
                    sceneId,
                    objectId,
                    parentObjectId,
                    TeamForgeTransformSelectionRejection.ParentMismatch);
            }
            if (ProtectedConflictKeys.Contains(ObjectKey(sceneId, objectId)))
            {
                return new TeamForgeTransformSelectionResolution(
                    selected,
                    sceneId,
                    objectId,
                    parentObjectId,
                    TeamForgeTransformSelectionRejection.ProtectedConflict);
            }
            return new TeamForgeTransformSelectionResolution(
                selected,
                sceneId,
                objectId,
                parentObjectId,
                TeamForgeTransformSelectionRejection.None);
        }

        internal static bool MatchesAuthoritativeSelection(
            string activeSceneId,
            string activeObjectId,
            TeamForgeHierarchyState state)
        {
            return state != null &&
                   !string.IsNullOrWhiteSpace(activeSceneId) &&
                   !string.IsNullOrWhiteSpace(activeObjectId) &&
                   state.SceneId == activeSceneId &&
                   state.ObjectId == activeObjectId;
        }

        private static TeamForgeTransformSelectionResolution SelectionResolution(
            GameObject selected,
            TeamForgeTransformSelectionRejection rejection)
        {
            return new TeamForgeTransformSelectionResolution(
                selected,
                string.Empty,
                string.Empty,
                string.Empty,
                rejection);
        }

        private static void ApplySelectionRejection(
            TeamForgeTransformSelectionResolution resolution)
        {
            switch (resolution.Rejection)
            {
                case TeamForgeTransformSelectionRejection.PlayMode:
                    SetStatus("Transform Sync is disabled in Play Mode.");
                    break;
                case TeamForgeTransformSelectionRejection.NoSelection:
                    SetStatus("No GameObject selected.");
                    break;
                case TeamForgeTransformSelectionRejection.MultipleSelection:
                    SetStatus("Transform Sync requires exactly one selected GameObject.");
                    break;
                case TeamForgeTransformSelectionRejection.PrefabStage:
                    SetStatus("Prefab Mode is outside the Phase 2 Transform Sync scope.");
                    break;
                case TeamForgeTransformSelectionRejection.AwaitingHierarchySnapshot:
                    SetStatus("Waiting for the authoritative Hierarchy snapshot before Transform tracking.");
                    break;
                case TeamForgeTransformSelectionRejection.HierarchyBlocked:
                    SetStatus("Hierarchy changed locally; Phase 2 Transform Sync is blocked for this object.");
                    break;
                case TeamForgeTransformSelectionRejection.BaselineMissing:
                    SetStatus(
                        "Object is not in the clean Scene baseline. " +
                        "Save/reload the same Scene in every Editor, then reconnect.");
                    break;
                case TeamForgeTransformSelectionRejection.ParentMismatch:
                    HierarchyBlockedKeys.Add(ObjectKey(resolution.SceneId, resolution.ObjectId));
                    SetStatus(
                        "Parent differs from the clean Scene baseline; Phase 2 Transform Sync is blocked.");
                    break;
                case TeamForgeTransformSelectionRejection.ProtectedConflict:
                    _syncBlocked = true;
                    SetStatus(
                        "This object has an unresolved local Transform conflict. " +
                        "Review/save or revert it, then disconnect and reconnect.");
                    break;
                default:
                    SetStatus("Save the Scene before synchronizing this object.");
                    break;
            }
        }

        private static void FinishTrackingSelection(bool sendFinalTransform = true)
        {
            RestoreForeignLockedSelectionBeforeReset();
            PreserveHierarchyRecovery();
            if (_selectedObject != null && _selectedLockGranted)
            {
                if (sendFinalTransform)
                {
                    TrySendCurrentTransform(true);
                }
                SendLockReleaseFor(_selectedSceneId, _selectedObjectId);
            }
            ResetSelectionTracking();
        }

        private static void PreserveHierarchyRecovery()
        {
            if (_selectedObject == null || !IsHierarchyReconciliationInProgress())
            {
                return;
            }

            _hierarchyRecoveryObject = _selectedObject;
            _hierarchyRecoverySceneId = _selectedSceneId;
            _hierarchyRecoveryObjectId = _selectedObjectId;
            _hierarchyRecoveryParentObjectId = _selectedParentObjectId;
            _hierarchyRecoveryObservedState = _lastObservedState?.Clone();
            _hierarchyRecoveryConfirmedState = _lastConfirmedState?.Clone();
            _hierarchyRecoveryLockRequestState = _stateAtLockRequest?.Clone();
        }

        private static bool TryResumeHierarchyRecovery(GameObject selected)
        {
            if (selected == null ||
                selected != _hierarchyRecoveryObject ||
                string.IsNullOrWhiteSpace(_hierarchyRecoverySceneId) ||
                string.IsNullOrWhiteSpace(_hierarchyRecoveryObjectId) ||
                !TeamForgeHierarchySyncService.IsReconciliationPendingFor(
                    _hierarchyRecoverySceneId,
                    _hierarchyRecoveryObjectId,
                    selected))
            {
                return false;
            }

            _selectedObject = selected;
            _selectedSceneId = _hierarchyRecoverySceneId;
            _selectedObjectId = _hierarchyRecoveryObjectId;
            _selectedParentObjectId = _hierarchyRecoveryParentObjectId;
            _lastObservedState = _hierarchyRecoveryObservedState?.Clone();
            _lastConfirmedState = _hierarchyRecoveryConfirmedState?.Clone();
            _stateAtLockRequest = _hierarchyRecoveryLockRequestState?.Clone();
            _selectedLockGranted = false;
            _dirty = false;
            _syncBlocked = false;
            _nextTransformSendAt = 0;
            _nextIdentityValidationAt = 0;
            SetStatus("Hierarchy reconciliation in progress; Transform authority is paused.");
            return true;
        }

        private static void ClearHierarchyRecovery(string sceneId = null, string objectId = null)
        {
            if (!string.IsNullOrWhiteSpace(sceneId) &&
                (_hierarchyRecoverySceneId != sceneId || _hierarchyRecoveryObjectId != objectId))
            {
                return;
            }

            _hierarchyRecoveryObject = null;
            _hierarchyRecoverySceneId = string.Empty;
            _hierarchyRecoveryObjectId = string.Empty;
            _hierarchyRecoveryParentObjectId = string.Empty;
            _hierarchyRecoveryObservedState = null;
            _hierarchyRecoveryConfirmedState = null;
            _hierarchyRecoveryLockRequestState = null;
        }

        private static void RestoreForeignLockedSelectionBeforeReset()
        {
            if (_selectedObject == null ||
                _selectedLockGranted ||
                _lastConfirmedState == null ||
                !Authority.IsConnected ||
                !Authority.TransformSyncAvailable ||
                !Authority.Locks.TryGet(_selectedSceneId, _selectedObjectId, out var knownLock) ||
                knownLock.ownerConnectionId == Authority.ConnectionId)
            {
                return;
            }

            var current = TeamForgeTransformState.Capture(_selectedObject.transform);
            if (current == null || _lastConfirmedState.ApproximatelyEquals(current))
            {
                return;
            }

            if (TeamForgeTransformState.ApplyRemote(_selectedObject, _lastConfirmedState))
            {
                _lastObservedState = _lastConfirmedState.Clone();
                _dirty = false;
                SetStatus($"Edit reverted before selection changed: locked by {knownLock.ownerDisplayName}.");
                TeamForgeDiagnostics.Warning(
                    $"Local Transform edit was restored before selection changed because {knownLock.ownerDisplayName} owns the lock.");
            }
        }

        private static void ResetSelectionTracking()
        {
            _selectedObject = null;
            _selectedSceneId = string.Empty;
            _selectedObjectId = string.Empty;
            _selectedParentObjectId = string.Empty;
            _pendingLockRequestId = string.Empty;
            _lastObservedState = null;
            _lastConfirmedState = null;
            _stateAtLockRequest = null;
            _selectedLockGranted = false;
            _dirty = false;
            _syncBlocked = false;
            _nextTransformSendAt = 0;
            _nextLockRenewalAt = 0;
            _selectedLockExpiresAt = 0;
            _nextIdentityValidationAt = 0;
        }

        private static bool IsHierarchyReconciliationInProgress()
        {
            return Authority.HierarchySyncAvailable &&
                   TeamForgeHierarchySyncService.IsReconciliationPendingFor(
                       _selectedSceneId,
                       _selectedObjectId,
                       _selectedObject);
        }

        private static bool SendLockRequest(bool renewal)
        {
            if (_selectedObject == null ||
                string.IsNullOrWhiteSpace(_selectedObjectId) ||
                _syncBlocked ||
                !Authority.IsConnected ||
                !Authority.TransformSyncAvailable ||
                IsHierarchyReconciliationInProgress())
            {
                return false;
            }
            if (!ValidateTrackedTargetOrSuspend())
            {
                return false;
            }

            if (Authority.Locks.TryGet(_selectedSceneId, _selectedObjectId, out var knownLock) &&
                knownLock.ownerConnectionId != Authority.ConnectionId)
            {
                SetStatus($"Locked by {knownLock.ownerDisplayName}.");
                return false;
            }

            if (!renewal)
            {
                _stateAtLockRequest = _lastObservedState?.Clone() ??
                                      TeamForgeTransformState.Capture(_selectedObject.transform);
            }

            var requestId = Guid.NewGuid().ToString("N");
            var request = new LockRequestMessage
            {
                type = "lock_request",
                protocolVersion = TeamForgeProtocol.Version,
                requestId = requestId,
                userId = TeamForgeConnectionService.Settings.UserId,
                sceneId = _selectedSceneId,
                objectId = _selectedObjectId,
            };
            if (!TeamForgeConnectionService.SendTransform(request, renewal ? "Lock renewal" : "Lock request"))
            {
                return false;
            }

            _pendingLockRequestId = requestId;
            SetStatus(renewal ? "Renewing lock…" : "Requesting lock…");
            return true;
        }

        private static bool SendLockReleaseFor(string sceneId, string objectId)
        {
            if (string.IsNullOrWhiteSpace(sceneId) ||
                string.IsNullOrWhiteSpace(objectId) ||
                !Authority.IsConnected ||
                !Authority.TransformSyncAvailable)
            {
                return false;
            }

            return TeamForgeConnectionService.SendTransform(
                new LockReleaseMessage
                {
                    type = "lock_release",
                    protocolVersion = TeamForgeProtocol.Version,
                    requestId = Guid.NewGuid().ToString("N"),
                    userId = TeamForgeConnectionService.Settings.UserId,
                    sceneId = sceneId,
                    objectId = objectId,
                },
                "Lock release");
        }

        private static void Update()
        {
            if (!_wasConnected ||
                _selectedObject == null ||
                EditorApplication.isPlayingOrWillChangePlaymode ||
                TeamForgeRemoteApplyScope.IsActive ||
                IsHierarchyReconciliationInProgress())
            {
                return;
            }

            if (_syncBlocked)
            {
                TryRecoverSelectedLockRequiredConflict();
                return;
            }

            var now = EditorApplication.timeSinceStartup;
            if (_selectedLockGranted && _selectedLockExpiresAt > 0 && now >= _selectedLockExpiresAt)
            {
                BlockSelectedObjectAfterLeaseDeadline();
                return;
            }
            if (now >= _nextIdentityValidationAt)
            {
                _nextIdentityValidationAt = now + IdentityValidationIntervalSeconds;
                if (!ValidateTrackedTargetOrSuspend())
                {
                    return;
                }
            }

            var current = TeamForgeTransformState.Capture(_selectedObject.transform);
            if (current == null || _lastObservedState == null)
            {
                return;
            }

            var changed = !_lastObservedState.ApproximatelyEquals(current);
            if (!_selectedLockGranted)
            {
                if (!changed)
                {
                    return;
                }

                if (Authority.Locks.TryGet(_selectedSceneId, _selectedObjectId, out var existingLock) &&
                    existingLock.ownerConnectionId != Authority.ConnectionId)
                {
                    TeamForgeTransformState.ApplyRemote(_selectedObject, _lastObservedState);
                    SetStatus($"Edit reverted: locked by {existingLock.ownerDisplayName}.");
                    return;
                }

                if (string.IsNullOrWhiteSpace(_pendingLockRequestId))
                {
                    _stateAtLockRequest = _lastObservedState.Clone();
                    SendLockRequest(false);
                }
                return;
            }

            if (now >= _nextLockRenewalAt)
            {
                if (string.IsNullOrWhiteSpace(_pendingLockRequestId))
                {
                    SendLockRequest(true);
                }
                // A grant carries the authoritative expiry and will reschedule this.
                // Do not overwrite a pending request ID; lease expiry is authoritative.
                _nextLockRenewalAt = now + 0.25;
            }

            if ((_dirty || changed) && now >= _nextTransformSendAt)
            {
                TrySendCurrentTransform(false);
            }
        }

        private static bool TrySendCurrentTransform(bool bypassThrottle)
        {
            if (!_selectedLockGranted ||
                _selectedObject == null ||
                _syncBlocked ||
                !Authority.IsConnected ||
                !Authority.TransformSyncAvailable ||
                IsHierarchyReconciliationInProgress())
            {
                return false;
            }

            if (!ValidateTrackedTargetOrSuspend())
            {
                return false;
            }
            if (_selectedLockExpiresAt > 0 &&
                EditorApplication.timeSinceStartup >= _selectedLockExpiresAt)
            {
                BlockSelectedObjectAfterLeaseDeadline();
                return false;
            }

            var now = EditorApplication.timeSinceStartup;
            if (!bypassThrottle && now < _nextTransformSendAt)
            {
                return false;
            }

            var current = TeamForgeTransformState.Capture(_selectedObject.transform);
            if (current == null ||
                (_lastObservedState != null && _lastObservedState.ApproximatelyEquals(current)))
            {
                _dirty = false;
                return false;
            }

            if (PendingLocalOperations.Count >= MaximumPendingLocalOperations)
            {
                SetStatus("Transform acknowledgements are delayed; sending is paused.");
                return false;
            }
            var operationId = Guid.NewGuid().ToString("N");
            var requestId = Guid.NewGuid().ToString("N");
            var update = new TransformUpdateMessage
            {
                type = "transform_update",
                protocolVersion = TeamForgeProtocol.Version,
                requestId = requestId,
                operationId = operationId,
                userId = TeamForgeConnectionService.Settings.UserId,
                sceneId = _selectedSceneId,
                objectId = _selectedObjectId,
                baseRevision = Authority.SessionRevision,
                localPosition = current.PositionDto(),
                localRotation = current.RotationDto(),
                localScale = current.ScaleDto(),
            };
            PendingLocalOperations.Add(operationId);
            PendingOperationByRequestId[requestId] = new PendingTransformOperation(
                operationId,
                _selectedSceneId,
                _selectedObjectId);
            if (!TeamForgeConnectionService.SendTransform(update, "Transform update"))
            {
                PendingLocalOperations.Remove(operationId);
                PendingOperationByRequestId.Remove(requestId);
                return false;
            }

            _lastObservedState = current;
            _dirty = false;
            _nextTransformSendAt =
                now + 1.0 / TeamForgeConnectionService.ResolvedProfile.Connection.TransformUpdatesPerSecond;
            SetStatus("Lock owned; Transform synchronized.");
            return true;
        }

        private static UndoPropertyModification[] OnPostprocessModifications(
            UndoPropertyModification[] modifications)
        {
            if (TeamForgeRemoteApplyScope.IsActive || _selectedObject == null || modifications == null)
            {
                return modifications;
            }

            var selectedTransform = _selectedObject.transform;
            foreach (var modification in modifications)
            {
                var target = modification.currentValue?.target;
                if (target == selectedTransform || target == _selectedObject)
                {
                    _dirty = true;
                    break;
                }
            }
            return modifications;
        }

        private static void OnUndoRedo()
        {
            if (!TeamForgeRemoteApplyScope.IsActive && _selectedObject != null)
            {
                _dirty = true;
            }
        }

        private static void OnTransformMessageReceived(string messageType, string json)
        {
            if (Authority.HierarchySyncAvailable && !TeamForgeHierarchySyncService.SnapshotReady)
            {
                TeamForgeDiagnostics.Warning(
                    $"Ignored {messageType}: waiting for the authoritative Hierarchy snapshot.");
                return;
            }

            switch (messageType)
            {
                case "transform_snapshot":
                    HandleTransformSnapshot(json);
                    break;
                case "transform_applied":
                    HandleTransformApplied(TeamForgeProtocol.Deserialize<TransformAppliedMessage>(json));
                    break;
                case "lock_granted":
                    HandleLockGranted(TeamForgeProtocol.Deserialize<LockStateMessage>(json));
                    break;
                case "lock_state_changed":
                    HandleLockChanged(TeamForgeProtocol.Deserialize<LockStateMessage>(json));
                    break;
                case "lock_denied":
                    HandleLockDenied(TeamForgeProtocol.Deserialize<LockDeniedMessage>(json));
                    break;
                case "lock_released":
                    HandleLockReleased(TeamForgeProtocol.Deserialize<LockReleasedMessage>(json));
                    break;
            }
        }

        private static void OnProtocolErrorReceived(ProtocolErrorMessage message)
        {
            if (message == null || string.IsNullOrWhiteSpace(message.requestId))
            {
                return;
            }

            if (PendingOperationByRequestId.TryGetValue(message.requestId, out var pending))
            {
                RemovePendingOperation(pending.OperationId, message.requestId);
                var objectKey = ObjectKey(pending.SceneId, pending.ObjectId);
                ProtectedConflictKeys.Add(objectKey);
                var lockRequired = string.Equals(message.code, "lock_required", StringComparison.Ordinal);
                if (lockRequired)
                {
                    RecoverableTransformConflicts.MarkLockRequired(pending.SceneId, pending.ObjectId);
                }
                else
                {
                    RecoverableTransformConflicts.MarkNonRecoverable(pending.SceneId, pending.ObjectId);
                }

                if (pending.SceneId == _selectedSceneId && pending.ObjectId == _selectedObjectId)
                {
                    _syncBlocked = true;
                    _dirty = false;
                    if (_selectedLockGranted)
                    {
                        SendLockReleaseFor(_selectedSceneId, _selectedObjectId);
                        _selectedLockGranted = false;
                        _selectedLockExpiresAt = 0;
                    }
                    SetStatus(
                        lockRequired
                            ? "Transform rejected (lock_required); waiting for the active edit to end before restoring authority."
                            : $"Transform rejected ({message.code}); local value was not shared. " +
                              "Review it, then disconnect and reconnect.");
                }

                if (lockRequired)
                {
                    TeamForgeDiagnostics.Warning(
                        $"Transform operation {ShortId(pending.OperationId)} was rejected because this connection no longer owns the lock. " +
                        "The local value will be restored after the active edit ends.");
                    TryRecoverSelectedLockRequiredConflict();
                }
                else
                {
                    TeamForgeDiagnostics.Warning(
                        $"Transform operation {ShortId(pending.OperationId)} was rejected by the server ({message.code}). " +
                        $"The affected object {ShortId(pending.ObjectId)} is blocked until reconnect.");
                }
                return;
            }

            if (message.requestId == _pendingLockRequestId)
            {
                _pendingLockRequestId = string.Empty;
                _selectedLockGranted = false;
                SetStatus($"Lock request rejected ({message.code}).");
            }
        }

        private static void HandleTransformSnapshot(string json)
        {
            var snapshot = TeamForgeProtocol.Deserialize<TransformSnapshotMessage>(json);
            if (snapshot == null || snapshot.serverRevision < 0 ||
                snapshot.transforms == null || snapshot.locks == null)
            {
                TeamForgeDiagnostics.Warning("Rejected invalid Transform snapshot envelope.");
                return;
            }

            var validated = new List<ValidatedTransform>();
            var objectKeys = new HashSet<string>(StringComparer.Ordinal);
            foreach (var message in snapshot.transforms)
            {
                if (!TryValidateApplied(message, out var state, out var error))
                {
                    TeamForgeDiagnostics.Warning($"Rejected Transform snapshot: {error}");
                    return;
                }
                if (message.serverRevision > snapshot.serverRevision)
                {
                    TeamForgeDiagnostics.Warning(
                        "Rejected Transform snapshot containing a future object revision.");
                    return;
                }

                var key = message.sceneId + "\n" + message.objectId;
                if (!objectKeys.Add(key))
                {
                    TeamForgeDiagnostics.Warning("Rejected Transform snapshot with duplicate object state.");
                    return;
                }
                validated.Add(new ValidatedTransform(message, state));
            }

            var candidateLocks = new TeamForgeLockRegistry();
            if (!candidateLocks.ReplaceAll(snapshot.locks, out var lockError))
            {
                TeamForgeDiagnostics.Warning($"Rejected Transform snapshot: {lockError}");
                return;
            }

            if (!TeamForgeAuthorityView.ReplaceLocks(snapshot.locks, out lockError))
            {
                TeamForgeDiagnostics.Warning($"Rejected Transform snapshot: {lockError}");
                return;
            }

            validated.Sort((left, right) =>
                left.Message.serverRevision.CompareTo(right.Message.serverRevision));
            var initiallyDirtyScenes = CaptureDirtySceneHandles();
            TeamForgeAuthorityView.ObserveRevision(snapshot.serverRevision);
            SnapshotConflictCount = 0;
            LatestObjectRevisions.Clear();
            ProtectedConflictKeys.Clear();
            RecoverableTransformConflicts.Clear();
            foreach (var item in validated)
            {
                var objectKey = ObjectKey(item.Message.sceneId, item.Message.objectId);
                RememberOperation(item.Message.operationId);
                LatestObjectRevisions[objectKey] = item.Message.serverRevision;
                if (!ApplyAuthoritativeTransform(
                        item.Message,
                        item.State,
                        true,
                        initiallyDirtyScenes))
                {
                    ProtectedConflictKeys.Add(objectKey);
                    SnapshotConflictCount += 1;
                    if (item.Message.sceneId == _selectedSceneId &&
                        item.Message.objectId == _selectedObjectId)
                    {
                        _syncBlocked = true;
                    }
                }
            }

            RefreshSelectedLockFromRegistry(snapshot.serverTimestampUnixMs);
            TeamForgeDiagnostics.Info(
                $"Transform snapshot applied at revision {Authority.SessionRevision} " +
                $"({validated.Count} object state(s), {snapshot.locks.Length} lock(s), " +
                $"{SnapshotConflictCount} protected conflict(s)).");
            RaiseChanged();
        }

        private static void HandleTransformApplied(TransformAppliedMessage message)
        {
            if (!TryValidateApplied(message, out var state, out var error))
            {
                TeamForgeDiagnostics.Warning($"Rejected Transform operation: {error}");
                return;
            }

            if (AppliedOperationIds.Contains(message.operationId))
            {
                RemovePendingOperation(message.operationId, message.requestId);
                TeamForgeAuthorityView.ObserveRevision(message.serverRevision);
                return;
            }

            var objectKey = ObjectKey(message.sceneId, message.objectId);
            if (LatestObjectRevisions.TryGetValue(objectKey, out var latestObjectRevision) &&
                message.serverRevision <= latestObjectRevision)
            {
                RememberOperation(message.operationId);
                RemovePendingOperation(message.operationId, message.requestId);
                TeamForgeAuthorityView.ObserveRevision(message.serverRevision);
                return;
            }

            if (message.serverRevision > Authority.SessionRevision + 1)
            {
                TeamForgeDiagnostics.Warning(
                    $"Transform revision gap detected: local {Authority.SessionRevision}, received {message.serverRevision}. " +
                    "Reconnect to request a full in-memory snapshot.");
            }

            RememberOperation(message.operationId);
            LatestObjectRevisions[objectKey] = message.serverRevision;
            TeamForgeAuthorityView.ObserveRevision(message.serverRevision);
            var ownPending = RemovePendingOperation(message.operationId, message.requestId);
            if (ownPending &&
                message.sceneId == _selectedSceneId &&
                message.objectId == _selectedObjectId)
            {
                _lastConfirmedState = state.Clone();
            }
            else if (!ownPending && ProtectedConflictKeys.Contains(objectKey))
            {
                if (RecoverableTransformConflicts.IsLockRequired(message.sceneId, message.objectId))
                {
                    RecoverableTransformConflicts.DeferAuthoritativeTransform(message);
                    if (message.sceneId == _selectedSceneId && message.objectId == _selectedObjectId)
                    {
                        TryRecoverSelectedLockRequiredConflict();
                    }
                }
                else
                {
                    TeamForgeDiagnostics.Warning(
                        $"Protected unresolved local Transform conflict from live overwrite: {ShortId(message.objectId)}. " +
                        "Save or revert the local Scene, then disconnect and reconnect.");
                }
            }
            else if (!ownPending)
            {
                ApplyAuthoritativeTransform(message, state, false, null);
            }
            RaiseChanged();
        }

        internal static bool TryRecoverSelectedLockRequiredConflict()
        {
            if (_selectedObject == null ||
                string.IsNullOrWhiteSpace(_selectedSceneId) ||
                string.IsNullOrWhiteSpace(_selectedObjectId))
            {
                return false;
            }

            var objectKey = ObjectKey(_selectedSceneId, _selectedObjectId);
            if (!ProtectedConflictKeys.Contains(objectKey) ||
                !RecoverableTransformConflicts.IsLockRequired(_selectedSceneId, _selectedObjectId) ||
                GUIUtility.hotControl != 0 ||
                HasPendingTransformForObject(_selectedSceneId, _selectedObjectId))
            {
                return false;
            }

            if (RecoverableTransformConflicts.TryGetDeferredAuthoritativeTransform(
                    _selectedSceneId,
                    _selectedObjectId,
                    out var deferredMessage))
            {
                if (!TryValidateApplied(deferredMessage, out var deferredState, out var error))
                {
                    RecoverableTransformConflicts.MarkNonRecoverable(_selectedSceneId, _selectedObjectId);
                    TeamForgeDiagnostics.Warning(
                        $"Deferred Transform conflict recovery was invalid and remains fail-closed: {error}");
                    return false;
                }
                if (!ApplyAuthoritativeTransform(deferredMessage, deferredState, false, null))
                {
                    RecoverableTransformConflicts.MarkNonRecoverable(_selectedSceneId, _selectedObjectId);
                    TeamForgeDiagnostics.Warning(
                        "Lock-contention recovery encountered a non-recoverable Transform authority conflict; reconnect is still required.");
                    return false;
                }
            }
            else
            {
                if (_lastConfirmedState == null ||
                    !TeamForgeTransformState.ApplyRemote(_selectedObject, _lastConfirmedState))
                {
                    return false;
                }
                _lastObservedState = _lastConfirmedState.Clone();
                _dirty = false;
                SceneView.RepaintAll();
            }

            ProtectedConflictKeys.Remove(objectKey);
            RecoverableTransformConflicts.Remove(_selectedSceneId, _selectedObjectId);
            _syncBlocked = false;
            _selectedLockGranted = false;
            _selectedLockExpiresAt = 0;
            _pendingLockRequestId = string.Empty;
            _dirty = false;
            RefreshSelectedLockStatusAfterLockRequiredRecovery();
            TeamForgeDiagnostics.Info(
                "Recovered a lock-required Transform conflict by restoring the latest authoritative value.");
            RaiseChanged();
            return true;
        }

        private static bool HasPendingTransformForObject(string sceneId, string objectId)
        {
            foreach (var pending in PendingOperationByRequestId.Values)
            {
                if (pending.SceneId == sceneId && pending.ObjectId == objectId)
                {
                    return true;
                }
            }
            return false;
        }

        private static void RefreshSelectedLockStatusAfterLockRequiredRecovery()
        {
            if (_selectedObject == null)
            {
                return;
            }

            if (!Authority.Locks.TryGet(_selectedSceneId, _selectedObjectId, out var lockState))
            {
                SetStatus("Object is unlocked. Edit to acquire.");
                return;
            }

            if (lockState.ownerConnectionId == Authority.ConnectionId)
            {
                // lock_required came from the server, so a self-owned registry entry here is stale.
                // Never re-arm sending from that stale local view; wait for the next authority event.
                SetStatus("Transform restored; waiting for authoritative lock state refresh.");
                return;
            }

            HandleSelectedLockLoss($"Locked by {lockState.ownerDisplayName}.");
        }

        private static bool TryValidateApplied(
            TransformAppliedMessage message,
            out TeamForgeTransformState state,
            out string error)
        {
            state = null;
            if (message == null ||
                !ValidText(message.operationId, 128) ||
                !ValidText(message.userId, 128) ||
                !ValidText(message.sceneId, 128) ||
                !ValidText(message.objectId, 512) ||
                message.baseRevision < 0 ||
                message.serverRevision < 1)
            {
                error = "Transform metadata is invalid.";
                return false;
            }

            return TeamForgeTransformState.TryFromMessage(message, out state, out error);
        }

        private static bool ApplyAuthoritativeTransform(
            TransformAppliedMessage message,
            TeamForgeTransformState state,
            bool protectInitiallyDirtyScene,
            HashSet<int> initiallyDirtyScenes)
        {
            if (TeamForgeHierarchyIdentityRegistry.IsLogicalId(message.objectId) &&
                !TeamForgeHierarchyIdentityRegistry.IsSessionCanonicalLogicalId(message.objectId))
            {
                ProtectedConflictKeys.Add(ObjectKey(message.sceneId, message.objectId));
                TeamForgeDiagnostics.Warning(
                    $"Ignored Transform for {ShortId(message.objectId)}: logical identity is not confirmed by the current Hierarchy authority.");
                return false;
            }
            if (!TeamForgeObjectIdentity.TryResolveGameObject(message.objectId, out var target))
            {
                TeamForgeDiagnostics.Warning(
                    $"Transform target is not loaded or does not match Scene: {ShortId(message.objectId)}.");
                return true;
            }
            if (!Baseline.TryGetCanonicalObjectId(message.sceneId, target, out var canonicalObjectId) ||
                canonicalObjectId != message.objectId)
            {
                ProtectedConflictKeys.Add(ObjectKey(message.sceneId, message.objectId));
                TeamForgeDiagnostics.Warning(
                    $"Ignored Transform for {target.name}: object identity does not match the current authority baseline.");
                return false;
            }
            if (PrefabStageUtility.GetPrefabStage(target) != null)
            {
                ProtectedConflictKeys.Add(ObjectKey(message.sceneId, message.objectId));
                TeamForgeDiagnostics.Warning(
                    $"Ignored Transform for {target.name}: Prefab Mode is outside Phase 2 scope.");
                return false;
            }
            if (!TryGetSceneId(target, out var actualSceneId) ||
                actualSceneId != message.sceneId)
            {
                TeamForgeDiagnostics.Warning(
                    $"Transform target is not loaded or does not match Scene: {ShortId(message.objectId)}.");
                return true;
            }
            if (!Baseline.Contains(message.sceneId, message.objectId))
            {
                ProtectedConflictKeys.Add(ObjectKey(message.sceneId, message.objectId));
                TeamForgeDiagnostics.Warning(
                    $"Ignored Transform for {target.name}: object is not in the clean Scene baseline.");
                return false;
            }
            if (!Baseline.TryGetCanonicalParentObjectId(
                    message.sceneId,
                    target,
                    out var actualParentObjectId) ||
                !Baseline.MatchesParent(message.sceneId, message.objectId, actualParentObjectId))
            {
                HierarchyBlockedKeys.Add(ObjectKey(message.sceneId, message.objectId));
                TeamForgeDiagnostics.Warning(
                    $"Ignored Transform for {target.name}: parent differs from the clean Scene baseline.");
                return false;
            }

            if (protectInitiallyDirtyScene &&
                initiallyDirtyScenes != null &&
                initiallyDirtyScenes.Contains(target.scene.handle))
            {
                var localState = TeamForgeTransformState.Capture(target.transform);
                if (localState != null && !localState.ApproximatelyEquals(state))
                {
                    TeamForgeDiagnostics.Warning(
                        $"Protected local unsaved Transform from snapshot overwrite: {target.name}. " +
                        "Review/save the Scene and reconnect to resolve.");
                    return false;
                }
            }

            if (!TeamForgeTransformState.ApplyRemote(target, state))
            {
                TeamForgeDiagnostics.Warning($"Could not apply Transform for {target.name}.");
                return true;
            }

            if (target == _selectedObject)
            {
                _lastObservedState = state.Clone();
                _lastConfirmedState = state.Clone();
                _dirty = false;
            }
            SceneView.RepaintAll();
            return true;
        }

        private static void HandleLockGranted(LockStateMessage message)
        {
            if (message == null)
            {
                TeamForgeDiagnostics.Warning("Rejected lock grant: message is empty.");
                return;
            }
            if (!TeamForgeAuthorityView.UpsertLock(message.lockState, out var error))
            {
                TeamForgeDiagnostics.Warning($"Rejected lock grant: {error}");
                return;
            }

            var lockState = message.lockState;
            if (lockState.ownerConnectionId != Authority.ConnectionId)
            {
                return;
            }

            if (_syncBlocked)
            {
                SendLockReleaseFor(lockState.sceneId, lockState.objectId);
                _selectedLockGranted = false;
                _selectedLockExpiresAt = 0;
                _pendingLockRequestId = string.Empty;
                SetStatus("Unresolved local Transform conflict; lock was released.");
                return;
            }

            if (lockState.sceneId != _selectedSceneId || lockState.objectId != _selectedObjectId)
            {
                SendLockReleaseFor(lockState.sceneId, lockState.objectId);
                return;
            }

            _selectedLockGranted = true;
            _pendingLockRequestId = string.Empty;
            _lastConfirmedState = _lastConfirmedState ?? _stateAtLockRequest?.Clone();
            ScheduleLockRenewal(lockState, message.serverTimestampUnixMs);
            _dirty = true;
            SetStatus("Lock owned.");
        }

        private static void HandleLockChanged(LockStateMessage message)
        {
            if (message == null)
            {
                TeamForgeDiagnostics.Warning("Rejected lock state: message is empty.");
                return;
            }
            if (!TeamForgeAuthorityView.UpsertLock(message.lockState, out var error))
            {
                TeamForgeDiagnostics.Warning($"Rejected lock state: {error}");
                return;
            }

            RefreshSelectedLockFromRegistry(message.serverTimestampUnixMs);
        }

        private static void HandleLockDenied(LockDeniedMessage message)
        {
            if (message == null)
            {
                TeamForgeDiagnostics.Warning("Rejected lock denial: message is empty.");
                return;
            }
            if (!TeamForgeAuthorityView.UpsertLock(message.lockState, out var error))
            {
                TeamForgeDiagnostics.Warning($"Rejected lock denial: {error}");
                return;
            }

            if (message.lockState.sceneId != _selectedSceneId ||
                message.lockState.objectId != _selectedObjectId)
            {
                return;
            }

            _pendingLockRequestId = string.Empty;
            _selectedLockGranted = false;
            _selectedLockExpiresAt = 0;
            if (_selectedObject != null &&
                _lastConfirmedState != null &&
                !_lastConfirmedState.ApproximatelyEquals(
                    TeamForgeTransformState.Capture(_selectedObject.transform)))
            {
                TeamForgeTransformState.ApplyRemote(_selectedObject, _lastConfirmedState);
                _lastObservedState = _lastConfirmedState.Clone();
                TeamForgeDiagnostics.Warning(
                    $"Local Transform edit was restored because {message.lockState.ownerDisplayName} owns the lock.");
            }
            SetStatus($"Locked by {message.lockState.ownerDisplayName}.");
        }

        private static void HandleLockReleased(LockReleasedMessage message)
        {
            if (message == null ||
                !ValidText(message.sceneId, 128) ||
                !ValidText(message.objectId, 512))
            {
                TeamForgeDiagnostics.Warning("Rejected invalid lock release event.");
                return;
            }

            TeamForgeAuthorityView.RemoveLock(message.sceneId, message.objectId);
            if (message.sceneId == _selectedSceneId && message.objectId == _selectedObjectId)
            {
                HandleSelectedLockLoss(
                    message.reason == "lease_expired"
                        ? "Lock lease expired."
                        : "Object is unlocked.");
            }
        }

        private static void RefreshSelectedLockFromRegistry(long serverTimestampUnixMs = 0)
        {
            if (_syncBlocked &&
                ProtectedConflictKeys.Contains(ObjectKey(_selectedSceneId, _selectedObjectId)))
            {
                if (Authority.Locks.TryGet(_selectedSceneId, _selectedObjectId, out var blockedLock) &&
                    blockedLock.ownerConnectionId == Authority.ConnectionId)
                {
                    SendLockReleaseFor(_selectedSceneId, _selectedObjectId);
                }
                _selectedLockGranted = false;
                _selectedLockExpiresAt = 0;
                _pendingLockRequestId = string.Empty;
                SetStatus("Unresolved local Transform conflict; sending is blocked.");
                return;
            }

            if (_selectedObject == null ||
                !Authority.Locks.TryGet(_selectedSceneId, _selectedObjectId, out var lockState))
            {
                _selectedLockGranted = false;
                _selectedLockExpiresAt = 0;
                if (_selectedObject != null)
                {
                    SetStatus("Object is unlocked.");
                }
                return;
            }

            _selectedLockGranted =
                lockState.ownerConnectionId == Authority.ConnectionId;
            if (_selectedLockGranted)
            {
                ScheduleLockRenewal(lockState, serverTimestampUnixMs);
                SetStatus("Lock owned.");
                return;
            }
            HandleSelectedLockLoss($"Locked by {lockState.ownerDisplayName}.");
        }

        private static void HandleSelectedLockLoss(string unlockedStatus)
        {
            _selectedLockGranted = false;
            _selectedLockExpiresAt = 0;
            _pendingLockRequestId = string.Empty;
            var current = _selectedObject == null
                ? null
                : TeamForgeTransformState.Capture(_selectedObject.transform);
            if (_selectedObject != null &&
                _lastConfirmedState != null &&
                current != null &&
                !_lastConfirmedState.ApproximatelyEquals(current))
            {
                RecoverableTransformConflicts.MarkNonRecoverable(_selectedSceneId, _selectedObjectId);
                ProtectedConflictKeys.Add(ObjectKey(_selectedSceneId, _selectedObjectId));
                _syncBlocked = true;
                _dirty = false;
                _lastObservedState = current;
                SetStatus(
                    $"{unlockedStatus} A local unconfirmed value was not shared; " +
                    "review it, then disconnect and reconnect.");
                return;
            }

            _lastObservedState = current;
            SetStatus(_syncBlocked
                ? "Unresolved local Transform conflict; sending is blocked."
                : unlockedStatus + " Edit to acquire.");
        }

        private static void RememberOperation(string operationId)
        {
            if (!AppliedOperationIds.Add(operationId))
            {
                return;
            }

            AppliedOperationOrder.Enqueue(operationId);
            while (AppliedOperationOrder.Count > MaximumRememberedOperations)
            {
                AppliedOperationIds.Remove(AppliedOperationOrder.Dequeue());
            }
        }

        private static bool RemovePendingOperation(string operationId, string requestId)
        {
            var removed = PendingLocalOperations.Remove(operationId);
            if (!string.IsNullOrWhiteSpace(requestId))
            {
                PendingOperationByRequestId.Remove(requestId);
            }

            string matchedRequestId = null;
            foreach (var pair in PendingOperationByRequestId)
            {
                if (pair.Value.OperationId == operationId)
                {
                    matchedRequestId = pair.Key;
                    break;
                }
            }
            if (matchedRequestId != null)
            {
                PendingOperationByRequestId.Remove(matchedRequestId);
            }
            return removed;
        }

        private static bool ValidateTrackedTargetOrSuspend()
        {
            if (_selectedObject == null)
            {
                return false;
            }

            var identityAndSceneValid =
                Baseline.TryGetCanonicalObjectId(
                    _selectedSceneId,
                    _selectedObject,
                    out var currentObjectId) &&
                currentObjectId == _selectedObjectId &&
                TryGetSceneId(_selectedObject, out var currentSceneId) &&
                currentSceneId == _selectedSceneId;
            if (identityAndSceneValid && IsHierarchyReconciliationInProgress())
            {
                return true;
            }

            var valid = identityAndSceneValid &&
                        Baseline.TryGetCanonicalParentObjectId(
                            _selectedSceneId,
                            _selectedObject,
                            out var currentParentObjectId) &&
                        currentParentObjectId == _selectedParentObjectId;
            if (valid)
            {
                return true;
            }

            var previousKey = ObjectKey(_selectedSceneId, _selectedObjectId);
            HierarchyBlockedKeys.Add(previousKey);
            if (Baseline.TryGetCanonicalObjectId(
                    _selectedSceneId,
                    _selectedObject,
                    out currentObjectId) &&
                TryGetSceneId(_selectedObject, out currentSceneId))
            {
                HierarchyBlockedKeys.Add(ObjectKey(currentSceneId, currentObjectId));
            }

            var objectName = _selectedObject.name;
            FinishTrackingSelection(false);
            SetStatus(
                "Hierarchy or Scene ownership changed; Phase 2 did not send the local Transform. " +
                "Synchronize the Hierarchy outside this session and reload the Scene.");
            TeamForgeDiagnostics.Warning(
                $"Transform Sync was suspended for {objectName}: parent or Scene identity changed. " +
                "Phase 2 never sends a final Transform under the stale identity.");
            return false;
        }

        private static void ScheduleLockRenewal(
            TeamForgeLockRecord lockState,
            long serverTimestampUnixMs)
        {
            if (lockState == null)
            {
                _nextLockRenewalAt = EditorApplication.timeSinceStartup + 0.5;
                _selectedLockExpiresAt = EditorApplication.timeSinceStartup + 0.5;
                return;
            }

            var referenceTimestamp = serverTimestampUnixMs > 0
                ? serverTimestampUnixMs
                : DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var remainingSeconds = Math.Max(
                0.1,
                (lockState.expiresAtUnixMs - referenceTimestamp) / 1000.0);
            var configuredSeconds = Mathf.Clamp(
                TeamForgeConnectionService.ResolvedProfile.Connection.LockRenewalSeconds,
                1,
                30);
            var renewalDelay = Math.Min(configuredSeconds, remainingSeconds * 0.5);
            renewalDelay = Math.Max(0.1, Math.Min(renewalDelay, remainingSeconds - 0.1));
            var now = EditorApplication.timeSinceStartup;
            _nextLockRenewalAt = now + renewalDelay;
            _selectedLockExpiresAt = now + remainingSeconds;
        }

        private static void BlockSelectedObjectAfterLeaseDeadline()
        {
            if (_selectedObject == null)
            {
                return;
            }

            RecoverableTransformConflicts.MarkNonRecoverable(_selectedSceneId, _selectedObjectId);
            ProtectedConflictKeys.Add(ObjectKey(_selectedSceneId, _selectedObjectId));
            SendLockReleaseFor(_selectedSceneId, _selectedObjectId);
            _selectedLockGranted = false;
            _selectedLockExpiresAt = 0;
            _pendingLockRequestId = string.Empty;
            _syncBlocked = true;
            _dirty = false;
            SetStatus(
                "Lock lease confirmation expired; local value was not shared. " +
                "Review it, then disconnect and reconnect.");
            TeamForgeDiagnostics.Warning(
                "Transform sending stopped because the authoritative lock lease deadline passed.");
        }

        private static bool TryGetSceneId(GameObject target, out string sceneId)
        {
            sceneId = string.Empty;
            if (target == null || !target.scene.IsValid() || !target.scene.isLoaded ||
                string.IsNullOrWhiteSpace(target.scene.path))
            {
                return false;
            }

            sceneId = AssetDatabase.AssetPathToGUID(target.scene.path);
            return !string.IsNullOrWhiteSpace(sceneId);
        }

        private static HashSet<int> CaptureDirtySceneHandles()
        {
            var dirtyScenes = new HashSet<int>();
            for (var index = 0; index < SceneManager.sceneCount; index += 1)
            {
                var scene = SceneManager.GetSceneAt(index);
                if (scene.IsValid() && scene.isLoaded && scene.isDirty)
                {
                    dirtyScenes.Add(scene.handle);
                }
            }
            return dirtyScenes;
        }

        private static void CaptureLoadedCleanSceneBaselines()
        {
            for (var index = 0; index < SceneManager.sceneCount; index += 1)
            {
                var scene = SceneManager.GetSceneAt(index);
                if (!Baseline.RegisterCleanSceneIfMissing(scene, out var error))
                {
                    TeamForgeDiagnostics.Warning(
                        $"Scene '{scene.name}' was not added to the Transform baseline: {error}");
                }
            }
            PersistBaseline();
        }

        private static void PersistBaseline()
        {
            var snapshot = new BaselineSnapshot
            {
                entries = Baseline.Snapshot().ToArray(),
            };
            SessionState.SetString(BaselineSessionStateKey, JsonUtility.ToJson(snapshot));
        }

        private static void RestoreBaseline()
        {
            var json = SessionState.GetString(BaselineSessionStateKey, string.Empty);
            if (string.IsNullOrWhiteSpace(json))
            {
                return;
            }

            try
            {
                var snapshot = JsonUtility.FromJson<BaselineSnapshot>(json);
                Baseline.ReplaceAll(snapshot?.entries);
            }
            catch (Exception exception)
            {
                Baseline.Clear();
                TeamForgeDiagnostics.Warning(
                    $"Transform baseline could not be restored after Assembly Reload: {exception.Message}");
            }
        }

        private static string ObjectKey(string sceneId, string objectId)
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

        private static string ShortId(string value)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                return "—";
            }
            return value.Length <= 24 ? value : value.Substring(value.Length - 24);
        }

        private static void SetStatus(string value)
        {
            if (_selectedLockStatus == value)
            {
                return;
            }

            _selectedLockStatus = value;
            RaiseChanged();
        }

        private static void RaiseChanged()
        {
            Changed?.Invoke();
        }

        private sealed class ValidatedTransform
        {
            public ValidatedTransform(TransformAppliedMessage message, TeamForgeTransformState state)
            {
                Message = message;
                State = state;
            }

            public TransformAppliedMessage Message { get; }
            public TeamForgeTransformState State { get; }
        }

        private sealed class PendingTransformOperation
        {
            public PendingTransformOperation(string operationId, string sceneId, string objectId)
            {
                OperationId = operationId;
                SceneId = sceneId;
                ObjectId = objectId;
            }

            public string OperationId { get; }
            public string SceneId { get; }
            public string ObjectId { get; }
        }

        [Serializable]
        private sealed class BaselineSnapshot
        {
            public TeamForgeBaselineEntry[] entries;
        }

        private sealed class SelectionLockSuppressionScope : IDisposable
        {
            private bool _disposed;

            public void Dispose()
            {
                if (_disposed)
                {
                    return;
                }

                _disposed = true;
                _selectionLockSuppressionDepth = Math.Max(0, _selectionLockSuppressionDepth - 1);
            }
        }
    }
}

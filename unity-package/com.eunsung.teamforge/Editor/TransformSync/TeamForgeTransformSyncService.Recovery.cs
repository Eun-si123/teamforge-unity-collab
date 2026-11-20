using System;
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace EunSung.TeamForge
{
    public static partial class TeamForgeTransformSyncService
    {
        private static TeamForgeTransformRecoveryStore _transformRecovery = new TeamForgeTransformRecoveryStore(
            Path.Combine(Directory.GetCurrentDirectory(), "Library", "TeamForge", "TransformRecovery-v1.json"));
        private static readonly Dictionary<string, RecoverySharedState> RecoveryShared = new Dictionary<string, RecoverySharedState>(StringComparer.Ordinal);
        private static TeamForgeTransformRecoveryScope _lastRecoveryScope;
        private static string _lastRecoveryEpoch;
        private static bool _recoverySnapshotReady;
        private sealed class RecoverySharedState
        { internal TeamForgeTransformState Pose; internal long Revision; internal string ParentId; }
        [Serializable] private sealed class RecoveryTransformCommand : ProtocolEnvelope
        {
            public string operationId, userId, sceneId, objectId;
            public long baseRevision, expectedTransformRevision;
            public TeamForgeVector3Dto localPosition, localScale;
            public TeamForgeQuaternionDto localRotation;
        }
        private static void InitializeTransformRecovery()
        { if (!_transformRecovery.Load(out var error)) TeamForgeDiagnostics.Warning(error); }
        internal static IReadOnlyList<TeamForgeTransformRecoveryRow> RecoveryRows() => _transformRecovery.Rows();
        internal static bool TryReparentRecoveryRevision(string sceneId, string objectId, out long revision)
        {
            revision = 0;
            if (!_recoverySnapshotReady || HasPendingTransformForObject(sceneId, objectId)) return false;
            if (RecoveryShared.TryGetValue(ObjectKey(sceneId, objectId), out var shared)) revision = shared.Revision;
            return true;
        }
        private static bool TryRecoveryScope(out TeamForgeTransformRecoveryScope scope)
        {
            scope = null;
            if (!TeamForgeConnectionService.DurableSessionRecoveryAvailable ||
                !TeamForgeWp6PreviewSourceGate.TryCaptureCurrentProjectPin(out var pin, out _)) return false;
            scope = new TeamForgeTransformRecoveryScope { projectId = pin.ProjectId, sessionId = pin.SessionId,
                projectUuid = pin.ProjectUuid, baselineRevision = pin.BaselineRevision, manifestHash = pin.ManifestHash,
                descriptorHash = pin.DescriptorHash, durableSessionId = TeamForgeConnectionService.DurableSessionId };
            return scope.IsValid;
        }
        private static bool HasRecoveryReview(string sceneId, string objectId)
        {
            if (!TeamForgeConnectionService.DurableSessionRecoveryAvailable) return false;
            if (TryRecoveryScope(out var scope))
            { _lastRecoveryScope = scope; _lastRecoveryEpoch = TeamForgeConnectionService.AuthorityEpoch; }
            return scope != null && _transformRecovery.NeedsReview(scope.Key, sceneId, objectId);
        }
        private static bool ArchiveTransformIntent(TeamForgeTransformState desired, string operationId,
            bool review, out string key, out string error)
        {
            key = null; error = string.Empty;
            if (!TeamForgeConnectionService.DurableSessionRecoveryAvailable && (Authority.IsConnected || _lastRecoveryScope == null)) return true;
            if (TryRecoveryScope(out var scope))
            { _lastRecoveryScope = scope; _lastRecoveryEpoch = TeamForgeConnectionService.AuthorityEpoch; }
            else if (!Authority.IsConnected) scope = _lastRecoveryScope;
            if (scope == null || !TeamForgeTransformRecoveryRow.ValidPose(desired) || _selectedObject == null ||
                !TryGetSceneId(_selectedObject, out var sceneId) || sceneId != _selectedSceneId ||
                !Baseline.TryGetCanonicalObjectId(sceneId, _selectedObject, out var objectId) || objectId != _selectedObjectId ||
                !Baseline.TryGetCanonicalParentObjectId(sceneId, _selectedObject, out var parentId) ||
                !Baseline.MatchesParent(sceneId, objectId, parentId))
            { error = "A verified durable source and exact Transform target are required before preserving or sharing this pose."; return false; }
            RecoveryShared.TryGetValue(ObjectKey(sceneId, objectId), out var shared);
            var row = new TeamForgeTransformRecoveryRow { scope = scope, sceneId = sceneId, scenePath = _selectedObject.scene.path,
                objectId = objectId, parentObjectId = parentId, authorityEpoch = _lastRecoveryEpoch,
                operationId = operationId ?? string.Empty, desired = desired.Clone(), before = shared?.Pose.Clone() ?? _lastConfirmedState?.Clone(), needsReview = review };
            key = row.Key;
            if (_transformRecovery.TryGet(key, out var previous))
            {
                row.needsReview |= previous.needsReview;
                if (string.IsNullOrEmpty(operationId)) row.operationId = previous.operationId;
            }
            return _transformRecovery.Put(row, out error);
        }
        private static void PreserveCurrentRecoveryIntent(bool review)
        {
            if (_selectedObject == null || TeamForgeRemoteApplyScope.IsActive) return;
            var current = TeamForgeTransformState.Capture(_selectedObject.transform);
            if (current == null) return;
            foreach (var pending in PendingOperationByRequestId.Values)
                if (pending.SceneId == _selectedSceneId && pending.ObjectId == _selectedObjectId &&
                    pending.RecoveryKey != null && pending.LiveAtSend != null && current.ApproximatelyEquals(pending.LiveAtSend))
                    return; // A manual intent has not optimistically changed the native pose.
            var changed = _lastConfirmedState != null && !_lastConfirmedState.ApproximatelyEquals(current);
            if (!changed && !HasPendingTransformForObject(_selectedSceneId, _selectedObjectId)) return;
            if (!ArchiveTransformIntent(current, null, review, out _, out var error)) SetStatus(error);
        }
        private static void PreserveRecoveryBeforeEndingScope()
        {
            PreserveCurrentRecoveryIntent(true);
            foreach (var row in _transformRecovery.Rows())
            {
                if (!row.needsReview) { row.needsReview = true; if (!_transformRecovery.Put(row, out var error)) SetStatus(error); }
            }
        }
        private static void OnRecoveryConnectionChanged(bool connected, bool wasConnected)
        {
            if (!connected && wasConnected) PreserveRecoveryBeforeEndingScope();
            if (connected != wasConnected)
            {
                RecoveryShared.Clear(); _recoverySnapshotReady = false;
                if (connected) { _lastRecoveryScope = null; _lastRecoveryEpoch = null; }
            }
        }
        private static void BeforeTransformAssemblyReload()
        { PreserveRecoveryBeforeEndingScope(); PersistBaseline(); }
        private static void OnTransformSceneSaved(Scene scene)
        {
            if (TeamForgeConnectionService.DurableSessionRecoveryAvailable && _selectedObject != null && _selectedObject.scene == scene)
            {
                // Saving does not end this selection or flush a late network
                // write. Revalidate its saved aliases on the next ordinary tick.
                PreserveCurrentRecoveryIntent(false); _nextIdentityValidationAt = 0; return;
            }
            OnSelectionChanged();
        }

        private static void ObserveRecoveryHierarchy(TeamForgeHierarchyState state)
        {
            if (!TeamForgeConnectionService.DurableSessionRecoveryAvailable || state?.Transform == null) return;
            var key = ObjectKey(state.SceneId, state.ObjectId);
            if (!RecoveryShared.TryGetValue(key, out var current))
                RecoveryShared[key] = new RecoverySharedState { Pose = state.Transform.Clone(), Revision = 0, ParentId = state.ParentObjectId ?? string.Empty };
            else
            {
                if (current.Revision > 0 && (!current.Pose.ApproximatelyEquals(state.Transform) || current.ParentId != state.ParentObjectId))
                    current.Revision = state.HierarchyRevision;
                current.Pose = state.Transform.Clone(); current.ParentId = state.ParentObjectId ?? string.Empty;
            }
        }
        private static void ObserveRecoveryTransform(TransformAppliedMessage message, TeamForgeTransformState state)
        {
            if (!TeamForgeConnectionService.DurableSessionRecoveryAvailable) return;
            var key = ObjectKey(message.sceneId, message.objectId);
            if (!RecoveryShared.TryGetValue(key, out var shared))
                RecoveryShared[key] = shared = new RecoverySharedState { ParentId = string.Empty };
            if (shared.Revision > message.serverRevision) return;
            shared.Pose = state.Clone(); shared.Revision = message.serverRevision;
            if (!TryRecoveryScope(out var scope)) return;
            _lastRecoveryScope = scope; _lastRecoveryEpoch = TeamForgeConnectionService.AuthorityEpoch;
            if (!_transformRecovery.ConfirmShared(scope.Key, message.sceneId, message.objectId, state, out var error)) SetStatus(error);
        }
        private static void BeforeRecoveryReceipt(TransformAppliedMessage message, TeamForgeTransformState state)
        {
            if (!PendingOperationByRequestId.TryGetValue(message.requestId ?? string.Empty, out var pending) ||
                pending.OperationId != message.operationId || pending.SceneId != message.sceneId || pending.ObjectId != message.objectId) return;
            if (_selectedObject != null && _selectedSceneId == pending.SceneId && _selectedObjectId == pending.ObjectId)
            {
                var current = TeamForgeTransformState.Capture(_selectedObject.transform);
                if (current != null && pending.LiveAtSend != null && !current.ApproximatelyEquals(pending.LiveAtSend))
                    if (!ArchiveTransformIntent(current, null, true, out _, out var captureError))
                    { SetStatus(captureError); return; }
                if (pending.ManualRecovery && pending.Desired != null && state.ApproximatelyEquals(pending.Desired))
                {
                    if (!TryRecoveryTarget(pending.RecoveryKey, out _, out var target, out _, out _, out _) ||
                        target != _selectedObject || !TeamForgeTransformState.ApplyRemote(target, state))
                    {
                        SetStatus("The Coordinator accepted the recovered pose. Review the current local target before applying it.");
                        return;
                    }
                    _lastObservedState = state.Clone(); _lastConfirmedState = state.Clone(); _dirty = false;
                    SetStatus("Recovery Transform accepted by the Coordinator. Saving the Scene remains a separate action.");
                }
            }
        }
        private static void MarkRejectedRecovery(PendingTransformOperation pending)
        {
            if (pending.RecoveryKey != null && _transformRecovery.TryGet(pending.RecoveryKey, out var row))
            { row.needsReview = true; if (!_transformRecovery.Put(row, out var error)) SetStatus(error); }
        }
        internal static bool TryRecoveryShared(string key, out TeamForgeTransformState pose, out long revision)
        {
            pose = null; revision = 0;
            if (!_recoverySnapshotReady || !_transformRecovery.TryGet(key, out var row) || !TryRecoveryScope(out var scope) ||
                row.scope.Key != scope.Key || !RecoveryShared.TryGetValue(ObjectKey(row.sceneId, row.objectId), out var shared)) return false;
            pose = shared.Pose.Clone(); revision = shared.Revision; return true;
        }
        private static bool TryRecoveryTarget(string key, out TeamForgeTransformRecoveryRow row, out GameObject target,
            out TeamForgeTransformState shared, out long revision, out string error)
        {
            target = null; shared = null; revision = 0; error = "Wait for the current durable Session, approved Project source and full Scene snapshots. A different source or Session requires separate review.";
            if (!_transformRecovery.TryGet(key, out row) || !Authority.IsConnected || !Authority.TransformSyncAvailable ||
                !TeamForgeConnectionService.DurableSessionRecoveryAvailable || !TeamForgeHierarchySyncService.SnapshotReady ||
                !TryRecoveryShared(key, out shared, out revision) ||
                !TeamForgeObjectIdentity.TryResolveGameObject(row.objectId, out target) || target == null ||
                !TryGetSceneId(target, out var sid) || sid != row.sceneId || target.scene.path != row.scenePath ||
                PrefabStageUtility.GetPrefabStage(target) != null ||
                !Baseline.TryGetCanonicalObjectId(sid, target, out var oid) || oid != row.objectId ||
                !Baseline.TryGetCanonicalParentObjectId(sid, target, out var parent) || parent != row.parentObjectId ||
                !Baseline.MatchesParent(sid, oid, parent) || HierarchyBlockedKeys.Contains(ObjectKey(sid, oid)) ||
                TeamForgeHierarchySyncService.IsReconciliationPendingFor(sid, oid, target) ||
                !TeamForgeColliderSyncService.IsSceneEditReady(sid)) return false;
            error = string.Empty; return true;
        }
        internal static bool SelectRecoveryTarget(string key, out string error)
        {
            if (!TryRecoveryTarget(key, out _, out var target, out _, out _, out error)) return false;
            using (SuppressSelectionLock()) Selection.activeGameObject = target;
            return true;
        }
        internal static bool RestoreSharedRecoveryTarget(string key, out string error)
        {
            if (!TryRecoveryTarget(key, out var row, out var target, out var shared, out _, out error)) return false;
            if (HasPendingTransformForObject(row.sceneId, row.objectId)) { error = "Wait for this target's pending Transform result."; return false; }
            var current = TeamForgeTransformState.Capture(target.transform);
            if (current != null && !current.ApproximatelyEquals(shared) && !current.ApproximatelyEquals(row.desired))
            {
                row.desired = current; row.needsReview = true;
                if (!_transformRecovery.Put(row, out error)) return false;
                error = "A newer local pose was preserved. Review the updated local value before restoring the shared pose."; return false;
            }
            if (!TeamForgeTransformState.ApplyRemote(target, shared)) { error = "The exact shared Transform could not be restored."; return false; }
            var objectKey = ObjectKey(row.sceneId, row.objectId);
            if (ProtectedConflictKeys.Remove(objectKey)) SnapshotConflictCount = Math.Max(0, SnapshotConflictCount - 1);
            RecoverableTransformConflicts.Remove(row.sceneId, row.objectId);
            using (SuppressSelectionLock()) Selection.activeGameObject = target;
            BeginTrackingSelection(false); RaiseChanged(); return true;
        }
        internal static bool ResubmitRecovery(string key, long reviewedRevision, out string error)
        {
            if (!TryRecoveryTarget(key, out var row, out var target, out var shared, out var revision, out error)) return false;
            if (reviewedRevision != revision) { error = "The shared pose changed. Review it again before resubmitting."; return false; }
            if (row.desired.ApproximatelyEquals(shared)) return _transformRecovery.Remove(key, out error);
            if (_selectedObject != target || _syncBlocked || !TeamForgeTransformState.Capture(target.transform).ApproximatelyEquals(shared) ||
                HasPendingTransformForObject(row.sceneId, row.objectId) || !Authority.Locks.TryGet(row.sceneId, row.objectId, out var lease) ||
                lease.ownerConnectionId != Authority.ConnectionId || !_selectedLockGranted ||
                PendingLocalOperations.Count >= MaximumPendingLocalOperations ||
                (_selectedLockExpiresAt > 0 && EditorApplication.timeSinceStartup >= _selectedLockExpiresAt))
            { error = "Restore this target's shared pose, select it, and acquire a fresh live lock before resubmitting."; return false; }
            var command = new RecoveryTransformCommand { type = "transform_update", protocolVersion = 1,
                requestId = Guid.NewGuid().ToString("N"), operationId = Guid.NewGuid().ToString("N"),
                userId = TeamForgeConnectionService.Settings.UserId.Trim(), sceneId = row.sceneId, objectId = row.objectId,
                baseRevision = Authority.SessionRevision, expectedTransformRevision = revision,
                localPosition = row.desired.PositionDto(), localRotation = row.desired.RotationDto(), localScale = row.desired.ScaleDto() };
            row.operationId = command.operationId; row.authorityEpoch = TeamForgeConnectionService.AuthorityEpoch;
            row.before = shared.Clone(); row.needsReview = true;
            if (!_transformRecovery.Put(row, out error)) return false;
            PendingLocalOperations.Add(command.operationId);
            PendingOperationByRequestId[command.requestId] = new PendingTransformOperation(command.operationId, row.sceneId, row.objectId)
            { Desired = row.desired.Clone(), LiveAtSend = shared.Clone(), RecoveryKey = key, ManualRecovery = true };
            if (!TeamForgeConnectionService.SendTransform(command, "Reviewed Transform recovery"))
            { RemovePendingOperation(command.operationId, command.requestId); error = "The reviewed command was not sent; its local intent remains preserved."; return false; }
            _dirty = false; SetStatus("Recovery Transform pending — awaiting Coordinator acceptance."); return true;
        }
        internal static bool DiscardRecovery(string key, out string error)
        {
            if (_transformRecovery.TryGet(key, out var row) && HasPendingTransformForObject(row.sceneId, row.objectId))
            { error = "Wait for the pending result or disconnect before discarding its recovery intent."; return false; }
            var removed = _transformRecovery.Remove(key, out error); RaiseChanged(); return removed;
        }
        internal static bool ExportRecovery(string path, out string error)
        {
            error = string.Empty;
            try
            {
                var text = "["; var rows = _transformRecovery.Rows();
                for (var index = 0; index < rows.Count; index++)
                    text += (index == 0 ? string.Empty : ",") + JsonUtility.ToJson(rows[index]);
                File.WriteAllText(path, text + "]"); return true;
            }
            catch (Exception) { error = "Transform recovery could not be exported; its inbox remains preserved."; return false; }
        }
    }
}

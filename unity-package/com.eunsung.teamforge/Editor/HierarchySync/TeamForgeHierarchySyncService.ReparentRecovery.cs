using System;
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace EunSung.TeamForge
{
    public static partial class TeamForgeHierarchySyncService
    {
        private static readonly TeamForgeHierarchyReparentRecoveryStore ReparentRecovery = new TeamForgeHierarchyReparentRecoveryStore(
            Path.Combine(Directory.GetCurrentDirectory(), "Library", "TeamForge", "HierarchyReparentRecovery-v1.json"));
        private static PendingReparentRecovery _reparentPending;
        private static bool _reparentScopeEnabled;
        internal static string ReparentRecoveryArchiveError { get; private set; } = string.Empty;

        private sealed class PendingReparentRecovery
        {
            internal string Key, OperationId;
            internal TeamForgeReparentPlacement Desired, LiveAtSend;
            internal bool Reviewed;
        }

        [Serializable]
        private sealed class ReviewedReparentCommand : ProtocolEnvelope
        {
            public string kind, operationId, userId, sceneId, objectId, parentObjectId;
            public long baseRevision, expectedHierarchyRevision, expectedTransformRevision;
            public int siblingIndex;
            public TeamForgeVector3Dto localPosition, localScale;
            public TeamForgeQuaternionDto localRotation;
        }

        private static void InitializeReparentRecovery()
        {
            if (ReparentRecovery.Load(out var error)) return;
            ReparentRecoveryArchiveError = error;
            TeamForgeDiagnostics.Warning(error);
        }

        internal static IReadOnlyList<TeamForgeHierarchyReparentRecoveryRow> RecoveryReparentRows() => ReparentRecovery.Rows();

        private static bool PreserveLocalReparents(TeamForgeTransformRecoveryScope scope, bool review, Scene scene, out string error)
        {
            error = string.Empty;
            if (!_reparentScopeEnabled) return true;
            foreach (var sceneId in AuthoritativeSceneIds)
            {
                foreach (var shared in Authoritative.SceneSnapshot(sceneId))
                {
                    if (!TryRenameTarget(shared, out var target) || (scene.IsValid() && scene != target.scene)) continue;
                    if (!TryFindPlacementParent(shared.SceneId, shared.ParentObjectId, out _, out var sharedParent)) continue;
                    if (target.transform.parent == sharedParent) continue;
                    if (!TryReadPlacements(shared, target, out var before, out var desired, out error) ||
                        !ArchiveReparent(scope, shared, target, before, desired, review, null, out _, out error)) return false;
                }
            }
            return true;
        }

        private static void RetireReparentRows(TeamForgeTransformRecoveryScope scope)
        {
            foreach (var row in ReparentRecovery.Rows())
            {
                if (row.needsReview || row.scope.Key != scope.Key) continue;
                row.needsReview = true;
                if (!ReparentRecovery.Put(row, out var error)) SetStatus(error);
            }
        }

        private static bool TryFindPlacementParent(string sceneId, string parentId, out long createdRevision, out Transform parent)
        {
            createdRevision = 0;
            parent = null;
            if (string.IsNullOrEmpty(parentId)) return true;
            if (!Authoritative.TryGet(sceneId, parentId, out var state) || !TryRenameTarget(state, out var target)) return false;
            createdRevision = state.CreatedRevision;
            parent = target.transform;
            return true;
        }

        private static bool TryFindPlacementParent(string sceneId, TeamForgeReparentPlacement placement, GameObject target, out Transform parent)
        {
            return TryFindPlacementParent(sceneId, placement.parentObjectId, out var generation, out parent) &&
                generation == placement.parentCreatedRevision && (parent == null || (parent != target.transform && !parent.IsChildOf(target.transform)));
        }

        private static bool TryReadLocalPlacement(string sceneId, GameObject target, out TeamForgeReparentPlacement placement)
        {
            placement = null;
            var parent = target.transform.parent;
            var parentId = string.Empty;
            var parentGeneration = 0L;
            if (parent != null)
            {
                if (!TeamForgeObjectIdentity.TryGetGlobalObjectId(parent.gameObject, out parentId) || !Authoritative.Contains(sceneId, parentId))
                {
                    if (!TeamForgeHierarchyIdentityRegistry.TryGetLogicalId(parent.gameObject, out parentId)) return false;
                }
                if (!TryFindPlacementParent(sceneId, parentId, out parentGeneration, out var resolved) || parent != resolved) return false;
            }
            placement = new TeamForgeReparentPlacement { parentObjectId = parentId, parentCreatedRevision = parentGeneration,
                siblingIndex = target.transform.GetSiblingIndex(), pose = TeamForgeTransformState.Capture(target.transform) };
            return placement.IsValid;
        }

        private static bool TryReadSharedPlacement(TeamForgeHierarchyState shared, out TeamForgeReparentPlacement placement)
        {
            placement = null;
            if (!TryFindPlacementParent(shared.SceneId, shared.ParentObjectId, out var generation, out _)) return false;
            placement = new TeamForgeReparentPlacement { parentObjectId = shared.ParentObjectId, parentCreatedRevision = generation,
                siblingIndex = shared.SiblingIndex, pose = shared.Transform?.Clone() };
            return placement.IsValid;
        }

        private static bool TryReadPlacements(TeamForgeHierarchyState shared, GameObject target,
            out TeamForgeReparentPlacement before, out TeamForgeReparentPlacement desired, out string error)
        {
            desired = null;
            error = "Preserve this Scene manually. The reparent has an unsupported or unresolved saved parent or pose.";
            if (!TryReadSharedPlacement(shared, out before) || !TryReadLocalPlacement(shared.SceneId, target, out desired)) return false;
            error = string.Empty;
            return true;
        }

        private static bool ArchiveReparent(TeamForgeTransformRecoveryScope scope, TeamForgeHierarchyState shared, GameObject target,
            TeamForgeReparentPlacement before, TeamForgeReparentPlacement desired, bool review, string operationId,
            out TeamForgeHierarchyReparentRecoveryRow row, out string error)
        {
            ReparentRecovery.TryGet(RenameKey(scope, shared), out var previous);
            if (previous != null && (previous.createdRevision != shared.CreatedRevision || previous.scenePath != target.scene.path))
            {
                row = null;
                error = "An archived reparent belongs to a different saved target. Review it before sharing this placement.";
                return false;
            }
            row = new TeamForgeHierarchyReparentRecoveryRow {
                scope = scope, sceneId = shared.SceneId, scenePath = target.scene.path, objectId = shared.ObjectId,
                createdRevision = shared.CreatedRevision, authorityEpoch = _renameAuthorityEpoch, before = before, desired = desired,
                operationId = operationId ?? previous?.operationId ?? string.Empty,
                needsReview = review || (previous?.needsReview ?? false),
            };
            if (previous != null && previous.desired.Matches(desired) && previous.before.Matches(before) &&
                previous.operationId == row.operationId && previous.authorityEpoch == row.authorityEpoch && previous.needsReview == row.needsReview)
            { error = string.Empty; return true; }
            return ReparentRecovery.Put(row, out error);
        }

        private static bool SendDurableLocalReparent(TeamForgeHierarchyState current, TeamForgeHierarchyState shared, GameObject target)
        {
            if (!TryRenameScope(out var scope))
            { SetStatus("Wait for the matching signed Project registry before sharing this reparent."); return false; }
            if (!TryReadPlacements(shared, target, out var before, out var desired, out var error))
            { SetStatus(error); return false; }
            var locked = ParentLockedByOther(shared.SceneId, shared.ObjectId) ||
                ParentLockedByOther(shared.SceneId, before.parentObjectId) || ParentLockedByOther(shared.SceneId, desired.parentObjectId);
            var message = CreateOperation("reparent_object", current, shared);
            if (!ArchiveReparent(scope, shared, target, before, desired, locked, null, out var row, out error))
            { SetStatus(error); return false; }
            if (row.needsReview)
            { SetStatus("A local placement is preserved in Session Recovery for review."); return false; }
            row.operationId = message.operationId;
            if (!ReparentRecovery.Put(row, out error)) { SetStatus(error); return false; }
            return SendTrackedReparent(message, message.requestId, row, desired, false);
        }

        private static bool SendTrackedReparent(object wire, string requestId, TeamForgeHierarchyReparentRecoveryRow row,
            TeamForgeReparentPlacement live, bool reviewed)
        {
            _reparentPending = new PendingReparentRecovery { Key = row.Key, OperationId = row.operationId,
                Desired = row.desired, LiveAtSend = live, Reviewed = reviewed };
            var pending = new TeamForgePendingHierarchyOperation(row.operationId, requestId, row.sceneId, row.objectId, "reparent_object");
            if (TrySendOperation(wire, pending)) return true;
            MarkReparentForReview(pending, "The reparent was not sent.");
            return false;
        }

        private static bool MarkReparentForReview(TeamForgePendingHierarchyOperation pending, string explanation)
        {
            if (_reparentPending?.OperationId != pending.OperationId) return false;
            var recovery = _reparentPending;
            _reparentPending = null;
            if (ReparentRecovery.TryGet(recovery.Key, out var row))
            {
                if (TryRenameScope(out var scope) && row.scope.Key == scope.Key && Authoritative.TryGet(row.sceneId, row.objectId, out var shared) &&
                    TryRenameTarget(shared, out var target) && TryReadPlacements(shared, target, out var before, out var live, out _) &&
                    live.parentObjectId != before.parentObjectId && !live.Matches(recovery.LiveAtSend))
                {
                    if (!ArchiveReparent(scope, shared, target, before, live, true, null, out _, out var archiveError))
                    { SetStatus(archiveError); return true; }
                }
                else if (!row.needsReview)
                {
                    row.needsReview = true;
                    if (!ReparentRecovery.Put(row, out var archiveError)) { SetStatus(archiveError); return true; }
                }
            }
            SetStatus(explanation + " The saved placement remains available in Session Recovery.");
            return true;
        }

        private static bool ValidateReparentReceipt(HierarchyAppliedMessage message, List<TeamForgeHierarchyState> changed, out string error)
        {
            error = string.Empty;
            var pending = _reparentPending;
            if (pending == null || pending.OperationId != message.operationId) return true;
            var state = changed.Find(item => item.SceneId == message.sceneId && item.ObjectId == message.objectId);
            if (message.requestId != _pendingOperation.RequestId || message.sceneId != _pendingOperation.SceneId ||
                message.objectId != _pendingOperation.ObjectId || message.kind != "reparent_object" ||
                message.userId != TeamForgeConnectionService.Settings.UserId.Trim() || message.componentTopologyChanged ||
                message.deletedObjectIds.Length != 0 || state == null || !TryReadSharedPlacement(state, out var accepted) ||
                (pending.Reviewed && !accepted.Matches(pending.Desired)))
            { error = "The reparent acknowledgement does not match the pending placement."; return false; }

            if (!TryRenameScope(out var scope)) return FailRenameContext(out error);
            if (!TryRenameTarget(state, out var target)) return true;
            if (!TryReadLocalPlacement(state.SceneId, target, out var live))
            { error = "The accepted placement has a newer unresolved local target. Preserve the Scene before reconnecting."; return false; }
            if (!live.Matches(pending.LiveAtSend) && !live.Matches(accepted))
            {
                if (live.parentObjectId != accepted.parentObjectId)
                    return ArchiveReparent(scope, state, target, accepted, live, true, null, out _, out error);
                return true; // A newer same-parent pose belongs to Transform and remains in the Editor.
            }
            return !pending.Reviewed || ApplyRecoveryPlacement(state.SceneId, state.ObjectId, target, accepted, out error);
        }

        private static bool PreserveReparentBeforeApply(TeamForgeHierarchyState state, GameObject target, out string error)
        {
            error = string.Empty;
            if (!TeamForgeConnectionService.HierarchyReparentRecoveryAvailable) return true;
            if (!TryRenameScope(out var scope)) return FailRenameContext(out error);
            if (!Authoritative.TryGet(state.SceneId, state.ObjectId, out var current) || !TryRenameTarget(current, out var exact) || exact != target ||
                !TryFindPlacementParent(current.SceneId, current.ParentObjectId, out _, out var confirmedParent) || target.transform.parent == confirmedParent)
                return true;
            return TryReadPlacements(current, target, out var before, out var live, out error) &&
                ArchiveReparent(scope, current, target, before, live, true, null, out _, out error);
        }

        private static void ConfirmSharedReparents(IEnumerable<TeamForgeHierarchyState> states)
        {
            if (!TeamForgeConnectionService.HierarchyReparentRecoveryAvailable || !TryRenameScope(out var scope)) return;
            foreach (var state in states)
            {
                var key = RenameKey(scope, state);
                if (!ReparentRecovery.TryGet(key, out var row) || row.createdRevision != state.CreatedRevision ||
                    !TryReadSharedPlacement(state, out var shared) || !row.desired.Matches(shared)) continue;
                if (!ReparentRecovery.Remove(key, out var error)) SetStatus(error);
            }
        }

        internal static bool TryRecoveryReparentShared(string key, out TeamForgeHierarchyState shared,
            out long sessionRevision, out long transformRevision)
        {
            sessionRevision = Authority.SessionRevision;
            transformRevision = 0;
            return TryGetRecoveryReparent(key, out _, out shared) &&
                TeamForgeTransformSyncService.TryReparentRecoveryRevision(shared.SceneId, shared.ObjectId, out transformRevision);
        }

        private static bool TryGetRecoveryReparent(string key, out TeamForgeHierarchyReparentRecoveryRow row, out TeamForgeHierarchyState shared)
        {
            shared = null;
            return ReparentRecovery.TryGet(key, out row) && SnapshotReady && TeamForgeConnectionService.HierarchyReparentRecoveryAvailable &&
                TryRenameScope(out var scope) && row.scope.Key == scope.Key && Authoritative.TryGet(row.sceneId, row.objectId, out shared) &&
                row.createdRevision == shared.CreatedRevision;
        }

        private static bool TryRecoveryReparentTarget(string key, out TeamForgeHierarchyReparentRecoveryRow row,
            out TeamForgeHierarchyState shared, out GameObject target, out string error)
        {
            target = null;
            error = "Join the same durable Session and load the exact saved non-Prefab target before reviewing this placement.";
            if (!TryGetRecoveryReparent(key, out row, out shared) || EditorApplication.isPlayingOrWillChangePlaymode ||
                !TryRenameTarget(shared, out target) || row.scenePath != target.scene.path || !TeamForgeColliderSyncService.IsSceneEditReady(row.sceneId))
                return false;
            error = string.Empty;
            return true;
        }

        internal static bool SelectRecoveryReparentTarget(string key, out string error)
        {
            if (!TryRecoveryReparentTarget(key, out _, out _, out var target, out error)) return false;
            using (TeamForgeTransformSyncService.SuppressSelectionLock())
            {
                if (Selection.activeGameObject == target && TeamForgeTransformSyncService.TrackedObject != target)
                    Selection.activeGameObject = null;
                Selection.activeGameObject = target;
            }
            return true;
        }

        internal static bool RestoreSharedRecoveryPlacement(string key, out string error)
        {
            if (!TryRecoveryReparentTarget(key, out var row, out var shared, out var target, out error)) return false;
            if (IsOperationPendingFor(row.sceneId, row.objectId) || !TeamForgeTransformSyncService.TryReparentRecoveryRevision(row.sceneId, row.objectId, out _))
            { error = "Wait for this target's Hierarchy and Transform results before restoring its placement."; return false; }
            if (!TryReadPlacements(shared, target, out var before, out var live, out error)) return false;
            if (live.Matches(before)) return true;
            if (!live.Matches(row.desired))
            {
                if (live.parentObjectId == before.parentObjectId)
                { error = "This target has a newer same-parent order or pose. Preserve it before restoring the shared placement."; return false; }
                if (!ArchiveReparent(row.scope, shared, target, before, live, true, null, out _, out error)) return false;
                error = "A newer local placement was preserved. Review it before restoring the shared placement.";
                RaiseChanged();
                return false;
            }
            if (!ApplyRecoveryPlacement(row.sceneId, row.objectId, target, before, out error)) return false;
            RaiseChanged();
            return true;
        }

        internal static bool RequestRecoveryReparentLock(string key, out string error)
        {
            if (!TryRecoveryReparentTarget(key, out var row, out var shared, out var target, out error)) return false;
            if (!TryReadPlacements(shared, target, out var before, out var live, out error)) return false;
            if (!live.Matches(before) || Selection.activeGameObject != target || Selection.gameObjects.Length != 1 ||
                TeamForgeTransformSyncService.TrackedObject != target || TeamForgeTransformSyncService.SelectedObjectId != row.objectId)
            { error = "Restore and select this exact target before requesting its lock."; return false; }
            if (Authority.Locks.TryGet(row.sceneId, row.objectId, out var lease) && lease.ownerConnectionId == Authority.ConnectionId) return true;
            if (TeamForgeTransformSyncService.RequestSelectedLock()) return true;
            error = "The selected target's lock could not be requested. Check the current lock status.";
            return false;
        }

        internal static bool ResubmitRecoveryReparent(string key, long reviewedSessionRevision, long reviewedHierarchyRevision,
            long reviewedTransformRevision, out string error)
        {
            if (!TryRecoveryReparentTarget(key, out var row, out var shared, out var target, out error)) return false;
            if (!TryRecoveryReparentShared(key, out _, out var sessionRevision, out var transformRevision) ||
                reviewedSessionRevision != sessionRevision || reviewedHierarchyRevision != shared.HierarchyRevision || reviewedTransformRevision != transformRevision)
            { error = "Shared state changed. Review the current placement before resubmitting."; return false; }
            if (!TryReadPlacements(shared, target, out var before, out var live, out error)) return false;
            if (row.desired.Matches(before)) return ReparentRecovery.Remove(key, out error);
            if (row.desired.parentObjectId == shared.ParentObjectId || !TryFindPlacementParent(row.sceneId, row.desired, target, out _))
            { error = "The reviewed destination is unavailable or already the shared parent. Preserve the archived pose for manual review."; return false; }
            var availableIndex = Authoritative.SceneSnapshot(row.sceneId).FindAll(state =>
                state.ParentObjectId == row.desired.parentObjectId && state.ObjectId != row.objectId).Count;
            if (row.desired.siblingIndex > availableIndex)
            { error = "The destination no longer has the reviewed sibling position."; return false; }
            if (_pendingOperation != null || PendingSeeds.Count != 0 || !live.Matches(before) ||
                Selection.activeGameObject != target || Selection.gameObjects.Length != 1 ||
                !TeamForgeTransformSyncService.TryGetSelectedLock(out var lease) || lease.sceneId != row.sceneId ||
                lease.objectId != row.objectId || lease.ownerConnectionId != Authority.ConnectionId ||
                ParentLockedByOther(row.sceneId, before.parentObjectId) || ParentLockedByOther(row.sceneId, row.desired.parentObjectId) ||
                IsReconciliationPendingFor(row.sceneId, row.objectId, target))
            { error = "Restore and select this target, then acquire its fresh TeamForge lock before resubmitting."; return false; }
            var command = new ReviewedReparentCommand {
                type = "hierarchy_operation", kind = "reparent_object", protocolVersion = TeamForgeProtocol.Version,
                requestId = Guid.NewGuid().ToString("N"), operationId = Guid.NewGuid().ToString("N"),
                userId = TeamForgeConnectionService.Settings.UserId.Trim(), sceneId = row.sceneId, objectId = row.objectId,
                baseRevision = reviewedSessionRevision, expectedHierarchyRevision = reviewedHierarchyRevision,
                expectedTransformRevision = reviewedTransformRevision, parentObjectId = row.desired.parentObjectId,
                siblingIndex = row.desired.siblingIndex, localPosition = row.desired.pose.PositionDto(),
                localRotation = row.desired.pose.RotationDto(), localScale = row.desired.pose.ScaleDto(),
            };
            row.before = before;
            row.operationId = command.operationId;
            row.authorityEpoch = TeamForgeConnectionService.AuthorityEpoch;
            row.needsReview = true;
            if (!ReparentRecovery.Put(row, out error)) return false;
            if (SendTrackedReparent(command, command.requestId, row, live, true)) return true;
            error = "The reviewed reparent could not be sent. Its recovery entry remains available.";
            return false;
        }

        internal static bool DiscardRecoveryReparent(string key, out string error)
        {
            if (_reparentPending?.Key == key)
            { error = "Wait for the pending placement result or disconnect before discarding this entry."; return false; }
            if (TryGetRecoveryReparent(key, out _, out var shared) && TryRenameTarget(shared, out var target) &&
                (!TryReadPlacements(shared, target, out var before, out var live, out _) || live.parentObjectId != before.parentObjectId))
            { error = "Restore the shared parent before discarding so the local reparent is not sent as a new edit."; return false; }
            if (!ReparentRecovery.Remove(key, out error)) return false;
            RaiseChanged();
            return true;
        }

        private static bool ApplyRecoveryPlacement(string sceneId, string objectId, GameObject target,
            TeamForgeReparentPlacement placement, out string error)
        {
            if (!TryFindPlacementParent(sceneId, placement, target, out var parent))
            { error = "The exact saved parent is unavailable. The current local placement was preserved."; return false; }
            var maximumIndex = (parent != null ? parent.childCount : target.scene.rootCount) - (target.transform.parent == parent ? 1 : 0);
            if (placement.siblingIndex > maximumIndex)
            { error = "The native destination no longer has the reviewed sibling position. Preserve local Hierarchy changes before retrying."; return false; }
            using (TeamForgeRemoteApplyScope.Enter())
            {
                Undo.ClearUndo(target.transform);
                target.transform.SetParent(parent, false);
                target.transform.localPosition = placement.pose.LocalPosition;
                target.transform.localRotation = placement.pose.LocalRotation;
                target.transform.localScale = placement.pose.LocalScale;
                target.transform.SetSiblingIndex(placement.siblingIndex);
                EditorSceneManager.MarkSceneDirty(target.scene);
            }
            TeamForgeTransformSyncService.ConfirmHierarchyRecoveryTransform(sceneId, objectId, placement.pose);
            error = string.Empty;
            return true;
        }
    }
}

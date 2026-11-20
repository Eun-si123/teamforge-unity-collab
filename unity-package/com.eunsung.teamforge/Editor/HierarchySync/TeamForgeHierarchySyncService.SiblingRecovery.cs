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
        private static readonly TeamForgeHierarchySiblingRecoveryStore SiblingRecovery = new TeamForgeHierarchySiblingRecoveryStore(
            Path.Combine(Directory.GetCurrentDirectory(), "Library", "TeamForge", "HierarchySiblingRecovery-v1.json"));
        private static PendingSiblingRecovery _siblingPending;
        private static bool _siblingScopeEnabled;
        internal static string SiblingRecoveryArchiveError { get; private set; } = string.Empty;

        private sealed class PendingSiblingRecovery
        {
            internal string Key, OperationId;
            internal TeamForgeSiblingRecoveryMember[] Desired, LiveAtSend;
        }

        [Serializable]
        private sealed class ReviewedSiblingCommand : ProtocolEnvelope
        {
            public string kind, operationId, userId, sceneId, objectId, parentObjectId;
            public long baseRevision, expectedHierarchyRevision;
            public int siblingIndex;
        }

        private static void InitializeSiblingRecovery()
        {
            if (SiblingRecovery.Load(out var error)) return;
            SiblingRecoveryArchiveError = error;
            TeamForgeDiagnostics.Warning(error);
        }

        internal static IReadOnlyList<TeamForgeHierarchySiblingRecoveryRow> RecoverySiblingRows() => SiblingRecovery.Rows();

        private static List<TeamForgeHierarchyState> SiblingGroup(IEnumerable<TeamForgeHierarchyState> states, string sceneId, string parentId)
        {
            var group = new List<TeamForgeHierarchyState>();
            foreach (var state in states)
                if (state.SceneId == sceneId && state.ParentObjectId == parentId) group.Add(state);
            group.Sort((left, right) => left.SiblingIndex.CompareTo(right.SiblingIndex));
            return group;
        }

        private static TeamForgeSiblingRecoveryMember[] SiblingMembers(List<TeamForgeHierarchyState> group)
        {
            var members = new TeamForgeSiblingRecoveryMember[group.Count];
            for (var index = 0; index < group.Count; index++)
            {
                var state = group[index];
                if (state.SiblingIndex != index) return null;
                members[index] = new TeamForgeSiblingRecoveryMember { objectId = state.ObjectId, createdRevision = state.CreatedRevision };
            }
            return members;
        }

        private static bool TryReadSiblingGroup(List<TeamForgeHierarchyState> group, Scene scene, Transform parent,
            out TeamForgeSiblingRecoveryMember[] shared, out TeamForgeSiblingRecoveryMember[] native, out string selectedId)
        {
            shared = SiblingMembers(group);
            native = null;
            selectedId = null;
            if (shared == null || (parent != null ? parent.childCount : scene.rootCount) != group.Count) return false;
            var seenNative = new HashSet<int>();
            var members = new TeamForgeSiblingRecoveryMember[group.Count];
            for (var index = 0; index < group.Count; index++)
            {
                if (!TeamForgeObjectIdentity.TryResolveGameObject(group[index].ObjectId, out var target) ||
                    target == null || target.scene != scene || target.transform.parent != parent) return false;
                var nativeIndex = target.transform.GetSiblingIndex();
                if (nativeIndex < 0 || nativeIndex >= group.Count || !seenNative.Add(nativeIndex)) return false;
                members[nativeIndex] = shared[index];
                if (Selection.activeGameObject == target && Selection.gameObjects.Length == 1) selectedId = group[index].ObjectId;
            }
            native = members;
            return true;
        }

        private static bool CaptureSiblingGroup(TeamForgeTransformRecoveryScope scope, Scene scene, string sceneId, string parentId,
            List<TeamForgeHierarchyState> group, bool review, out TeamForgeHierarchySiblingRecoveryRow row, out string error,
            bool requireStableMembers = false)
        {
            row = null;
            error = string.Empty;
            SiblingRecovery.TryGetGroup(scope.Key, sceneId, parentId, out var previous);
            if (!TryFindPlacementParent(sceneId, parentId, out var parentGeneration, out var parent) ||
                !TryReadSiblingGroup(group, scene, parent, out var before, out var native, out var selected))
            {
                // A different child set can be an ordinary pending create,
                // delete or reparent. It never identifies a sibling move.
                if (!requireStableMembers && previous == null) return true;
                error = "A sibling recovery group has different or unresolved children. Preserve the Scene before continuing.";
                return false;
            }
            if (TeamForgeSiblingOrder.SameOrder(before, native)) return true;
            if (previous != null && (previous.parentCreatedRevision != parentGeneration ||
                !TeamForgeSiblingOrder.SameOrder(previous.beforeOrder, before)))
            {
                error = "The shared sibling group changed after the archived move. Preserve local order before continuing.";
                return false;
            }
            var difference = TeamForgeSiblingOrder.Compare(before, native, previous?.objectId ?? selected,
                out var beforeIndex, out var desiredIndex);
            if (difference != TeamForgeSiblingOrderChange.SingleMove || !TryRenameTarget(group[beforeIndex], out var moved) ||
                (previous != null && previous.objectId != group[beforeIndex].ObjectId))
            {
                error = "The local sibling order does not identify one exact saved non-Prefab move. Preserve the Scene and resolve its order manually.";
                return false;
            }
            var target = group[beforeIndex];
            row = new TeamForgeHierarchySiblingRecoveryRow {
                scope = scope, sceneId = sceneId, scenePath = moved.scene.path, parentObjectId = parentId,
                parentCreatedRevision = parentGeneration, objectId = target.ObjectId, createdRevision = target.CreatedRevision,
                authorityEpoch = _renameAuthorityEpoch, operationId = previous?.operationId ?? string.Empty,
                beforeOrder = before, desiredOrder = native, beforeIndex = beforeIndex, desiredIndex = desiredIndex,
                needsReview = review || (previous?.needsReview ?? false) || ParentLockedByOther(sceneId, target.ObjectId) || ParentLockedByOther(sceneId, parentId),
            };
            if (previous != null && previous.authorityEpoch == row.authorityEpoch && previous.needsReview == row.needsReview &&
                TeamForgeSiblingOrder.SameOrder(previous.desiredOrder, row.desiredOrder)) return true;
            return SiblingRecovery.Put(row, out error);
        }

        private static bool PreserveLocalSiblingOrders(TeamForgeTransformRecoveryScope scope, bool review, Scene sceneOnly, out string error)
        {
            error = string.Empty;
            if (!_siblingScopeEnabled) return true;
            foreach (var sceneId in AuthoritativeSceneIds)
            {
                if (!TryFindLoadedScene(sceneId, out var scene) || (sceneOnly.IsValid() && sceneOnly != scene)) continue;
                var states = Authoritative.SceneSnapshot(sceneId);
                var parents = new HashSet<string>(StringComparer.Ordinal);
                foreach (var state in states) parents.Add(state.ParentObjectId);
                foreach (var parentId in parents)
                    if (!CaptureSiblingGroup(scope, scene, sceneId, parentId, SiblingGroup(states, sceneId, parentId), review, out _, out error)) return false;
            }
            return true;
        }

        private static void RetireSiblingRows(TeamForgeTransformRecoveryScope scope)
        {
            foreach (var row in SiblingRecovery.Rows())
            {
                if (row.needsReview || row.scope.Key != scope.Key) continue;
                row.needsReview = true;
                if (!SiblingRecovery.Put(row, out var error)) SetStatus(error);
            }
        }

        private static bool PreserveSiblingSnapshot(List<TeamForgeHierarchyState> states, bool first, out string error)
        {
            error = string.Empty;
            if (!TeamForgeConnectionService.HierarchySiblingRecoveryAvailable) return true;
            if (!TryRenameScope(out var scope)) return FailRenameContext(out error);
            if (!first) return PreserveLocalSiblingOrders(scope, true, default, out error);
            foreach (var row in SiblingRecovery.Rows())
            {
                if (row.scope.Key != scope.Key || !TryFindLoadedScene(row.sceneId, out var scene) || row.scenePath != scene.path) continue;
                Transform parent = null;
                if (row.parentObjectId.Length != 0)
                {
                    if (!TeamForgeObjectIdentity.TryResolveGameObject(row.parentObjectId, out var owner) || owner == null || owner.scene != scene)
                        continue; // No live group will be overwritten.
                    parent = owner.transform;
                }
                var incoming = SiblingGroup(states, row.sceneId, row.parentObjectId);
                if (TryReadSiblingGroup(incoming, scene, parent, out var next, out var existing, out _) &&
                    TeamForgeSiblingOrder.SameOrder(next, existing)) continue;

                // The archive already owns this exact local group. A third
                // arrangement or changed membership needs manual review first.
                var archived = new List<TeamForgeHierarchyState>(row.beforeOrder.Length);
                for (var index = 0; index < row.beforeOrder.Length; index++)
                    archived.Add(new TeamForgeHierarchyState { ObjectId = row.beforeOrder[index].objectId,
                        CreatedRevision = row.beforeOrder[index].createdRevision, SiblingIndex = index });
                if (TryReadSiblingGroup(archived, scene, parent, out _, out var native, out _) &&
                    (TeamForgeSiblingOrder.SameOrder(native, row.beforeOrder) ||
                     (TeamForgeSiblingOrder.SameOrder(native, row.desiredOrder) &&
                      TeamForgeSiblingOrder.SameOrder(SiblingMembers(incoming), row.beforeOrder)))) continue;
                error = "A preserved sibling group has additional local or shared order or membership changes. Preserve the Scene before applying the shared snapshot.";
                return false;
            }
            return true;
        }

        private static bool IsSavedSiblingDraft(Scene scene, TeamForgeHierarchyState state, List<TeamForgeHierarchyState> states)
        {
            if (!TeamForgeConnectionService.HierarchySiblingRecoveryAvailable || !TryRenameScope(out var scope) ||
                !SiblingRecovery.TryGetGroup(scope.Key, state.SceneId, state.ParentObjectId, out var row) || row.scenePath != scene.path) return false;
            Transform parent = null;
            if (row.parentObjectId.Length != 0)
            {
                var owner = states.Find(item => item.SceneId == row.sceneId && item.ObjectId == row.parentObjectId);
                if (owner == null || owner.CreatedRevision != row.parentCreatedRevision || !TryRenameTarget(owner, out var target)) return false;
                parent = target.transform;
            }
            return TryReadSiblingGroup(SiblingGroup(states, state.SceneId, state.ParentObjectId), scene, parent, out var shared, out var native, out _) &&
                TeamForgeSiblingOrder.SameOrder(shared, row.beforeOrder) && TeamForgeSiblingOrder.SameOrder(native, row.desiredOrder);
        }

        private static bool ShouldApplySiblingReceipt(HierarchyAppliedMessage message, bool ownPending)
        {
            if (message.kind != "reorder_sibling" || !TeamForgeConnectionService.HierarchySiblingRecoveryAvailable) return false;
            return ownPending ? _siblingPending?.OperationId == message.operationId :
                Authoritative.TryGet(message.sceneId, message.objectId, out var state) && TryRenameTarget(state, out _) &&
                TryFindPlacementParent(state.SceneId, state.ParentObjectId, out _, out _);
        }

        private static bool PreserveSiblingBeforeRemoteApply(HierarchyAppliedMessage message, List<TeamForgeHierarchyState> changed,
            out bool restoredGroup, out string error)
        {
            restoredGroup = false;
            error = string.Empty;
            if (!TeamForgeConnectionService.HierarchySiblingRecoveryAvailable || !TryFindLoadedScene(message.sceneId, out var scene)) return true;
            var parents = new HashSet<string>(StringComparer.Ordinal);
            foreach (var state in changed)
            {
                if (!Authoritative.TryGet(state.SceneId, state.ObjectId, out var previous)) parents.Add(state.ParentObjectId);
                else if (previous.ParentObjectId != state.ParentObjectId || previous.SiblingIndex != state.SiblingIndex)
                { parents.Add(previous.ParentObjectId); parents.Add(state.ParentObjectId); }
            }
            foreach (var objectId in message.deletedObjectIds)
                if (Authoritative.TryGet(message.sceneId, objectId, out var deleted)) parents.Add(deleted.ParentObjectId);
            if (parents.Count == 0) return true;
            if (!TryRenameScope(out var scope)) return FailRenameContext(out error);
            var before = Authoritative.SceneSnapshot(message.sceneId);
            var restorations = new List<(TeamForgeHierarchySiblingRecoveryRow Row, List<TeamForgeHierarchyState> Group, Transform Parent)>();
            foreach (var parentId in parents)
            {
                // An unrelated group with an older non-recoverable parent
                // keeps the ordinary remote path unless it has a saved draft.
                if (!TryFindPlacementParent(message.sceneId, parentId, out _, out var parent) &&
                    !SiblingRecovery.TryGetGroup(scope.Key, message.sceneId, parentId, out _)) continue;
                var group = SiblingGroup(before, message.sceneId, parentId);
                if (!CaptureSiblingGroup(scope, scene, message.sceneId, parentId, group,
                    true, out var row, out error, requireStableMembers: true)) return false;
                if (row != null) restorations.Add((row, group, parent));
            }
            // Topology reports only the affected records. Restore their expected
            // old order after every touched group has been archived and checked.
            foreach (var (row, group, parent) in restorations)
            {
                restoredGroup = true;
                if (!MoveNativeSibling(row.sceneId, row.objectId, parent, row.beforeIndex, out error)) return false;
                if (!TryReadSiblingGroup(group, scene, parent, out _, out var native, out _) ||
                    !TeamForgeSiblingOrder.SameOrder(native, row.beforeOrder))
                {
                    error = "The native sibling group could not be restored to its shared order. Its draft remains available in Session Recovery.";
                    return false;
                }
            }
            return true;
        }

        private static void SendDurableLocalSibling(string sceneId, string parentId, List<TeamForgeHierarchyState> previous)
        {
            if (!TryRenameScope(out var scope) || !TryFindLoadedScene(sceneId, out var scene)) return;
            var group = SiblingGroup(previous, sceneId, parentId);
            if (!SiblingRecovery.TryGetGroup(scope.Key, sceneId, parentId, out _) &&
                TrySendUnboundSibling(scene, sceneId, parentId, group)) return;
            if (!CaptureSiblingGroup(scope, scene, sceneId, parentId, group, false, out var row, out var error))
            { PauseHierarchyRecovery(error); return; }
            if (row == null)
            { PauseHierarchyRecovery("The changed sibling group does not match its exact saved membership."); return; }
            if (row.needsReview)
            { SetStatus("A sibling move is preserved in Session Recovery for review."); return; }
            var state = group[row.beforeIndex];
            var desired = state.Clone();
            desired.SiblingIndex = row.desiredIndex;
            var message = CreateOperation("reorder_sibling", desired, state);
            row.operationId = message.operationId;
            if (!SiblingRecovery.Put(row, out error)) { PauseHierarchyRecovery(error); return; }
            SendTrackedSibling(message, message.requestId, row, row.desiredOrder);
        }

        private static bool TrySendUnboundSibling(Scene scene, string sceneId, string parentId, List<TeamForgeHierarchyState> group)
        {
            Transform parent = null;
            if (parentId.Length != 0)
            {
                if (!TeamForgeObjectIdentity.TryResolveGameObject(parentId, out var owner) || owner == null || owner.scene != scene || IsUnsafePrefabContext(owner))
                    return false;
                parent = owner.transform;
            }
            if (!TryReadSiblingGroup(group, scene, parent, out var before, out var native, out var selected) ||
                TeamForgeSiblingOrder.Compare(before, native, selected, out var previousIndex, out var desiredIndex) != TeamForgeSiblingOrderChange.SingleMove)
                return false;
            var original = group[previousIndex];
            if (TryRenameTarget(original, out _) && TryFindPlacementParent(sceneId, parentId, out _, out _)) return false;
            if (!TeamForgeObjectIdentity.TryResolveGameObject(original.ObjectId, out var target) || target == null || target.scene != scene ||
                IsUnsafePrefabContext(target) || ParentLockedByOther(sceneId, original.ObjectId) || ParentLockedByOther(sceneId, parentId)) return false;
            var desired = original.Clone();
            desired.SiblingIndex = desiredIndex;
            SendOperation(CreateOperation("reorder_sibling", desired, original));
            return true;
        }

        private static bool SendTrackedSibling(object wire, string requestId, TeamForgeHierarchySiblingRecoveryRow row,
            TeamForgeSiblingRecoveryMember[] live)
        {
            _siblingPending = new PendingSiblingRecovery { Key = row.Key, OperationId = row.operationId,
                Desired = row.desiredOrder, LiveAtSend = live };
            var pending = new TeamForgePendingHierarchyOperation(row.operationId, requestId, row.sceneId, row.objectId, "reorder_sibling");
            if (TrySendOperation(wire, pending)) return true;
            MarkSiblingForReview(pending, "The sibling move was not sent.");
            return false;
        }

        private static bool MarkSiblingForReview(TeamForgePendingHierarchyOperation pending, string explanation)
        {
            if (_siblingPending?.OperationId != pending.OperationId) return false;
            var recovery = _siblingPending;
            _siblingPending = null;
            if (SiblingRecovery.TryGet(recovery.Key, out var row) && !row.needsReview)
            {
                row.needsReview = true;
                if (!SiblingRecovery.Put(row, out var error)) { PauseHierarchyRecovery(error); return true; }
            }
            SetStatus(explanation + " The saved order remains available in Session Recovery.");
            return true;
        }

        private static bool TrySiblingReceipt(HierarchyAppliedMessage message, List<TeamForgeHierarchyState> changed,
            out List<TeamForgeHierarchyState> before, out TeamForgeHierarchyState moved, out TeamForgeSiblingRecoveryMember[] after)
        {
            before = null;
            after = null;
            moved = null;
            if (message.componentTopologyChanged || message.deletedObjectIds.Length != 0 ||
                !Authoritative.TryGet(message.sceneId, message.objectId, out var original)) return false;
            before = SiblingGroup(Authoritative.SceneSnapshot(message.sceneId), message.sceneId, original.ParentObjectId);
            var combined = ToDictionary(before);
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var item in changed)
            {
                if (!seen.Add(item.ObjectId) || !combined.TryGetValue(item.ObjectId, out var prior) || item.SceneId != message.sceneId ||
                    item.ParentObjectId != prior.ParentObjectId || item.CreatedRevision != prior.CreatedRevision || item.Name != prior.Name ||
                    item.PrimitiveTemplate != prior.PrimitiveTemplate || !item.Transform.ApproximatelyEquals(prior.Transform)) return false;
                if (item.ObjectId == message.objectId) moved = item;
                combined[item.ObjectId] = item;
            }
            if (moved == null) return false;
            after = SiblingMembers(SiblingGroup(combined.Values, message.sceneId, original.ParentObjectId));
            var move = TeamForgeSiblingOrder.Compare(SiblingMembers(before), after, message.objectId, out var oldIndex, out var newIndex);
            return move == TeamForgeSiblingOrderChange.Unchanged ||
                (move == TeamForgeSiblingOrderChange.SingleMove && before[oldIndex].ObjectId == message.objectId && newIndex == moved.SiblingIndex);
        }

        private static bool ApplySiblingReceipt(HierarchyAppliedMessage message, List<TeamForgeHierarchyState> changed, bool ownPending, out string error)
        {
            error = "The Coordinator sibling result does not match one exact move in the verified group. Preserve the native Scene.";
            if (!TryRenameScope(out var scope)) return FailRenameContext(out error);
            if (!TrySiblingReceipt(message, changed, out var before, out var moved, out var accepted)) return false;
            if (ownPending && (_siblingPending == null || _siblingPending.OperationId != message.operationId ||
                message.requestId != _pendingOperation.RequestId || message.sceneId != _pendingOperation.SceneId ||
                message.objectId != _pendingOperation.ObjectId || message.userId != TeamForgeConnectionService.Settings.UserId.Trim() ||
                !TeamForgeSiblingOrder.SameOrder(accepted, _siblingPending.Desired))) return false;
            if (!TryRenameTarget(moved, out var target) || !TryFindPlacementParent(moved.SceneId, moved.ParentObjectId, out _, out var parent) ||
                !TryReadSiblingGroup(before, target.scene, parent, out var shared, out var native, out _)) return false;
            if (TeamForgeSiblingOrder.SameOrder(native, accepted)) { error = string.Empty; return true; }
            if (ownPending)
            {
                if (!TeamForgeSiblingOrder.SameOrder(native, _siblingPending.LiveAtSend))
                {
                    // Keep a newer local permutation intact unless it is one
                    // verifiable move of the same child after the committed order.
                    var currentGroup = SiblingGroup(Authoritative.SceneSnapshot(moved.SceneId), moved.SceneId, moved.ParentObjectId);
                    var byId = ToDictionary(currentGroup);
                    foreach (var item in changed) byId[item.ObjectId] = item;
                    return PreserveNewerSiblingAfterReceipt(scope, target.scene, moved, SiblingGroup(byId.Values, moved.SceneId, moved.ParentObjectId), out error);
                }
            }
            else if (!TeamForgeSiblingOrder.SameOrder(native, shared))
            {
                if (!CaptureSiblingGroup(scope, target.scene, moved.SceneId, moved.ParentObjectId, before, true, out var local, out error) || local == null)
                    return false;
                if (!MoveNativeSibling(local.sceneId, local.objectId, parent, local.beforeIndex, out error)) return false;
            }
            if (!MoveNativeSibling(moved.SceneId, moved.ObjectId, parent, moved.SiblingIndex, out error)) return false;
            if (TryReadSiblingGroup(before, target.scene, parent, out _, out var applied, out _) &&
                TeamForgeSiblingOrder.SameOrder(applied, accepted)) return true;
            error = "The complete native sibling order did not match the Coordinator result. Review the Scene before reconnecting.";
            return false;
        }

        private static bool PreserveNewerSiblingAfterReceipt(TeamForgeTransformRecoveryScope scope, Scene scene, TeamForgeHierarchyState moved,
            List<TeamForgeHierarchyState> committed, out string error)
        {
            error = "The accepted move has newer unresolved local order. Preserve the native Scene before reconnecting.";
            if (!SiblingRecovery.TryGet(_siblingPending.Key, out var row) || row.scope.Key != scope.Key || row.scenePath != scene.path ||
                !TryFindPlacementParent(moved.SceneId, moved.ParentObjectId, out var generation, out var parent) ||
                generation != row.parentCreatedRevision || !TryReadSiblingGroup(committed, scene, parent, out var before, out var native, out _) ||
                TeamForgeSiblingOrder.Compare(before, native, moved.ObjectId, out var oldIndex, out var newIndex) != TeamForgeSiblingOrderChange.SingleMove ||
                committed[oldIndex].ObjectId != moved.ObjectId) return false;
            row.beforeOrder = before;
            row.beforeIndex = oldIndex;
            row.desiredOrder = native;
            row.desiredIndex = newIndex;
            row.needsReview = true;
            return SiblingRecovery.Put(row, out error);
        }

        private static bool MoveNativeSibling(string sceneId, string objectId, Transform parent, int index, out string error)
        {
            error = "The exact saved sibling target or index is unavailable. The native Scene was preserved.";
            if (!Authoritative.TryGet(sceneId, objectId, out var state) || !TryRenameTarget(state, out var target) ||
                target.transform.parent != parent || index < 0 || index >= (parent != null ? parent.childCount : target.scene.rootCount)) return false;
            if (target.transform.GetSiblingIndex() != index)
            {
                using (TeamForgeRemoteApplyScope.Enter())
                {
                    target.transform.SetSiblingIndex(index);
                    EditorSceneManager.MarkSceneDirty(target.scene);
                }
            }
            error = string.Empty;
            return true;
        }

        private static void ConfirmSharedSiblingOrders()
        {
            if (!TeamForgeConnectionService.HierarchySiblingRecoveryAvailable || !TryRenameScope(out var scope)) return;
            foreach (var row in SiblingRecovery.Rows())
            {
                if (row.scope.Key != scope.Key || !Authoritative.TryGet(row.sceneId, row.objectId, out var shared) ||
                    shared.CreatedRevision != row.createdRevision || shared.ParentObjectId != row.parentObjectId ||
                    !TryFindPlacementParent(row.sceneId, row.parentObjectId, out var generation, out _) || generation != row.parentCreatedRevision ||
                    !TeamForgeSiblingOrder.SameOrder(row.desiredOrder, SiblingMembers(SiblingGroup(Authoritative.SceneSnapshot(row.sceneId), row.sceneId, row.parentObjectId)))) continue;
                if (!SiblingRecovery.Remove(row.Key, out var error)) SetStatus(error);
            }
        }

        internal static bool TryRecoverySiblingShared(string key, out TeamForgeHierarchyState shared, out long sessionRevision)
        {
            sessionRevision = Authority.SessionRevision;
            return TryGetRecoverySibling(key, out _, out shared);
        }

        internal static TeamForgeSiblingRecoveryMember[] RecoverySiblingSharedOrder(TeamForgeHierarchyState shared) =>
            SiblingMembers(SiblingGroup(Authoritative.SceneSnapshot(shared.SceneId), shared.SceneId, shared.ParentObjectId));

        private static bool TryGetRecoverySibling(string key, out TeamForgeHierarchySiblingRecoveryRow row, out TeamForgeHierarchyState shared)
        {
            shared = null;
            return SiblingRecovery.TryGet(key, out row) && SnapshotReady && TeamForgeConnectionService.HierarchySiblingRecoveryAvailable &&
                TryRenameScope(out var scope) && row.scope.Key == scope.Key && Authoritative.TryGet(row.sceneId, row.objectId, out shared) &&
                row.createdRevision == shared.CreatedRevision && shared.ParentObjectId == row.parentObjectId;
        }

        private static bool TryRecoverySiblingTarget(string key, out TeamForgeHierarchySiblingRecoveryRow row, out TeamForgeHierarchyState shared,
            out GameObject target, out Transform parent, out TeamForgeSiblingRecoveryMember[] before, out TeamForgeSiblingRecoveryMember[] native, out string error)
        {
            target = null;
            parent = null;
            before = native = null;
            error = "Join the same durable Session and load the exact saved sibling group before reviewing this move.";
            if (!TryGetRecoverySibling(key, out row, out shared) || EditorApplication.isPlayingOrWillChangePlaymode ||
                !TryRenameTarget(shared, out target) || row.scenePath != target.scene.path || !TeamForgeColliderSyncService.IsSceneEditReady(row.sceneId) ||
                !TryFindPlacementParent(row.sceneId, row.parentObjectId, out var generation, out parent) || generation != row.parentCreatedRevision ||
                !TryReadSiblingGroup(SiblingGroup(Authoritative.SceneSnapshot(row.sceneId), row.sceneId, row.parentObjectId), target.scene, parent,
                    out before, out native, out _)) return false;
            error = string.Empty;
            return true;
        }

        internal static bool SelectRecoverySiblingTarget(string key, out string error)
        {
            if (!TryRecoverySiblingTarget(key, out _, out _, out var target, out _, out _, out _, out error)) return false;
            using (TeamForgeTransformSyncService.SuppressSelectionLock())
            {
                if (Selection.activeGameObject == target && TeamForgeTransformSyncService.TrackedObject != target) Selection.activeGameObject = null;
                Selection.activeGameObject = target;
            }
            return true;
        }

        internal static bool RestoreSharedRecoverySiblingOrder(string key, out string error)
        {
            if (!TryRecoverySiblingTarget(key, out var row, out _, out _, out var parent, out var shared, out var live, out error)) return false;
            if (_pendingOperation != null) { error = "Wait for the pending Hierarchy result before restoring order."; return false; }
            if (TeamForgeSiblingOrder.SameOrder(shared, live)) return true;
            if (!TeamForgeSiblingOrder.SameOrder(shared, row.beforeOrder) || !TeamForgeSiblingOrder.SameOrder(live, row.desiredOrder))
            { error = "The native or shared group changed. Preserve its present order before reconciling this move manually."; return false; }
            if (!MoveNativeSibling(row.sceneId, row.objectId, parent, row.beforeIndex, out error)) return false;
            RaiseChanged();
            return true;
        }

        internal static bool RequestRecoverySiblingLock(string key, out string error)
        {
            if (!TryRecoverySiblingTarget(key, out var row, out _, out var target, out _, out var shared, out var live, out error)) return false;
            if (!TeamForgeSiblingOrder.SameOrder(shared, live) || Selection.activeGameObject != target || Selection.gameObjects.Length != 1 ||
                TeamForgeTransformSyncService.TrackedObject != target || TeamForgeTransformSyncService.SelectedObjectId != row.objectId)
            { error = "Restore the shared sibling order and select the exact target before requesting its lock."; return false; }
            if (Authority.Locks.TryGet(row.sceneId, row.objectId, out var lease) && lease.ownerConnectionId == Authority.ConnectionId) return true;
            if (TeamForgeTransformSyncService.RequestSelectedLock()) return true;
            error = "The selected target's lock could not be requested. Check the current lock status.";
            return false;
        }

        internal static bool ResubmitRecoverySibling(string key, long reviewedSessionRevision, long reviewedHierarchyRevision, out string error)
        {
            if (!TryRecoverySiblingTarget(key, out var row, out var shared, out var target, out _, out var order, out var live, out error)) return false;
            if (TeamForgeSiblingOrder.SameOrder(order, row.desiredOrder) && TeamForgeSiblingOrder.SameOrder(live, order))
                return SiblingRecovery.Remove(key, out error);
            if (reviewedSessionRevision != Authority.SessionRevision || reviewedHierarchyRevision != shared.HierarchyRevision ||
                !TeamForgeSiblingOrder.SameOrder(row.beforeOrder, order))
            { error = "The shared sibling order changed since this move. Keep the archive and reconcile the current order manually."; return false; }
            if (_pendingOperation != null || PendingSeeds.Count != 0 || !TeamForgeSiblingOrder.SameOrder(live, order) ||
                Selection.activeGameObject != target || Selection.gameObjects.Length != 1 ||
                !TeamForgeTransformSyncService.TryGetSelectedLock(out var lease) || lease.sceneId != row.sceneId || lease.objectId != row.objectId ||
                lease.ownerConnectionId != Authority.ConnectionId || ParentLockedByOther(row.sceneId, row.parentObjectId))
            { error = "Restore the shared sibling order, select this target and acquire its fresh TeamForge lock before resubmitting."; return false; }
            var command = new ReviewedSiblingCommand {
                type = "hierarchy_operation", kind = "reorder_sibling", protocolVersion = TeamForgeProtocol.Version,
                requestId = Guid.NewGuid().ToString("N"), operationId = Guid.NewGuid().ToString("N"),
                userId = TeamForgeConnectionService.Settings.UserId.Trim(), sceneId = row.sceneId, objectId = row.objectId,
                baseRevision = reviewedSessionRevision, expectedHierarchyRevision = reviewedHierarchyRevision,
                parentObjectId = row.parentObjectId, siblingIndex = row.desiredIndex,
            };
            row.operationId = command.operationId;
            row.authorityEpoch = TeamForgeConnectionService.AuthorityEpoch;
            row.needsReview = true;
            if (!SiblingRecovery.Put(row, out error)) return false;
            if (SendTrackedSibling(command, command.requestId, row, live)) return true;
            error = "The reviewed sibling move could not be sent. Its recovery entry remains available.";
            return false;
        }

        internal static bool DiscardRecoverySibling(string key, out string error)
        {
            if (_siblingPending?.Key == key)
            { error = "Wait for the pending sibling result or disconnect before discarding this entry."; return false; }
            if (TryGetRecoverySibling(key, out var row, out var state) && TryFindLoadedScene(row.sceneId, out var scene) &&
                (!TryFindPlacementParent(row.sceneId, row.parentObjectId, out _, out var parent) ||
                 !TryReadSiblingGroup(SiblingGroup(Authoritative.SceneSnapshot(row.sceneId), row.sceneId, state.ParentObjectId), scene, parent,
                     out var shared, out var native, out _) || !TeamForgeSiblingOrder.SameOrder(shared, native)))
            { error = "Restore the shared order before discarding so the native move is not sent as a new edit."; return false; }
            if (!SiblingRecovery.Remove(key, out error)) return false;
            RaiseChanged();
            return true;
        }
    }
}

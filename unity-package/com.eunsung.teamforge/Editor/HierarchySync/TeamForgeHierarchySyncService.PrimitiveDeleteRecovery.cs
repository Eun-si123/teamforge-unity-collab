using System;
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace EunSung.TeamForge
{
    public static partial class TeamForgeHierarchySyncService
    {
        private static readonly TeamForgePrimitiveDeleteRecoveryStore PrimitiveDeletes = new TeamForgePrimitiveDeleteRecoveryStore(
            Path.Combine(Directory.GetCurrentDirectory(), "Library", "TeamForge", "PrimitiveDeleteRecovery-v1.json"));

        internal static string PrimitiveDeleteArchiveError { get; private set; } = string.Empty;
        internal static IReadOnlyList<TeamForgePrimitiveDeleteRecoveryRow> RecoveryPrimitiveDeletes() => PrimitiveDeletes.Rows();

        private static void InitializePrimitiveDeleteRecovery()
        {
            if (PrimitiveDeletes.Load(out var error)) return;
            PrimitiveDeleteArchiveError = error;
            TeamForgeDiagnostics.Warning(error);
        }

        private static bool PreserveOfflinePrimitiveDelete(out string error)
        {
            var target = Selection.activeGameObject;
            if (_renameScope == null || !MatchesLocalRenameScope(_renameScope) || target == null || Selection.gameObjects.Length != 1 ||
                target.scene != SceneManager.GetActiveScene() || !TryGetSceneId(target.scene, out var sceneId) ||
                !TeamForgeHierarchyIdentityRegistry.TryGetKnownId(target, out var objectId) ||
                !Authoritative.TryGet(sceneId, objectId, out var shared))
            {
                error = "Select one shared Cube or Sphere from the last verified durable Scene before preserving an offline deletion.";
                return false;
            }
            if (!ValidateRecoverablePrimitiveLeaf(shared, target, out error)) return false;
            if (!PreservePrimitiveDelete(_renameScope, shared, target, out error)) return false;
            SetStatus("Deletion was preserved for review in Session Recovery.");
            return true;
        }

        private static bool ValidateRecoverablePrimitiveLeaf(TeamForgeHierarchyState shared, GameObject target, out string error)
        {
            if (!TryRenameTarget(shared, out var exact) || exact != target || target.transform.childCount != 0)
            {
                error = "Recovery requires the exact shared primitive with no native or shared children.";
                return false;
            }
            foreach (var state in Authoritative.SceneSnapshot(shared.SceneId))
                if (state.ParentObjectId == shared.ObjectId)
                {
                    error = "This primitive has a shared child. The preserved request cannot delete a subtree.";
                    return false;
                }
            if (!TeamForgePrimitiveTemplateRuntime.ValidateExisting(shared.PrimitiveTemplate, target, out error)) return false;
            foreach (var component in target.GetComponents<Component>())
                if (component == null || !(component is Transform || component is MeshFilter || component is MeshRenderer || component is Collider))
                {
                    error = "The selected primitive contains a local or missing Component. Preserve that work before reviewing deletion.";
                    return false;
                }
            return true;
        }

        private static bool HasOnlyAdmittedPrimitiveColliders(TeamForgeHierarchyState shared, GameObject target, out string error)
        {
            error = "The primitive has local Collider changes. Wait for the exact shared components before deleting it.";
            var native = new HashSet<Component>(target.GetComponents<Collider>());
            foreach (var row in TeamForgeColliderSyncService.CatalogRows())
            {
                if (row.sceneId != shared.SceneId || row.objectId != shared.ObjectId) continue;
                if (!TeamForgeColliderComponentBindings.TryResolve(row.sceneId, row.objectId, row.componentId, row.typeName,
                    out var collider, out _) || !native.Remove(collider)) return false;
            }
            if (native.Count != 0) return false;
            error = string.Empty;
            return true;
        }

        private static bool PreservePrimitiveDelete(TeamForgeTransformRecoveryScope scope, TeamForgeHierarchyState shared,
            GameObject target, out string error)
        {
            var row = new TeamForgePrimitiveDeleteRecoveryRow { scope = scope, sceneId = shared.SceneId, scenePath = target.scene.path,
                objectId = shared.ObjectId, createdRevision = shared.CreatedRevision, name = shared.Name, template = shared.PrimitiveTemplate,
                savedObjectId = TeamForgeHierarchyIdentityRegistry.HasCurrentSavedAlias(shared.ObjectId, target)
                    ? TeamForgeHierarchyIdentityRegistry.SavedAliasFor(shared.ObjectId) : string.Empty };
            if (PrimitiveDeletes.TryGet(row.Key, out _))
            {
                error = "This deletion is already preserved. Open Session Recovery to review the exact target.";
                return false;
            }
            if (!PrimitiveDeletes.Put(row, out error)) return false;
            RaiseChanged();
            return true;
        }

        private static bool TryReviewPrimitiveDelete(string key, out TeamForgeHierarchyState shared, out GameObject target,
            out string epoch, out string error)
        {
            target = null;
            shared = null;
            if (!TryPrimitiveContext(out var sceneId, out epoch, out error)) return false;
            if (!TryRenameScope(out var scope) || !PrimitiveDeletes.TryGet(key, out var row) || row.scope.Key != scope.Key ||
                row.sceneId != sceneId || row.scenePath != SceneManager.GetActiveScene().path ||
                !Authoritative.TryGet(sceneId, row.objectId, out shared) || shared.CreatedRevision != row.createdRevision ||
                shared.PrimitiveTemplate != row.template || !TryRenameTarget(shared, out target) ||
                (!string.IsNullOrEmpty(row.savedObjectId) && (!TeamForgeObjectIdentity.TryGetGlobalObjectId(target, out var current) || current != row.savedObjectId)))
            {
                error = "Join the same durable Session and load the exact saved primitive to review this deletion.";
                return false;
            }
            return ValidateRecoverablePrimitiveLeaf(shared, target, out error) && HasOnlyAdmittedPrimitiveColliders(shared, target, out error);
        }

        internal static bool TryRecoveryPrimitiveDeleteShared(string key, out TeamForgeHierarchyState shared, out long sessionRevision, out string error)
        {
            sessionRevision = Authority.SessionRevision;
            return TryReviewPrimitiveDelete(key, out shared, out _, out _, out error);
        }

        internal static bool SelectRecoveryPrimitiveDelete(string key, out string error)
        {
            if (!TryReviewPrimitiveDelete(key, out _, out var target, out _, out error)) return false;
            using (TeamForgeTransformSyncService.SuppressSelectionLock())
            {
                if (Selection.activeGameObject == target && TeamForgeTransformSyncService.TrackedObject != target) Selection.activeGameObject = null;
                Selection.activeGameObject = target;
            }
            return true;
        }

        internal static bool RequestRecoveryPrimitiveDeleteLock(string key, out string error)
        {
            if (!TryReviewPrimitiveDelete(key, out var shared, out var target, out _, out error)) return false;
            if (Selection.activeGameObject == target && Selection.gameObjects.Length == 1 &&
                TeamForgeTransformSyncService.TrackedObject == target && TeamForgeTransformSyncService.SelectedObjectId == shared.ObjectId &&
                (Authority.Locks.TryGet(shared.SceneId, shared.ObjectId, out var lease) && lease.ownerConnectionId == Authority.ConnectionId ||
                 TeamForgeTransformSyncService.RequestSelectedLock())) return true;
            error = "Select the exact primitive and acquire its current TeamForge lock.";
            return false;
        }

        internal static bool ResubmitRecoveryPrimitiveDelete(string key, long reviewedSessionRevision, out string error)
        {
            if (!TryReviewPrimitiveDelete(key, out var shared, out var target, out var epoch, out error)) return false;
            if (reviewedSessionRevision != Authority.SessionRevision)
            {
                error = "The shared Session changed. Review the current primitive again before deleting it.";
                return false;
            }
            if (Selection.activeGameObject != target || Selection.gameObjects.Length != 1 ||
                !Authority.Locks.TryGet(shared.SceneId, shared.ObjectId, out var lease) || lease.ownerConnectionId != Authority.ConnectionId)
            {
                error = "Select the exact primitive and acquire its current TeamForge lock before submitting the deletion.";
                return false;
            }
            var operation = CreateOperation("delete_object", shared, null);
            operation.baseRevision = reviewedSessionRevision;
            operation.componentEpoch = epoch;
            return SendPrimitiveOperation(operation, out error);
        }

        internal static bool DiscardRecoveryPrimitiveDelete(string key, out string error)
        {
            if (PrimitiveDeletes.TryGet(key, out var row) && IsOperationPendingFor(row.sceneId, row.objectId))
            {
                error = "Wait for the deletion result or reconnect before discarding the request.";
                return false;
            }
            if (!PrimitiveDeletes.Remove(key, out error)) return false;
            RaiseChanged();
            return true;
        }

        private static void ConfirmPrimitiveDeletes()
        {
            if (PrimitiveDeletes.Count == 0 || !SnapshotReady || !TryRenameScope(out var scope) ||
                string.IsNullOrEmpty(TeamForgeColliderSyncService.CurrentStructureEpoch)) return;
            var catalog = TeamForgeColliderSyncService.CatalogRows();
            var changed = false;
            foreach (var row in PrimitiveDeletes.Rows())
            {
                if (row.scope.Key != scope.Key || TeamForgeColliderSyncService.SceneId != row.sceneId ||
                    !IsAuthoritativelyDeleted(row.sceneId, row.objectId) || TeamForgeObjectIdentity.TryResolveGameObject(row.objectId, out _) ||
                    (!string.IsNullOrEmpty(row.savedObjectId) && TeamForgeObjectIdentity.TryResolveGameObject(row.savedObjectId, out _))) continue;
                var hasCollider = false;
                foreach (var component in catalog)
                    if (component.sceneId == row.sceneId && component.objectId == row.objectId) { hasCollider = true; break; }
                if (hasCollider) continue;
                if (PrimitiveDeletes.Remove(row.Key, out var error)) changed = true;
                else SetStatus(error);
            }
            if (changed) RaiseChanged();
        }
    }
}

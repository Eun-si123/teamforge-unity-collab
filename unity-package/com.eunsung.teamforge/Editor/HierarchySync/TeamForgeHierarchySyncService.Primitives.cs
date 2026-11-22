using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace EunSung.TeamForge
{
    public static partial class TeamForgeHierarchySyncService
    {
        private sealed class NativePrimitiveOrigin
        {
            internal string SceneId, ObjectId, Template, Epoch, OperationId;
            internal GameObject Owner;
            internal Collider NativeCollider;
            internal TeamForgeHierarchyState Before;
            internal bool Accepted;
        }

        // Volatile, single-operation provenance. This is never loaded from a
        // peer, disk or an object name and cannot establish server authority.
        private static NativePrimitiveOrigin _nativePrimitiveOrigin;
        // A native Unity Delete happens before the Hierarchy observer sees the
        // missing GameObject. Only a previously observed exact, childless,
        // default shared primitive may use the existing atomic M3 deletion.
        private sealed class NativePrimitiveDeletionWitness
        {
            internal string SceneId, ObjectId, Epoch, Template, OperationId;
            internal long HierarchyRevision;
            internal GameObject Owner;
            internal bool HierarchyAccepted;
            internal bool DeleteScanArmed;
        }
        private static NativePrimitiveDeletionWitness _nativeDeletionWitness;
        private static string _primitiveOperationJson;
        private static int _primitiveSendAttempts;
        private static double _primitiveSentAt;
        private static string _appliedPrimitiveScene;
        private static long _appliedPrimitiveRevision;
        private static bool _appliedPrimitiveReplay;
        private static long _appliedHierarchyRevision;

        [MenuItem("GameObject/TeamForge/Create Shared Cube")]
        private static void CreateSharedCubeMenu()
        {
            if (!CreateSharedPrimitive(TeamForgePrimitiveTemplateRuntime.Cube, out var error))
                EditorUtility.DisplayDialog("Shared Cube", error, "OK");
        }

        [MenuItem("GameObject/TeamForge/Create Shared Sphere")]
        private static void CreateSharedSphereMenu()
        {
            if (!CreateSharedPrimitive(TeamForgePrimitiveTemplateRuntime.Sphere, out var error))
                EditorUtility.DisplayDialog("Shared Sphere", error, "OK");
        }

        [MenuItem("GameObject/TeamForge/Delete Selected Shared Primitive")]
        private static void DeleteSharedPrimitiveMenu()
        {
            var target = Selection.activeGameObject;
            if (target != null && target.transform.childCount > 0 &&
                !EditorUtility.DisplayDialog("Delete shared subtree?", "Delete the selected shared primitive and its children in the shared Scene?", "Delete", "Cancel"))
                return;
            if (!DeleteSelectedSharedPrimitive(out var error))
                EditorUtility.DisplayDialog("Shared primitive", error, "OK");
        }

        internal static bool CreateSharedPrimitive(string template, out string error)
        {
            if (!TeamForgePrimitiveTemplateRuntime.IsTemplate(template))
            { error = "Choose a supported Cube or Sphere template."; return false; }
            if (!TryPrimitiveContext(out var sceneId, out var epoch, out error)) return false;
            var rootCount = 0;
            foreach (var state in Authoritative.SceneSnapshot(sceneId))
                if (string.IsNullOrEmpty(state.ParentObjectId)) rootCount++;
            var created = new TeamForgeHierarchyState
            {
                SceneId = sceneId, ObjectId = "tf:" + Guid.NewGuid().ToString("N"),
                Name = template == TeamForgePrimitiveTemplateRuntime.Cube ? "Cube" : "Sphere",
                SiblingIndex = rootCount, Transform = new TeamForgeTransformState(),
            };
            var operation = CreateOperation("create_object", created, null);
            operation.primitiveTemplate = template;
            operation.componentEpoch = epoch;
            return SendPrimitiveOperation(operation, out error);
        }

        // Called by the ordinary Unity Hierarchy create observer. Retain the
        // user's native GameObject and Undo history before server acceptance.
        // The M2 topology transaction adopts its exact native Collider only
        // after the authenticated M3 acknowledgement and catalog agree.
        private static bool TryShareNativePrimitive(TeamForgeHierarchyState state, GameObject target, out string error)
        {
            error = string.Empty;
            if (target == null || state == null ||
                !TeamForgePrimitiveTemplateRuntime.TryIdentifyNativeDefault(target, out var template))
                return false;
            if (!TryPrimitiveContext(out var sceneId, out var epoch, out error) ||
                sceneId != state.SceneId || !string.IsNullOrEmpty(state.ParentObjectId) ||
                !TeamForgeHierarchyIdentityRegistry.IsLogicalId(state.ObjectId))
                return false;
            if (_nativePrimitiveOrigin != null)
            { error = "A native primitive is already awaiting its authoritative Component identity."; return false; }
            var collider = target.GetComponent<Collider>();
            if (collider == null) return false;
            // The existing M3 receipt only admits a native root appended
            // after the current exact signed roots. A Unity Undo can restore
            // a formerly deleted Cube at its old MIDDLE sibling index. Do
            // not send a server create that our own receiver must then reject
            // after an irreversible remote commit.
            if (Authoritative.IsTombstoned(sceneId, state.ObjectId) ||
                !NativeCreationRootMembershipExact(sceneId, state.SiblingIndex, target))
            {
                error = "Unity restored or inserted a primitive outside the exact shared root order. Its local GameObject was preserved; no remote create was sent. Move it after the shared roots and retry when the Scene is stable.";
                return false;
            }
            var operation = CreateOperation("create_object", state, null);
            operation.primitiveTemplate = template;
            operation.componentEpoch = epoch;
            if (!SendPrimitiveOperation(operation, out error)) return false;
            _nativePrimitiveOrigin = new NativePrimitiveOrigin
            {
                SceneId = state.SceneId, ObjectId = state.ObjectId, Template = template,
                Epoch = epoch, Owner = target, NativeCollider = collider,
                Before = state.Clone(), OperationId = operation.operationId,
            };
            return true;
        }

        private static bool NativeOriginUnchanged(NativePrimitiveOrigin origin)
        {
            if (origin?.Owner == null || origin.Before == null ||
                origin.Owner.name != origin.Before.Name ||
                origin.Owner.transform.parent != null ||
                origin.Owner.transform.GetSiblingIndex() != origin.Before.SiblingIndex ||
                !TeamForgeObjectIdentity.TryGetCollaborativeObjectId(origin.Owner, out var objectId) ||
                objectId != origin.ObjectId ||
                !TryGetSceneId(origin.Owner.scene, out var sceneId) ||
                sceneId != origin.SceneId ||
                !TeamForgePrimitiveTemplateRuntime.IsDefaultNativeColliderForTemplate(
                    origin.Owner, origin.Template, origin.NativeCollider)) return false;
            var current = TeamForgeTransformState.Capture(origin.Owner.transform);
            return current != null && current.ApproximatelyEquals(origin.Before.Transform);
        }

        private static bool ValidateNativePrimitiveBeforeApply(HierarchyAppliedMessage message,
            List<TeamForgeHierarchyState> changed, out string error)
        {
            error = string.Empty;
            var origin = _nativePrimitiveOrigin;
            if (origin == null || message == null || message.operationId != origin.OperationId)
                return true;
            if (origin.Accepted || message.kind != "create_object" ||
                !message.componentTopologyChanged || message.sceneId != origin.SceneId ||
                message.objectId != origin.ObjectId || !NativeOriginUnchanged(origin))
            { error = "The native Cube/Sphere changed while its server approval was pending. Preserve local work and reconcile before retrying."; return false; }
            foreach (var row in changed)
                if (row.SceneId == origin.SceneId && row.ObjectId == origin.ObjectId &&
                    row.PrimitiveTemplate == origin.Template && row.Name == origin.Before.Name &&
                    row.ParentObjectId == origin.Before.ParentObjectId &&
                    row.Transform.ApproximatelyEquals(origin.Before.Transform))
                    return true;
            error = "The shared primitive receipt no longer matches the original native Unity creation.";
            return false;
        }

        private static bool NativeCreationRootMembershipExact(
            string sceneId, int siblingIndex, GameObject owner)
        {
            if (owner == null || owner.transform.parent != null ||
                !TryFindLoadedScene(sceneId, out var scene) || owner.scene != scene)
                return false;
            var roots = new List<TeamForgeHierarchyState>();
            foreach (var state in Authoritative.SceneSnapshot(sceneId))
                if (string.IsNullOrEmpty(state.ParentObjectId)) roots.Add(state);
            roots.Sort((left, right) => left.SiblingIndex.CompareTo(right.SiblingIndex));
            var nativeRoots = scene.GetRootGameObjects();
            if (siblingIndex != roots.Count || nativeRoots.Length != roots.Count + 1 ||
                nativeRoots[roots.Count] != owner) return false;
            for (var i = 0; i < roots.Count; i++)
            {
                if (roots[i].SiblingIndex != i ||
                    !TeamForgeObjectIdentity.TryResolveGameObject(roots[i].ObjectId, out var live) ||
                    nativeRoots[i] != live) return false;
            }
            return true;
        }

        // The user's native Cube/Sphere already occupies one Unity Hierarchy
        // slot before its signed M3 create acknowledgement. The ordinary sibling
        // recovery guard expects pre-create membership and would reject that
        // *exact* extra object. Prove no other native membership/order or
        // authoritative record changed before bypassing that one false conflict.
        private static bool ValidateNativeCreationSiblingReceipt(
            HierarchyAppliedMessage message, List<TeamForgeHierarchyState> changed, out string error)
        {
            error = "Native primitive receipt conflicts with a changed sibling group. Preserve the Scene and reconnect.";
            var origin = _nativePrimitiveOrigin;
            if (origin == null || origin.Accepted ||
                message == null || message.operationId != origin.OperationId ||
                message.kind != "create_object" || !message.componentTopologyChanged ||
                message.sceneId != origin.SceneId || message.objectId != origin.ObjectId ||
                !string.IsNullOrEmpty(origin.Before?.ParentObjectId) ||
                !TryFindLoadedScene(origin.SceneId, out var scene) ||
                !NativeOriginUnchanged(origin)) return false;
            if (!NativeCreationRootMembershipExact(
                    origin.SceneId, origin.Before.SiblingIndex, origin.Owner)) return false;
            foreach (var state in changed)
            {
                if (state.ObjectId == origin.ObjectId) continue;
                if (!Authoritative.TryGet(state.SceneId, state.ObjectId, out var before) ||
                    !before.StructuralEquals(state) ||
                    !before.Transform.ApproximatelyEquals(state.Transform)) return false;
            }
            if (message.deletedObjectIds.Length != 0) return false;
            // A previous local sibling-order draft may not be silently
            // superseded by acknowledging an unrelated native addition.
            if (TeamForgeConnectionService.HierarchySiblingRecoveryAvailable &&
                (!TryRenameScope(out var scope) ||
                 SiblingRecovery.TryGetGroup(scope.Key, origin.SceneId, string.Empty, out _)))
                return false;
            error = string.Empty;
            return true;
        }

        private static bool IsPendingNativeCreationReceipt(HierarchyAppliedMessage message) =>
            _nativePrimitiveOrigin != null && !_nativePrimitiveOrigin.Accepted &&
            message != null && message.operationId == _nativePrimitiveOrigin.OperationId &&
            message.kind == "create_object" && message.componentTopologyChanged;

        private static void ConfirmNativePrimitiveOrigin(HierarchyAppliedMessage message,
            List<TeamForgeHierarchyState> changed)
        {
            var origin = _nativePrimitiveOrigin;
            if (origin == null || origin.Accepted || message == null ||
                message.operationId != origin.OperationId ||
                message.kind != "create_object" || !message.componentTopologyChanged ||
                message.sceneId != origin.SceneId || message.objectId != origin.ObjectId)
                return;
            foreach (var state in changed)
            {
                if (state.SceneId == origin.SceneId && state.ObjectId == origin.ObjectId &&
                    state.PrimitiveTemplate == origin.Template && origin.Owner != null &&
                    TeamForgeObjectIdentity.TryResolveGameObject(origin.ObjectId, out var target) &&
                    target == origin.Owner)
                { origin.Accepted = true; return; }
            }
        }

        internal static bool TryResolveNativePrimitiveCollider(
            TeamForgeColliderComponentCatalogRow row, GameObject owner, out Component component)
        {
            component = null;
            var origin = _nativePrimitiveOrigin;
            if (origin == null || !origin.Accepted || row == null ||
                owner == null || owner != origin.Owner || row.sceneId != origin.SceneId ||
                row.objectId != origin.ObjectId || origin.Epoch != TeamForgeColliderSyncService.CurrentStructureEpoch ||
                row.typeName != (origin.Template == TeamForgePrimitiveTemplateRuntime.Cube
                    ? "UnityEngine.BoxCollider" : "UnityEngine.SphereCollider") ||
                !Authoritative.TryGet(row.sceneId, row.objectId, out var state) ||
                state.PrimitiveTemplate != origin.Template || !NativeOriginUnchanged(origin) ||
                !TeamForgePrimitiveTemplateRuntime.IsDefaultNativeColliderForTemplate(
                    owner, origin.Template, origin.NativeCollider))
                return false;
            component = origin.NativeCollider;
            return true;
        }

        internal static bool HasUnboundNativePrimitiveCollider(TeamForgeColliderComponentCatalogRow row, GameObject owner)
        {
            if (row == null || owner == null ||
                !Authoritative.TryGet(row.sceneId, row.objectId, out var state) ||
                !TeamForgePrimitiveTemplateRuntime.IsTemplate(state.PrimitiveTemplate)) return false;
            var expected = state.PrimitiveTemplate == TeamForgePrimitiveTemplateRuntime.Cube
                ? typeof(BoxCollider) : typeof(SphereCollider);
            foreach (var native in owner.GetComponents<Collider>())
                if (native != null && native.GetType() == expected) return true;
            return false;
        }

        internal static void CompleteNativePrimitiveOrigin(TeamForgeColliderComponentCatalogRow row,
            Component adopted)
        {
            var origin = _nativePrimitiveOrigin;
            if (origin != null && origin.Accepted && row != null &&
                row.sceneId == origin.SceneId && row.objectId == origin.ObjectId &&
                adopted != null && adopted == origin.NativeCollider)
                _nativePrimitiveOrigin = null;
        }

        internal static void PrimeNativePrimitiveDeletionWitness(string sceneId, string objectId)
        {
            if (!_wasConnected || !_receivedSnapshot || _recoveryBlocked ||
                string.IsNullOrEmpty(sceneId) || string.IsNullOrEmpty(objectId) ||
                _pendingOperation != null || TeamForgeRemoteApplyScope.IsActive) return;
            var selected = Selection.activeGameObject;
            if (selected == null || Selection.gameObjects.Length != 1 ||
                !TeamForgeObjectIdentity.TryGetCollaborativeObjectId(selected, out var actual) ||
                actual != objectId || !TryGetSceneId(selected.scene, out var currentSceneId) ||
                currentSceneId != sceneId) return;
            ObserveNativePrimitiveDeletionWitness();
        }

        private static void ObserveNativePrimitiveDeletionWitness()
        {
            // ObjectChangeEvents can arrive one Editor tick after native
            // destruction. If our previously approved object vanished, arm
            // the existing Hierarchy scan before discarding its exact witness.
            // No network request is sent from this observation path.
            if (_nativeDeletionWitness != null && _nativeDeletionWitness.Owner == null)
            {
                if (!string.IsNullOrEmpty(_nativeDeletionWitness.OperationId))
                    return; // Keep it through the hierarchy ACK until the verified M2 tombstone.
                if (!_nativeDeletionWitness.DeleteScanArmed &&
                    TeamForgeColliderSyncService.IsSceneEditReady(_nativeDeletionWitness.SceneId))
                {
                    // One delayed Unity selection/destroy signal may re-arm
                    // the normal scan. Do not spin every Editor Update if the
                    // signed Scene is not yet admitted or capture is blocked.
                    _nativeDeletionWitness.DeleteScanArmed = true;
                    _scanScheduled = true;
                }
                return;
            }
            _nativeDeletionWitness = null;
            if (!TryPrimitiveContext(out var sceneId, out var epoch, out _) ||
                !Authority.IsConnected || EditorApplication.isPlayingOrWillChangePlaymode) return;
            var owner = Selection.activeGameObject;
            if (owner == null || Selection.gameObjects.Length != 1 ||
                owner.scene != SceneManager.GetActiveScene() || owner.transform.parent != null ||
                owner.transform.childCount != 0 || IsUnsafePrefabContext(owner) ||
                !TeamForgeObjectIdentity.TryGetCollaborativeObjectId(owner, out var objectId) ||
                !Authoritative.TryGet(sceneId, objectId, out var record) ||
                !TeamForgePrimitiveTemplateRuntime.IsTemplate(record.PrimitiveTemplate) ||
                !TeamForgePrimitiveTemplateRuntime.TryIdentifyNativeDefault(owner, out var template) ||
                template != record.PrimitiveTemplate || owner.name != record.Name ||
                owner.transform.GetSiblingIndex() != record.SiblingIndex ||
                !TeamForgeTransformState.Capture(owner.transform).ApproximatelyEquals(record.Transform) ||
                !Authority.Locks.TryGet(sceneId, objectId, out var lease) ||
                lease.ownerConnectionId != Authority.ConnectionId) return;
            var ids = new HashSet<string>(StringComparer.Ordinal) { objectId };
            if (!ValidateNativeDeletion(owner, ids, out _)) return;
            _nativeDeletionWitness = new NativePrimitiveDeletionWitness
            { SceneId = sceneId, ObjectId = objectId, Epoch = epoch, Template = template,
                Owner = owner, HierarchyRevision = record.HierarchyRevision };
        }

        internal static bool NativeDeleteReadyFor(string sceneId, string objectId) =>
            _nativeDeletionWitness != null && _nativeDeletionWitness.Owner != null &&
            _nativeDeletionWitness.SceneId == sceneId &&
            _nativeDeletionWitness.ObjectId == objectId;

        // The Collider observer may run before the Hierarchy change observer.
        // Keep M2 ready just long enough for this one exact pending native
        // deletion to use the existing atomic M3 tombstone. Never extend the
        // exception to a missing arbitrary Component or unknown prefab.
        internal static bool HasWitnessedNativePrimitiveDeletion(string sceneId, string objectId) =>
            _nativeDeletionWitness != null && _nativeDeletionWitness.Owner == null &&
            _nativeDeletionWitness.SceneId == sceneId &&
            _nativeDeletionWitness.ObjectId == objectId &&
            TeamForgeColliderSyncService.CurrentStructureEpoch == _nativeDeletionWitness.Epoch &&
            (_nativeDeletionWitness.HierarchyAccepted ||
                Authoritative.TryGet(sceneId, objectId, out var record) &&
                record.PrimitiveTemplate == _nativeDeletionWitness.Template);

        // Unity Undo may restore the exact native object after we sent the
        // irreversible M3 delete but before the two signed server receipts.
        // No Collider transaction may silently strip a recovered local object
        // while the local Hierarchy and the Coordinator disagree.
        internal static bool HasLocallyUndonePendingPrimitiveDelete(string sceneId, string objectId)
        {
            var witness = _nativeDeletionWitness;
            return witness != null && !string.IsNullOrEmpty(witness.OperationId) &&
                witness.SceneId == sceneId && witness.ObjectId == objectId &&
                witness.Owner != null && witness.Owner.scene.IsValid() &&
                witness.Owner.scene.isLoaded;
        }

        // M3 server commits the Hierarchy and Collider ledger atomically, but
        // delivers their signed receipts in separate ordered frames. Do not
        // forget an approved native deletion when the Hierarchy frame arrives:
        // the M2 observer may still see its old local Collider catalog until
        // the next frame. Retire only after M2 validates the exact tombstone.
        internal static void RetireNativeDeletionAfterVerifiedTopology(
            string sceneId, string epoch,
            IReadOnlyList<TeamForgeColliderComponentCatalogRow> active,
            IReadOnlyList<TeamForgeColliderComponentCatalogRow> tombstones)
        {
            var witness = _nativeDeletionWitness;
            if (witness == null || !witness.HierarchyAccepted || witness.Owner != null ||
                string.IsNullOrEmpty(witness.OperationId) ||
                witness.SceneId != sceneId || witness.Epoch != epoch ||
                active == null || tombstones == null) return;
            foreach (var row in active)
                if (row != null && row.sceneId == sceneId && row.objectId == witness.ObjectId)
                    return;
            foreach (var row in tombstones)
                if (row != null && row.sceneId == sceneId && row.objectId == witness.ObjectId &&
                    row.typeName == (witness.Template == TeamForgePrimitiveTemplateRuntime.Cube
                        ? "UnityEngine.BoxCollider" : "UnityEngine.SphereCollider"))
                { _nativeDeletionWitness = null; return; }
        }

        private static bool TryShareNativeDeletedPrimitive(TeamForgeHierarchyState deleted,
            out string error)
        {
            error = "The native Unity deletion cannot be committed without its prior exact primitive and owned lock. Use Unity Undo and retry after gaining the lock.";
            var witness = _nativeDeletionWitness;
            if (witness == null || deleted == null || witness.Owner != null ||
                witness.SceneId != deleted.SceneId || witness.ObjectId != deleted.ObjectId ||
                witness.Template != deleted.PrimitiveTemplate ||
                witness.HierarchyRevision != deleted.HierarchyRevision ||
                TeamForgeObjectIdentity.TryResolveGameObject(deleted.ObjectId, out _) ||
                !TryPrimitiveContext(out var sceneId, out var epoch, out _) ||
                epoch != witness.Epoch || sceneId != witness.SceneId ||
                !Authority.Locks.TryGet(sceneId, deleted.ObjectId, out var lease) ||
                lease.ownerConnectionId != Authority.ConnectionId ||
                !NativeDeletionRootMembershipUnchanged(witness, deleted, out _)) return false;
            var operation = CreateOperation("delete_object", deleted, null);
            operation.componentEpoch = epoch;
            if (!SendPrimitiveOperation(operation, out error)) return false;
            witness.OperationId = operation.operationId;
            return true;
        }

        // Excludes every unintended root deletion or sibling reorder. This
        // check is rerun on the server ACK before mutating local authority.
        private static bool NativeDeletionRootMembershipUnchanged(
            NativePrimitiveDeletionWitness witness, TeamForgeHierarchyState deleted, out string error)
        {
            error = "Native primitive deletion changed the Scene root membership; preserve Unity Undo and review.";
            if (witness == null || deleted == null || !string.IsNullOrEmpty(deleted.ParentObjectId) ||
                !TryFindLoadedScene(deleted.SceneId, out var scene)) return false;
            var previous = Authoritative.SceneSnapshot(deleted.SceneId);
            var roots = new List<TeamForgeHierarchyState>();
            foreach (var state in previous)
                if (string.IsNullOrEmpty(state.ParentObjectId)) roots.Add(state);
            roots.Sort((a, b) => a.SiblingIndex.CompareTo(b.SiblingIndex));
            var native = scene.GetRootGameObjects();
            if (native.Length != roots.Count - 1) return false;
            var index = 0;
            foreach (var prior in roots)
            {
                if (prior.ObjectId == witness.ObjectId) continue;
                if (index >= native.Length ||
                    !TeamForgeObjectIdentity.TryResolveGameObject(prior.ObjectId, out var exact) ||
                    exact != native[index] || native[index].transform.GetSiblingIndex() != index)
                    return false;
                index++;
            }
            error = string.Empty;
            return index == native.Length;
        }

        private static bool ValidateNativeDeletionSiblingReceipt(
            HierarchyAppliedMessage message, List<TeamForgeHierarchyState> changed, out string error)
        {
            error = "The native Unity Delete acknowledgement no longer matches its exact signed primitive intent.";
            var witness = _nativeDeletionWitness;
            if (witness == null || string.IsNullOrEmpty(witness.OperationId) || message == null ||
                message.operationId != witness.OperationId || message.kind != "delete_object" ||
                !message.componentTopologyChanged || message.sceneId != witness.SceneId ||
                message.objectId != witness.ObjectId || message.deletedObjectIds == null ||
                message.deletedObjectIds.Length != 1 || message.deletedObjectIds[0] != witness.ObjectId ||
                !Authoritative.TryGet(witness.SceneId, witness.ObjectId, out var deleted) ||
                deleted.HierarchyRevision != witness.HierarchyRevision ||
                !NativeDeletionRootMembershipUnchanged(witness, deleted, out error)) return false;
            // Deleting a root shifts every following sibling left. The
            // existing authoritative hierarchy model explicitly publishes
            // only those changed siblings and increments their revision.
            // Verify that exact expected delta, not byte-identical records
            // (which would incorrectly reject every non-final root delete).
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var state in changed)
            {
                if (!seen.Add(state.ObjectId) ||
                    !Authoritative.TryGet(state.SceneId, state.ObjectId, out var before) ||
                    state.SceneId != witness.SceneId ||
                    state.CreatedRevision != before.CreatedRevision ||
                    state.Name != before.Name ||
                    state.ParentObjectId != before.ParentObjectId ||
                    state.PrimitiveTemplate != before.PrimitiveTemplate ||
                    !before.Transform.ApproximatelyEquals(state.Transform))
                { error = "Unrelated Hierarchy objects changed in the native Delete receipt."; return false; }
                var moved = string.IsNullOrEmpty(before.ParentObjectId) &&
                    before.SiblingIndex > deleted.SiblingIndex;
                var expectedSibling = before.SiblingIndex - (moved ? 1 : 0);
                if (!moved || state.SiblingIndex != expectedSibling ||
                    state.HierarchyRevision != message.serverRevision)
                { error = "The Delete receipt altered an unapproved Hierarchy sibling."; return false; }
            }
            foreach (var before in Authoritative.SceneSnapshot(witness.SceneId))
                if (string.IsNullOrEmpty(before.ParentObjectId) &&
                    before.SiblingIndex > deleted.SiblingIndex &&
                    !seen.Contains(before.ObjectId))
                { error = "The Delete receipt omitted a required sibling shift."; return false; }
            error = string.Empty;
            return true;
        }

        private static bool IsPendingNativeDeletionReceipt(HierarchyAppliedMessage message) =>
            _nativeDeletionWitness != null && !string.IsNullOrEmpty(_nativeDeletionWitness.OperationId) &&
            message != null && message.operationId == _nativeDeletionWitness.OperationId &&
            message.kind == "delete_object" && message.componentTopologyChanged;

        internal static bool DeleteSelectedSharedPrimitive(out string error)
        {
            if (!TryPrimitiveContext(out var sceneId, out var epoch, out error)) return false;
            var target = Selection.activeGameObject;
            if (target == null || Selection.gameObjects.Length != 1 || IsUnsafePrefabContext(target) ||
                target.scene != SceneManager.GetActiveScene() ||
                !TeamForgeObjectIdentity.TryGetCollaborativeObjectId(target, out var objectId) ||
                !Authoritative.TryGet(sceneId, objectId, out var primitive) ||
                !TeamForgePrimitiveTemplateRuntime.IsTemplate(primitive.PrimitiveTemplate))
            { error = "Select one shared Cube or Sphere in the joined Scene."; return false; }
            if (!Authority.Locks.TryGet(sceneId, objectId, out var lease) || lease.ownerConnectionId != Authority.ConnectionId)
            { error = "Acquire the selected GameObject's TeamForge lock before deleting it."; return false; }
            var subtree = Authoritative.SceneSnapshot(sceneId);
            var byId = ToDictionary(subtree);
            var ids = new HashSet<string>(StringComparer.Ordinal);
            foreach (var state in subtree)
                if (IsWithinSubtree(state, objectId, byId)) ids.Add(state.ObjectId);
            if (!ValidateNativeDeletion(target, ids, out error)) return false;
            var operation = CreateOperation("delete_object", primitive, null);
            operation.componentEpoch = epoch;
            return SendPrimitiveOperation(operation, out error);
        }

        private static bool TryPrimitiveContext(out string sceneId, out string epoch, out string error)
        {
            sceneId = string.Empty;
            epoch = string.Empty;
            if (!TeamForgeConnectionService.PrimitiveTemplateSyncAvailable || !SnapshotReady)
            { error = "Connect to a compatible TeamForge Host and wait for the shared Hierarchy snapshot."; return false; }
            if (!TeamForgePrimitiveTemplateRuntime.IsSupportedEditor(out error)) return false;
            if (_pendingOperation != null || PendingSeeds.Count > 0 || TeamForgeColliderSyncService.Pending)
            { error = "Wait for the pending shared Scene edit before changing its primitives."; return false; }
            var scene = SceneManager.GetActiveScene();
            if (PrefabStageUtility.GetCurrentPrefabStage() != null || !TryGetSceneId(scene, out sceneId) ||
                !AuthoritativeSceneIds.Contains(sceneId) ||
                string.IsNullOrEmpty(epoch = TeamForgeColliderSyncService.CurrentStructureEpoch))
            { error = "Save and use the supported Scene outside Prefab Mode; its signed collaboration admission must finish first."; return false; }
            return true;
        }

        private static bool SendPrimitiveOperation(HierarchyOperationMessage operation, out string error)
        {
            var unboundJson = TeamForgePrimitiveHierarchyWire.SerializeOperation(operation);
            if (!TeamForgeConnectionService.TryPrepareAuthorityCommand(unboundJson, out var json))
            { error = "The shared primitive command could not be bound to the current authority epoch."; return false; }
            if (!TeamForgeConnectionService.SendHierarchyJson(json, "Shared primitive operation"))
            { error = "The shared primitive request could not be sent."; return false; }
            var pending = new TeamForgePendingHierarchyOperation(operation.operationId, operation.requestId,
                operation.sceneId, operation.objectId, operation.kind, true);
            PendingByRequestId.Add(pending.RequestId, pending);
            _pendingOperation = pending;
            _primitiveOperationJson = json;
            _primitiveSentAt = EditorApplication.timeSinceStartup;
            _primitiveSendAttempts = 1;
            SetStatus("Waiting for the Coordinator to accept the shared primitive change.");
            error = string.Empty;
            return true;
        }

        private static void TickPrimitiveOperation()
        {
            if (!_wasConnected || _recoveryBlocked || _pendingOperation?.AuthorityBeforeLocalMutation != true ||
                EditorApplication.timeSinceStartup - _primitiveSentAt < 3) return;
            if (_primitiveSendAttempts < 3 &&
                TeamForgeConnectionService.SendHierarchyJson(_primitiveOperationJson, "Retry exact shared primitive operation"))
            {
                _primitiveSendAttempts++;
                _primitiveSentAt = EditorApplication.timeSinceStartup;
                return;
            }
            PendingByRequestId.Remove(_pendingOperation.RequestId);
            _pendingOperation = null;
            _primitiveOperationJson = null;
            PauseHierarchyRecovery("The shared primitive request outcome is unconfirmed. Reconnect to load the authoritative Scene.");
        }

        private static void RejectPrimitiveOperation(string reason)
        {
            var nativeDelete = _nativeDeletionWitness != null &&
                !string.IsNullOrEmpty(_nativeDeletionWitness.OperationId);
            _nativePrimitiveOrigin = null;
            _nativeDeletionWitness = null;
            _primitiveOperationJson = null;
            SetStatus(nativeDelete
                ? "Native Unity Delete refused (" + reason + "). The local object is still deleted: use Unity Undo to restore it before retrying."
                : "Shared primitive change refused (" + reason + ").");
            _scanScheduled = true;
        }

        private static void ResetPrimitiveOperations()
        {
            _nativePrimitiveOrigin = null;
            _nativeDeletionWitness = null;
            _primitiveOperationJson = null;
            _appliedPrimitiveScene = null;
            _appliedPrimitiveRevision = 0;
            _appliedPrimitiveReplay = false;
            _appliedHierarchyRevision = 0;
        }

        private static bool IsAuthoritativelyApplied(string sceneId, long serverRevision) =>
            SnapshotReady && _appliedPrimitiveScene == sceneId && _appliedPrimitiveRevision == serverRevision;

        internal static bool IsAuthoritativelyApplied(string sceneId, long serverRevision, long structureRevision) =>
            IsAuthoritativelyApplied(sceneId, serverRevision) &&
            (structureRevision == serverRevision || _appliedPrimitiveReplay);

        private static bool ValidatePrimitiveRecord(TeamForgeHierarchyState state, out string error)
        {
            error = string.Empty;
            if (string.IsNullOrEmpty(state.PrimitiveTemplate)) return true;
            if (!TeamForgeConnectionService.PrimitiveTemplateSyncAvailable)
            { error = "A shared primitive was received before capability negotiation."; return false; }
            if (!TeamForgePrimitiveTemplateRuntime.IsSupportedEditor(out error)) return false;
            return !TeamForgeObjectIdentity.TryResolveGameObject(state.ObjectId, out var target) ||
                TeamForgePrimitiveTemplateRuntime.ValidateExisting(state.PrimitiveTemplate, target, out error);
        }

        private static bool ValidatePrimitiveReceipt(HierarchyAppliedMessage message, bool ownPending, out string error)
        {
            error = string.Empty;
            if (ownPending && _pendingOperation.AuthorityBeforeLocalMutation &&
                (!message.componentTopologyChanged || message.requestId != _pendingOperation.RequestId ||
                    message.objectId != _pendingOperation.ObjectId || message.sceneId != _pendingOperation.SceneId ||
                    message.kind != _pendingOperation.Kind || message.userId != TeamForgeConnectionService.Settings.UserId.Trim()))
            { error = "The shared primitive acknowledgement does not match the pending operation."; return false; }
            if (!message.componentTopologyChanged) return true;
            if (!TeamForgeConnectionService.PrimitiveTemplateSyncAvailable || !_receivedSnapshot ||
                !AuthoritativeSceneIds.Contains(message.sceneId) ||
                (message.kind != "create_object" && message.kind != "delete_object") ||
                (message.replayed && (message.operationRevision < 1 || message.operationRevision > message.serverRevision)))
            { error = "The shared primitive acknowledgement has an invalid Scene, capability, or revision."; return false; }
            return true;
        }

        private static bool IsWithinSubtree(TeamForgeHierarchyState state, string rootId,
            Dictionary<string, TeamForgeHierarchyState> byId)
        {
            var current = state;
            for (var remaining = byId.Count; current != null && remaining > 0; remaining--)
            {
                if (current.ObjectId == rootId) return true;
                byId.TryGetValue(current.ParentObjectId, out current);
            }
            return false;
        }

        private static bool ValidateNativeDeletion(GameObject owner, HashSet<string> ids, out string error)
        {
            error = string.Empty;
            foreach (var transform in owner.GetComponentsInChildren<Transform>(true))
            {
                var target = transform.gameObject;
                if (!IsUnsafePrefabContext(target) &&
                    TeamForgeObjectIdentity.TryGetCollaborativeObjectId(target, out var id) && ids.Contains(id)) continue;
                error = "A shared deletion would also remove a local or Prefab object outside the committed subtree. Preserve that object before reconnecting.";
                return false;
            }
            return true;
        }

        private static bool ValidatePrimitiveDeletionFrame(HierarchyAppliedMessage message, out string error)
        {
            var ids = new HashSet<string>(StringComparer.Ordinal);
            foreach (var id in message.deletedObjectIds)
                if (!ValidText(id, 512) || !ids.Add(id))
                { error = "Shared primitive deletion contains an invalid or duplicate object ID."; return false; }
            foreach (var id in ids)
                if (!ValidateResolvedDeletion(message.sceneId, id, ids, out error)) return false;
            error = string.Empty;
            return true;
        }

        private static bool ValidatePrimitiveTombstones(TeamForgeHierarchyTombstoneRecord[] tombstones, out string error)
        {
            var deletedByScene = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);
            foreach (var row in tombstones ?? Array.Empty<TeamForgeHierarchyTombstoneRecord>())
            {
                if (!deletedByScene.TryGetValue(row.sceneId, out var ids))
                    deletedByScene.Add(row.sceneId, ids = new HashSet<string>(StringComparer.Ordinal));
                ids.Add(row.objectId);
            }
            foreach (var pair in deletedByScene)
                foreach (var id in pair.Value)
                    if (!ValidateResolvedDeletion(pair.Key, id, pair.Value, out error)) return false;
            error = string.Empty;
            return true;
        }

        private static bool ValidateResolvedDeletion(string sceneId, string objectId, HashSet<string> ids, out string error)
        {
            error = string.Empty;
            if (!TeamForgeObjectIdentity.TryResolveGameObject(objectId, out var target)) return true;
            if (!TryGetSceneId(target.scene, out var actualSceneId) || actualSceneId != sceneId)
            { error = "Shared primitive deletion resolved to a different local Scene."; return false; }
            return ValidateNativeDeletion(target, ids, out error);
        }

        private static void DestroyAuthoritativeTarget(GameObject target)
        {
            var scene = target.scene;
            TeamForgeColliderSyncService.BeforeSharedObjectDeleted(target);
            ClearLocalUndo(target);
            UnityEngine.Object.DestroyImmediate(target);
            if (TeamForgeConnectionService.PrimitiveTemplateSyncAvailable)
                EditorSceneManager.MarkSceneDirty(scene);
        }
    }
}

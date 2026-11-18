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
            { error = "Connect with shared Cube and Sphere enabled and wait for the Hierarchy snapshot."; return false; }
            if (!TeamForgePrimitiveTemplateRuntime.IsSupportedEditor(out error)) return false;
            if (_pendingOperation != null || PendingSeeds.Count > 0 || TeamForgeColliderSyncService.Pending)
            { error = "Wait for the pending shared Scene edit before changing its primitives."; return false; }
            var scene = SceneManager.GetActiveScene();
            if (PrefabStageUtility.GetCurrentPrefabStage() != null || !TryGetSceneId(scene, out sceneId) ||
                !AuthoritativeSceneIds.Contains(sceneId) ||
                string.IsNullOrEmpty(epoch = TeamForgeColliderSyncService.CurrentStructureEpoch))
            { error = "Join Collider collaboration in the active saved Scene outside Prefab Mode."; return false; }
            return true;
        }

        private static bool SendPrimitiveOperation(HierarchyOperationMessage operation, out string error)
        {
            var json = TeamForgePrimitiveHierarchyWire.SerializeOperation(operation);
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
            _primitiveOperationJson = null;
            SetStatus("Shared primitive change refused (" + reason + ").");
            _scanScheduled = true;
        }

        private static void ResetPrimitiveOperations()
        {
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

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
        private static readonly TeamForgeHierarchyRenameRecoveryStore RenameRecovery = new TeamForgeHierarchyRenameRecoveryStore(
            Path.Combine(Directory.GetCurrentDirectory(), "Library", "TeamForge", "HierarchyRenameRecovery-v1.json"));
        private static TeamForgeTransformRecoveryScope _renameScope;
        private static string _renameAuthorityEpoch;
        private static PendingRenameRecovery _renamePending;
        internal static string RenameRecoveryArchiveError { get; private set; } = string.Empty;

        private sealed class PendingRenameRecovery
        {
            internal string Key, OperationId, NameAtSend, DesiredName;
            internal bool Reviewed;
        }

        [Serializable]
        private sealed class ReviewedRenameCommand : ProtocolEnvelope
        {
            public string kind, operationId, userId, sceneId, objectId, name;
            public long baseRevision, expectedHierarchyRevision;
        }

        private static void InitializeRenameRecovery()
        {
            if (!RenameRecovery.Load(out var error))
            {
                RenameRecoveryArchiveError = error;
                TeamForgeDiagnostics.Warning(error);
            }
            TeamForgeProjectService.Changed += OnRenameProjectChanged;
            TeamForgeConnectionService.Disconnecting += PreserveRenamesBeforeDisconnect;
            AssemblyReloadEvents.beforeAssemblyReload += PreserveRenamesBeforeDisconnect;
            EditorApplication.quitting += PreserveRenamesBeforeDisconnect;
        }

        internal static IReadOnlyList<TeamForgeHierarchyRenameRecoveryRow> RecoveryRenameRows() => RenameRecovery.Rows();

        private static bool TryRenameScope(out TeamForgeTransformRecoveryScope scope)
        {
            scope = null;
            if (!TeamForgeConnectionService.HierarchyRenameRecoveryAvailable ||
                !TeamForgeWp6PreviewSourceGate.TryCaptureCurrentProjectPin(out var pin, out _)) return false;
            if (_renameScope != null && _renameAuthorityEpoch == TeamForgeConnectionService.AuthorityEpoch &&
                _renameScope.projectId == pin.ProjectId && _renameScope.sessionId == pin.SessionId &&
                _renameScope.durableSessionId == TeamForgeConnectionService.DurableSessionId &&
                _renameScope.projectUuid == pin.ProjectUuid && _renameScope.baselineRevision == pin.BaselineRevision &&
                _renameScope.manifestHash == pin.ManifestHash && _renameScope.descriptorHash == pin.DescriptorHash)
            {
                scope = _renameScope;
                return true;
            }
            scope = new TeamForgeTransformRecoveryScope {
                projectId = pin.ProjectId, sessionId = pin.SessionId, projectUuid = pin.ProjectUuid,
                baselineRevision = pin.BaselineRevision, manifestHash = pin.ManifestHash,
                descriptorHash = pin.DescriptorHash, durableSessionId = TeamForgeConnectionService.DurableSessionId,
            };
            if (!scope.IsValid) return false;
            _renameScope = scope;
            _renameAuthorityEpoch = TeamForgeConnectionService.AuthorityEpoch;
            return true;
        }

        private static void OnRenameProjectChanged()
        {
            if (!_wasConnected || _recoveryBlocked || !TeamForgeConnectionService.HierarchyRenameRecoveryAvailable ||
                !TeamForgeProjectService.RegistrySnapshotReceived) return;
            TryRenameScope(out _);
        }

        private static bool PrepareRenameConnection(bool connected, out string error)
        {
            error = string.Empty;
            _renamePending = null;
            if (!connected)
            {
                PreserveRenamesBeforeDisconnect();
                return true;
            }
            if (TeamForgeConnectionService.HierarchyRenameRecoveryAvailable && !string.IsNullOrEmpty(RenameRecoveryArchiveError))
            { error = RenameRecoveryArchiveError; return false; }
            // The new Hello confirms lineage while the previous verified
            // Hierarchy still holds before-images for offline edits.
            if (TeamForgeConnectionService.HierarchyRenameRecoveryAvailable && _renameScope != null &&
                _renameScope.durableSessionId == TeamForgeConnectionService.DurableSessionId && MatchesLocalRenameScope(_renameScope) &&
                !PreserveLocalRenames(_renameScope, true, default, out error)) return false;
            _renameScope = null;
            _renameAuthorityEpoch = null;
            return true;
        }

        private static bool MatchesLocalRenameScope(TeamForgeTransformRecoveryScope scope)
        {
            var descriptor = TeamForgeProjectService.Descriptor;
            return descriptor != null && (TeamForgeConnectionService.Settings.ProjectId ?? string.Empty).Trim() == scope.projectId &&
                (TeamForgeConnectionService.Settings.SessionId ?? string.Empty).Trim() == scope.sessionId &&
                descriptor.projectUuid == scope.projectUuid && descriptor.baselineRevision == scope.baselineRevision &&
                descriptor.manifestHash == scope.manifestHash && descriptor.descriptorHash == scope.descriptorHash;
        }

        private static void PreserveRenamesBeforeDisconnect()
        {
            if (!TryRenameScope(out var scope)) scope = _renameScope;
            if (scope == null || !MatchesLocalRenameScope(scope)) return;
            if (!PreserveLocalRenames(scope, true, default, out var captureError)) SetStatus(captureError);
            foreach (var row in RenameRecovery.Rows())
            {
                if (row.needsReview || row.scope.Key != scope.Key) continue;
                row.needsReview = true;
                if (!RenameRecovery.Put(row, out var error)) SetStatus(error);
            }
        }

        private static void PreserveSavedRenames(Scene scene)
        {
            if (_wasConnected && TryRenameScope(out var scope))
            {
                if (!PreserveLocalRenames(scope, false, scene, out var saveError)) SetStatus(saveError);
            }
            else if (!_wasConnected && _renameScope != null && MatchesLocalRenameScope(_renameScope) &&
                !PreserveLocalRenames(_renameScope, true, scene, out var offlineSaveError)) SetStatus(offlineSaveError);
        }

        private static bool PreserveLocalRenames(TeamForgeTransformRecoveryScope scope, bool review, Scene scene, out string error)
        {
            error = string.Empty;
            foreach (var sceneId in AuthoritativeSceneIds)
            {
                foreach (var shared in Authoritative.SceneSnapshot(sceneId))
                {
                    if (!TryRenameTarget(shared, out var target) || (scene.IsValid() && target.scene != scene) ||
                        target.name == shared.Name) continue;
                    if (!ArchiveRename(scope, shared, target, review, null, out _, out error)) return false;
                }
            }
            return true;
        }

        private static bool TryRenameTarget(TeamForgeHierarchyState shared, out GameObject target)
        {
            return TeamForgeObjectIdentity.TryResolveGameObject(shared.ObjectId, out target) && target != null &&
                TryGetSceneId(target.scene, out var sceneId) && sceneId == shared.SceneId && !IsUnsafePrefabContext(target) &&
                (!TeamForgeHierarchyIdentityRegistry.IsLogicalId(shared.ObjectId) ||
                 TeamForgeHierarchyIdentityRegistry.HasCurrentSavedAlias(shared.ObjectId, target) ||
                 TeamForgePrimitiveTemplateRuntime.IsTemplate(shared.PrimitiveTemplate));
        }

        private static string RenameKey(TeamForgeTransformRecoveryScope scope, TeamForgeHierarchyState shared) =>
            TeamForgeTransformRecoveryStore.TargetKey(scope.Key, shared.SceneId, shared.ObjectId);

        private static bool ArchiveRename(TeamForgeTransformRecoveryScope scope, TeamForgeHierarchyState shared,
            GameObject target, bool review, string operationId, out TeamForgeHierarchyRenameRecoveryRow row, out string error)
        {
            var key = RenameKey(scope, shared);
            RenameRecovery.TryGet(key, out var previous);
            var previousIsExact = previous != null && previous.createdRevision == shared.CreatedRevision && previous.scenePath == target.scene.path;
            if (previous != null && !previousIsExact)
            {
                row = null;
                error = "An archived rename belongs to a different saved target. Review it before sharing this name.";
                return false;
            }
            row = new TeamForgeHierarchyRenameRecoveryRow {
                scope = scope, sceneId = shared.SceneId, scenePath = target.scene.path, objectId = shared.ObjectId,
                createdRevision = shared.CreatedRevision, authorityEpoch = _renameAuthorityEpoch,
                beforeName = shared.Name, desiredName = target.name,
                operationId = operationId ?? previous?.operationId ?? string.Empty,
                needsReview = review || (previous?.needsReview ?? false),
            };
            if (previous != null && previous.desiredName == row.desiredName && previous.beforeName == row.beforeName &&
                previous.operationId == row.operationId && previous.authorityEpoch == row.authorityEpoch && previous.needsReview == row.needsReview)
            {
                error = string.Empty;
                return true;
            }
            return RenameRecovery.Put(row, out error);
        }

        private static bool SendDurableLocalRename(TeamForgeHierarchyState current, TeamForgeHierarchyState shared)
        {
            if (!TryRenameScope(out var scope))
            {
                SetStatus("Wait for the matching signed Project registry before sharing this rename.");
                return false;
            }
            // Unbound Hierarchy-only creations use their existing path. They
            // have no stable saved target to offer for offline recovery.
            if (!TryRenameTarget(shared, out var target)) return false;
            var operation = CreateOperation("rename_object", current, shared);
            var lockedByOther = ParentLockedByOther(shared.SceneId, shared.ObjectId);
            if (!ArchiveRename(scope, shared, target, lockedByOther, null, out var row, out var error))
            {
                SetStatus(error);
                return false;
            }
            if (row.needsReview)
            {
                SetStatus("A local name is preserved in Session Recovery for review.");
                return false;
            }
            row.operationId = operation.operationId;
            if (!RenameRecovery.Put(row, out error)) { SetStatus(error); return false; }
            return SendTrackedRename(operation, operation.requestId, row, target.name, false);
        }

        private static bool SendTrackedRename(object command, string requestId, TeamForgeHierarchyRenameRecoveryRow row,
            string nameAtSend, bool reviewed)
        {
            _renamePending = new PendingRenameRecovery { Key = row.Key, OperationId = row.operationId,
                DesiredName = row.desiredName, NameAtSend = nameAtSend, Reviewed = reviewed };
            var pending = new TeamForgePendingHierarchyOperation(row.operationId, requestId, row.sceneId, row.objectId, "rename_object");
            if (TrySendOperation(command, pending)) return true;
            MarkRenameForReview(pending, "The rename was not sent.");
            return false;
        }

        private static bool MarkRenameForReview(TeamForgePendingHierarchyOperation pending, string explanation)
        {
            if (_renamePending?.OperationId != pending.OperationId) return false;
            var rename = _renamePending;
            _renamePending = null;
            if (RenameRecovery.TryGet(rename.Key, out var row))
            {
                if (TryRenameScope(out var scope) && row.scope.Key == scope.Key &&
                    Authoritative.TryGet(row.sceneId, row.objectId, out var shared) &&
                    TryRenameTarget(shared, out var target) && target.name != rename.NameAtSend && target.name != shared.Name)
                {
                    if (!ArchiveRename(scope, shared, target, true, null, out _, out var archiveError))
                    { SetStatus(archiveError); return true; }
                }
                else if (!row.needsReview)
                {
                    row.needsReview = true;
                    if (!RenameRecovery.Put(row, out var error)) { SetStatus(error); return true; }
                }
            }
            SetStatus(explanation + " The saved name remains available in Session Recovery.");
            return true;
        }

        private static bool ValidateRenameReceipt(HierarchyAppliedMessage message, List<TeamForgeHierarchyState> changed,
            out string error)
        {
            error = string.Empty;
            var pending = _renamePending;
            if (pending == null || pending.OperationId != message.operationId) return true;
            if (message.requestId != _pendingOperation.RequestId || message.sceneId != _pendingOperation.SceneId ||
                message.objectId != _pendingOperation.ObjectId || message.kind != "rename_object" ||
                message.userId != TeamForgeConnectionService.Settings.UserId.Trim() || message.componentTopologyChanged ||
                message.deletedObjectIds.Length != 0 || changed.Count != 1 || changed[0].SceneId != message.sceneId ||
                changed[0].ObjectId != message.objectId || changed[0].Name != pending.DesiredName)
            {
                error = "The rename acknowledgement does not match the pending operation.";
                return false;
            }
            if (!TryRenameTarget(changed[0], out var target)) return true;
            if (target.name != pending.NameAtSend && target.name != pending.DesiredName)
            {
                return TryRenameScope(out var scope)
                    ? ArchiveRename(scope, changed[0], target, true, null, out _, out error)
                    : FailRenameContext(out error);
            }
            if (pending.Reviewed) ApplyRecoveryName(target, pending.DesiredName);
            return true;
        }

        private static bool FailRenameContext(out string error)
        {
            error = "The current rename source could not be verified. Preserve the local Scene before reconnecting.";
            return false;
        }

        private static bool IsSavedRename(TeamForgeHierarchyState state, GameObject target)
        {
            return TryRenameScope(out var scope) && TryRenameTarget(state, out var exact) && exact == target &&
                RenameRecovery.TryGet(RenameKey(scope, state), out var row) && row.createdRevision == state.CreatedRevision &&
                row.scenePath == target.scene.path && row.desiredName == target.name;
        }

        private static bool PreserveRenameBeforeApply(TeamForgeHierarchyState state, GameObject target, out string error)
        {
            error = string.Empty;
            if (!TryRenameScope(out var scope) || !TryRenameTarget(state, out var exact) || exact != target) return true;
            Authoritative.TryGet(state.SceneId, state.ObjectId, out var before);
            if (before == null)
            {
                if (!RenameRecovery.TryGet(RenameKey(scope, state), out var saved) || saved.createdRevision != state.CreatedRevision ||
                    saved.scenePath != target.scene.path || target.name == saved.beforeName || target.name == saved.desiredName) return true;
                before = state;
            }
            return target.name == before.Name || ArchiveRename(scope, before, target, true, null, out _, out error);
        }

        private static void ConfirmSharedRenames(IEnumerable<TeamForgeHierarchyState> states)
        {
            if (!TryRenameScope(out var scope)) return;
            foreach (var state in states)
            {
                var key = RenameKey(scope, state);
                if (!RenameRecovery.TryGet(key, out var row) || row.createdRevision != state.CreatedRevision || row.desiredName != state.Name)
                    continue;
                if (!RenameRecovery.Remove(key, out var error)) SetStatus(error);
            }
        }

        internal static bool TryRecoveryRenameShared(string key, out string name, out long revision)
        {
            name = string.Empty;
            revision = 0;
            if (!TryGetRecoveryRename(key, out _, out var state)) return false;
            name = state.Name;
            revision = state.HierarchyRevision;
            return true;
        }

        private static bool TryGetRecoveryRename(string key, out TeamForgeHierarchyRenameRecoveryRow row,
            out TeamForgeHierarchyState state)
        {
            state = null;
            return RenameRecovery.TryGet(key, out row) && SnapshotReady && TryRenameScope(out var scope) && row.scope.Key == scope.Key &&
                Authoritative.TryGet(row.sceneId, row.objectId, out state) && row.createdRevision == state.CreatedRevision;
        }

        private static bool TryRecoveryRenameTarget(string key, out TeamForgeHierarchyRenameRecoveryRow row,
            out TeamForgeHierarchyState shared, out GameObject target, out string error)
        {
            target = null;
            error = "Join the same durable Session and load the exact saved non-Prefab target before reviewing this name.";
            if (!TryGetRecoveryRename(key, out row, out shared) || EditorApplication.isPlayingOrWillChangePlaymode ||
                !TryRenameTarget(shared, out target) || row.scenePath != target.scene.path || !TeamForgeColliderSyncService.IsSceneEditReady(row.sceneId))
                return false;
            error = string.Empty;
            return true;
        }

        internal static bool SelectRecoveryRenameTarget(string key, out string error)
        {
            if (!TryRecoveryRenameTarget(key, out _, out _, out var target, out error)) return false;
            using (TeamForgeTransformSyncService.SuppressSelectionLock())
            {
                if (Selection.activeGameObject == target && TeamForgeTransformSyncService.TrackedObject != target)
                    Selection.activeGameObject = null;
                Selection.activeGameObject = target;
            }
            return true;
        }

        internal static bool RestoreSharedRecoveryName(string key, out string error)
        {
            if (!TryRecoveryRenameTarget(key, out var row, out var shared, out var target, out error)) return false;
            if (IsOperationPendingFor(row.sceneId, row.objectId))
            { error = "Wait for this target's Hierarchy result before restoring its name."; return false; }
            if (target.name != shared.Name && target.name != row.desiredName)
            {
                if (!ArchiveRename(row.scope, shared, target, true, null, out _, out error)) return false;
                error = "The newer local name was preserved. Review it before restoring the shared name.";
                RaiseChanged();
                return false;
            }
            ApplyRecoveryName(target, shared.Name);
            RaiseChanged();
            return true;
        }

        internal static bool RequestRecoveryRenameLock(string key, out string error)
        {
            if (!TryRecoveryRenameTarget(key, out var row, out var shared, out var target, out error)) return false;
            if (target.name != shared.Name || Selection.activeGameObject != target || Selection.gameObjects.Length != 1 ||
                TeamForgeTransformSyncService.TrackedObject != target || TeamForgeTransformSyncService.SelectedObjectId != row.objectId)
            {
                error = "Restore and select this exact target before requesting its lock.";
                return false;
            }
            if (Authority.Locks.TryGet(row.sceneId, row.objectId, out var lease) && lease.ownerConnectionId == Authority.ConnectionId)
                return true;
            if (TeamForgeTransformSyncService.RequestSelectedLock()) return true;
            error = "The selected target's lock could not be requested. Check the current lock status.";
            return false;
        }

        internal static bool ResubmitRecoveryRename(string key, long reviewedRevision, out string error)
        {
            if (!TryRecoveryRenameTarget(key, out var row, out var shared, out var target, out error)) return false;
            if (reviewedRevision != shared.HierarchyRevision)
            { error = "The shared Hierarchy changed. Review the current name before resubmitting."; return false; }
            if (row.desiredName == shared.Name) return RenameRecovery.Remove(key, out error);
            if (_pendingOperation != null || PendingSeeds.Count != 0 || target.name != shared.Name ||
                Selection.activeGameObject != target || Selection.gameObjects.Length != 1 ||
                !TeamForgeTransformSyncService.TryGetSelectedLock(out var lease) ||
                lease.sceneId != row.sceneId || lease.objectId != row.objectId || lease.ownerConnectionId != Authority.ConnectionId ||
                IsReconciliationPendingFor(row.sceneId, row.objectId, target))
            {
                error = "Restore and select this target, then acquire its fresh TeamForge lock before resubmitting the name.";
                return false;
            }
            var command = new ReviewedRenameCommand {
                type = "hierarchy_operation", kind = "rename_object", protocolVersion = TeamForgeProtocol.Version,
                requestId = Guid.NewGuid().ToString("N"), operationId = Guid.NewGuid().ToString("N"),
                userId = TeamForgeConnectionService.Settings.UserId.Trim(), sceneId = row.sceneId, objectId = row.objectId,
                baseRevision = Authority.SessionRevision, expectedHierarchyRevision = shared.HierarchyRevision, name = row.desiredName,
            };
            row.beforeName = shared.Name;
            row.operationId = command.operationId;
            row.authorityEpoch = TeamForgeConnectionService.AuthorityEpoch;
            row.needsReview = true;
            if (!RenameRecovery.Put(row, out error)) return false;
            if (SendTrackedRename(command, command.requestId, row, target.name, true)) return true;
            error = "The reviewed rename could not be sent. Its recovery entry remains available.";
            return false;
        }

        internal static bool DiscardRecoveryRename(string key, out string error)
        {
            if (_renamePending?.Key == key)
            { error = "Wait for the pending rename result or disconnect before discarding this entry."; return false; }
            if (TryGetRecoveryRename(key, out var row, out var shared) && TryRenameTarget(shared, out var target) &&
                row.scenePath == target.scene.path && target.name != shared.Name)
            { error = "Restore the shared name before discarding this entry so the local name is not sent as a new edit."; return false; }
            if (!RenameRecovery.Remove(key, out error)) return false;
            RaiseChanged();
            return true;
        }

        private static void ApplyRecoveryName(GameObject target, string name)
        {
            if (target.name == name) return;
            using (TeamForgeRemoteApplyScope.Enter())
            {
                Undo.ClearUndo(target);
                target.name = name;
                EditorSceneManager.MarkSceneDirty(target.scene);
            }
        }
    }
}

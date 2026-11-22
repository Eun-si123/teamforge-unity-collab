using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace EunSung.TeamForge
{
    // The live service verifies the complete server catalog before a narrow
    // local topology transaction. Logical IDs are server identities; local
    // EntityIds and saved GlobalObjectIds are never sent as their replacement.
    internal static partial class TeamForgeColliderSyncService
    {
        private static readonly Dictionary<string, TeamForgeColliderComponentCatalogRow> Catalog =
            new Dictionary<string, TeamForgeColliderComponentCatalogRow>(StringComparer.Ordinal);
        private static readonly Dictionary<string, TeamForgeColliderComponentCatalogRow> Tombstones =
            new Dictionary<string, TeamForgeColliderComponentCatalogRow>(StringComparer.Ordinal);
        private static readonly List<SavedStructureIntent> StructureRecovery = new List<SavedStructureIntent>();
        private static int _structureVersion;
        private static long _structureRevision;
        private static PendingStructure _structurePending;
        private static RetainedStructureSource _retainedStructureSource;
        // Observe Unity's own Inspector Add Component rather than requiring a
        // TeamForge menu. A native Component is never sent as an authority ID;
        // its exact original instance is adopted only after server approval.
        private static GameObject _observedNativeOwner;
        private static readonly HashSet<EntityId> ObservedNativeColliders = new HashSet<EntityId>();
        private static NativeColliderAddition _nativeAddition;
        private static EntityId _nativeAwaitedLockId;
        private static double _nativeAwaitedLockSince;
        private static bool _nativeLockRequested;

        private sealed class NativeColliderAddition
        {
            internal string SceneId, ObjectId, ComponentId, TypeName, Epoch, Serialized;
            internal GameObject Owner;
            internal Collider Native;
            internal EntityId Entity;
            internal int ComponentCount;
        }

        private sealed class RetainedStructureSource
        {
            internal string ConnectionId, ProjectId, SessionId, ProjectUuid, ManifestHash, DescriptorHash, ScenePath;
            internal long BaselineRevision;
            internal Scene LoadedScene;
            internal TeamForgeWp6PreviewSourceGate.Verified Witness;
        }

        // Hello names a previously admitted structure Scene. Capture its clean
        // local source before the following Hierarchy snapshot can apply edits.
        internal static void CaptureRetainedStructureSource()
        {
            _retainedStructureSource = null;
            if (!TeamForgeConnectionService.ComponentStructureSyncAvailable ||
                EditorApplication.isPlayingOrWillChangePlaymode)
                return;
            var sceneId = TeamForgeConnectionService.RequiredComponentStructureSceneId;
            var scene = SceneManager.GetActiveScene();
            if (string.IsNullOrEmpty(sceneId) || !scene.IsValid() || !scene.isLoaded || scene.isDirty ||
                string.IsNullOrEmpty(scene.path) || AssetDatabase.AssetPathToGUID(scene.path) != sceneId)
                return;
            var settings = TeamForgeConnectionService.Settings;
            if (_structureVersion == 1 && _source != null && _sceneId == sceneId &&
                _stateProjectId == settings.ProjectId.Trim() && _stateSessionId == settings.SessionId.Trim())
                return; // A returning Editor already holds the original pin.
            var descriptor = TeamForgeProjectService.Descriptor;
            if (!TeamForgeProjectValidation.TryValidateDescriptor(descriptor, out _) ||
                !TeamForgeWp6PreviewSourceGate.TryCaptureForReadOnlyPreview(sceneId, out var witness, out _))
                return;
            _retainedStructureSource = new RetainedStructureSource
            {
                ConnectionId = TeamForgeConnectionService.ConnectionId,
                ProjectId = settings.ProjectId.Trim(), SessionId = settings.SessionId.Trim(),
                ProjectUuid = descriptor.projectUuid, BaselineRevision = descriptor.baselineRevision,
                ManifestHash = descriptor.manifestHash, DescriptorHash = descriptor.descriptorHash,
                ScenePath = scene.path, LoadedScene = scene, Witness = witness,
            };
        }

        private static bool TryUseRetainedStructureSource(Scene scene, TeamForgeWp6PreviewSourceGate.ProjectPin pin,
            out TeamForgeWp6PreviewSourceGate.Verified witness)
        {
            witness = null;
            var source = _retainedStructureSource;
            if (source == null || !TeamForgeConnectionService.ComponentStructureSyncAvailable ||
                !scene.IsValid() || !scene.isLoaded || scene != source.LoadedScene || scene.path != source.ScenePath ||
                source.Witness.SceneGuid != TeamForgeConnectionService.RequiredComponentStructureSceneId ||
                AssetDatabase.AssetPathToGUID(scene.path) != source.Witness.SceneGuid ||
                source.ConnectionId != pin.ConnectionId || source.ProjectId != pin.ProjectId || source.SessionId != pin.SessionId ||
                source.ProjectUuid != pin.ProjectUuid || source.BaselineRevision != pin.BaselineRevision ||
                source.ManifestHash != pin.ManifestHash || source.DescriptorHash != pin.DescriptorHash ||
                !TeamForgeWp6PreviewSourceGate.MatchesSavedBytes(scene.path, source.Witness))
                return false;
            witness = source.Witness;
            return true;
        }

        [Serializable]
        private sealed class SavedStructureIntent
        {
            public string operationId;
            public string kind;
            public string sceneId;
            public string objectId;
            public string componentId;
            public string typeName;
            public string epoch;
            public string compensatesOperationId;
            public long expectedComponentRevision;
            public int historyDirection;
        }
        private sealed class PendingStructure
        {
            internal TeamForgeComponentStructureSet Intent;
            internal string Json;
            internal double SentAt;
            internal int Attempts;
            internal int HistoryDirection;
        }

        internal static bool StructureReady => _ready && _structureVersion == 1 &&
            TeamForgeConnectionService.ComponentStructureSyncAvailable;
        internal static string CurrentStructureEpoch => StructureReady && CurrentContext() ? _epoch : string.Empty;
        internal static int StructureRecoveryCount => StructureRecovery.Count;
        internal static IReadOnlyList<TeamForgeColliderComponentCatalogRow> CatalogRows() => CopyCatalog(Catalog).AsReadOnly();

        private static List<TeamForgeColliderComponentCatalogRow> CopyCatalog(
            Dictionary<string, TeamForgeColliderComponentCatalogRow> source)
        {
            var result = new List<TeamForgeColliderComponentCatalogRow>(source.Count);
            foreach (var row in source.Values) result.Add(row.Copy());
            result.Sort((a, b) => string.CompareOrdinal(a.componentId, b.componentId));
            return result;
        }

        private static void PrimeNativeColliderObservation()
        {
            _observedNativeOwner = Selection.activeGameObject;
            ObservedNativeColliders.Clear();
            _nativeAwaitedLockId = default(EntityId);
            _nativeAwaitedLockSince = 0;
            _nativeLockRequested = false;
            if (_observedNativeOwner == null) return;
            foreach (var collider in _observedNativeOwner.GetComponents<Collider>())
                if (collider != null) ObservedNativeColliders.Add(collider.GetEntityId());
        }

        internal static bool IsDefaultNativeCollider(Collider native)
        {
            if (native == null || !native.enabled || native.isTrigger ||
                native.sharedMaterial != null || !Mathf.Approximately(native.contactOffset, 0.01f)) return false;
            if (native.GetType() == typeof(BoxCollider))
            {
                var box = (BoxCollider)native;
                return box.center == Vector3.zero && box.size == Vector3.one;
            }
            if (native.GetType() == typeof(SphereCollider))
            {
                var sphere = (SphereCollider)native;
                return sphere.center == Vector3.zero && Mathf.Approximately(sphere.radius, 0.5f);
            }
            return false;
        }

        private static void ObserveNativeColliderAddition()
        {
            if (!StructureReady || !CurrentContext() || EditorApplication.isPlayingOrWillChangePlaymode ||
                TeamForgeRemoteApplyScope.IsActive) return;
            var owner = Selection.activeGameObject;
            if (owner == null || owner != _observedNativeOwner)
            { PrimeNativeColliderObservation(); return; }
            if (Pending || _nativeAddition != null) return;
            if (owner.scene.path != _scenePath || PrefabUtility.IsPartOfAnyPrefab(owner) ||
                !TeamForgeObjectIdentity.TryGetCollaborativeObjectId(owner, out var objectId) ||
                !TeamForgeColliderComponentBindings.TryResolveOwner(_sceneId, objectId, out var exact, out _) ||
                exact != owner) return;
            var candidates = new List<Collider>();
            foreach (var native in owner.GetComponents<Collider>())
                if (native != null && !ObservedNativeColliders.Contains(native.GetEntityId()))
                    candidates.Add(native);
            // Never guess which Component a burst of native adds represents.
            if (candidates.Count > 1)
            {
                foreach (var native in candidates) ObservedNativeColliders.Add(native.GetEntityId());
                SetStatus("Multiple native Collider additions detected together; kept local for explicit review.");
                return;
            }
            if (candidates.Count != 1) return;
            var collider = candidates[0];
            if (!IsDefaultNativeCollider(collider))
            {
                ObservedNativeColliders.Add(collider.GetEntityId());
                SetStatus("An edited/unsupported native Collider remains local; no guessed shared structure was sent.");
                return;
            }
            // Unity selection acquires its lease asynchronously. Don't mark
            // a new Inspector Component as observed just because the native
            // click happened before its lock reply arrived.
            if (!TeamForgeAuthorityView.Current.Locks.TryGet(_sceneId, objectId, out var lease) ||
                lease.ownerConnectionId != TeamForgeConnectionService.ConnectionId)
            {
                var entity = collider.GetEntityId();
                var now = EditorApplication.timeSinceStartup;
                if (entity != _nativeAwaitedLockId)
                {
                    _nativeAwaitedLockId = entity; _nativeAwaitedLockSince = now;
                    _nativeLockRequested = false;
                    SetStatus("Waiting briefly for the selected GameObject's shared lock before admitting its native Collider.");
                }
                // An actual Unity Inspector Add Component is an edit intent.
                // Reuse Transform Sync's normal authority request even when
                // the object was initially selected for navigation only.
                // Send at most one request for this exact native instance;
                // Unity's Transform service handles any server denial.
                if (!_nativeLockRequested && TeamForgeTransformSyncService.TrackedObject == owner &&
                    !TeamForgeTransformSyncService.SelectedObjectBlocked)
                    _nativeLockRequested = TeamForgeTransformSyncService.RequestSelectedLock();
                if (now - _nativeAwaitedLockSince > 15)
                {
                    ObservedNativeColliders.Add(entity);
                    SetStatus("Unity Add Component stayed local because its shared lock was unavailable. Review before retrying.");
                }
                return;
            }
            _nativeAwaitedLockId = default(EntityId);
            _nativeAwaitedLockSince = 0;
            _nativeLockRequested = false;
            ObservedNativeColliders.Add(collider.GetEntityId());
            var row = new TeamForgeColliderComponentCatalogRow
            {
                sceneId = _sceneId, objectId = objectId,
                componentId = "tf:c:" + Guid.NewGuid().ToString("N"),
                typeName = collider.GetType() == typeof(BoxCollider)
                    ? "UnityEngine.BoxCollider" : "UnityEngine.SphereCollider",
            };
            var origin = new NativeColliderAddition
            {
                SceneId = _sceneId, ObjectId = objectId, ComponentId = row.componentId,
                TypeName = row.typeName, Epoch = _epoch, Owner = owner, Native = collider,
                Entity = collider.GetEntityId(), ComponentCount = owner.GetComponents<Component>().Length,
                Serialized = EditorJsonUtility.ToJson(collider),
            };
            _nativeAddition = origin;
            if (!SendStructure("add_component", row, 0, string.Empty, 0, out var error))
            {
                _nativeAddition = null;
                SetStatus("Native Unity Add Component remains local: " + error);
            }
        }

        // A signed catalog can adopt only the exact native instance observed
        // for its own logical addition. Never match siblings by type or order.
        internal static bool TryResolveNativeAddedCollider(TeamForgeColliderComponentCatalogRow row,
            GameObject owner, out Component component)
        {
            component = null;
            var origin = _nativeAddition;
            if (origin == null || row == null || owner == null ||
                origin.Owner != owner || origin.SceneId != row.sceneId || origin.ObjectId != row.objectId ||
                origin.ComponentId != row.componentId || origin.TypeName != row.typeName ||
                origin.Epoch != _epoch || origin.Native == null ||
                origin.Native.GetEntityId() != origin.Entity ||
                owner.GetComponents<Component>().Length != origin.ComponentCount ||
                !IsDefaultNativeCollider(origin.Native) ||
                !string.Equals(EditorJsonUtility.ToJson(origin.Native), origin.Serialized, StringComparison.Ordinal)) return false;
            component = origin.Native;
            return true;
        }

        // If the user changes or deletes the exact native addition before
        // its authenticated acknowledgement, preserve that local intent.
        // Materializing a replacement from the same request would duplicate
        // physics or resurrect a Component the user already removed.
        internal static bool HasConflictingNativeAddition(TeamForgeColliderComponentCatalogRow row, GameObject owner)
        {
            var origin = _nativeAddition;
            return origin != null && row != null && origin.Owner == owner &&
                origin.SceneId == row.sceneId && origin.ObjectId == row.objectId &&
                origin.ComponentId == row.componentId && origin.TypeName == row.typeName;
        }

        internal static void CompleteNativeAddedCollider(TeamForgeColliderComponentCatalogRow row, Component adopted)
        {
            if (_nativeAddition != null && row != null && adopted != null &&
                _nativeAddition.ComponentId == row.componentId && adopted == _nativeAddition.Native)
                _nativeAddition = null;
        }

        internal static bool AddColliderToSelection(string typeName, out string error)
        {
            error = string.Empty;
            var owner = Selection.activeGameObject;
            if (!StructureReady || Pending || !CurrentContext() || owner == null ||
                !TeamForgeColliderComponentCatalogRow.IsTypeName(typeName))
            { error = "Join a compatible Collider Scene and select its GameObject before adding a shared Box/SphereCollider."; return false; }
            if (owner.scene.path != _scenePath || PrefabUtility.IsPartOfAnyPrefab(owner) ||
                !TeamForgeObjectIdentity.TryGetCollaborativeObjectId(owner, out var objectId))
            { error = "Shared Collider creation requires an exact, non-Prefab GameObject in the admitted Scene."; return false; }
            var row = new TeamForgeColliderComponentCatalogRow
            { sceneId = _sceneId, objectId = objectId, componentId = "tf:c:" + Guid.NewGuid().ToString("N"), typeName = typeName };
            return SendStructure("add_component", row, 0, string.Empty, 0, out error);
        }

        internal static bool RemoveCollider(TeamForgeColliderComponentCatalogRow requested, out string error)
        {
            error = string.Empty;
            if (requested == null || !Catalog.TryGetValue(requested.componentId ?? string.Empty, out var row) ||
                !SameComponent(row, requested))
            { error = "The exact Component is no longer in the shared catalog. Refresh before removing it."; return false; }
            return SendStructure("remove_component", row, ComponentRevision(row), string.Empty, 0, out error);
        }

        private static bool SendStructure(string kind, TeamForgeColliderComponentCatalogRow row,
            long expectedRevision, string compensates, int direction, out string error)
        {
            error = string.Empty;
            if (!StructureReady || Pending || !CurrentContext() || row == null || !row.IsValid || row.sceneId != _sceneId)
            { error = "Shared Component structure is not ready, or another operation is still pending."; return false; }
            if (!TeamForgeAuthorityView.Current.Locks.TryGet(row.sceneId, row.objectId, out var lease) ||
                lease.ownerConnectionId != TeamForgeConnectionService.ConnectionId)
            { error = "Select the Component's GameObject and acquire its shared lock before adding or removing it."; SetStatus(error); return false; }
            var intent = new TeamForgeComponentStructureSet
            {
                type = "component_structure_set", protocolVersion = TeamForgeProtocol.Version,
                requestId = Guid.NewGuid().ToString("N"), operationId = Guid.NewGuid().ToString("N"),
                epoch = _epoch, sceneId = _sceneId, baseRevision = TeamForgeAuthorityView.Current.SessionRevision,
                kind = kind, objectId = row.objectId, componentId = row.componentId, typeName = row.typeName,
                expectedComponentRevision = expectedRevision, compensatesOperationId = compensates ?? string.Empty,
            };
            var pending = new PendingStructure
            { Intent = intent, Json = JsonUtility.ToJson(intent), SentAt = EditorApplication.timeSinceStartup, Attempts = 1, HistoryDirection = direction };
            _structurePending = pending;
            if (!TeamForgeConnectionService.SendComponentJson(pending.Json, "Shared Collider " + kind))
            { PreservePendingStructure(); _structurePending = null; Save(); error = "The Component operation could not be sent; its intent was preserved."; SetStatus(error); return false; }
            Save(); SetStatus(_nativeAddition != null && _nativeAddition.ComponentId == row.componentId
                ? "Waiting for approval of the existing native Unity Collider. Its original instance and Undo are preserved."
                : "Sending shared Component " + kind + " — no local Component is changed before server acceptance.");
            return true;
        }

        private static bool CompensateStructure(OwnOperation operation, int direction)
        {
            var row = operation.Component;
            if (row == null) return false;
            var inverse = operation.StructureKind == "add_component" ? "remove_component" : "add_component";
            long version;
            if (inverse == "remove_component")
            {
                if (!Catalog.TryGetValue(row.componentId, out var current) || !SameComponent(row, current) ||
                    (version = ComponentRevision(current)) != operation.StructureOperationRevision)
                { SetStatus("Shared Component Undo/Redo refused: a newer operation changed this Component."); return false; }
            }
            else
            {
                if (!Tombstones.TryGetValue(row.componentId, out var deleted) || !SameComponent(row, deleted) ||
                    (version = deleted.serverRevision) != operation.StructureOperationRevision)
                { SetStatus("Shared Component Undo/Redo refused: its exact deletion is no longer current."); return false; }
            }
            return SendStructure(inverse, row, version, operation.OperationId, direction, out _);
        }

        private static long ComponentRevision(TeamForgeColliderComponentCatalogRow row)
        {
            var revision = row.serverRevision;
            foreach (var property in Authoritative.Values)
                if (property.ComponentId == row.componentId && property.ObjectId == row.objectId)
                    revision = Math.Max(revision, property.Revision);
            return revision;
        }
        private static bool SameComponent(TeamForgeColliderComponentCatalogRow a, TeamForgeColliderComponentCatalogRow b) =>
            a != null && b != null && a.sceneId == b.sceneId && a.objectId == b.objectId &&
            a.componentId == b.componentId && a.typeName == b.typeName;

        // The following topology frame can remove an owner and all its shared
        // rows. Read native values while the exact owner still exists.
        internal static void BeforeSharedObjectDeleted(GameObject owner)
        {
            if (owner == null || _structureVersion != 1 ||
                !TeamForgeConnectionService.PrimitiveTemplateSyncAvailable ||
                owner.scene.path != _scenePath || !CurrentContext()) return;
            var captured = false;
            foreach (var row in Authoritative.Values)
            {
                if (!TeamForgeColliderComponentBindings.TryResolveOwner(row.SceneId, row.ObjectId, out var target, out _) ||
                    (target != owner && !target.transform.IsChildOf(owner.transform)))
                    continue;
                if (_pending?.Desired?.Key == row.Key)
                {
                    PreservePendingLocal();
                    captured = true;
                }
                else if (TeamForgeColliderProperty.TryRead(row, out var local, out _) && !local.SameValue(row))
                {
                    Keep(local);
                    captured = true;
                }
            }
            if (captured) Save();
        }

        private static void ApplyHierarchyTopology(TeamForgeComponentMessage message, string json)
        {
            if (!TeamForgeConnectionService.PrimitiveTemplateSyncAvailable || _structureVersion != 1 ||
                !string.IsNullOrEmpty(message.requestId) || message.structureVersion != 1 ||
                message.structureRevision < 1 || message.structureRevision > message.serverRevision)
            {
                PauseRequests("Shared primitive topology response lacks the current structure capability or revision.");
                return;
            }
            if (message.serverRevision < _revision ||
                (message.serverRevision == _revision && message.snapshotHash == _snapshotHash)) return;
            if (message.serverRevision == _revision ||
                !TeamForgeHierarchySyncService.IsAuthoritativelyApplied(message.sceneId, message.serverRevision, message.structureRevision))
            {
                PauseRequests("Shared primitive topology arrived without the matching applied Hierarchy revision. Reconnect to recover the shared Scene.");
                return;
            }
            ApplyStructureSnapshot(message, json, false);
        }

        private static void ObserveMissingStructureTarget(TeamForgeColliderProperty target, string detail)
        {
            if (Catalog.TryGetValue(target.ComponentId, out var row) &&
                !StructureRecovery.Exists(item => item.kind == "remove_component" && item.componentId == row.componentId) &&
                StructureRecovery.Count < 256)
                StructureRecovery.Add(new SavedStructureIntent
                { operationId = "local-" + Guid.NewGuid().ToString("N"), kind = "remove_component", sceneId = row.sceneId,
                    objectId = row.objectId, componentId = row.componentId, typeName = row.typeName, epoch = _epoch,
                    expectedComponentRevision = ComponentRevision(row), compensatesOperationId = string.Empty });
            _ready = false;
            Save(); SetStatus("A local Component disappeared. Its removal intent is preserved for review; recovering current shared topology. " + detail);
            RequestSnapshot();
        }

        private static void TickPendingStructure(double now)
        {
            if (_structurePending == null || now - _structurePending.SentAt <= 3) return;
            if (_structurePending.Attempts >= MaximumSendAttempts)
            { PauseRequests("Component acceptance was not confirmed after three send attempts."); return; }
            if (!TeamForgeConnectionService.SendComponentJson(_structurePending.Json, "Retry exact Component operation"))
            { PauseRequests("The Component operation retry could not be sent."); return; }
            _structurePending.Attempts++; _structurePending.SentAt = now;
        }
        private static SavedStructureIntent RecoveryIntent(TeamForgeComponentStructureSet intent, int historyDirection) => new SavedStructureIntent
        { operationId = intent.operationId, kind = intent.kind, sceneId = intent.sceneId, objectId = intent.objectId,
            componentId = intent.componentId, typeName = intent.typeName, epoch = intent.epoch,
            compensatesOperationId = intent.compensatesOperationId, expectedComponentRevision = intent.expectedComponentRevision,
            historyDirection = historyDirection };
        private static void PreservePendingStructure()
        {
            if (_structurePending == null) return;
            var intent = RecoveryIntent(_structurePending.Intent, _structurePending.HistoryDirection);
            if (StructureRecovery.Exists(row => row.operationId == intent.operationId)) return;
            if (StructureRecovery.Count < 256) StructureRecovery.Add(intent);
        }
        private static SavedStructureIntent[] StructureRecoveryForSave()
        {
            var result = new List<SavedStructureIntent>(StructureRecovery);
            if (_structurePending != null && !result.Exists(row => row.operationId == _structurePending.Intent.operationId))
                result.Add(RecoveryIntent(_structurePending.Intent, _structurePending.HistoryDirection));
            return result.ToArray();
        }

        internal static string StructureRecoverySummary()
        {
            var text = new System.Text.StringBuilder();
            foreach (var intent in StructureRecovery)
            {
                text.Append(intent.kind).Append(" · ").Append(intent.typeName).Append(" · ").Append(intent.componentId);
                if (!string.IsNullOrEmpty(intent.compensatesOperationId))
                    text.Append(" · conditional inverse at revision ").Append(intent.expectedComponentRevision);
                text.Append('\n');
            }
            return text.ToString();
        }
        internal static bool ResubmitStructureRecovery(out string error)
        {
            error = string.Empty;
            if (!StructureReady || Pending || StructureRecovery.Count == 0)
            { error = "Join and review the current shared Scene before resubmitting a Component intent."; return false; }
            var intent = StructureRecovery[0];
            var row = new TeamForgeColliderComponentCatalogRow
            { sceneId = intent.sceneId, objectId = intent.objectId, componentId = intent.componentId, typeName = intent.typeName };
            if (!string.IsNullOrEmpty(intent.compensatesOperationId))
            {
                // Recovering an Undo/Redo may never become an ordinary Add or
                // a current-version Delete. Preserve its exact server proof.
                if (intent.epoch != _epoch)
                { error = "This conditional inverse belongs to an earlier server epoch. Export or discard it; it cannot be safely retried here."; SetStatus(error); return false; }
                var conditionHolds = intent.kind == "add_component"
                    ? Tombstones.TryGetValue(intent.componentId, out var deleted) && SameComponent(row, deleted) && deleted.serverRevision == intent.expectedComponentRevision
                    : Catalog.TryGetValue(intent.componentId, out var active) && SameComponent(row, active) && ComponentRevision(active) == intent.expectedComponentRevision;
                if (!conditionHolds)
                { error = "The original conditional inverse no longer matches the shared Component revision. Its intent remains available for export or explicit discard."; SetStatus(error); return false; }
                // A domain reload may have retired the local history stack. The
                // server condition still applies; never pop an unrelated entry.
                var history = intent.historyDirection == 1 ? Redoable : Undoable;
                var direction = history.Count > 0 && history[history.Count - 1].OperationId == intent.compensatesOperationId
                    ? intent.historyDirection : 0;
                if (!SendStructure(intent.kind, row, intent.expectedComponentRevision, intent.compensatesOperationId, direction, out error)) return false;
            }
            else if (intent.kind == "remove_component")
            {
                if (!Catalog.TryGetValue(intent.componentId, out var current))
                { StructureRecovery.RemoveAt(0); Save(); SetStatus("The intended Component is already absent from shared state."); return true; }
                if (!SendStructure(intent.kind, current, ComponentRevision(current), string.Empty, 0, out error)) return false;
            }
            else
            {
                // A review action is a new operation, never a replay with a new
                // before-image or reuse of a deleted logical identity.
                row.componentId = "tf:c:" + Guid.NewGuid().ToString("N");
                if (!SendStructure("add_component", row, 0, string.Empty, 0, out error)) return false;
            }
            StructureRecovery.RemoveAt(0); Save(); return true;
        }

        private static void HandleStructureRejection(TeamForgeComponentMessage message)
        {
            // Rejected native additions remain in the user's Scene. Their
            // provisional identity must not block a later unrelated edit.
            if (_nativeAddition != null && _structurePending != null &&
                _nativeAddition.ComponentId == _structurePending.Intent.componentId)
                _nativeAddition = null;
            PreservePendingStructure(); _structurePending = null; _ready = false;
            if (message.epoch != _epoch || message.error == "component_sync_not_negotiated")
            { PauseRequests("Shared Component operation rejected: " + message.error + "."); return; }
            Save(); SetStatus("Shared Component operation rejected: " + message.error + ". Intent preserved; requesting current state once.");
            RequestSnapshot();
        }

        private static void ApplyStructureOperation(TeamForgeComponentMessage message, string json)
        {
            var pending = _structurePending != null && _structurePending.Intent.operationId == message.operationId
                ? _structurePending : null;
            if (string.IsNullOrEmpty(message.operationId) ||
                (message.kind != "add_component" && message.kind != "remove_component") ||
                message.operationRevision < 1 || message.operationRevision > message.serverRevision ||
                (pending != null && (message.requestId != pending.Intent.requestId ||
                    message.userId != TeamForgeConnectionService.Settings.UserId.Trim() ||
                    message.kind != pending.Intent.kind || message.componentId != pending.Intent.componentId ||
                    message.objectId != pending.Intent.objectId || message.typeName != pending.Intent.typeName)))
            { PauseRequests("Component acknowledgement did not match the exact operation."); return; }
            // An already accepted receipt is not a new write. In particular,
            // an exact duplicate must not move a newer unsent Inspector value
            // into recovery or overwrite it before the observer can send it.
            if (ReceivedOperations.Contains(message.operationId) && message.epoch == _epoch &&
                (message.serverRevision < _revision ||
                 (message.serverRevision == _revision && message.snapshotHash == _snapshotHash))) return;
            if (_structureVersion == 1 && message.epoch == _epoch && message.serverRevision == _revision &&
                !string.IsNullOrEmpty(_snapshotHash) && message.snapshotHash != _snapshotHash)
            { PauseRequests("A Component receipt conflicts with an already accepted snapshot revision."); return; }
            if (message.serverRevision < _revision)
            {
                PreservePendingStructure(); _structurePending = null; _ready = false; RequestSnapshot(); return;
            }
            if (!ApplyStructureSnapshot(message, json, false)) return;
            if (pending == null || ReceivedOperations.Contains(message.operationId)) return;
            _structurePending = null;
            var history = new OwnOperation
            {
                OperationId = message.operationId, StructureKind = message.kind,
                StructureOperationRevision = message.operationRevision,
                Component = new TeamForgeColliderComponentCatalogRow
                { sceneId = message.sceneId, objectId = message.objectId, componentId = message.componentId,
                    typeName = message.typeName, serverRevision = message.operationRevision },
            };
            if (pending.HistoryDirection == -1)
            { if (Undoable.Count > 0) Undoable.RemoveAt(Undoable.Count - 1); Redoable.Add(history); }
            else if (pending.HistoryDirection == 1)
            { if (Redoable.Count > 0) Redoable.RemoveAt(Redoable.Count - 1); Undoable.Add(history); }
            else { Undoable.Add(history); Redoable.Clear(); }
            if (Undoable.Count > 256) Undoable.RemoveAt(0);
            if (ReceivedOperations.Count >= 4096) ReceivedOperations.Clear();
            ReceivedOperations.Add(message.operationId);
            StructureRecovery.RemoveAll(item => item.operationId == message.operationId);
            Save(); RaiseChanged();
        }

        private static bool ApplyStructureSnapshot(TeamForgeComponentMessage message, string json, bool requested)
        {
            if (!TeamForgeConnectionService.ComponentStructureSyncAvailable || message.structureVersion != 1 ||
                (requested && message.requestId != _snapshotRequest) || !Guid.TryParse(message.epoch, out var epoch) ||
                epoch.ToString("D") != message.epoch ||
                (TeamForgeConnectionService.DurableSessionRecoveryAvailable && message.epoch != TeamForgeConnectionService.AuthorityEpoch) ||
                message.sceneId != _sceneId || message.serverRevision < 0 ||
                message.structureRevision < 0 || message.structureRevision > message.serverRevision ||
                (!_awaitingJoinSnapshot && (message.epoch != _epoch || message.serverRevision < _revision)) ||
                (_structureVersion == 1 && message.epoch == _epoch &&
                    (message.serverRevision < _revision || message.structureRevision < _structureRevision)) ||
                !Hash(message.snapshotHash) || !SourceMatches(message.source) ||
                message.source.sceneFileSha256 != _source.sceneFileSha256 || message.source.sceneMetaSha256 != _source.sceneMetaSha256 ||
                !TeamForgeColliderProperty.TryParseRows(json, out var rows, out var error) ||
                !TeamForgeColliderPropertyWire.TryParseCatalog(json, "components", 512, out var components, out error) ||
                !TeamForgeColliderPropertyWire.TryParseCatalog(json, "tombstones", 4096, out var tombstones, out error) ||
                !ValidCatalog(message, components, tombstones, rows))
            { PauseRequests("Component snapshot refused: complete source, epoch, identity and catalog are required."); return false; }
            if (TeamForgeColliderSnapshotDigest.ComputeV2(message.source, message.epoch, message.sceneId,
                message.serverRevision, message.structureRevision, components, tombstones, rows) != message.snapshotHash)
            { PauseRequests("Component snapshot digest mismatch. No local topology or values changed."); return false; }

            // Capture local intent under the PREVIOUS verified context. Switching
            // epoch/bindings cannot be allowed to erase a pending before-image.
            CaptureUnconfirmedChanges(); PreservePendingLocal();
            if (!requested && (_structurePending == null || _structurePending.Intent.operationId != message.operationId))
                PreservePendingStructure();
            var contextReady = TeamForgeConnectionService.DurableSessionRecoveryAvailable
                ? TeamForgeColliderComponentBindings.SetDurableContext(_stateProjectId, _stateSessionId, message.source.projectUuid,
                    _sceneId, message.epoch, TeamForgeConnectionService.DurableSessionId, out error)
                : TeamForgeColliderComponentBindings.SetContext(_stateProjectId, _stateSessionId, message.source.projectUuid,
                    _sceneId, message.epoch, out error);
            if (!contextReady ||
                !TeamForgeColliderTopologyTransaction.TryPrepare(components, tombstones, rows,
                    new List<TeamForgeColliderProperty>(Authoritative.Values), out var plan, out error))
            { PauseRequests("Component reconciliation preflight refused: " + error); ReportStructureConflict(message); return false; }

            var changed = new List<TeamForgeColliderProperty>();
            var beforeValues = new List<TeamForgeColliderProperty>();
            var applied = plan.Apply(out error);
            if (applied)
                foreach (var incoming in rows)
                {
                    if (!TeamForgeColliderProperty.TryRead(incoming, out var local, out error)) { applied = false; break; }
                    if (Authoritative.TryGetValue(incoming.Key, out var previous) &&
                        !local.SameValue(previous) && !local.SameValue(incoming)) Keep(local);
                    if (local.SameValue(incoming)) continue;
                    if (!TeamForgeColliderProperty.TryApply(local, incoming, out error)) { applied = false; break; }
                    changed.Add(incoming); beforeValues.Add(local);
                }
            if (!applied || !plan.Commit(out error))
            {
                var rollbackFailures = 0;
                for (var index = changed.Count - 1; index >= 0; index--)
                    if (!TeamForgeColliderProperty.TryApply(changed[index], beforeValues[index], out _)) rollbackFailures++;
                if (!plan.Rollback(out var rollbackError)) rollbackFailures++;
                PauseRequests("Component apply conflict: " + error + ". Rollback failures: " + rollbackFailures +
                    (rollbackFailures > 0 ? ". " + rollbackError : string.Empty));
                EditorApplyStatus = "Server state was not fully applied in this Editor; local recovery was preserved.";
                ReportStructureConflict(message); return false;
            }

            var changedEpoch = _epoch != message.epoch;
            if (changedEpoch) { Undoable.Clear(); Redoable.Clear(); ReceivedOperations.Clear(); }
            Catalog.Clear(); Tombstones.Clear();
            foreach (var component in components) Catalog.Add(component.componentId, component.Copy());
            foreach (var deleted in tombstones) Tombstones.Add(deleted.componentId, deleted.Copy());
            Authoritative.Clear(); RowOrder.Clear();
            foreach (var row in rows)
            {
                Authoritative.Add(row.Key, row); RowOrder.Add(row.Key);
                if (Recovery.TryGetValue(row.Key, out var recovered) && recovered.SameValue(row)) Recovery.Remove(row.Key);
            }
            _source = message.source; _epoch = message.epoch; _structureVersion = 1;
            _durableSessionId = TeamForgeConnectionService.DurableSessionRecoveryAvailable ? TeamForgeConnectionService.DurableSessionId : string.Empty;
            _structureRevision = message.structureRevision; _revision = message.serverRevision; _snapshotHash = message.snapshotHash;
            _awaitingJoinSnapshot = false; _snapshotRequest = string.Empty; _requestDeadline = 0;
            _manualRetryRequired = false; _rejoinRequested = false; _ready = true; _pending = null;
            if (requested) _structurePending = null;
            StructureRecovery.RemoveAll(intent => intent.sceneId == _sceneId &&
                (intent.kind == "add_component" ? Catalog.ContainsKey(intent.componentId)
                    : !Catalog.ContainsKey(intent.componentId) && Tombstones.ContainsKey(intent.componentId)));
            TeamForgeAuthorityView.ObserveRevision(message.serverRevision);
            EditorApplyStatus = "Component catalog and properties applied in this Editor at revision " + _revision + ".";
            Report("applied"); Save();
            // A remote accepted snapshot can materialize native Components;
            // do not misclassify those as new Inspector Add Component actions.
            PrimeNativeColliderObservation();
            SetStatus("Shared Collider structure ready · " + Catalog.Count + " Components. Local recovery remains explicit.");
            return true;
        }

        [Serializable] private sealed class ExportedStructureIntents { public SavedStructureIntent[] intents; }
        private static void ReportStructureConflict(TeamForgeComponentMessage message)
        {
            var report = new TeamForgeComponentApplyReport
            {
                type = "component_apply_report", protocolVersion = TeamForgeProtocol.Version,
                requestId = Guid.NewGuid().ToString("N"), sceneId = _sceneId, epoch = message.epoch,
                serverRevision = message.serverRevision, snapshotHash = message.snapshotHash, status = "conflict",
            };
            _reportRequest = report.requestId; _reportedRevision = report.serverRevision; _reportedEpoch = report.epoch;
            TeamForgeConnectionService.SendComponentJson(JsonUtility.ToJson(report), "Collider topology apply conflict report");
            ReportStatus = "Editor reported a topology apply conflict at revision " + report.serverRevision + "; shared commit and disk save remain separate.";
        }
        private static void HandleApplyReportAck(TeamForgeComponentMessage message)
        {
            if (message.requestId != _reportRequest || message.serverRevision != _reportedRevision ||
                message.epoch != _reportedEpoch || message.status != "editor_report_recorded") return;
            _reportRequest = string.Empty;
            ReportStatus = "Server received Editor apply report at revision " + message.serverRevision + ". Disk save is separate.";
            RaiseChanged();
        }

        private static bool ValidCatalog(TeamForgeComponentMessage message,
            List<TeamForgeColliderComponentCatalogRow> components, List<TeamForgeColliderComponentCatalogRow> tombstones,
            List<TeamForgeColliderProperty> rows)
        {
            if (components.Count > 512 || tombstones.Count > 4096 || rows.Count != components.Count * 3) return false;
            var ids = new HashSet<string>(StringComparer.Ordinal);
            var active = new Dictionary<string, TeamForgeColliderComponentCatalogRow>(StringComparer.Ordinal);
            foreach (var list in new[] { components, tombstones })
            {
                string prior = null;
                foreach (var row in list)
                {
                    if (row == null || !row.IsValid || row.sceneId != message.sceneId || row.serverRevision > message.structureRevision ||
                        !ids.Add(row.componentId) || (prior != null && string.CompareOrdinal(prior, row.componentId) >= 0)) return false;
                    prior = row.componentId;
                }
            }
            foreach (var row in components) active.Add(row.componentId, row);
            if (_structureVersion == 1 && message.epoch == _epoch)
            {
                var deleted = new Dictionary<string, TeamForgeColliderComponentCatalogRow>(StringComparer.Ordinal);
                foreach (var row in tombstones) deleted.Add(row.componentId, row);
                foreach (var old in Catalog.Values)
                {
                    if (active.TryGetValue(old.componentId, out var stillActive))
                    {
                        if (!SameComponent(old, stillActive) || stillActive.serverRevision < old.serverRevision) return false;
                    }
                    else if (!deleted.TryGetValue(old.componentId, out var removed) || !SameComponent(old, removed) ||
                        removed.serverRevision <= ComponentRevision(old)) return false;
                }
                foreach (var old in Tombstones.Values)
                {
                    if (deleted.TryGetValue(old.componentId, out var stillDeleted))
                    {
                        if (!SameComponent(old, stillDeleted) || stillDeleted.serverRevision < old.serverRevision) return false;
                    }
                    else if (!active.TryGetValue(old.componentId, out var restored) || !SameComponent(old, restored) ||
                        restored.serverRevision <= old.serverRevision) return false;
                }
            }
            var counts = new Dictionary<string, int>(StringComparer.Ordinal);
            var keys = new HashSet<string>(StringComparer.Ordinal);
            foreach (var row in rows)
            {
                if (!row.IsValid || row.SceneId != message.sceneId || row.Revision > message.serverRevision || !keys.Add(row.Key) ||
                    !active.TryGetValue(row.ComponentId, out var target) || row.ObjectId != target.objectId || row.TypeName != target.typeName ||
                    row.Revision < target.serverRevision) return false;
                counts[row.ComponentId] = counts.TryGetValue(row.ComponentId, out var count) ? count + 1 : 1;
            }
            foreach (var component in components) if (!counts.TryGetValue(component.componentId, out var count) || count != 3) return false;
            return true;
        }

        private static string ComputeCurrentSnapshotDigest(TeamForgeComponentMessage message, IReadOnlyList<TeamForgeColliderProperty> rows) =>
            _structureVersion == 1
                ? TeamForgeColliderSnapshotDigest.ComputeV2(_source, message.epoch, message.sceneId,
                    message.serverRevision, _structureRevision, CopyCatalog(Catalog), CopyCatalog(Tombstones), rows)
                : TeamForgeColliderSnapshotDigest.Compute(_source, message.epoch, message.sceneId, message.serverRevision, rows);

        private static void OnSceneSaved(UnityEngine.SceneManagement.Scene scene)
        {
            if (scene.path != _scenePath || _source == null) { RaiseChanged(); return; }
            if (_structureVersion == 1 &&
                !TeamForgeColliderComponentBindings.RefreshSavedBindings(out var error))
            { EditorApplyStatus = "Local Component identity checkpoint failed: " + error + ". Keep this Editor open and repair the checkpoint before reload."; }
            Save(); RaiseChanged();
        }
        private static void ClearStructureState()
        {
            Catalog.Clear(); Tombstones.Clear(); StructureRecovery.Clear();
            _structurePending = null; _structureVersion = 0; _structureRevision = 0;
        }
        private static void RestoreStructureState(SavedState saved)
        {
            if (saved.structureVersion == 0) return;
            if (saved.structureVersion != 1 || saved.structureRevision < 0 || saved.components == null ||
                saved.tombstones == null || saved.components.Length > 512 || saved.tombstones.Length > 4096 ||
                (saved.structureRecovery != null && saved.structureRecovery.Length > 256))
                throw new InvalidOperationException("Invalid local Component structure checkpoint.");
            var ids = new HashSet<string>(StringComparer.Ordinal);
            foreach (var list in new[] { saved.components, saved.tombstones })
                foreach (var row in list)
                    if (row == null || !row.IsValid || row.sceneId != saved.sceneId || !ids.Add(row.componentId))
                        throw new InvalidOperationException("Invalid local Component catalog.");
            foreach (var row in saved.components) Catalog.Add(row.componentId, row.Copy());
            foreach (var row in saved.tombstones) Tombstones.Add(row.componentId, row.Copy());
            if (saved.structureRecovery != null)
                foreach (var intent in saved.structureRecovery)
                    if (intent != null && intent.sceneId == saved.sceneId &&
                        (intent.kind == "add_component" || intent.kind == "remove_component") &&
                        intent.expectedComponentRevision >= 0 && intent.expectedComponentRevision <= 9007199254740991L &&
                        intent.historyDirection >= -1 && intent.historyDirection <= 1 &&
                        (string.IsNullOrEmpty(intent.compensatesOperationId) ||
                            (intent.compensatesOperationId.Length <= 128 && intent.compensatesOperationId.Trim() == intent.compensatesOperationId &&
                             Guid.TryParse(intent.epoch, out var intentEpoch) && intentEpoch.ToString("D") == intent.epoch)) &&
                        new TeamForgeColliderComponentCatalogRow { sceneId = intent.sceneId, objectId = intent.objectId,
                            componentId = intent.componentId, typeName = intent.typeName }.IsValid)
                        StructureRecovery.Add(intent);
            _structureVersion = 1; _structureRevision = saved.structureRevision;
            // The checkpoint describes identity, never live authority. Bindings
            // are activated only after a fresh source-bound server snapshot.
        }
    }
}

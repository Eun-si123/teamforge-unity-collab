using System;
using System.Collections.Generic;
using System.Reflection;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace EunSung.TeamForge
{
    // The caller authenticates the complete catalog/digest before preparation.
    // This transaction only owns the exact native Components it creates/removes;
    // it never adopts an unknown local sibling or rewinds Unity's global Undo.
    internal static class TeamForgeColliderTopologyTransaction
    {
        private const int MaximumComponents = 512;
        private const int MaximumTombstones = 4096;
        private const int MaximumLocalBeforeImage = 64 * 1024;
        private const int MaximumArchivedComponents = 32;
        private const int MaximumArchiveCharacters = 1024 * 1024;
        private static readonly Dictionary<string, LocalArchive> DeletedLocal =
            new Dictionary<string, LocalArchive>(StringComparer.Ordinal);
        private static readonly Queue<string> DeletedLocalOrder = new Queue<string>();
        private static int _archiveCharacters;

        private sealed class LocalArchive
        {
            internal TeamForgeColliderComponentCatalogRow Row;
            internal string Json;
            internal float ContactOffset;
            internal bool Enabled;
        }

        internal sealed class Target
        {
            internal TeamForgeColliderComponentCatalogRow Row;
            internal GameObject Owner;
            internal Component Native;
            internal string BeforeImage;
            // Collider.contactOffset can be lost by EditorJsonUtility when
            // recreating a native Component. Preserve it independently.
            internal float BeforeContactOffset;
            internal bool BeforeEnabled;
            internal Component Created;
            internal bool HadNative;
            internal bool NativePrimitiveOrigin;
            internal bool BoundNativeOrigin;
            internal bool OwnerWasAuthoritativelyDeleted;
            internal bool Removed;
        }

        internal sealed class Plan
        {
            private readonly List<Target> _active;
            private readonly List<Target> _removed;
            private readonly string _context;
            private readonly string _sceneId;
            private bool _applied;
            private bool _finished;

            internal Plan(List<Target> active, List<Target> removed, string sceneId)
            {
                _active = active;
                _removed = removed;
                _sceneId = sceneId;
                _context = TeamForgeColliderComponentBindings.ContextIdentity;
            }

            internal bool Apply(out string error)
            {
                error = string.Empty;
                if (_finished || _applied || !CurrentContext())
                { error = "The prepared Collider topology belongs to another lifecycle/context."; return false; }
                if (!ValidateBeforeImages(out error)) return false;
                using (TeamForgeRemoteApplyScope.Enter())
                {
                    try
                    {
                        // Create replacement dependencies before removing a last
                        // assignable Collider. All planned types were preflighted.
                        foreach (var target in _active)
                        {
                            if (!CurrentContext() || !OwnerMatches(target.Row, target.Owner))
                                throw new InvalidOperationException("Collider owner/context changed during apply.");
                            if (target.HadNative)
                            {
                                if (!TargetUnchanged(target))
                                    throw new InvalidOperationException("An existing Collider changed owner/type.");
                                if (!TeamForgeColliderComponentBindings.TryBind(target.Row, target.Native, out error))
                                    throw new InvalidOperationException(error);
                                if (target.NativePrimitiveOrigin) target.BoundNativeOrigin = true;
                                continue;
                            }
                            // A native target appearing after preparation is a
                            // conflict, not permission to create a second alias.
                            if (TeamForgeColliderComponentBindings.TryResolveForRemoval(target.Row, out _, out _) ||
                                SavedIdHasNativeObject(target.Row.componentId))
                                throw new InvalidOperationException("The missing Collider target changed after preparation.");
                            if (!TeamForgeColliderComponentBindings.CanCreateMissing(target.Row, out error))
                                throw new InvalidOperationException(error);
                            target.Created = AddExact(target.Owner, target.Row.typeName);
                            RestoreArchivedLocalFields(_context, target.Row, target.Created);
                            if (!NativeMatches(target.Row, target.Owner, target.Created) ||
                                !TeamForgeColliderComponentBindings.TryBind(target.Row, target.Created, out error))
                                throw new InvalidOperationException("The new Collider could not be bound exactly.");
                            EditorSceneManager.MarkSceneDirty(target.Owner.scene);
                        }
                        foreach (var target in _removed)
                        {
                            if (target.OwnerWasAuthoritativelyDeleted && !DeletedOwnerAbsent(target.Row))
                                throw new InvalidOperationException("The deleted Collider owner changed after preflight.");
                            if (target.Native == null)
                            {
                                if (!TeamForgeColliderComponentBindings.Forget(target.Row, out error))
                                    throw new InvalidOperationException(error);
                                continue;
                            }
                            if (!CurrentContext() || !TargetUnchanged(target) ||
                                !string.Equals(EditorJsonUtility.ToJson(target.Native), target.BeforeImage, StringComparison.Ordinal) ||
                                !LocalFieldsUnchanged(target))
                                throw new InvalidOperationException("A removed Collider changed locally; its work was preserved.");
                            UnityEngine.Object.DestroyImmediate(target.Native);
                            if (target.Native != null)
                                throw new InvalidOperationException("Unity refused to remove the exact Collider.");
                            target.Removed = true;
                            if (!TeamForgeColliderComponentBindings.Forget(target.Row, out error))
                                throw new InvalidOperationException(error);
                            EditorSceneManager.MarkSceneDirty(target.Owner.scene);
                        }
                        _applied = true;
                        return true;
                    }
                    catch (Exception)
                    {
                        var restored = RollbackOwned(out var rollbackError);
                        error = restored
                            ? "Collider topology apply failed; this transaction's native changes were restored."
                            : "Collider topology apply failed and rollback is incomplete: " + rollbackError;
                        _finished = restored;
                        return false;
                    }
                }
            }

            internal bool Rollback(out string error)
            {
                if (_finished)
                {
                    error = _applied ? "A committed Collider topology cannot be rolled back." : string.Empty;
                    return !_applied;
                }
                using (TeamForgeRemoteApplyScope.Enter())
                {
                    var restored = RollbackOwned(out error);
                    _finished = restored;
                    return restored;
                }
            }

            internal bool Commit(out string error)
            {
                if (!_applied || _finished || !CurrentContext())
                { error = "Only the applied current-context Collider topology can be committed."; return false; }
                if (!TeamForgeColliderComponentBindings.RefreshSavedBindings(out error)) return false;
                foreach (var target in _active)
                    if (target.BoundNativeOrigin)
                        TeamForgeHierarchySyncService.CompleteNativePrimitiveOrigin(target.Row, target.Native);
                foreach (var target in _removed)
                    if (target.Removed && target.BeforeImage != null)
                        RememberDeletedLocal(_context, target.Row, target.BeforeImage,
                            target.BeforeContactOffset, target.BeforeEnabled);
                _finished = true;
                return true;
            }

            private bool CurrentContext() =>
                string.Equals(_context, TeamForgeColliderComponentBindings.ContextIdentity, StringComparison.Ordinal) &&
                (string.IsNullOrEmpty(_sceneId) || TeamForgeColliderComponentBindings.IsActiveFor(_sceneId));

            private bool ValidateBeforeImages(out string error)
            {
                foreach (var target in _active)
                {
                    if (!OwnerMatches(target.Row, target.Owner) || !TargetUnchanged(target))
                    { error = "A prepared Collider owner/type no longer matches."; return false; }
                }
                foreach (var target in _removed)
                {
                    if (target.OwnerWasAuthoritativelyDeleted)
                    {
                        if (!DeletedOwnerAbsent(target.Row))
                        { error = "The authoritative deleted Collider owner is no longer absent."; return false; }
                        continue;
                    }
                    if (!OwnerMatches(target.Row, target.Owner))
                    { error = "A tombstoned Collider owner no longer matches."; return false; }
                    if (!TargetUnchanged(target) || (target.Native != null &&
                        (!string.Equals(EditorJsonUtility.ToJson(target.Native), target.BeforeImage, StringComparison.Ordinal) ||
                         !LocalFieldsUnchanged(target))))
                    { error = "A tombstoned Collider changed locally after preflight."; return false; }
                }
                return DependenciesRemainValid(_active, _removed, out error);
            }

            private bool RollbackOwned(out string error)
            {
                var failures = 0;
                if (!CurrentContext())
                { error = "The Component binding context changed before rollback."; return false; }
                // Restore removed dependencies before removing their temporary
                // replacements, so RequireComponent remains satisfied throughout.
                foreach (var target in _removed)
                {
                    if (!target.Removed) continue;
                    try
                    {
                        if (!OwnerMatches(target.Row, target.Owner)) { failures++; continue; }
                        if (TeamForgeColliderComponentBindings.TryResolveForRemoval(target.Row, out _, out _))
                        { failures++; continue; }
                        // This before-image was captured locally from the exact
                        // allowed native type, never deserialized from a peer.
                        var restored = AddExact(target.Owner, target.Row.typeName);
                        if (!NativeMatches(target.Row, target.Owner, restored)) { failures++; continue; }
                        EditorJsonUtility.FromJsonOverwrite(target.BeforeImage, restored);
                        RestoreLocalFields(restored, target.BeforeContactOffset, target.BeforeEnabled);
                        if (!NativeMatches(target.Row, target.Owner, restored) ||
                            !TeamForgeColliderComponentBindings.TryBind(target.Row, restored, out _))
                        { failures++; continue; }
                        target.Native = restored;
                        target.Removed = false;
                        EditorSceneManager.MarkSceneDirty(target.Owner.scene);
                    }
                    catch (Exception) { failures++; }
                }
                // Remove only Components born in this transaction. Existing
                // siblings and all unrelated GameObjects remain untouched.
                for (var index = _active.Count - 1; index >= 0; index--)
                {
                    var target = _active[index];
                    if (target.Created == null) continue;
                    try
                    {
                        if (!NativeMatches(target.Row, target.Owner, target.Created)) { failures++; continue; }
                        if (!DependenciesRemainValidForOwner(target.Owner,
                            new HashSet<Component> { target.Created }, new List<Type>(), out _))
                        { failures++; continue; }
                        var ownsBinding = TeamForgeColliderComponentBindings.TryResolve(target.Row.sceneId,
                            target.Row.objectId, target.Row.componentId, target.Row.typeName, out var current, out _) &&
                            current == target.Created;
                        UnityEngine.Object.DestroyImmediate(target.Created);
                        if (target.Created != null) { failures++; continue; }
                        target.Created = null;
                        if (ownsBinding && !TeamForgeColliderComponentBindings.Forget(target.Row, out _)) failures++;
                    }
                    catch (Exception) { failures++; }
                }
                // Native-origin bindings are provisional until commit. On
                // failure remove only the exact binding born in this plan;
                // never touch the original user Collider or other siblings.
                foreach (var target in _active)
                    if (target.BoundNativeOrigin &&
                        !TeamForgeColliderComponentBindings.TryUnbindProvisional(target.Row, target.Native))
                        failures++;
                _applied = false;
                if (failures == 0 && !TeamForgeColliderComponentBindings.RefreshSavedBindings(out var checkpointError))
                {
                    error = "Native Collider targets were restored, but their binding checkpoint failed: " + checkpointError;
                    return false;
                }
                error = failures == 0 ? string.Empty : failures + " exact Collider target(s) could not be restored.";
                return failures == 0;
            }
        }

        internal static bool TryPrepare(
            IReadOnlyList<TeamForgeColliderComponentCatalogRow> components,
            IReadOnlyList<TeamForgeColliderComponentCatalogRow> tombstones,
            IReadOnlyList<TeamForgeColliderProperty> incomingPropertyRows,
            IReadOnlyList<TeamForgeColliderProperty> previousPropertyRows,
            out Plan plan, out string error)
        {
            plan = null;
            if (EditorApplication.isPlayingOrWillChangePlaymode || components == null || tombstones == null ||
                incomingPropertyRows == null || previousPropertyRows == null ||
                components.Count > MaximumComponents || tombstones.Count > MaximumTombstones ||
                incomingPropertyRows.Count != components.Count * 3)
            { error = "A bounded complete EditMode Collider catalog is required."; return false; }
            var active = new List<Target>();
            var removed = new List<Target>();
            var identities = new Dictionary<string, TeamForgeColliderComponentCatalogRow>(StringComparer.Ordinal);
            var nativeTargets = new HashSet<EntityId>();
            var sceneId = string.Empty;
            try
            {
                foreach (var row in components)
                {
                    var captured = row?.Copy();
                    if (!ValidateCatalogRow(captured, ref sceneId, identities, out error) ||
                        !TryTarget(captured, false, nativeTargets, out var target, out error)) return false;
                    active.Add(target);
                }
                foreach (var row in tombstones)
                {
                    var captured = row?.Copy();
                    if (!ValidateCatalogRow(captured, ref sceneId, identities, out error) ||
                        !TryTarget(captured, true, nativeTargets, out var target, out error)) return false;
                    removed.Add(target);
                }
                if (!string.IsNullOrEmpty(sceneId) && !TeamForgeColliderComponentBindings.IsActiveFor(sceneId))
                { error = "The Collider catalog has no matching active binding context."; return false; }
                if (!ValidatePreviousIdentity(components, tombstones, previousPropertyRows, out error) ||
                    !ValidateProperties(components, incomingPropertyRows, out error) ||
                    !DependenciesRemainValid(active, removed, out error)) return false;
                plan = new Plan(active, removed, sceneId);
                error = string.Empty;
                return true;
            }
            catch (Exception)
            {
                error = "Collider topology could not be completely preflighted; no native objects changed.";
                return false;
            }
        }

        private static bool ValidateCatalogRow(TeamForgeColliderComponentCatalogRow row, ref string sceneId,
            Dictionary<string, TeamForgeColliderComponentCatalogRow> identities, out string error)
        {
            if (row == null || !row.IsValid || row.serverRevision > 9007199254740991L ||
                (row.typeName != "UnityEngine.BoxCollider" && row.typeName != "UnityEngine.SphereCollider") ||
                (!string.IsNullOrEmpty(sceneId) && sceneId != row.sceneId) || identities.ContainsKey(row.componentId))
            { error = "Collider catalog identity is invalid, duplicated or crosses Scenes."; return false; }
            sceneId = row.sceneId;
            identities.Add(row.componentId, row);
            error = string.Empty;
            return true;
        }

        private static bool TryTarget(TeamForgeColliderComponentCatalogRow row, bool remove,
            HashSet<EntityId> nativeTargets, out Target target, out string error)
        {
            target = null;
            if (!TeamForgeColliderComponentBindings.TryResolveOwner(row.sceneId, row.objectId, out var owner, out _) ||
                !OwnerMatches(row, owner))
            {
                if (remove && DeletedOwnerAbsent(row))
                {
                    target = new Target { Row = Clone(row), OwnerWasAuthoritativelyDeleted = true };
                    error = string.Empty; return true;
                }
                error = "The exact saved non-Prefab Collider GameObject is unavailable."; return false;
            }
            // The authenticated active catalog can restore an exact retained
            // tombstone alias. This never selects an unknown local sibling.
            TeamForgeColliderComponentBindings.TryResolveForRemoval(row, out var native, out _);
            var nativeOrigin = false;
            if (native == null && !remove &&
                TeamForgeHierarchySyncService.TryResolveNativePrimitiveCollider(row, owner, out var adopted))
            { native = adopted; nativeOrigin = true; }
            // If a shared template already has an unbound native Collider but
            // no exact, approved origin, materializing another one would create
            // duplicate physics. Pause instead of guessing the alias.
            if (native == null && !remove &&
                TeamForgeHierarchySyncService.HasUnboundNativePrimitiveCollider(row, owner))
            { error = "Unbound native Collider on shared primitive; exact original admission is required."; return false; }
            if (native == null && SavedIdHasNativeObject(row.componentId))
            { error = "A saved Component ID resolves to a different owner or type."; return false; }
            if (native == null && !remove && !TeamForgeColliderComponentBindings.CanCreateMissing(row, out error))
                return false;
            if (native != null && (!NativeMatches(row, owner, native) || !nativeTargets.Add(native.GetEntityId())))
            { error = "Two catalog identities address one native Component, or its owner/type changed."; return false; }
            var beforeImage = native != null && remove ? EditorJsonUtility.ToJson(native) : null;
            if (beforeImage != null && beforeImage.Length > MaximumLocalBeforeImage)
            { error = "The local Collider rollback before-image exceeds its budget."; return false; }
            target = new Target { Row = Clone(row), Owner = owner, Native = native,
                HadNative = native != null, NativePrimitiveOrigin = nativeOrigin, BeforeImage = beforeImage,
                BeforeContactOffset = native != null ? ((Collider)native).contactOffset : 0f,
                BeforeEnabled = native != null && ((Collider)native).enabled };
            error = string.Empty;
            return true;
        }

        private static bool ValidateProperties(IReadOnlyList<TeamForgeColliderComponentCatalogRow> components,
            IReadOnlyList<TeamForgeColliderProperty> rows, out string error)
        {
            var expected = new Dictionary<string, TeamForgeColliderComponentCatalogRow>(StringComparer.Ordinal);
            foreach (var row in components) expected.Add(row.componentId, row);
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var property in rows)
            {
                if (property == null || !property.IsValid || property.Revision > 9007199254740991L ||
                    !expected.TryGetValue(property.ComponentId, out var identity) ||
                    property.SceneId != identity.sceneId || property.ObjectId != identity.objectId ||
                    property.TypeName != identity.typeName || property.Revision < identity.serverRevision ||
                    !seen.Add(property.ComponentId + "|" + property.Path))
                { error = "Collider properties do not match the complete exact topology."; return false; }
            }
            // Property.IsValid restricts each type to exactly its three paths.
            foreach (var row in components)
                if (!seen.Contains(row.componentId + "|m_IsTrigger") || !seen.Contains(row.componentId + "|m_Center") ||
                    !seen.Contains(row.componentId + (row.typeName == "UnityEngine.BoxCollider" ? "|m_Size" : "|m_Radius")))
                { error = "Each active Collider requires all three typed values."; return false; }
            error = string.Empty;
            return true;
        }

        private static bool ValidatePreviousIdentity(
            IReadOnlyList<TeamForgeColliderComponentCatalogRow> components,
            IReadOnlyList<TeamForgeColliderComponentCatalogRow> tombstones,
            IReadOnlyList<TeamForgeColliderProperty> previous, out string error)
        {
            var known = new Dictionary<string, TeamForgeColliderProperty>(StringComparer.Ordinal);
            foreach (var property in previous)
            {
                if (property == null || !property.IsValid)
                { error = "The previous Collider identity view is invalid."; return false; }
                if (known.TryGetValue(property.ComponentId, out var existing) &&
                    (existing.SceneId != property.SceneId || existing.ObjectId != property.ObjectId || existing.TypeName != property.TypeName))
                { error = "The previous Collider identity view is ambiguous."; return false; }
                known[property.ComponentId] = property;
            }
            foreach (var collection in new[] { components, tombstones })
                foreach (var row in collection)
                    if (known.TryGetValue(row.componentId, out var existing) &&
                        (existing.SceneId != row.sceneId || existing.ObjectId != row.objectId || existing.TypeName != row.typeName))
                    { error = "A canonical Collider identity cannot change owner, type or Scene."; return false; }
            error = string.Empty;
            return true;
        }

        private static bool DependenciesRemainValid(List<Target> active, List<Target> removed, out string error)
        {
            var owners = new HashSet<GameObject>();
            foreach (var target in removed) if (target.Native != null) owners.Add(target.Owner);
            foreach (var owner in owners)
            {
                var removedNative = new HashSet<Component>();
                foreach (var target in removed) if (target.Owner == owner && target.Native != null) removedNative.Add(target.Native);
                var addedTypes = new List<Type>();
                foreach (var target in active)
                    if (target.Owner == owner && target.Native == null)
                        addedTypes.Add(AllowedType(target.Row.typeName));
                if (!DependenciesRemainValidForOwner(owner, removedNative, addedTypes, out error)) return false;
            }
            error = string.Empty;
            return true;
        }

        private static bool DependenciesRemainValidForOwner(GameObject owner, HashSet<Component> removedNative,
            List<Type> addedTypes, out string error)
        {
            var remainingTypes = new List<Type>(addedTypes);
            var remainingComponents = new List<Component>();
            foreach (var component in owner.GetComponents<Component>())
            {
                if (component == null)
                { error = "A missing script prevents safe Component dependency inspection."; return false; }
                if (removedNative.Contains(component)) continue;
                remainingTypes.Add(component.GetType());
                remainingComponents.Add(component);
            }
            foreach (var component in remainingComponents)
                for (var type = component.GetType(); type != null && typeof(Component).IsAssignableFrom(type); type = type.BaseType)
                    foreach (var attribute in CustomAttributeData.GetCustomAttributes(type))
                    {
                        if (attribute.AttributeType != typeof(RequireComponent)) continue;
                        foreach (var argument in attribute.ConstructorArguments)
                        {
                            var required = argument.Value as Type;
                            if (required == null) continue;
                            var satisfied = false;
                            foreach (var candidate in remainingTypes)
                                if (required.IsAssignableFrom(candidate)) { satisfied = true; break; }
                            if (!satisfied)
                            { error = "The Collider removal would violate a RequireComponent dependency."; return false; }
                        }
                    }
            error = string.Empty;
            return true;
        }

        private static bool OwnerMatches(TeamForgeColliderComponentCatalogRow row, GameObject owner)
        {
            if (owner == null || !owner.scene.IsValid() || !owner.scene.isLoaded || string.IsNullOrEmpty(owner.scene.path) ||
                AssetDatabase.AssetPathToGUID(owner.scene.path) != row.sceneId || PrefabUtility.IsPartOfAnyPrefab(owner)) return false;
            return TeamForgeColliderComponentBindings.TryResolveOwner(row.sceneId, row.objectId, out var exact, out _) && exact == owner;
        }

        private static bool NativeMatches(TeamForgeColliderComponentCatalogRow row, GameObject owner, Component component) =>
            component != null && OwnerMatches(row, owner) && component.gameObject == owner &&
            component.GetType() == AllowedType(row.typeName) && !PrefabUtility.IsPartOfAnyPrefab(component);

        private static bool LocalFieldsUnchanged(Target target) =>
            target.Native == null || ((Collider)target.Native).contactOffset == target.BeforeContactOffset &&
            ((Collider)target.Native).enabled == target.BeforeEnabled;

        private static void RestoreLocalFields(Component native, float contactOffset, bool enabled)
        {
            var collider = (Collider)native;
            // Unity may discard contactOffset writes on a disabled Collider.
            // Restore while temporarily enabled, then restore the exact local
            // enabled state. This runs only in EditMode under RemoteApplyScope.
            collider.enabled = true;
            collider.contactOffset = contactOffset;
            collider.enabled = enabled;
        }

        private static bool TargetUnchanged(Target target)
        {
            var resolves = TeamForgeColliderComponentBindings.TryResolveForRemoval(target.Row, out var current, out _);
            if (target.NativePrimitiveOrigin)
                return target.Native != null && !resolves &&
                    TeamForgeHierarchySyncService.TryResolveNativePrimitiveCollider(
                        target.Row, target.Owner, out var origin) && origin == target.Native &&
                    NativeMatches(target.Row, target.Owner, target.Native);
            return !target.HadNative ? !resolves && !SavedIdHasNativeObject(target.Row.componentId) :
                target.Native != null && resolves && current == target.Native &&
                NativeMatches(target.Row, target.Owner, target.Native);
        }

        private static bool DeletedOwnerAbsent(TeamForgeColliderComponentCatalogRow row) =>
            TeamForgeHierarchySyncService.IsAuthoritativelyDeleted(row.sceneId, row.objectId) &&
            !TeamForgeObjectIdentity.TryResolveGameObject(row.objectId, out _);

        private static Type AllowedType(string typeName) => typeName == "UnityEngine.BoxCollider" ? typeof(BoxCollider) :
            typeName == "UnityEngine.SphereCollider" ? typeof(SphereCollider) : null;
        private static Component AddExact(GameObject owner, string typeName)
        {
            if (typeName == "UnityEngine.BoxCollider") return owner.AddComponent<BoxCollider>();
            if (typeName == "UnityEngine.SphereCollider") return owner.AddComponent<SphereCollider>();
            throw new InvalidOperationException("Unsupported Collider type.");
        }

        private static bool SavedIdHasNativeObject(string componentId) =>
            GlobalObjectId.TryParse(componentId, out var id) &&
            GlobalObjectId.GlobalObjectIdentifierToObjectSlow(id) != null;

        private static TeamForgeColliderComponentCatalogRow Clone(TeamForgeColliderComponentCatalogRow row) =>
            new TeamForgeColliderComponentCatalogRow { sceneId = row.sceneId, objectId = row.objectId,
                componentId = row.componentId, typeName = row.typeName, serverRevision = row.serverRevision };

        // Bounded in-memory undo convenience only. It is never accepted from
        // network/disk and never establishes Component identity or authority.
        private static void RememberDeletedLocal(string context, TeamForgeColliderComponentCatalogRow row,
            string json, float contactOffset, bool enabled)
        {
            var key = context + "|" + row.componentId;
            if (DeletedLocal.TryGetValue(key, out var old)) _archiveCharacters -= old.Json.Length;
            else DeletedLocalOrder.Enqueue(key);
            DeletedLocal[key] = new LocalArchive { Row = Clone(row), Json = json,
                ContactOffset = contactOffset, Enabled = enabled };
            _archiveCharacters += json.Length;
            while (DeletedLocal.Count > MaximumArchivedComponents || _archiveCharacters > MaximumArchiveCharacters)
            {
                var oldest = DeletedLocalOrder.Dequeue();
                if (!DeletedLocal.TryGetValue(oldest, out var archive)) continue;
                _archiveCharacters -= archive.Json.Length;
                DeletedLocal.Remove(oldest);
            }
        }

        private static void RestoreArchivedLocalFields(string context, TeamForgeColliderComponentCatalogRow row, Component native)
        {
            if (!DeletedLocal.TryGetValue(context + "|" + row.componentId, out var archive)) return;
            if (archive.Row.sceneId != row.sceneId || archive.Row.objectId != row.objectId ||
                archive.Row.componentId != row.componentId || archive.Row.typeName != row.typeName)
                throw new InvalidOperationException("A local Collider archive cannot change identity owner/type.");
            if (!NativeMatches(row, native.gameObject, native))
                throw new InvalidOperationException("Local Collider archive target does not match.");
            var owner = native.gameObject;
            EditorJsonUtility.FromJsonOverwrite(archive.Json, native);
            RestoreLocalFields(native, archive.ContactOffset, archive.Enabled);
            if (!NativeMatches(row, owner, native))
                throw new InvalidOperationException("Local Collider archive changed owner or type.");
        }
    }
}

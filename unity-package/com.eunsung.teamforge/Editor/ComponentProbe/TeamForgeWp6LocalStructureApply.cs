using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace EunSung.TeamForge
{
    // M2 Editor-side structural mutation pilot. Local tests only: caller-supplied
    // records are NOT Server-authenticated and cannot be used from network handlers.
    // Deliberately one edit per saved-source witness; a dirty Scene needs explicit
    // reconciliation, ID mapping and a new trusted snapshot before further writes.
    internal static class TeamForgeWp6LocalStructureApply
    {
        internal sealed class Intent
        {
            internal Intent(string operationId, string kind, string sceneId,
                string objectId, string componentId, string typeName,
                long baseRevision, long nextRevision)
            {
                OperationId = operationId;
                Kind = kind;
                SceneId = sceneId;
                ObjectId = objectId;
                ComponentId = componentId;
                TypeName = typeName;
                BaseRevision = baseRevision;
                NextRevision = nextRevision;
            }

            internal string OperationId { get; }
            internal string Kind { get; }
            internal string SceneId { get; }
            internal string ObjectId { get; }
            internal string ComponentId { get; }
            internal string TypeName { get; }
            internal long BaseRevision { get; }
            internal long NextRevision { get; }
        }

        internal sealed class Preview
        {
            internal readonly TeamForgeSceneBaseline source;
            internal readonly string metaSha256;
            internal readonly TeamForgeWp6SceneInventory.Snapshot initial;
            internal readonly long revision;
            internal bool consumed;

            internal Preview(TeamForgeSceneBaseline source, string metaSha256,
                TeamForgeWp6SceneInventory.Snapshot initial, long revision)
            {
                this.source = source;
                this.metaSha256 = metaSha256;
                this.initial = initial;
                this.revision = revision;
            }

            internal bool Consumed => consumed;
        }

        internal sealed class Outcome
        {
            internal Outcome(int undoGroup, bool addedLocally)
            {
                UndoGroup = undoGroup;
                AddedLocally = addedLocally;
            }
            internal int UndoGroup { get; }
            // Do not expose an ephemeral Unity InstanceID or EntityId: neither
            // is a stable saved Component ID or a remote acknowledgement.
            internal bool AddedLocally { get; }
        }

        internal static bool TryBeginForLocalTest(TeamForgeSceneBaseline expected,
            string metaSha256, long revision, out Preview preview, out string error)
        {
            preview = null;
            if (revision < 0 || revision == long.MaxValue || expected == null ||
                !TeamForgeWp6SerializedSceneWitness.TryCapture(
                    expected, metaSha256, out var witness, out error))
            {
                error = "A clean, exact saved Collider Scene and bounded local revision are required.";
                return false;
            }
            var fixedSource = new TeamForgeSceneBaseline {
                scenePath = expected.scenePath,
                sceneGuid = expected.sceneGuid,
                sha256 = expected.sha256,
            };
            preview = new Preview(fixedSource, metaSha256, witness.Source.Inventory, revision);
            error = string.Empty;
            return true;
        }

        internal static bool TryApplyForLocalTest(Preview preview, Intent intent,
            out Outcome outcome, out string error)
        {
            outcome = null;
            error = "Local Component structure preview is absent, consumed, or invalid.";
            if (preview == null || preview.Consumed || !ValidIntent(preview, intent))
                return false;

            if (!TeamForgeWp6SerializedSceneWitness.TryCapture(
                    preview.source, preview.metaSha256, out var current, out error) ||
                !SameInventory(preview.initial, current.Source.Inventory))
            {
                error = "Saved Scene source/Collider values changed; recapture before editing.";
                return false;
            }

            var scene = SceneManager.GetActiveScene();
            if (!scene.IsValid() || !scene.isLoaded || scene.isDirty ||
                !string.Equals(scene.path, preview.source.scenePath, StringComparison.Ordinal) ||
                !GlobalObjectId.TryParse(intent.ObjectId, out var ownerId) ||
                ownerId.ToString() != intent.ObjectId || ownerId.identifierType != 2 ||
                ownerId.targetObjectId == 0UL || ownerId.targetPrefabId != 0UL ||
                ownerId.assetGUID.ToString() != preview.initial.SceneId)
            {
                error = "Exact saved Scene owner identity is missing.";
                return false;
            }

            GameObject owner;
            try
            {
                owner = GlobalObjectId.GlobalObjectIdentifierToObjectSlow(ownerId) as GameObject;
                if (owner == null || owner.scene != scene ||
                    PrefabUtility.IsPartOfAnyPrefab(owner) || !OnlySafeComponents(owner))
                {
                    error = "Owner is missing, a Prefab, or has unverified Component dependencies.";
                    return false;
                }
            }
            catch (Exception)
            {
                error = "Saved owner identity could not be safely resolved.";
                return false;
            }

            var isAdd = intent.Kind == "add_component";
            Component removed = null;
            if (!isAdd)
            {
                var expected = Find(preview.initial, intent.ComponentId);
                if (expected == null || expected.ObjectId != intent.ObjectId ||
                    expected.TypeName != intent.TypeName)
                {
                    error = "Removal requires the exact admitted saved Component and owner.";
                    return false;
                }
                var record = new TeamForgeWp6ComponentIdentity.Record(
                    intent.SceneId, intent.ObjectId, intent.ComponentId, intent.TypeName);
                if (!TeamForgeWp6ComponentIdentity.TryResolve(record, out removed, out error) ||
                    removed == null || removed.gameObject != owner)
                    return false;
            }
            else if (preview.initial.Observations.Count >= TeamForgeWp6SceneInventory.MaximumAllowlistedColliders)
            {
                error = "Adding this Component would exceed the bounded Scene inventory.";
                return false;
            }

            // Every original Collider must still be the exact source-bound
            // object. Do not infer identity from sibling order or type.
            if (!CheckRemaining(preview.initial, null, null))
            {
                error = "Existing Collider identity or values changed before local apply.";
                return false;
            }

            var group = -1;
            try
            {
                Undo.IncrementCurrentGroup();
                group = Undo.GetCurrentGroup();
                Undo.SetCurrentGroupName("TeamForge M2 local structure preview");
                Component added = null;
                if (isAdd)
                    added = intent.TypeName == "UnityEngine.BoxCollider"
                        ? (Component)Undo.AddComponent<BoxCollider>(owner)
                        : Undo.AddComponent<SphereCollider>(owner);
                else
                    Undo.DestroyObjectImmediate(removed);
                Undo.FlushUndoRecordObjects();

                if ((isAdd && (added == null || added.gameObject != owner)) ||
                    (!isAdd && removed != null) ||
                    !CheckRemaining(preview.initial, isAdd ? null : intent.ComponentId, added) ||
                    !CheckCompleteColliderSet(scene, preview.initial, isAdd ? null : intent.ComponentId, added))
                {
                    Undo.RevertAllDownToGroup(group);
                    error = "Unity did not apply exactly the expected add/remove operation.";
                    return false;
                }
                preview.consumed = true;
                outcome = new Outcome(group, added != null);
                error = string.Empty;
                return true;
            }
            catch (Exception)
            {
                var rolledBack = group < 0;
                if (group >= 0)
                {
                    try { Undo.RevertAllDownToGroup(group); rolledBack = true; }
                    catch (Exception) { rolledBack = false; }
                }
                error = rolledBack
                    ? "Local structure edit failed; recapture Scene before retry."
                    : "Local structure edit and Undo rollback failed; inspect Scene before retry.";
                return false;
            }
        }

        private static bool ValidIntent(Preview preview, Intent intent)
        {
            if (intent == null || !ValidToken(intent.OperationId, 80) ||
                (intent.Kind != "add_component" && intent.Kind != "remove_component") ||
                intent.SceneId != preview.initial.SceneId ||
                string.IsNullOrEmpty(intent.ObjectId) || intent.ObjectId.Length > 512 ||
                intent.TypeName != "UnityEngine.BoxCollider" &&
                intent.TypeName != "UnityEngine.SphereCollider" ||
                intent.BaseRevision != preview.revision ||
                intent.NextRevision != preview.revision + 1)
                return false;

            if (intent.Kind == "remove_component")
                return !string.IsNullOrEmpty(intent.ComponentId) && intent.ComponentId.Length <= 512;
            if (intent.ComponentId == null || intent.ComponentId.Length != 37 ||
                !intent.ComponentId.StartsWith("tf:c:", StringComparison.Ordinal))
                return false;
            for (var i = 5; i < intent.ComponentId.Length; i++)
                if (!(intent.ComponentId[i] >= '0' && intent.ComponentId[i] <= '9') &&
                    !(intent.ComponentId[i] >= 'a' && intent.ComponentId[i] <= 'f'))
                    return false;
            return true;
        }

        private static bool ValidToken(string value, int max)
        {
            if (string.IsNullOrEmpty(value) || value.Length > max) return false;
            foreach (var c in value)
                if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
                    (c >= '0' && c <= '9') || c == '-' || c == '_')) return false;
            return true;
        }

        private static bool OnlySafeComponents(GameObject gameObject)
        {
            foreach (var component in gameObject.GetComponents<Component>())
                if (component == null || component.GetType() != typeof(Transform) &&
                    component.GetType() != typeof(BoxCollider) &&
                    component.GetType() != typeof(SphereCollider))
                    return false;
            return true;
        }

        private static TeamForgeWp6InspectorProbe.Observation Find(
            TeamForgeWp6SceneInventory.Snapshot snapshot, string componentId)
        {
            foreach (var row in snapshot.Observations)
                if (row.ComponentId == componentId) return row;
            return null;
        }

        private static bool CheckRemaining(TeamForgeWp6SceneInventory.Snapshot initial,
            string removedId, Component added)
        {
            foreach (var row in initial.Observations)
            {
                if (removedId != null && row.ComponentId == removedId) continue;
                var record = new TeamForgeWp6ComponentIdentity.Record(
                    row.SceneId, row.ObjectId, row.ComponentId, row.TypeName);
                if (!TeamForgeWp6ComponentIdentity.TryResolve(record, out var live, out _) ||
                    live == null || live == added ||
                    !TeamForgeWp6InspectorProbe.TryCapture(live, out var observed, out _) ||
                    !SameObservation(row, observed)) return false;
            }
            return true;
        }

        private static bool CheckCompleteColliderSet(Scene scene,
            TeamForgeWp6SceneInventory.Snapshot before, string removedId, Component added)
        {
            var expected = new HashSet<string>(StringComparer.Ordinal);
            foreach (var entry in before.Observations)
                expected.Add(entry.ComponentId);
            if (removedId != null) expected.Remove(removedId);

            var found = 0;
            var sawAdded = added == null;
            var ids = new HashSet<string>(StringComparer.Ordinal);
            foreach (var root in scene.GetRootGameObjects())
            {
                foreach (var collider in root.GetComponentsInChildren<Collider>(true))
                {
                    if (collider.GetType() != typeof(BoxCollider) &&
                        collider.GetType() != typeof(SphereCollider)) continue;
                    found++;
                    if (found > TeamForgeWp6SceneInventory.MaximumAllowlistedColliders)
                        return false;
                    if (collider == added) { sawAdded = true; continue; }
                    if (!TeamForgeWp6ComponentIdentity.TryCapture(collider, out var identity, out _) ||
                        !expected.Contains(identity.ComponentId) ||
                        !ids.Add(identity.ComponentId)) return false;
                }
            }
            return sawAdded && ids.SetEquals(expected) &&
                   found == before.Observations.Count + (added != null ? 1 : -1);
        }

        private static bool SameInventory(TeamForgeWp6SceneInventory.Snapshot a,
            TeamForgeWp6SceneInventory.Snapshot b)
        {
            if (a.SceneId != b.SceneId || a.SceneDirty != b.SceneDirty ||
                a.Observations.Count != b.Observations.Count) return false;
            for (var i = 0; i < a.Observations.Count; i++)
                if (!SameObservation(a.Observations[i], b.Observations[i])) return false;
            return true;
        }

        private static bool SameObservation(TeamForgeWp6InspectorProbe.Observation a,
            TeamForgeWp6InspectorProbe.Observation b)
        {
            if (a.SceneId != b.SceneId || a.ObjectId != b.ObjectId ||
                a.ComponentId != b.ComponentId || a.TypeName != b.TypeName ||
                a.Properties.Count != b.Properties.Count) return false;
            for (var i = 0; i < a.Properties.Count; i++)
            {
                var x = a.Properties[i]; var y = b.Properties[i];
                if (x.Path != y.Path || x.Kind != y.Kind || x.Boolean != y.Boolean ||
                    x.Number != y.Number || x.Vector.x != y.Vector.x ||
                    x.Vector.y != y.Vector.y || x.Vector.z != y.Vector.z) return false;
            }
            return true;
        }
    }
}

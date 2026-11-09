using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

namespace EunSung.TeamForge
{
    // A local read-only comparison for two complete WP6 allowlisted inventory
    // observations. The result is diagnostic, not a set of authorized edits.
    // Never send this as a network operation or use it as an Undo recipe.
    internal static class TeamForgeWp6SceneComparison
    {
        internal enum ChangeKind
        {
            Added,
            Removed,
            PropertiesChanged,
        }

        internal sealed class Change
        {
            internal Change(string componentId, string objectId, string typeName,
                ChangeKind kind, List<string> propertyPaths)
            {
                ComponentId = componentId;
                ObjectId = objectId;
                TypeName = typeName;
                Kind = kind;
                ChangedPropertyPaths = propertyPaths.AsReadOnly();
            }

            internal string ComponentId { get; }
            internal string ObjectId { get; }
            internal string TypeName { get; }
            internal ChangeKind Kind { get; }
            // Names only; property values never appear in the change report.
            internal IReadOnlyList<string> ChangedPropertyPaths { get; }
        }

        internal sealed class Report
        {
            internal Report(string sceneId, bool beforeDirty, bool afterDirty, List<Change> changes)
            {
                SceneId = sceneId;
                BeforeSceneDirty = beforeDirty;
                AfterSceneDirty = afterDirty;
                Changes = changes.AsReadOnly();
            }

            internal string SceneId { get; }
            internal bool BeforeSceneDirty { get; }
            internal bool AfterSceneDirty { get; }
            internal IReadOnlyList<Change> Changes { get; }
        }

        internal static bool TryCompare(TeamForgeWp6SceneInventory.Snapshot before,
            TeamForgeWp6SceneInventory.Snapshot after, out Report report, out string error)
        {
            report = null;
            if (before == null || after == null ||
                !TeamForgeWp6ComponentIdentity.IsSceneGuid(before.SceneId) ||
                !string.Equals(before.SceneId, after.SceneId, StringComparison.Ordinal))
            {
                error = "WP6 comparison requires two observations of the same saved Scene GUID.";
                return false;
            }

            if (!TryIndex(before, out var earlier, out error) ||
                !TryIndex(after, out var later, out error))
                return false;

            // Sorted dictionary avoids dependence on Hierarchy traversal or
            // Inspector order and yields the same report after reloading.
            var ids = new SortedSet<string>(earlier.Keys, StringComparer.Ordinal);
            ids.UnionWith(later.Keys);
            var changes = new List<Change>();
            foreach (var id in ids)
            {
                var hadBefore = earlier.TryGetValue(id, out var oldValue);
                var hasAfter = later.TryGetValue(id, out var newValue);
                if (!hadBefore)
                {
                    changes.Add(new Change(id, newValue.ObjectId, newValue.TypeName,
                        ChangeKind.Added, new List<string>()));
                    continue;
                }
                if (!hasAfter)
                {
                    changes.Add(new Change(id, oldValue.ObjectId, oldValue.TypeName,
                        ChangeKind.Removed, new List<string>()));
                    continue;
                }

                // One identity changing type or owner indicates conflicting
                // observations, NOT a legitimate property replacement.
                if (!string.Equals(oldValue.ObjectId, newValue.ObjectId, StringComparison.Ordinal) ||
                    !string.Equals(oldValue.TypeName, newValue.TypeName, StringComparison.Ordinal))
                {
                    error = "WP6 comparison found an owner or Component type conflict.";
                    return false;
                }

                var paths = new List<string>(3);
                for (var i = 0; i < oldValue.Properties.Count; i++)
                {
                    if (!EqualValues(oldValue.Properties[i], newValue.Properties[i]))
                        paths.Add(oldValue.Properties[i].Path);
                }
                if (paths.Count > 0)
                    changes.Add(new Change(id, oldValue.ObjectId, oldValue.TypeName,
                        ChangeKind.PropertiesChanged, paths));
            }

            report = new Report(before.SceneId, before.SceneDirty, after.SceneDirty, changes);
            error = string.Empty;
            return true;
        }

        private static bool TryIndex(TeamForgeWp6SceneInventory.Snapshot snapshot,
            out Dictionary<string, TeamForgeWp6InspectorProbe.Observation> indexed,
            out string error)
        {
            indexed = null;
            if (snapshot == null || !TeamForgeWp6ComponentIdentity.IsSceneGuid(snapshot.SceneId) ||
                snapshot.Observations == null ||
                snapshot.Observations.Count > TeamForgeWp6SceneInventory.MaximumAllowlistedColliders)
            {
                error = "WP6 comparison requires a bounded, complete allowlisted inventory.";
                return false;
            }

            var output = new Dictionary<string, TeamForgeWp6InspectorProbe.Observation>(
                StringComparer.Ordinal);
            foreach (var observation in snapshot.Observations)
            {
                if (observation == null || observation.SceneDirty != snapshot.SceneDirty ||
                    !Validate(observation, snapshot.SceneId))
                {
                    error = "WP6 comparison found malformed Component identity or property data.";
                    return false;
                }
                if (output.ContainsKey(observation.ComponentId))
                {
                    error = "WP6 comparison found duplicate Component identities.";
                    return false;
                }
                output.Add(observation.ComponentId, observation);
            }

            indexed = output;
            error = string.Empty;
            return true;
        }

        private static bool Validate(TeamForgeWp6InspectorProbe.Observation value, string sceneId)
        {
            if (value == null || !string.Equals(value.SceneId, sceneId, StringComparison.Ordinal) ||
                !ValidSavedId(value.ObjectId, sceneId, out var objectId) ||
                !ValidSavedId(value.ComponentId, sceneId, out var componentId) ||
                objectId.targetObjectId == componentId.targetObjectId ||
                value.Properties == null || value.Properties.Count != 3)
                return false;

            var box = string.Equals(value.TypeName, "UnityEngine.BoxCollider", StringComparison.Ordinal);
            var sphere = string.Equals(value.TypeName, "UnityEngine.SphereCollider", StringComparison.Ordinal);
            if (!box && !sphere)
                return false;

            return ValidBoolean(value.Properties[0], "m_IsTrigger") &&
                   ValidVector(value.Properties[1], "m_Center", false) &&
                   (box ? ValidVector(value.Properties[2], "m_Size", true)
                        : ValidFloat(value.Properties[2], "m_Radius"));
        }

        private static bool ValidSavedId(string text, string sceneId, out GlobalObjectId parsed)
        {
            parsed = default;
            return !string.IsNullOrEmpty(text) && text.Length <= 512 &&
                   GlobalObjectId.TryParse(text, out parsed) &&
                   string.Equals(parsed.ToString(), text, StringComparison.Ordinal) &&
                   parsed.identifierType == 2 &&
                   parsed.targetObjectId != 0UL && parsed.targetPrefabId == 0UL &&
                   string.Equals(parsed.assetGUID.ToString(), sceneId, StringComparison.Ordinal);
        }

        private static bool ValidBoolean(TeamForgeWp6InspectorProbe.PropertyObservation p, string path)
        {
            return p != null && p.Path == path && p.Kind == "boolean" &&
                   p.Number == 0f && IsZero(p.Vector);
        }

        private static bool ValidVector(TeamForgeWp6InspectorProbe.PropertyObservation p,
            string path, bool nonNegative)
        {
            return p != null && p.Path == path && p.Kind == "vector3" &&
                   !p.Boolean && p.Number == 0f &&
                   InRange(p.Vector.x, nonNegative) &&
                   InRange(p.Vector.y, nonNegative) &&
                   InRange(p.Vector.z, nonNegative);
        }

        private static bool ValidFloat(TeamForgeWp6InspectorProbe.PropertyObservation p, string path)
        {
            return p != null && p.Path == path && p.Kind == "float" &&
                   !p.Boolean && IsZero(p.Vector) && InRange(p.Number, true);
        }

        private static bool InRange(float n, bool nonNegative)
        {
            return !float.IsNaN(n) && !float.IsInfinity(n) &&
                   n <= 100f && n >= (nonNegative ? 0f : -100f);
        }

        private static bool IsZero(Vector3 vector)
        {
            return vector.x == 0f && vector.y == 0f && vector.z == 0f;
        }

        private static bool EqualValues(TeamForgeWp6InspectorProbe.PropertyObservation a,
            TeamForgeWp6InspectorProbe.PropertyObservation b)
        {
            // Exact serializable values, not Unity's approximate Vector3 ==
            // tolerance: even a small finite Inspector change must be visible.
            if (a.Kind == "boolean") return a.Boolean == b.Boolean;
            if (a.Kind == "float") return a.Number == b.Number;
            return a.Vector.x == b.Vector.x &&
                   a.Vector.y == b.Vector.y &&
                   a.Vector.z == b.Vector.z;
        }
    }
}

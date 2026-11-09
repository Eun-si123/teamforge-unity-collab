using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace EunSung.TeamForge
{
    // WP6 local pre-wire observation. An inventory is NOT an authoritative
    // Server baseline and must not be used as permission to apply changes.
    // No network, Undo, Scene writes or persistent state.
    internal static class TeamForgeWp6SceneInventory
    {
        internal const int MaximumSceneObjects = 4096;
        internal const int MaximumAllowlistedColliders = 512;

        internal sealed class Snapshot
        {
            internal Snapshot(string sceneId, bool sceneDirty,
                List<TeamForgeWp6InspectorProbe.Observation> observations)
            {
                SceneId = sceneId;
                SceneDirty = sceneDirty;
                Observations = observations.AsReadOnly();
            }

            internal string SceneId { get; }
            // A dirty snapshot is usable for local diagnostics only, never
            // a claim about what was saved or published by the Owner.
            internal bool SceneDirty { get; }
            internal IReadOnlyList<TeamForgeWp6InspectorProbe.Observation> Observations { get; }
        }

        // Fail closed on an incomplete scan. In particular, do not silently
        // truncate a large Scene or a partially unsupported Collider set.
        internal static bool WithinBudget(int visitedObjects, int colliders, out string error)
        {
            if (visitedObjects < 0 || visitedObjects > MaximumSceneObjects)
            {
                error = "WP6 Scene inventory exceeds its bounded GameObject limit.";
                return false;
            }
            if (colliders < 0 || colliders > MaximumAllowlistedColliders)
            {
                error = "WP6 Scene inventory exceeds its bounded Collider limit.";
                return false;
            }
            error = string.Empty;
            return true;
        }

        internal static bool TryCapture(Scene scene, out Snapshot snapshot, out string error)
        {
            snapshot = null;
            if (!scene.IsValid() || !scene.isLoaded || string.IsNullOrEmpty(scene.path))
            {
                error = "Open a loaded, saved Scene before inspecting WP6 Components.";
                return false;
            }

            var originalPath = scene.path;
            var sceneId = AssetDatabase.AssetPathToGUID(originalPath);
            if (!TeamForgeWp6ComponentIdentity.IsSceneGuid(sceneId))
            {
                error = "Saved Scene GUID is missing or invalid.";
                return false;
            }
            if (!WithinBudget(scene.rootCount, 0, out error))
                return false;

            var originalDirty = scene.isDirty;
            var seen = new HashSet<string>(StringComparer.Ordinal);
            var observations = new List<TeamForgeWp6InspectorProbe.Observation>();
            var pending = new Stack<Transform>();

            try
            {
                foreach (var root in scene.GetRootGameObjects())
                {
                    if (root == null || root.scene != scene)
                    {
                        error = "The Scene hierarchy changed while capturing its Component inventory.";
                        return false;
                    }
                    pending.Push(root.transform);
                }

                var visited = 0;
                while (pending.Count > 0)
                {
                    var transform = pending.Pop();
                    if (transform == null || transform.gameObject.scene != scene ||
                        !WithinBudget(++visited, observations.Count, out error))
                    {
                        error = "The Scene exceeded its object limit or changed during inventory.";
                        return false;
                    }

                    // Enumerate only the explicitly allowed built-in types.
                    // Other Component classes (including MonoBehaviour and
                    // MeshCollider) are not asserted to be synchronized.
                    var boxes = transform.GetComponents<BoxCollider>();
                    var spheres = transform.GetComponents<SphereCollider>();
                    if (boxes.Length > MaximumAllowlistedColliders - observations.Count ||
                        spheres.Length > MaximumAllowlistedColliders - observations.Count - boxes.Length)
                    {
                        error = "WP6 Scene inventory exceeds its bounded Collider limit.";
                        return false;
                    }

                    foreach (var box in boxes)
                    {
                        if (!Append(box, sceneId, seen, observations, out error))
                            return false;
                    }
                    foreach (var sphere in spheres)
                    {
                        if (!Append(sphere, sceneId, seen, observations, out error))
                            return false;
                    }
                    if (transform.childCount > MaximumSceneObjects - visited - pending.Count)
                    {
                        error = "WP6 Scene inventory exceeds its bounded GameObject limit.";
                        return false;
                    }
                    for (var index = transform.childCount - 1; index >= 0; index--)
                        pending.Push(transform.GetChild(index));
                }

                // A valid observed Scene can still contain unsaved changes.
                // Avoid mixed before/after observations if the Editor state
                // changes partway through enumeration.
                if (!scene.IsValid() || !scene.isLoaded ||
                    !string.Equals(scene.path, originalPath, StringComparison.Ordinal) ||
                    scene.isDirty != originalDirty ||
                    !string.Equals(AssetDatabase.AssetPathToGUID(scene.path), sceneId, StringComparison.Ordinal))
                {
                    error = "Scene identity or dirty state changed during WP6 inventory.";
                    return false;
                }

                observations.Sort((left, right) =>
                    string.CompareOrdinal(left.ComponentId, right.ComponentId));
                snapshot = new Snapshot(sceneId, originalDirty, observations);
                error = string.Empty;
                return true;
            }
            catch (Exception)
            {
                // Do not leak local asset paths or return an incomplete result.
                error = "Unity Scene Component inventory could not complete.";
                return false;
            }
        }

        private static bool Append(Component component, string sceneId, HashSet<string> seen,
            List<TeamForgeWp6InspectorProbe.Observation> observations, out string error)
        {
            if (component == null)
            {
                error = "An allowlisted Collider is no longer available.";
                return false;
            }
            if (!TeamForgeWp6InspectorProbe.TryCapture(component, out var observed, out error))
                return false;
            if (!string.Equals(observed.SceneId, sceneId, StringComparison.Ordinal) ||
                !seen.Add(observed.ComponentId))
            {
                error = "Collider identity is duplicated or belongs to another Scene.";
                return false;
            }
            observations.Add(observed);
            error = string.Empty;
            return true;
        }
    }
}

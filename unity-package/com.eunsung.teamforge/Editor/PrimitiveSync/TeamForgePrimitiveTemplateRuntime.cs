using System;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

namespace EunSung.TeamForge
{
    // Fixed engine-owned templates. No wire-provided asset path, material or
    // arbitrary Component type is interpreted by this adapter.
    internal static class TeamForgePrimitiveTemplateRuntime
    {
        internal const string Cube = "cube-v1";
        internal const string Sphere = "sphere-v1";
        internal static bool IsTemplate(string value) => value == Cube || value == Sphere;
        internal static bool IsTemplateOrEmpty(string value) => string.IsNullOrEmpty(value) || IsTemplate(value);

        internal static bool IsSupportedEditor(out string error)
        {
            error = string.Empty;
            if (EditorApplication.isPlayingOrWillChangePlaymode)
            { error = "Shared primitives are available in Edit Mode only."; return false; }
            if (GraphicsSettings.currentRenderPipeline != null)
            { error = "Shared Cube/Sphere templates currently require the built-in render pipeline."; return false; }
            return true;
        }

        internal static bool TryCreate(string template, out GameObject target, out string error)
        {
            target = null;
            if (!IsTemplate(template)) { error = "The shared primitive template is unsupported."; return false; }
            if (!IsSupportedEditor(out error)) return false;
            GameObject created = null;
            try
            {
                created = GameObject.CreatePrimitive(template == Cube ? PrimitiveType.Cube : PrimitiveType.Sphere);
                var generated = created.GetComponents<Collider>();
                var expectedCollider = template == Cube ? typeof(BoxCollider) : typeof(SphereCollider);
                if (generated.Length != 1 || generated[0] == null || generated[0].GetType() != expectedCollider)
                    throw new InvalidOperationException("Unexpected built-in Collider topology.");
                // M2's subsequent authoritative catalog owns the Collider. The
                // engine-generated instance has no approved logical identity.
                UnityEngine.Object.DestroyImmediate(generated[0]);
                if (!ValidateExisting(template, created, out error))
                    throw new InvalidOperationException(error);
                target = created; error = string.Empty; return true;
            }
            catch (Exception)
            {
                if (created != null) UnityEngine.Object.DestroyImmediate(created);
                error = "The built-in primitive could not be materialized safely. No shared visual was fabricated from an asset path.";
                return false;
            }
        }

        // A native Unity GameObject menu creation may use the authenticated M3
        // template only when its exact engine-owned graph is the default one.
        // Never guess from a name, custom mesh, material, or component subtype.
        internal static bool TryIdentifyNativeDefault(GameObject target, out string template)
        {
            template = string.Empty;
            if (target == null || PrefabUtility.IsPartOfAnyPrefab(target) ||
                target.transform.childCount != 0 || !IsSupportedEditor(out _))
                return false;
            var parts = target.GetComponents<Component>();
            if (parts.Length != 4 || parts[0] == null || parts[0].GetType() != typeof(Transform) ||
                parts[1] == null || parts[1].GetType() != typeof(MeshFilter) ||
                parts[2] == null || parts[2].GetType() != typeof(MeshRenderer))
                return false;
            var candidate = parts[3].GetType() == typeof(BoxCollider) ? Cube :
                parts[3].GetType() == typeof(SphereCollider) ? Sphere : string.Empty;
            if (string.IsNullOrEmpty(candidate) ||
                !ValidateExisting(candidate, target, out _) ||
                !DefaultNativeCollider(parts[3], candidate))
                return false;
            var defaultMaterial = Resources.GetBuiltinResource<Material>("Default-Material.mat");
            var renderer = (MeshRenderer)parts[2];
            if (defaultMaterial == null || renderer.sharedMaterials.Length != 1 ||
                renderer.sharedMaterial != defaultMaterial || !renderer.enabled)
                return false;
            template = candidate;
            return true;
        }

        private static bool DefaultNativeCollider(Component component, string template)
        {
            if (!(component is Collider collider) || !collider.enabled || collider.isTrigger ||
                !Mathf.Approximately(collider.contactOffset, 0.01f))
                return false;
            if (template == Cube && component.GetType() == typeof(BoxCollider))
            {
                var box = (BoxCollider)component;
                return box.center == Vector3.zero && box.size == Vector3.one;
            }
            if (template == Sphere && component.GetType() == typeof(SphereCollider))
            {
                var sphere = (SphereCollider)component;
                return sphere.center == Vector3.zero && Mathf.Approximately(sphere.radius, 0.5f);
            }
            return false;
        }

        internal static bool IsDefaultNativeColliderForTemplate(GameObject target, string template, Component candidate) =>
            target != null && candidate != null && candidate.gameObject == target &&
            TryIdentifyNativeDefault(target, out var actual) && actual == template &&
            target.GetComponents<Collider>().Length == 1 &&
            target.GetComponent<Collider>() == candidate;

        internal static bool ValidateExisting(string template, GameObject target, out string error)
        {
            error = string.Empty;
            if (!IsTemplate(template) || target == null || PrefabUtility.IsPartOfAnyPrefab(target))
            { error = "The exact non-Prefab shared primitive target is unavailable."; return false; }
            if (!IsSupportedEditor(out error)) return false;
            try
            {
                var filters = target.GetComponents<MeshFilter>();
                var renderers = target.GetComponents<MeshRenderer>();
                var expected = Resources.GetBuiltinResource<Mesh>(template == Cube ? "Cube.fbx" : "New-Sphere.fbx");
                if (expected == null || filters.Length != 1 || renderers.Length != 1 ||
                    filters[0] == null || renderers[0] == null || filters[0].sharedMesh != expected)
                {
                    error = "The shared primitive's built-in Mesh/Renderer differs locally. Preserve or repair that local work before reconnecting.";
                    return false;
                }
                // A local material override remains local. Replays and recovery
                // never replace it or append another MeshFilter/Renderer.
                return true;
            }
            catch (Exception)
            { error = "Built-in primitive reference verification failed."; return false; }
        }
    }
}

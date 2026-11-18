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

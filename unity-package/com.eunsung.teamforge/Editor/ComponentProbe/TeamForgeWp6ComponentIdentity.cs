using System;
using UnityEditor;
using UnityEngine;

namespace EunSung.TeamForge
{
    // WP6 pre-wire only. A canonical ID is a lookup hint, never permission
    // to modify a Component. Any future authority path must independently
    // validate Session, owner, revision, lock, trust and property allowlist.
    internal static class TeamForgeWp6ComponentIdentity
    {
        private const string NullGuid = "00000000000000000000000000000000";

        internal sealed class Record
        {
            internal Record(string sceneId, string objectId, string componentId, string typeName)
            {
                SceneId = sceneId;
                ObjectId = objectId;
                ComponentId = componentId;
                TypeName = typeName;
            }

            internal string SceneId { get; }
            internal string ObjectId { get; }
            internal string ComponentId { get; }
            internal string TypeName { get; }
        }

        internal static bool TryCapture(Component source, out Record identity, out string error)
        {
            identity = null;
            if (source == null || source.gameObject == null)
            {
                error = "A live Scene Component is required.";
                return false;
            }

            var typeName = GetAllowlistedTypeName(source);
            if (typeName == null)
            {
                error = "Only exact BoxCollider and SphereCollider types are supported.";
                return false;
            }

            var scene = source.gameObject.scene;
            if (!scene.IsValid() || !scene.isLoaded || string.IsNullOrEmpty(scene.path))
            {
                error = "Only Components in a loaded, saved Scene are supported.";
                return false;
            }
            // Prefab source and instance ID semantics need their own lifecycle,
            // override and identity contract before they can be made writable.
            if (PrefabUtility.IsPartOfAnyPrefab(source) || PrefabUtility.IsPartOfAnyPrefab(source.gameObject))
            {
                error = "Prefab Components are outside this saved-Scene preview.";
                return false;
            }

            var sceneId = AssetDatabase.AssetPathToGUID(scene.path);
            if (!IsSceneGuid(sceneId))
            {
                error = "Saved Scene asset GUID is unavailable.";
                return false;
            }

            try
            {
                var gameObjectId = GlobalObjectId.GetGlobalObjectIdSlow(source.gameObject);
                var componentId = GlobalObjectId.GetGlobalObjectIdSlow(source);
                if (!IsSavedSceneId(gameObjectId, sceneId) || !IsSavedSceneId(componentId, sceneId) ||
                    gameObjectId.targetObjectId == componentId.targetObjectId)
                {
                    error = "Component and owner must have distinct saved Scene GlobalObjectIds.";
                    return false;
                }

                identity = new Record(sceneId, gameObjectId.ToString(), componentId.ToString(), typeName);
                error = string.Empty;
                return true;
            }
            catch (Exception)
            {
                // Unity can invalidate objects during Scene/assembly lifetime
                // transitions. Do not leak project-local paths in diagnostics.
                error = "Saved Component identity lookup could not complete.";
                return false;
            }
        }

        // Resolve by the Component's exact Unity GlobalObjectId, NOT by type,
        // Inspector index, object name, or sibling order. Refuse any change
        // in owner, Scene GUID, supported type or canonical representation.
        internal static bool TryResolve(Record expected, out Component component, out string error)
        {
            component = null;
            if (expected == null || !IsSceneGuid(expected.SceneId) ||
                !TryParseSavedId(expected.ObjectId, expected.SceneId, out var ownerId) ||
                !TryParseSavedId(expected.ComponentId, expected.SceneId, out var componentId) ||
                ownerId.targetObjectId == componentId.targetObjectId ||
                !IsAllowlistedTypeName(expected.TypeName))
            {
                error = "Component identity is missing, noncanonical, or unsupported.";
                return false;
            }

            // A valid ID string alone does not establish a live Component.
            // A removed component, unloaded Scene, asset or wrong Unity type
            // must never be guessed back from an Inspector list position.
            try
            {
                var resolved = GlobalObjectId.GlobalObjectIdentifierToObjectSlow(componentId) as Component;
                if (resolved != null && TryCapture(resolved, out var actual, out _) &&
                    string.Equals(actual.SceneId, expected.SceneId, StringComparison.Ordinal) &&
                    string.Equals(actual.ObjectId, expected.ObjectId, StringComparison.Ordinal) &&
                    string.Equals(actual.ComponentId, expected.ComponentId, StringComparison.Ordinal) &&
                    string.Equals(actual.TypeName, expected.TypeName, StringComparison.Ordinal))
                {
                    component = resolved;
                    error = string.Empty;
                    return true;
                }
            }
            catch (Exception)
            {
                // Never return a partially matched identity if Scene loading
                // or a Unity native-object lookup fails unexpectedly.
            }
            error = "Exact live Scene Component no longer matches the captured identity.";
            return false;
        }

        private static string GetAllowlistedTypeName(Component component)
        {
            var type = component.GetType();
            if (type == typeof(BoxCollider)) return "UnityEngine.BoxCollider";
            if (type == typeof(SphereCollider)) return "UnityEngine.SphereCollider";
            return null;
        }

        private static bool IsAllowlistedTypeName(string value)
        {
            return value == "UnityEngine.BoxCollider" || value == "UnityEngine.SphereCollider";
        }

        internal static bool IsSceneGuid(string value)
        {
            if (string.IsNullOrEmpty(value) || value.Length != 32 || value == NullGuid)
                return false;
            foreach (var character in value)
            {
                if (!((character >= '0' && character <= '9') ||
                      (character >= 'a' && character <= 'f')))
                    return false;
            }
            return true;
        }

        private static bool IsSavedSceneId(GlobalObjectId id, string sceneId)
        {
            return id.identifierType == 2 &&
                   id.targetObjectId != 0UL && id.targetPrefabId == 0UL &&
                   string.Equals(id.assetGUID.ToString(), sceneId, StringComparison.Ordinal);
        }

        private static bool TryParseSavedId(string text, string sceneId, out GlobalObjectId id)
        {
            id = default;
            if (string.IsNullOrEmpty(text) || text.Length > 512 ||
                !GlobalObjectId.TryParse(text, out id))
                return false;
            // Unity's parser can accept aliases. Round-trip through its own
            // canonical format before allowing an ID to address live content.
            return string.Equals(id.ToString(), text, StringComparison.Ordinal) &&
                   IsSavedSceneId(id, sceneId);
        }
    }
}

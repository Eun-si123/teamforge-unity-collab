using System;
using UnityEditor;

namespace EunSung.TeamForge
{
    // Wire identity only. A valid row is not permission to instantiate or bind
    // a Component; the live service verifies source, epoch and snapshot first.
    [Serializable]
    internal sealed class TeamForgeColliderComponentCatalogRow
    {
        public string sceneId;
        public string objectId;
        public string componentId;
        public string typeName;
        public long serverRevision;

        internal bool IsValid => TeamForgeWp6ComponentIdentity.IsSceneGuid(sceneId) &&
            IsOwnerId(objectId, sceneId) && IsComponentId(componentId, sceneId) &&
            objectId != componentId && IsTypeName(typeName) &&
            serverRevision >= 0 && serverRevision <= 9007199254740991L;

        internal static bool IsTypeName(string value) =>
            value == "UnityEngine.BoxCollider" || value == "UnityEngine.SphereCollider";

        internal static bool IsLogicalComponentId(string value)
        {
            if (value == null || value.Length != 37 || !value.StartsWith("tf:c:", StringComparison.Ordinal)) return false;
            for (var index = 5; index < value.Length; index++)
                if (!(value[index] >= '0' && value[index] <= '9') &&
                    !(value[index] >= 'a' && value[index] <= 'f')) return false;
            return true;
        }

        internal static bool IsOwnerId(string value, string sceneId) =>
            TeamForgeHierarchyIdentityRegistry.IsLogicalId(value) || IsSavedId(value, sceneId);

        internal static bool IsComponentId(string value, string sceneId) =>
            IsLogicalComponentId(value) || IsSavedId(value, sceneId);

        internal static bool IsSavedId(string value, string sceneId) =>
            value != null && value.Length <= 512 && GlobalObjectId.TryParse(value, out var id) &&
            id.ToString() == value && id.identifierType == 2 &&
            id.assetGUID.ToString() == sceneId && id.targetObjectId != 0 && id.targetPrefabId == 0;

        internal TeamForgeColliderComponentCatalogRow Copy() => new TeamForgeColliderComponentCatalogRow
        {
            sceneId = sceneId, objectId = objectId, componentId = componentId,
            typeName = typeName, serverRevision = serverRevision,
        };
    }
}

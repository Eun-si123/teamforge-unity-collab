using System;
using UnityEditor;
using UnityEngine;

namespace EunSung.TeamForge
{
    public static class TeamForgeObjectIdentity
    {
        private const string NullGlobalObjectId = "GlobalObjectId_V1-0-00000000000000000000000000000000-0-0";

        public static bool TryGetGlobalObjectId(GameObject target, out string objectId)
        {
            objectId = string.Empty;
            if (target == null || !target.scene.IsValid() || !target.scene.isLoaded)
            {
                return false;
            }

            var globalObjectId = GlobalObjectId.GetGlobalObjectIdSlow(target);
            var candidate = globalObjectId.ToString();
            if (globalObjectId.identifierType == 0 || candidate == NullGlobalObjectId)
            {
                return false;
            }

            objectId = candidate;
            return true;
        }

        public static bool TryGetCollaborativeObjectId(GameObject target, out string objectId)
        {
            return TryGetCanonicalObjectId(target, null, out objectId);
        }

        internal static bool TryGetCanonicalObjectId(
            GameObject target,
            Func<string, bool> acceptsLogicalId,
            out string objectId)
        {
            if (TeamForgeHierarchyIdentityRegistry.TryGetSessionLogicalId(target, out var logicalId))
            {
                if (acceptsLogicalId == null || acceptsLogicalId(logicalId))
                {
                    objectId = logicalId;
                    return true;
                }

                // The current authority already chose a logical identity for this live
                // object. Falling back to its saved Global ID would split Hierarchy from
                // Transform/Lock under two exact server keys, so reject instead.
                objectId = string.Empty;
                return false;
            }
            return TryGetGlobalObjectId(target, out objectId);
        }

        public static bool TryResolveGameObject(string objectId, out GameObject gameObject)
        {
            gameObject = null;
            if (TeamForgeHierarchyIdentityRegistry.IsLogicalId(objectId))
            {
                return TeamForgeHierarchyIdentityRegistry.TryResolve(objectId, out gameObject);
            }
            if (string.IsNullOrWhiteSpace(objectId) ||
                !GlobalObjectId.TryParse(objectId, out var globalObjectId) ||
                globalObjectId.identifierType == 0)
            {
                return false;
            }

            var resolved = GlobalObjectId.GlobalObjectIdentifierToObjectSlow(globalObjectId);
            gameObject = resolved as GameObject;
            if (gameObject == null && resolved is Component component)
            {
                gameObject = component.gameObject;
            }

            return gameObject != null && gameObject.scene.IsValid() && gameObject.scene.isLoaded;
        }
    }
}

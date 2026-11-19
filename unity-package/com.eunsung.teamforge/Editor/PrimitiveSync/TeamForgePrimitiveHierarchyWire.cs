using System;
using UnityEngine;

namespace EunSung.TeamForge
{
    // JsonUtility writes empty string fields. Keep legacy commands/seeds at
    // their original shape when the optional primitive contract is unused.
    internal static class TeamForgePrimitiveHierarchyWire
    {
        [Serializable] private sealed class LegacyOperation : ProtocolEnvelope
        {
            public string operationId, userId, kind, sceneId, objectId;
            public long baseRevision;
            public string name, parentObjectId;
            public int siblingIndex;
            public TeamForgeVector3Dto localPosition;
            public TeamForgeQuaternionDto localRotation;
            public TeamForgeVector3Dto localScale;
        }
        [Serializable] private sealed class TemplateFields { public string primitiveTemplate, componentEpoch; }
        [Serializable] private sealed class EpochField { public string componentEpoch; }
        [Serializable] private sealed class LegacyRecord
        {
            public string sceneId, objectId, name, parentObjectId;
            public int siblingIndex;
            public TeamForgeVector3Dto localPosition;
            public TeamForgeQuaternionDto localRotation;
            public TeamForgeVector3Dto localScale;
            public long createdRevision, hierarchyRevision;
        }
        [Serializable] private sealed class LegacySeed : ProtocolEnvelope
        {
            public string userId, sceneId;
            public long baseRevision;
            public LegacyRecord[] objects;
        }

        internal static string SerializeOperation(HierarchyOperationMessage message)
        {
            if (message == null) throw new ArgumentNullException(nameof(message));
            var json = JsonUtility.ToJson(new LegacyOperation
            {
                type = message.type, protocolVersion = message.protocolVersion, requestId = message.requestId,
                operationId = message.operationId, userId = message.userId, kind = message.kind,
                sceneId = message.sceneId, objectId = message.objectId, baseRevision = message.baseRevision,
                name = message.name, parentObjectId = message.parentObjectId, siblingIndex = message.siblingIndex,
                localPosition = message.localPosition, localRotation = message.localRotation, localScale = message.localScale,
            });
            string extra = null;
            if (!string.IsNullOrEmpty(message.primitiveTemplate))
                extra = JsonUtility.ToJson(new TemplateFields { primitiveTemplate = message.primitiveTemplate, componentEpoch = message.componentEpoch });
            else if (!string.IsNullOrEmpty(message.componentEpoch))
                extra = JsonUtility.ToJson(new EpochField { componentEpoch = message.componentEpoch });
            return extra == null ? json : json.Substring(0, json.Length - 1) + "," + extra.Substring(1);
        }

        internal static bool TrySerializeSeed(HierarchySeedMessage message, out string json)
        {
            json = null;
            if (message == null || message.objects == null) return false;
            var rows = new LegacyRecord[message.objects.Length];
            for (var index = 0; index < rows.Length; index++)
            {
                var row = message.objects[index];
                if (row == null || !string.IsNullOrEmpty(row.primitiveTemplate)) return false;
                rows[index] = new LegacyRecord
                {
                    sceneId = row.sceneId, objectId = row.objectId, name = row.name, parentObjectId = row.parentObjectId,
                    siblingIndex = row.siblingIndex, localPosition = row.localPosition,
                    localRotation = row.localRotation, localScale = row.localScale,
                    createdRevision = row.createdRevision, hierarchyRevision = row.hierarchyRevision,
                };
            }
            json = JsonUtility.ToJson(new LegacySeed
            { type = message.type, protocolVersion = message.protocolVersion, requestId = message.requestId,
                userId = message.userId, sceneId = message.sceneId, baseRevision = message.baseRevision, objects = rows });
            return true;
        }
    }
}

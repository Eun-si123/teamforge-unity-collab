using System;

namespace EunSung.TeamForge
{
    [Serializable]
    internal sealed class TeamForgeComponentSource
    {
        public string projectUuid;
        public long baselineRevision;
        public string manifestHash;
        public string descriptorHash;
        public string scenePath;
        public string sceneFileSha256;
        public string sceneMetaSha256;
    }

    // Native values are handled by TeamForgeColliderPropertyWire. These DTOs
    // deliberately contain only metadata, never a loosely typed Unity value.
    [Serializable]
    internal sealed class TeamForgeComponentMessage : ProtocolEnvelope
    {
        public string sceneId;
        public string epoch;
        public long serverRevision;
        public string snapshotHash;
        public TeamForgeComponentSource source;
        public string operationId;
        public string userId;
        public long baseRevision;
        public string error;
        public string reason;
        public string repair;
        public string status;
        public string compensatesOperationId;
    }

    [Serializable]
    internal sealed class TeamForgeComponentJoin : ProtocolEnvelope
    {
        public string sceneId;
        public string scenePath;
        public long baseRevision;
        public string sceneFileSha256;
        public string sceneMetaSha256;
    }

    [Serializable]
    internal sealed class TeamForgeComponentIdentityRow
    {
        public string objectId;
        public string componentId;
        public string typeName;
    }

    [Serializable]
    internal sealed class TeamForgeComponentRequest : ProtocolEnvelope
    {
        public string sceneId;
        public string epoch;
    }

    [Serializable]
    internal sealed class TeamForgeComponentSet : ProtocolEnvelope
    {
        public string operationId;
        public string epoch;
        public string sceneId;
        public long baseRevision;
        public long expectedRevision;
        public string compensatesOperationId;
    }

    [Serializable]
    internal sealed class TeamForgeComponentApplyReport : ProtocolEnvelope
    {
        public string sceneId;
        public string epoch;
        public long serverRevision;
        public string snapshotHash;
        public string status;
    }
}

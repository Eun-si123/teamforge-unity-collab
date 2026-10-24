using System;
using UnityEngine;

namespace EunSung.TeamForge
{
    public static class TeamForgeProtocol
    {
        public const int Version = 1;

        public static string Serialize(object message)
        {
            if (message == null)
            {
                throw new ArgumentNullException(nameof(message));
            }

            return JsonUtility.ToJson(message);
        }

        public static bool TryReadEnvelope(string json, out ProtocolEnvelope envelope, out string error)
        {
            envelope = null;
            error = string.Empty;

            if (string.IsNullOrWhiteSpace(json))
            {
                error = "Message is empty.";
                return false;
            }

            try
            {
                envelope = JsonUtility.FromJson<ProtocolEnvelope>(json);
            }
            catch (Exception exception)
            {
                error = $"Message is not valid JSON: {exception.Message}";
                return false;
            }

            if (envelope == null || string.IsNullOrWhiteSpace(envelope.type))
            {
                error = "Message type is missing.";
                return false;
            }

            if (envelope.protocolVersion != Version)
            {
                error = $"Protocol version mismatch. Expected {Version}, received {envelope.protocolVersion}.";
                return false;
            }

            return true;
        }

        public static T Deserialize<T>(string json) where T : class
        {
            return JsonUtility.FromJson<T>(json);
        }
    }

    [Serializable]
    public class ProtocolEnvelope
    {
        public string type;
        public int protocolVersion;
        public string requestId;
    }

    [Serializable]
    public class HelloMessage : ProtocolEnvelope
    {
        public string userName;
        public string projectId;
        public string sessionId;
        public bool supportsPresence;
        public bool supportsTransformSync;
        public bool supportsHierarchySync;
        public bool supportsProjectTransfer;
        public string userId;
        public string userColor;
    }

    // Only constructed by an explicit Test Lab opt-in. A plain HelloMessage
    // intentionally omits this field to preserve the Protocol v1 wire shape.
    [Serializable]
    public class ComponentRecoveryPreviewHelloMessage : HelloMessage
    {
        public bool supportsComponentRecoveryPreview = true;
    }

    [Serializable]
    public sealed class ComponentDeclarationPreviewHelloMessage : ComponentRecoveryPreviewHelloMessage
    {
        public bool supportsComponentDeclarationPreview = true;
    }

    [Serializable]
    public sealed class HelloAckMessage : ProtocolEnvelope
    {
        public string connectionId;
        public string serverVersion;
        public long serverTimestampUnixMs;
        public bool presenceEnabled;
        public bool transformSyncEnabled;
        public bool hierarchySyncEnabled;
        // Missing on older servers: JsonUtility defaults to false.
        public bool componentRecoveryPreviewEnabled;
        public bool componentDeclarationPreviewEnabled;
        public bool projectTransferEnabled;
        public string userId;
        public string userColor;
    }

    // Read-only WP6 request. Unknown/unsafe property shapes must never be
    // deserialized into Unity objects or applied to a Scene.
    // Only used by the explicit developer opt-in; normal Unity messages keep
    // their original protocol shape. The property value union is constructed
    // using exactly typed JsonUtility rows, never an object-valued field.
    [Serializable]
    public sealed class ComponentDeclarationPreviewSeedEnvelope : ProtocolEnvelope
    {
        public string userId;
        public string sceneId;
        public long baseRevision;
        public string objectId;
        public string componentId;
        public string typeName;
        public bool sceneDirty;
    }

    [Serializable]
    public sealed class ComponentDeclarationBooleanRow
    {
        public string propertyPath;
        public string valueKind = "boolean";
        public bool value;
    }

    [Serializable]
    public sealed class ComponentDeclarationVector3Row
    {
        public string propertyPath;
        public string valueKind = "vector3";
        public TeamForgeVector3Dto value;
    }

    [Serializable]
    public sealed class ComponentDeclarationFloatRow
    {
        public string propertyPath;
        public string valueKind = "float";
        public float value;
    }

    [Serializable]
    public sealed class ComponentDeclarationPreviewAcceptedMessage : ProtocolEnvelope
    {
        public string status;
        public string sceneId;
        public long serverRevision;
        public int recordedComponents;
        public int recordedProperties;
    }

    // Pure read-only server comparison. Contains identity and path differences,
    // but NO source values, authority commands or automatic repair instructions.
    [Serializable]
    public sealed class ComponentRecoveryCompareResultMessage : ProtocolEnvelope
    {
        public string status;
        public string sceneId;
        public string objectId;
        public string componentId;
        public string typeName;
        public long serverRevision;
        public int comparedProperties;
        public string[] differingPaths;
        // Optional diagnostic-only counts of DISTINCT ACTIVE Session User IDs.
        // These never attest Scene bytes or establish an authoritative baseline.
        public string evidenceLevel;
        public int agreeingPeerCount;
        public int divergingPeerCount;
    }

    [Serializable]
    public sealed class ComponentRecoveryPreviewRequestMessage : ProtocolEnvelope
    {
        public string sceneId;
        public long knownRevision;
        public string knownFingerprint;
    }

    [Serializable]
    public sealed class ComponentRecoveryPreviewMetadataMessage : ProtocolEnvelope
    {
        public string status;
        public string sceneId;
        public long serverRevision;
        public string fingerprint;
        // Deliberately NO observedProperties field: this is metadata-only.
    }

    [Serializable]
    public sealed class PingMessage : ProtocolEnvelope
    {
        public long clientTimestampUnixMs;
    }

    [Serializable]
    public sealed class PongMessage : ProtocolEnvelope
    {
        public long clientTimestampUnixMs;
        public long serverTimestampUnixMs;
    }

    [Serializable]
    public sealed class ProtocolErrorMessage : ProtocolEnvelope
    {
        public string code;
        public string message;
    }

    [Serializable]
    public sealed class TeamForgeVector3Dto
    {
        public float x;
        public float y;
        public float z;
    }

    [Serializable]
    public sealed class TeamForgeQuaternionDto
    {
        public float x;
        public float y;
        public float z;
        public float w = 1f;
    }

    [Serializable]
    public sealed class PresenceRecord
    {
        public string userId;
        public string connectionId;
        public string displayName;
        public string color;
        public string sceneId;
        public string sceneName;
        public string selectedObjectId;
        public string selectedObjectName;
        public bool hasSceneView;
        public TeamForgeVector3Dto cameraPosition;
        public TeamForgeQuaternionDto cameraRotation;
        public TeamForgeVector3Dto cameraPivot;
        public float cameraSize;
        public bool cameraOrthographic;
        public string activity;
        public long lastHeartbeatUnixMs;
    }

    [Serializable]
    public sealed class PresenceUpdateMessage : ProtocolEnvelope
    {
        public string userId;
        public string sceneId;
        public string sceneName;
        public string selectedObjectId;
        public string selectedObjectName;
        public bool hasSceneView;
        public TeamForgeVector3Dto cameraPosition;
        public TeamForgeQuaternionDto cameraRotation;
        public TeamForgeVector3Dto cameraPivot;
        public float cameraSize;
        public bool cameraOrthographic;
        public string activity;
    }

    [Serializable]
    public sealed class PresenceSnapshotMessage : ProtocolEnvelope
    {
        public PresenceRecord[] members;
        public long serverTimestampUnixMs;
    }

    [Serializable]
    public sealed class PresenceChangedMessage : ProtocolEnvelope
    {
        public PresenceRecord presence;
    }

    [Serializable]
    public sealed class PresenceLeftMessage : ProtocolEnvelope
    {
        public string userId;
        public string connectionId;
        public long serverTimestampUnixMs;
    }

    [Serializable]
    public sealed class TeamForgeLockRecord
    {
        public string sceneId;
        public string objectId;
        public string ownerUserId;
        public string ownerConnectionId;
        public string ownerDisplayName;
        public string ownerColor;
        public long expiresAtUnixMs;
    }

    [Serializable]
    public sealed class LockRequestMessage : ProtocolEnvelope
    {
        public string userId;
        public string sceneId;
        public string objectId;
    }

    [Serializable]
    public sealed class LockReleaseMessage : ProtocolEnvelope
    {
        public string userId;
        public string sceneId;
        public string objectId;
    }

    [Serializable]
    public sealed class LockStateMessage : ProtocolEnvelope
    {
        public TeamForgeLockRecord lockState;
        public long serverTimestampUnixMs;
    }

    [Serializable]
    public sealed class LockDeniedMessage : ProtocolEnvelope
    {
        public string reason;
        public TeamForgeLockRecord lockState;
        public long serverTimestampUnixMs;
    }

    [Serializable]
    public sealed class LockReleasedMessage : ProtocolEnvelope
    {
        public string sceneId;
        public string objectId;
        public string previousOwnerUserId;
        public string previousOwnerConnectionId;
        public string reason;
        public long serverTimestampUnixMs;
    }

    [Serializable]
    public sealed class TransformUpdateMessage : ProtocolEnvelope
    {
        public string operationId;
        public string userId;
        public string sceneId;
        public string objectId;
        public long baseRevision;
        public TeamForgeVector3Dto localPosition;
        public TeamForgeQuaternionDto localRotation;
        public TeamForgeVector3Dto localScale;
    }

    [Serializable]
    public sealed class TransformAppliedMessage : ProtocolEnvelope
    {
        public string operationId;
        public string userId;
        public string sceneId;
        public string objectId;
        public long baseRevision;
        public long serverRevision;
        public TeamForgeVector3Dto localPosition;
        public TeamForgeQuaternionDto localRotation;
        public TeamForgeVector3Dto localScale;
        public long serverTimestampUnixMs;
    }

    [Serializable]
    public sealed class TransformSnapshotMessage : ProtocolEnvelope
    {
        public long serverRevision;
        public TransformAppliedMessage[] transforms;
        public TeamForgeLockRecord[] locks;
        public long serverTimestampUnixMs;
    }

    [Serializable]
    public sealed class TeamForgeHierarchyObjectRecord
    {
        public string sceneId;
        public string objectId;
        public string name;
        public string parentObjectId;
        public int siblingIndex;
        public TeamForgeVector3Dto localPosition;
        public TeamForgeQuaternionDto localRotation;
        public TeamForgeVector3Dto localScale;
        public long createdRevision;
        public long hierarchyRevision;
    }

    [Serializable]
    public sealed class TeamForgeHierarchyTombstoneRecord
    {
        public string sceneId;
        public string objectId;
        public long deletedRevision;
        public string deletedByUserId;
        public long serverTimestampUnixMs;
    }

    [Serializable]
    public sealed class HierarchySnapshotMessage : ProtocolEnvelope
    {
        public long serverRevision;
        public string[] sceneIds;
        public TeamForgeHierarchyObjectRecord[] objects;
        public TeamForgeHierarchyTombstoneRecord[] tombstones;
        public long serverTimestampUnixMs;
    }

    [Serializable]
    public sealed class HierarchySeedMessage : ProtocolEnvelope
    {
        public string userId;
        public string sceneId;
        public long baseRevision;
        public TeamForgeHierarchyObjectRecord[] objects;
    }

    [Serializable]
    public sealed class HierarchySeedAcceptedMessage : ProtocolEnvelope
    {
        public string sceneId;
        public long serverRevision;
        public bool idempotent;
        public long serverTimestampUnixMs;
    }

    [Serializable]
    public sealed class HierarchyOperationMessage : ProtocolEnvelope
    {
        public string operationId;
        public string userId;
        public string kind;
        public string sceneId;
        public string objectId;
        public long baseRevision;
        public string name;
        public string parentObjectId;
        public int siblingIndex;
        public TeamForgeVector3Dto localPosition;
        public TeamForgeQuaternionDto localRotation;
        public TeamForgeVector3Dto localScale;
    }

    [Serializable]
    public sealed class HierarchyAppliedMessage : ProtocolEnvelope
    {
        public string operationId;
        public string userId;
        public string kind;
        public string sceneId;
        public string objectId;
        public long baseRevision;
        public long serverRevision;
        public TeamForgeHierarchyObjectRecord[] changedObjects;
        public string[] deletedObjectIds;
        public long serverTimestampUnixMs;
    }

    [Serializable]
    public sealed class HierarchyConflictMessage : ProtocolEnvelope
    {
        public string operationId;
        public string sceneId;
        public string objectId;
        public string reason;
        public string detail;
        public long serverRevision;
        public TeamForgeHierarchyObjectRecord authoritativeObject;
        public long serverTimestampUnixMs;
    }

    // Project Coordinator messages contain discovery and trust metadata only.
    // Manifest bodies, file paths, chunks, archives, private keys, and local paths
    // deliberately have no representation in the realtime protocol DTOs.
    [Serializable]
    public sealed class ProjectBaselineRecord
    {
        public string projectUuid;
        public long baselineRevision;
        public string manifestHash;
        public string descriptorHash;
        public string unityVersion;
        public string teamForgePackageVersion;
        public int realtimeProtocolVersion;
        public int transferProtocolVersion;
        public int manifestSchemaVersion;
        public string ownerKeyId;
        public string ownerPublicKey;
        public string publisherKeyId;
        public string publisherPublicKey;
        public string publisherAuthorization;
        public string baselineSignature;
        public string publishedByUserId;
        public string publishedByConnectionId;
        public long publishedAtUnixMs;
    }

    [Serializable]
    public sealed class ProjectPeerRecord
    {
        public string userId;
        public string connectionId;
        public string userName;
        public string projectUuid;
        public long baselineRevision;
        public string manifestHash;
        public string descriptorHash;
        public bool completeBaseline;
        public long availableChunkCount;
        public long totalChunkCount;
        public string endpoint;
        public string transferToken;
        public string unityVersion;
        public string teamForgePackageVersion;
        public int realtimeProtocolVersion;
        public int transferProtocolVersion;
        public int manifestSchemaVersion;
        public string ownerKeyId;
        public string ownerPublicKey;
        public string publisherKeyId;
        public string publisherPublicKey;
        public string publisherAuthorization;
        public string baselineSignature;
        public string ownerProofSignature;
        public bool ownerProofVerified;
        public bool descriptorVerified;
        public int seedRank;
        public long observedLatencyMilliseconds;
        public long announcedAtUnixMs;
        public long lastUpdatedUnixMs;
        public string leaveReason;
    }

    [Serializable]
    public sealed class ProjectPeerAnnounceMessage : ProtocolEnvelope
    {
        public string userId;
        public string projectUuid;
        public long baselineRevision;
        public string manifestHash;
        public string descriptorHash;
        public bool completeBaseline;
        public long availableChunkCount;
        public long totalChunkCount;
        public string endpoint;
        public string transferToken;
        public string unityVersion;
        public string teamForgePackageVersion;
        public int realtimeProtocolVersion;
        public int transferProtocolVersion;
        public int manifestSchemaVersion;
        public string ownerKeyId;
        public string ownerPublicKey;
        public string publisherKeyId;
        public string publisherPublicKey;
        public string publisherAuthorization;
        public string baselineSignature;
        public string ownerProofSignature;
    }

    [Serializable]
    public sealed class ProjectBaselinePublishMessage : ProtocolEnvelope
    {
        public string userId;
        public string projectUuid;
        public long baselineRevision;
        public string manifestHash;
        public string descriptorHash;
        public string unityVersion;
        public string teamForgePackageVersion;
        public int realtimeProtocolVersion;
        public int transferProtocolVersion;
        public int manifestSchemaVersion;
        public string ownerKeyId;
        public string ownerPublicKey;
        public string publisherKeyId;
        public string publisherPublicKey;
        public string publisherAuthorization;
        public string baselineSignature;
    }

    [Serializable]
    public sealed class ProjectRegistrySnapshotMessage : ProtocolEnvelope
    {
        public string projectId;
        public string projectUuid;
        public ProjectBaselineRecord baseline;
        public ProjectPeerRecord[] peers;
        public long serverTimestampUnixMs;
    }

    [Serializable]
    public sealed class ProjectPeerChangedMessage : ProtocolEnvelope
    {
        public ProjectPeerRecord peer;
        public long serverTimestampUnixMs;
    }

    [Serializable]
    public sealed class ProjectPeerLeftMessage : ProtocolEnvelope
    {
        public ProjectPeerRecord peer;
        public long serverTimestampUnixMs;
    }

    [Serializable]
    public sealed class ProjectBaselineChangedMessage : ProtocolEnvelope
    {
        public ProjectBaselineRecord baseline;
        public bool idempotent;
        public long serverTimestampUnixMs;
    }

    [Serializable]
    public sealed class ProjectSyncRequiredMessage : ProtocolEnvelope
    {
        public ProjectBaselineRecord baseline;
        public string reason;
        public long serverTimestampUnixMs;
    }
}

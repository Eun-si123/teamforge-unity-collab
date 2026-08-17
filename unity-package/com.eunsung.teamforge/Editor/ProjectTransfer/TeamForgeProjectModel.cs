using System;

namespace EunSung.TeamForge
{
    public static class TeamForgeProjectContract
    {
        public const string ProductVersion = "0.5.1";
        public const int DescriptorSchemaVersion = 1;
        public const int TransferProtocolVersion = 1;
        public const int ManifestSchemaVersion = 1;
        public const string DescriptorRelativePath = "ProjectSettings/TeamForgeProject.json";
        public const string ManagedProjectsRelativePath = "TeamForgeProjects";
    }

    public enum TeamForgeProjectBootstrapState
    {
        Offline = 0,
        CapabilityUnavailable = 1,
        DescriptorMissing = 2,
        DescriptorInvalid = 3,
        WaitingForRegistry = 4,
        BaselineUnavailable = 5,
        Ready = 6,
        SyncRequired = 7,
        ProjectUuidMismatch = 8,
        InvitationMismatch = 9,
        BaselineAvailableNoSeed = 10,
    }

    public static class TeamForgeProjectBootstrapPolicy
    {
        public static TeamForgeProjectBootstrapState ResolveAvailability(
            bool hasVerifiedBaseline,
            bool hasDirectSeed)
        {
            if (!hasVerifiedBaseline)
            {
                return TeamForgeProjectBootstrapState.BaselineUnavailable;
            }

            return hasDirectSeed
                ? TeamForgeProjectBootstrapState.Ready
                : TeamForgeProjectBootstrapState.BaselineAvailableNoSeed;
        }
    }

    [Serializable]
    public sealed class TeamForgeProjectDescriptor
    {
        public int schemaVersion = TeamForgeProjectContract.DescriptorSchemaVersion;
        public string projectUuid;
        public long baselineRevision;
        public string manifestHash;
        public string descriptorHash;
        public string unityVersion;
        public string teamForgePackageVersion = TeamForgeProjectContract.ProductVersion;
        public int realtimeProtocolVersion = TeamForgeProtocol.Version;
        public int transferProtocolVersion = TeamForgeProjectContract.TransferProtocolVersion;
        public int manifestSchemaVersion = TeamForgeProjectContract.ManifestSchemaVersion;
    }

    // This export is intentionally secret-free and path-portable. The standalone
    // project-peer process receives credentials through its own environment or
    // command-line configuration and performs all direct file transfer.
    [Serializable]
    public sealed class TeamForgeProjectPeerLaunchSettings
    {
        public int schemaVersion = 1;
        public string serverAddress;
        public string coordinatorListenHost = TeamForgeHostEndpointPolicy.DefaultLanListenHost;
        public string realtimePath;
        public string projectId;
        public string sessionId;
        public string projectUuid;
        public string sourceProjectRelativePath = ".";
        public string projectDescriptorRelativePath = TeamForgeProjectContract.DescriptorRelativePath;
        public string managedProjectsRelativePath = TeamForgeProjectContract.ManagedProjectsRelativePath;
        public int realtimeProtocolVersion = TeamForgeProtocol.Version;
        public int transferProtocolVersion = TeamForgeProjectContract.TransferProtocolVersion;
        public int manifestSchemaVersion = TeamForgeProjectContract.ManifestSchemaVersion;
        public string authenticationTokenEnvironmentVariable = "TEAMFORGE_AUTH_TOKEN";
        public string ownerKeyEnvironmentVariable = "TEAMFORGE_OWNER_PRIVATE_KEY";
        public bool allowCurrentProjectAsSeedSource;
    }

    [Serializable]
    public sealed class TeamForgeProjectInvitation
    {
        public string format = "teamforge-project-invite-v1";
        public string serverAddress;
        public string realtimePath;
        public string projectId;
        public string projectUuid;
        public string sessionId;
        public string ownerKeyId;
        public string ownerPublicKey;
        public string ownerSignature;
    }

    public static class TeamForgeProjectInvitationPolicy
    {
        public static bool CanApplyConnectionState(
            bool connectionDesired,
            TeamForgeConnectionState state)
        {
            return !connectionDesired &&
                   (state == TeamForgeConnectionState.Disconnected ||
                    state == TeamForgeConnectionState.Faulted);
        }

        public static void ApplyConnectionFields(
            TeamForgeProjectInvitation invitation,
            TeamForgeConnectionSettings settings)
        {
            if (invitation == null)
            {
                throw new ArgumentNullException(nameof(invitation));
            }
            if (settings == null)
            {
                throw new ArgumentNullException(nameof(settings));
            }

            settings.ServerAddress = invitation.serverAddress.Trim();
            settings.RealtimePath = invitation.realtimePath.Trim();
            settings.ProjectId = invitation.projectId.Trim();
            settings.SessionId = invitation.sessionId.Trim();

            // A token scoped to the previous server must never follow an unverified
            // invite to a new endpoint. The user must explicitly enter a new token.
            settings.AuthenticationToken = string.Empty;
            settings.ResumeAfterAssemblyReload = false;
        }
    }
}

namespace EunSung.TeamForge
{
    internal sealed class ConnectionPolicy
    {
        internal ConnectionPolicy(TeamForgeConnectionSettings settings)
        {
            ServerAddress = settings.ServerAddress;
            RealtimePath = settings.RealtimePath;
            ConnectionTimeoutSeconds = settings.ConnectionTimeoutSeconds;
            AutoReconnect = settings.AutoReconnect;
            MaximumReconnectDelaySeconds = settings.MaximumReconnectDelaySeconds;
            KeepAliveSeconds = 20;
            PresenceUpdatesPerSecond = settings.PresenceUpdatesPerSecond;
            PresenceHeartbeatSeconds = settings.PresenceHeartbeatSeconds;
            TransformUpdatesPerSecond = settings.TransformUpdatesPerSecond;
            LockRenewalSeconds = settings.LockRenewalSeconds;
        }

        internal string ServerAddress { get; }
        internal string RealtimePath { get; }
        internal int ConnectionTimeoutSeconds { get; }
        internal bool AutoReconnect { get; }
        internal int MaximumReconnectDelaySeconds { get; }
        internal int KeepAliveSeconds { get; }
        internal int PresenceUpdatesPerSecond { get; }
        internal int PresenceHeartbeatSeconds { get; }
        internal int TransformUpdatesPerSecond { get; }
        internal int LockRenewalSeconds { get; }
    }

    internal sealed class TransferPolicy
    {
        internal int MaximumConcurrency => 4;
        internal int RetryRounds => 3;
        internal int RetryBaseMilliseconds => 100;
        internal int RetryMaximumMilliseconds => 5000;
        internal int RateLimitPerSecond => 120;
    }

    internal sealed class TrustRequirements
    {
        // Names describe mandatory Phase 4 behavior; none is an enable/disable option.
        internal string OwnerTrustMode => "signed-invite-owner-pin";
        internal string PublisherApprovalMode => "explicit-fingerprint-approval";
        internal string ActivationMode => "verified-staging-then-atomic-activation";
    }

    internal sealed class TeamForgeProfile
    {
        private TeamForgeProfile(ConnectionPolicy connectionPolicy)
        {
            Name = "LegacyPhase4Compatible";
            Connection = connectionPolicy;
            Transfer = new TransferPolicy();
            Trust = new TrustRequirements();
        }

        internal string Name { get; }
        internal ConnectionPolicy Connection { get; }
        internal TransferPolicy Transfer { get; }
        internal TrustRequirements Trust { get; }

        internal static TeamForgeProfile ResolveLegacy(TeamForgeConnectionSettings settings)
        {
            settings.EnsureDefaults();
            return new TeamForgeProfile(new ConnectionPolicy(settings));
        }
    }
}

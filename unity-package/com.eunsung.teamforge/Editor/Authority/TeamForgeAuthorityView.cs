using System;
using UnityEditor;

namespace EunSung.TeamForge
{
    /// <summary>
    /// Read-only collaboration authority observed by Unity-side services.
    /// The server remains authoritative; this view only mirrors the current
    /// connection epoch's revision, locks, identity, and negotiated capabilities.
    /// </summary>
    internal interface IAuthorityView
    {
        long SessionRevision { get; }
        TeamForgeLockRegistry Locks { get; }
        bool IsConnected { get; }
        string ConnectionId { get; }
        bool PresenceAvailable { get; }
        bool TransformSyncAvailable { get; }
        bool HierarchySyncAvailable { get; }
        bool ProjectTransferAvailable { get; }
    }

    /// <summary>
    /// Shared transient observation point for Unity collaboration services.
    /// It deliberately does not persist authority or make server-side state
    /// transitions; connection replacement resets session-scoped observations.
    /// </summary>
    [InitializeOnLoad]
    internal static class TeamForgeAuthorityView
    {
        private sealed class AuthorityState : IAuthorityView
        {
            public long SessionRevision { get; set; }
            public TeamForgeLockRegistry Locks { get; } = new TeamForgeLockRegistry();
            public bool IsConnected { get; set; }
            public string ConnectionId { get; set; } = string.Empty;
            public bool PresenceAvailable { get; set; }
            public bool TransformSyncAvailable { get; set; }
            public bool HierarchySyncAvailable { get; set; }
            public bool ProjectTransferAvailable { get; set; }
        }

        private static readonly AuthorityState State = new AuthorityState();

        static TeamForgeAuthorityView()
        {
            State.Locks.Changed += RaiseChanged;
            TeamForgeConnectionService.Changed += OnConnectionChanged;
            ObserveConnection();
        }

        internal static event Action Changed;

        internal static IAuthorityView Current => State;

        internal static void ObserveRevision(long revision)
        {
            if (revision < 0 || revision <= State.SessionRevision)
            {
                return;
            }

            State.SessionRevision = revision;
            RaiseChanged();
        }

        internal static bool ReplaceLocks(
            System.Collections.Generic.IEnumerable<TeamForgeLockRecord> locks,
            out string error)
        {
            return State.Locks.ReplaceAll(locks, out error);
        }

        internal static bool UpsertLock(TeamForgeLockRecord lockState, out string error)
        {
            return State.Locks.Upsert(lockState, out error);
        }

        internal static bool RemoveLock(string sceneId, string objectId)
        {
            return State.Locks.Remove(sceneId, objectId);
        }

        internal static void ResetSession()
        {
            State.SessionRevision = 0;
            State.Locks.Clear();
            RaiseChanged();
        }

        private static void OnConnectionChanged()
        {
            ObserveConnection();
        }

        private static void ObserveConnection()
        {
            var connected = TeamForgeConnectionService.State == TeamForgeConnectionState.Connected;
            var connectionId = connected
                ? TeamForgeConnectionService.ConnectionId ?? string.Empty
                : string.Empty;
            var identityChanged =
                State.IsConnected != connected ||
                !string.Equals(State.ConnectionId, connectionId, StringComparison.Ordinal);

            State.IsConnected = connected;
            State.ConnectionId = connectionId;
            State.PresenceAvailable = connected && TeamForgeConnectionService.PresenceAvailable;
            State.TransformSyncAvailable = connected && TeamForgeConnectionService.TransformSyncAvailable;
            State.HierarchySyncAvailable = connected && TeamForgeConnectionService.HierarchySyncAvailable;
            State.ProjectTransferAvailable = connected && TeamForgeConnectionService.ProjectTransferAvailable;

            // Locks and revision are valid only for the connection identity that
            // produced them. Never carry those observations into a replacement epoch.
            if (identityChanged)
            {
                State.SessionRevision = 0;
                State.Locks.Clear();
            }
            RaiseChanged();
        }

        private static void RaiseChanged()
        {
            Changed?.Invoke();
        }
    }
}

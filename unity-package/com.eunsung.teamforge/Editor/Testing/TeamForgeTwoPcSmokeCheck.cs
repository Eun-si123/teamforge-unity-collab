using System;
using UnityEngine;

namespace EunSung.TeamForge
{
    // Non-destructive, in-Editor checks. These do NOT assert physical machine identity,
    // actual Transform/Lock mutations, signed Launcher handoff, or file transfer.
    public sealed class TeamForgeTwoPcSmokeResult
    {
        public bool Passed;
        public string Code;
        public string Detail;
        public int RemoteMembers;
        public double? RoundTripMilliseconds;
    }

    public static class TeamForgeTwoPcSmokeCheck
    {
        public static TeamForgeTwoPcSmokeResult Capture()
        {
            var state = TeamForgeConnectionService.State;
            var peers = TeamForgePresenceService.RemoteMembers();
            var settings = TeamForgeConnectionService.Settings;
            return Evaluate(
                state == TeamForgeConnectionState.Connected,
                TeamForgeConnectionService.PresenceAvailable,
                TeamForgeConnectionService.TransformSyncAvailable,
                TeamForgeConnectionService.HierarchySyncAvailable,
                TeamForgeHierarchySyncService.SnapshotReady,
                TeamForgeConnectionService.LastRoundTripMilliseconds,
                peers.Count,
                !string.IsNullOrWhiteSpace(TeamForgeConnectionService.ConnectionId) &&
                !string.IsNullOrWhiteSpace(settings.ProjectId) &&
                !string.IsNullOrWhiteSpace(settings.SessionId));
        }

        public static TeamForgeTwoPcSmokeResult Evaluate(
            bool connected,
            bool presence,
            bool transform,
            bool hierarchy,
            bool hierarchySnapshot,
            double? roundTripMilliseconds,
            int remoteMembers,
            bool identityPresent)
        {
            var result = new TeamForgeTwoPcSmokeResult
            {
                Passed = false,
                Code = "not_connected",
                Detail = "Connect both Unity Editors to the same verified TeamForge session first.",
                RemoteMembers = Math.Max(0, remoteMembers),
                RoundTripMilliseconds = roundTripMilliseconds,
            };
            if (!connected) return result;
            if (!identityPresent)
            {
                result.Code = "connection_identity_missing";
                result.Detail = "Connection/session identity is incomplete.";
                return result;
            }
            if (!presence || !transform || !hierarchy)
            {
                result.Code = "collaboration_capability_missing";
                result.Detail = "Server handshake did not negotiate all collaboration features.";
                return result;
            }
            if (!hierarchySnapshot)
            {
                result.Code = "hierarchy_snapshot_missing";
                result.Detail = "The authoritative Hierarchy snapshot has not arrived.";
                return result;
            }
            if (!roundTripMilliseconds.HasValue ||
                double.IsNaN(roundTripMilliseconds.Value) ||
                double.IsInfinity(roundTripMilliseconds.Value) ||
                roundTripMilliseconds.Value < 0)
            {
                result.Code = "roundtrip_missing";
                result.Detail = "Waiting for an actual server Ping/Pong round trip.";
                return result;
            }
            if (remoteMembers < 1)
            {
                result.Code = "remote_peer_missing";
                result.Detail = "Waiting for a different TeamForge user to appear in Presence.";
                return result;
            }

            result.Passed = true;
            result.Code = "smoke_passed";
            result.Detail = "Connection, negotiated capabilities, server Ping/Pong, Hierarchy snapshot and remote Presence verified. This is NOT full two-PC Transform/Lock or Launcher E2E proof.";
            return result;
        }
    }
}

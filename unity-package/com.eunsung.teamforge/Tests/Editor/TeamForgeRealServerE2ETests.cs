using System;
using System.Collections;
using NUnit.Framework;
using UnityEditor;
using UnityEngine.TestTools;

namespace EunSung.TeamForge.Tests
{
    public sealed class TeamForgeRealServerE2ETests
    {
        private const string PeerUserId = "ci-peer-b";

        [UnityTest]
        public IEnumerator RealServer_ConnectsPingsAndReceivesRemotePresence()
        {
            if (!IsRealServerE2EEnabled())
            {
                Assert.Ignore("Real-server E2E is enabled only by the GitHub Actions Unity workflow.");
            }

            TeamForgeConnectionService.Disconnect();
            TeamForgePresenceService.Registry.Clear();

            var settings = TeamForgeConnectionService.Settings;
            settings.ServerAddress = "http://127.0.0.1:5080";
            settings.RealtimePath = "ws";
            settings.UserName = "CI Unity A";
            settings.UserId = "ci-unity-a";
            settings.UserColorHtml = "#E57373";
            settings.ProjectId = "ci-e2e-project";
            settings.SessionId = "ci-e2e-session";
            settings.AuthenticationToken = string.Empty;
            settings.ConnectionTimeoutSeconds = 10;
            settings.AutoReconnect = false;
            settings.LogLevel = TeamForgeLogLevel.Info;
            settings.SaveSettings();

            TeamForgeConnectionService.Connect();

            var deadline = EditorApplication.timeSinceStartup + 20.0;
            while (TeamForgeConnectionService.State != TeamForgeConnectionState.Connected &&
                   EditorApplication.timeSinceStartup < deadline)
            {
                yield return null;
            }

            Assert.That(
                TeamForgeConnectionService.State,
                Is.EqualTo(TeamForgeConnectionState.Connected),
                $"Unity did not connect to the real TeamForge server. LastError: {TeamForgeConnectionService.LastError}");
            Assert.That(TeamForgeConnectionService.ConnectionId, Is.Not.Empty);
            Assert.That(TeamForgeConnectionService.ServerVersion, Is.Not.Empty);
            Assert.That(TeamForgeConnectionService.PresenceAvailable, Is.True);
            Assert.That(TeamForgeConnectionService.TransformSyncAvailable, Is.True);
            Assert.That(TeamForgeConnectionService.HierarchySyncAvailable, Is.True);
            Assert.That(TeamForgeConnectionService.ProjectTransferAvailable, Is.True);

            deadline = EditorApplication.timeSinceStartup + 10.0;
            while (!TeamForgeConnectionService.LastRoundTripMilliseconds.HasValue &&
                   EditorApplication.timeSinceStartup < deadline)
            {
                yield return null;
            }

            Assert.That(
                TeamForgeConnectionService.LastRoundTripMilliseconds.HasValue,
                Is.True,
                "Unity connected but the real server did not complete Ping/Pong.");
            Assert.That(TeamForgeConnectionService.MessagesSent, Is.GreaterThan(0));
            Assert.That(TeamForgeConnectionService.MessagesReceived, Is.GreaterThan(0));

            PresenceRecord peer = null;
            deadline = EditorApplication.timeSinceStartup + 10.0;
            while (peer == null && EditorApplication.timeSinceStartup < deadline)
            {
                TeamForgePresenceService.Registry.TryGet(PeerUserId, out peer);
                if (peer == null)
                {
                    yield return null;
                }
            }

            Assert.That(peer, Is.Not.Null, "Unity did not receive CI Peer B through the real server Presence snapshot/update path.");
            Assert.That(peer.displayName, Is.EqualTo("CI Peer B"));
            Assert.That(peer.sceneName, Is.EqualTo("CI Scene"));
            Assert.That(peer.activity, Is.EqualTo("CI Ready"));
            Assert.That(TeamForgePresenceService.RemoteMembers().Count, Is.GreaterThanOrEqualTo(1));

            TeamForgeConnectionService.Disconnect();
            deadline = EditorApplication.timeSinceStartup + 10.0;
            while (TeamForgeConnectionService.State != TeamForgeConnectionState.Disconnected &&
                   EditorApplication.timeSinceStartup < deadline)
            {
                yield return null;
            }

            Assert.That(
                TeamForgeConnectionService.State,
                Is.EqualTo(TeamForgeConnectionState.Disconnected),
                "Unity did not cleanly disconnect after the real-server E2E test.");
        }

        private static bool IsRealServerE2EEnabled()
        {
            foreach (var argument in Environment.GetCommandLineArgs())
            {
                if (string.Equals(argument, "-teamforgeCiE2E", StringComparison.OrdinalIgnoreCase))
                {
                    return true;
                }
            }
            return false;
        }
    }
}

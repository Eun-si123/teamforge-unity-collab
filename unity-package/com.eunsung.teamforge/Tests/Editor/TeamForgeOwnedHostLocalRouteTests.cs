using System;
using System.Reflection;
using NUnit.Framework;

namespace EunSung.TeamForge.Tests
{
    public sealed class TeamForgeOwnedHostLocalRouteTests
    {
        private static bool TryReadAttempts(out RealtimeConnectionAttempt[] attempts, out string error)
        {
            var method = typeof(TeamForgeConnectionService).GetMethod(
                "TryValidateSettings", BindingFlags.Static | BindingFlags.NonPublic);
            Assert.That(method, Is.Not.Null);
            var arguments = new object[] { null, null };
            var accepted = (bool)method.Invoke(null, arguments);
            attempts = arguments[0] as RealtimeConnectionAttempt[];
            error = arguments[1] as string ?? string.Empty;
            return accepted;
        }

        [TestCase("http://192.0.2.77:5080", "0.0.0.0", "http://127.0.0.1:5080")]
        [TestCase("http://[2001:db8::2]:5080", "::", "http://[::1]:5080")]
        [TestCase("http://192.0.2.77:5080", "192.168.10.25", "http://192.168.10.25:5080")]
        [TestCase("http://localhost:5080", "localhost", "http://localhost:5080")]
        public void HostLocalRouteUsesBoundListenerWithoutReplacingPublishedGuestAddress(
            string advertised, string listener, string expected)
        {
            Assert.That(TeamForgeHostEndpointPolicy.TryBuildOwnedHostControlAddress(
                advertised, listener, out var local, out var error), Is.True, error);
            Assert.That(local, Is.EqualTo(expected));
            Assert.That(advertised, Does.Not.Contain("127.0.0.1"));
        }

        [TestCase("http://192.168.219.:5080", "0.0.0.0")]
        [TestCase("http://192.0.2.77:5080", "192.168.219.")]
        [TestCase("http://192.0.2.77:5080", "192.168..2")]
        public void HostLocalRouteRejectsMalformedPublicOrListenerAddresses(
            string advertised, string listener)
        {
            Assert.That(TeamForgeHostEndpointPolicy.TryBuildOwnedHostControlAddress(
                advertised, listener, out var local, out var error), Is.False);
            Assert.That(local, Is.Empty);
            Assert.That(error, Is.Not.Empty);
        }

        [Test]
        public void HostLocalRouteDoesNotPersistAndRefusesReuseAcrossDifferentProjects()
        {
            if (TeamForgeConnectionService.State != TeamForgeConnectionState.Disconnected ||
                TeamForgeConnectionService.ConnectionDesired)
            {
                Assert.Ignore("A local-only routing regression must not interrupt a live Editor connection.");
            }

            var settings = TeamForgeConnectionService.Settings;
            settings.EnsureDefaults();
            var previousServer = settings.ServerAddress;
            var previousListen = settings.CoordinatorListenHost;
            var previousProject = settings.ProjectId;
            var previousSession = settings.SessionId;
            var previousRealtime = settings.RealtimePath;
            var previousToken = settings.AuthenticationToken;
            try
            {
                settings.ServerAddress = "http://192.0.2.77:5080";
                settings.CoordinatorListenHost = "0.0.0.0";
                settings.ProjectId = "host-route-regression";
                settings.SessionId = "session-for-route-regression";
                settings.RealtimePath = "ws";
                settings.AuthenticationToken = "disposable-synthetic-Host-authentication";
                Assert.That(TeamForgeConnectionService.TryUseOwnedHostControlAddress(
                    settings.ServerAddress, settings.CoordinatorListenHost, out var setupError),
                    Is.True, setupError);

                Assert.That(TryReadAttempts(out var attempts, out var error), Is.True, error);
                Assert.That(attempts, Has.Length.EqualTo(1));
                Assert.That(attempts[0].Endpoint.ToString(), Is.EqualTo("ws://127.0.0.1:5080/ws"));
                Assert.That(attempts[0].BearerToken, Is.EqualTo(settings.AuthenticationToken));
                Assert.That(settings.ServerAddress, Is.EqualTo("http://192.0.2.77:5080"),
                    "The published Guest address must not be changed or saved as loopback.");

                settings.ProjectId = "another-project";
                Assert.That(TryReadAttempts(out _, out error), Is.False);
                Assert.That(error, Does.Contain("identity changed"));
                settings.ProjectId = "host-route-regression";
                Assert.That(TryReadAttempts(out attempts, out error), Is.True, error);
                Assert.That(attempts[0].Endpoint.Host, Is.EqualTo("192.0.2.77"),
                    "A stale Host-only route must not be silently reused after a Project switch.");

                Assert.That(TeamForgeConnectionService.TryUseOwnedHostControlAddress(
                    "http://192.0.2.88:5080", settings.CoordinatorListenHost, out error),
                    Is.False, "A forged different advertised address must not activate an internal route.");
            }
            finally
            {
                TeamForgeConnectionService.ClearOwnedHostControlAddress();
                settings.ServerAddress = previousServer;
                settings.CoordinatorListenHost = previousListen;
                settings.ProjectId = previousProject;
                settings.SessionId = previousSession;
                settings.RealtimePath = previousRealtime;
                settings.AuthenticationToken = previousToken;
            }
        }
    }
}

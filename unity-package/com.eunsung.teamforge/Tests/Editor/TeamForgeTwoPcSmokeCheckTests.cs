using NUnit.Framework;

namespace EunSung.TeamForge.Tests
{
    public sealed class TeamForgeTwoPcSmokeCheckTests
    {
        [Test]
        public void RequiresConnectionAndIdentities()
        {
            var disconnected = TeamForgeTwoPcSmokeCheck.Evaluate(
                false, true, true, true, true, 4.0, 1, true);
            Assert.That(disconnected.Passed, Is.False);
            Assert.That(disconnected.Code, Is.EqualTo("not_connected"));

            var unnamed = TeamForgeTwoPcSmokeCheck.Evaluate(
                true, true, true, true, true, 4.0, 1, false);
            Assert.That(unnamed.Code, Is.EqualTo("connection_identity_missing"));
        }

        [Test]
        public void RequiresNegotiatedFeaturesSnapshotAndActualRoundTrip()
        {
            var noFeatures = TeamForgeTwoPcSmokeCheck.Evaluate(
                true, true, false, true, true, 4.0, 1, true);
            Assert.That(noFeatures.Code, Is.EqualTo("collaboration_capability_missing"));
            var noSnapshot = TeamForgeTwoPcSmokeCheck.Evaluate(
                true, true, true, true, false, 4.0, 1, true);
            Assert.That(noSnapshot.Code, Is.EqualTo("hierarchy_snapshot_missing"));
            var noPong = TeamForgeTwoPcSmokeCheck.Evaluate(
                true, true, true, true, true, null, 1, true);
            Assert.That(noPong.Code, Is.EqualTo("roundtrip_missing"));
            var invalidPong = TeamForgeTwoPcSmokeCheck.Evaluate(
                true, true, true, true, true, double.NaN, 1, true);
            Assert.That(invalidPong.Code, Is.EqualTo("roundtrip_missing"));
        }

        [Test]
        public void RequiresObservedRemotePeerButNeverClaimsFullField()
        {
            var missing = TeamForgeTwoPcSmokeCheck.Evaluate(
                true, true, true, true, true, 2.0, 0, true);
            Assert.That(missing.Code, Is.EqualTo("remote_peer_missing"));

            var result = TeamForgeTwoPcSmokeCheck.Evaluate(
                true, true, true, true, true, 2.0, 1, true);
            Assert.That(result.Passed, Is.True);
            Assert.That(result.Code, Is.EqualTo("smoke_passed"));
            Assert.That(result.RemoteMembers, Is.EqualTo(1));
            Assert.That(result.RoundTripMilliseconds, Is.EqualTo(2.0));
            Assert.That(result.Detail, Does.Contain("NOT full two-PC"));
        }
    }
}

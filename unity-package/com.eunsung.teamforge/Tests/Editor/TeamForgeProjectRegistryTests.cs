using NUnit.Framework;

namespace EunSung.TeamForge.Tests
{
    public sealed class TeamForgeProjectRegistryTests
    {
        [Test]
        public void SnapshotReplacementIsAtomicWhenOnePeerIsInvalid()
        {
            var registry = new TeamForgeProjectRegistry();
            var baseline = TestProjectData.ValidBaseline();
            var initial = TestProjectData.ValidPeer(baseline, "connection-a", "editor-a");
            Assert.That(
                registry.ReplaceAll(baseline, new[] { initial }, out var error),
                Is.True,
                error);
            var version = registry.Version;

            var validReplacement = TestProjectData.ValidPeer(baseline, "connection-b", "editor-b");
            var invalid = TestProjectData.ValidPeer(baseline, "connection-c", "editor-c");
            invalid.projectUuid = "00000000-0000-0000-0000-000000000001";
            var accepted = registry.ReplaceAll(
                baseline,
                new[] { validReplacement, invalid },
                out error);

            Assert.That(accepted, Is.False);
            Assert.That(registry.Version, Is.EqualTo(version));
            Assert.That(registry.Count, Is.EqualTo(1));
            Assert.That(registry.TryGet("connection-a", out var retained), Is.True);
            Assert.That(retained.userId, Is.EqualTo("editor-a"));
        }

        [Test]
        public void RegistryRejectsDuplicateUsersWithoutMutatingLastKnownGoodState()
        {
            var registry = new TeamForgeProjectRegistry();
            var baseline = TestProjectData.ValidBaseline();
            Assert.That(
                registry.ReplaceAll(
                    baseline,
                    new[] { TestProjectData.ValidPeer(baseline, "connection-a", "editor-a") },
                    out var error),
                Is.True,
                error);

            var accepted = registry.ReplaceAll(
                baseline,
                new[]
                {
                    TestProjectData.ValidPeer(baseline, "connection-b", "editor-b"),
                    TestProjectData.ValidPeer(baseline, "connection-c", "editor-b"),
                },
                out error);

            Assert.That(accepted, Is.False);
            Assert.That(error, Does.Contain("duplicate user ID"));
            Assert.That(registry.TryGet("connection-a", out _), Is.True);
        }

        [Test]
        public void NewConnectionForSameUserAtomicallySupersedesOldPeer()
        {
            var registry = new TeamForgeProjectRegistry();
            var baseline = TestProjectData.ValidBaseline();
            Assert.That(
                registry.ReplaceAll(
                    baseline,
                    new[] { TestProjectData.ValidPeer(baseline, "connection-a", "editor-a") },
                    out var error),
                Is.True,
                error);

            Assert.That(
                registry.Upsert(
                    TestProjectData.ValidPeer(baseline, "connection-b", "editor-a"),
                    out error),
                Is.True,
                error);

            Assert.That(registry.Count, Is.EqualTo(1));
            Assert.That(registry.TryGet("connection-a", out _), Is.False);
            Assert.That(registry.TryGet("connection-b", out _), Is.True);
        }

        [Test]
        public void BaselineCannotMoveBackwardsOrForkSameRevision()
        {
            var registry = new TeamForgeProjectRegistry();
            var baseline = TestProjectData.ValidBaseline(3);
            Assert.That(registry.ApplyBaseline(baseline, out var error), Is.True, error);

            var older = TestProjectData.ValidBaseline(2);
            Assert.That(registry.ApplyBaseline(older, out error), Is.False);
            Assert.That(error, Does.Contain("backwards"));

            var conflicting = TestProjectData.ValidBaseline(3);
            conflicting.manifestHash = new string('d', 64);
            Assert.That(registry.ApplyBaseline(conflicting, out error), Is.False);
            Assert.That(error, Does.Contain("different content"));
            Assert.That(registry.Baseline.manifestHash, Is.EqualTo(TestProjectData.ManifestHash));
        }

        [Test]
        public void HigherBaselineClearsRanksCalculatedAgainstOldRevision()
        {
            var registry = new TeamForgeProjectRegistry();
            var baseline = TestProjectData.ValidBaseline(3);
            Assert.That(
                registry.ReplaceAll(
                    baseline,
                    new[] { TestProjectData.ValidPeer(baseline, "connection-a", "editor-a") },
                    out var error),
                Is.True,
                error);

            var next = TestProjectData.ValidBaseline(4);
            next.manifestHash = new string('d', 64);
            next.descriptorHash = new string('e', 64);
            Assert.That(registry.ApplyBaseline(next, out error), Is.True, error);

            Assert.That(registry.Baseline.baselineRevision, Is.EqualTo(4));
            Assert.That(registry.Count, Is.EqualTo(0));
        }

        [Test]
        public void RegistryReturnsCopiesSoCallersCannotMutateTrustState()
        {
            var registry = new TeamForgeProjectRegistry();
            var baseline = TestProjectData.ValidBaseline();
            Assert.That(registry.ApplyBaseline(baseline, out var error), Is.True, error);

            var exposed = registry.Baseline;
            exposed.manifestHash = new string('f', 64);

            Assert.That(registry.Baseline.manifestHash, Is.EqualTo(TestProjectData.ManifestHash));
        }

        [Test]
        public void IncompatibleRank99PeerIsVisibleButNeverSelectable()
        {
            var registry = new TeamForgeProjectRegistry();
            var baseline = TestProjectData.ValidBaseline();
            var incompatible = TestProjectData.ValidPeer(
                baseline,
                "connection-old",
                "editor-old",
                99);
            incompatible.teamForgePackageVersion = "0.5.1";
            incompatible.transferProtocolVersion = 2;

            Assert.That(
                registry.ReplaceAll(baseline, new[] { incompatible }, out var error),
                Is.True,
                error);
            Assert.That(registry.Snapshot()[0].seedRank, Is.EqualTo(99));
        }
    }
}

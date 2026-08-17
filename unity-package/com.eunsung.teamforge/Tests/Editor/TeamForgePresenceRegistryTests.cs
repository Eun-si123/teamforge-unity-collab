using NUnit.Framework;

namespace EunSung.TeamForge.Tests
{
    public sealed class TeamForgePresenceRegistryTests
    {
        [Test]
        public void SnapshotUpdateAndLeaveMaintainExpectedMemberSet()
        {
            var registry = new TeamForgePresenceRegistry();
            var changes = 0;
            registry.Changed += () => changes += 1;

            Assert.That(
                registry.ReplaceAll(new[] { ValidPresence("editor-a", "Editor A") }, out var snapshotError),
                Is.True,
                snapshotError);
            Assert.That(
                registry.Upsert(ValidPresence("editor-b", "Editor B"), out var updateError),
                Is.True,
                updateError);
            Assert.That(registry.Count, Is.EqualTo(2));
            Assert.That(registry.Snapshot()[0].displayName, Is.EqualTo("Editor A"));

            Assert.That(registry.Remove("editor-a"), Is.True);
            Assert.That(registry.TryGet("editor-b", out var remaining), Is.True);
            Assert.That(remaining.displayName, Is.EqualTo("Editor B"));
            Assert.That(changes, Is.EqualTo(3));
            Assert.That(registry.Version, Is.EqualTo(3));
        }

        [Test]
        public void InvalidSnapshotDoesNotReplaceLastKnownGoodState()
        {
            var registry = new TeamForgePresenceRegistry();
            Assert.That(
                registry.ReplaceAll(new[] { ValidPresence("editor-a", "Editor A") }, out var initialError),
                Is.True,
                initialError);

            var invalid = ValidPresence("editor-b", "Editor B");
            invalid.cameraPosition.x = float.NaN;
            var accepted = registry.ReplaceAll(new[] { invalid }, out var error);

            Assert.That(accepted, Is.False);
            Assert.That(error, Does.Contain("camera"));
            Assert.That(registry.TryGet("editor-a", out _), Is.True);
            Assert.That(registry.Count, Is.EqualTo(1));
        }

        private static PresenceRecord ValidPresence(string userId, string name)
        {
            return new PresenceRecord
            {
                userId = userId,
                connectionId = $"connection-{userId}",
                displayName = name,
                color = "#64B5F6",
                sceneId = "scene-guid",
                sceneName = "SampleScene",
                selectedObjectId = string.Empty,
                selectedObjectName = string.Empty,
                hasSceneView = true,
                cameraPosition = new TeamForgeVector3Dto(),
                cameraRotation = new TeamForgeQuaternionDto { w = 1 },
                cameraPivot = new TeamForgeVector3Dto(),
                cameraSize = 10,
                cameraOrthographic = false,
                activity = "Viewing",
                lastHeartbeatUnixMs = 1786000000000,
            };
        }
    }
}

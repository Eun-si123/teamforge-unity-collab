using NUnit.Framework;
using UnityEngine;

namespace EunSung.TeamForge.Tests
{
    public sealed class TeamForgeColliderSnapshotDigestTests
    {
        private static TeamForgeComponentSource Source() => new TeamForgeComponentSource
        {
            projectUuid = "315b1ce0-5da1-4336-83ba-8ad070f38231", baselineRevision = 1,
            manifestHash = new string('b', 64), descriptorHash = new string('c', 64),
            scenePath = "Assets/Scenes/Shared.unity", sceneFileSha256 = new string('d', 64),
            sceneMetaSha256 = new string('e', 64),
        };
        private static TeamForgeColliderProperty Row() => new TeamForgeColliderProperty(new string('a', 32),
            "GlobalObjectId_V1-2-" + new string('a', 32) + "-10-0",
            "GlobalObjectId_V1-2-" + new string('a', 32) + "-20-0", "UnityEngine.BoxCollider", "m_Center",
            "vector3", false, 0f, new Vector3(0.1f, -0f, -2.75f), 4);

        [Test]
        public void PortableDigestMatchesNodeFloat32GoldenVector()
        {
            var row = Row();
            var digest = TeamForgeColliderSnapshotDigest.Compute(Source(), "11111111-1111-4111-8111-111111111111",
                row.SceneId, 4, new[] { row });
            Assert.That(digest, Is.EqualTo("c58605d4245ae82e2992803f1100049f53329c6d9a9fca84aa652fae277a8497"));
            Assert.That(TeamForgeColliderSnapshotDigest.Compute(Source(), "11111111-1111-4111-8111-111111111111",
                row.SceneId, 4, new[] { row.WithValue(new Vector3(0.1f, 0f, -2.75f)) }), Is.EqualTo(digest));
        }

        [Test]
        public void DigestBindsSourceEpochRevisionAndExactValueBeforeEditorMutation()
        {
            var row = Row(); var source = Source();
            const string epoch = "11111111-1111-4111-8111-111111111111";
            var original = TeamForgeColliderSnapshotDigest.Compute(source, epoch, row.SceneId, 4, new[] { row });
            Assert.That(TeamForgeColliderSnapshotDigest.Compute(source, epoch, row.SceneId, 4,
                new[] { row.WithValue(new Vector3(0.2f, 0f, -2.75f)) }), Is.Not.EqualTo(original));
            Assert.That(TeamForgeColliderSnapshotDigest.Compute(source, "22222222-2222-4222-8222-222222222222",
                row.SceneId, 4, new[] { row }), Is.Not.EqualTo(original));
            Assert.That(TeamForgeColliderSnapshotDigest.Compute(source, epoch, row.SceneId, 5, new[] { row }), Is.Not.EqualTo(original));
            source.sceneFileSha256 = new string('f', 64);
            Assert.That(TeamForgeColliderSnapshotDigest.Compute(source, epoch, row.SceneId, 4, new[] { row }), Is.Not.EqualTo(original));
        }
    }
}

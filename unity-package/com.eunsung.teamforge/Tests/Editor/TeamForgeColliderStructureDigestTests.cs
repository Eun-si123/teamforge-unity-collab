using System;
using NUnit.Framework;
using UnityEngine;

namespace EunSung.TeamForge.Tests
{
    public sealed class TeamForgeColliderStructureDigestTests
    {
        private const string Scene = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        private const string Owner = "GlobalObjectId_V1-2-" + Scene + "-100-0";
        private const string ComponentId = "tf:c:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

        [Test]
        public void RuntimeCatalogDigestMatchesIndependentNodeAndBinary32Golden()
        {
            var active = new[] { Row(ComponentId, "UnityEngine.BoxCollider", 7) };
            var deleted = new[] { Row("GlobalObjectId_V1-2-" + Scene + "-200-0", "UnityEngine.SphereCollider", 8) };
            var rows = new[]
            {
                new TeamForgeColliderProperty(Scene, Owner, ComponentId, "UnityEngine.BoxCollider", "m_Center", "vector3", false, 0,
                    new Vector3(1.5f, -2.25f, 3.75f), 9),
                new TeamForgeColliderProperty(Scene, Owner, ComponentId, "UnityEngine.BoxCollider", "m_IsTrigger", "boolean", false, 0, Vector3.zero, 9),
                new TeamForgeColliderProperty(Scene, Owner, ComponentId, "UnityEngine.BoxCollider", "m_Size", "vector3", false, 0,
                    new Vector3(1, 2, 3), 9),
            };
            var digest = TeamForgeColliderSnapshotDigest.ComputeV2(Source(), Epoch, Scene, 9, 7, active, deleted, rows);
            Assert.That(digest, Is.EqualTo("f9887804c1fd3dc1d2ac94a5d6236cc6c4763e590ab54c54a68e3e6483d3601b"));
            deleted[0].serverRevision = 9;
            Assert.That(TeamForgeColliderSnapshotDigest.ComputeV2(Source(), Epoch, Scene, 9, 7, active, deleted, rows), Is.Not.EqualTo(digest),
                "Deleting metadata is part of the verified snapshot even when active property values are unchanged.");
        }

        [Test]
        public void EmptyRuntimeCatalogStillBindsEpochAndStructureRevision()
        {
            var empty = Array.Empty<TeamForgeColliderComponentCatalogRow>();
            var properties = Array.Empty<TeamForgeColliderProperty>();
            var first = TeamForgeColliderSnapshotDigest.ComputeV2(Source(), Epoch, Scene, 9, 7, empty, empty, properties);
            Assert.That(TeamForgeColliderSnapshotDigest.ComputeV2(Source(), Epoch, Scene, 9, 8, empty, empty, properties), Is.Not.EqualTo(first));
            Assert.That(TeamForgeColliderSnapshotDigest.ComputeV2(Source(), "33333333-3333-4333-8333-333333333333", Scene, 9, 7,
                empty, empty, properties), Is.Not.EqualTo(first));
        }

        [Test]
        public void DuplicateActiveDeletedOrFutureCatalogIdentityCannotReceiveDigest()
        {
            var row = Row(ComponentId, "UnityEngine.BoxCollider", 7);
            var properties = new[]
            {
                new TeamForgeColliderProperty(Scene, Owner, ComponentId, "UnityEngine.BoxCollider", "m_Center", "vector3", false, 0, Vector3.zero),
                new TeamForgeColliderProperty(Scene, Owner, ComponentId, "UnityEngine.BoxCollider", "m_IsTrigger", "boolean", false, 0, Vector3.zero),
                new TeamForgeColliderProperty(Scene, Owner, ComponentId, "UnityEngine.BoxCollider", "m_Size", "vector3", false, 0, Vector3.one),
            };
            Assert.Throws<ArgumentException>(() => TeamForgeColliderSnapshotDigest.ComputeV2(Source(), Epoch, Scene, 9, 7,
                new[] { row }, new[] { row.Copy() }, properties));
            row.serverRevision = 10;
            Assert.Throws<ArgumentException>(() => TeamForgeColliderSnapshotDigest.ComputeV2(Source(), Epoch, Scene, 9, 7,
                new[] { row }, Array.Empty<TeamForgeColliderComponentCatalogRow>(), properties));
        }

        private const string Epoch = "22222222-2222-4222-8222-222222222222";
        private static TeamForgeColliderComponentCatalogRow Row(string id, string type, long revision) =>
            new TeamForgeColliderComponentCatalogRow { sceneId = Scene, objectId = Owner, componentId = id, typeName = type, serverRevision = revision };
        private static TeamForgeComponentSource Source() => new TeamForgeComponentSource
        {
            projectUuid = "11111111-1111-4111-8111-111111111111", baselineRevision = 3,
            manifestHash = new string('a', 64), descriptorHash = new string('b', 64), scenePath = "Assets/Shared.unity",
            sceneFileSha256 = new string('c', 64), sceneMetaSha256 = new string('d', 64),
        };
    }
}

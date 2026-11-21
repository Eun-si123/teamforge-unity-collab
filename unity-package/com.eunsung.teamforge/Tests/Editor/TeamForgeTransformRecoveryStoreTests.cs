using System;
using System.IO;
using NUnit.Framework;
using UnityEngine;

namespace EunSung.TeamForge.Tests
{
    public sealed class TeamForgeTransformRecoveryStoreTests
    {
        private string directory;
        private string recoveryPath;

        [SetUp]
        public void SetUp()
        {
            directory = Path.Combine(Directory.GetCurrentDirectory(), "Library", "TeamForgeRecoveryTest-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(directory);
            recoveryPath = Path.Combine(directory, "recovery.json");
        }

        [TearDown]
        public void TearDown() { if (Directory.Exists(directory)) Directory.Delete(directory, true); }

        [Test]
        public void ReloadPreservesDesiredPoseAndRequiresReviewOfRetiredRequest()
        {
            var row = NewRow();
            var first = new TeamForgeTransformRecoveryStore(recoveryPath);
            Assert.That(first.Put(row, out var error), Is.True, error);

            var resumed = new TeamForgeTransformRecoveryStore(recoveryPath);
            Assert.That(resumed.Load(out error), Is.True, error);
            Assert.That(resumed.TryGet(row.Key, out var recovered), Is.True);
            Assert.That(recovered.needsReview, Is.True);
            Assert.That(recovered.authorityEpoch, Is.EqualTo(row.authorityEpoch));
            Assert.That(recovered.operationId, Is.EqualTo(row.operationId));
            Assert.That(recovered.before.LocalPosition, Is.EqualTo(new Vector3(4, 1, -2)));
            Assert.That(recovered.desired.LocalPosition, Is.EqualTo(new Vector3(6, 1, -2)));

            Assert.That(resumed.ConfirmShared(NewRow().scope.Key, row.sceneId, row.objectId, row.desired, out error), Is.True, error);
            Assert.That(resumed.TryGet(row.Key, out _), Is.True, "Another durable lineage cannot confirm this intent.");
            Assert.That(resumed.ConfirmShared(row.scope.Key, row.sceneId, row.objectId, row.before, out error), Is.True, error);
            Assert.That(resumed.TryGet(row.Key, out _), Is.True, "Restoring the confirmed pose keeps the desired pose for review.");
            Assert.That(resumed.ConfirmShared(row.scope.Key, row.sceneId, row.objectId, row.desired, out error), Is.True, error);
            Assert.That(resumed.Rows(), Is.Empty);
        }

        [Test]
        public void CorruptArchiveRemainsAvailableForRepair()
        {
            const string existing = "{\"payload\":\"unverified\",\"checksum\":\"invalid\"}";
            File.WriteAllText(recoveryPath, existing);
            var store = new TeamForgeTransformRecoveryStore(recoveryPath);
            Assert.That(store.Load(out _), Is.False);
            Assert.That(store.Put(NewRow(), out _), Is.False);
            Assert.That(File.ReadAllText(recoveryPath), Is.EqualTo(existing));
        }

        private static TeamForgeTransformRecoveryRow NewRow() => new TeamForgeTransformRecoveryRow
        {
            scope = new TeamForgeTransformRecoveryScope
            {
                projectId = "editor-project", sessionId = "shared-session", projectUuid = Guid.NewGuid().ToString("D"),
                durableSessionId = Guid.NewGuid().ToString("D"), manifestHash = new string('a', 64),
                descriptorHash = new string('b', 64), baselineRevision = 1,
            },
            sceneId = new string('c', 32), scenePath = "Assets/Shared.unity", objectId = "tf:" + new string('d', 32),
            parentObjectId = string.Empty, authorityEpoch = Guid.NewGuid().ToString("D"), operationId = Guid.NewGuid().ToString("N"),
            desired = new TeamForgeTransformState { LocalPosition = new Vector3(6, 1, -2) },
            before = new TeamForgeTransformState { LocalPosition = new Vector3(4, 1, -2) },
        };
    }
}

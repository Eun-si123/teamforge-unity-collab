using System;
using System.IO;
using NUnit.Framework;
using UnityEngine;

namespace EunSung.TeamForge.Tests
{
    public sealed class TeamForgeHierarchyReparentRecoveryStoreTests
    {
        private string directory;
        private string archivePath;

        [SetUp]
        public void SetUp()
        {
            directory = Path.Combine(Directory.GetCurrentDirectory(), "Library", "TeamForgeReparentTest-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(directory);
            archivePath = Path.Combine(directory, "reparent-recovery.json");
        }

        [TearDown]
        public void TearDown() { if (Directory.Exists(directory)) Directory.Delete(directory, true); }

        [Test]
        public void DiskReloadPreservesBothParentGenerationsAndLocalPoses()
        {
            var row = NewRow();
            var expectedDestination = row.desired.parentObjectId;
            var key = row.Key;
            var first = new TeamForgeHierarchyReparentRecoveryStore(archivePath);
            Assert.That(first.Put(row, out var error), Is.True, error);
            row.scope.sessionId = "different-session";
            row.desired.parentCreatedRevision += 1;
            row.desired.pose.LocalPosition = Vector3.zero;
            Assert.That(first.TryGet(key, out var saved), Is.True);
            Assert.That(saved.scope.sessionId, Is.EqualTo("shared-session"));
            Assert.That(saved.desired.parentCreatedRevision, Is.EqualTo(7));
            Assert.That(saved.desired.pose.LocalPosition, Is.EqualTo(new Vector3(.25f, .5f, .75f)));

            var restarted = new TeamForgeHierarchyReparentRecoveryStore(archivePath);
            Assert.That(restarted.Load(out error), Is.True, error);
            Assert.That(restarted.TryGet(key, out var recovered), Is.True);
            Assert.That(restarted.TryGet(row.Key, out _), Is.False);
            Assert.That(recovered.needsReview, Is.True);
            Assert.That(recovered.before.parentCreatedRevision, Is.EqualTo(3));
            Assert.That(recovered.before.pose.LocalPosition, Is.EqualTo(new Vector3(4, 1, -2)));
            Assert.That(recovered.desired.parentObjectId, Is.EqualTo(expectedDestination));
            Assert.That(recovered.desired.siblingIndex, Is.EqualTo(1));
            Assert.That(recovered.desired.parentCreatedRevision, Is.EqualTo(7));
            Assert.That(recovered.desired.pose.LocalPosition, Is.EqualTo(new Vector3(.25f, .5f, .75f)));
        }

        [Test]
        public void InvalidParentOrSameParentDoesNotCreateAnArchive()
        {
            var store = new TeamForgeHierarchyReparentRecoveryStore(archivePath);
            var row = NewRow();
            row.desired.parentObjectId = row.objectId;
            Assert.That(store.Put(row, out _), Is.False);
            row.desired.parentObjectId = row.before.parentObjectId;
            Assert.That(store.Put(row, out _), Is.False);
            row.desired.parentObjectId = string.Empty;
            Assert.That(store.Put(row, out _), Is.False, "A Scene root must have generation zero.");
            Assert.That(store.Rows(), Is.Empty);
            Assert.That(File.Exists(archivePath), Is.False);
        }

        private static TeamForgeHierarchyReparentRecoveryRow NewRow() => new TeamForgeHierarchyReparentRecoveryRow
        {
            scope = new TeamForgeTransformRecoveryScope
            {
                projectId = "editor-project", sessionId = "shared-session", projectUuid = Guid.NewGuid().ToString("D"),
                durableSessionId = Guid.NewGuid().ToString("D"), manifestHash = new string('a', 64),
                descriptorHash = new string('b', 64), baselineRevision = 1,
            },
            sceneId = new string('c', 32), scenePath = "Assets/Shared.unity", objectId = "tf:" + new string('d', 32),
            authorityEpoch = Guid.NewGuid().ToString("D"), operationId = Guid.NewGuid().ToString("N"), createdRevision = 9,
            before = new TeamForgeReparentPlacement { parentObjectId = "tf:" + new string('e', 32), parentCreatedRevision = 3,
                siblingIndex = 0, pose = new TeamForgeTransformState { LocalPosition = new Vector3(4, 1, -2) } },
            desired = new TeamForgeReparentPlacement { parentObjectId = "tf:" + new string('f', 32), parentCreatedRevision = 7,
                siblingIndex = 1, pose = new TeamForgeTransformState { LocalPosition = new Vector3(.25f, .5f, .75f) } },
        };
    }
}

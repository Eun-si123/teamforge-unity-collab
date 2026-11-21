using System;
using System.IO;
using NUnit.Framework;

namespace EunSung.TeamForge.Tests
{
    public sealed class TeamForgeHierarchySiblingRecoveryStoreTests
    {
        private string directory;
        private string archiveDirectory;
        private string archivePath;

        [SetUp]
        public void SetUp()
        {
            directory = Path.Combine(Directory.GetCurrentDirectory(), "Library", "TeamForgeSiblingTest-" + Guid.NewGuid().ToString("N"));
            archiveDirectory = Path.Combine(directory, "archive");
            archivePath = Path.Combine(archiveDirectory, "sibling-recovery.json");
            Directory.CreateDirectory(archiveDirectory);
        }

        [TearDown]
        public void TearDown() { if (Directory.Exists(directory)) Directory.Delete(directory, true); }

        [Test]
        public void DetectsExactMoverInsteadOfIncidentalSiblingShifts()
        {
            var before = Order("A", "B", "C", "D", "E");
            var desired = Order("A", "C", "D", "B", "E");
            Assert.That(TeamForgeSiblingOrder.Compare(before, desired, "D", out var from, out var to),
                Is.EqualTo(TeamForgeSiblingOrderChange.SingleMove));
            Assert.That(from, Is.EqualTo(1));
            Assert.That(to, Is.EqualTo(3));
            Assert.That(TeamForgeSiblingOrder.Compare(desired, before, null, out from, out to),
                Is.EqualTo(TeamForgeSiblingOrderChange.SingleMove));
            Assert.That(from, Is.EqualTo(3));
            Assert.That(to, Is.EqualTo(1));
        }

        [Test]
        public void RefusesAmbiguousMovesWithoutAnExactCandidateAndRefusesChangedMembership()
        {
            var before = Order("A", "B", "C", "D");
            var swapped = Order("A", "C", "B", "D");
            Assert.That(TeamForgeSiblingOrder.Compare(before, swapped, "A", out _, out _),
                Is.EqualTo(TeamForgeSiblingOrderChange.Ambiguous));
            Assert.That(TeamForgeSiblingOrder.Compare(before, swapped, "B", out var from, out var to),
                Is.EqualTo(TeamForgeSiblingOrderChange.SingleMove));
            Assert.That(from, Is.EqualTo(1));
            Assert.That(to, Is.EqualTo(2));
            Assert.That(TeamForgeSiblingOrder.Compare(before, swapped, "C", out from, out to),
                Is.EqualTo(TeamForgeSiblingOrderChange.SingleMove));
            Assert.That(from, Is.EqualTo(2));
            Assert.That(to, Is.EqualTo(1));
            Assert.That(TeamForgeSiblingOrder.Compare(before, Order("C", "D", "A", "B"), null, out _, out _),
                Is.EqualTo(TeamForgeSiblingOrderChange.MultipleMoves));
            Assert.That(TeamForgeSiblingOrder.Compare(before, Order("D", "B", "C", "D"), "D", out _, out _),
                Is.EqualTo(TeamForgeSiblingOrderChange.MembershipMismatch));
            swapped[1].createdRevision++;
            Assert.That(TeamForgeSiblingOrder.Compare(before, swapped, "B", out _, out _),
                Is.EqualTo(TeamForgeSiblingOrderChange.MembershipMismatch));
        }

        [Test]
        public void OpensOnDiskWithReviewAndPreservesAnArchiveWhenTheNextWriteFails()
        {
            var store = new TeamForgeHierarchySiblingRecoveryStore(archivePath);
            var row = NewRow();
            Assert.That(store.Put(row, out var error), Is.True, error);
            var original = File.ReadAllBytes(archivePath);
            var key = row.Key;
            row.beforeOrder[1].createdRevision++;
            Assert.That(store.TryGet(key, out var saved), Is.True);
            Assert.That(saved.beforeOrder[1].createdRevision, Is.EqualTo(1));
            Assert.That(store.TryGetGroup(saved.scope.Key, saved.sceneId, saved.parentObjectId, out var group), Is.True);
            Assert.That(group.Key, Is.EqualTo(key));

            var backup = archiveDirectory + "-existing";
            Directory.Move(archiveDirectory, backup);
            File.WriteAllText(archiveDirectory, "A file cannot serve as the archive directory.");
            try
            {
                saved.needsReview = true;
                Assert.That(store.Put(saved, out _), Is.False);
                Assert.That(store.TryGet(key, out var retained), Is.True);
                Assert.That(retained.needsReview, Is.False);
                Assert.That(store.Remove(key, out _), Is.False);
                Assert.That(store.TryGet(key, out _), Is.True);
            }
            finally
            {
                File.Delete(archiveDirectory);
                Directory.Move(backup, archiveDirectory);
            }

            CollectionAssert.AreEqual(original, File.ReadAllBytes(archivePath));
            var restarted = new TeamForgeHierarchySiblingRecoveryStore(archivePath);
            Assert.That(restarted.Load(out error), Is.True, error);
            Assert.That(restarted.TryGet(key, out var recovered), Is.True);
            Assert.That(recovered.needsReview, Is.True);
            Assert.That(recovered.parentCreatedRevision, Is.EqualTo(7));
            Assert.That(recovered.desiredIndex, Is.EqualTo(2));
            Assert.That(recovered.desiredOrder[2].objectId, Is.EqualTo("A"));
        }

        [Test]
        public void RejectsDuplicateGroupAndCannotReplaceAnArchiveForAnotherGeneration()
        {
            var store = new TeamForgeHierarchySiblingRecoveryStore(archivePath);
            var row = NewRow();
            Assert.That(store.Put(row, out var error), Is.True, error);
            var differentMover = row.Copy();
            differentMover.objectId = "C";
            differentMover.createdRevision = 2;
            differentMover.beforeIndex = 2;
            differentMover.desiredIndex = 0;
            differentMover.desiredOrder = Order("C", "A", "B");
            Assert.That(differentMover.IsValid, Is.True);
            Assert.That(store.Put(differentMover, out _), Is.False);
            row.parentCreatedRevision++;
            Assert.That(store.Put(row, out _), Is.False);
            Assert.That(store.Rows(), Has.Count.EqualTo(1));
            Assert.That(store.TryGet(row.Key, out var retained), Is.True);
            Assert.That(retained.parentCreatedRevision, Is.EqualTo(7));
        }

        private static TeamForgeSiblingRecoveryMember[] Order(params string[] ids)
        {
            return Array.ConvertAll(ids, id => new TeamForgeSiblingRecoveryMember { objectId = id, createdRevision = id[0] - 'A' });
        }

        private static TeamForgeHierarchySiblingRecoveryRow NewRow() => new TeamForgeHierarchySiblingRecoveryRow
        {
            scope = new TeamForgeTransformRecoveryScope
            {
                projectId = "editor-project", sessionId = "shared-session", projectUuid = Guid.NewGuid().ToString("D"),
                durableSessionId = Guid.NewGuid().ToString("D"), manifestHash = new string('a', 64),
                descriptorHash = new string('b', 64), baselineRevision = 1,
            },
            sceneId = new string('c', 32), scenePath = "Assets/Shared.unity", objectId = "A",
            authorityEpoch = Guid.NewGuid().ToString("D"), operationId = Guid.NewGuid().ToString("N"),
            createdRevision = 0, parentObjectId = "P", parentCreatedRevision = 7,
            beforeOrder = Order("A", "B", "C"), desiredOrder = Order("B", "C", "A"), beforeIndex = 0, desiredIndex = 2,
        };
    }
}

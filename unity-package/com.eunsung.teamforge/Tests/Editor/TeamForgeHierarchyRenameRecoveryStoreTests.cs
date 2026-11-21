using System;
using System.IO;
using NUnit.Framework;

namespace EunSung.TeamForge.Tests
{
    public sealed class TeamForgeHierarchyRenameRecoveryStoreTests
    {
        private string directory;
        private string archivePath;

        [SetUp]
        public void SetUp()
        {
            directory = Path.Combine(Directory.GetCurrentDirectory(), "Library", "TeamForgeRenameRecoveryTest-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(directory);
            archivePath = Path.Combine(directory, "rename-recovery.json");
        }

        [TearDown]
        public void TearDown() { if (Directory.Exists(directory)) Directory.Delete(directory, true); }

        [Test]
        public void DiskReloadRetainsExactScopeAndRequiresReviewOfRetiredRename()
        {
            var original = NewRow();
            var key = original.Key;
            var first = new TeamForgeHierarchyRenameRecoveryStore(archivePath);
            Assert.That(first.Put(original, out var error), Is.True, error);
            original.scope.sessionId = "unrelated-session";
            Assert.That(first.TryGet(key, out var saved), Is.True);
            Assert.That(saved.scope.sessionId, Is.EqualTo("shared-session"));
            saved.scope.projectId = "another-project";
            Assert.That(first.TryGet(key, out saved), Is.True);
            Assert.That(saved.scope.projectId, Is.EqualTo("editor-project"));

            var resumed = new TeamForgeHierarchyRenameRecoveryStore(archivePath);
            Assert.That(resumed.Load(out error), Is.True, error);
            Assert.That(resumed.TryGet(original.Key, out _), Is.False);
            Assert.That(resumed.TryGet(key, out var recovered), Is.True);
            Assert.That(recovered.needsReview, Is.True);
            Assert.That(recovered.beforeName, Is.EqualTo("Shared name"));
            Assert.That(recovered.desiredName, Is.EqualTo("Local name"));
            Assert.That(recovered.operationId, Is.EqualTo(original.operationId));
            Assert.That(recovered.createdRevision, Is.EqualTo(original.createdRevision));
            Assert.That(recovered.scope.durableSessionId, Is.EqualTo(original.scope.durableSessionId));
        }

        [Test]
        public void InvalidArchiveIsPreservedAndBlocksReplacingIt()
        {
            const string existing = "{\"payload\":\"unverified\",\"checksum\":\"invalid\"}";
            File.WriteAllText(archivePath, existing);
            var store = new TeamForgeHierarchyRenameRecoveryStore(archivePath);
            Assert.That(store.Load(out _), Is.False);
            Assert.That(store.Put(NewRow(), out _), Is.False);
            Assert.That(File.ReadAllText(archivePath), Is.EqualTo(existing));
        }

        [Test]
        public void FailedCheckpointDoesNotPublishTheInMemoryRename()
        {
            Directory.CreateDirectory(archivePath);
            var store = new TeamForgeHierarchyRenameRecoveryStore(archivePath);
            Assert.That(store.Put(NewRow(), out _), Is.False);
            Assert.That(store.Rows(), Is.Empty);
            Assert.That(Directory.GetFileSystemEntries(directory), Is.EqualTo(new[] { archivePath }));
        }

        private static TeamForgeHierarchyRenameRecoveryRow NewRow() => new TeamForgeHierarchyRenameRecoveryRow
        {
            scope = new TeamForgeTransformRecoveryScope
            {
                projectId = "editor-project", sessionId = "shared-session", projectUuid = Guid.NewGuid().ToString("D"),
                durableSessionId = Guid.NewGuid().ToString("D"), manifestHash = new string('a', 64),
                descriptorHash = new string('b', 64), baselineRevision = 1,
            },
            sceneId = new string('c', 32), scenePath = "Assets/Shared.unity", objectId = "tf:" + new string('d', 32),
            authorityEpoch = Guid.NewGuid().ToString("D"), operationId = Guid.NewGuid().ToString("N"),
            beforeName = "Shared name", desiredName = "Local name", createdRevision = 9,
        };
    }
}

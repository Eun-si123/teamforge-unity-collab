using System;
using System.Reflection;
using NUnit.Framework;

namespace EunSung.TeamForge.Tests
{
    public sealed class TeamForgeAuthorityViewTests
    {
        private const BindingFlags StaticNonPublic = BindingFlags.Static | BindingFlags.NonPublic;

        [Test]
        public void SessionRevisionIsMonotonicAcrossSnapshotAndLiveObservationOrder()
        {
            var authorityType = AuthorityType();
            var reset = RequiredMethod(authorityType, "ResetSession");
            var observe = RequiredMethod(authorityType, "ObserveRevision");
            try
            {
                reset.Invoke(null, null);
                observe.Invoke(null, new object[] { 7L });
                observe.Invoke(null, new object[] { 4L });
                observe.Invoke(null, new object[] { 9L });

                Assert.That(TeamForgeTransformSyncService.CurrentRevision, Is.EqualTo(9));
                Assert.That(ReadViewProperty<long>(authorityType, "SessionRevision"), Is.EqualTo(9));
            }
            finally
            {
                reset.Invoke(null, null);
            }
        }

        [Test]
        public void TransformCompatibilityFacadeAliasesTheSharedLockRegistry()
        {
            var authorityType = AuthorityType();
            var reset = RequiredMethod(authorityType, "ResetSession");
            var upsert = RequiredMethod(authorityType, "UpsertLock");
            var lockState = new TeamForgeLockRecord
            {
                sceneId = "scene-a",
                objectId = "tf:0123456789abcdef0123456789abcdef",
                ownerUserId = "user-a",
                ownerConnectionId = "connection-a",
                ownerDisplayName = "User A",
                ownerColor = "#64B5F6",
                expiresAtUnixMs = 123456,
            };
            try
            {
                reset.Invoke(null, null);
                var arguments = new object[] { lockState, string.Empty };
                Assert.That(upsert.Invoke(null, arguments), Is.EqualTo(true), arguments[1] as string);

                var viewLocks = ReadViewProperty<TeamForgeLockRegistry>(authorityType, "Locks");
                Assert.That(TeamForgeTransformSyncService.Locks, Is.SameAs(viewLocks));
                Assert.That(TeamForgeTransformSyncService.Locks.TryGet(
                    lockState.sceneId,
                    lockState.objectId,
                    out var observed), Is.True);
                Assert.That(observed.ownerConnectionId, Is.EqualTo("connection-a"));
            }
            finally
            {
                reset.Invoke(null, null);
            }
        }

        [Test]
        public void LateReleaseForPreviousOwnerCannotRemoveNewerLock()
        {
            var reset = RequiredMethod(AuthorityType(), "ResetSession");
            var release = RequiredMethod(
                typeof(TeamForgeTransformSyncService), "HandleLockReleased");
            const string sceneId = "late-release-scene";
            const string objectId = "late-release-object";
            var locks = TeamForgeTransformSyncService.Locks;
            try
            {
                reset.Invoke(null, null);
                var older = LockRecord(sceneId, objectId, "alice", "connection-alice");
                var newer = LockRecord(sceneId, objectId, "bob", "connection-bob");
                Assert.That(locks.Upsert(older, out var error), Is.True, error);
                Assert.That(locks.Upsert(newer, out error), Is.True, error);
                var version = locks.Version;

                // A delayed release or stale already_unlocked acknowledgement
                // must never erase a newer, independently granted owner.
                release.Invoke(null, new object[] { Released(sceneId, objectId, older) });
                Assert.That(locks.TryGet(sceneId, objectId, out var observed), Is.True);
                Assert.That(observed, Is.SameAs(newer));
                Assert.That(locks.Version, Is.EqualTo(version));

                release.Invoke(null, new object[] { new LockReleasedMessage
                {
                    sceneId = sceneId,
                    objectId = objectId,
                    previousOwnerUserId = "",
                    previousOwnerConnectionId = "",
                    reason = "already_unlocked",
                } });
                Assert.That(locks.TryGet(sceneId, objectId, out observed), Is.True);
                Assert.That(observed, Is.SameAs(newer));
                Assert.That(locks.Version, Is.EqualTo(version));

                // A conflicting identity claiming the same connection ID is
                // also incapable of retiring the live owner.
                release.Invoke(null, new object[] { new LockReleasedMessage
                {
                    sceneId = sceneId,
                    objectId = objectId,
                    previousOwnerUserId = "alice",
                    previousOwnerConnectionId = "connection-bob",
                    reason = "connection_closed",
                } });
                Assert.That(locks.TryGet(sceneId, objectId, out observed), Is.True);
                Assert.That(observed, Is.SameAs(newer));
                Assert.That(locks.Version, Is.EqualTo(version));

                // The matching owner is still removed normally, and a replay
                // does not mutate the registry or advance its Version.
                release.Invoke(null, new object[] { Released(sceneId, objectId, newer) });
                Assert.That(locks.TryGet(sceneId, objectId, out _), Is.False);
                Assert.That(locks.Version, Is.EqualTo(version + 1));
                release.Invoke(null, new object[] { Released(sceneId, objectId, newer) });
                Assert.That(locks.Version, Is.EqualTo(version + 1));
            }
            finally
            {
                reset.Invoke(null, null);
            }
        }

        private static TeamForgeLockRecord LockRecord(
            string sceneId, string objectId, string userId, string connectionId)
        {
            return new TeamForgeLockRecord
            {
                sceneId = sceneId,
                objectId = objectId,
                ownerUserId = userId,
                ownerConnectionId = connectionId,
                ownerDisplayName = userId,
                ownerColor = "#64B5F6",
                expiresAtUnixMs = DateTimeOffset.UtcNow.AddMinutes(1).ToUnixTimeMilliseconds(),
            };
        }

        private static LockReleasedMessage Released(
            string sceneId, string objectId, TeamForgeLockRecord owner)
        {
            return new LockReleasedMessage
            {
                sceneId = sceneId,
                objectId = objectId,
                previousOwnerUserId = owner.ownerUserId,
                previousOwnerConnectionId = owner.ownerConnectionId,
                reason = "connection_closed",
            };
        }

        [Test]
        public void AuthorityViewExposesConnectionIdentityAndNegotiatedCapabilities()
        {
            var authorityType = AuthorityType();
            var current = RequiredCurrent(authorityType);
            var viewType = current.GetType();

            Assert.That(viewType.GetProperty("IsConnected"), Is.Not.Null);
            Assert.That(viewType.GetProperty("ConnectionId"), Is.Not.Null);
            Assert.That(viewType.GetProperty("PresenceAvailable"), Is.Not.Null);
            Assert.That(viewType.GetProperty("TransformSyncAvailable"), Is.Not.Null);
            Assert.That(viewType.GetProperty("HierarchySyncAvailable"), Is.Not.Null);
            Assert.That(viewType.GetProperty("ProjectTransferAvailable"), Is.Not.Null);
            Assert.That(ReadViewProperty<string>(authorityType, "ConnectionId"),
                Is.EqualTo(TeamForgeConnectionService.ConnectionId));
        }

        private static Type AuthorityType()
        {
            return typeof(TeamForgeTransformSyncService).Assembly.GetType(
                "EunSung.TeamForge.TeamForgeAuthorityView",
                true);
        }

        private static MethodInfo RequiredMethod(Type type, string name)
        {
            return type.GetMethod(name, StaticNonPublic) ??
                   throw new MissingMethodException(type.FullName, name);
        }

        private static object RequiredCurrent(Type authorityType)
        {
            var property = authorityType.GetProperty("Current", StaticNonPublic) ??
                           throw new MissingMemberException(authorityType.FullName, "Current");
            return property.GetValue(null) ??
                   throw new InvalidOperationException("Authority View current instance is unavailable.");
        }

        private static T ReadViewProperty<T>(Type authorityType, string name)
        {
            var current = RequiredCurrent(authorityType);
            var property = current.GetType().GetProperty(name) ??
                           throw new MissingMemberException(current.GetType().FullName, name);
            return (T)property.GetValue(current);
        }
    }
}

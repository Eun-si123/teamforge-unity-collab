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

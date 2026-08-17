using System;
using System.Linq;
using System.Reflection;
using NUnit.Framework;

namespace EunSung.TeamForge.Tests
{
    public sealed class TeamForgePolicyProfileTests
    {
        private const BindingFlags Members =
            BindingFlags.Instance | BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic;

        [Test]
        public void LegacyProfileResolvesCurrentSerializedConnectionValuesWithoutAddingSchemaFields()
        {
            var settings = TeamForgeConnectionSettings.instance;
            settings.EnsureDefaults();
            var profile = Resolve(settings);
            var connection = Property(profile, "Connection");

            Assert.That(Value<string>(profile, "Name"), Is.EqualTo("LegacyPhase4Compatible"));
            Assert.That(Value<string>(connection, "ServerAddress"), Is.EqualTo(settings.ServerAddress));
            Assert.That(Value<int>(connection, "ConnectionTimeoutSeconds"),
                Is.EqualTo(settings.ConnectionTimeoutSeconds));
            Assert.That(Value<int>(connection, "KeepAliveSeconds"), Is.EqualTo(20));

            var serializedNames = typeof(TeamForgeConnectionSettings)
                .GetFields(BindingFlags.Instance | BindingFlags.Public)
                .Select(field => field.Name)
                .ToArray();
            Assert.That(serializedNames, Does.Not.Contain("Profile"));
            Assert.That(serializedNames, Does.Not.Contain("ConnectionPolicy"));
        }

        [Test]
        public void LegacyTransferDefaultsRemainThePhase4Values()
        {
            var transfer = Property(Resolve(TeamForgeConnectionSettings.instance), "Transfer");
            Assert.That(Value<int>(transfer, "MaximumConcurrency"), Is.EqualTo(4));
            Assert.That(Value<int>(transfer, "RetryRounds"), Is.EqualTo(3));
            Assert.That(Value<int>(transfer, "RetryBaseMilliseconds"), Is.EqualTo(100));
            Assert.That(Value<int>(transfer, "RetryMaximumMilliseconds"), Is.EqualTo(5000));
            Assert.That(Value<int>(transfer, "RateLimitPerSecond"), Is.EqualTo(120));
        }

        [Test]
        public void TrustRequirementsExposeModesRatherThanDisableFlags()
        {
            var trust = Property(Resolve(TeamForgeConnectionSettings.instance), "Trust");
            Assert.That(Value<string>(trust, "OwnerTrustMode"), Is.EqualTo("signed-invite-owner-pin"));
            Assert.That(Value<string>(trust, "PublisherApprovalMode"),
                Is.EqualTo("explicit-fingerprint-approval"));
            Assert.That(trust.GetType().GetProperties(Members)
                .Any(property => property.PropertyType == typeof(bool)), Is.False);
        }

        private static object Resolve(TeamForgeConnectionSettings settings)
        {
            var type = typeof(TeamForgeConnectionService).Assembly.GetType(
                "EunSung.TeamForge.TeamForgeProfile", true);
            var method = type.GetMethod("ResolveLegacy", Members) ??
                         throw new MissingMethodException(type.FullName, "ResolveLegacy");
            return method.Invoke(null, new object[] { settings });
        }

        private static object Property(object instance, string name)
        {
            return instance.GetType().GetProperty(name, Members)?.GetValue(instance) ??
                   throw new MissingMemberException(instance.GetType().FullName, name);
        }

        private static T Value<T>(object instance, string name)
        {
            return (T)Property(instance, name);
        }
    }
}

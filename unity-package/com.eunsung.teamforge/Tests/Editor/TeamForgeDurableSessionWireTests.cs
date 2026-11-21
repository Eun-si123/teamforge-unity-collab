using System;
using NUnit.Framework;

namespace EunSung.TeamForge.Tests
{
    public sealed class TeamForgeDurableSessionWireTests
    {
        private const string Epoch = "178fa4a2-a58b-4de2-8f0a-e9aed691b3e7";
        private const string NextEpoch = "47c981b0-2341-45c2-b8e8-c121d844bcac";

        [TestCase("hierarchy_seed")]
        [TestCase("hierarchy_operation")]
        [TestCase("transform_update")]
        [TestCase("lock_request")]
        [TestCase("lock_release")]
        [TestCase("component_scene_join")]
        public void ProductionCommandShapesBindOnceAndCannotReplayInAnotherEpoch(string type)
        {
            var original = SerializeCommand(type);
            Assert.That(TeamForgeDurableSessionWire.TryPrepare(original, false, string.Empty,
                out var legacy, out var error), Is.True, error);
            Assert.That(legacy, Is.EqualTo(original), "Legacy messages omit the optional field entirely.");
            Assert.That(TeamForgeDurableSessionWire.TryPrepare(original, true, Epoch,
                out var bound, out error), Is.True, error);
            Assert.That(TeamForgeColliderPropertyWire.TryReadOptionalTopLevelString(bound, "authorityEpoch", 1024 * 1024,
                out var present, out var epoch), Is.True);
            Assert.That(present, Is.True); Assert.That(epoch, Is.EqualTo(Epoch));
            Assert.That(TeamForgeDurableSessionWire.TryPrepare(bound, true, Epoch,
                out var retry, out error), Is.True, error);
            Assert.That(retry, Is.EqualTo(bound), "Same-epoch retries retain the exact immutable bytes.");
            Assert.That(TeamForgeDurableSessionWire.TryPrepare(bound, true, NextEpoch, out _, out _), Is.False);
            Assert.That(TeamForgeDurableSessionWire.TryPrepare(bound, false, string.Empty, out _, out _), Is.False,
                "A retired durable command also cannot be reused against a legacy authority.");
        }

        [Test]
        public void ComponentEpochAndNestedOrQuotedNamesCannotSubstituteForTheAuthorityField()
        {
            var original = "{\"type\":\"hierarchy_operation\",\"protocolVersion\":1,\"componentEpoch\":\"" + Epoch +
                "\",\"name\":\"\\\"authorityEpoch\\\":\\\"old\\\"\",\"nested\":{\"authorityEpoch\":\"ignored\"}} \n";
            Assert.That(TeamForgeDurableSessionWire.TryPrepare(original, true, NextEpoch, out var bound, out var error), Is.True, error);
            Assert.That(bound, Does.Contain("\"componentEpoch\":\"" + Epoch + "\""));
            Assert.That(TeamForgeColliderPropertyWire.TryReadOptionalTopLevelString(bound, "authorityEpoch", 1024 * 1024,
                out var present, out var actual), Is.True);
            Assert.That(present, Is.True); Assert.That(actual, Is.EqualTo(NextEpoch));
            Assert.That(bound, Does.EndWith(" \n"));
        }

        [Test]
        public void EscapedEpochKeysAreRecognizedAndDuplicateRootFieldsAreRefused()
        {
            var prefix = "{\"type\":\"lock_request\",\"protocolVersion\":1,";
            var escaped = prefix + "\"\\u0061uthorityEpoch\":\"" + Epoch + "\"}";
            Assert.That(TeamForgeDurableSessionWire.TryPrepare(escaped, true, Epoch, out var bound, out var error), Is.True, error);
            Assert.That(bound, Is.EqualTo(escaped));
            Assert.That(TeamForgeDurableSessionWire.TryPrepare(escaped, true, NextEpoch, out _, out _), Is.False);
            var duplicate = escaped.Substring(0, escaped.Length - 1) + ",\"authorityEpoch\":\"" + Epoch + "\"}";
            Assert.That(TeamForgeDurableSessionWire.TryPrepare(duplicate, true, Epoch, out _, out _), Is.False);
        }

        [TestCase("null")]
        [TestCase("false")]
        [TestCase("123")]
        [TestCase("\"not-an-epoch\"")]
        [TestCase("\"00000000-0000-0000-0000-000000000000\"")]
        public void MalformedOrEmptyEpochIsNeverReplacedByCurrentEpoch(string raw)
        {
            var json = "{\"type\":\"component_scene_join\",\"protocolVersion\":1,\"authorityEpoch\":" + raw + "}";
            Assert.That(TeamForgeDurableSessionWire.TryPrepare(json, true, Epoch, out _, out _), Is.False);
        }

        [Test]
        public void BoundCommandsEnforceTheExistingOneMiBUtf8Limit()
        {
            var json = "{\"type\":\"hierarchy_operation\",\"protocolVersion\":1,\"name\":\"" + new string('é', 512 * 1024) + "\"}";
            Assert.That(json.Length, Is.LessThan(1024 * 1024));
            Assert.That(TeamForgeDurableSessionWire.TryPrepare(json, true, Epoch, out _, out _), Is.False);
        }

        [Test]
        public void CapabilityIsOfferedByEveryProductionHelloAndOtherCommandsKeepTheirShape()
        {
            foreach (var hello in new HelloMessage[] { new HelloMessage(), new ComponentRecoveryPreviewHelloMessage(),
                new ComponentPropertyHelloMessage(), new PrimitiveTemplateHelloMessage() })
            {
                hello.type = "hello"; hello.protocolVersion = TeamForgeProtocol.Version;
                var original = TeamForgeProtocol.Serialize(hello);
                Assert.That(original, Does.Contain("\"supportsDurableSessionRecovery\":true"));
                Assert.That(TeamForgeDurableSessionWire.TryPrepare(original, false, string.Empty, out var prepared, out var error), Is.True, error);
                Assert.That(prepared, Is.EqualTo(original));
            }
            var propertyRequest = TeamForgeProtocol.Serialize(new TeamForgeComponentRequest
            { type = "component_snapshot_request", protocolVersion = 1, epoch = Epoch });
            Assert.That(TeamForgeDurableSessionWire.TryPrepare(propertyRequest, true, NextEpoch,
                out var unbound, out _), Is.True);
            Assert.That(unbound, Is.EqualTo(propertyRequest), "Component commands keep their existing mandatory epoch contract.");
            Assert.That(TeamForgeDurableSessionWire.IsCanonicalUuid(Epoch.ToUpperInvariant()), Is.False);
        }

        private static string SerializeCommand(string type)
        {
            ProtocolEnvelope message;
            switch (type)
            {
                case "hierarchy_seed":
                    var seed = new HierarchySeedMessage { type = type, protocolVersion = 1, objects = Array.Empty<TeamForgeHierarchyObjectRecord>() };
                    Assert.That(TeamForgePrimitiveHierarchyWire.TrySerializeSeed(seed, out var seedJson), Is.True);
                    return seedJson;
                case "hierarchy_operation":
                    return TeamForgePrimitiveHierarchyWire.SerializeOperation(new HierarchyOperationMessage
                    { type = type, protocolVersion = 1, name = "Primitive", kind = "create_object", primitiveTemplate = "cube-v1", componentEpoch = Epoch });
                case "transform_update": message = new TransformUpdateMessage(); break;
                case "lock_request": message = new LockRequestMessage(); break;
                case "lock_release": message = new LockReleaseMessage(); break;
                case "component_scene_join": message = new TeamForgeComponentJoin(); break;
                default: throw new ArgumentException(type);
            }
            message.type = type; message.protocolVersion = 1; message.requestId = "durable-wire-test";
            return TeamForgeProtocol.Serialize(message);
        }
    }
}

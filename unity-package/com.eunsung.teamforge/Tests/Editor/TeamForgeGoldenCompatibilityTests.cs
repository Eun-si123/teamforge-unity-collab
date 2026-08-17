using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using NUnit.Framework;
using UnityEditor.PackageManager;
using UnityEngine;

namespace EunSung.TeamForge.Tests
{
    public sealed class TeamForgeGoldenCompatibilityTests
    {
        [Serializable]
        private sealed class GoldenFixture
        {
            public int schemaVersion;
            public int realtimeProtocolVersion;
            public CapabilityCase[] capabilityMatrix;
            public DescriptorFixture descriptor;
            public string canonicalPayload;
            public InviteFixture invite;
        }

        [Serializable]
        private sealed class CapabilityCase
        {
            public string id;
            public bool presence;
            public bool transform;
            public bool hierarchy;
            public bool project;
            public bool accepted;
            public string[] expectedMessages;
            public string errorDetail;
        }

        [Serializable]
        private sealed class DescriptorFixture
        {
            public int descriptorSchemaVersion;
            public string projectId;
            public string projectUuid;
            public long baselineRevision;
            public string manifestHash;
            public string unityVersion;
            public string teamForgePackageVersion;
            public int realtimeProtocolVersion;
            public int transferProtocolVersion;
            public int manifestSchemaVersion;
            public string ownerKeyId;
            public string ownerPublicKey;
            public string publisherKeyId;
            public string descriptorHash;
        }

        [Serializable]
        private sealed class InviteFixture
        {
            public string format;
            public string serverAddress;
            public string realtimePath;
            public string projectId;
            public string projectUuid;
            public string sessionId;
            public string ownerKeyId;
            public string ownerPublicKey;
            public string ownerSignature;
        }

        [Test]
        public void SharedDescriptorAndInviteFixtureMatchesUnityContracts()
        {
            var fixture = LoadFixture();
            Assert.That(fixture.schemaVersion, Is.EqualTo(1));
            Assert.That(fixture.realtimeProtocolVersion, Is.EqualTo(TeamForgeProtocol.Version));

            var descriptor = fixture.descriptor;
            var canonical = string.Join("\n", new[]
            {
                "teamforge-baseline-v1",
                descriptor.projectId,
                descriptor.projectUuid,
                descriptor.baselineRevision.ToString(),
                descriptor.manifestHash,
                descriptor.unityVersion,
                descriptor.teamForgePackageVersion,
                descriptor.realtimeProtocolVersion.ToString(),
                descriptor.transferProtocolVersion.ToString(),
                descriptor.manifestSchemaVersion.ToString(),
                descriptor.ownerKeyId,
                descriptor.publisherKeyId,
            });
            Assert.That(canonical, Is.EqualTo(fixture.canonicalPayload));
            Assert.That(Sha256(canonical), Is.EqualTo(descriptor.descriptorHash));

            var unityDescriptor = new TeamForgeProjectDescriptor
            {
                schemaVersion = descriptor.descriptorSchemaVersion,
                projectUuid = descriptor.projectUuid,
                baselineRevision = descriptor.baselineRevision,
                manifestHash = descriptor.manifestHash,
                descriptorHash = descriptor.descriptorHash,
                unityVersion = descriptor.unityVersion,
                teamForgePackageVersion = descriptor.teamForgePackageVersion,
                realtimeProtocolVersion = descriptor.realtimeProtocolVersion,
                transferProtocolVersion = descriptor.transferProtocolVersion,
                manifestSchemaVersion = descriptor.manifestSchemaVersion,
            };
            Assert.That(
                TeamForgeProjectValidation.TryValidateDescriptor(unityDescriptor, out var descriptorError),
                Is.True,
                descriptorError);

            var invitation = new TeamForgeProjectInvitation
            {
                format = fixture.invite.format,
                serverAddress = fixture.invite.serverAddress,
                realtimePath = fixture.invite.realtimePath,
                projectId = fixture.invite.projectId,
                projectUuid = fixture.invite.projectUuid,
                sessionId = fixture.invite.sessionId,
                ownerKeyId = fixture.invite.ownerKeyId,
                ownerPublicKey = fixture.invite.ownerPublicKey,
                ownerSignature = fixture.invite.ownerSignature,
            };
            Assert.That(
                TeamForgeProjectValidation.TryValidateInvitation(invitation, out var invitationError),
                Is.True,
                invitationError);
        }

        [Test]
        public void CapabilityMatrixFreezesAllSixteenHelloOutcomesAndSnapshotOrders()
        {
            var fixture = LoadFixture();
            Assert.That(fixture.capabilityMatrix, Has.Length.EqualTo(16));

            foreach (var entry in fixture.capabilityMatrix)
            {
                var accepted = (!entry.transform || entry.presence) &&
                               (!entry.hierarchy || (entry.presence && entry.transform));
                Assert.That(accepted, Is.EqualTo(entry.accepted), entry.id);

                if (!accepted)
                {
                    CollectionAssert.AreEqual(new[] { "error:invalid_hello" }, entry.expectedMessages, entry.id);
                    var expectedError = entry.transform && !entry.presence
                        ? "Transform Sync requires Presence capability."
                        : "Hierarchy Sync requires Presence and Transform Sync capabilities.";
                    Assert.That(entry.errorDetail, Is.EqualTo(expectedError), entry.id);
                    continue;
                }

                var expected = new System.Collections.Generic.List<string> { "hello_ack" };
                if (entry.presence)
                {
                    expected.Add("presence_snapshot");
                }
                if (entry.hierarchy)
                {
                    expected.Add("hierarchy_snapshot");
                }
                if (entry.transform)
                {
                    expected.Add("transform_snapshot");
                }
                if (entry.project)
                {
                    expected.Add("project_registry_snapshot");
                }
                CollectionAssert.AreEqual(expected, entry.expectedMessages, entry.id);
            }
        }

        private static GoldenFixture LoadFixture()
        {
            var packageInfo = PackageInfo.FindForAssembly(typeof(TeamForgeProjectContract).Assembly);
            Assert.That(packageInfo, Is.Not.Null, "TeamForge package path could not be resolved.");
            var path = Path.Combine(
                packageInfo.resolvedPath,
                "Tests",
                "Fixtures",
                "teamforge-compatibility-v1.json");
            Assert.That(File.Exists(path), Is.True, path);
            var fixture = JsonUtility.FromJson<GoldenFixture>(File.ReadAllText(path, Encoding.UTF8));
            Assert.That(fixture, Is.Not.Null);
            return fixture;
        }

        private static string Sha256(string value)
        {
            using (var sha256 = SHA256.Create())
            {
                var bytes = sha256.ComputeHash(Encoding.UTF8.GetBytes(value));
                var builder = new StringBuilder(bytes.Length * 2);
                foreach (var item in bytes)
                {
                    builder.Append(item.ToString("x2"));
                }
                return builder.ToString();
            }
        }
    }
}

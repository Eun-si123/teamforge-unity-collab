using System;
using System.Linq;
using System.Reflection;
using System.Security.Cryptography;
using NUnit.Framework;

namespace EunSung.TeamForge.Tests
{
    public sealed class TeamForgeProjectProtocolTests
    {
        [Test]
        public void HelloCapabilityRoundTripsWithoutChangingRealtimeEnvelopeVersion()
        {
            var hello = new HelloMessage
            {
                type = "hello",
                protocolVersion = TeamForgeProtocol.Version,
                requestId = "hello-project",
                userName = "Editor A",
                projectId = "sample-project",
                sessionId = "sample-session",
                supportsPresence = true,
                supportsTransformSync = true,
                supportsProjectTransfer = true,
                userId = "editor-a",
                userColor = "#64B5F6",
            };

            var restored = TeamForgeProtocol.Deserialize<HelloMessage>(TeamForgeProtocol.Serialize(hello));

            Assert.That(TeamForgeProtocol.Version, Is.EqualTo(1));
            Assert.That(restored.supportsProjectTransfer, Is.True);
        }

        [Test]
        public void OlderHelloAckLeavesProjectTransferDisabled()
        {
            const string json =
                "{\"type\":\"hello_ack\",\"protocolVersion\":1,\"requestId\":\"hello\"," +
                "\"connectionId\":\"connection-a\",\"presenceEnabled\":true," +
                "\"transformSyncEnabled\":true}";

            var restored = TeamForgeProtocol.Deserialize<HelloAckMessage>(json);

            Assert.That(restored.presenceEnabled, Is.True);
            Assert.That(restored.transformSyncEnabled, Is.True);
            Assert.That(restored.projectTransferEnabled, Is.False);
        }

        [Test]
        public void ProjectRegistrySnapshotRoundTripsCoordinatorMetadata()
        {
            var baseline = TestProjectData.ValidBaseline();
            var peer = TestProjectData.ValidPeer(baseline, "connection-a", "editor-a", 0);
            var source = new ProjectRegistrySnapshotMessage
            {
                type = "project_registry_snapshot",
                protocolVersion = TeamForgeProtocol.Version,
                requestId = "hello-project",
                projectId = "sample-project",
                projectUuid = baseline.projectUuid,
                baseline = baseline,
                peers = new[] { peer },
                serverTimestampUnixMs = 1786000001000,
            };

            var json = TeamForgeProtocol.Serialize(source);
            var restored = TeamForgeProtocol.Deserialize<ProjectRegistrySnapshotMessage>(json);

            Assert.That(restored.projectId, Is.EqualTo("sample-project"));
            Assert.That(restored.baseline.baselineRevision, Is.EqualTo(3));
            Assert.That(restored.baseline.ownerPublicKey, Is.EqualTo(baseline.ownerPublicKey));
            Assert.That(restored.peers, Has.Length.EqualTo(1));
            Assert.That(restored.peers[0].ownerProofVerified, Is.True);
            Assert.That(restored.peers[0].transferToken, Is.EqualTo("ephemeral-peer-token"));
            Assert.That(restored.peers[0].seedRank, Is.EqualTo(0));
        }

        [Test]
        public void ProjectRegistryUuidInvariantAcceptsOnlyEmptyOrFullyUuidBoundSnapshots()
        {
            var method = typeof(TeamForgeProjectService).GetMethod(
                "TryValidateSnapshotProjectUuid",
                BindingFlags.Static | BindingFlags.NonPublic);
            Assert.That(method, Is.Not.Null);

            var empty = new ProjectRegistrySnapshotMessage
            {
                projectUuid = string.Empty,
                baseline = null,
                peers = Array.Empty<ProjectPeerRecord>(),
            };
            AssertSnapshotUuid(method, empty, true, string.Empty);

            var baseline = TestProjectData.ValidBaseline();
            var peer = TestProjectData.ValidPeer(baseline, "connection-a", "editor-a", 0);
            AssertSnapshotUuid(
                method,
                new ProjectRegistrySnapshotMessage
                {
                    projectUuid = string.Empty,
                    baseline = baseline,
                    peers = Array.Empty<ProjectPeerRecord>(),
                },
                false,
                "A non-empty Project registry requires a Project UUID.");
            AssertSnapshotUuid(
                method,
                new ProjectRegistrySnapshotMessage
                {
                    projectUuid = string.Empty,
                    baseline = null,
                    peers = new[] { peer },
                },
                false,
                "A non-empty Project registry requires a Project UUID.");
            AssertSnapshotUuid(
                method,
                new ProjectRegistrySnapshotMessage
                {
                    projectUuid = baseline.projectUuid,
                    baseline = baseline,
                    peers = new[] { peer },
                },
                true,
                string.Empty);

            var mismatchedBaseline = TestProjectData.ValidBaseline();
            mismatchedBaseline.projectUuid = "4f494d5a-8eb8-4d2d-9aa2-9f5f955a7b20";
            AssertSnapshotUuid(
                method,
                new ProjectRegistrySnapshotMessage
                {
                    projectUuid = baseline.projectUuid,
                    baseline = mismatchedBaseline,
                    peers = Array.Empty<ProjectPeerRecord>(),
                },
                false,
                "Project registry baseline UUID does not match its routing UUID.");

            var mismatchedPeer = TestProjectData.ValidPeer(baseline, "connection-b", "editor-b");
            mismatchedPeer.projectUuid = "4f494d5a-8eb8-4d2d-9aa2-9f5f955a7b20";
            AssertSnapshotUuid(
                method,
                new ProjectRegistrySnapshotMessage
                {
                    projectUuid = baseline.projectUuid,
                    baseline = baseline,
                    peers = new[] { mismatchedPeer },
                },
                false,
                "Project registry peer UUID does not match its routing UUID.");
        }

        [Test]
        public void ProjectRealtimeDtosHaveNoPayloadByteOrFilePathFields()
        {
            var protocolTypes = new[]
            {
                typeof(ProjectPeerAnnounceMessage),
                typeof(ProjectBaselinePublishMessage),
                typeof(ProjectRegistrySnapshotMessage),
                typeof(ProjectPeerChangedMessage),
                typeof(ProjectPeerLeftMessage),
                typeof(ProjectBaselineChangedMessage),
                typeof(ProjectSyncRequiredMessage),
                typeof(ProjectBaselineRecord),
                typeof(ProjectPeerRecord),
            };
            var prohibitedNames = new[]
            {
                "payload", "bytes", "chunkData", "chunks", "files", "filePath",
                "absolutePath", "projectRoot", "archive", "privateKey",
            };

            foreach (var type in protocolTypes)
            {
                foreach (var field in type.GetFields(BindingFlags.Public | BindingFlags.Instance))
                {
                    Assert.That(field.FieldType, Is.Not.EqualTo(typeof(byte[])), $"{type.Name}.{field.Name}");
                    Assert.That(
                        prohibitedNames.Contains(field.Name, StringComparer.OrdinalIgnoreCase),
                        Is.False,
                        $"{type.Name}.{field.Name}");
                }
            }
        }

        [Test]
        public void ProjectDescriptorTypeCannotPersistSecretsOrPaths()
        {
            var prohibitedFragments = new[] { "token", "private", "secret", "path", "root" };
            foreach (var field in typeof(TeamForgeProjectDescriptor).GetFields())
            {
                foreach (var fragment in prohibitedFragments)
                {
                    Assert.That(field.Name, Does.Not.Contain(fragment).IgnoreCase);
                }
            }
        }

        private static void AssertSnapshotUuid(
            MethodInfo method,
            ProjectRegistrySnapshotMessage snapshot,
            bool expected,
            string expectedError)
        {
            var arguments = new object[] { snapshot, null };
            var accepted = (bool)method.Invoke(null, arguments);
            Assert.That(accepted, Is.EqualTo(expected));
            Assert.That(arguments[1] as string, Is.EqualTo(expectedError));
        }
    }

    internal static class TestProjectData
    {
        internal const string ProjectUuid = "b3b67aa1-524b-4d69-b7f3-82448f45770c";
        internal static readonly string ManifestHash = new string('a', 64);
        internal static readonly string DescriptorHash = new string('b', 64);
        internal static readonly string PublicKey = CreatePublicKey();
        internal static readonly string OwnerKeyId = CreateKeyId(PublicKey);
        internal static readonly string Signature = Convert.ToBase64String(new byte[64]);

        internal static ProjectBaselineRecord ValidBaseline(long revision = 3)
        {
            return new ProjectBaselineRecord
            {
                projectUuid = ProjectUuid,
                baselineRevision = revision,
                manifestHash = ManifestHash,
                descriptorHash = DescriptorHash,
                unityVersion = "6000.3.21f1",
                teamForgePackageVersion = TeamForgeProjectContract.ProductVersion,
                realtimeProtocolVersion = TeamForgeProtocol.Version,
                transferProtocolVersion = TeamForgeProjectContract.TransferProtocolVersion,
                manifestSchemaVersion = TeamForgeProjectContract.ManifestSchemaVersion,
                ownerKeyId = OwnerKeyId,
                ownerPublicKey = PublicKey,
                publisherKeyId = OwnerKeyId,
                publisherPublicKey = PublicKey,
                publisherAuthorization = string.Empty,
                baselineSignature = Signature,
                publishedByUserId = "editor-a",
                publishedByConnectionId = "connection-a",
                publishedAtUnixMs = 1786000000000,
            };
        }

        private static string CreatePublicKey()
        {
            var bytes = new byte[44];
            var prefix = new byte[]
            {
                0x30, 0x2a, 0x30, 0x05, 0x06, 0x03,
                0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
            };
            Array.Copy(prefix, bytes, prefix.Length);
            for (var index = prefix.Length; index < bytes.Length; index += 1)
            {
                bytes[index] = (byte)index;
            }
            return Convert.ToBase64String(bytes);
        }

        private static string CreateKeyId(string publicKey)
        {
            using (var sha256 = SHA256.Create())
            {
                return BitConverter.ToString(sha256.ComputeHash(Convert.FromBase64String(publicKey)))
                    .Replace("-", string.Empty)
                    .ToLowerInvariant();
            }
        }

        internal static ProjectPeerRecord ValidPeer(
            ProjectBaselineRecord baseline,
            string connectionId,
            string userId,
            int seedRank = 1)
        {
            var owner = seedRank == 0;
            return new ProjectPeerRecord
            {
                userId = userId,
                connectionId = connectionId,
                userName = userId,
                projectUuid = baseline.projectUuid,
                baselineRevision = baseline.baselineRevision,
                manifestHash = baseline.manifestHash,
                descriptorHash = baseline.descriptorHash,
                completeBaseline = true,
                availableChunkCount = 3,
                totalChunkCount = 3,
                endpoint = "http://127.0.0.1:5091/teamforge-transfer/v1",
                transferToken = "ephemeral-peer-token",
                unityVersion = baseline.unityVersion,
                teamForgePackageVersion = baseline.teamForgePackageVersion,
                realtimeProtocolVersion = baseline.realtimeProtocolVersion,
                transferProtocolVersion = baseline.transferProtocolVersion,
                manifestSchemaVersion = baseline.manifestSchemaVersion,
                ownerKeyId = baseline.ownerKeyId,
                ownerPublicKey = baseline.ownerPublicKey,
                publisherKeyId = baseline.publisherKeyId,
                publisherPublicKey = baseline.publisherPublicKey,
                publisherAuthorization = baseline.publisherAuthorization,
                baselineSignature = baseline.baselineSignature,
                ownerProofSignature = owner ? Signature : string.Empty,
                ownerProofVerified = owner,
                descriptorVerified = true,
                seedRank = seedRank,
                announcedAtUnixMs = 1786000000000,
                lastUpdatedUnixMs = 1786000001000,
            };
        }
    }
}

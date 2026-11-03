using System;
using NUnit.Framework;
using UnityEngine;

namespace EunSung.TeamForge.Tests
{
    public sealed class TeamForgeUnityCompatibilityTests
    {
        [TestCase("6000.3.21f1")]
        [TestCase("6000.3.27f2")]
        [TestCase("6000.3.1a1")]
        [TestCase("6000.3.1b1")]
        [TestCase("6000.3.1p1")]
        public void ExistingLtsMetadataCompatibilityIsPreserved(string version)
        {
            Assert.That(TeamForgeProjectValidation.IsCompatibleUnityVersion(version), Is.True);
            Assert.That(TeamForgeProjectValidation.IsExperimentalUnityVersion(version), Is.False);
            Assert.That(TeamForgeProjectValidation.TryValidateDescriptor(Descriptor(version), out var error),
                Is.True, error);
            Assert.That(TeamForgeDoctor.CaptureUnityCompatibility(version).Level, Is.EqualTo(TeamForgeDoctorLevel.Pass));
        }

        [TestCase("6000.6.0f1")]
        [TestCase("6000.6.7f1")]
        public void StableSixSixMetadataIsExperimentalAndWarnsRatherThanPassingDoctor(string version)
        {
            Assert.That(TeamForgeProjectValidation.IsCompatibleUnityVersion(version), Is.True);
            Assert.That(TeamForgeProjectValidation.IsExperimentalUnityVersion(version), Is.True);
            Assert.That(TeamForgeProjectValidation.TryValidateDescriptor(Descriptor(version), out var error),
                Is.True, error);
            var report = TeamForgeDoctor.CaptureUnityCompatibility(version);
            Assert.That(report.Level, Is.EqualTo(TeamForgeDoctorLevel.Warning));
            Assert.That(report.Message, Does.Contain("experimental Unity 6000.6"));
        }

        [TestCase(null)]
        [TestCase("")]
        [TestCase("6000.6.7a1")]
        [TestCase("6000.6.7b1")]
        [TestCase("6000.6.7p1")]
        [TestCase("6000.6.7f1c1")]
        [TestCase("6000.6.7F1")]
        [TestCase("6000.0.85f1")]
        [TestCase("6000.4.1f1")]
        [TestCase("6000.5.1f1")]
        [TestCase("6000.7.1f1")]
        [TestCase("6000.60.7f1")]
        [TestCase("2022.3.62f3")]
        [TestCase("2023.2.1f1")]
        [TestCase("7000.0.1f1")]
        [TestCase("6000.6.7f1 ")]
        [TestCase(" 6000.6.7f1")]
        [TestCase("6000.6.7f1\n")]
        [TestCase("6000.3.21f1\n")]
        [TestCase("6000.6.7f1\r")]
        [TestCase("6000.6.7f1\0")]
        [TestCase("6000.6.٧f1")]
        [TestCase("6000.6.7f١")]
        [TestCase("6000.6.7f1-extra")]
        [TestCase("6000.6.7f1/../")]
        public void OtherVersionsFailClosedWithoutInventingFutureCompatibility(string version)
        {
            Assert.That(TeamForgeProjectValidation.IsCompatibleUnityVersion(version), Is.False);
            Assert.That(TeamForgeProjectValidation.IsExperimentalUnityVersion(version), Is.False);
            Assert.That(TeamForgeProjectValidation.TryValidateDescriptor(Descriptor(version), out _), Is.False);
            Assert.That(TeamForgeDoctor.CaptureUnityCompatibility(version).Level, Is.EqualTo(TeamForgeDoctorLevel.Warning));
        }

        [Test]
        public void VersionGrammarIsBoundedWithoutTruncationOrNormalization()
        {
            var boundary = "6000.6." + new string('9', 55) + "f1";
            Assert.That(boundary.Length, Is.EqualTo(64));
            // A synthetic grammar boundary is not a tested or released Editor.
            Assert.That(TeamForgeProjectValidation.IsCompatibleUnityVersion(boundary), Is.True);
            Assert.That(TeamForgeProjectValidation.IsExperimentalUnityVersion(boundary), Is.True);
            Assert.That(TeamForgeProjectValidation.IsCompatibleUnityVersion(boundary + "1"), Is.False);
            Assert.That(TeamForgeProjectValidation.IsExperimentalUnityVersion(boundary + "1"), Is.False);
        }

        [Test]
        public void ExperimentalDescriptorRetainsItsExactVersionAndIdentityHashes()
        {
            var descriptor = Descriptor("6000.6.7f1");
            descriptor.baselineRevision = 1;
            descriptor.manifestHash = new string('a', 64);
            descriptor.descriptorHash = new string('b', 64);

            Assert.That(TeamForgeProjectValidation.TryValidateDescriptor(descriptor, out var error), Is.True, error);
            Assert.That(descriptor.unityVersion, Is.EqualTo("6000.6.7f1"));
            Assert.That(descriptor.manifestHash, Is.EqualTo(new string('a', 64)));
            Assert.That(descriptor.descriptorHash, Is.EqualTo(new string('b', 64)));
            Assert.That(descriptor.projectUuid, Is.EqualTo("f388a2d5-41dc-47fa-a3f4-b6f4b22953b3"));
        }

        [Test]
        public void ActualRunningEditorIsClassifiedByTheSameProjectAndDoctorPolicy()
        {
            var version = Application.unityVersion;
            Assert.That(TeamForgeProjectValidation.IsCompatibleUnityVersion(version), Is.True,
                "This Editor is outside the explicit TeamForge source compatibility lines.");
            var experimental = version.StartsWith("6000.6.", StringComparison.Ordinal);
            Assert.That(TeamForgeProjectValidation.IsExperimentalUnityVersion(version), Is.EqualTo(experimental));
            Assert.That(TeamForgeDoctor.CaptureUnityCompatibility(version).Level,
                Is.EqualTo(experimental ? TeamForgeDoctorLevel.Warning : TeamForgeDoctorLevel.Pass));
        }

        private static TeamForgeProjectDescriptor Descriptor(string version)
        {
            return new TeamForgeProjectDescriptor
            {
                schemaVersion = TeamForgeProjectContract.DescriptorSchemaVersion,
                projectUuid = "f388a2d5-41dc-47fa-a3f4-b6f4b22953b3",
                unityVersion = version,
                teamForgePackageVersion = TeamForgeProjectContract.ProductVersion,
                realtimeProtocolVersion = TeamForgeProtocol.Version,
                transferProtocolVersion = TeamForgeProjectContract.TransferProtocolVersion,
                manifestSchemaVersion = TeamForgeProjectContract.ManifestSchemaVersion,
                baselineRevision = 0,
                manifestHash = string.Empty,
                descriptorHash = string.Empty,
            };
        }
    }
}

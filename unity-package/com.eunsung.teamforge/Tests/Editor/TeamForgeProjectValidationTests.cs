using System;
using NUnit.Framework;

namespace EunSung.TeamForge.Tests
{
    public sealed class TeamForgeProjectValidationTests
    {
        [Test]
        public void UnpublishedDescriptorAcceptsOnlySafeCanonicalMetadata()
        {
            var descriptor = ValidDescriptor();

            Assert.That(
                TeamForgeProjectValidation.TryValidateDescriptor(descriptor, out var error),
                Is.True,
                error);

            descriptor.projectUuid = descriptor.projectUuid.ToUpperInvariant();
            Assert.That(
                TeamForgeProjectValidation.TryValidateDescriptor(descriptor, out error),
                Is.False);
            Assert.That(error, Does.Contain("lowercase"));
        }

        [Test]
        public void PublishedDescriptorRequiresLowercaseHashesAndCompatibleVersions()
        {
            var descriptor = ValidDescriptor();
            descriptor.baselineRevision = 1;
            descriptor.manifestHash = new string('a', 64);
            descriptor.descriptorHash = new string('b', 64);

            Assert.That(
                TeamForgeProjectValidation.TryValidateDescriptor(descriptor, out var error),
                Is.True,
                error);

            descriptor.manifestHash = new string('A', 64);
            Assert.That(
                TeamForgeProjectValidation.TryValidateDescriptor(descriptor, out error),
                Is.False);
            descriptor.manifestHash = new string('a', 64);
            descriptor.unityVersion = "../../Unity";
            Assert.That(
                TeamForgeProjectValidation.TryValidateDescriptor(descriptor, out error),
                Is.False);
        }

        [TestCase("/absolute/path")]
        [TestCase("C:/project")]
        [TestCase("Assets/../Secret")]
        [TestCase("Assets\\Secret")]
        [TestCase("Assets//Cube.prefab")]
        public void RelativeProjectPathRejectsAbsoluteAndTraversalForms(string path)
        {
            Assert.That(
                TeamForgeProjectValidation.TryValidateRelativeProjectPath(path, false, out _),
                Is.False);
        }

        [Test]
        public void RelativeProjectPathAcceptsPortableNormalizedPathAndExplicitRootOnly()
        {
            Assert.That(
                TeamForgeProjectValidation.TryValidateRelativeProjectPath(
                    "ProjectSettings/TeamForgeProject.json",
                    false,
                    out var error),
                Is.True,
                error);
            Assert.That(
                TeamForgeProjectValidation.TryValidateRelativeProjectPath(".", true, out error),
                Is.True,
                error);
            Assert.That(
                TeamForgeProjectValidation.TryValidateRelativeProjectPath(".", false, out _),
                Is.False);
        }

        [Test]
        public void DownloadLaunchSettingsCannotNameCurrentProjectAsSource()
        {
            var settings = ValidLaunchSettings();
            settings.allowCurrentProjectAsSeedSource = false;
            settings.sourceProjectRelativePath = ".";
            settings.projectDescriptorRelativePath = TeamForgeProjectContract.DescriptorRelativePath;

            Assert.That(
                TeamForgeProjectValidation.TryValidateLaunchSettings(settings, out var error),
                Is.False);
            Assert.That(error, Does.Contain("Download-only"));

            settings.sourceProjectRelativePath = string.Empty;
            settings.projectDescriptorRelativePath = string.Empty;
            Assert.That(
                TeamForgeProjectValidation.TryValidateLaunchSettings(settings, out error),
                Is.True,
                error);
        }

        [Test]
        public void SeedLaunchSettingsUseOnlyPortableRelativePathsAndEnvironmentVariableNames()
        {
            var settings = ValidLaunchSettings();

            Assert.That(
                TeamForgeProjectValidation.TryValidateLaunchSettings(settings, out var error),
                Is.True,
                error);
            var json = TeamForgeProtocol.Serialize(settings);
            Assert.That(settings.sourceProjectRelativePath, Is.EqualTo("."));
            Assert.That(settings.projectDescriptorRelativePath, Does.Not.StartWith("/"));
            Assert.That(json, Does.Not.Contain("secret-token"));
            Assert.That(json, Does.Contain("TEAMFORGE_AUTH_TOKEN"));
        }

        [Test]
        public void ProjectPeerInviteShapeMatchesSidecarAndChecksOwnerKeyFingerprint()
        {
            var invitation = ValidInvitation();

            Assert.That(
                TeamForgeProjectValidation.TryValidateInvitation(invitation, out var error),
                Is.True,
                error);

            invitation.ownerKeyId = new string('f', 64);
            Assert.That(
                TeamForgeProjectValidation.TryValidateInvitation(invitation, out error),
                Is.False);
            Assert.That(error, Does.Contain("does not match"));
        }

        [Test]
        public void ProjectPeerInviteRejectsWrongFormatAndMalformedSignature()
        {
            var invitation = ValidInvitation();
            invitation.format = "teamforge-project-invite-v2";
            Assert.That(
                TeamForgeProjectValidation.TryValidateInvitation(invitation, out _),
                Is.False);

            invitation = ValidInvitation();
            invitation.ownerSignature = Convert.ToBase64String(new byte[63]);
            Assert.That(
                TeamForgeProjectValidation.TryValidateInvitation(invitation, out _),
                Is.False);
        }

        [Test]
        public void InvitationParserAcceptsSidecarShapeButRejectsEmbeddedSecrets()
        {
            var json = TeamForgeProtocol.Serialize(ValidInvitation());
            Assert.That(
                TeamForgeProjectService.TryParseInvitation(json, out var invitation, out var error),
                Is.True,
                error);
            Assert.That(invitation.format, Is.EqualTo("teamforge-project-invite-v1"));

            var withToken = json.TrimEnd('}') + ",\"authenticationToken\":\"secret\"}";
            Assert.That(
                TeamForgeProjectService.TryParseInvitation(withToken, out _, out error),
                Is.False);
            Assert.That(error, Does.Contain("unknown"));
        }

        [Test]
        public void ApplyingInvitationPolicyClearsBearerAndAssemblyReloadResumeIntent()
        {
            var settings = TeamForgeConnectionSettings.instance;
            var previousServerAddress = settings.ServerAddress;
            var previousRealtimePath = settings.RealtimePath;
            var previousProjectId = settings.ProjectId;
            var previousSessionId = settings.SessionId;
            var previousAuthenticationToken = settings.AuthenticationToken;
            var previousResumeAfterAssemblyReload = settings.ResumeAfterAssemblyReload;

            try
            {
                settings.ServerAddress = "https://old.example.com";
                settings.AuthenticationToken = "old-server-bearer";
                settings.ResumeAfterAssemblyReload = true;
                var invitation = ValidInvitation();

                TeamForgeProjectInvitationPolicy.ApplyConnectionFields(invitation, settings);

                Assert.That(settings.ServerAddress, Is.EqualTo(invitation.serverAddress));
                Assert.That(settings.ProjectId, Is.EqualTo(invitation.projectId));
                Assert.That(settings.AuthenticationToken, Is.Empty);
                Assert.That(settings.ResumeAfterAssemblyReload, Is.False);
            }
            finally
            {
                settings.ServerAddress = previousServerAddress;
                settings.RealtimePath = previousRealtimePath;
                settings.ProjectId = previousProjectId;
                settings.SessionId = previousSessionId;
                settings.AuthenticationToken = previousAuthenticationToken;
                settings.ResumeAfterAssemblyReload = previousResumeAfterAssemblyReload;
            }
        }

        [Test]
        public void InvitationPolicyAllowsOnlyFullyStoppedConnectionStates()
        {
            Assert.That(
                TeamForgeProjectInvitationPolicy.CanApplyConnectionState(
                    false,
                    TeamForgeConnectionState.Disconnected),
                Is.True);
            Assert.That(
                TeamForgeProjectInvitationPolicy.CanApplyConnectionState(
                    false,
                    TeamForgeConnectionState.Faulted),
                Is.True);
            Assert.That(
                TeamForgeProjectInvitationPolicy.CanApplyConnectionState(
                    true,
                    TeamForgeConnectionState.Disconnected),
                Is.False);
            Assert.That(
                TeamForgeProjectInvitationPolicy.CanApplyConnectionState(
                    false,
                    TeamForgeConnectionState.Reconnecting),
                Is.False);
            Assert.That(
                TeamForgeProjectInvitationPolicy.CanApplyConnectionState(
                    false,
                    TeamForgeConnectionState.Connecting),
                Is.False);
            Assert.That(
                TeamForgeProjectInvitationPolicy.CanApplyConnectionState(
                    false,
                    TeamForgeConnectionState.Handshaking),
                Is.False);
            Assert.That(
                TeamForgeProjectInvitationPolicy.CanApplyConnectionState(
                    false,
                    TeamForgeConnectionState.Connected),
                Is.False);
            Assert.That(
                TeamForgeProjectInvitationPolicy.CanApplyConnectionState(
                    false,
                    TeamForgeConnectionState.Disconnecting),
                Is.False);
        }

        private static TeamForgeProjectDescriptor ValidDescriptor()
        {
            return new TeamForgeProjectDescriptor
            {
                projectUuid = TestProjectData.ProjectUuid,
                baselineRevision = 0,
                manifestHash = string.Empty,
                descriptorHash = string.Empty,
                unityVersion = "6000.3.21f1",
            };
        }

        private static TeamForgeProjectPeerLaunchSettings ValidLaunchSettings()
        {
            return new TeamForgeProjectPeerLaunchSettings
            {
                serverAddress = "https://teamforge.example.com/base",
                realtimePath = "ws",
                projectId = "sample-project",
                sessionId = "sample-session",
                projectUuid = TestProjectData.ProjectUuid,
                sourceProjectRelativePath = ".",
                projectDescriptorRelativePath = TeamForgeProjectContract.DescriptorRelativePath,
                managedProjectsRelativePath = TeamForgeProjectContract.ManagedProjectsRelativePath,
                allowCurrentProjectAsSeedSource = true,
            };
        }

        private static TeamForgeProjectInvitation ValidInvitation()
        {
            return new TeamForgeProjectInvitation
            {
                format = "teamforge-project-invite-v1",
                serverAddress = "https://teamforge.example.com/base",
                realtimePath = "ws",
                projectId = "sample-project",
                projectUuid = TestProjectData.ProjectUuid,
                sessionId = "sample-session",
                ownerKeyId = TestProjectData.OwnerKeyId,
                ownerPublicKey = TestProjectData.PublicKey,
                ownerSignature = TestProjectData.Signature,
            };
        }
    }
}

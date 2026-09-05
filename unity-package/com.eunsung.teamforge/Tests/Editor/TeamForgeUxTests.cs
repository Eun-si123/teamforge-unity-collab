using System;
using System.IO;
using System.Text;
using NUnit.Framework;
using UnityEngine;

namespace EunSung.TeamForge.Tests
{
    public sealed class TeamForgeUxTests
    {
        [Test]
        public void JoinCodeRoundTripsSessionWithoutAuthenticationSecret()
        {
            var settings = TeamForgeConnectionSettings.instance;
            settings.EnsureDefaults();
            var oldServer = settings.ServerAddress;
            var oldPath = settings.RealtimePath;
            var oldName = settings.UserName;
            var oldProject = settings.ProjectId;
            var oldSession = settings.SessionId;
            var oldToken = settings.AuthenticationToken;
            try
            {
                settings.ServerAddress = "http://127.0.0.1:5080";
                settings.RealtimePath = "ws";
                settings.UserName = "UX Test";
                settings.ProjectId = "project-ux-test";
                settings.SessionId = "session-ux-test";
                settings.AuthenticationToken = "must-not-leak";

                var descriptor = TeamForgeProjectService.Descriptor;
                TeamForgeInviteCache.Store(
                    settings.SessionId,
                    descriptor?.projectUuid ?? string.Empty,
                    new TeamForgeSceneBaseline
                    {
                        scenePath = "Assets/Scenes/SampleScene.unity",
                        sceneGuid = "0123456789abcdef0123456789abcdef",
                        sha256 = new string('a', 64),
                    },
                    "2026-08-09T00:00:00.0000000Z");

                Assert.That(TeamForgeJoinCode.TryCreate(out var code, out var createError), Is.True, createError);
                Assert.That(code, Does.StartWith(TeamForgeJoinCode.Prefix));
                Assert.That(code, Does.Not.Contain("must-not-leak"));
                Assert.That(TeamForgeJoinCode.TryParse(code, out var payload, out var parseError), Is.True, parseError);
                Assert.That(payload.serverAddress, Is.EqualTo("http://127.0.0.1:5080"));
                Assert.That(payload.projectId, Is.EqualTo("project-ux-test"));
                Assert.That(payload.sessionId, Is.EqualTo("session-ux-test"));
                Assert.That(payload.hostDisplayName, Is.EqualTo("UX Test"));
                Assert.That(payload.sceneBaseline.scenePath, Is.EqualTo("Assets/Scenes/SampleScene.unity"));
                Assert.That(payload.sceneBaseline.sha256, Has.Length.EqualTo(64));
            }
            finally
            {
                settings.ServerAddress = oldServer;
                settings.RealtimePath = oldPath;
                settings.UserName = oldName;
                settings.ProjectId = oldProject;
                settings.SessionId = oldSession;
                settings.AuthenticationToken = oldToken;
            }
        }

        [Test]
        public void JoinCodeRejectsMalformedPayload()
        {
            Assert.That(
                TeamForgeJoinCode.TryParse("TF1.not-base64!", out var payload, out var error),
                Is.False);
            Assert.That(payload, Is.Null);
            Assert.That(error, Is.Not.Empty);
        }

        [Test]
        public void JoinCodeRejectsDifferentProductVersion()
        {
            var payload = new TeamForgeJoinCodePayload
            {
                serverAddress = "http://127.0.0.1:5080",
                realtimePath = "ws",
                projectId = "project-a",
                sessionId = "session-a",
                projectUuid = string.Empty,
                productVersion = "9.9.9",
            };
            var json = JsonUtility.ToJson(payload, false);
            var encoded = Convert.ToBase64String(Encoding.UTF8.GetBytes(json))
                .TrimEnd('=')
                .Replace('+', '-')
                .Replace('/', '_');

            Assert.That(
                TeamForgeJoinCode.TryParse(TeamForgeJoinCode.Prefix + encoded, out var restored, out var error),
                Is.False);
            Assert.That(restored, Is.Null);
            Assert.That(error, Does.Contain("targets TeamForge"));
        }

        [Test]
        public void JoinCodeRejectsMalformedSceneFingerprint()
        {
            var payload = new TeamForgeJoinCodePayload
            {
                serverAddress = "http://127.0.0.1:5080",
                realtimePath = "ws",
                projectId = "project-a",
                sessionId = "session-a",
                projectUuid = string.Empty,
                productVersion = TeamForgeProjectContract.ProductVersion,
                sceneBaseline = new TeamForgeSceneBaseline
                {
                    scenePath = "Assets/SampleScene.unity",
                    sceneGuid = "0123456789abcdef0123456789abcdef",
                    sha256 = new string('z', 64),
                },
            };
            var json = JsonUtility.ToJson(payload, false);
            var encoded = Convert.ToBase64String(Encoding.UTF8.GetBytes(json))
                .TrimEnd('=')
                .Replace('+', '-')
                .Replace('/', '_');

            Assert.That(
                TeamForgeJoinCode.TryParse(TeamForgeJoinCode.Prefix + encoded, out _, out var error),
                Is.False);
            Assert.That(error, Does.Contain("Scene baseline"));
        }

        [Test]
        public void JoinProjectCompatibilitySeparatesMatchingMissingAndDifferentIdentities()
        {
            var payload = new TeamForgeJoinCodePayload
            {
                projectUuid = TestProjectData.ProjectUuid,
            };
            var matching = new TeamForgeProjectDescriptor
            {
                projectUuid = TestProjectData.ProjectUuid,
            };
            var different = new TeamForgeProjectDescriptor
            {
                projectUuid = "4f494d5a-8eb8-4d2d-9aa2-9f5f955a7b20",
            };

            Assert.That(
                TeamForgeJoinCode.EvaluateProjectCompatibility(payload, matching),
                Is.EqualTo(TeamForgeJoinProjectCompatibility.Compatible));
            Assert.That(
                TeamForgeJoinCode.EvaluateProjectCompatibility(payload, null),
                Is.EqualTo(TeamForgeJoinProjectCompatibility.LocalProjectIdentityMissing));
            Assert.That(
                TeamForgeJoinCode.EvaluateProjectCompatibility(payload, different),
                Is.EqualTo(TeamForgeJoinProjectCompatibility.ProjectIdentityMismatch));

            payload.projectUuid = string.Empty;
            Assert.That(
                TeamForgeJoinCode.EvaluateProjectCompatibility(payload, null),
                Is.EqualTo(TeamForgeJoinProjectCompatibility.Compatible));
        }

        [Test]
        public void JoinProjectLocatorAcceptsOnlyMatchingUnityProjectIdentity()
        {
            var root = Path.Combine(Path.GetTempPath(), "teamforge-join-locator-" + Guid.NewGuid().ToString("N"));
            try
            {
                Directory.CreateDirectory(Path.Combine(root, "Assets"));
                Directory.CreateDirectory(Path.Combine(root, "Packages"));
                Directory.CreateDirectory(Path.Combine(root, "ProjectSettings"));
                File.WriteAllText(Path.Combine(root, "Packages", "manifest.json"), "{}");
                File.WriteAllText(Path.Combine(root, "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersion: 6000.3.21f1");

                var descriptor = new TeamForgeProjectDescriptor
                {
                    schemaVersion = TeamForgeProjectContract.DescriptorSchemaVersion,
                    projectUuid = TestProjectData.ProjectUuid,
                    baselineRevision = 1,
                    manifestHash = TestProjectData.ManifestHash,
                    descriptorHash = TestProjectData.DescriptorHash,
                    unityVersion = "6000.3.21f1",
                    teamForgePackageVersion = TeamForgeProjectContract.ProductVersion,
                    realtimeProtocolVersion = TeamForgeProtocol.Version,
                    transferProtocolVersion = TeamForgeProjectContract.TransferProtocolVersion,
                    manifestSchemaVersion = TeamForgeProjectContract.ManifestSchemaVersion,
                };
                File.WriteAllText(
                    Path.Combine(root, "ProjectSettings", "TeamForgeProject.json"),
                    JsonUtility.ToJson(descriptor, true));

                Assert.That(
                    TeamForgeJoinProjectLocator.TryValidateMatchingProjectFolder(
                        root,
                        TestProjectData.ProjectUuid,
                        out var restored,
                        out var matchingError),
                    Is.True,
                    matchingError);
                Assert.That(restored.projectUuid, Is.EqualTo(TestProjectData.ProjectUuid));

                Assert.That(
                    TeamForgeJoinProjectLocator.TryValidateMatchingProjectFolder(
                        root,
                        "4f494d5a-8eb8-4d2d-9aa2-9f5f955a7b20",
                        out _,
                        out var mismatchError),
                    Is.False);
                Assert.That(mismatchError, Does.Contain("different TeamForge Project"));
            }
            finally
            {
                if (Directory.Exists(root)) Directory.Delete(root, true);
            }
        }

        [Test]
        public void JoinProjectLocatorRejectsFolderWithoutHostProjectDescriptor()
        {
            var root = Path.Combine(Path.GetTempPath(), "teamforge-join-locator-empty-" + Guid.NewGuid().ToString("N"));
            try
            {
                Directory.CreateDirectory(Path.Combine(root, "Assets"));
                Directory.CreateDirectory(Path.Combine(root, "Packages"));
                Directory.CreateDirectory(Path.Combine(root, "ProjectSettings"));
                File.WriteAllText(Path.Combine(root, "Packages", "manifest.json"), "{}");
                File.WriteAllText(Path.Combine(root, "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersion: 6000.3.21f1");

                Assert.That(
                    TeamForgeJoinProjectLocator.TryValidateMatchingProjectFolder(
                        root,
                        TestProjectData.ProjectUuid,
                        out _,
                        out var error),
                    Is.False);
                Assert.That(error, Does.Contain("no TeamForge Project identity"));
            }
            finally
            {
                if (Directory.Exists(root)) Directory.Delete(root, true);
            }
        }

        [Test]
        public void BaselineFingerprintHashIsStableAndSha256Sized()
        {
            var first = TeamForgeBaselineFingerprint.HashBytes(Encoding.UTF8.GetBytes("teamforge-baseline"));
            var second = TeamForgeBaselineFingerprint.HashBytes(Encoding.UTF8.GetBytes("teamforge-baseline"));
            var changed = TeamForgeBaselineFingerprint.HashBytes(Encoding.UTF8.GetBytes("teamforge-baseline-2"));

            Assert.That(first, Has.Length.EqualTo(64));
            Assert.That(first, Is.EqualTo(second));
            Assert.That(first, Is.Not.EqualTo(changed));
        }

        [TestCase("Library")]
        [TestCase("Temp")]
        [TestCase("Logs")]
        [TestCase("UserSettings")]
        [TestCase(".git")]
        public void TestLabExcludesGeneratedAndIdentityLocalDirectories(string name)
        {
            Assert.That(TeamForgeTestLab.IsExcludedDirectoryName(name), Is.True);
        }

        [Test]
        public void TestLabRejectsCloneInsideSource()
        {
            var source = Path.Combine(Path.GetTempPath(), "teamforge-source");
            var inside = Path.Combine(source, "clone");
            Assert.That(
                TeamForgeTestLab.TryValidateCloneTarget(source, inside, out var error),
                Is.False);
            Assert.That(error, Does.Contain("inside"));
        }

        [Test]
        public void GenericServerEnvironmentTokenIsNotConsumedByUnityClientSettings()
        {
            var settings = TeamForgeConnectionSettings.instance;
            var oldStored = settings.AuthenticationToken;
            var oldGeneric = Environment.GetEnvironmentVariable("TEAMFORGE_AUTH_TOKEN");
            var oldLab = Environment.GetEnvironmentVariable("TEAMFORGE_TESTLAB");
            var oldLabToken = Environment.GetEnvironmentVariable("TEAMFORGE_TESTLAB_AUTH_TOKEN");
            try
            {
                settings.AuthenticationToken = string.Empty;
                TeamForgeConnectionSettings.ClearGuestTransientAuthenticationToken();
                Environment.SetEnvironmentVariable("TEAMFORGE_AUTH_TOKEN", "server-process-secret");
                Environment.SetEnvironmentVariable("TEAMFORGE_TESTLAB", null);
                Environment.SetEnvironmentVariable("TEAMFORGE_TESTLAB_AUTH_TOKEN", null);
                Assert.That(settings.EffectiveAuthenticationToken, Is.Empty);

                Environment.SetEnvironmentVariable("TEAMFORGE_TESTLAB", "1");
                Environment.SetEnvironmentVariable("TEAMFORGE_TESTLAB_AUTH_TOKEN", "test-lab-secret");
                Assert.That(settings.EffectiveAuthenticationToken, Is.EqualTo("test-lab-secret"));
            }
            finally
            {
                TeamForgeConnectionSettings.ClearGuestTransientAuthenticationToken();
                settings.AuthenticationToken = oldStored;
                Environment.SetEnvironmentVariable("TEAMFORGE_AUTH_TOKEN", oldGeneric);
                Environment.SetEnvironmentVariable("TEAMFORGE_TESTLAB", oldLab);
                Environment.SetEnvironmentVariable("TEAMFORGE_TESTLAB_AUTH_TOKEN", oldLabToken);
            }
        }

        [Test]
        public void GuestLauncherCredentialUsesOnlyTheNonserializedInMemorySeam()
        {
            var settings = TeamForgeConnectionSettings.instance;
            var previous = settings.AuthenticationToken;
            try
            {
                settings.AuthenticationToken = string.Empty;
                TeamForgeConnectionSettings.ClearGuestTransientAuthenticationToken();

                Assert.That(
                    TeamForgeConnectionSettings.TrySetGuestTransientAuthenticationToken(
                        "guest-memory-only-secret",
                        out var error),
                    Is.True,
                    error);
                Assert.That(settings.AuthenticationToken, Is.Empty);
                Assert.That(settings.EffectiveAuthenticationToken, Is.EqualTo("guest-memory-only-secret"));

                settings.AuthenticationToken = "explicit-user-secret";
                Assert.That(settings.EffectiveAuthenticationToken, Is.EqualTo("explicit-user-secret"));

                settings.AuthenticationToken = string.Empty;
                Assert.That(
                    TeamForgeConnectionSettings.TrySetGuestTransientAuthenticationToken("bad\nsecret", out error),
                    Is.False);
                Assert.That(settings.EffectiveAuthenticationToken, Is.Empty);

                var transientField = typeof(TeamForgeConnectionSettings).GetField(
                    "_guestTransientAuthenticationToken",
                    System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.NonPublic);
                Assert.That(transientField, Is.Not.Null);
                Assert.That(
                    transientField.GetCustomAttributes(typeof(NonSerializedAttribute), false),
                    Is.Not.Empty);
            }
            finally
            {
                TeamForgeConnectionSettings.ClearGuestTransientAuthenticationToken();
                settings.AuthenticationToken = previous;
            }
        }

        [Test]
        public void TestLabCanKeepLastCloneOfflineForLateJoin()
        {
            Assert.That(TeamForgeTestLab.ShouldAutoConnectClone(0, 2, true, true), Is.True);
            Assert.That(TeamForgeTestLab.ShouldAutoConnectClone(1, 2, true, true), Is.False);
            Assert.That(TeamForgeTestLab.ShouldAutoConnectClone(1, 2, true, false), Is.True);
            Assert.That(TeamForgeTestLab.ShouldAutoConnectClone(0, 2, false, false), Is.False);
        }


        [Test]
        public void TestLabBootstrapSchemaCarriesExactHostSceneBaseline()
        {
            var bootstrapType = typeof(TeamForgeTestLab).Assembly.GetType(
                "EunSung.TeamForge.TeamForgeCloneBootstrapData",
                true);
            var baselineField = bootstrapType.GetField("sceneBaseline");
            Assert.That(baselineField, Is.Not.Null);

            var bootstrap = Activator.CreateInstance(bootstrapType);
            baselineField.SetValue(bootstrap, new TeamForgeSceneBaseline
            {
                scenePath = "Assets/Scenes/SampleScene.unity",
                sceneGuid = "0123456789abcdef0123456789abcdef",
                sha256 = new string('b', 64),
            });

            var json = JsonUtility.ToJson(bootstrap);
            Assert.That(json, Does.Contain("Assets/Scenes/SampleScene.unity"));
            Assert.That(json, Does.Contain("0123456789abcdef0123456789abcdef"));
            Assert.That(json, Does.Contain(new string('b', 64)));
        }

        [Test]
        public void ProductionGuestHandoffSchemaIsSeparateBoundedAndSecretFree()
        {
            var assembly = typeof(TeamForgeHostFlow).Assembly;
            var handoffType = assembly.GetType("EunSung.TeamForge.TeamForgeGuestHandoffData", true);
            var productionType = assembly.GetType("EunSung.TeamForge.TeamForgeGuestHandoff", true);
            var bootstrap = Activator.CreateInstance(handoffType);
            handoffType.GetField("schemaVersion").SetValue(bootstrap, 1);
            handoffType.GetField("projectUuid").SetValue(bootstrap, TestProjectData.ProjectUuid);
            handoffType.GetField("baselineRevision").SetValue(bootstrap, 3L);
            handoffType.GetField("manifestHash").SetValue(bootstrap, TestProjectData.ManifestHash);
            handoffType.GetField("descriptorHash").SetValue(bootstrap, TestProjectData.DescriptorHash);
            handoffType.GetField("ownerKeyId").SetValue(bootstrap, new string('c', 64));
            handoffType.GetField("publisherKeyId").SetValue(bootstrap, new string('d', 64));
            handoffType.GetField("activeProjectPath").SetValue(bootstrap, "C:\\TeamForge Projects\\active");
            handoffType.GetField("sessionJoinCode").SetValue(bootstrap, "TF1.verified-session");
            handoffType.GetField("createdAtUnixMs").SetValue(bootstrap, 1786642800000L);

            var json = JsonUtility.ToJson(bootstrap);
            Assert.That(handoffType.GetFields().Length, Is.EqualTo(10));
            Assert.That(json, Does.Contain(TestProjectData.ProjectUuid));
            Assert.That(json, Does.Contain("TF1.verified-session"));
            Assert.That(json, Does.Not.Contain("authenticationToken"));
            Assert.That(json, Does.Not.Contain("privateKey"));

            const System.Reflection.BindingFlags flags =
                System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.NonPublic;
            Assert.That(
                productionType.GetField("PathEnvironmentVariable", flags)?.GetRawConstantValue(),
                Is.EqualTo("TEAMFORGE_GUEST_HANDOFF_PATH"));
            Assert.That(
                productionType.GetField("HashEnvironmentVariable", flags)?.GetRawConstantValue(),
                Is.EqualTo("TEAMFORGE_GUEST_HANDOFF_SHA256"));
            Assert.That(
                productionType.GetField("AuthenticationEnvironmentVariable", flags)?.GetRawConstantValue(),
                Is.EqualTo("TEAMFORGE_GUEST_AUTHENTICATION_TOKEN"));
            Assert.That(handoffType.Name, Is.Not.EqualTo("TeamForgeCloneBootstrapData"));
        }

        [Test]
        public void QuickStartCreatesHumanReadableUniqueSessionIds()
        {
            var first = TeamForgeQuickStartUtility.NewSessionId();
            var second = TeamForgeQuickStartUtility.NewSessionId();
            Assert.That(first, Does.StartWith("session-"));
            Assert.That(second, Does.StartWith("session-"));
            Assert.That(first, Is.Not.EqualTo(second));
            Assert.That(first.Length, Is.LessThanOrEqualTo(128));
        }

        [Test]
        public void FriendlyErrorsHideKnownProtocolNoiseBehindUserAction()
        {
            Assert.That(
                TeamForgeQuickStartUtility.FriendlyConnectionError(
                    "Saved baseline object GlobalObjectId xyz is missing locally"),
                Does.Contain("same saved Scene baseline"));
            Assert.That(
                TeamForgeQuickStartUtility.FriendlyConnectionError(
                    "A non-empty Project registry requires a Project UUID."),
                Does.Contain("Project transfer metadata"));
        }

        [Test]
        public void DoctorSummarySeparatesProblemsFromWarnings()
        {
            var results = new[]
            {
                new TeamForgeDoctorResult("A", TeamForgeDoctorLevel.Pass, "ok"),
                new TeamForgeDoctorResult("B", TeamForgeDoctorLevel.Warning, "warn"),
                new TeamForgeDoctorResult("C", TeamForgeDoctorLevel.Fail, "bad"),
            };
            Assert.That(TeamForgeDoctor.Summary(results), Is.EqualTo("1 problem(s), 1 warning(s)"));
        }

        [Test]
        public void HostFlowExposesExplicitReviewReadyAndOwnedStopStates()
        {
            Assert.That((int)TeamForgeHostFlowState.Idle, Is.EqualTo(0));
            Assert.That((int)TeamForgeHostFlowState.AwaitingPublishConfirmation, Is.EqualTo(2));
            Assert.That((int)TeamForgeHostFlowState.Ready, Is.EqualTo(4));
            Assert.That((int)TeamForgeHostFlowState.Stopping, Is.EqualTo(5));
            Assert.That(typeof(TeamForgeHostFlow).GetMethod(nameof(TeamForgeHostFlow.StartCollaboration)), Is.Not.Null);
            Assert.That(typeof(TeamForgeHostFlow).GetMethod(nameof(TeamForgeHostFlow.StopCollaboration)), Is.Not.Null);
            Assert.That(TeamForgeHostFlow.HasCollaborationInvite, Is.False);
            Assert.That(typeof(TeamForgeHostFlow).GetMethod(nameof(TeamForgeHostFlow.CopyCollaborationInvite)), Is.Not.Null);
        }

        [Test]
        public void HostCollaborationInviteCannotBeCopiedBeforeHostReady()
        {
            Assert.That(TeamForgeHostFlow.CopyCollaborationInvite(out var error), Is.False);
            Assert.That(error, Does.Contain("Host Ready"));
        }

        [Test]
        public void HostReadyAcceptsOnlyTheBootstrapEnvelopeWithRealtimeSession()
        {
            Assert.That(
                TeamForgeHostFlow.LooksLikeCollaborationInvite(
                    "{\"format\":\"teamforge-project-invite-v1\",\"sessionJoinCode\":\"TF1.legacy\"}"),
                Is.False);
            Assert.That(
                TeamForgeHostFlow.LooksLikeCollaborationInvite(
                    "{\"format\":\"teamforge-bootstrap-invite-v1\",\"sessionJoinCode\":\"TF1.bound-session\"}"),
                Is.True);
            Assert.That(
                TeamForgeHostFlow.LooksLikeCollaborationInvite(
                    "{\"format\":\"teamforge-bootstrap-invite-v1\",\"sessionJoinCode\":\"\"}"),
                Is.False);
        }

        [Test]
        public void HostEndpointPolicyRejectsDefaultLoopbackForLanButPreservesExplicitLocalOnlyMode()
        {
            Assert.That(
                TeamForgeHostEndpointPolicy.TryValidateHostingPolicy(
                    "http://127.0.0.1:5080",
                    "0.0.0.0",
                    "separately-shared-access-code",
                    out var mismatchError),
                Is.False);
            Assert.That(mismatchError, Does.Contain("Guest address"));

            Assert.That(
                TeamForgeHostEndpointPolicy.TryValidateHostingPolicy(
                    "http://127.0.0.1:5080",
                    "127.0.0.1",
                    string.Empty,
                    out var localError),
                Is.True,
                localError);
        }

        [Test]
        public void HostEndpointPolicyRequiresAuthenticationAndBuildsExplicitLanGuestAddress()
        {
            Assert.That(
                TeamForgeHostEndpointPolicy.TryBuildAdvertisedAddress(
                    "http://127.0.0.1:5080",
                    "192.168.10.25",
                    out var advertised,
                    out var buildError),
                Is.True,
                buildError);
            Assert.That(advertised, Is.EqualTo("http://192.168.10.25:5080"));
            Assert.That(
                TeamForgeHostEndpointPolicy.TryValidateHostingPolicy(
                    advertised,
                    "0.0.0.0",
                    string.Empty,
                    out var unauthenticatedError),
                Is.False);
            Assert.That(unauthenticatedError, Does.Contain("without authentication"));
            Assert.That(
                TeamForgeHostEndpointPolicy.TryValidateHostingPolicy(
                    advertised,
                    "0.0.0.0",
                    "separately-shared-access-code",
                    out var authenticatedError),
                Is.True,
                authenticatedError);
        }

        [Test]
        public void WindowsLanFirewallPolicyUsesOnlyNarrowPrivateLocalSubnetRules()
        {
            Assert.That(TeamForgeWindowsFirewall.DefaultCoordinatorPort, Is.EqualTo(5080));
            Assert.That(TeamForgeWindowsFirewall.DefaultSeedPort, Is.EqualTo(5091));

            var install = TeamForgeWindowsFirewall.BuildInstallScript(5080, 53781);
            Assert.That(install, Does.Contain("-Profile Private"));
            Assert.That(install, Does.Contain("-RemoteAddress LocalSubnet"));
            Assert.That(install, Does.Contain("-LocalPort $Port"));
            Assert.That(install, Does.Contain("TeamForge Coordinator (LAN)' 5080"));
            Assert.That(install, Does.Contain("TeamForge Seed (LAN)' 53781"));
            Assert.That(install, Does.Contain("Remove-NetFirewallRule"));
            Assert.That(install, Does.Contain("-EdgeTraversalPolicy Block"));
            Assert.That(install, Does.Not.Contain("-Program"));
            Assert.That(install, Does.Not.Contain("-Profile Any"));
            Assert.That(install, Does.Not.Contain("0-65535"));

            var probe = TeamForgeWindowsFirewall.BuildProbeScript(5080, 53781);
            Assert.That(probe, Does.Contain(TeamForgeWindowsFirewall.CoordinatorRuleName));
            Assert.That(probe, Does.Contain(TeamForgeWindowsFirewall.SeedRuleName));
            Assert.That(probe, Does.Contain("ActiveStore"));
            Assert.That(probe, Does.Contain("LocalSubnet"));

            var remove = TeamForgeWindowsFirewall.BuildRemoveScript();
            Assert.That(remove, Does.Contain(TeamForgeWindowsFirewall.CoordinatorRuleName));
            Assert.That(remove, Does.Contain(TeamForgeWindowsFirewall.SeedRuleName));
            Assert.That(remove, Does.Contain("Remove-NetFirewallRule"));
            Assert.That(remove, Does.Not.Contain("*TeamForge*"));

            var removedProbe = TeamForgeWindowsFirewall.BuildRemovedProbeScript();
            Assert.That(removedProbe, Does.Contain("ActiveStore"));
            Assert.That(removedProbe, Does.Contain(TeamForgeWindowsFirewall.CoordinatorRuleName));
            Assert.That(removedProbe, Does.Contain(TeamForgeWindowsFirewall.SeedRuleName));
            Assert.That(removedProbe, Does.Not.Contain("*TeamForge*"));
        }

        [Test]
        public void PreferredSeedPortMigratesToTheDefaultAndAcceptsAStickyFallback()
        {
            var settings = TeamForgeConnectionSettings.instance;
            var previous = settings.PreferredSeedPort;
            try
            {
                settings.PreferredSeedPort = 0;
                settings.EnsureDefaults();
                Assert.That(settings.PreferredSeedPort, Is.EqualTo(TeamForgeWindowsFirewall.DefaultSeedPort));

                settings.PreferredSeedPort = 53781;
                settings.EnsureDefaults();
                Assert.That(settings.PreferredSeedPort, Is.EqualTo(53781));
            }
            finally
            {
                settings.PreferredSeedPort = previous;
            }
        }

        [Test]
        public void FirewallCleanupOnStopPreferenceCanBeChangedWithoutAffectingStickySeedPort()
        {
            var settings = TeamForgeConnectionSettings.instance;
            var previousCleanup = settings.RemoveLanFirewallRulesOnStop;
            var previousPort = settings.PreferredSeedPort;
            try
            {
                settings.PreferredSeedPort = 53781;
                settings.RemoveLanFirewallRulesOnStop = false;
                settings.EnsureDefaults();
                Assert.That(settings.RemoveLanFirewallRulesOnStop, Is.False);
                Assert.That(settings.PreferredSeedPort, Is.EqualTo(53781));

                settings.RemoveLanFirewallRulesOnStop = true;
                settings.EnsureDefaults();
                Assert.That(settings.RemoveLanFirewallRulesOnStop, Is.True);
                Assert.That(settings.PreferredSeedPort, Is.EqualTo(53781));
            }
            finally
            {
                settings.RemoveLanFirewallRulesOnStop = previousCleanup;
                settings.PreferredSeedPort = previousPort;
            }
        }

        [TestCase(0)]
        [TestCase(65536)]
        public void WindowsLanFirewallPolicyRejectsInvalidPorts(int port)
        {
            Assert.Throws<ArgumentOutOfRangeException>(() =>
                TeamForgeWindowsFirewall.BuildInstallScript(port, 5091));
        }

        [Test]
        public void Wp5RecoveryUsesStableSceneAndPortStatesWithoutBypassOrTermination()
        {
            var scene = TeamForgeRecoveryUx.FromStableCode("scene_baseline_mismatch", true);
            Assert.That(scene.Title, Does.Contain("Saved Scene"));
            Assert.That(scene.Message, Does.Contain("will not bypass"));
            Assert.That(scene.PrimaryAction, Is.EqualTo("Update Project"));

            var port = TeamForgeRecoveryUx.FromStableCode("port_conflict");
            Assert.That(port.Title, Does.Contain("already using this port"));
            Assert.That(port.Message, Does.Contain("not terminated"));
            Assert.That(port.Message, Does.Not.Contain("kill").IgnoreCase);
        }

        [Test]
        public void Wp5CurrentRunDiagnosticsAreBoundedAndSecretSafe()
        {
            const string secret = "wp5-secret-that-must-not-appear";
            for (var index = 0; index < 40; index += 1)
            {
                TeamForgeRecoveryUx.Record(
                    "guest_receive",
                    "wp5_item_" + index,
                    "Authorization: Bearer " + secret + " accessCode=" + secret);
            }

            var report = TeamForgeRecoveryUx.BuildCopyDiagnostics(
                "Guest",
                "guest_receive",
                "access_code_incorrect",
                "token=" + secret,
                true);
            Assert.That(report, Does.Not.Contain(secret));
            Assert.That(report, Does.Contain("[redacted]"));
            Assert.That(report, Does.Not.Contain("wp5_item_0"));
            Assert.That(report, Does.Contain("wp5_item_39"));
            Assert.That(report, Does.Contain("Previous verified Active available: yes"));
        }
    }
}

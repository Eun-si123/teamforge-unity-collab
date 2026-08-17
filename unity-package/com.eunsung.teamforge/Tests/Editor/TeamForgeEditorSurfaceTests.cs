using System.Reflection;
using NUnit.Framework;
using UnityEditor;

namespace EunSung.TeamForge.Tests
{
    public sealed class TeamForgeEditorSurfaceTests
    {
        [Test]
        public void EmbeddedPackageAssemblyAndMenuSurfaceMatchVersion050()
        {
            var editorAssembly = typeof(TeamForgeProjectContract).Assembly;
            var packageInfo = UnityEditor.PackageManager.PackageInfo.FindForAssembly(editorAssembly);
            var homeMethod = typeof(TeamForgeHomeWindow).GetMethod(
                nameof(TeamForgeHomeWindow.Open),
                BindingFlags.Public | BindingFlags.Static);
            var homeMenu = homeMethod?.GetCustomAttribute<MenuItem>();
            var advancedMethod = typeof(TeamForgeWindow).GetMethod(
                nameof(TeamForgeWindow.Open),
                BindingFlags.Public | BindingFlags.Static);
            var advancedMenu = advancedMethod?.GetCustomAttribute<MenuItem>();

            Assert.That(editorAssembly.GetName().Name, Is.EqualTo("EunSung.TeamForge.Editor"));
            Assert.That(packageInfo, Is.Not.Null);
            Assert.That(packageInfo.name, Is.EqualTo("com.eunsung.teamforge"));
            Assert.That(packageInfo.version, Is.EqualTo("0.5.1"));
            Assert.That(TeamForgeProjectContract.ProductVersion, Is.EqualTo(packageInfo.version));
            Assert.That(homeMenu, Is.Not.Null);
            Assert.That(homeMenu.menuItem, Is.EqualTo("Window/TeamForge/Collaboration"));
            Assert.That(advancedMenu, Is.Not.Null);
            Assert.That(advancedMenu.menuItem, Is.EqualTo("Window/TeamForge/Advanced"));
        }

        [Test]
        public void BootstrapAvailabilityAndStatusTextSeparateMissingBaselineFromOfflineSeed()
        {
            Assert.That((int)TeamForgeProjectBootstrapState.Ready, Is.EqualTo(6));
            Assert.That((int)TeamForgeProjectBootstrapState.InvitationMismatch, Is.EqualTo(9));
            Assert.That((int)TeamForgeProjectBootstrapState.BaselineAvailableNoSeed, Is.EqualTo(10));

            Assert.That(
                TeamForgeProjectBootstrapPolicy.ResolveAvailability(false, false),
                Is.EqualTo(TeamForgeProjectBootstrapState.BaselineUnavailable));
            Assert.That(
                TeamForgeProjectBootstrapPolicy.ResolveAvailability(true, false),
                Is.EqualTo(TeamForgeProjectBootstrapState.BaselineAvailableNoSeed));
            Assert.That(
                TeamForgeProjectBootstrapPolicy.ResolveAvailability(true, true),
                Is.EqualTo(TeamForgeProjectBootstrapState.Ready));

            var summaryMethod = typeof(TeamForgeWindow).GetMethod(
                "ProjectStateSummary",
                BindingFlags.NonPublic | BindingFlags.Static);

            Assert.That(summaryMethod, Is.Not.Null);
            Assert.That(
                summaryMethod.Invoke(
                    null,
                    new object[] { TeamForgeProjectBootstrapState.BaselineUnavailable }),
                Is.EqualTo("No verified baseline has been published"));
            Assert.That(
                summaryMethod.Invoke(
                    null,
                    new object[] { TeamForgeProjectBootstrapState.BaselineAvailableNoSeed }),
                Is.EqualTo("Verified baseline exists · no direct seed is online"));
        }

        [Test]
        public void DescriptorCompatibilityAccepts050AndRejects040()
        {
            var compatible = new TeamForgeProjectDescriptor
            {
                schemaVersion = TeamForgeProjectContract.DescriptorSchemaVersion,
                projectUuid = TestProjectData.ProjectUuid,
                baselineRevision = 1,
                manifestHash = TestProjectData.ManifestHash,
                descriptorHash = TestProjectData.DescriptorHash,
                unityVersion = "6000.3.21f1",
                teamForgePackageVersion = "0.5.1",
                realtimeProtocolVersion = TeamForgeProtocol.Version,
                transferProtocolVersion = TeamForgeProjectContract.TransferProtocolVersion,
                manifestSchemaVersion = TeamForgeProjectContract.ManifestSchemaVersion,
            };

            Assert.That(
                TeamForgeProjectValidation.TryValidateDescriptor(compatible, out var compatibleError),
                Is.True,
                compatibleError);

            compatible.teamForgePackageVersion = "0.4.0";
            Assert.That(
                TeamForgeProjectValidation.TryValidateDescriptor(compatible, out var incompatibleError),
                Is.False);
            Assert.That(incompatibleError, Is.Not.Empty);
        }
    }
}

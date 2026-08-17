using NUnit.Framework;

namespace EunSung.TeamForge.Tests
{
    public sealed class TeamForgeInputValidatorTests
    {
        [Test]
        public void AcceptsNormalIdentityFields()
        {
            var success = TeamForgeInputValidator.TryValidateIdentity(
                "Editor A",
                "sample-project",
                "phase-0",
                out var error);

            Assert.That(success, Is.True, error);
        }

        [TestCase("", "project", "session")]
        [TestCase("user", "", "session")]
        [TestCase("user", "project", "line\nbreak")]
        public void RejectsMissingOrControlCharacterIdentity(string user, string project, string session)
        {
            var success = TeamForgeInputValidator.TryValidateIdentity(user, project, session, out var error);

            Assert.That(success, Is.False);
            Assert.That(error, Is.Not.Empty);
        }

        [TestCase("editor-a", "#64B5F6", true)]
        [TestCase("editor-a", "64B5F6", false)]
        [TestCase("editor-a", "#NOTHEX", false)]
        [TestCase("", "#64B5F6", false)]
        public void ValidatesStablePresenceIdentityAndHtmlColor(string userId, string color, bool expected)
        {
            var success = TeamForgeInputValidator.TryValidatePresenceIdentity(userId, color, out var error);

            Assert.That(success, Is.EqualTo(expected), error);
        }
    }
}

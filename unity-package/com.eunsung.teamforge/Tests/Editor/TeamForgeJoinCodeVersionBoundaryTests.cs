using System;
using System.Text;
using NUnit.Framework;
using UnityEngine;

namespace EunSung.TeamForge.Tests
{
    public sealed class TeamForgeJoinCodeVersionBoundaryTests
    {
        [Test]
        public void MalformedProductVersionsAreRejectedWithoutEchoingUntrustedText()
        {
            var invalidVersions = new[]
            {
                null,
                string.Empty,
                " ",
                ".9.9",
                "9.9\\nattacker",
                "9.9\\rattacker",
                "9.9\\tattacker",
                "9.9\\u2028attacker",
                "9.9/other",
                "é.1",
                new string('9', 65),
            };

            foreach (var invalidVersion in invalidVersions)
            {
                var code = MakeJoinCode(invalidVersion);
                Assert.That(TeamForgeJoinCode.TryParse(code, out var parsed, out var error),
                    Is.False, "Malformed product version was accepted.");
                Assert.That(parsed, Is.Null);
                Assert.That(error, Is.EqualTo("The TeamForge join code product version is invalid."));
            }
        }

        [Test]
        public void BoundedValidVersionsKeepActionableMismatchDiagnostics()
        {
            foreach (var version in new[] { "9.9.9", new string('9', 64), "9.9.9-preview+1" })
            {
                Assert.That(TeamForgeJoinCode.TryParse(MakeJoinCode(version), out var parsed, out var error),
                    Is.False);
                Assert.That(parsed, Is.Null);
                Assert.That(error, Does.Contain("targets TeamForge " + version));
            }
        }

        private static string MakeJoinCode(string version)
        {
            var payload = new TeamForgeJoinCodePayload
            {
                serverAddress = "http://127.0.0.1:5080",
                realtimePath = "ws",
                projectId = "project-version-test",
                sessionId = "session-version-test",
                productVersion = version,
            };
            var json = JsonUtility.ToJson(payload, false);
            return TeamForgeJoinCode.Prefix + Convert.ToBase64String(Encoding.UTF8.GetBytes(json))
                .TrimEnd('=')
                .Replace('+', '-')
                .Replace('/', '_');
        }
    }
}

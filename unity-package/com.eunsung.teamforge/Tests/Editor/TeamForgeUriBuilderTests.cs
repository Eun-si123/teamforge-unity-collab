using NUnit.Framework;

namespace EunSung.TeamForge.Tests
{
    public sealed class TeamForgeUriBuilderTests
    {
        [TestCase("http://127.0.0.1:5080", "ws", "ws://127.0.0.1:5080/ws")]
        [TestCase("https://example.com", "ws", "wss://example.com/ws")]
        [TestCase("https://example.com/teamforge", "/ws/", "wss://example.com/teamforge/ws")]
        [TestCase("ws://localhost:9000/base/", "realtime", "ws://localhost:9000/base/realtime")]
        public void BuildsExpectedWebSocketUri(string address, string path, string expected)
        {
            var success = TeamForgeUriBuilder.TryBuildWebSocketUri(address, path, out var uri, out var error);

            Assert.That(success, Is.True, error);
            Assert.That(uri.ToString().TrimEnd('/'), Is.EqualTo(expected));
        }

        [TestCase("ftp://example.com")]
        [TestCase("relative-host")]
        [TestCase("https://user:password@example.com")]
        [TestCase("https://example.com?token=secret")]
        public void RejectsUnsafeOrUnsupportedAddress(string address)
        {
            var success = TeamForgeUriBuilder.TryBuildWebSocketUri(address, "ws", out _, out var error);

            Assert.That(success, Is.False);
            Assert.That(error, Is.Not.Empty);
        }
    }
}

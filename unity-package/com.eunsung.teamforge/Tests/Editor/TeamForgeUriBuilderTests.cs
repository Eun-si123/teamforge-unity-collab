using NUnit.Framework;

namespace EunSung.TeamForge.Tests
{
    public sealed class TeamForgeUriBuilderTests
    {
        [TestCase("http://127.0.0.1:5080", "ws", "ws://127.0.0.1:5080/ws")]
        [TestCase("http://192.168.219.5:5080", "ws", "ws://192.168.219.5:5080/ws")]
        [TestCase("https://example.com", "ws", "wss://example.com/ws")]
        [TestCase("https://example.com/teamforge", "/ws/", "wss://example.com/teamforge/ws")]
        [TestCase("ws://localhost:9000/base/", "realtime", "ws://localhost:9000/base/realtime")]
        [TestCase("https://example.com/base", "rooms/live%20one", "wss://example.com/base/rooms/live%20one")]
        [TestCase("https://example.com/base", "rooms/%C3%A9", "wss://example.com/base/rooms/%C3%A9")]
        [TestCase("https://example.com/base/live%20one", "ws", "wss://example.com/base/live%20one/ws")]
        [TestCase("https://example.com/base/%C3%A9", "ws", "wss://example.com/base/%C3%A9/ws")]
        public void BuildsExpectedWebSocketUri(string address, string path, string expected)
        {
            var success = TeamForgeUriBuilder.TryBuildWebSocketUri(address, path, out var uri, out var error);

            Assert.That(success, Is.True, error);
            Assert.That(uri.AbsoluteUri.TrimEnd('/'), Is.EqualTo(expected));
        }

        [TestCase("rooms/%41")]
        [TestCase("rooms/%7E")]
        [TestCase("rooms/%2D")]
        [TestCase("rooms/%2e%2f")]
        [TestCase("rooms/%")]
        [TestCase("rooms/%G0")]
        [TestCase("rooms/%2")]
        [TestCase("rooms/%e2%98%83")]
        [TestCase("rooms/./ws")]
        [TestCase("rooms/%2e/ws")]
        [TestCase("rooms/%2E%2e/ws")]
        [TestCase("rooms/.%2e/ws")]
        [TestCase("rooms//ws")]
        [TestCase("rooms..ws")]
        [TestCase("w\ts")]
        [TestCase("ws\n")]
        public void RejectsRealtimePathsThatNormalizeToAnotherEndpoint(string path)
        {
            var success = TeamForgeUriBuilder.TryBuildWebSocketUri("https://example.com/base", path, out _, out var error);
            Assert.That(success, Is.False, path);
            Assert.That(error, Is.Not.Empty);
        }

        [TestCase("\nhttps://example.com")]
        [TestCase("https://example.com\r")]
        [TestCase("https://example.com\t:5080")]
        [TestCase("ftp://example.com")]
        [TestCase("relative-host")]
        [TestCase("https://user:password@example.com")]
        [TestCase("https://example.com?token=secret")]
        [TestCase("http://192.168.219.:5080")]
        [TestCase("http://192.168.219:5080")]
        [TestCase("http://192.168..5:5080")]
        [TestCase("http://192.168.219.999:5080")]
        [TestCase("http://192.168.219.005:5080")]
        [TestCase("http://127.1:5080")]
        [TestCase("https://example.com/base/%2E/ws")]
        [TestCase("https://example.com/base/%41")]
        [TestCase("https://example.com/base/%7e")]
        [TestCase("https://example.com/base/%")]
        [TestCase("https://example.com/base/%e2%98%83")]
        public void RejectsUnsafeOrUnsupportedAddress(string address)
        {
            var success = TeamForgeUriBuilder.TryBuildWebSocketUri(address, "ws", out _, out var error);

            Assert.That(success, Is.False);
            Assert.That(error, Is.Not.Empty);
        }
    }
}

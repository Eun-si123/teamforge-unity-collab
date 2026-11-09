using System;
using System.IO;
using NUnit.Framework;
using UnityEngine;

namespace EunSung.TeamForge.Tests
{
    public sealed class TeamForgeWp6LocalPeerCliTests
    {
        private const string ProjectUuid = "c1d815a9-3f04-4db1-82f2-50d5fa37e1bf";
        private const string SceneGuid = "0123456789abcdef0123456789abcdef";
        private const string ScenePath = "Assets/Scenes/Proof.unity";

        [Test]
        public void ExactLocalRuntimeAndSceneProducesOnlyRestrictedReadOnlyInvocation()
        {
            var root = Path.Combine(Path.GetTempPath(), "tf-wp6-local-cli-" + Guid.NewGuid().ToString("N"));
            var node = Path.Combine(root, "node");
            var workspace = Path.Combine(root, "backend");
            var cli = Path.Combine(workspace, "project-peer", "src", "cli.mjs");
            var managed = Path.Combine(root, "TeamForgeProjects");
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(cli));
                Directory.CreateDirectory(managed);
                File.WriteAllText(node, "test node fixture");
                File.WriteAllText(cli, "test CLI fixture");
                Assert.That(TeamForgeWp6LocalPeerCli.TryBuildInvocation(
                    node, workspace, managed, ProjectUuid, ScenePath,
                    SceneGuid, out var parsed, out var error), Is.True, error);
                Assert.That(parsed.NodeExecutable, Is.EqualTo(node));
                Assert.That(parsed.CliPath, Is.EqualTo(cli));
                Assert.That(parsed.ManagedRoot, Is.EqualTo(managed));
                Assert.That(parsed.ProjectUuid, Is.EqualTo(ProjectUuid));
                Assert.That(parsed.ScenePath, Is.EqualTo(ScenePath));
                Assert.That(parsed.SceneGuid, Is.EqualTo(SceneGuid));

                foreach (var invalid in new[] {
                    "../Assets/Scenes/Proof.unity",
                    "Assets/../Scenes/Proof.unity",
                    "Assets//Scenes/Proof.unity",
                    "/etc/passwd",
                    "Assets\\Scenes\\Proof.unity",
                    "Assets/Scenes/Proof.unity\" --exec=evil",
                    "Assets/Scenes/Proof.unity\n--exec=evil",
                    "Assets/Scenes/Proof.unity.meta",
                    "Assets/Scenes/./Proof.unity",
                })
                {
                    Assert.That(TeamForgeWp6LocalPeerCli.TryBuildInvocation(
                        node, workspace, managed, ProjectUuid, invalid,
                        SceneGuid, out var denied, out _), Is.False, invalid);
                    Assert.That(denied, Is.Null);
                }
                foreach (var invalid in new[] {
                    "", "00000000000000000000000000000000",
                    "0123456789ABCDEF0123456789ABCDEF", new string('z', 32),
                })
                    Assert.That(TeamForgeWp6LocalPeerCli.TryBuildInvocation(
                        node, workspace, managed, ProjectUuid, ScenePath,
                        invalid, out _, out _), Is.False, invalid);
                Assert.That(TeamForgeWp6LocalPeerCli.TryBuildInvocation(
                    node, workspace, managed, ProjectUuid.ToUpperInvariant(),
                    ScenePath, SceneGuid, out _, out _), Is.False);
                Assert.That(TeamForgeWp6LocalPeerCli.TryBuildInvocation(
                    node, workspace, managed, ProjectUuid + "\" --help",
                    ScenePath, SceneGuid, out _, out _), Is.False);

                File.Delete(cli);
                Assert.That(TeamForgeWp6LocalPeerCli.TryBuildInvocation(
                    node, workspace, managed, ProjectUuid, ScenePath,
                    SceneGuid, out _, out _), Is.False);
                Assert.That(File.Exists(node), Is.True);
            }
            finally
            {
                if (Directory.Exists(root))
                    Directory.Delete(root, true);
            }
        }

        [Test]
        public void ChildOutputReaderIsBoundedAndDoesNotLeakOversizedOutput()
        {
            using (var small = new StringReader("{\"schemaVersion\":1}"))
                Assert.That(TeamForgeWp6LocalPeerCli.ReadBoundedAsync(
                    small, 64).GetAwaiter().GetResult(),
                    Is.EqualTo("{\"schemaVersion\":1}"));
            using (var tooLong = new StringReader(new string('x', 10_000)))
                Assert.That(TeamForgeWp6LocalPeerCli.ReadBoundedAsync(
                    tooLong, 256).GetAwaiter().GetResult(), Is.Null);
            using (var exact = new StringReader(new string('y', 1024)))
                Assert.That(TeamForgeWp6LocalPeerCli.ReadBoundedAsync(
                    exact, 1024).GetAwaiter().GetResult(),
                    Is.EqualTo(new string('y', 1024)));
        }

        [Test]
        public void MissingInvocationReturnsFailureWithoutStartingAnyProcess()
        {
            var result = TeamForgeWp6LocalPeerCli.RunAsync(null).GetAwaiter().GetResult();
            Assert.That(result.Success, Is.False);
            Assert.That(result.Json, Is.Null);
            Assert.That(result.Status, Does.Contain("No WP6 Project Peer"));
        }
    }
}

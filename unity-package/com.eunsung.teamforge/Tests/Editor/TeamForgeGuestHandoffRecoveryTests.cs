using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;
using NUnit.Framework;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace EunSung.TeamForge.Tests
{
    public sealed class TeamForgeGuestHandoffRecoveryTests
    {
        private const BindingFlags StaticNonPublic = BindingFlags.Static | BindingFlags.NonPublic;
        private string _markerPath;
        private byte[] _previousMarker;

        [SetUp]
        public void SetUp()
        {
            _markerPath = Path.GetFullPath(Path.Combine("Library", "TeamForge", "verified-guest-reconnect.json"));
            _previousMarker = File.Exists(_markerPath) ? File.ReadAllBytes(_markerPath) : null;
            if (File.Exists(_markerPath))
            {
                File.Delete(_markerPath);
            }
        }

        [TearDown]
        public void TearDown()
        {
            try
            {
                if (File.Exists(_markerPath))
                {
                    File.Delete(_markerPath);
                }
                if (_previousMarker != null)
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(_markerPath));
                    File.WriteAllBytes(_markerPath, _previousMarker);
                }
            }
            catch
            {
                // The test assertion is more useful than a cleanup-only failure.
            }
        }

        [Test]
        public void VerifiedReconnectMarkerRequiresExactProjectSessionBaselineAndPath()
        {
            var root = Path.GetFullPath(Directory.GetCurrentDirectory());
            var handoff = CreateHandoff(root, "session-a");
            Assert.That(
                TeamForgeJoinCode.TryParse(handoff.sessionJoinCode, out _, out var parseError),
                Is.True,
                parseError);

            TeamForgeVerifiedGuestReconnect.Store(handoff);

            Assert.That(File.Exists(_markerPath), Is.True, "Verified reconnect marker was not persisted.");
            Assert.That(TeamForgeVerifiedGuestReconnect.Matches(handoff), Is.True);

            var wrongSession = CreateHandoff(root, "session-b");
            Assert.That(TeamForgeVerifiedGuestReconnect.Matches(wrongSession), Is.False);

            var wrongDescriptor = CreateHandoff(root, "session-a");
            wrongDescriptor.descriptorHash = new string('d', 64);
            Assert.That(TeamForgeVerifiedGuestReconnect.Matches(wrongDescriptor), Is.False);

            var wrongPath = CreateHandoff(Path.Combine(root, "different-project"), "session-a");
            Assert.That(TeamForgeVerifiedGuestReconnect.Matches(wrongPath), Is.False);
        }

        [Test]
        public void VerifiedReconnectAllowsSavedSceneHashChangeButNormalJoinRemainsStrict()
        {
            var previous = SceneManager.GetActiveScene();
            var replacedUntitledScene = previous.IsValid() &&
                                        previous.isLoaded &&
                                        string.IsNullOrWhiteSpace(previous.path);
            if (replacedUntitledScene && previous.rootCount > 0)
            {
                Assert.Ignore(
                    "Verified reconnect Scene test will not replace an untitled Scene that contains user objects.");
            }

            var scenePath = AssetDatabase.GenerateUniqueAssetPath("Assets/TeamForgeVerifiedReconnectTest.unity");
            var temporary = EditorSceneManager.NewScene(
                NewSceneSetup.EmptyScene,
                replacedUntitledScene ? NewSceneMode.Single : NewSceneMode.Additive);
            try
            {
                Assert.That(EditorSceneManager.SaveScene(temporary, scenePath), Is.True);
                if (SceneManager.GetActiveScene().handle != temporary.handle)
                {
                    Assert.That(SceneManager.SetActiveScene(temporary), Is.True);
                }
                Assert.That(SceneManager.GetActiveScene().handle, Is.EqualTo(temporary.handle));

                var expected = new TeamForgeSceneBaseline
                {
                    scenePath = scenePath,
                    sceneGuid = AssetDatabase.AssetPathToGUID(scenePath),
                    sha256 = new string('f', 64),
                };
                Assert.That(expected.sceneGuid, Is.Not.Empty);

                var reconnectValidator = typeof(TeamForgeVerifiedGuestReconnect).GetMethod(
                    "TryValidateSavedReconnectScene",
                    StaticNonPublic);
                Assert.That(reconnectValidator, Is.Not.Null);
                var reconnectArgs = new object[] { expected, false, null };
                var reconnectAccepted = (bool)reconnectValidator.Invoke(null, reconnectArgs);
                Assert.That(reconnectAccepted, Is.True, reconnectArgs[2] as string);

                var strictAccepted = TeamForgeBaselineFingerprint.TryValidateLocalScene(
                    expected,
                    false,
                    out _,
                    out var failureCode);
                Assert.That(strictAccepted, Is.False);
                Assert.That(failureCode, Is.EqualTo("scene_baseline_mismatch"));
            }
            finally
            {
                if (replacedUntitledScene)
                {
                    if (temporary.IsValid() && temporary.isLoaded)
                    {
                        EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                    }
                }
                else
                {
                    if (previous.IsValid() && previous.isLoaded)
                    {
                        SceneManager.SetActiveScene(previous);
                    }
                    if (temporary.IsValid() && temporary.isLoaded)
                    {
                        EditorSceneManager.CloseScene(temporary, true);
                    }
                }
                AssetDatabase.DeleteAsset(scenePath);
            }
        }

        [Test]
        public void WindowsExecutionAliasMustResolveToExactCanonicalActivePath()
        {
#if !UNITY_EDITOR_WIN
            Assert.Ignore("ExecutionAlias is Windows-only.");
#else
            var root = Path.Combine(Path.GetTempPath(), "TeamForgeAliasIdentity-" + Guid.NewGuid().ToString("N"));
            var canonical = Path.Combine(root, "canonical");
            var other = Path.Combine(root, "other");
            var alias = Path.Combine(root, "alias");
            Directory.CreateDirectory(canonical);
            Directory.CreateDirectory(other);
            try
            {
                CreateJunction(alias, canonical);
                AssertAliasResult(alias, canonical, true);

                Directory.Delete(alias);
                CreateJunction(alias, other);
                AssertAliasResult(alias, canonical, false);
            }
            finally
            {
                try
                {
                    if (Directory.Exists(alias)) Directory.Delete(alias);
                    if (Directory.Exists(root)) Directory.Delete(root, true);
                }
                catch
                {
                }
            }
#endif
        }

        private static TeamForgeGuestHandoffData CreateHandoff(string activePath, string sessionId)
        {
            return new TeamForgeGuestHandoffData
            {
                schemaVersion = 1,
                projectUuid = "123e4567-e89b-42d3-a456-426614174000",
                baselineRevision = 7,
                manifestHash = new string('a', 64),
                descriptorHash = new string('b', 64),
                ownerKeyId = new string('c', 64),
                publisherKeyId = new string('e', 64),
                activeProjectPath = activePath,
                sessionJoinCode = CreateJoinCode(sessionId),
                createdAtUnixMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            };
        }

        private static string CreateJoinCode(string sessionId)
        {
            var payload = new TeamForgeJoinCodePayload
            {
                format = TeamForgeJoinCode.Format,
                serverAddress = "http://127.0.0.1:5080",
                realtimePath = "ws",
                projectId = "reconnect-test",
                sessionId = sessionId,
                projectUuid = "123e4567-e89b-42d3-a456-426614174000",
                productVersion = TeamForgeProjectContract.ProductVersion,
                hostDisplayName = "Host",
                createdUtc = DateTime.UtcNow.ToString("O"),
                sceneBaseline = new TeamForgeSceneBaseline
                {
                    scenePath = "Assets/Scenes/SampleScene.unity",
                    sceneGuid = "0123456789abcdef0123456789abcdef",
                    sha256 = new string('f', 64),
                },
            };
            var bytes = Encoding.UTF8.GetBytes(JsonUtility.ToJson(payload, false));
            return TeamForgeJoinCode.Prefix + Convert.ToBase64String(bytes)
                .TrimEnd('=')
                .Replace('+', '-')
                .Replace('/', '_');
        }

#if UNITY_EDITOR_WIN
        private static void CreateJunction(string alias, string target)
        {
            var info = new ProcessStartInfo
            {
                FileName = "cmd.exe",
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            info.ArgumentList.Add("/d");
            info.ArgumentList.Add("/c");
            info.ArgumentList.Add("mklink");
            info.ArgumentList.Add("/J");
            info.ArgumentList.Add(alias);
            info.ArgumentList.Add(target);
            using var process = Process.Start(info);
            Assert.That(process, Is.Not.Null);
            process.WaitForExit();
            var stderr = process.StandardError.ReadToEnd();
            Assert.That(process.ExitCode, Is.EqualTo(0), stderr);
        }

        private static void AssertAliasResult(string alias, string canonical, bool expected)
        {
            var method = typeof(TeamForgeGuestHandoff).GetMethod("TryValidateExecutionAlias", StaticNonPublic);
            Assert.That(method, Is.Not.Null);
            var arguments = new object[] { alias, canonical, null };
            var actual = (bool)method.Invoke(null, arguments);
            Assert.That(actual, Is.EqualTo(expected), arguments[2] as string);
        }
#endif
    }
}

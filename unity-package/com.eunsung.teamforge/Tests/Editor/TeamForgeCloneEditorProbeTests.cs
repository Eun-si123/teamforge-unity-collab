using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using NUnit.Framework;
using UnityEditor;
using UnityEditor.PackageManager;
using UnityEngine;

namespace EunSung.TeamForge.Tests
{
    // CI-only two-stage proof. This fixture never configures a collaboration
    // session, writes a clone bootstrap, or starts an Editor process.
    public sealed class TeamForgeCloneEditorProbeTests
    {
        private const string PackageName = "com.eunsung.teamforge";
        private const string BaselineEditor = "6000.3.21f1";
        private const long MaximumPackageBytes = 1024L * 1024 * 1024;
        private static readonly UTF8Encoding Utf8 = new UTF8Encoding(false, true);

        [Serializable]
        private sealed class Owner
        {
            public int schemaVersion = 0;
            public string runId = string.Empty;
            public string runAttempt = string.Empty;
            public string sourceSha = string.Empty;
            public string editor = string.Empty;
            public string token = string.Empty;
        }

        [Serializable]
        private sealed class PackageFile
        {
            public string path;
            public long length;
            public string sha256;
        }

        [Serializable]
        private sealed class Export
        {
            public int schemaVersion = 1;
            public string token;
            public string sourceSha;
            public string editor;
            public string clonePath;
            public string packageName;
            public string packageVersion;
            public string sourceManifestSha256;
            public bool sourceLockPresent;
            public string sourceLockSha256;
            public string cloneManifestSha256;
            public PackageFile[] packageFiles;
        }

        [Serializable]
        private sealed class Probe
        {
            public int schemaVersion = 1;
            public string token;
            public string sourceSha;
            public string editor;
            public string clonePath;
            public string packageName;
            public string packageVersion;
            public string packageSource;
        }

        [Test]
        public void ExportCloneForSeparateEditor()
        {
            var token = EnabledRun("-teamforgeCiExportClone");
            var source = Directory.GetParent(Application.dataPath).FullName;
            Assert.That(Path.GetFileName(source), Is.EqualTo("unity-project"));
            var workspace = Directory.GetParent(source).FullName;
            var runRoot = RunRoot(workspace, token);
            var owner = ReadOwner(runRoot, token);
            Assert.That(Directory.GetFileSystemEntries(runRoot).Select(Path.GetFileName), Is.EquivalentTo(new[] { "owner.json", "baseline.json" }));

            var loaded = PackageInfo.FindForAssembly(typeof(TeamForgeTestLab).Assembly);
            Assert.That(loaded, Is.Not.Null);
            Assert.That(loaded.name, Is.EqualTo(PackageName));
            Assert.That(loaded.version, Is.Not.Null.And.Not.Empty);
            AssertSamePath(loaded.resolvedPath, Path.Combine(workspace, "unity-package", PackageName));
            var manifest = ReadBytes(Path.Combine(source, "Packages", "manifest.json"));
            var lockPath = Path.Combine(source, "Packages", "packages-lock.json");
            var sourceLock = File.Exists(lockPath) ? ReadBytes(lockPath) : null;

            Assert.That(TeamForgeTestLabPackageSnapshot.TryPrepare(source, loaded.resolvedPath, loaded.version,
                out var snapshot, out var prepareError), Is.True, prepareError);
            Assert.That(snapshot, Is.Not.Null, "The baseline source checkout must exercise its external local TeamForge package snapshot.");
            var destination = Path.Combine(runRoot, "clones");
            Assert.That(snapshot.TryValidateDestination(destination, out var destinationError), Is.True, destinationError);
            Assert.That(TeamForgeTestLab.TryAllocateCloneDirectories(source, destination, 1,
                out var clones, out var allocateError), Is.True, allocateError);
            var clone = clones.Single();
            CopyProject(source, clone);
            Assert.That(snapshot.TryApply(clone, out var applyError), Is.True, applyError);

            var files = CapturePackageFiles(loaded.resolvedPath);
            var clonedFiles = CapturePackageFiles(Path.Combine(clone, "Packages", PackageName));
            Assert.That(clonedFiles.Select(FileIdentity), Is.EqualTo(files.Select(FileIdentity)));
            Assert.That(ReadBytes(Path.Combine(source, "Packages", "manifest.json")), Is.EqualTo(manifest));
            Assert.That(File.Exists(lockPath), Is.EqualTo(sourceLock != null));
            if (sourceLock != null)
            {
                Assert.That(ReadBytes(lockPath), Is.EqualTo(sourceLock));
                Assert.That(ReadBytes(Path.Combine(clone, "Packages", "packages-lock.json")), Is.EqualTo(sourceLock));
                WriteNew(Path.Combine(runRoot, "initial-lock.json"), sourceLock);
            }
            else Assert.That(File.Exists(Path.Combine(clone, "Packages", "packages-lock.json")), Is.False);
            foreach (var omitted in new[] { "Library", "Temp", "Logs", "UserSettings", ".git" })
                Assert.That(File.Exists(Path.Combine(clone, omitted)) || Directory.Exists(Path.Combine(clone, omitted)), Is.False);

            var receipt = new Export
            {
                token = token,
                sourceSha = owner.sourceSha,
                editor = Application.unityVersion,
                clonePath = Relative(workspace, clone),
                packageName = loaded.name,
                packageVersion = loaded.version,
                sourceManifestSha256 = Hash(manifest),
                sourceLockPresent = sourceLock != null,
                sourceLockSha256 = sourceLock == null ? string.Empty : Hash(sourceLock),
                cloneManifestSha256 = Hash(ReadBytes(Path.Combine(clone, "Packages", "manifest.json"))),
                packageFiles = files,
            };
            WriteNew(Path.Combine(runRoot, "export.json"), Utf8.GetBytes(JsonUtility.ToJson(receipt, true)));
            TestContext.Progress.WriteLine("Exported one owned clone for a separate sequential Editor; no clone Editor was launched by the test.");
        }

        [Test]
        public void CloneEditorResolvesItsOwnEmbeddedPackage()
        {
            var token = EnabledRun("-teamforgeCiCloneProbe");
            Assert.That(Environment.GetCommandLineArgs(), Does.Not.Contain("-teamforgeCiExportClone"));
            Assert.That(Environment.GetCommandLineArgs(), Does.Not.Contain("-teamforgeCiE2E"));
            Assert.That(Environment.GetCommandLineArgs(), Does.Not.Contain("-teamforgeCiLockContentionE2E"));
            var clone = Directory.GetParent(Application.dataPath).FullName;
            var runRoot = Directory.GetParent(Directory.GetParent(clone).FullName).FullName;
            var workspace = Directory.GetParent(Directory.GetParent(Directory.GetParent(runRoot).FullName).FullName).FullName;
            AssertSamePath(runRoot, RunRoot(workspace, token));
            var owner = ReadOwner(runRoot, token);
            var receipt = JsonUtility.FromJson<Export>(Utf8.GetString(ReadBytes(Path.Combine(runRoot, "export.json"), 4 * 1024 * 1024)));
            Assert.That(receipt, Is.Not.Null);
            Assert.That(receipt.schemaVersion, Is.EqualTo(1));
            Assert.That(receipt.token, Is.EqualTo(owner.token));
            Assert.That(receipt.sourceSha, Is.EqualTo(owner.sourceSha));
            Assert.That(receipt.editor, Is.EqualTo(owner.editor));
            Assert.That(receipt.clonePath, Is.EqualTo(Relative(workspace, clone)));
            Assert.That(File.Exists(Path.Combine(clone, TeamForgeCloneBootstrap.RelativePath)), Is.False);

            var loaded = PackageInfo.FindForAssembly(typeof(TeamForgeTestLab).Assembly);
            Assert.That(loaded, Is.Not.Null);
            Assert.That(loaded.name, Is.EqualTo(PackageName));
            Assert.That(loaded.name, Is.EqualTo(receipt.packageName));
            Assert.That(loaded.version, Is.EqualTo(receipt.packageVersion));
            Assert.That(loaded.source, Is.EqualTo(PackageSource.Embedded));
            AssertSamePath(loaded.resolvedPath, Path.Combine(clone, "Packages", PackageName));
            var proof = new Probe
            {
                token = token,
                sourceSha = owner.sourceSha,
                editor = Application.unityVersion,
                clonePath = receipt.clonePath,
                packageName = loaded.name,
                packageVersion = loaded.version,
                packageSource = loaded.source.ToString(),
            };
            WriteNew(Path.Combine(runRoot, "probe.json"), Utf8.GetBytes(JsonUtility.ToJson(proof, true)));
            TestContext.Progress.WriteLine("A separate clone Editor loaded its own embedded TeamForge package and executed this compiled probe.");
        }

        private static string EnabledRun(string flag)
        {
            var arguments = Environment.GetCommandLineArgs();
            if (!arguments.Contains(flag)) Assert.Ignore("This stage requires its explicit CI clone-probe flag.");
            Assert.That(Application.isBatchMode, Is.True, "The persisted clone probe runs only in batch mode.");
            Assert.That(arguments.Count(value => value == flag), Is.EqualTo(1));
            Assert.That(arguments.Count(value => value == "-teamforgeCiCloneRun"), Is.EqualTo(1));
            var position = Array.IndexOf(arguments, "-teamforgeCiCloneRun");
            Assert.That(position + 1, Is.LessThan(arguments.Length));
            var token = arguments[position + 1];
            Assert.That(Regex.IsMatch(token, @"\A[0-9]{1,20}-[0-9]{1,10}-[0-9a-f]{32}\z"), Is.True);
            return token;
        }

        private static string RunRoot(string workspace, string token)
        {
            var path = Path.Combine(workspace, "test-results", "clone-editor", token);
            RequireDirectDirectory(path);
            return path;
        }

        private static Owner ReadOwner(string runRoot, string token)
        {
            var owner = JsonUtility.FromJson<Owner>(Utf8.GetString(ReadBytes(Path.Combine(runRoot, "owner.json"), 4096)));
            Assert.That(owner, Is.Not.Null);
            Assert.That(owner.schemaVersion, Is.EqualTo(1));
            Assert.That(owner.token, Is.EqualTo(token));
            Assert.That(token, Does.StartWith(owner.runId + "-" + owner.runAttempt + "-"));
            Assert.That(owner.sourceSha, Does.Match(@"\A[0-9a-f]{40}\z"));
            Assert.That(owner.editor, Is.EqualTo(BaselineEditor));
            Assert.That(Application.unityVersion, Is.EqualTo(owner.editor));
            return owner;
        }

        private static PackageFile[] CapturePackageFiles(string root)
        {
            var result = new List<PackageFile>();
            long totalBytes = 0;
            var entries = 0;
            CaptureDirectory(root, root, result, 0, ref entries, ref totalBytes);
            return result.OrderBy(file => file.path, StringComparer.Ordinal).ToArray();
        }

        private static void CaptureDirectory(string root, string directory, List<PackageFile> result,
            int depth, ref int entries, ref long totalBytes)
        {
            Assert.That(depth, Is.LessThanOrEqualTo(64));
            RequireDirectDirectory(directory);
            foreach (var entry in Directory.EnumerateFileSystemEntries(directory))
            {
                Assert.That(++entries, Is.LessThanOrEqualTo(20000));
                var attributes = File.GetAttributes(entry);
                Assert.That(attributes & FileAttributes.ReparsePoint, Is.EqualTo((FileAttributes)0));
                var name = Path.GetFileName(entry);
                if ((attributes & FileAttributes.Directory) != 0)
                {
                    if (TeamForgeTestLab.IsExcludedDirectoryName(name) || name.Equals(".svn", StringComparison.OrdinalIgnoreCase)) continue;
                    CaptureDirectory(root, entry, result, depth + 1, ref entries, ref totalBytes);
                    continue;
                }
                if (name.Equals(".git", StringComparison.OrdinalIgnoreCase)) continue;
                // TryPrepare/TryApply already reject static special files before
                // this inventory of their hash-verified source and fresh copy.
                using (var stream = new FileStream(entry, FileMode.Open, FileAccess.Read, FileShare.Read))
                using (var hash = SHA256.Create())
                {
                    var length = stream.Length;
                    totalBytes += length;
                    Assert.That(totalBytes, Is.LessThanOrEqualTo(MaximumPackageBytes));
                    result.Add(new PackageFile { path = Relative(root, entry), length = length, sha256 = Hex(hash.ComputeHash(stream)) });
                }
            }
        }

        private static string FileIdentity(PackageFile file) => file.path + "\0" + file.length + "\0" + file.sha256;

        private static string Relative(string root, string path)
        {
            root = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar);
            path = Path.GetFullPath(path);
            Assert.That(path.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.Ordinal), Is.True);
            return path.Substring(root.Length + 1).Replace(Path.DirectorySeparatorChar, '/');
        }

        private static void RequireDirectDirectory(string directory)
        {
            for (var current = new DirectoryInfo(directory); current != null; current = current.Parent)
            {
                Assert.That(current.Exists, Is.True, "The owned clone path must already exist.");
                Assert.That(current.Attributes & FileAttributes.ReparsePoint, Is.EqualTo((FileAttributes)0));
            }
        }

        private static void AssertSamePath(string actual, string expected)
        {
            Assert.That(Path.GetFullPath(actual).TrimEnd(Path.DirectorySeparatorChar),
                Is.EqualTo(Path.GetFullPath(expected).TrimEnd(Path.DirectorySeparatorChar)));
        }

        private static byte[] ReadBytes(string path, int maximum = 1024 * 1024)
        {
            Assert.That(new FileInfo(path).Length, Is.LessThanOrEqualTo(maximum));
            return File.ReadAllBytes(path);
        }

        private static void WriteNew(string path, byte[] bytes)
        {
            using (var stream = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                stream.Write(bytes, 0, bytes.Length);
        }

        private static string Hash(byte[] bytes)
        {
            using (var hash = SHA256.Create()) return Hex(hash.ComputeHash(bytes));
        }

        private static string Hex(byte[] bytes) => BitConverter.ToString(bytes).Replace("-", string.Empty).ToLowerInvariant();

        private static void CopyProject(string source, string clone)
        {
            var copier = typeof(TeamForgeTestLab).GetMethod("CopyProjectFastestAvailable", BindingFlags.NonPublic | BindingFlags.Static);
            Assert.That(copier, Is.Not.Null);
            try { copier.Invoke(null, new object[] { source, clone }); }
            finally { EditorUtility.ClearProgressBar(); }
        }
    }
}

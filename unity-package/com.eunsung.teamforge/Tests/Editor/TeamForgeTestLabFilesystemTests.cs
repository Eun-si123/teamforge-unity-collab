using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using NUnit.Framework;

namespace EunSung.TeamForge.Tests
{
    public sealed class TeamForgeTestLabFilesystemTests
    {
        private string _root;
        private string _source;
        private string _destination;
        private readonly List<string> _links = new List<string>();

        [SetUp]
        public void SetUp()
        {
            var temporaryRoot = Path.GetTempPath();
            if (Path.DirectorySeparatorChar != '\\')
            {
                // macOS commonly exposes its temp root through /var -> /private/var.
                // Success fixtures need a direct destination, like real callers do.
                var start = new ProcessStartInfo
                {
                    FileName = "/bin/pwd",
                    Arguments = "-P",
                    WorkingDirectory = temporaryRoot,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                };
                using (var process = Process.Start(start))
                {
                    Assert.That(process, Is.Not.Null);
                    if (!process.WaitForExit(10000))
                    {
                        process.Kill();
                        Assert.Fail("Physical temporary-directory lookup did not finish.");
                    }
                    Assert.That(process.ExitCode, Is.EqualTo(0), process.StandardError.ReadToEnd());
                    temporaryRoot = process.StandardOutput.ReadToEnd().TrimEnd('\r', '\n');
                }
            }
            _root = Path.Combine(temporaryRoot, "teamforge-lab-fs-" + Guid.NewGuid().ToString("N"));
            _source = Path.Combine(_root, "source");
            _destination = Path.Combine(_root, "labs");
            Directory.CreateDirectory(_source);
            File.WriteAllText(Path.Combine(_source, "baseline.txt"), "saved baseline");
        }

        [TearDown]
        public void TearDown()
        {
            // Remove only links created by this fixture before recursive cleanup.
            foreach (var link in _links)
            {
                Directory.Delete(link);
            }
            _links.Clear();
            if (Directory.Exists(_root)) Directory.Delete(_root, true);
        }

        [Test]
        public void AllocationKeepsExistingFixedRoleFoldersAndTheirEdits()
        {
            foreach (var role in new[] { "B", "C", "D" })
            {
                var old = Path.Combine(_destination, "TF-" + role);
                Directory.CreateDirectory(old);
                File.WriteAllText(Path.Combine(old, "edits.txt"), "keep " + role);
            }

            Assert.That(TeamForgeTestLab.TryAllocateCloneDirectories(
                _source, _destination, 3, out var paths, out var error), Is.True, error);
            Assert.That(paths.Count, Is.EqualTo(3));
            Assert.That(paths.All(Directory.Exists), Is.True);
            Assert.That(paths.All(p => Path.GetDirectoryName(p) == _destination), Is.True,
                "Clones must keep the existing directory depth for relative package paths.");
            Assert.That(paths.Select(p => Path.GetFileName(p).Substring(5)).Distinct().Count(), Is.EqualTo(1),
                "B/C/D from one invocation must share their batch identity.");
            for (var index = 0; index < paths.Count; index += 1)
            {
                var role = ((char)('B' + index)).ToString();
                Assert.That(Path.GetFileName(paths[index]), Does.StartWith("TF-" + role + "-"));
                Assert.That(File.ReadAllText(Path.Combine(_destination, "TF-" + role, "edits.txt")),
                    Is.EqualTo("keep " + role));
            }
        }

        [Test]
        public void AnotherRunKeepsPreviousCloneFilesAndAllocatesDisjointFolders()
        {
            Assert.That(TeamForgeTestLab.TryAllocateCloneDirectories(
                _source, _destination, 2, out var first, out var firstError), Is.True, firstError);
            foreach (var clone in first) File.WriteAllText(Path.Combine(clone, "work.txt"), "previous edits");

            Assert.That(TeamForgeTestLab.TryAllocateCloneDirectories(
                _source, _destination, 2, out var next, out var nextError), Is.True, nextError);
            Assert.That(next.Intersect(first), Is.Empty);
            foreach (var clone in first)
            {
                Assert.That(File.ReadAllText(Path.Combine(clone, "work.txt")), Is.EqualTo("previous edits"));
            }
            Assert.That(Directory.GetDirectories(_destination).Length, Is.EqualTo(4));
            Assert.That(File.ReadAllText(Path.Combine(_source, "baseline.txt")), Is.EqualTo("saved baseline"));
        }

        [Test]
        public void ConcurrentRunsAllocateSeparateClones()
        {
            var runs = Enumerable.Range(0, 4).Select(_ => Task.Run(() =>
            {
                if (!TeamForgeTestLab.TryAllocateCloneDirectories(
                    _source, _destination, 2, out var paths, out var error))
                {
                    throw new InvalidOperationException(error);
                }
                return paths;
            })).ToArray();
            Assert.That(Task.WaitAll(runs, TimeSpan.FromSeconds(10)), Is.True);
            var paths = runs.SelectMany(task => task.Result).ToArray();
            Assert.That(paths.Length, Is.EqualTo(8));
            Assert.That(paths.Distinct().Count(), Is.EqualTo(8));
            Assert.That(paths.All(Directory.Exists), Is.True);
        }

        [TestCase(0)]
        [TestCase(4)]
        public void InvalidCountDoesNotCreateDestination(int count)
        {
            Assert.That(TeamForgeTestLab.TryAllocateCloneDirectories(
                _source, _destination, count, out var paths, out _), Is.False);
            Assert.That(paths, Is.Empty);
            Assert.That(Directory.Exists(_destination), Is.False);
        }

        [TestCase(null)]
        [TestCase("")]
        [TestCase(" ")]
        [TestCase("relative-lab")]
        [TestCase("bad\0path")]
        public void InvalidDestinationDoesNotCreateFolders(string destination)
        {
            Assert.That(TeamForgeTestLab.TryAllocateCloneDirectories(
                _source, destination, 1, out var paths, out _), Is.False);
            Assert.That(paths, Is.Empty);
            Assert.That(Directory.GetFileSystemEntries(_root).Length, Is.EqualTo(1));
        }

#if UNITY_EDITOR_WIN
        [TestCase(@"C:relative-lab")]
        [TestCase(@"\root-relative-lab")]
        public void WindowsPartiallyRootedDestinationsAreRejected(string destination)
        {
            Assert.That(TeamForgeTestLab.TryAllocateCloneDirectories(
                _source, destination, 1, out var paths, out _), Is.False);
            Assert.That(paths, Is.Empty);
            Assert.That(Directory.GetFileSystemEntries(_root).Length, Is.EqualTo(1));
        }
#endif

        [Test]
        public void SourceEqualDescendantAncestorAndVolumeRootAreRejected()
        {
            foreach (var destination in new[] { _source, Path.Combine(_source, "nested"), _root, Path.GetPathRoot(_source) })
            {
                Assert.That(TeamForgeTestLab.TryAllocateCloneDirectories(
                    _source, destination, 1, out var paths, out _), Is.False, destination);
                Assert.That(paths, Is.Empty);
            }
            Assert.That(Directory.GetFileSystemEntries(_root).Length, Is.EqualTo(1));
        }

        [Test]
        public void UnavailableSourceDoesNotCreateDestination()
        {
            Assert.That(TeamForgeTestLab.TryAllocateCloneDirectories(
                Path.Combine(_root, "missing"), _destination, 1, out var paths, out _), Is.False);
            Assert.That(paths, Is.Empty);
            Assert.That(Directory.Exists(_destination), Is.False);
        }

        [Test]
        public void FileAtDestinationOrItsAncestorIsPreserved()
        {
            File.WriteAllText(_destination, "unrelated file");
            foreach (var destination in new[] { _destination, Path.Combine(_destination, "child") })
            {
                Assert.That(TeamForgeTestLab.TryAllocateCloneDirectories(
                    _source, destination, 1, out var paths, out _), Is.False);
                Assert.That(paths, Is.Empty);
                Assert.That(File.ReadAllText(_destination), Is.EqualTo("unrelated file"));
            }
        }

        [Test]
        public void RedirectedDestinationOrAncestorIsRejectedWithoutWritingToTarget()
        {
            var target = Path.Combine(_root, "linked-target");
            Directory.CreateDirectory(target);
            File.WriteAllText(Path.Combine(target, "keep.txt"), "unrelated project");
            CreateDirectoryLink(_destination, target);

            foreach (var destination in new[] { _destination, Path.Combine(_destination, "new-lab") })
            {
                Assert.That(TeamForgeTestLab.TryAllocateCloneDirectories(
                    _source, destination, 2, out var paths, out var error), Is.False);
                Assert.That(error, Does.Contain("reparse point"));
                Assert.That(paths, Is.Empty);
                Assert.That(Directory.GetFileSystemEntries(target).Length, Is.EqualTo(1));
                Assert.That(File.ReadAllText(Path.Combine(target, "keep.txt")), Is.EqualTo("unrelated project"));
            }
        }

        [Test]
        public void SourceAliasCanCreateClonesInAnExternalDirectDestination()
        {
            var alias = Path.Combine(_root, "source-alias");
            CreateDirectoryLink(alias, _source);
            Assert.That(TeamForgeTestLab.TryAllocateCloneDirectories(
                alias, _destination, 2, out var paths, out var error), Is.True, error);
            Assert.That(paths.Count, Is.EqualTo(2));
            Assert.That(paths.All(Directory.Exists), Is.True);
        }

        [Test]
        public void CanonicalDestinationInsideAnAliasedSourceIsRejectedBeforeCreation()
        {
            var alias = Path.Combine(_root, "source-alias");
            CreateDirectoryLink(alias, _source);
            var nested = Path.Combine(_source, "labs");
            Assert.That(TeamForgeTestLab.TryAllocateCloneDirectories(
                alias, nested, 2, out var paths, out _), Is.False);
            Assert.That(paths, Is.Empty);
            Assert.That(Directory.Exists(nested), Is.False);
            Assert.That(File.ReadAllText(Path.Combine(_source, "baseline.txt")), Is.EqualTo("saved baseline"));
        }

        private void CreateDirectoryLink(string alias, string target)
        {
            var windows = Path.DirectorySeparatorChar == '\\';
            var start = new ProcessStartInfo
            {
                FileName = windows ? "cmd.exe" : "/bin/ln",
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            if (windows)
            {
                start.ArgumentList.Add("/d");
                start.ArgumentList.Add("/c");
                start.ArgumentList.Add("mklink");
                start.ArgumentList.Add("/J");
            }
            else
            {
                start.ArgumentList.Add("-s");
            }
            start.ArgumentList.Add(windows ? alias : target);
            start.ArgumentList.Add(windows ? target : alias);
            using (var process = Process.Start(start))
            {
                Assert.That(process, Is.Not.Null);
                if (!process.WaitForExit(10000))
                {
                    process.Kill();
                    Assert.Fail("Directory-link fixture did not finish.");
                }
                Assert.That(process.ExitCode, Is.EqualTo(0), process.StandardError.ReadToEnd());
            }
            _links.Add(alias);
        }
    }
}

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Threading.Tasks;
using NUnit.Framework;

namespace EunSung.TeamForge.Tests
{
    public sealed class TeamForgeTestLabPackageSnapshotTests
    {
        private const string PackageName = "com.eunsung.teamforge";
        private const string Version = "0.5.1";
        private const string ExternalReference = "file:../../external/com.eunsung.teamforge";
        private const string Manifest = @"{
  ""__type"": ""user:project"",
  ""dependencies"": {
    ""com.eunsung.teamforge"": ""file:../../external/com.eunsung.teamforge"",
    ""com.example.pinned"": ""1.2.3""
  },
  ""testables"": [""com.eunsung.teamforge""],
  ""scopedRegistries"": [{""name"":""Fixture"",""url"":""https://example.invalid/registry"",""scopes"":[""com.example""]}],
  ""future"": {
    ""__type"": ""custom:opaque"",
    ""__proto__"": {""sentinel"": ""keep""},
    ""one two"": {""a/b"": ""keep < > & text""},
    ""unicode"": ""한글 \ud83d\ude00 \u00e9"",
    ""large"": 1234567890123456789012345678901234567890,
    ""precise"": 0.123456789012345678901234567890,
    ""arbitraryNumber"": 17,
    ""emptyString"": """", ""spaces"": ""   "",
    ""null"": null, ""true"": true, ""false"": false,
    ""emptyObject"": {}, ""emptyArray"": [],
    ""unknownArray"": [null, true, ""한글"", {""keep"": [1, 2]}]
  }
}";
        private const string Lock = @"{
  ""dependencies"": {
    ""com.eunsung.teamforge"": {""version"":""file:../../external/com.eunsung.teamforge"",""depth"":0,""source"":""local"",""dependencies"":{}},
    ""com.example.pinned"": {""version"":""1.2.3"",""depth"":0,""source"":""registry"",""dependencies"":{},""url"":""https://example.invalid/registry""}
  },
  ""future"": {""unknown"": [1, true, null]}
}";

        private string _root;
        private string _source;
        private string _package;
        private readonly List<KeyValuePair<string, bool>> _links = new List<KeyValuePair<string, bool>>();

        private string SourceManifest => Path.Combine(_source, "Packages", "manifest.json");
        private string SourceLock => Path.Combine(_source, "Packages", "packages-lock.json");

        [SetUp]
        public void SetUp()
        {
            _root = Path.Combine(PhysicalTemporaryRoot(), "teamforge-lab-package-" + Guid.NewGuid().ToString("N"));
            _source = Path.Combine(_root, "Project");
            _package = Path.Combine(_root, "external", PackageName);
            Directory.CreateDirectory(Path.Combine(_source, "Packages"));
            Write(SourceManifest, Manifest);
            Write(SourceLock, Lock);
            Write(Path.Combine(_source, "Assets", "keep.txt"), "original project asset");
            Write(Path.Combine(_package, "package.json"), "{\"name\":\"" + PackageName + "\",\"version\":\"" + Version + "\",\"dependencies\":{}}");
            Write(Path.Combine(_package, "Editor", "Nested", "Fixture.cs"), "// snapshot source\n");
            Write(Path.Combine(_package, "Editor", "Nested", "Fixture.cs.meta"), "fileFormatVersion: 2\nguid: 00000000000000000000000000000111\n");
            Write(Path.Combine(_package, "Editor", "Nested.meta"), "fileFormatVersion: 2\nguid: 00000000000000000000000000000112\n");
            Write(Path.Combine(_package, "Runtime~", "fixture-data.txt"), "runtime payload fixture\n");
            File.WriteAllBytes(Path.Combine(_package, "Runtime~", "fixture-data.bin"), new byte[] { 0, 1, 255, 192, 128, 0, 42 });
        }

        [TearDown]
        public void TearDown()
        {
            foreach (var link in _links)
            {
                if (link.Value) Directory.Delete(link.Key);
                else File.Delete(link.Key);
            }
            _links.Clear();
            if (Directory.Exists(_root)) Directory.Delete(_root, true);
        }

        [Test]
        public void CopiesNestedPackageAndMetaBytesAndOnlyChangesTheCloneDependency()
        {
            var original = CaptureFiles(_root);
            var snapshot = Prepare();
            var clone = CreateClone("new-clone");

            Assert.That(snapshot.TryApply(clone, out var error), Is.True, error);
            var embedded = Path.Combine(clone, "Packages", PackageName);
            var originals = CaptureFiles(_package);
            Assert.That(CaptureFiles(embedded).Keys, Is.EquivalentTo(originals.Keys));
            foreach (var file in originals)
            {
                Assert.That(File.ReadAllBytes(Path.Combine(embedded, file.Key)), Is.EqualTo(file.Value), file.Key);
            }
            AssertManifestOnlyChangesTeamForge(Manifest, File.ReadAllText(Path.Combine(clone, "Packages", "manifest.json")));
            Assert.That(File.ReadAllBytes(Path.Combine(clone, "Packages", "packages-lock.json")),
                Is.EqualTo(File.ReadAllBytes(SourceLock)), "UPM must retain its original lock pins until actual resolution.");
            AssertOriginalFilesUnchanged(original);
        }

        [Test]
        public void APreparedSnapshotCanCreateTwoIndependentClonesWithoutChangingAnEarlierClone()
        {
            var snapshot = Prepare();
            var first = CreateClone("clone-one");
            Assert.That(snapshot.TryApply(first, out var firstError), Is.True, firstError);
            var firstScript = Path.Combine(first, "Packages", PackageName, "Editor", "Nested", "Fixture.cs");
            Write(firstScript, "// edits in an earlier clone\n");
            var oldClone = CaptureFiles(first);
            var source = CaptureFiles(_source);

            var second = CreateClone("clone-two");
            Assert.That(snapshot.TryApply(second, out var secondError), Is.True, secondError);
            Assert.That(File.ReadAllText(Path.Combine(second, "Packages", PackageName, "Editor", "Nested", "Fixture.cs")),
                Is.EqualTo("// snapshot source\n"));
            Assert.That(File.ReadAllText(firstScript), Is.EqualTo("// edits in an earlier clone\n"));
            AssertFilesEqual(first, oldClone);
            AssertFilesEqual(_source, source);
        }

        [TestCase(true)]
        [TestCase(false)]
        public void ExistingPackageTargetIsRefusedAndItsWorkIsKept(bool directory)
        {
            var snapshot = Prepare();
            var clone = CreateClone("occupied-clone");
            var occupied = Path.Combine(clone, "Packages", PackageName);
            Write(directory ? Path.Combine(occupied, "work.txt") : occupied, "unrelated existing package");
            var before = CaptureFiles(clone);
            Assert.That(snapshot.TryApply(clone, out _), Is.False);
            AssertFilesEqual(clone, before);
        }

        [TestCase("manifest.json")]
        [TestCase("packages-lock.json")]
        public void ChangedCloneManifestOrLockIsRefusedWithoutOverwritingIt(string file)
        {
            var snapshot = Prepare();
            var clone = CreateClone("changed-clone");
            var changed = Path.Combine(clone, "Packages", file);
            Write(changed, File.ReadAllText(changed) + "\n ");
            var before = CaptureFiles(clone);
            Assert.That(snapshot.TryApply(clone, out _), Is.False);
            AssertFilesEqual(clone, before);
        }

        [Test]
        public void PackageChangedAfterPrepareCannotBeReportedAsTheVerifiedSnapshot()
        {
            var snapshot = Prepare();
            var clone = CreateClone("stale-snapshot-clone");
            var script = Path.Combine(_package, "Editor", "Nested", "Fixture.cs");
            Write(script, "// changed after preparation\n");
            var beforeManifest = File.ReadAllBytes(Path.Combine(clone, "Packages", "manifest.json"));
            Assert.That(snapshot.TryApply(clone, out _), Is.False);
            Assert.That(File.ReadAllText(script), Is.EqualTo("// changed after preparation\n"));
            Assert.That(File.ReadAllBytes(Path.Combine(clone, "Packages", "manifest.json")), Is.EqualTo(beforeManifest));
        }

        [Test]
        public void AdditionalExternalLocalPackageIsRefusedBeforeCloneCreation()
        {
            Write(SourceManifest, Manifest.Replace("\"com.example.pinned\": \"1.2.3\"",
                "\"com.example.pinned\": \"file:../../external/another-package\""));
            var error = AssertPrepareFails();
            Assert.That(error, Does.Contain("Embed").IgnoreCase, "The refusal must explain the supported recovery action.");
        }

        [Test]
        public void InternalLocalDependencyInsideACloneExcludedFolderIsRefused()
        {
            var hiddenPackage = Path.Combine(_source, "Library", "com.example.pinned");
            Write(Path.Combine(hiddenPackage, "package.json"), "{\"name\":\"com.example.pinned\",\"version\":\"1.2.3\"}");
            Write(SourceManifest, Manifest.Replace("\"com.example.pinned\": \"1.2.3\"",
                "\"com.example.pinned\": \"file:../Library/com.example.pinned\""));
            AssertPrepareFails();
        }

        [TestCase("file")]
        [TestCase("directory")]
        [TestCase("delete")]
        public void PackageInventoryChangesAfterPrepareAreRefused(string change)
        {
            var snapshot = Prepare();
            var clone = CreateClone("inventory-change-clone");
            if (change == "file") Write(Path.Combine(_package, "Editor", "Added.cs"), "// newly added source\n");
            else if (change == "directory") Directory.CreateDirectory(Path.Combine(_package, "Editor", "NewEmpty"));
            else File.Delete(Path.Combine(_package, "Editor", "Nested", "Fixture.cs"));
            var manifestBefore = File.ReadAllBytes(Path.Combine(clone, "Packages", "manifest.json"));
            Assert.That(snapshot.TryApply(clone, out _), Is.False);
            Assert.That(File.ReadAllBytes(Path.Combine(clone, "Packages", "manifest.json")), Is.EqualTo(manifestBefore));
        }

        [TestCase(true)]
        [TestCase(false)]
        public void PackageGitDirectoryOrWorktreePointerIsNotCopied(bool directory)
        {
            var metadata = Path.Combine(_package, ".git");
            Write(directory ? Path.Combine(metadata, "config") : metadata, "fixture worktree metadata\n");
            var snapshot = Prepare();
            var clone = CreateClone("git-metadata-clone");
            Assert.That(snapshot.TryApply(clone, out var error), Is.True, error);
            var clonedMetadata = Path.Combine(clone, "Packages", PackageName, ".git");
            Assert.That(File.Exists(clonedMetadata) || Directory.Exists(clonedMetadata), Is.False);
            Assert.That(File.ReadAllText(directory ? Path.Combine(metadata, "config") : metadata),
                Is.EqualTo("fixture worktree metadata\n"));
        }

        [Test]
        public void EmptyPackageDirectoryAndItsMetaFileArePreserved()
        {
            Directory.CreateDirectory(Path.Combine(_package, "Editor", "Empty"));
            Write(Path.Combine(_package, "Editor", "Empty.meta"), "fileFormatVersion: 2\nguid: 00000000000000000000000000000113\n");
            var snapshot = Prepare();
            var clone = CreateClone("empty-directory-clone");
            Assert.That(snapshot.TryApply(clone, out var error), Is.True, error);
            Assert.That(Directory.Exists(Path.Combine(clone, "Packages", PackageName, "Editor", "Empty")), Is.True);
            Assert.That(File.ReadAllBytes(Path.Combine(clone, "Packages", PackageName, "Editor", "Empty.meta")),
                Is.EqualTo(File.ReadAllBytes(Path.Combine(_package, "Editor", "Empty.meta"))));
        }

        [Test]
        public void ManifestBomAstralPrefixAndUnknownFieldsKeepTheirExactBytes()
        {
            const string escapedReference = @"file:..\/..\/external\/com.eunsung.teamforge";
            var original = "\ufeff" + Manifest
                .Replace("\"__type\": \"user:project\"", "\"__type\": 123456789012345678901234567890")
                .Replace("\"dependencies\": {", "\"astralPrefix\": \"😀\\t\\u0061\",\n  \"dependencies\": {")
                .Replace(ExternalReference, escapedReference);
            Write(SourceManifest, original);
            var snapshot = Prepare();
            var clone = CreateClone("exact-bytes-clone");
            Assert.That(snapshot.TryApply(clone, out var error), Is.True, error);
            var expected = original.Replace("\"" + escapedReference + "\"", "\"file:" + PackageName + "\"");
            Assert.That(File.ReadAllBytes(Path.Combine(clone, "Packages", "manifest.json")), Is.EqualTo(Encoding.UTF8.GetBytes(expected)));
            Assert.That(File.ReadAllBytes(SourceManifest), Is.EqualTo(Encoding.UTF8.GetBytes(original)));
        }

        [TestCase(true)]
        [TestCase(false)]
        public void ProductionProjectCopierOmitsGitMetadataButKeepsAssetsAndMeta(bool directory)
        {
            var metadata = Path.Combine(_source, ".git");
            Write(directory ? Path.Combine(metadata, "config") : metadata, "fixture project worktree metadata\n");
            Write(Path.Combine(_source, "Assets", "keep.txt.meta"), "fileFormatVersion: 2\nguid: 00000000000000000000000000000114\n");
            var clone = Path.Combine(_root, "real-copier-clone");
            var copier = typeof(TeamForgeTestLab).GetMethod("CopyProjectFastestAvailable", BindingFlags.NonPublic | BindingFlags.Static);
            Assert.That(copier, Is.Not.Null);
            try
            {
                copier.Invoke(null, new object[] { _source, clone });
            }
            finally
            {
#if UNITY_EDITOR
                UnityEditor.EditorUtility.ClearProgressBar();
#endif
            }
            Assert.That(File.Exists(Path.Combine(clone, ".git")) || Directory.Exists(Path.Combine(clone, ".git")), Is.False);
            Assert.That(File.ReadAllBytes(Path.Combine(clone, "Assets", "keep.txt")), Is.EqualTo(File.ReadAllBytes(Path.Combine(_source, "Assets", "keep.txt"))));
            Assert.That(File.ReadAllBytes(Path.Combine(clone, "Assets", "keep.txt.meta")), Is.EqualTo(File.ReadAllBytes(Path.Combine(_source, "Assets", "keep.txt.meta"))));
            Assert.That(File.ReadAllText(directory ? Path.Combine(metadata, "config") : metadata), Is.EqualTo("fixture project worktree metadata\n"));
        }

#if UNITY_EDITOR
        [Test]
        public void LoadedUnityPackageCanPrepareAndApplyItsApplicableSnapshot()
        {
            var loaded = UnityEditor.PackageManager.PackageInfo.FindForAssembly(typeof(TeamForgeTestLab).Assembly);
            Assert.That(loaded, Is.Not.Null);
            Assert.That(loaded.name, Is.EqualTo(PackageName));
            Assert.That(loaded.version, Is.Not.Null.And.Not.Empty);
            var project = Directory.GetParent(UnityEngine.Application.dataPath).FullName;
            var sourceManifest = Path.Combine(project, "Packages", "manifest.json");
            var sourceLock = Path.Combine(project, "Packages", "packages-lock.json");
            var originalManifest = File.ReadAllBytes(sourceManifest);
            var originalLock = File.Exists(sourceLock) ? File.ReadAllBytes(sourceLock) : null;
            var sourcePackageEntry = Path.Combine(project, "Packages", PackageName);
            var sourcePackageListed = Directory.EnumerateDirectories(Path.Combine(project, "Packages"))
                .Any(path => string.Equals(Path.GetFileName(path), PackageName, StringComparison.OrdinalIgnoreCase));
            TestContext.Progress.WriteLine("Test Lab source package entry: exists=" + Directory.Exists(sourcePackageEntry) +
                ", enumerated=" + sourcePackageListed);
            Assert.That(TeamForgeTestLabPackageSnapshot.TryPrepare(project, loaded.resolvedPath, loaded.version,
                out var snapshot, out var prepareError), Is.True, prepareError);
            if (snapshot == null)
            {
                Assert.Ignore("The loaded package uses a registry or internal reference; an external local-package snapshot was not exercised.");
            }
            var clone = Path.Combine(_root, "actual-unity-package-clone");
            CopyProjectForTest(project, clone);
            TestContext.Progress.WriteLine("Test Lab copied package entry: exists=" +
                Directory.Exists(Path.Combine(clone, "Packages", PackageName)));
            Assert.That(snapshot.TryApply(clone, out var applyError), Is.True, applyError);
            Assert.That(File.Exists(Path.Combine(clone, "Packages", PackageName, "package.json")), Is.True);
            Assert.That(File.Exists(Path.Combine(clone, "Packages", PackageName, "Editor", "Testing", "TeamForgeTestLab.cs")), Is.True);
            Assert.That(File.ReadAllText(Path.Combine(clone, "Packages", "manifest.json")), Does.Contain("\"file:" + PackageName + "\""));
            Assert.That(File.ReadAllBytes(sourceManifest), Is.EqualTo(originalManifest));
            Assert.That(File.Exists(sourceLock), Is.EqualTo(originalLock != null));
            if (originalLock != null)
            {
                Assert.That(File.ReadAllBytes(sourceLock), Is.EqualTo(originalLock));
                Assert.That(File.ReadAllBytes(Path.Combine(clone, "Packages", "packages-lock.json")), Is.EqualTo(originalLock));
            }
        }
#endif

        [Test]
        public void LocalDependencyInsideTheTeamForgePackageRequiresExplicitHandling()
        {
            Write(Path.Combine(_package, "package.json"), "{\"name\":\"" + PackageName +
                "\",\"version\":\"" + Version + "\",\"dependencies\":{\"com.example.nested\":\"file:../nested\"}}");
            AssertPrepareFails();
        }

        [TestCase("com.example.other", Version)]
        [TestCase(PackageName, "9.9.9")]
        public void PackageIdentityMustMatchTheLoadedTeamForgePackage(string name, string version)
        {
            Write(Path.Combine(_package, "package.json"), "{\"name\":\"" + name + "\",\"version\":\"" + version + "\"}");
            AssertPrepareFails();
        }

        [Test]
        public void LoadedPackageVersionMustMatchTheVerifiedSourcePackage()
        {
            Assert.That(TeamForgeTestLabPackageSnapshot.TryPrepare(_source, _package, "9.9.9", out var snapshot, out _), Is.False);
            Assert.That(snapshot, Is.Null);
        }

        [Test]
        public void ASeparatePackageWithTheSameNameAndVersionCannotReplaceTheLoadedSource()
        {
            var unrelated = Path.Combine(_root, "unrelated-package");
            Write(Path.Combine(unrelated, "package.json"), File.ReadAllText(Path.Combine(_package, "package.json")));
            Assert.That(TeamForgeTestLabPackageSnapshot.TryPrepare(_source, unrelated, Version,
                out var snapshot, out _), Is.False);
            Assert.That(snapshot, Is.Null);
        }

        [Test]
        public void RegistryDependencyNeedsNoLocalSnapshot()
        {
            Write(SourceManifest, Manifest.Replace(ExternalReference, Version));
            Assert.That(TeamForgeTestLabPackageSnapshot.TryPrepare(_source, _package, Version,
                out var snapshot, out var error), Is.True, error);
            Assert.That(snapshot, Is.Null);
        }

        [TestCase(".tgz", false)]
        [TestCase(".TGZ", false)]
        [TestCase(".tgz", true)]
        [TestCase(".TGZ", true)]
        public void ProductionProjectCopierKeepsInternalTarballsOpaque(string extension, bool externalTeamForge)
        {
            var reference = "file:../LocalPackages/foo" + extension;
            var manifest = (externalTeamForge ? Manifest : Manifest.Replace(ExternalReference, Version))
                .Replace("\"com.example.pinned\": \"1.2.3\"", "\"com.example.pinned\": \"1.2.3\",\n    \"com.example.archive\": \"" + reference + "\"");
            Write(SourceManifest, manifest);
            var tarball = Path.Combine(_source, "LocalPackages", "foo" + extension);
            Directory.CreateDirectory(Path.GetDirectoryName(tarball));
            // Deliberately not a real archive: Test Lab must preserve opaque bytes,
            // leaving package extraction and resolution to a real Unity UPM run.
            var opaque = new byte[] { 0, 255, 192, 128, 42, 0, 17 };
            File.WriteAllBytes(tarball, opaque);
            var original = CaptureFiles(_source);
            Assert.That(TeamForgeTestLabPackageSnapshot.TryPrepare(_source, _package, Version,
                out var snapshot, out var prepareError), Is.True, prepareError);
            Assert.That(snapshot != null, Is.EqualTo(externalTeamForge));
            var clone = Path.Combine(_root, "opaque-tarball-clone");
            var copier = typeof(TeamForgeTestLab).GetMethod("CopyProjectFastestAvailable", BindingFlags.NonPublic | BindingFlags.Static);
            Assert.That(copier, Is.Not.Null);
            try
            {
                copier.Invoke(null, new object[] { _source, clone });
            }
            finally
            {
#if UNITY_EDITOR
                UnityEditor.EditorUtility.ClearProgressBar();
#endif
            }
            if (snapshot != null) Assert.That(snapshot.TryApply(clone, out var applyError), Is.True, applyError);
            var expectedManifest = externalTeamForge ? manifest.Replace(ExternalReference, "file:" + PackageName) : manifest;
            Assert.That(File.ReadAllBytes(Path.Combine(clone, "Packages", "manifest.json")), Is.EqualTo(Encoding.UTF8.GetBytes(expectedManifest)));
            Assert.That(File.ReadAllBytes(Path.Combine(clone, "Packages", "packages-lock.json")), Is.EqualTo(original[Path.Combine("Packages", "packages-lock.json")]));
            Assert.That(File.ReadAllBytes(Path.Combine(clone, "LocalPackages", "foo" + extension)), Is.EqualTo(opaque));
            Assert.That(Directory.Exists(Path.Combine(clone, "Packages", "com.example.archive")), Is.False);
            AssertFilesEqual(_source, original);
        }

        [Test]
        public void ExternalTeamForgeTarballRequiresAnActionableRefusal()
        {
            Write(SourceManifest, Manifest.Replace(ExternalReference, "file:../../external/teamforge.tgz"));
            File.WriteAllBytes(Path.Combine(_root, "external", "teamforge.tgz"), new byte[] { 0, 255, 17 });
            var error = AssertPrepareFails();
            Assert.That(error, Does.Contain("tarball").IgnoreCase);
        }

        [Test]
        public void InternalTarballFifoIsRejectedWithoutOpeningIt()
        {
            var manifest = Manifest.Replace(ExternalReference, Version)
                .Replace("\"com.example.pinned\": \"1.2.3\"", "\"com.example.pinned\": \"1.2.3\",\n    \"com.example.archive\": \"file:../LocalPackages/foo.tgz\"");
            Write(SourceManifest, manifest);
            var pipe = Path.Combine(_source, "LocalPackages", "foo.tgz");
            Directory.CreateDirectory(Path.GetDirectoryName(pipe));
            CreateFifo(pipe);
            var attempt = Task.Run(() => TeamForgeTestLabPackageSnapshot.TryPrepare(_source, _package, Version, out _, out _));
            AssertBoundedRefusal(attempt);
        }

        [TestCase(false, false)]
        [TestCase(false, true)]
        [TestCase(true, false)]
        [TestCase(true, true)]
        public void CopiedLoadedEmbeddedPackageOverridesRetainedExternalReferences(bool tarball, bool missingOriginal)
        {
            var embedded = CopyFixtureIntoEmbeddedFolder();
            var reference = tarball ? "file:../../external/stale-teamforge.tgz" : ExternalReference;
            Write(SourceManifest, Manifest.Replace(ExternalReference, reference));
            if (tarball)
            {
                if (!missingOriginal) File.WriteAllBytes(Path.Combine(_root, "external", "stale-teamforge.tgz"), new byte[] { 255, 0, 17 });
            }
            else if (missingOriginal) Directory.Delete(_package, true);
            else Write(Path.Combine(_package, "Editor", "Nested", "Fixture.cs"), "// stale external URI must not supply the loaded package\n");
            var original = CaptureFiles(_source);
            var snapshot = Prepare(embedded);
            var clone = Path.Combine(_root, "embedded-reference-clone");
            CopyProjectForTest(_source, clone);
            var copiedPackage = Path.Combine(clone, "Packages", PackageName);
            var copiedFiles = CaptureFiles(copiedPackage);
            var copiedDirectories = Directory.GetDirectories(copiedPackage, "*", SearchOption.AllDirectories);

            Assert.That(snapshot.TryApply(clone, out var error), Is.True, error);
            Assert.That(File.ReadAllBytes(Path.Combine(clone, "Packages", "manifest.json")),
                Is.EqualTo(Encoding.UTF8.GetBytes(Manifest.Replace(ExternalReference, "file:" + PackageName))));
            Assert.That(File.ReadAllBytes(Path.Combine(clone, "Packages", "packages-lock.json")), Is.EqualTo(original[Path.Combine("Packages", "packages-lock.json")]));
            AssertFilesEqual(copiedPackage, copiedFiles);
            Assert.That(Directory.GetDirectories(copiedPackage, "*", SearchOption.AllDirectories), Is.EquivalentTo(copiedDirectories));
            Assert.That(File.ReadAllText(Path.Combine(copiedPackage, "Editor", "Nested", "Fixture.cs")), Is.EqualTo("// snapshot source\n"));
            AssertFilesEqual(_source, original);
        }

        [TestCase("missing-package")]
        [TestCase("modified-file")]
        [TestCase("extra-file")]
        [TestCase("missing-directory")]
        [TestCase("missing-file")]
        [TestCase("missing-meta")]
        public void ChangedCopiedEmbeddedPackageIsRefusedWithoutRepair(string change)
        {
            var embedded = CopyFixtureIntoEmbeddedFolder();
            var snapshot = Prepare(embedded);
            var sourceBefore = CaptureFiles(embedded);
            var clone = Path.Combine(_root, "changed-embedded-clone");
            CopyProjectForTest(_source, clone);
            var copiedPackage = Path.Combine(clone, "Packages", PackageName);
            if (change == "missing-package") Directory.Delete(copiedPackage, true);
            else if (change == "modified-file") Write(Path.Combine(copiedPackage, "Editor", "Nested", "Fixture.cs"), "// clone edits must be kept\n");
            else if (change == "extra-file") Write(Path.Combine(copiedPackage, "Editor", "Extra.cs"), "// unrelated clone source\n");
            else if (change == "missing-directory") Directory.Delete(Path.Combine(copiedPackage, "Editor", "Nested"), true);
            else if (change == "missing-file") File.Delete(Path.Combine(copiedPackage, "Editor", "Nested", "Fixture.cs"));
            else File.Delete(Path.Combine(copiedPackage, "Editor", "Nested", "Fixture.cs.meta"));
            var existed = Directory.Exists(copiedPackage);
            var filesBefore = existed ? CaptureFiles(copiedPackage) : new Dictionary<string, byte[]>();
            var directoriesBefore = existed ? Directory.GetDirectories(copiedPackage, "*", SearchOption.AllDirectories) : Array.Empty<string>();
            var manifestBefore = File.ReadAllBytes(Path.Combine(clone, "Packages", "manifest.json"));
            var lockBefore = File.ReadAllBytes(Path.Combine(clone, "Packages", "packages-lock.json"));

            Assert.That(snapshot.TryApply(clone, out _), Is.False);
            Assert.That(Directory.Exists(copiedPackage), Is.EqualTo(existed));
            if (existed)
            {
                AssertFilesEqual(copiedPackage, filesBefore);
                Assert.That(Directory.GetDirectories(copiedPackage, "*", SearchOption.AllDirectories), Is.EquivalentTo(directoriesBefore));
            }
            Assert.That(File.ReadAllBytes(Path.Combine(clone, "Packages", "manifest.json")), Is.EqualTo(manifestBefore));
            Assert.That(File.ReadAllBytes(Path.Combine(clone, "Packages", "packages-lock.json")), Is.EqualTo(lockBefore));
            AssertFilesEqual(embedded, sourceBefore);
        }

        [Test]
        public void CopiedEmbeddedPackageFifoIsRefusedWithoutOpeningOrRepairingIt()
        {
            var embedded = CopyFixtureIntoEmbeddedFolder();
            var snapshot = Prepare(embedded);
            var clone = Path.Combine(_root, "embedded-fifo-clone");
            CopyProjectForTest(_source, clone);
            var copiedPackage = Path.Combine(clone, "Packages", PackageName);
            var filesBefore = CaptureFiles(copiedPackage);
            var manifestBefore = File.ReadAllBytes(Path.Combine(clone, "Packages", "manifest.json"));
            var pipe = Path.Combine(copiedPackage, "Editor", "unexpected-fifo");
            CreateFifo(pipe);
            var attempt = Task.Run(() => snapshot.TryApply(clone, out _));
            AssertBoundedRefusal(attempt);
            Assert.That(File.Exists(pipe), Is.True);
            Assert.That(Directory.GetFiles(copiedPackage, "*", SearchOption.AllDirectories).Length, Is.EqualTo(filesBefore.Count + 1));
            foreach (var file in filesBefore)
                Assert.That(File.ReadAllBytes(Path.Combine(copiedPackage, file.Key)), Is.EqualTo(file.Value), file.Key);
            Assert.That(File.ReadAllBytes(Path.Combine(clone, "Packages", "manifest.json")), Is.EqualTo(manifestBefore));
        }

        [Test]
        public void LoadedEmbeddedSourceChangesAfterPrepareAreRefusedWithoutChangingTheCopiedPackage()
        {
            var embedded = CopyFixtureIntoEmbeddedFolder();
            var snapshot = Prepare(embedded);
            var clone = Path.Combine(_root, "embedded-source-drift-clone");
            CopyProjectForTest(_source, clone);
            var copiedPackage = Path.Combine(clone, "Packages", PackageName);
            var filesBefore = CaptureFiles(copiedPackage);
            var manifestBefore = File.ReadAllBytes(Path.Combine(clone, "Packages", "manifest.json"));
            var script = Path.Combine(embedded, "Editor", "Nested", "Fixture.cs");
            var changed = File.ReadAllBytes(script);
            changed[0] ^= 1;
            File.WriteAllBytes(script, changed);

            Assert.That(snapshot.TryApply(clone, out _), Is.False);
            AssertFilesEqual(copiedPackage, filesBefore);
            Assert.That(File.ReadAllBytes(Path.Combine(clone, "Packages", "manifest.json")), Is.EqualTo(manifestBefore));
            Assert.That(File.ReadAllBytes(script), Is.EqualTo(changed));
        }

        [TestCase(true)]
        [TestCase(false)]
        public void AnUnloadedEmbeddedFolderDoesNotSelectEmbeddedReuse(bool containsPackage)
        {
            if (containsPackage) CopyFixtureIntoEmbeddedFolder();
            else Directory.CreateDirectory(Path.Combine(_source, "Packages", PackageName));
            var sourceBefore = CaptureFiles(_source);
            Assert.That(TeamForgeTestLabPackageSnapshot.TryPrepare(_source, _package, Version,
                out var snapshot, out var error), Is.True, error);
            Assert.That(snapshot, Is.Not.Null);
            var clone = Path.Combine(_root, "unloaded-embedded-folder-clone");
            CopyProjectForTest(_source, clone);
            var cloneBefore = CaptureFiles(clone);
            Assert.That(snapshot.TryApply(clone, out var applyError), Is.False);
            Assert.That(applyError, Does.Contain("already has a TeamForge package folder"));
            AssertFilesEqual(_source, sourceBefore);
            AssertFilesEqual(clone, cloneBefore);
        }

        [TestCase(true)]
        [TestCase(false)]
        public void EmbeddedPackageRootAndSubdirectoriesCannotBeRedirected(bool rootLink)
        {
            var embedded = CopyFixtureIntoEmbeddedFolder();
            if (rootLink)
            {
                Directory.Delete(embedded, true);
                CreateLink(embedded, _package, true);
            }
            else CreateLink(Path.Combine(embedded, "Editor", "Redirected"), _package, true);
            Assert.That(TeamForgeTestLabPackageSnapshot.TryPrepare(_source, embedded, Version,
                out var snapshot, out var error), Is.False);
            Assert.That(snapshot, Is.Null);
            Assert.That(error, Is.Not.Null.And.Not.Empty);
        }

        [Test]
        public void AnUnloadedPackageLinkKeepsTheVerifiedExternalCopyFlow()
        {
            var embedded = Path.Combine(_source, "Packages", PackageName);
            CreateLink(embedded, _package, true);
            var packageBefore = CaptureFiles(_package);
            var manifestBefore = File.ReadAllBytes(SourceManifest);
            var lockBefore = File.ReadAllBytes(SourceLock);
            Assert.That(TeamForgeTestLabPackageSnapshot.TryPrepare(_source, _package, Version,
                out var snapshot, out var prepareError), Is.True, prepareError);
            Assert.That(snapshot, Is.Not.Null);
            var clone = Path.Combine(_root, "unloaded-package-link-clone");
            CopyProjectForTest(_source, clone);
            var copiedPackage = Path.Combine(clone, "Packages", PackageName);
            Assert.That(Directory.Exists(copiedPackage), Is.False, "The project copier must skip the unloaded package link.");
            Assert.That(snapshot.TryApply(clone, out var applyError), Is.True, applyError);
            AssertFilesEqual(copiedPackage, packageBefore);
            AssertFilesEqual(_package, packageBefore);
            Assert.That(File.ReadAllBytes(SourceManifest), Is.EqualTo(manifestBefore));
            Assert.That(File.ReadAllBytes(SourceLock), Is.EqualTo(lockBefore));
            Assert.That(File.ReadAllBytes(Path.Combine(clone, "Packages", "packages-lock.json")), Is.EqualTo(lockBefore));
            AssertManifestOnlyChangesTeamForge(Manifest, File.ReadAllText(Path.Combine(clone, "Packages", "manifest.json")));
        }

        [Test]
        public void ASourceExecutionAliasCanReuseItsLoadedEmbeddedPackage()
        {
            var embedded = CopyFixtureIntoEmbeddedFolder();
            var alias = Path.Combine(_root, "source-execution-alias");
            CreateLink(alias, _source, true);
            var original = CaptureFiles(_source);
            Assert.That(TeamForgeTestLabPackageSnapshot.TryPrepare(alias, embedded, Version,
                out var snapshot, out var prepareError), Is.True, prepareError);
            Assert.That(snapshot, Is.Not.Null);
            var clone = Path.Combine(_root, "aliased-embedded-clone");
            CopyProjectForTest(alias, clone);
            var filesBefore = CaptureFiles(Path.Combine(clone, "Packages", PackageName));
            Assert.That(snapshot.TryApply(clone, out var applyError), Is.True, applyError);
            AssertManifestOnlyChangesTeamForge(Manifest, File.ReadAllText(Path.Combine(clone, "Packages", "manifest.json")));
            AssertFilesEqual(Path.Combine(clone, "Packages", PackageName), filesBefore);
            AssertFilesEqual(_source, original);
        }

        [Test]
        public void ActualProjectCopierKeepsEmbeddedEmptyDirectoriesAndMetaBeforeReuse()
        {
            var embedded = CopyFixtureIntoEmbeddedFolder();
            Directory.CreateDirectory(Path.Combine(embedded, "Editor", "EmptyEmbedded"));
            Write(Path.Combine(embedded, "Editor", "EmptyEmbedded.meta"), "fileFormatVersion: 2\nguid: 00000000000000000000000000000115\n");
            var snapshot = Prepare(embedded);
            var clone = Path.Combine(_root, "empty-embedded-clone");
            CopyProjectForTest(_source, clone);
            var copiedPackage = Path.Combine(clone, "Packages", PackageName);
            var copiedEmpty = Path.Combine(copiedPackage, "Editor", "EmptyEmbedded");
            Assert.That(Directory.Exists(copiedEmpty), Is.True, "The production copy phase must create this directory before reuse verification.");
            var metaBefore = File.ReadAllBytes(Path.Combine(copiedPackage, "Editor", "EmptyEmbedded.meta"));
            Assert.That(snapshot.TryApply(clone, out var error), Is.True, error);
            Assert.That(Directory.GetFileSystemEntries(copiedEmpty), Is.Empty);
            Assert.That(File.ReadAllBytes(Path.Combine(copiedPackage, "Editor", "EmptyEmbedded.meta")), Is.EqualTo(metaBefore));
            Assert.That(metaBefore, Is.EqualTo(File.ReadAllBytes(Path.Combine(embedded, "Editor", "EmptyEmbedded.meta"))));
        }

        [Test]
        public void AnAlreadyInternalTeamForgePackageNeedsNoExternalSnapshot()
        {
            var internalPackage = Path.Combine(_source, "Packages", PackageName);
            foreach (var file in CaptureFiles(_package))
            {
                var target = Path.Combine(internalPackage, file.Key);
                Directory.CreateDirectory(Path.GetDirectoryName(target));
                File.WriteAllBytes(target, file.Value);
            }
            Write(SourceManifest, Manifest.Replace(ExternalReference, "file:" + PackageName));
            var before = CaptureFiles(_source);
            Assert.That(TeamForgeTestLabPackageSnapshot.TryPrepare(_source, internalPackage, Version,
                out var snapshot, out var error), Is.True, error);
            Assert.That(snapshot, Is.Null);
            AssertFilesEqual(_source, before);
        }

        [Test]
        public void AProjectWithoutALockDoesNotGetAFabricatedLock()
        {
            File.Delete(SourceLock);
            var snapshot = Prepare();
            var clone = CreateClone("clone-without-lock");
            Assert.That(snapshot.TryApply(clone, out var error), Is.True, error);
            Assert.That(File.Exists(Path.Combine(clone, "Packages", "packages-lock.json")), Is.False);
            Assert.That(File.Exists(SourceLock), Is.False);
        }

        [Test]
        public void EscapedDependencyNamesAreRecognizedAndOtherJsonValuesAreKept()
        {
            var escaped = Manifest.Replace("\"dependencies\":", "\"\\u0064ependencies\":")
                .Replace("\"com.eunsung.teamforge\":", "\"\\u0063om.eunsung.teamforge\":");
            Write(SourceManifest, escaped);
            var snapshot = Prepare();
            var clone = CreateClone("escaped-clone");
            Assert.That(snapshot.TryApply(clone, out var error), Is.True, error);
            AssertManifestOnlyChangesTeamForge(escaped, File.ReadAllText(Path.Combine(clone, "Packages", "manifest.json")));
        }

        [TestCase("01")]
        [TestCase("1.")]
        [TestCase("NaN")]
        [TestCase("Infinity")]
        [TestCase("+1")]
        [TestCase(".5")]
        [TestCase("1 2")]
        [TestCase("1\t2")]
        [TestCase("- 1")]
        [TestCase("1 .2")]
        [TestCase("1 e2")]
        public void NonJsonNumberTokensAreRejected(string number)
        {
            Write(SourceManifest, Manifest.Replace("\"arbitraryNumber\": 17", "\"arbitraryNumber\": " + number));
            AssertPrepareFails();
        }

        [TestCase("{\"dependencies\":{},}")]
        [TestCase("{\"dependencies\":{},\"testables\":[\"x\",]}")]
        [TestCase("{\"dependencies\":{}} trailing")]
        [TestCase("{\"dependencies\":{},\"bad\":\"\\q\"}")]
        [TestCase("{\"dependencies\":{},\"bad\":\"\\ud800\"}")]
        [TestCase("{\"dependencies\":{},\"bad\":\"\\udc00\"}")]
        [TestCase("{\"dependencies\":{},\"\\ud800\":\"bad key\"}")]
        [TestCase("{\"dependencies\":{},\"bad\":\"raw\nnewline\"}")]
        [TestCase("{\"dependencies\":{},\"dependencies\":{}}")]
        [TestCase("{\"dependencies\":{},\"\\u0064ependencies\":{}}")]
        [TestCase("{\"dependencies\":{\"com.eunsung.teamforge\":\"a\",\"\\u0063om.eunsung.teamforge\":\"b\"}}")]
        [TestCase("{\"__type\":\"one\",\"__type\":\"two\",\"dependencies\":{}}")]
        [TestCase("{\"dependencies\":{},\"future\":{\"__type\":\"one\",\"__type\":\"two\"}}")]
        [TestCase("{\"dependencies\":{},\"future\":true false}")]
        [TestCase("{\"dependencies\":{},\"future\":false true}")]
        [TestCase("{\"dependencies\":{},\"future\":null extra}")]
        [TestCase("{\"dependencies\":{},\"future\":null null}")]
        [TestCase("{\"dependencies\":{},\"future\":tr ue}")]
        [TestCase("{\"dependencies\":{},\"future\":\"one\" \"two\"}")]
        [TestCase("{\"dependencies\":{}}\n{\"future\":17}")]
        public void MalformedOrAmbiguousManifestIsRefused(string json)
        {
            Write(SourceManifest, json);
            AssertPrepareFails();
        }

        [Test]
        public void SymbolicDirectoryInsidePackageIsRefusedWithoutFollowingIt()
        {
            var outside = Path.Combine(_root, "unrelated");
            Write(Path.Combine(outside, "keep.txt"), "private unrelated data");
            CreateLink(Path.Combine(_package, "linked-directory"), outside, true);
            AssertPrepareFails();
            Assert.That(File.ReadAllText(Path.Combine(outside, "keep.txt")), Is.EqualTo("private unrelated data"));
        }

        [Test]
        public void SymbolicFileInsidePackageIsRefusedWithoutReadingItIntoTheClone()
        {
            var outside = Path.Combine(_root, "unrelated.txt");
            Write(outside, "unrelated file data");
            CreateLink(Path.Combine(_package, "linked-file.txt"), outside, false);
            AssertPrepareFails();
            Assert.That(File.ReadAllText(outside), Is.EqualTo("unrelated file data"));
        }

        [TestCase("manifest.json")]
        [TestCase("packages-lock.json")]
        public void SourceManifestAndLockMustBeRegularFiles(string name)
        {
            var original = Path.Combine(_source, "Packages", name);
            var outside = Path.Combine(_root, "unrelated-" + name);
            File.Move(original, outside);
            CreateLink(original, outside, false);
            AssertPrepareFails();
        }

        [Test]
        public void LoadedPackageRootCannotBeASymbolicDirectory()
        {
            var realPackage = Path.Combine(_root, "actual-package");
            Directory.Move(_package, realPackage);
            CreateLink(_package, realPackage, true);
            AssertPrepareFails();
        }

        [Test]
        public void SnapshotDestinationsCannotOverlapTheSourcePackage()
        {
            var snapshot = Prepare();
            var before = CaptureFiles(_package);
            foreach (var destination in new[] { _package, Path.Combine(_package, "lab"), Path.GetDirectoryName(_package) })
            {
                Assert.That(snapshot.TryValidateDestination(destination, out var error), Is.False, destination);
                Assert.That(error, Is.Not.Null.And.Not.Empty);
            }
            Assert.That(snapshot.TryValidateDestination(Path.Combine(_root, "separate-labs"), out var validError), Is.True, validError);
            Assert.That(Directory.Exists(Path.Combine(_package, "lab")), Is.False);
            Assert.That(Directory.Exists(Path.Combine(_root, "separate-labs")), Is.False);
            AssertFilesEqual(_package, before);
        }

        [Test]
        public void PackageFifoIsRejectedWithoutOpeningOrBlockingOnIt()
        {
            CreateFifo(Path.Combine(_package, "Editor", "special-pipe"));
            var attempt = Task.Run(() => TeamForgeTestLabPackageSnapshot.TryPrepare(_source, _package, Version, out _, out _));
            AssertBoundedRefusal(attempt);
        }

        [TestCase("manifest.json")]
        [TestCase("packages-lock.json")]
        public void SourceJsonFifoIsRejectedWithoutBlocking(string name)
        {
            var jsonPath = Path.Combine(_source, "Packages", name);
            File.Delete(jsonPath);
            CreateFifo(jsonPath);
            var attempt = Task.Run(() => TeamForgeTestLabPackageSnapshot.TryPrepare(_source, _package, Version, out _, out _));
            AssertBoundedRefusal(attempt);
        }

        [TestCase("manifest.json")]
        [TestCase("packages-lock.json")]
        public void CloneJsonFifoIsRejectedWithoutBlocking(string name)
        {
            var snapshot = Prepare();
            var clone = CreateClone("special-file-clone");
            var jsonPath = Path.Combine(clone, "Packages", name);
            File.Delete(jsonPath);
            CreateFifo(jsonPath);
            var attempt = Task.Run(() => snapshot.TryApply(clone, out _));
            AssertBoundedRefusal(attempt);
            Assert.That(File.ReadAllBytes(SourceManifest), Is.EqualTo(Encoding.UTF8.GetBytes(Manifest)));
            Assert.That(File.ReadAllBytes(SourceLock), Is.EqualTo(Encoding.UTF8.GetBytes(Lock)));
        }

        private static void AssertBoundedRefusal(Task<bool> attempt)
        {
            Assert.That(attempt.Wait(TimeSpan.FromSeconds(5)), Is.True,
                "Special files must be rejected before opening a stream that could block indefinitely.");
            Assert.That(attempt.Result, Is.False);
        }

        private static void CreateFifo(string path)
        {
            if (Path.DirectorySeparatorChar == '\\') Assert.Ignore("POSIX FIFO refusal needs a POSIX filesystem; Windows link refusal has separate coverage.");
            var start = new ProcessStartInfo
            {
                FileName = "/usr/bin/mkfifo", UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardOutput = true, RedirectStandardError = true,
            };
            start.ArgumentList.Add(path);
            using (var process = Process.Start(start))
            {
                Assert.That(process, Is.Not.Null);
                if (!process.WaitForExit(10000))
                {
                    process.Kill();
                    Assert.Fail("FIFO fixture creation did not finish.");
                }
                Assert.That(process.ExitCode, Is.EqualTo(0), process.StandardError.ReadToEnd());
            }
        }

        private TeamForgeTestLabPackageSnapshot Prepare()
        {
            return Prepare(_package);
        }

        private TeamForgeTestLabPackageSnapshot Prepare(string loadedPackageRoot)
        {
            Assert.That(TeamForgeTestLabPackageSnapshot.TryPrepare(_source, loadedPackageRoot, Version,
                out var snapshot, out var error), Is.True, error);
            Assert.That(snapshot, Is.Not.Null);
            return snapshot;
        }

        private string CopyFixtureIntoEmbeddedFolder()
        {
            var embedded = Path.Combine(_source, "Packages", PackageName);
            Directory.CreateDirectory(embedded);
            foreach (var directory in Directory.GetDirectories(_package, "*", SearchOption.AllDirectories))
                Directory.CreateDirectory(Path.Combine(embedded, directory.Substring(_package.Length + 1)));
            foreach (var file in CaptureFiles(_package))
            {
                var target = Path.Combine(embedded, file.Key);
                Directory.CreateDirectory(Path.GetDirectoryName(target));
                File.WriteAllBytes(target, file.Value);
            }
            return embedded;
        }

        private static void CopyProjectForTest(string source, string clone)
        {
            var copier = typeof(TeamForgeTestLab).GetMethod("CopyProjectFastestAvailable", BindingFlags.NonPublic | BindingFlags.Static);
            Assert.That(copier, Is.Not.Null);
            try
            {
                copier.Invoke(null, new object[] { source, clone });
            }
            finally
            {
#if UNITY_EDITOR
                UnityEditor.EditorUtility.ClearProgressBar();
#endif
            }
        }

        private string AssertPrepareFails()
        {
            var sourceManifest = File.ReadAllBytes(SourceManifest);
            var sourceLock = File.ReadAllBytes(SourceLock);
            Assert.That(TeamForgeTestLabPackageSnapshot.TryPrepare(_source, _package, Version,
                out var snapshot, out var error), Is.False);
            Assert.That(snapshot, Is.Null);
            Assert.That(error, Is.Not.Null.And.Not.Empty, "Unsupported input needs an actionable local error.");
            Assert.That(File.ReadAllBytes(SourceManifest), Is.EqualTo(sourceManifest));
            Assert.That(File.ReadAllBytes(SourceLock), Is.EqualTo(sourceLock));
            Assert.That(Directory.Exists(Path.Combine(_root, "clone")), Is.False);
            return error;
        }

        private string CreateClone(string name)
        {
            var clone = Path.Combine(_root, name);
            Directory.CreateDirectory(Path.Combine(clone, "Packages"));
            File.Copy(SourceManifest, Path.Combine(clone, "Packages", "manifest.json"));
            if (File.Exists(SourceLock)) File.Copy(SourceLock, Path.Combine(clone, "Packages", "packages-lock.json"));
            Write(Path.Combine(clone, "Assets", "keep.txt"), "existing clone asset");
            return clone;
        }

        private static void AssertManifestOnlyChangesTeamForge(string original, string actual)
        {
            var expected = original.Replace(ExternalReference, "file:" + PackageName);
            Assert.That(actual, Is.EqualTo(expected),
                "Only the TeamForge dependency value may change; every other manifest byte, escape and pin is preserved.");
        }

        private static Dictionary<string, byte[]> CaptureFiles(string root)
        {
            return Directory.GetFiles(root, "*", SearchOption.AllDirectories).ToDictionary(
                file => file.Substring(root.Length).TrimStart(Path.DirectorySeparatorChar), File.ReadAllBytes);
        }

        private void AssertOriginalFilesUnchanged(Dictionary<string, byte[]> original)
        {
            foreach (var file in original)
                Assert.That(File.ReadAllBytes(Path.Combine(_root, file.Key)), Is.EqualTo(file.Value), file.Key);
        }

        private static void AssertFilesEqual(string root, Dictionary<string, byte[]> expected)
        {
            Assert.That(CaptureFiles(root).Keys, Is.EquivalentTo(expected.Keys));
            foreach (var file in expected)
                Assert.That(File.ReadAllBytes(Path.Combine(root, file.Key)), Is.EqualTo(file.Value), file.Key);
        }

        private static void Write(string file, string text)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(file));
            File.WriteAllText(file, text, new UTF8Encoding(false));
        }

        private static string PhysicalTemporaryRoot()
        {
            var root = Path.GetTempPath();
            if (Path.DirectorySeparatorChar == '\\') return root;
            var start = new ProcessStartInfo
            {
                FileName = "/bin/pwd", Arguments = "-P", WorkingDirectory = root,
                UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardOutput = true, RedirectStandardError = true,
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
                var output = process.StandardOutput.ReadToEnd();
                Assert.That(output.EndsWith("\n", StringComparison.Ordinal), Is.True);
                return output.Substring(0, output.Length - 1);
            }
        }

        private void CreateLink(string alias, string target, bool directory)
        {
            var windows = Path.DirectorySeparatorChar == '\\';
            var start = new ProcessStartInfo
            {
                FileName = windows ? "cmd.exe" : "/bin/ln",
                UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardOutput = true, RedirectStandardError = true,
            };
            if (windows)
            {
                start.ArgumentList.Add("/d");
                start.ArgumentList.Add("/c");
                start.ArgumentList.Add("mklink");
                if (directory) start.ArgumentList.Add("/J");
            }
            else start.ArgumentList.Add("-s");
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
                if (windows && !directory && process.ExitCode != 0)
                    Assert.Ignore("Windows file-link creation requires Developer Mode or symbolic-link privilege; directory-junction refusal is tested separately.");
                Assert.That(process.ExitCode, Is.EqualTo(0), process.StandardError.ReadToEnd());
            }
            _links.Add(new KeyValuePair<string, bool>(alias, directory));
        }
    }
}

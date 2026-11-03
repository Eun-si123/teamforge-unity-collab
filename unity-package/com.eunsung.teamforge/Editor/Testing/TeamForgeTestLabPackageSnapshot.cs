using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace EunSung.TeamForge
{
    // Owns the deliberately narrow, clone-only snapshot of a local TeamForge
    // package. UPM remains responsible for dependency resolution and lock updates.
    internal sealed class TeamForgeTestLabPackageSnapshot
    {
        private const string PackageName = "com.eunsung.teamforge";
        private const int MaximumJsonBytes = 1024 * 1024;
        private const int MaximumFiles = 20000;
        private const long MaximumPackageBytes = 1024L * 1024 * 1024;
        private static readonly HashSet<string> ExcludedPackageDirectories = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            ".git", ".svn", "Library", "Temp", "Logs", "obj", "UserSettings", ".vs", ".idea",
        };
        private static readonly UTF8Encoding Utf8 = new UTF8Encoding(false, true);
        private static readonly Regex JsonNumber = new Regex(
            @"^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$", RegexOptions.CultureInvariant);

        private sealed class PackageFile
        {
            internal string RelativePath;
            internal long Length;
            internal byte[] Hash;
        }

        private string _sourceProject;
        private string _packageRoot;
        private byte[] _manifest;
        private byte[] _rewrittenManifest;
        private byte[] _lock;
        private bool _reuseCopiedEmbedded;
        private readonly List<PackageFile> _files = new List<PackageFile>();
        private readonly List<string> _directories = new List<string>();

        internal static bool TryPrepare(
            string sourceProjectRoot, string loadedPackageRoot, string loadedPackageVersion,
            out TeamForgeTestLabPackageSnapshot snapshot, out string error)
        {
            snapshot = null;
            try
            {
                var source = AbsoluteDirectory(sourceProjectRoot);
                var packages = Path.Combine(source, "Packages");
                RequireDirectory(packages);
                var manifestBytes = ReadJsonFile(Path.Combine(packages, "manifest.json"));
                var manifest = ParseJson(manifestBytes);
                var dependencies = Property(manifest.Root, "dependencies");
                if (dependencies == null) return Succeed(out error);
                RequireType(dependencies, "object");

                string packageRoot = null;
                JsonValue teamForgeReference = null;
                var sourceForComparison = source;
                var reuseCopiedEmbedded = false;
                foreach (var dependency in dependencies.Elements())
                {
                    RequireType(dependency, "string");
                    var specification = dependency.Value;
                    if (!specification.StartsWith("file:", StringComparison.Ordinal)) continue;
                    var reference = specification.Substring(5);
                    if (reference.Length == 0 || reference.IndexOfAny(new[] { '?', '#', '\0' }) >= 0 ||
                        Regex.IsMatch(reference, @"%(?![0-9a-fA-F]{2})"))
                        Fail("A local package reference is malformed. Correct Packages/manifest.json before creating a lab.");
                    reference = Uri.UnescapeDataString(reference).Replace('\\', Path.DirectorySeparatorChar);
                    var resolved = Path.GetFullPath(Path.Combine(packages, reference));
                    var isTarball = resolved.EndsWith(".tgz", StringComparison.OrdinalIgnoreCase);
                    var directEmbeddedReference = !Path.IsPathRooted(reference) &&
                        string.Equals(resolved, Path.Combine(packages, PackageName), PathComparison);
                    if (JsonName(dependency) == PackageName && !directEmbeddedReference)
                    {
                        // UPM gives the loaded embedded package precedence over
                        // the retained dependency. Never inspect that ignored origin.
                        var embedded = LoadedEmbeddedRoot(source, loadedPackageRoot, out var physicalSource);
                        if (embedded != null)
                        {
                            packageRoot = embedded;
                            sourceForComparison = physicalSource;
                            reuseCopiedEmbedded = true;
                            teamForgeReference = dependency;
                            continue;
                        }
                    }
                    if (IsInside(source, resolved))
                    {
                        if (Path.IsPathRooted(reference) || string.Equals(source, resolved, PathComparison))
                            Fail("Internal local packages must use a relative path to a package inside the Project before creating a lab.");
                        var relative = resolved.Substring(source.Length + 1);
                        if (relative.Split(Path.DirectorySeparatorChar).Any(TeamForgeTestLab.IsExcludedDirectoryName))
                            Fail("An internal local package is inside a folder omitted by the Project clone copier. Move it into a normal Project package folder first.");
                        if (isTarball)
                        {
                            RequireContainedDirectory(source, Path.GetDirectoryName(resolved));
                            RequireRegularFile(resolved);
                            continue;
                        }
                        RequireContainedDirectory(source, resolved);
                        var internalPackage = ParseJson(ReadJsonFile(Path.Combine(resolved, "package.json")));
                        if (StringProperty(internalPackage.Root, "name") != JsonName(dependency))
                            Fail("An internal local package name does not match its manifest reference.");
                        RequireNoNestedLocalDependencies(internalPackage);
                        continue;
                    }
                    if (JsonName(dependency) != PackageName)
                        Fail("Test Lab cannot snapshot other external local packages. Embed them inside the Project before creating a lab.");
                    if (isTarball)
                        Fail("External TeamForge tarballs are not supported by Test Lab snapshots. Embed the package inside the Project or use an unpacked local package folder first.");
                    packageRoot = AbsoluteDirectory(loadedPackageRoot);
                    RequireDirectDirectory(packageRoot);
                    if (!string.Equals(resolved, packageRoot, PathComparison))
                        Fail("The local TeamForge reference does not match the loaded package. Wait for UPM resolution or reopen the source Project.");
                    teamForgeReference = dependency;
                }
                if (teamForgeReference == null) return Succeed(out error);

                var packageBytes = ReadJsonFile(Path.Combine(packageRoot, "package.json"));
                var package = ParseJson(packageBytes);
                if (StringProperty(package.Root, "name") != PackageName ||
                    string.IsNullOrWhiteSpace(loadedPackageVersion) ||
                    StringProperty(package.Root, "version") != loadedPackageVersion)
                    Fail("The local TeamForge package name/version does not match the loaded package.");
                RequireNoNestedLocalDependencies(package);

                var prepared = new TeamForgeTestLabPackageSnapshot
                {
                    _sourceProject = sourceForComparison,
                    _packageRoot = packageRoot,
                    _reuseCopiedEmbedded = reuseCopiedEmbedded,
                    _manifest = manifestBytes,
                    _lock = ReadOptionalLock(packages),
                };
                long totalBytes = 0;
                RequireUnixKinds(packageRoot, true);
                prepared.CollectPackageFiles(packageRoot, 0, ref totalBytes);
                using (var hash = SHA256.Create())
                {
                    var identity = prepared._files.Single(file => string.Equals(file.RelativePath, "package.json", PathComparison));
                    if (!identity.Hash.SequenceEqual(hash.ComputeHash(packageBytes))) Fail("The package identity changed during snapshot preparation. Create a fresh lab.");
                }
                prepared._rewrittenManifest = RewriteReference(manifest, teamForgeReference);
                snapshot = prepared;
                return Succeed(out error);
            }
            catch (Exception exception)
            {
                error = DescribeFailure(exception);
                return false;
            }
        }

        private static string LoadedEmbeddedRoot(string source, string loadedRoot, out string physicalSource)
        {
            physicalSource = source;
            var embedded = Path.Combine(source, "Packages", PackageName);
            if (!TeamForgeTestLab.TryResolveSourceDirectoryForComparison(source, out physicalSource, out var error)) Fail(error);
            if (!TeamForgeTestLab.TryResolveSourceDirectoryForComparison(
                    AbsoluteDirectory(loadedRoot), out var physicalLoaded, out error)) Fail(error);
            physicalSource = AbsoluteDirectory(physicalSource);
            var physicalEmbedded = Path.Combine(physicalSource, "Packages", PackageName);
            // Folder visibility does not establish which package UPM loaded.
            // Keep the verified external-folder flow when its actual root differs.
            if (!string.Equals(physicalEmbedded, AbsoluteDirectory(physicalLoaded), PathComparison)) return null;
            // The source Project itself may be a Launcher execution alias, but
            // Packages and a selected embedded package must be direct directories.
            RequireContainedDirectory(source, embedded);
            RequireDirectDirectory(physicalEmbedded);
            return physicalEmbedded;
        }

        internal bool TryValidateDestination(string destinationRoot, out string error)
        {
            try
            {
                var destination = AbsoluteDirectory(destinationRoot);
                if (IsInside(_packageRoot, destination) || IsInside(destination, _packageRoot))
                    Fail("Choose a lab destination outside the source TeamForge package and its ancestors.");
                return Succeed(out error);
            }
            catch (Exception exception)
            {
                error = DescribeFailure(exception);
                return false;
            }
        }

        internal bool TryApply(string cloneRoot, out string error)
        {
            try
            {
                cloneRoot = AbsoluteDirectory(cloneRoot);
                RequireDirectDirectory(cloneRoot);
                if (string.Equals(cloneRoot, _sourceProject, PathComparison) || IsInside(_sourceProject, cloneRoot))
                    Fail("A package snapshot must be applied only to a new lab clone outside the source Project.");
                if (!TryValidateDestination(cloneRoot, out error)) return false;
                var packages = Path.Combine(cloneRoot, "Packages");
                RequireDirectDirectory(packages);
                var manifestPath = Path.Combine(packages, "manifest.json");
                if (!ReadJsonFile(manifestPath).SequenceEqual(_manifest) || !SameOptionalLock(packages, _lock))
                    Fail("The copied manifest or lock changed during lab creation. Create a fresh lab after UPM finishes.");
                var targetRoot = Path.Combine(packages, PackageName);
                if (!_reuseCopiedEmbedded && EntryExists(targetRoot))
                    Fail("The clone already has a TeamForge package folder. Existing package contents were kept; create a fresh lab.");
                RequireUnixKinds(_packageRoot, true);
                RequireUnchangedInventory();
                if (_reuseCopiedEmbedded)
                {
                    RequireVerifiedPackage(_packageRoot);
                    RequireVerifiedPackage(targetRoot);
                }
                else
                {
                    Directory.CreateDirectory(targetRoot);
                    foreach (var directory in _directories)
                    {
                        var target = Path.Combine(targetRoot, directory);
                        RequireDirectDirectory(Path.GetDirectoryName(target));
                        Directory.CreateDirectory(target);
                        RequireDirectDirectory(target);
                    }
                    foreach (var file in _files)
                    {
                        var source = Path.Combine(_packageRoot, file.RelativePath);
                        RequireDirectDirectory(Path.GetDirectoryName(source));
                        RequireRegularFile(source, false);
                        var target = Path.Combine(targetRoot, file.RelativePath);
                        var parent = Path.GetDirectoryName(target);
                        RequireDirectDirectory(targetRoot);
                        Directory.CreateDirectory(parent);
                        RequireDirectDirectory(parent);
                        using (var input = new FileStream(source, FileMode.Open, FileAccess.Read, FileShare.Read))
                        using (var output = new FileStream(target, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                        {
                            if (input.Length != file.Length) Fail("The TeamForge package changed during copying. Create a fresh lab.");
                            var hash = CopyAndHash(input, output, file.Length);
                            if (!hash.SequenceEqual(file.Hash)) Fail("The TeamForge package changed during copying. Create a fresh lab.");
                        }
                        RequireRegularFile(source, false);
                    }
                }

                // Preserve the complete lock, including other pinned dependencies.
                // Only a real Unity UPM resolution may update its local-package metadata.
                RequireUnchangedInventory();
                if (_reuseCopiedEmbedded) RequireUnchangedInventory(targetRoot);
                if (!SameOptionalLock(packages, _lock)) Fail("The cloned lock changed during copying. Create a fresh lab.");
                RequireRegularFile(manifestPath);
                using (var stream = new FileStream(manifestPath, FileMode.Open, FileAccess.ReadWrite, FileShare.None))
                {
                    if (stream.Length != _manifest.Length ||
                        !ReadBounded(stream, MaximumJsonBytes).SequenceEqual(_manifest))
                        Fail("The cloned manifest changed during copying. Create a fresh lab.");
                    stream.Position = 0;
                    stream.SetLength(0);
                    stream.Write(_rewrittenManifest, 0, _rewrittenManifest.Length);
                }
                return Succeed(out error);
            }
            catch (Exception exception)
            {
                error = DescribeFailure(exception) + " Partial clone folders were kept; no clone Editors should be launched.";
                return false;
            }
        }

        private void CollectPackageFiles(string directory, int depth, ref long totalBytes)
        {
            foreach (var entry in PackageEntries(directory, depth))
            {
                var attributes = File.GetAttributes(entry);
                if (_files.Count + _directories.Count >= MaximumFiles) Fail("The local TeamForge package exceeds the Test Lab snapshot entry limit.");
                if ((attributes & FileAttributes.Directory) != 0)
                {
                    _directories.Add(entry.Substring(_packageRoot.Length + 1));
                    continue;
                }
                RequireRegularFile(entry, false);
                if (_files.Count >= MaximumFiles) Fail("The local TeamForge package exceeds the Test Lab snapshot file limit.");
                using (var input = new FileStream(entry, FileMode.Open, FileAccess.Read, FileShare.Read))
                {
                    var length = input.Length;
                    if (length > MaximumPackageBytes - totalBytes) Fail("The local TeamForge package exceeds the Test Lab snapshot size limit.");
                    _files.Add(new PackageFile
                    {
                        RelativePath = entry.Substring(_packageRoot.Length + 1),
                        Length = length,
                        Hash = CopyAndHash(input, Stream.Null, length),
                    });
                    totalBytes += length;
                }
            }
        }

        private IEnumerable<string> PackageEntries(string directory, int depth)
        {
            if (depth > 64) Fail("The local TeamForge package exceeds the Test Lab directory depth limit.");
            RequireDirectDirectory(directory);
            foreach (var entry in Directory.EnumerateFileSystemEntries(directory))
            {
                var attributes = File.GetAttributes(entry);
                if ((attributes & FileAttributes.ReparsePoint) != 0) Fail("Package snapshots cannot contain symbolic links or reparse points.");
                // Metadata can be a directory or a worktree pointer file. Neither
                // belongs in the isolated package snapshot.
                var name = Path.GetFileName(entry);
                if ((attributes & FileAttributes.Directory) != 0
                    ? ExcludedPackageDirectories.Contains(name)
                    : string.Equals(name, ".git", StringComparison.OrdinalIgnoreCase)) continue;
                yield return entry;
                if ((attributes & FileAttributes.Directory) != 0)
                    foreach (var child in PackageEntries(entry, depth + 1)) yield return child;
            }
        }

        private void RequireUnchangedInventory(string root = null)
        {
            root = root ?? _packageRoot;
            var expected = new HashSet<string>(_files.Select(file => "f:" + file.RelativePath), StringComparer.Ordinal);
            expected.UnionWith(_directories.Select(directory => "d:" + directory));
            var seen = 0;
            foreach (var entry in PackageEntries(root, 0))
            {
                if (++seen > MaximumFiles) Fail("The local TeamForge package exceeds the Test Lab snapshot entry limit.");
                var prefix = (File.GetAttributes(entry) & FileAttributes.Directory) != 0 ? "d:" : "f:";
                if (!expected.Remove(prefix + entry.Substring(root.Length + 1)))
                    Fail("The package file inventory changed during lab creation. Create a fresh lab.");
            }
            if (expected.Count != 0) Fail("The package file inventory changed during lab creation. Create a fresh lab.");
        }

        private void RequireVerifiedPackage(string root)
        {
            RequireDirectDirectory(root);
            // Classify special files before opening any target file for hashing.
            RequireUnixKinds(root, true);
            RequireUnchangedInventory(root);
            foreach (var file in _files)
            {
                var path = Path.Combine(root, file.RelativePath);
                RequireDirectDirectory(Path.GetDirectoryName(path));
                RequireRegularFile(path, false);
                using (var input = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read))
                {
                    if (input.Length != file.Length || !CopyAndHash(input, Stream.Null, file.Length).SequenceEqual(file.Hash))
                        Fail("The embedded package does not match the prepared snapshot. Existing files were kept; create a fresh lab.");
                }
            }
            RequireUnchangedInventory(root);
        }

        private static byte[] CopyAndHash(Stream input, Stream output, long expectedLength)
        {
            using (var hash = SHA256.Create())
            {
                var buffer = new byte[65536];
                long total = 0;
                int count;
                while ((count = input.Read(buffer, 0, buffer.Length)) != 0)
                {
                    total += count;
                    if (total > expectedLength) Fail("A package file grew during snapshot creation. Create a fresh lab.");
                    output.Write(buffer, 0, count);
                    hash.TransformBlock(buffer, 0, count, buffer, 0);
                }
                if (total != expectedLength) Fail("A package file changed during snapshot creation. Create a fresh lab.");
                hash.TransformFinalBlock(Array.Empty<byte>(), 0, 0);
                return hash.Hash;
            }
        }

        private sealed class JsonValue
        {
            internal string Kind;
            internal string Name;
            internal string Value;
            internal int Start;
            internal int End;
            internal Dictionary<string, JsonValue> Members;
            internal IEnumerable<JsonValue> Elements() => Members.Values;
        }
        private sealed class JsonDocument
        {
            internal string Source;
            internal JsonValue Root;
        }

        // This private reader validates a bounded UPM document and records value
        // spans. Replacing one string never reserializes unknown fields or pins.
        private sealed class PackageJsonReader
        {
            private readonly string _text;
            private int _position;
            private int _values;

            internal PackageJsonReader(string text) { _text = text; }

            internal JsonValue ReadDocument()
            {
                if (_text.Length > 0 && _text[0] == '\ufeff') _position = 1;
                var root = ReadValue(0);
                WhiteSpace();
                if (_position != _text.Length) Fail("Package JSON must contain exactly one complete object.");
                RequireType(root, "object");
                return root;
            }

            private JsonValue ReadValue(int depth)
            {
                if (depth > 32 || ++_values > 65536) Fail("Package JSON exceeds the Test Lab depth or value limit.");
                WhiteSpace();
                if (_position >= _text.Length) Fail("Package JSON is incomplete.");
                var start = _position;
                var token = _text[_position];
                if (token == '"')
                    return new JsonValue { Kind = "string", Start = start, Value = ReadString(), End = _position };
                if (token == '{')
                {
                    _position += 1;
                    var members = new Dictionary<string, JsonValue>(StringComparer.Ordinal);
                    if (!Accept('}'))
                    {
                        do
                        {
                            WhiteSpace();
                            var name = ReadString();
                            Expect(':');
                            var value = ReadValue(depth + 1);
                            value.Name = name;
                            if (members.ContainsKey(name)) Fail("Package JSON contains duplicate property names.");
                            members.Add(name, value);
                            if (Accept('}')) break;
                            Expect(',');
                        } while (true);
                    }
                    return new JsonValue { Kind = "object", Start = start, End = _position, Members = members };
                }
                if (token == '[')
                {
                    _position += 1;
                    if (!Accept(']'))
                    {
                        do
                        {
                            ReadValue(depth + 1);
                            if (Accept(']')) break;
                            Expect(',');
                        } while (true);
                    }
                    return new JsonValue { Kind = "array", Start = start, End = _position };
                }
                if (token == 't' || token == 'f' || token == 'n')
                {
                    var literal = token == 't' ? "true" : token == 'f' ? "false" : "null";
                    if (_position + literal.Length > _text.Length ||
                        string.CompareOrdinal(_text, _position, literal, 0, literal.Length) != 0)
                        Fail("Package JSON contains an invalid literal.");
                    _position += literal.Length;
                    return new JsonValue { Kind = token == 'n' ? "null" : "boolean", Start = start, End = _position };
                }
                while (_position < _text.Length && !IsWhiteSpace(_text[_position]) &&
                       _text[_position] != ',' && _text[_position] != '}' && _text[_position] != ']') _position += 1;
                if (!JsonNumber.IsMatch(_text.Substring(start, _position - start))) Fail("Package JSON contains an invalid number.");
                return new JsonValue { Kind = "number", Start = start, End = _position };
            }

            private string ReadString()
            {
                if (_position >= _text.Length || _text[_position++] != '"') Fail("Package JSON expects a quoted property or string.");
                var result = new StringBuilder();
                while (_position < _text.Length)
                {
                    var value = _text[_position++];
                    if (value == '"') return result.ToString();
                    if (value < ' ') Fail("Package JSON contains an unescaped control character.");
                    if (value == '\\')
                    {
                        if (_position >= _text.Length) Fail("Package JSON has an incomplete escape.");
                        var escape = _text[_position++];
                        switch (escape)
                        {
                            case '"': value = '"'; break;
                            case '\\': value = '\\'; break;
                            case '/': value = '/'; break;
                            case 'b': value = '\b'; break;
                            case 'f': value = '\f'; break;
                            case 'n': value = '\n'; break;
                            case 'r': value = '\r'; break;
                            case 't': value = '\t'; break;
                            case 'u':
                                value = ReadHexCharacter();
                                if (char.IsHighSurrogate(value))
                                {
                                    if (_position + 2 > _text.Length || _text[_position] != '\\' || _text[_position + 1] != 'u')
                                        Fail("Package JSON has an unpaired Unicode surrogate.");
                                    _position += 2;
                                    var low = ReadHexCharacter();
                                    if (!char.IsLowSurrogate(low)) Fail("Package JSON has an unpaired Unicode surrogate.");
                                    result.Append(value);
                                    value = low;
                                }
                                else if (char.IsLowSurrogate(value)) Fail("Package JSON has an unpaired Unicode surrogate.");
                                break;
                            default: Fail("Package JSON contains an invalid escape."); break;
                        }
                    }
                    else if (char.IsHighSurrogate(value))
                    {
                        if (_position >= _text.Length || !char.IsLowSurrogate(_text[_position]))
                            Fail("Package JSON has an unpaired Unicode surrogate.");
                        result.Append(value);
                        value = _text[_position++];
                    }
                    else if (char.IsLowSurrogate(value)) Fail("Package JSON has an unpaired Unicode surrogate.");
                    result.Append(value);
                    if (result.Length > 262144) Fail("Package JSON exceeds the Test Lab string limit.");
                }
                Fail("Package JSON contains an incomplete string.");
                return null;
            }

            private char ReadHexCharacter()
            {
                if (_position + 4 > _text.Length) Fail("Package JSON has an incomplete Unicode escape.");
                var value = 0;
                for (var index = 0; index < 4; index += 1)
                {
                    var digit = _text[_position++];
                    var hex = digit >= '0' && digit <= '9' ? digit - '0' : digit >= 'a' && digit <= 'f'
                        ? digit - 'a' + 10 : digit >= 'A' && digit <= 'F' ? digit - 'A' + 10 : -1;
                    if (hex < 0) Fail("Package JSON contains an invalid Unicode escape.");
                    value = value * 16 + hex;
                }
                return (char)value;
            }
            private bool Accept(char value)
            {
                WhiteSpace();
                if (_position >= _text.Length || _text[_position] != value) return false;
                _position += 1;
                return true;
            }
            private void Expect(char value)
            {
                if (!Accept(value)) Fail("Package JSON is malformed or contains a trailing comma.");
            }
            private void WhiteSpace() { while (_position < _text.Length && IsWhiteSpace(_text[_position])) _position += 1; }
            private static bool IsWhiteSpace(char value) => value == ' ' || value == '\t' || value == '\r' || value == '\n';
        }

        private static JsonDocument ParseJson(byte[] bytes)
        {
            var source = Utf8.GetString(bytes);
            return new JsonDocument { Source = source, Root = new PackageJsonReader(source).ReadDocument() };
        }
        private static byte[] RewriteReference(JsonDocument document, JsonValue reference)
        {
            var rewritten = Utf8.GetBytes(document.Source.Substring(0, reference.Start) +
                "\"file:" + PackageName + "\"" + document.Source.Substring(reference.End));
            if (rewritten.Length > MaximumJsonBytes) Fail("The cloned manifest exceeds the Test Lab JSON limit.");
            return rewritten;
        }

        private static string JsonName(JsonValue element) => element.Name;
        private static JsonValue Property(JsonValue element, string name) => element.Members.TryGetValue(name, out var value) ? value : null;
        private static string StringProperty(JsonValue element, string name)
        {
            var property = Property(element, name);
            RequireType(property, "string");
            return property.Value;
        }
        private static void RequireType(JsonValue element, string type)
        {
            if (element == null || element.Kind != type) Fail("Package JSON has an invalid object or value type.");
        }

        private static void RequireNoNestedLocalDependencies(JsonDocument package)
        {
            var dependencies = Property(package.Root, "dependencies");
            if (dependencies == null) return;
            RequireType(dependencies, "object");
            foreach (var dependency in dependencies.Elements())
            {
                RequireType(dependency, "string");
                if (dependency.Value.StartsWith("file:", StringComparison.Ordinal))
                    Fail("Nested local package dependencies are not supported by Test Lab snapshots. Embed or remove them first.");
            }
        }

        private static byte[] ReadJsonFile(string path)
        {
            RequireRegularFile(path);
            using (var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read)) return ReadBounded(stream, MaximumJsonBytes);
        }
        private static byte[] ReadBounded(Stream stream, int limit)
        {
            if (stream.Length > limit) Fail("Package JSON exceeds the Test Lab size limit.");
            using (var output = new MemoryStream())
            {
                var buffer = new byte[4096];
                int count;
                while ((count = stream.Read(buffer, 0, buffer.Length)) != 0)
                {
                    if (output.Length + count > limit) Fail("Package JSON exceeds the Test Lab size limit.");
                    output.Write(buffer, 0, count);
                }
                return output.ToArray();
            }
        }
        private static byte[] ReadOptionalLock(string packages)
        {
            var path = Path.Combine(packages, "packages-lock.json");
            if (!EntryExists(path)) return null;
            var bytes = ReadJsonFile(path);
            ParseJson(bytes);
            return bytes;
        }
        private static bool SameOptionalLock(string packages, byte[] expected)
        {
            var actual = ReadOptionalLock(packages);
            return expected == null ? actual == null : actual != null && expected.SequenceEqual(actual);
        }

        private static void RequireDirectory(string path)
        {
            var attributes = File.GetAttributes(path);
            if ((attributes & FileAttributes.Directory) == 0 || (attributes & FileAttributes.ReparsePoint) != 0)
                Fail("Package paths must use real directories without symbolic links or reparse points.");
        }
        private static void RequireDirectDirectory(string path)
        {
            for (var current = new DirectoryInfo(path); current != null; current = current.Parent) RequireDirectory(current.FullName);
        }
        private static void RequireContainedDirectory(string root, string path)
        {
            for (var current = new DirectoryInfo(path); current != null &&
                 !string.Equals(current.FullName, root, PathComparison); current = current.Parent)
                RequireDirectory(current.FullName);
        }
        private static void RequireRegularFile(string path, bool checkUnixKind = true)
        {
            var attributes = File.GetAttributes(path);
            if ((attributes & (FileAttributes.Directory | FileAttributes.ReparsePoint | FileAttributes.Device)) != 0)
                Fail("Package snapshots require regular files without symbolic links or reparse points.");
            if (checkUnixKind) RequireUnixKinds(path, false);
        }
        private static void RequireUnixKinds(string path, bool tree)
        {
            if (Path.DirectorySeparatorChar == '\\') return;
            var start = new ProcessStartInfo
            {
                FileName = tree ? "/usr/bin/find" : File.Exists("/usr/bin/test") ? "/usr/bin/test" : "/bin/test",
                UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardOutput = true, RedirectStandardError = true,
            };
            if (tree)
            {
                start.ArgumentList.Add("-P");
                start.ArgumentList.Add(path);
                start.ArgumentList.Add("!"); start.ArgumentList.Add("(");
                start.ArgumentList.Add("-type"); start.ArgumentList.Add("f");
                start.ArgumentList.Add("-o"); start.ArgumentList.Add("-type"); start.ArgumentList.Add("d");
                start.ArgumentList.Add(")"); start.ArgumentList.Add("-print0");
            }
            else
            {
                start.ArgumentList.Add("-f"); start.ArgumentList.Add(path);
            }
            using (var process = Process.Start(start))
            {
                if (process == null) Fail("The platform could not inspect package file types safely.");
                // Both fixed tools are silent on success. The OS pipes bound
                // diagnostic memory; waiting is also bounded if rejected entries fill one.
                if (!process.WaitForExit(10000))
                {
                    process.Kill(); process.WaitForExit(1000);
                    Fail("Package file-type inspection timed out. No clone Editors were launched.");
                }
                if (process.ExitCode != 0 || process.StandardOutput.Read() != -1 || process.StandardError.Read() != -1)
                    Fail("Package snapshots require regular files/directories; special files and links are not supported.");
            }
        }
        private static bool EntryExists(string path)
        {
            try { File.GetAttributes(path); return true; }
            catch (FileNotFoundException) { return false; }
            catch (DirectoryNotFoundException) { return false; }
        }
        private static string AbsoluteDirectory(string path)
        {
            if (string.IsNullOrWhiteSpace(path) || !Path.IsPathRooted(path)) Fail("Test Lab package paths must be absolute directories.");
            var full = Path.GetFullPath(path);
            return full.Length == Path.GetPathRoot(full).Length ? full : full.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        }
        private static bool IsInside(string root, string path) => string.Equals(root, path, PathComparison) ||
            path.StartsWith(root.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, PathComparison);
        private static StringComparison PathComparison => Path.DirectorySeparatorChar == '\\' ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;
        private static bool Succeed(out string error) { error = string.Empty; return true; }
        private static void Fail(string message) { throw new InvalidOperationException(message); }
        private static string DescribeFailure(Exception exception) => exception is InvalidOperationException
            ? exception.Message : $"Test Lab package snapshot could not be prepared ({exception.GetType().Name}). Check the Project/package files and UPM resolution.";
    }
}

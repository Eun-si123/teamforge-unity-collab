using System.Text.Json;
using System.Text.Json.Serialization;
using System.Security.Cryptography;

namespace TeamForge.Launcher.Core;

public sealed record RuntimeTrustPins(
    string RuntimeManifestSha256,
    string LoaderSha256,
    string ExpectedProductVersion,
    int ExpectedBackendContractVersion,
    string ExpectedBridgeRelativePath)
{
    public RuntimeTrustPins Validate()
    {
        PathSafety.RequireSha256(RuntimeManifestSha256, nameof(RuntimeManifestSha256));
        PathSafety.RequireSha256(LoaderSha256, nameof(LoaderSha256));
        if (string.IsNullOrWhiteSpace(ExpectedProductVersion) || ExpectedBackendContractVersion < 1)
        {
            throw new InvalidDataException("The embedded runtime contract is invalid.");
        }

        RequireSafeManifestRelativePath(ExpectedBridgeRelativePath, nameof(ExpectedBridgeRelativePath));
        return this;
    }

    internal static void RequireSafeManifestRelativePath(string relativePath, string fieldName)
    {
        if (string.IsNullOrWhiteSpace(relativePath)
            || Path.IsPathFullyQualified(relativePath)
            || relativePath.Contains('\\', StringComparison.Ordinal)
            || relativePath.Split('/').Any(segment => segment is "" or "." or ".."))
        {
            throw new InvalidDataException($"{fieldName} is not a safe canonical runtime-relative path.");
        }
    }
}

public sealed class VerifiedRuntimeLayout
{
    internal VerifiedRuntimeLayout(string baseDirectory, string runtimeRoot, string nodeExecutable, string loader, string manifest, RuntimeTrustPins pins)
    {
        BaseDirectory = baseDirectory;
        RuntimeRoot = runtimeRoot;
        NodeExecutable = nodeExecutable;
        Loader = loader;
        Manifest = manifest;
        Pins = pins;
    }

    public string BaseDirectory { get; }
    public string RuntimeRoot { get; }
    public string NodeExecutable { get; }
    public string Loader { get; }
    public string Manifest { get; }
    public RuntimeTrustPins Pins { get; }
}

public sealed class RuntimeVerificationException : Exception
{
    public RuntimeVerificationException(string stage, string message, Exception innerException)
        : base(message, innerException)
    {
        Stage = string.IsNullOrWhiteSpace(stage) ? "unknown" : stage;
    }

    public string Stage { get; }
}

public static class RuntimeLayoutVerifier
{
    private const long MaximumManifestBytes = 2 * 1024 * 1024;
    private const int MaximumManifestFiles = 4096;
    private const string WindowsNodeRelativePath = "platforms/win-x64/node.exe";

    public static async Task<VerifiedRuntimeLayout> VerifyAsync(
        string baseDirectory,
        RuntimeTrustPins trustPins,
        CancellationToken cancellationToken = default)
    {
        var stage = "embedded trust pins";
        try
        {
            trustPins.Validate();
            stage = "runtime path safety";
            var baseFull = Path.GetFullPath(baseDirectory);
            var runtimeRoot = Path.GetFullPath(Path.Combine(baseFull, "Runtime"));
            var manifestPath = Path.GetFullPath(Path.Combine(runtimeRoot, "runtime-manifest.json"));
            var nodePath = Path.GetFullPath(Path.Combine(runtimeRoot, "platforms", "win-x64", "node.exe"));
            var loaderPath = Path.GetFullPath(Path.Combine(baseFull, "runtime-loader.mjs"));

            PathSafety.RequireContainedBy(runtimeRoot, baseFull, "Runtime folder");
            PathSafety.RequireContainedBy(nodePath, runtimeRoot, "Node executable");
            PathSafety.RequireContainedBy(manifestPath, runtimeRoot, "Runtime manifest");
            PathSafety.RequireContainedBy(loaderPath, baseFull, "Runtime loader");
            PathSafety.RequireNoReparsePointsOnExistingPath(baseFull);
            PathSafety.RequireRegularFile(manifestPath, MaximumManifestBytes);
            PathSafety.RequireRegularFile(nodePath, 256L * 1024 * 1024);
            PathSafety.RequireRegularFile(loaderPath, 1024 * 1024);

            stage = "pinned manifest and loader hashes";
            await RequireHashAsync(manifestPath, trustPins.RuntimeManifestSha256, "runtime manifest", cancellationToken).ConfigureAwait(false);
            await RequireHashAsync(loaderPath, trustPins.LoaderSha256, "runtime loader", cancellationToken).ConfigureAwait(false);

            stage = "runtime manifest parsing";
            RuntimeManifest manifest;
            await using (var stream = File.OpenRead(manifestPath))
            {
                manifest = await JsonSerializer.DeserializeAsync<RuntimeManifest>(stream, cancellationToken: cancellationToken).ConfigureAwait(false)
                    ?? throw new InvalidDataException("The runtime manifest is empty.");
            }

            stage = "runtime manifest contract";
            var pinnedNodeSha256 = ValidateManifestContract(manifest, trustPins);
            stage = "bundled Node hash";
            await RequireHashAsync(nodePath, pinnedNodeSha256, "bundled Node executable", cancellationToken).ConfigureAwait(false);
            stage = "runtime file inventory";
            await VerifyManifestFilesAsync(runtimeRoot, manifest, cancellationToken).ConfigureAwait(false);

            return new VerifiedRuntimeLayout(baseFull, runtimeRoot, nodePath, loaderPath, manifestPath, trustPins);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or InvalidDataException or CryptographicException or JsonException)
        {
            if (exception is RuntimeVerificationException) throw;
            throw new RuntimeVerificationException(stage, exception.Message, exception);
        }
    }

    private static string ValidateManifestContract(RuntimeManifest manifest, RuntimeTrustPins pins)
    {
        if (manifest.SchemaVersion != 1
            || !string.Equals(manifest.ProductVersion, pins.ExpectedProductVersion, StringComparison.Ordinal)
            || manifest.BackendContractVersion != pins.ExpectedBackendContractVersion
            || !string.Equals(manifest.GuestBridgeRelativePath, pins.ExpectedBridgeRelativePath, StringComparison.Ordinal))
        {
            throw new InvalidDataException("The bundled runtime is incompatible with this launcher.");
        }

        if (manifest.Files is null || manifest.Files.Count == 0 || manifest.Files.Count > MaximumManifestFiles)
        {
            throw new InvalidDataException("The runtime file inventory is missing or too large.");
        }

        var windowsPlatform = manifest.Platforms?.SingleOrDefault(platform => string.Equals(platform.Id, "win-x64", StringComparison.Ordinal));
        if (windowsPlatform is null
            || !string.Equals(windowsPlatform.Os, "win32", StringComparison.Ordinal)
            || !string.Equals(windowsPlatform.Architecture, "x64", StringComparison.Ordinal)
            || !string.Equals(windowsPlatform.Executable, WindowsNodeRelativePath, StringComparison.Ordinal)
            || !PathSafetySha256IsCanonical(windowsPlatform.Sha256))
        {
            throw new InvalidDataException("The runtime does not contain the pinned Windows x64 Node executable.");
        }

        return windowsPlatform.Sha256;
    }

    private static bool PathSafetySha256IsCanonical(string value)
    {
        try
        {
            PathSafety.RequireSha256(value, "Windows Node hash");
            return true;
        }
        catch (InvalidDataException)
        {
            return false;
        }
    }

    private static async Task VerifyManifestFilesAsync(string runtimeRoot, RuntimeManifest manifest, CancellationToken cancellationToken)
    {
        var expected = new HashSet<string>(StringComparer.Ordinal);
        foreach (var entry in manifest.Files!)
        {
            cancellationToken.ThrowIfCancellationRequested();
            RuntimeTrustPins.RequireSafeManifestRelativePath(entry.Path, "runtime file path");
            PathSafety.RequireSha256(entry.Sha256, "runtime file hash");
            if (entry.Size < 0 || !expected.Add(entry.Path))
            {
                throw new InvalidDataException("The runtime manifest contains a duplicate or invalid file entry.");
            }

            var localPath = Path.GetFullPath(Path.Combine(runtimeRoot, entry.Path.Replace('/', Path.DirectorySeparatorChar)));
            PathSafety.RequireContainedBy(localPath, runtimeRoot, "Runtime file");
            PathSafety.RequireRegularFile(localPath, Math.Max(entry.Size, 1));
            var length = new FileInfo(localPath).Length;
            if (length != entry.Size)
            {
                throw new InvalidDataException($"The bundled runtime file has the wrong size: {entry.Path}");
            }

            await RequireHashAsync(localPath, entry.Sha256, $"runtime file {entry.Path}", cancellationToken).ConfigureAwait(false);
        }

        var actual = new HashSet<string>(StringComparer.Ordinal);
        foreach (var file in EnumerateRuntimeFilesWithoutFollowingLinks(runtimeRoot))
        {
            var relative = Path.GetRelativePath(runtimeRoot, file).Replace(Path.DirectorySeparatorChar, '/');
            if (!string.Equals(relative, "runtime-manifest.json", StringComparison.Ordinal))
            {
                actual.Add(relative);
            }
        }

        if (!actual.SetEquals(expected))
        {
            throw new InvalidDataException("The runtime folder contains missing or unlisted files.");
        }
    }

    private static IEnumerable<string> EnumerateRuntimeFilesWithoutFollowingLinks(string runtimeRoot)
    {
        var pending = new Stack<string>();
        pending.Push(runtimeRoot);
        var fileCount = 0;
        while (pending.Count != 0)
        {
            var current = pending.Pop();
            foreach (var entry in new DirectoryInfo(current).EnumerateFileSystemInfos())
            {
                if ((entry.Attributes & FileAttributes.ReparsePoint) != 0)
                {
                    throw new InvalidDataException("The runtime contains a symbolic link or reparse point.");
                }

                if ((entry.Attributes & FileAttributes.Directory) != 0)
                {
                    pending.Push(entry.FullName);
                    continue;
                }

                if (entry is not FileInfo)
                {
                    throw new InvalidDataException("The runtime contains an unsupported filesystem entry.");
                }

                fileCount++;
                if (fileCount > MaximumManifestFiles + 1)
                {
                    throw new InvalidDataException("The runtime contains too many files.");
                }

                yield return entry.FullName;
            }
        }
    }

    private static async Task RequireHashAsync(string path, string expected, string label, CancellationToken cancellationToken)
    {
        var actual = await PathSafety.Sha256FileAsync(path, cancellationToken).ConfigureAwait(false);
        if (!CryptographicOperations.FixedTimeEquals(Convert.FromHexString(actual), Convert.FromHexString(expected)))
        {
            throw new InvalidDataException($"The {label} failed integrity verification.");
        }
    }

    private sealed class RuntimeManifest
    {
        [JsonPropertyName("schemaVersion")]
        public int SchemaVersion { get; init; }

        [JsonPropertyName("productVersion")]
        public string ProductVersion { get; init; } = string.Empty;

        [JsonPropertyName("backendContractVersion")]
        public int BackendContractVersion { get; init; }

        [JsonPropertyName("guestBridgeRelativePath")]
        public string GuestBridgeRelativePath { get; init; } = string.Empty;

        [JsonPropertyName("platforms")]
        public List<RuntimePlatform>? Platforms { get; init; }

        [JsonPropertyName("files")]
        public List<RuntimeFile>? Files { get; init; }
    }

    private sealed class RuntimePlatform
    {
        [JsonPropertyName("id")]
        public string Id { get; init; } = string.Empty;

        [JsonPropertyName("os")]
        public string Os { get; init; } = string.Empty;

        [JsonPropertyName("architecture")]
        public string Architecture { get; init; } = string.Empty;

        [JsonPropertyName("executable")]
        public string Executable { get; init; } = string.Empty;

        [JsonPropertyName("sha256")]
        public string Sha256 { get; init; } = string.Empty;
    }

    private sealed class RuntimeFile
    {
        [JsonPropertyName("path")]
        public string Path { get; init; } = string.Empty;

        [JsonPropertyName("size")]
        public long Size { get; init; }

        [JsonPropertyName("sha256")]
        public string Sha256 { get; init; } = string.Empty;
    }
}

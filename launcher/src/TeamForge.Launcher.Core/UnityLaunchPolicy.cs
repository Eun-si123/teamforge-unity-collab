using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace TeamForge.Launcher.Core;

public sealed partial class VerifiedActiveProject
{
    internal VerifiedActiveProject(
        string projectsRoot,
        string activePath,
        string unityVersion,
        string handoffPath,
        string handoffSha256,
        string? launcherStateRoot = null)
    {
        ProjectsRoot = projectsRoot;
        ActivePath = activePath;
        UnityVersion = unityVersion;
        HandoffPath = handoffPath;
        HandoffSha256 = handoffSha256;
        LauncherStateRoot = launcherStateRoot ?? DeriveLauncherStateRoot(handoffPath);
    }

    public string ProjectsRoot { get; }
    public string ActivePath { get; }
    public string UnityVersion { get; }
    public string HandoffPath { get; }
    public string HandoffSha256 { get; }
    internal string LauncherStateRoot { get; }

    private static string DeriveLauncherStateRoot(string handoffPath)
    {
        var handoffDirectory = Path.GetDirectoryName(handoffPath);
        var guestCoreDirectory = handoffDirectory is null ? null : Path.GetDirectoryName(handoffDirectory);
        return guestCoreDirectory is null
            ? string.Empty
            : Path.GetDirectoryName(guestCoreDirectory) ?? string.Empty;
    }
}

public sealed class VerifiedUnityEditor
{
    internal VerifiedUnityEditor(string executablePath, string version)
    {
        ExecutablePath = executablePath;
        Version = version;
    }

    public string ExecutablePath { get; }
    public string Version { get; }
}

public sealed class VerifiedExistingProject
{
    internal VerifiedExistingProject(string projectsRoot, string activePath, string unityVersion)
    {
        ProjectsRoot = projectsRoot;
        ActivePath = activePath;
        UnityVersion = unityVersion;
    }

    public string ProjectsRoot { get; }
    public string ActivePath { get; }
    public string UnityVersion { get; }
}

public static partial class UnityLaunchPolicy
{
    private const long MaximumProjectVersionBytes = 16 * 1024;
    private const long MaximumHandoffBytes = 64 * 1024;
    private const int MaximumAuthenticationTokenLength = 8 * 1024;
    private const long MaximumHandoffFutureSkewMilliseconds = 5 * 60 * 1000;
    public const string GuestAuthenticationEnvironmentVariable = "TEAMFORGE_GUEST_AUTHENTICATION_TOKEN";
    private static readonly string[] GuestHandoffFields =
    {
        "schemaVersion", "projectUuid", "baselineRevision", "manifestHash", "descriptorHash",
        "ownerKeyId", "publisherKeyId", "activeProjectPath", "sessionJoinCode", "createdAtUnixMs",
    };

    public static async Task<VerifiedActiveProject> ValidateActiveResultAsync(
        string projectsRoot,
        string launcherStateRoot,
        JsonElement result,
        CancellationToken cancellationToken = default)
    {
        if (result.ValueKind != JsonValueKind.Object)
        {
            throw new InvalidDataException("The receive result is missing.");
        }

        var projects = PathSafety.NormalizeAbsolute(projectsRoot, "Projects folder");
        var state = PathSafety.NormalizeAbsolute(launcherStateRoot, "Launcher state folder");
        var active = PathSafety.NormalizeAbsolute(ReadRequiredString(result, "activePath"), "Active project");
        var handoff = PathSafety.NormalizeAbsolute(ReadRequiredString(result, "handoffPath"), "Guest handoff");
        var reportedVersion = ReadRequiredString(result, "unityVersion");
        var handoffSha256 = PathSafety.RequireSha256(ReadRequiredString(result, "handoffSha256"), "Guest handoff hash");

        PathSafety.RequireContainedBy(active, projects, "Active project");
        RequireManagedActiveShape(projects, active);
        var handoffRoot = Path.GetFullPath(Path.Combine(state, "guest-core", "handoff"));
        PathSafety.RequireContainedBy(handoff, handoffRoot, "Guest handoff");
        PathSafety.RequireNoReparsePointsOnExistingPath(active);
        PathSafety.RequireNoReparsePointsOnExistingPath(handoff);
        if (!Directory.Exists(active))
        {
            throw new InvalidDataException("The verified Active project folder is missing.");
        }

        RequireUnityProjectShape(active);
        var versionFile = Path.Combine(active, "ProjectSettings", "ProjectVersion.txt");
        PathSafety.RequireRegularFile(versionFile, MaximumProjectVersionBytes);
        var actualVersion = ParseUnityVersion(await File.ReadAllTextAsync(versionFile, cancellationToken).ConfigureAwait(false));
        if (!string.Equals(actualVersion, reportedVersion, StringComparison.Ordinal))
        {
            throw new InvalidDataException("The Active project Unity version does not match the verified receive result.");
        }

        PathSafety.RequireRegularFile(handoff, MaximumHandoffBytes);
        var actualHandoffHash = await PathSafety.Sha256FileAsync(handoff, cancellationToken).ConfigureAwait(false);
        if (!string.Equals(actualHandoffHash, handoffSha256, StringComparison.Ordinal))
        {
            throw new InvalidDataException("The guest handoff failed integrity verification.");
        }

        _ = await ReadVerifiedHandoffAsync(handoff, active, cancellationToken).ConfigureAwait(false);

        return new VerifiedActiveProject(projects, active, actualVersion, handoff, handoffSha256, state);
    }

    public static async Task<VerifiedExistingProject> ValidateExistingActiveAsync(
        string projectsRoot,
        string activePath,
        string reportedUnityVersion,
        CancellationToken cancellationToken = default)
    {
        var projects = PathSafety.NormalizeAbsolute(projectsRoot, "Projects folder");
        var active = PathSafety.NormalizeAbsolute(activePath, "Existing verified Active project");
        PathSafety.RequireContainedBy(active, projects, "Existing verified Active project");
        RequireManagedActiveShape(projects, active);
        PathSafety.RequireNoReparsePointsOnExistingPath(active);
        if (!Directory.Exists(active))
        {
            throw new InvalidDataException("The existing verified Active project folder is missing.");
        }

        RequireUnityProjectShape(active);
        var versionFile = Path.Combine(active, "ProjectSettings", "ProjectVersion.txt");
        PathSafety.RequireRegularFile(versionFile, MaximumProjectVersionBytes);
        var actualVersion = ParseUnityVersion(await File.ReadAllTextAsync(versionFile, cancellationToken).ConfigureAwait(false));
        if (!string.Equals(actualVersion, reportedUnityVersion, StringComparison.Ordinal))
        {
            throw new InvalidDataException("The existing verified Active Unity version changed after inspection.");
        }

        return new VerifiedExistingProject(projects, active, actualVersion);
    }

    public static async Task<VerifiedActiveProject> RefreshHandoffForUnityLaunchAsync(
        VerifiedActiveProject project,
        long? nowUnixMilliseconds = null,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(project);
        var state = PathSafety.NormalizeAbsolute(project.LauncherStateRoot, "Launcher state folder");
        var handoffRoot = Path.GetFullPath(Path.Combine(state, "guest-core", "handoff"));
        var source = PathSafety.NormalizeAbsolute(project.HandoffPath, "Guest handoff");
        PathSafety.RequireContainedBy(source, handoffRoot, "Guest handoff");
        PathSafety.RequireNoReparsePointsOnExistingPath(handoffRoot);
        PathSafety.RequireRegularFile(source, MaximumHandoffBytes);

        var actualHash = await PathSafety.Sha256FileAsync(source, cancellationToken).ConfigureAwait(false);
        if (!string.Equals(actualHash, project.HandoffSha256, StringComparison.Ordinal))
        {
            throw new InvalidDataException("The guest handoff changed before Unity launch.");
        }

        var snapshot = await ReadVerifiedHandoffAsync(source, project.ActivePath, cancellationToken).ConfigureAwait(false);
        var launchTimestamp = nowUnixMilliseconds ?? DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        if (launchTimestamp <= 0)
        {
            throw new InvalidDataException("The Unity launch timestamp is invalid.");
        }
        if (snapshot.CreatedAtUnixMs > launchTimestamp + MaximumHandoffFutureSkewMilliseconds)
        {
            throw new InvalidDataException("The original guest handoff timestamp is invalid.");
        }

        var refreshedBytes = WriteRefreshedHandoff(snapshot, launchTimestamp);
        if (refreshedBytes.Length == 0 || refreshedBytes.Length > MaximumHandoffBytes)
        {
            throw new InvalidDataException("The refreshed guest handoff exceeds the safe size limit.");
        }

        var refreshedPath = Path.Combine(handoffRoot, $"unity-launch-{Guid.NewGuid():N}.json");
        try
        {
            await using (var stream = new FileStream(
                             refreshedPath,
                             FileMode.CreateNew,
                             FileAccess.Write,
                             FileShare.None,
                             64 * 1024,
                             FileOptions.Asynchronous | FileOptions.WriteThrough))
            {
                await stream.WriteAsync(refreshedBytes, cancellationToken).ConfigureAwait(false);
                await stream.FlushAsync(cancellationToken).ConfigureAwait(false);
                stream.Flush(flushToDisk: true);
            }

            PathSafety.RequireRegularFile(refreshedPath, MaximumHandoffBytes);
            var refreshedHash = await PathSafety.Sha256FileAsync(refreshedPath, cancellationToken).ConfigureAwait(false);

            // The Node handoff is itself one-shot. Retire only the exact source that
            // was revalidated above, after the replacement is complete and hashed.
            PathSafety.RequireRegularFile(source, MaximumHandoffBytes);
            var sourceHashBeforeDelete = await PathSafety.Sha256FileAsync(source, cancellationToken).ConfigureAwait(false);
            if (!string.Equals(sourceHashBeforeDelete, project.HandoffSha256, StringComparison.Ordinal))
            {
                throw new InvalidDataException("The original guest handoff changed before retirement.");
            }
            File.Delete(source);
            if (File.Exists(source))
            {
                throw new IOException("The original guest handoff could not be retired.");
            }

            return new VerifiedActiveProject(
                project.ProjectsRoot,
                project.ActivePath,
                project.UnityVersion,
                refreshedPath,
                refreshedHash,
                state);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or InvalidDataException or OperationCanceledException)
        {
            try
            {
                File.Delete(refreshedPath);
                if (File.Exists(refreshedPath))
                {
                    throw new IOException("The unused refreshed handoff still exists after cleanup.");
                }
            }
            catch (Exception cleanupException) when (cleanupException is IOException or UnauthorizedAccessException)
            {
                throw new IOException(
                    "The original guest handoff could not be retired and the unused refresh could not be cleaned up.",
                    new AggregateException(exception, cleanupException));
            }
            throw;
        }
    }

    public static string FindStandardEditor(string unityVersion, string? programFiles = null)
    {
        RequireUnityVersion(unityVersion);
        var root = programFiles ?? Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        if (string.IsNullOrWhiteSpace(root))
        {
            return string.Empty;
        }

        return Path.GetFullPath(Path.Combine(root, "Unity", "Hub", "Editor", unityVersion, "Editor", "Unity.exe"));
    }

    public static async Task<VerifiedUnityEditor> VerifyEditorAsync(string editorPath, string requiredVersion, CancellationToken cancellationToken = default)
    {
        RequireUnityVersion(requiredVersion);
        var editor = PathSafety.NormalizeAbsolute(editorPath, "Unity Editor");
        PathSafety.RequireRegularFile(editor, 4L * 1024 * 1024 * 1024);
        if (!string.Equals(Path.GetFileName(editor), "Unity.exe", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidDataException("Select the Unity.exe for the exact required Editor version.");
        }

        var info = CreateUnityVersionProbeStartInfo(editor);
        using var process = new Process { StartInfo = info };
        if (!process.Start())
        {
            throw new InvalidOperationException("The selected Unity Editor could not be inspected.");
        }

        var stdoutTask = process.StandardOutput.ReadToEndAsync(cancellationToken);
        var stderrTask = process.StandardError.ReadToEndAsync(cancellationToken);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(45));
        try
        {
            await process.WaitForExitAsync(timeout.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            if (!process.HasExited)
            {
                process.Kill(entireProcessTree: true);
                await process.WaitForExitAsync(CancellationToken.None).ConfigureAwait(false);
            }

            throw new TimeoutException("The selected Unity Editor did not report its version in time.");
        }

        var output = (await stdoutTask.ConfigureAwait(false)) + "\n" + (await stderrTask.ConfigureAwait(false));
        if (process.ExitCode != 0 || !ContainsExactVersion(output, requiredVersion))
        {
            throw new InvalidDataException($"The selected Unity Editor is not exactly {requiredVersion}.");
        }

        return new VerifiedUnityEditor(editor, requiredVersion);
    }

    public static ProcessStartInfo CreateUnityVersionProbeStartInfo(string verifiedEditorPath)
    {
        var editor = PathSafety.NormalizeAbsolute(verifiedEditorPath, "Unity Editor");
        var info = new ProcessStartInfo
        {
            FileName = editor,
            WorkingDirectory = Path.GetDirectoryName(editor)!,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
        };
        info.ArgumentList.Add("-version");
        EnvironmentPolicy.Scrub(info.Environment);
        return info;
    }

    public static ProcessStartInfo CreateUnityOpenStartInfo(
        VerifiedUnityEditor verifiedEditor,
        VerifiedActiveProject project,
        string? authenticationToken = null)
    {
        if (!string.Equals(verifiedEditor.Version, project.UnityVersion, StringComparison.Ordinal))
        {
            throw new InvalidDataException("The verified Unity Editor version does not match the Active project.");
        }

        var editor = PathSafety.NormalizeAbsolute(verifiedEditor.ExecutablePath, "Unity Editor");
        var info = new ProcessStartInfo
        {
            FileName = editor,
            WorkingDirectory = Path.GetDirectoryName(editor)!,
            UseShellExecute = false,
        };
        info.ArgumentList.Add("-projectPath");
        info.ArgumentList.Add(project.ActivePath);
        EnvironmentPolicy.Scrub(info.Environment);
        info.Environment["TEAMFORGE_GUEST_HANDOFF_PATH"] = project.HandoffPath;
        info.Environment["TEAMFORGE_GUEST_HANDOFF_SHA256"] = project.HandoffSha256;
        if (!string.IsNullOrEmpty(authenticationToken))
        {
            if (authenticationToken.Length > MaximumAuthenticationTokenLength ||
                authenticationToken.IndexOfAny(['\0', '\r', '\n']) >= 0)
            {
                throw new InvalidDataException("The optional Server access code is invalid.");
            }

            info.Environment[GuestAuthenticationEnvironmentVariable] = authenticationToken;
        }
        return info;
    }

    public static ProcessStartInfo CreateExistingProjectOpenStartInfo(
        VerifiedUnityEditor verifiedEditor,
        VerifiedExistingProject project)
    {
        ArgumentNullException.ThrowIfNull(verifiedEditor);
        ArgumentNullException.ThrowIfNull(project);
        if (!string.Equals(verifiedEditor.Version, project.UnityVersion, StringComparison.Ordinal))
        {
            throw new InvalidDataException("The verified Unity Editor version does not match the existing Active project.");
        }

        var editor = PathSafety.NormalizeAbsolute(verifiedEditor.ExecutablePath, "Unity Editor");
        var info = new ProcessStartInfo
        {
            FileName = editor,
            WorkingDirectory = Path.GetDirectoryName(editor)!,
            UseShellExecute = false,
        };
        info.ArgumentList.Add("-projectPath");
        info.ArgumentList.Add(project.ActivePath);
        EnvironmentPolicy.Scrub(info.Environment);
        return info;
    }

    public static void DeleteRefreshedHandoff(VerifiedActiveProject project)
    {
        ArgumentNullException.ThrowIfNull(project);
        var state = PathSafety.NormalizeAbsolute(project.LauncherStateRoot, "Launcher state folder");
        var handoffRoot = Path.GetFullPath(Path.Combine(state, "guest-core", "handoff"));
        var handoff = PathSafety.NormalizeAbsolute(project.HandoffPath, "Guest handoff");
        PathSafety.RequireContainedBy(handoff, handoffRoot, "Guest handoff");
        var fileName = Path.GetFileName(handoff);
        if (!fileName.StartsWith("unity-launch-", StringComparison.Ordinal) ||
            !fileName.EndsWith(".json", StringComparison.Ordinal))
        {
            throw new InvalidDataException("Only a Launcher-refreshed handoff may be removed here.");
        }

        PathSafety.RequireNoReparsePointsOnExistingPath(handoff);
        File.Delete(handoff);
    }

    private static void RequireManagedActiveShape(string projectsRoot, string activePath)
    {
        var relative = Path.GetRelativePath(projectsRoot, activePath);
        var segments = relative.Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        if (segments.Length != 3
            || !UuidRegex().IsMatch(segments[0])
            || !string.Equals(segments[1], "active", StringComparison.Ordinal)
            || !ActiveNameRegex().IsMatch(segments[2]))
        {
            throw new InvalidDataException("The receive result is not a TeamForge managed Active project path.");
        }
    }

    private static void RequireUnityProjectShape(string activePath)
    {
        foreach (var directoryName in new[] { "Assets", "Packages", "ProjectSettings" })
        {
            var directory = Path.Combine(activePath, directoryName);
            if (!Directory.Exists(directory))
            {
                throw new InvalidDataException($"The Active project is missing {directoryName}.");
            }

            PathSafety.RequireNoReparsePointsOnExistingPath(directory);
        }

        PathSafety.RequireRegularFile(Path.Combine(activePath, "Packages", "manifest.json"), 2 * 1024 * 1024);
    }

    private static string ParseUnityVersion(string text)
    {
        var match = ProjectVersionRegex().Match(text);
        if (!match.Success)
        {
            throw new InvalidDataException("ProjectVersion.txt does not contain a supported exact Unity version.");
        }

        return RequireUnityVersion(match.Groups[1].Value);
    }

    private static string RequireUnityVersion(string value)
    {
        if (!UnityVersionRegex().IsMatch(value))
        {
            throw new InvalidDataException("The exact Unity version is invalid.");
        }

        return value;
    }

    private static bool ContainsExactVersion(string output, string requiredVersion)
    {
        return Regex.IsMatch(output, $@"(?<![0-9A-Za-z.]){Regex.Escape(requiredVersion)}(?![0-9A-Za-z.])", RegexOptions.CultureInvariant);
    }

    private static async Task<GuestHandoffSnapshot> ReadVerifiedHandoffAsync(
        string handoffPath,
        string expectedActivePath,
        CancellationToken cancellationToken)
    {
        await using var stream = new FileStream(
            handoffPath,
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read,
            64 * 1024,
            FileOptions.Asynchronous | FileOptions.SequentialScan);
        using var document = await JsonDocument.ParseAsync(
            stream,
            new JsonDocumentOptions
            {
                AllowTrailingCommas = false,
                CommentHandling = JsonCommentHandling.Disallow,
                MaxDepth = 16,
            },
            cancellationToken).ConfigureAwait(false);
        var root = document.RootElement;
        if (root.ValueKind != JsonValueKind.Object)
        {
            throw new InvalidDataException("The guest handoff is not a valid object.");
        }

        var fields = new HashSet<string>(StringComparer.Ordinal);
        foreach (var property in root.EnumerateObject())
        {
            if (!fields.Add(property.Name))
            {
                throw new InvalidDataException("The guest handoff contains duplicate fields.");
            }
        }
        if (!fields.SetEquals(GuestHandoffFields))
        {
            throw new InvalidDataException("The guest handoff fields are missing or unsupported.");
        }

        if (!root.TryGetProperty("schemaVersion", out var schema) ||
            !schema.TryGetInt32(out var schemaVersion) || schemaVersion != 1 ||
            !root.TryGetProperty("baselineRevision", out var revision) ||
            !revision.TryGetInt64(out var baselineRevision) || baselineRevision <= 0 ||
            !root.TryGetProperty("createdAtUnixMs", out var timestamp) ||
            !timestamp.TryGetInt64(out var createdAtUnixMs) || createdAtUnixMs <= 0)
        {
            throw new InvalidDataException("The guest handoff version, revision, or timestamp is invalid.");
        }

        var projectUuid = ReadRequiredString(root, "projectUuid");
        var manifestHash = ReadRequiredString(root, "manifestHash");
        var descriptorHash = ReadRequiredString(root, "descriptorHash");
        var ownerKeyId = ReadRequiredString(root, "ownerKeyId");
        var publisherKeyId = ReadRequiredString(root, "publisherKeyId");
        var activeProjectPath = PathSafety.NormalizeAbsolute(
            ReadRequiredString(root, "activeProjectPath"),
            "Guest Active project");
        var sessionJoinCode = ReadRequiredString(root, "sessionJoinCode");
        if (!UuidRegex().IsMatch(projectUuid) ||
            !Sha256ValueRegex().IsMatch(manifestHash) ||
            !Sha256ValueRegex().IsMatch(descriptorHash) ||
            !Sha256ValueRegex().IsMatch(ownerKeyId) ||
            !Sha256ValueRegex().IsMatch(publisherKeyId) ||
            !string.Equals(activeProjectPath, Path.GetFullPath(expectedActivePath), StringComparison.OrdinalIgnoreCase) ||
            sessionJoinCode.Length > MaximumHandoffBytes ||
            sessionJoinCode.IndexOfAny(['\0', '\r', '\n']) >= 0)
        {
            throw new InvalidDataException("The guest handoff identity is invalid.");
        }

        return new GuestHandoffSnapshot(
            projectUuid,
            baselineRevision,
            manifestHash,
            descriptorHash,
            ownerKeyId,
            publisherKeyId,
            activeProjectPath,
            sessionJoinCode,
            createdAtUnixMs);
    }

    private static byte[] WriteRefreshedHandoff(GuestHandoffSnapshot snapshot, long createdAtUnixMs)
    {
        using var buffer = new MemoryStream();
        using (var writer = new Utf8JsonWriter(buffer, new JsonWriterOptions { Indented = false }))
        {
            writer.WriteStartObject();
            writer.WriteNumber("schemaVersion", 1);
            writer.WriteString("projectUuid", snapshot.ProjectUuid);
            writer.WriteNumber("baselineRevision", snapshot.BaselineRevision);
            writer.WriteString("manifestHash", snapshot.ManifestHash);
            writer.WriteString("descriptorHash", snapshot.DescriptorHash);
            writer.WriteString("ownerKeyId", snapshot.OwnerKeyId);
            writer.WriteString("publisherKeyId", snapshot.PublisherKeyId);
            writer.WriteString("activeProjectPath", snapshot.ActiveProjectPath);
            writer.WriteString("sessionJoinCode", snapshot.SessionJoinCode);
            writer.WriteNumber("createdAtUnixMs", createdAtUnixMs);
            writer.WriteEndObject();
        }
        return buffer.ToArray();
    }

    private static string ReadRequiredString(JsonElement element, string name)
    {
        if (!element.TryGetProperty(name, out var property) || property.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(property.GetString()))
        {
            throw new InvalidDataException($"The receive result is missing {name}.");
        }

        return property.GetString()!;
    }

    private sealed record GuestHandoffSnapshot(
        string ProjectUuid,
        long BaselineRevision,
        string ManifestHash,
        string DescriptorHash,
        string OwnerKeyId,
        string PublisherKeyId,
        string ActiveProjectPath,
        string SessionJoinCode,
        long CreatedAtUnixMs);

    [GeneratedRegex("^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", RegexOptions.CultureInvariant)]
    private static partial Regex UuidRegex();

    [GeneratedRegex("^[1-9][0-9]*-[0-9a-f]{12}$", RegexOptions.CultureInvariant)]
    private static partial Regex ActiveNameRegex();

    [GeneratedRegex("^[0-9a-f]{64}$", RegexOptions.CultureInvariant)]
    private static partial Regex Sha256ValueRegex();

    [GeneratedRegex("^[0-9]{4}\\.[0-9]+\\.[0-9]+[abfp][0-9]+(?:c[0-9]+)?$", RegexOptions.CultureInvariant)]
    private static partial Regex UnityVersionRegex();

    [GeneratedRegex("(?m)^m_EditorVersion:\\s*([0-9]{4}\\.[0-9]+\\.[0-9]+[abfp][0-9]+(?:c[0-9]+)?)\\s*$", RegexOptions.CultureInvariant)]
    private static partial Regex ProjectVersionRegex();
}

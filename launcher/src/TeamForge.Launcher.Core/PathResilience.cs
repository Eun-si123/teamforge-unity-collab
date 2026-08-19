using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Win32;

namespace TeamForge.Launcher.Core;

public sealed record PathResilienceContract(
    int SchemaVersion,
    int WindowsHighRiskPathLength,
    int UnityPackageCacheHeadroom,
    int AliasHashInitialLength,
    int AliasHashExpansionStep,
    int AliasHashMaximumLength,
    string UpmCacheDirectory,
    string UpmNpmCacheDirectory,
    string UpmGitLfsCacheDirectory)
{
    private static readonly Lazy<PathResilienceContract> CurrentValue = new(Load);
    public static PathResilienceContract Current => CurrentValue.Value;

    private static PathResilienceContract Load()
    {
        var assembly = typeof(PathResilienceContract).Assembly;
        var name = assembly.GetManifestResourceNames().Single(value => value.EndsWith("path-resilience-contract.json", StringComparison.Ordinal));
        using var stream = assembly.GetManifestResourceStream(name) ?? throw new InvalidDataException("The embedded path resilience contract is missing.");
        var value = JsonSerializer.Deserialize<PathResilienceContract>(stream, new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
            ?? throw new InvalidDataException("The embedded path resilience contract is invalid.");
        if (value.SchemaVersion != 1 || value.WindowsHighRiskPathLength < 260 || value.UnityPackageCacheHeadroom < 1)
        {
            throw new InvalidDataException("The embedded path resilience contract is unsupported.");
        }
        return value;
    }
}

public sealed record PathCapabilitySnapshot(
    bool LongPathsEnabled,
    bool LauncherLongPathAware,
    string FileSystemType,
    bool ReparsePointsSupported,
    bool IsLocalFixedDrive)
{
    public bool ExecutionJunctionSupported =>
        OperatingSystem.IsWindows() && IsLocalFixedDrive && ReparsePointsSupported &&
        (string.Equals(FileSystemType, "NTFS", StringComparison.OrdinalIgnoreCase) ||
         string.Equals(FileSystemType, "ReFS", StringComparison.OrdinalIgnoreCase));
}

public static class PathCapabilityProbe
{
    public static PathCapabilitySnapshot FromSignals(
        int? longPathsEnabled,
        bool launcherLongPathAware,
        string fileSystemType,
        bool reparsePointsSupported,
        bool isLocalFixedDrive) =>
        new(longPathsEnabled == 1, launcherLongPathAware, fileSystemType, reparsePointsSupported, isLocalFixedDrive);

    public static PathCapabilitySnapshot Probe(string path)
    {
        var full = PathSafety.NormalizeAbsolute(path, "Path capability target");
        var root = Path.GetPathRoot(full) ?? throw new InvalidDataException("The path capability target has no root.");
        var drive = new DriveInfo(root);
        int? registryValue = null;
        if (OperatingSystem.IsWindows())
        {
            using var key = Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Control\FileSystem", writable: false);
            registryValue = key?.GetValue("LongPathsEnabled") is int value ? value : null;
        }
        var format = drive.IsReady ? drive.DriveFormat : "unknown";
        var fixedDrive = drive.DriveType == DriveType.Fixed;
        var reparse = string.Equals(format, "NTFS", StringComparison.OrdinalIgnoreCase) || string.Equals(format, "ReFS", StringComparison.OrdinalIgnoreCase);
        return FromSignals(registryValue, launcherLongPathAware: true, format, reparse, fixedDrive);
    }
}

public sealed record PathBudgetAssessment(bool HighRisk, int ActivePathLength, int EstimatedGeneratedPathLength, int RemainingBeforeThreshold);

public static class PathBudgetAnalyzer
{
    public static PathBudgetAssessment AssessActivePath(string activePath, string? generatedSuffix = null)
    {
        var active = Path.GetFullPath(activePath);
        var suffixLength = generatedSuffix is null
            ? PathResilienceContract.Current.UnityPackageCacheHeadroom
            : generatedSuffix.Length + 1;
        return Assess(active.Length, active.Length + suffixLength);
    }

    public static PathBudgetAssessment AssessExplicitLength(int estimatedGeneratedPathLength) =>
        Assess(Math.Max(0, estimatedGeneratedPathLength - PathResilienceContract.Current.UnityPackageCacheHeadroom), estimatedGeneratedPathLength);

    private static PathBudgetAssessment Assess(int activeLength, int estimated)
    {
        var threshold = PathResilienceContract.Current.WindowsHighRiskPathLength;
        return new(estimated >= threshold, activeLength, estimated, threshold - estimated);
    }
}

public sealed record ManagedRootCandidate(
    string Path,
    bool Writable,
    bool LocalFixedDrive,
    bool TeamForgeOwnedOrNew,
    bool ContainsReparsePoint,
    int EstimatedGeneratedPathLength);

public static class ManagedRootSelector
{
    public static ManagedRootCandidate Select(IEnumerable<ManagedRootCandidate> candidates)
    {
        var selected = candidates
            .Where(candidate => candidate.Writable && candidate.LocalFixedDrive && candidate.TeamForgeOwnedOrNew && !candidate.ContainsReparsePoint)
            .OrderBy(candidate => candidate.EstimatedGeneratedPathLength)
            .ThenBy(candidate => candidate.Path.Length)
            .ThenBy(candidate => candidate.Path, StringComparer.OrdinalIgnoreCase)
            .FirstOrDefault();
        return selected ?? throw new InvalidDataException("No safe automatic TeamForge managed root is available.");
    }
}

public static class PathAliasAllocator
{
    public static string Allocate(string projectUuid, long revision, string manifestHash, IEnumerable<string> occupiedNames)
    {
        if (!Guid.TryParseExact(projectUuid, "D", out _)) throw new InvalidDataException("The alias project UUID is invalid.");
        PathSafety.RequireSha256(manifestHash, "Alias manifest hash");
        var contract = PathResilienceContract.Current;
        var digest = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes($"{projectUuid.ToLowerInvariant()}\n{revision}\n{manifestHash}")));
        var occupied = new HashSet<string>(occupiedNames, StringComparer.OrdinalIgnoreCase);
        for (var length = contract.AliasHashInitialLength; length <= contract.AliasHashMaximumLength; length += contract.AliasHashExpansionStep)
        {
            var name = "p" + digest[..length];
            if (!occupied.Contains(name)) return name;
        }
        throw new IOException("A collision-free execution alias could not be allocated.");
    }
}

public enum PathStrategy { Canonical, ExecutionAlias, AutomaticManagedRoot, Exhausted }

public sealed record PathStrategySelection(PathStrategy Strategy, string StableEvent);

public static class PathStrategyRouter
{
    public static PathStrategySelection Select(PathBudgetAssessment budget, PathCapabilitySnapshot capability, bool executionAliasAvailable)
    {
        if (!budget.HighRisk) return new(PathStrategy.Canonical, "path_strategy_selected");
        if (executionAliasAvailable && capability.ExecutionJunctionSupported) return new(PathStrategy.ExecutionAlias, "path_strategy_selected");
        return new(PathStrategy.Exhausted, "path_strategy_exhausted");
    }
}

public static class ToolchainPathEnvironment
{
    public static void ApplyUnityCaches(IDictionary<string, string?> environment, string cacheRoot)
    {
        var root = PathSafety.NormalizeAbsolute(cacheRoot, "Unity cache root");
        PathSafety.RequireNoReparsePointsOnExistingPath(root);
        var contract = PathResilienceContract.Current;
        environment["UPM_CACHE_ROOT"] = Path.Combine(root, contract.UpmCacheDirectory);
        environment["UPM_NPM_CACHE_PATH"] = Path.Combine(root, contract.UpmNpmCacheDirectory);
        environment["UPM_GIT_LFS_CACHE_PATH"] = Path.Combine(root, contract.UpmGitLfsCacheDirectory);
    }

    public static void ApplyUnityCaches(ProcessStartInfo startInfo, string cacheRoot) => ApplyUnityCaches(startInfo.Environment, cacheRoot);
}

public sealed class PreparedUnityLaunchPath
{
    internal PreparedUnityLaunchPath(string canonicalActivePath, string unityVisiblePath, string cacheRoot, PathStrategy strategy, PreparedExecutionAlias? alias)
    {
        CanonicalActivePath = canonicalActivePath;
        UnityVisiblePath = unityVisiblePath;
        CacheRoot = cacheRoot;
        Strategy = strategy;
        Alias = alias;
    }

    public string CanonicalActivePath { get; }
    public string UnityVisiblePath { get; }
    public string CacheRoot { get; }
    public PathStrategy Strategy { get; }
    internal PreparedExecutionAlias? Alias { get; }

    public void VerifyImmediatelyBeforeLaunch()
    {
        PathSafety.RequireNoReparsePointsOnExistingPath(CanonicalActivePath);
        if (Alias is not null) ExecutionAliasManager.VerifyImmediatelyBeforeLaunch(Alias);
        var budget = PathBudgetAnalyzer.AssessActivePath(UnityVisiblePath);
        if (budget.HighRisk) throw new InvalidDataException("The selected Unity-visible path still exceeds the conservative path budget.");
    }
}

public static class UnityPathStrategy
{
    public static async Task<PreparedUnityLaunchPath> PrepareAsync(VerifiedActiveProject project, string? aliasRoot = null)
    {
        ArgumentNullException.ThrowIfNull(project);
        PathSafety.RequireNoReparsePointsOnExistingPath(project.ActivePath);
        var original = PathBudgetAnalyzer.AssessActivePath(project.ActivePath);
        var profile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        var root = aliasRoot;
        if (string.IsNullOrWhiteSpace(root))
        {
            if (string.IsNullOrWhiteSpace(profile)) throw new InvalidDataException("A safe user profile path is unavailable for Unity path optimization.");
            root = Path.Combine(profile, "TFX");
        }
        root = PathSafety.NormalizeAbsolute(root, "Execution alias root");
        var cache = Path.Combine(root, "cache");

        if (!original.HighRisk)
        {
            return new PreparedUnityLaunchPath(project.ActivePath, project.ActivePath, cache, PathStrategy.Canonical, null);
        }
        if (string.IsNullOrWhiteSpace(project.ProjectUuid) || project.BaselineRevision <= 0 || string.IsNullOrWhiteSpace(project.ManifestSha256))
            throw new InvalidDataException("The verified Active identity is incomplete for path optimization.");

        var capability = PathCapabilityProbe.Probe(project.ActivePath);
        var route = PathStrategyRouter.Select(original, capability, executionAliasAvailable: true);
        if (route.Strategy != PathStrategy.ExecutionAlias)
            throw new InvalidDataException("This PC does not provide a safe TeamForge execution-alias strategy.");
        var identity = new ExecutionAliasIdentity(project.ProjectUuid, project.BaselineRevision, project.ManifestSha256);
        var prepared = await ExecutionAliasManager.PrepareAsync(root, project.ActivePath, identity).ConfigureAwait(false);
        Directory.CreateDirectory(cache);
        PathSafety.RequireNoReparsePointsOnExistingPath(cache);
        var result = new PreparedUnityLaunchPath(project.ActivePath, prepared.AliasPath, cache, PathStrategy.ExecutionAlias, prepared);
        result.VerifyImmediatelyBeforeLaunch();
        return result;
    }
}

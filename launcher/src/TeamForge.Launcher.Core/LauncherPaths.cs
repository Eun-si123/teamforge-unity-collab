using System.Text.Json;

namespace TeamForge.Launcher.Core;

public sealed record LauncherUserPaths(string DefaultProjectsRoot, string StateDirectory, string StateFile);

public static class LauncherPaths
{
    public static LauncherUserPaths ForCurrentUser()
    {
        return FromKnownFolders(
            Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile));
    }

    public static LauncherUserPaths FromKnownFolders(string documents, string localApplicationData, string? userProfile = null)
    {
        var legacyProjectsRoot = string.IsNullOrWhiteSpace(documents)
            ? string.Empty
            : Path.GetFullPath(Path.Combine(documents, "TeamForge Projects"));
        var profile = string.IsNullOrWhiteSpace(userProfile) && !string.IsNullOrWhiteSpace(documents)
            ? Directory.GetParent(Path.GetFullPath(documents))?.FullName
            : userProfile;
        var shortProfileRoot = string.IsNullOrWhiteSpace(profile) ? string.Empty : Path.GetFullPath(Path.Combine(profile, "TF"));
        var defaultProjectsRoot = legacyProjectsRoot;
        if (!string.IsNullOrEmpty(legacyProjectsRoot) && !Directory.Exists(legacyProjectsRoot) && !string.IsNullOrEmpty(shortProfileRoot))
        {
            var legacyBudget = UnityPathBudgetPolicy.Assess(legacyProjectsRoot, "00000000-0000-4000-8000-000000000000");
            var shortBudget = UnityPathBudgetPolicy.Assess(shortProfileRoot, "00000000-0000-4000-8000-000000000000");
            if (legacyBudget.HighRisk && !shortBudget.HighRisk) defaultProjectsRoot = shortProfileRoot;
        }
        var stateDirectory = string.IsNullOrWhiteSpace(localApplicationData)
            ? string.Empty
            : Path.GetFullPath(Path.Combine(localApplicationData, "TeamForge", "Launcher"));
        return new LauncherUserPaths(
            defaultProjectsRoot,
            stateDirectory,
            string.IsNullOrEmpty(stateDirectory) ? string.Empty : Path.Combine(stateDirectory, "state.json"));
    }
}

public sealed record LauncherState(int SchemaVersion, string? LastProjectsRoot, string? LastUnityEditorPath)
{
    public static LauncherState Empty { get; } = new(1, null, null);
}

public sealed class LauncherStateStore
{
    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true };
    private readonly string _stateDirectory;
    private readonly string _stateFile;

    public LauncherStateStore(LauncherUserPaths paths)
    {
        _stateDirectory = paths.StateDirectory;
        _stateFile = paths.StateFile;
    }

    public LauncherState Load()
    {
        if (string.IsNullOrEmpty(_stateFile) || !File.Exists(_stateFile))
        {
            return LauncherState.Empty;
        }

        try
        {
            PathSafety.RequireRegularFile(_stateFile, 64 * 1024);
            var state = JsonSerializer.Deserialize<LauncherState>(File.ReadAllText(_stateFile));
            if (state is null || state.SchemaVersion != 1)
            {
                return LauncherState.Empty;
            }

            return new LauncherState(
                1,
                NormalizeRememberedAbsolutePath(state.LastProjectsRoot),
                NormalizeRememberedAbsolutePath(state.LastUnityEditorPath));
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or JsonException or InvalidDataException or ArgumentException)
        {
            return LauncherState.Empty;
        }
    }

    public void Save(LauncherState state)
    {
        if (string.IsNullOrEmpty(_stateDirectory) || string.IsNullOrEmpty(_stateFile))
        {
            return;
        }

        Directory.CreateDirectory(_stateDirectory);
        PathSafety.RequireNoReparsePointsOnExistingPath(_stateDirectory);
        var safe = new LauncherState(
            1,
            NormalizeRememberedAbsolutePath(state.LastProjectsRoot),
            NormalizeRememberedAbsolutePath(state.LastUnityEditorPath));
        var temporary = Path.Combine(_stateDirectory, $"state.{Guid.NewGuid():N}.tmp");
        try
        {
            File.WriteAllText(temporary, JsonSerializer.Serialize(safe, JsonOptions));
            File.Move(temporary, _stateFile, overwrite: true);
        }
        finally
        {
            if (File.Exists(temporary))
            {
                File.Delete(temporary);
            }
        }
    }

    private static string? NormalizeRememberedAbsolutePath(string? value)
    {
        if (string.IsNullOrWhiteSpace(value) || !Path.IsPathFullyQualified(value))
        {
            return null;
        }

        return Path.GetFullPath(value);
    }
}

using System.Security.Cryptography;
using System.Text.RegularExpressions;

namespace TeamForge.Launcher.Core;

public static partial class PathSafety
{
    public static string NormalizeAbsolute(string path, string fieldName)
    {
        if (string.IsNullOrWhiteSpace(path) || !Path.IsPathFullyQualified(path))
        {
            throw new InvalidDataException($"{fieldName} must be an absolute path.");
        }

        var fullPath = Path.GetFullPath(path);
        if (string.Equals(fullPath, Path.GetPathRoot(fullPath), StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidDataException($"{fieldName} cannot be a filesystem root.");
        }

        return fullPath;
    }

    public static bool IsContainedBy(string candidate, string parent)
    {
        var candidateFull = Path.TrimEndingDirectorySeparator(Path.GetFullPath(candidate));
        var parentFull = Path.TrimEndingDirectorySeparator(Path.GetFullPath(parent));
        if (string.Equals(candidateFull, parentFull, StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        return candidateFull.StartsWith(parentFull + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);
    }

    public static void RequireContainedBy(string candidate, string parent, string fieldName)
    {
        if (!IsContainedBy(candidate, parent))
        {
            throw new InvalidDataException($"{fieldName} is outside the selected TeamForge projects folder.");
        }
    }

    public static void RequireNoReparsePointsOnExistingPath(string path)
    {
        var fullPath = Path.GetFullPath(path);
        var root = Path.GetPathRoot(fullPath) ?? throw new InvalidDataException("The path has no filesystem root.");
        var relative = Path.GetRelativePath(root, fullPath);
        var current = root;
        foreach (var segment in relative.Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar))
        {
            if (string.IsNullOrEmpty(segment) || segment == ".")
            {
                continue;
            }

            current = Path.Combine(current, segment);
            if (!File.Exists(current) && !Directory.Exists(current))
            {
                continue;
            }

            var attributes = File.GetAttributes(current);
            if ((attributes & FileAttributes.ReparsePoint) != 0)
            {
                throw new InvalidDataException($"A symbolic link or reparse point is not allowed: {current}");
            }
        }
    }

    public static void RequireRegularFile(string path, long maxBytes)
    {
        if (!Path.IsPathFullyQualified(path))
        {
            throw new InvalidDataException("A file path must be absolute.");
        }

        RequireNoReparsePointsOnExistingPath(path);
        var info = new FileInfo(path);
        if (!info.Exists || (info.Attributes & (FileAttributes.Directory | FileAttributes.ReparsePoint)) != 0)
        {
            throw new InvalidDataException("The expected regular file is missing or unsafe.");
        }

        if (info.Length < 0 || info.Length > maxBytes)
        {
            throw new InvalidDataException("The file exceeds the allowed size.");
        }
    }

    public static async Task<string> Sha256FileAsync(string path, CancellationToken cancellationToken = default)
    {
        await using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 128 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan);
        var hash = await SHA256.HashDataAsync(stream, cancellationToken).ConfigureAwait(false);
        return Convert.ToHexStringLower(hash);
    }

    public static string RequireSha256(string value, string fieldName)
    {
        if (!Sha256Regex().IsMatch(value))
        {
            throw new InvalidDataException($"{fieldName} is not a canonical SHA-256 value.");
        }

        return value;
    }

    [GeneratedRegex("^[0-9a-f]{64}$", RegexOptions.CultureInvariant)]
    private static partial Regex Sha256Regex();
}

using System.Text.Json;

namespace TeamForge.Launcher.Core;

public sealed record TrustPresentation(
    string ChallengeId,
    string FriendlyText,
    string AdvancedText,
    bool PublisherChanged,
    bool OwnerChanged)
{
    public static TrustPresentation FromBridgeEvent(JsonElement message)
    {
        if (message.ValueKind != JsonValueKind.Object)
        {
            throw new InvalidDataException("The trust challenge is not an object.");
        }

        var challengeId = RequiredString(message, "challengeId");
        var projectId = OptionalString(message, "projectId") ?? "TeamForge project";
        var projectUuid = OptionalString(message, "projectUuid") ?? "unknown";
        var publisher = RequiredString(message, "publisherFingerprint");
        var owner = RequiredString(message, "ownerFingerprint");
        var revision = NumberOrString(message, "baselineRevision") ?? "unknown";
        var previousPublisher = OptionalString(message, "previousPublisherFingerprint");
        var previousOwner = OptionalString(message, "previousOwnerFingerprint");
        var publisherChanged = !string.IsNullOrWhiteSpace(previousPublisher)
            && !string.Equals(previousPublisher, publisher, StringComparison.Ordinal);
        var ownerChanged = !string.IsNullOrWhiteSpace(previousOwner)
            && !string.Equals(previousOwner, owner, StringComparison.Ordinal);
        var warnings = new List<string>();
        if (publisherChanged)
        {
            warnings.Add("the publisher fingerprint differs from the previously trusted value");
        }
        if (ownerChanged)
        {
            warnings.Add("the project owner fingerprint differs from the previously trusted value");
        }
        var changedWarning = warnings.Count == 0
            ? string.Empty
            : $"\n\nWarning: {string.Join("; ", warnings)}. Verify it with the host before continuing.";
        var shortFingerprint = publisher.Length > 16 ? publisher[..16] + "…" : publisher;
        var friendly = $"Project: {projectId}\nApproved Baseline: revision {revision}\nPublisher fingerprint: {shortFingerprint}{changedWarning}";
        var advanced = $"Project UUID: {projectUuid}\nOwner fingerprint: {owner}\nPublisher fingerprint: {publisher}\nPrevious owner: {previousOwner ?? "none"}\nPrevious publisher: {previousPublisher ?? "none"}\nContains scripts: {BooleanText(message, "containsScripts")}\nContains packages: {BooleanText(message, "containsPackages")}";
        return new TrustPresentation(challengeId, friendly, advanced, publisherChanged, ownerChanged);
    }

    private static string RequiredString(JsonElement element, string name)
    {
        var value = OptionalString(element, name);
        if (string.IsNullOrWhiteSpace(value))
        {
            throw new InvalidDataException($"The trust challenge is missing {name}.");
        }

        return value;
    }

    private static string? OptionalString(JsonElement element, string name)
    {
        return element.TryGetProperty(name, out var property) && property.ValueKind == JsonValueKind.String
            ? property.GetString()
            : null;
    }

    private static string? NumberOrString(JsonElement element, string name)
    {
        if (!element.TryGetProperty(name, out var property))
        {
            return null;
        }

        return property.ValueKind switch
        {
            JsonValueKind.Number => property.GetRawText(),
            JsonValueKind.String => property.GetString(),
            _ => null,
        };
    }

    private static string BooleanText(JsonElement element, string name)
    {
        return element.TryGetProperty(name, out var property)
            ? property.ValueKind switch
            {
                JsonValueKind.True => "yes",
                JsonValueKind.False => "no",
                _ => "unknown",
            }
            : "unknown";
    }
}

public static class DestinationPolicy
{
    public static string ValidateManagedRoot(string managedRoot, string applicationBaseDirectory)
    {
        return ValidateManagedRoot(managedRoot, applicationBaseDirectory, ResolveDriveType);
    }

    internal static string ValidateManagedRoot(
        string managedRoot,
        string applicationBaseDirectory,
        Func<string, DriveType> driveTypeResolver)
    {
        ArgumentNullException.ThrowIfNull(driveTypeResolver);
        if (!HasSafeWindowsPathShape(managedRoot))
        {
            throw new InvalidDataException("The TeamForge projects folder contains an unsafe Windows path segment.");
        }

        var root = PathSafety.NormalizeAbsolute(managedRoot, "Projects folder");
        var pathRoot = Path.GetPathRoot(root) ?? string.Empty;
        if (!IsOrdinaryWindowsDriveRoot(pathRoot))
        {
            throw new InvalidDataException("The TeamForge projects folder must be on a regular local Windows drive.");
        }
        DriveType driveType;
        try
        {
            driveType = driveTypeResolver(pathRoot);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or ArgumentException)
        {
            throw new InvalidDataException("The TeamForge projects drive could not be verified safely.", exception);
        }
        if (driveType != DriveType.Fixed)
        {
            throw new InvalidDataException("The TeamForge projects folder must be on a fixed local drive.");
        }

        var application = Path.GetFullPath(applicationBaseDirectory);
        var runtime = Path.GetFullPath(Path.Combine(application, "Runtime"));
        if (IsEqualOrInside(root, application)
            || IsEqualOrInside(application, root)
            || IsEqualOrInside(root, runtime)
            || IsEqualOrInside(runtime, root))
        {
            throw new InvalidDataException("The TeamForge projects folder cannot be inside the Launcher or its private Runtime folder.");
        }

        PathSafety.RequireNoReparsePointsOnExistingPath(root);
        return root;
    }

    private static DriveType ResolveDriveType(string pathRoot)
    {
        return new DriveInfo(pathRoot).DriveType;
    }

    public static bool IsOrdinaryWindowsDriveRoot(string pathRoot)
    {
        return pathRoot is { Length: 3 }
            && char.IsAsciiLetter(pathRoot[0])
            && pathRoot[1] == ':'
            && pathRoot[2] == '\\';
    }

    public static bool HasSafeWindowsPathShape(string path)
    {
        if (string.IsNullOrWhiteSpace(path) || path.Length > 32_767 || path.Contains('/'))
        {
            return false;
        }
        if (path.Length < 4 || !IsOrdinaryWindowsDriveRoot(path[..3]))
        {
            return false;
        }

        var remainder = path[3..];
        if (remainder.EndsWith('\\'))
        {
            remainder = remainder[..^1];
        }
        if (remainder.Length == 0 || remainder.Contains("\\\\", StringComparison.Ordinal))
        {
            return false;
        }

        foreach (var segment in remainder.Split('\\'))
        {
            if (segment.Length == 0 || segment is "." or ".." ||
                segment.EndsWith(' ') || segment.EndsWith('.') ||
                segment.Any(character => character < 32 || "<>:\"|?*".Contains(character)) ||
                IsReservedDosDeviceName(segment))
            {
                return false;
            }
        }

        return true;
    }

    private static bool IsReservedDosDeviceName(string segment)
    {
        var stem = segment.Split('.', 2)[0];
        if (stem.Equals("CON", StringComparison.OrdinalIgnoreCase) ||
            stem.Equals("PRN", StringComparison.OrdinalIgnoreCase) ||
            stem.Equals("AUX", StringComparison.OrdinalIgnoreCase) ||
            stem.Equals("NUL", StringComparison.OrdinalIgnoreCase) ||
            stem.Equals("CONIN$", StringComparison.OrdinalIgnoreCase) ||
            stem.Equals("CONOUT$", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        return stem.Length == 4 &&
               (stem.StartsWith("COM", StringComparison.OrdinalIgnoreCase) ||
                stem.StartsWith("LPT", StringComparison.OrdinalIgnoreCase)) &&
               stem[3] is >= '1' and <= '9';
    }

    private static bool IsEqualOrInside(string candidate, string parent)
    {
        var candidateFull = Path.TrimEndingDirectorySeparator(Path.GetFullPath(candidate));
        var parentFull = Path.TrimEndingDirectorySeparator(Path.GetFullPath(parent));
        return string.Equals(candidateFull, parentFull, StringComparison.OrdinalIgnoreCase)
            || PathSafety.IsContainedBy(candidateFull, parentFull);
    }
}

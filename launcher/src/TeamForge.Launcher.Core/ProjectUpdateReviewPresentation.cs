using System.Text.Json;

namespace TeamForge.Launcher.Core;

public sealed record ProjectUpdateDisplayChange(string Label, string Path);

public sealed record ProjectUpdateReviewPresentation(
    string ChallengeId,
    long CurrentRevision,
    long ProposedRevision,
    long AddedCount,
    long ModifiedCount,
    long RemovedCount,
    IReadOnlyList<ProjectUpdateDisplayChange> Changes)
{
    private const long MaximumSafeInteger = 9_007_199_254_740_991;
    private const int MaximumPathCharacters = 512;
    private const int MaximumPreviewCharacters = 240;
    private const string InvalidMessage = "The runtime returned an invalid project update review.";

    public long TotalChanges => AddedCount + ModifiedCount + RemovedCount;

    public static ProjectUpdateReviewPresentation FromBridgeEvent(JsonElement message, params string?[] secrets)
    {
        if (message.ValueKind != JsonValueKind.Object) throw new InvalidDataException(InvalidMessage);
        var challenge = ReadString(message, "challengeId");
        var currentRevision = ReadInteger(message, "currentRevision");
        var proposedRevision = ReadInteger(message, "proposedRevision");
        var currentHash = ReadString(message, "currentManifestHash");
        var proposedHash = ReadString(message, "proposedManifestHash");
        if (challenge.Length != 36 || !Guid.TryParseExact(challenge, "D", out var parsed) || parsed == Guid.Empty ||
            challenge != parsed.ToString("D") || currentRevision == 0 || proposedRevision <= currentRevision ||
            !IsDigest(currentHash) || !IsDigest(proposedHash) || currentHash == proposedHash ||
            !message.TryGetProperty("changes", out var changes) || changes.ValueKind != JsonValueKind.Array ||
            changes.GetArrayLength() > 12)
            throw new InvalidDataException(InvalidMessage);

        var added = ReadInteger(message, "addedCount");
        var modified = ReadInteger(message, "modifiedCount");
        var removed = ReadInteger(message, "removedCount");
        var available = new Dictionary<string, (string Label, long Count)>(StringComparer.Ordinal)
        {
            ["added"] = ("Added", added),
            ["modified"] = ("Modified", modified),
            ["removed"] = ("Removed", removed),
        };
        var displayed = new List<ProjectUpdateDisplayChange>(changes.GetArrayLength());
        foreach (var change in changes.EnumerateArray())
        {
            if (change.ValueKind != JsonValueKind.Object) throw new InvalidDataException(InvalidMessage);
            var kind = ReadString(change, "kind");
            if (!available.TryGetValue(kind, out var entry) || entry.Count == 0)
                throw new InvalidDataException(InvalidMessage);
            available[kind] = (entry.Label, entry.Count - 1);
            displayed.Add(new ProjectUpdateDisplayChange(entry.Label, DisplayPath(ReadString(change, "path"), secrets)));
        }

        return new ProjectUpdateReviewPresentation(challenge, currentRevision, proposedRevision,
            added, modified, removed, displayed.AsReadOnly());
    }

    private static long ReadInteger(JsonElement message, string propertyName)
    {
        if (!message.TryGetProperty(propertyName, out var property) || property.ValueKind != JsonValueKind.Number ||
            !property.TryGetInt64(out var value) || value is < 0 or > MaximumSafeInteger)
            throw new InvalidDataException(InvalidMessage);
        return value;
    }

    private static string ReadString(JsonElement message, string propertyName)
    {
        if (!message.TryGetProperty(propertyName, out var property) || property.ValueKind != JsonValueKind.String)
            throw new InvalidDataException(InvalidMessage);
        return property.GetString()!;
    }

    private static bool IsDigest(string value) => value.Length == 64 &&
        value.All(character => character is (>= '0' and <= '9') or (>= 'a' and <= 'f'));

    private static string DisplayPath(string path, string?[] secrets)
    {
        if (path.Length is 0 or > MaximumPathCharacters || path.Any(character =>
                char.IsControl(character) || character is '\\' or ':' or '\u2028' or '\u2029' or
                '\u061C' or '\u200E' or '\u200F' or (>= '\u202A' and <= '\u202E') or (>= '\u2066' and <= '\u206F')) ||
            path.Split('/').Any(segment => segment is "" or "." or ".."))
            return "Path hidden";

        var redacted = DiagnosticHistory.Redact(path, secrets);
        if (redacted.Length <= MaximumPreviewCharacters) return redacted;
        var end = MaximumPreviewCharacters - 1;
        if (char.IsHighSurrogate(redacted[end - 1])) end--;
        return redacted[..end] + "…";
    }
}

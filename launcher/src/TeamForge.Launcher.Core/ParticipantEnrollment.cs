using System.Security.Cryptography;
using System.Text.Json;

namespace TeamForge.Launcher.Core;

// Only the public enrollment fields may enter the clipboard. The worker
// must never return a private key or claim Host approval.
public static class ParticipantEnrollment
{
    public static string ValidateAndSerialize(JsonElement value, string expectedProjectUuid)
    {
        if (value.ValueKind != JsonValueKind.Object ||
            !value.EnumerateObject().Select(x => x.Name).Order(StringComparer.Ordinal)
                .SequenceEqual(new[] { "hostApprovalRequired", "keyId", "ownerKeyId", "participantId", "projectUuid", "publicKey", "schemaVersion" }) ||
            value.GetProperty("schemaVersion").ValueKind != JsonValueKind.Number ||
            !value.GetProperty("schemaVersion").TryGetInt32(out var version) || version != 1 ||
            value.GetProperty("hostApprovalRequired").ValueKind != JsonValueKind.True)
            throw new InvalidDataException("Invalid participant enrollment response.");

        string Read(string key) => value.GetProperty(key).ValueKind == JsonValueKind.String
            ? value.GetProperty(key).GetString() ?? string.Empty : throw new InvalidDataException("Invalid enrollment field.");
        var project = Read("projectUuid");
        if (!Guid.TryParseExact(project, "D", out var uuid) || uuid == Guid.Empty ||
            uuid.ToString("D") != project || project != expectedProjectUuid)
            throw new InvalidDataException("Enrollment Project differs from the received Project.");
        var owner = PathSafety.RequireSha256(Read("ownerKeyId"), "Owner fingerprint");
        var keyId = PathSafety.RequireSha256(Read("keyId"), "Participant fingerprint");
        if (keyId == owner || Read("participantId") != keyId)
            throw new InvalidDataException("Invalid participant fingerprint.");
        var publicKey = Read("publicKey");
        if (publicKey.Length != 60) throw new InvalidDataException("Invalid Ed25519 public key length.");
        byte[] der;
        try { der = Convert.FromBase64String(publicKey); }
        catch (FormatException) { throw new InvalidDataException("Invalid Ed25519 public key encoding."); }
        // RFC 8410 canonical Ed25519 SPKI: fixed algorithm identifier and
        // 32 public-key bytes, no optional parameters or trailing data.
        if (der.Length != 44 || !der.AsSpan(0, 12).SequenceEqual(Convert.FromHexString("302A300506032B6570032100")) ||
            Convert.ToBase64String(der) != publicKey ||
            Convert.ToHexStringLower(SHA256.HashData(der)) != keyId)
            throw new InvalidDataException("Participant key fingerprint differs.");
        return JsonSerializer.Serialize(new { schemaVersion = 1, projectUuid = project, ownerKeyId = owner,
            participantId = keyId, keyId, publicKey, hostApprovalRequired = true });
    }
}

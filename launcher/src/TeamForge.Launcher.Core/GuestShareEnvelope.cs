using System.Text;
using System.Text.Json;

namespace TeamForge.Launcher.Core;

/// <summary>
/// An explicitly opted-in, plaintext clipboard envelope. Its access code is a
/// reusable credential; this envelope is NOT a signed invite or a new capability.
/// The embedded signed invite still goes through the existing Runtime inspector.
/// </summary>
public sealed record GuestShareEnvelope(string SignedInvite, string AccessCode)
{
    public const string Format = "teamforge-guest-share-v1";
    public const int MaxEnvelopeBytes = 64 * 1024;

    public static GuestShareEnvelope Parse(string? source)
    {
        const string invalid = "The shared invite package is invalid or too large.";
        if (string.IsNullOrWhiteSpace(source) || Encoding.UTF8.GetByteCount(source) > MaxEnvelopeBytes)
            throw new InvalidDataException(invalid);

        try
        {
            using var document = JsonDocument.Parse(source, new JsonDocumentOptions { MaxDepth = 6 });
            if (document.RootElement.ValueKind != JsonValueKind.Object)
                throw new InvalidDataException(invalid);

            var fields = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (var field in document.RootElement.EnumerateObject())
            {
                if (field.Name is not ("format" or "signedInvite" or "accessCode") ||
                    field.Value.ValueKind != JsonValueKind.String ||
                    !fields.TryAdd(field.Name, field.Value.GetString() ?? string.Empty))
                    throw new InvalidDataException(invalid);
            }

            if (fields.Count != 3 || fields["format"] != Format)
                throw new InvalidDataException(invalid);

            var invite = fields["signedInvite"];
            var code = fields["accessCode"];
            if (string.IsNullOrWhiteSpace(invite) || Encoding.UTF8.GetByteCount(invite) > MaxEnvelopeBytes ||
                code.Length is < 1 or > 8192 || code != code.Trim() || code.Any(char.IsControl))
                throw new InvalidDataException(invalid);

            // Shape check only; cryptographic/Project identity validation stays
            // exclusively in the existing Runtime inspect/receive path.
            using var inviteDocument = JsonDocument.Parse(invite);
            if (inviteDocument.RootElement.ValueKind != JsonValueKind.Object)
                throw new InvalidDataException(invalid);

            return new GuestShareEnvelope(invite, code);
        }
        catch (JsonException)
        {
            // Do not expose malformed clipboard contents (which may hold secrets).
            throw new InvalidDataException(invalid);
        }
    }
}

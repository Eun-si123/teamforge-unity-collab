using System.Text;
using System.Text.Json;

namespace TeamForge.Launcher.Core;

// A public scope selector, NOT a signed Host authorization. Never accept
// local paths or credentials from the shared request.
public sealed record TransitionInspectionRequest(string ProjectId, string ProjectUuid,
    string TransitionId, string PreviousDescriptorHash, string CandidateDescriptorHash)
{
    private static readonly string[] RequestKeys = ["schemaVersion", "projectId", "projectUuid",
        "transitionId", "previousDescriptorHash", "candidateDescriptorHash"];

    public static TransitionInspectionRequest Parse(string source)
    {
        if (string.IsNullOrWhiteSpace(source) || Encoding.UTF8.GetByteCount(source) > 4096)
            throw new InvalidDataException("Invalid or oversized transition request.");
        try
        {
            using var doc = JsonDocument.Parse(source, new JsonDocumentOptions { MaxDepth = 3 });
            var value = doc.RootElement;
            RequireKeys(value, RequestKeys);
            if (!value.GetProperty("schemaVersion").TryGetInt32(out var version) || version != 1)
                throw new InvalidDataException("Unsupported transition request.");
            var project = Read(value, "projectId");
            if (project.Length is < 1 or > 128 || project != project.Trim() ||
                project.Any(c => char.IsControl(c) || c == '\uFFFD'))
                throw new InvalidDataException("Invalid Project identity.");
            var previous = PathSafety.RequireSha256(Read(value, "previousDescriptorHash"), "Previous descriptor");
            var candidate = PathSafety.RequireSha256(Read(value, "candidateDescriptorHash"), "Candidate descriptor");
            if (previous == candidate) throw new InvalidDataException("Transition versions must differ.");
            return new(project, RequireUuid(Read(value, "projectUuid")), RequireUuid(Read(value, "transitionId")),
                previous, candidate);
        }
        catch (Exception ex) when (ex is JsonException or InvalidOperationException or ArgumentException)
        {
            throw new InvalidDataException("Invalid transition request.");
        }
    }

    public Dictionary<string, object?> BridgeFields(string managedRoot, string stateRoot) => new()
    {
        ["managedRoot"] = managedRoot, ["stateRoot"] = stateRoot, ["projectId"] = ProjectId,
        ["projectUuid"] = ProjectUuid, ["transitionId"] = TransitionId,
        ["previousDescriptorHash"] = PreviousDescriptorHash, ["candidateDescriptorHash"] = CandidateDescriptorHash,
    };

    internal static void RequireKeys(JsonElement value, IEnumerable<string> expected)
    {
        if (value.ValueKind != JsonValueKind.Object ||
            !value.EnumerateObject().Select(p => p.Name).Order(StringComparer.Ordinal)
                .SequenceEqual(expected.Order(StringComparer.Ordinal)))
            throw new InvalidDataException("Unexpected transition fields.");
    }

    internal static string Read(JsonElement value, string key) =>
        value.GetProperty(key).ValueKind == JsonValueKind.String
            ? value.GetProperty(key).GetString() ?? string.Empty
            : throw new InvalidDataException("Invalid transition field.");

    private static string RequireUuid(string value)
    {
        if (!Guid.TryParseExact(value, "D", out var uuid) || uuid == Guid.Empty || uuid.ToString("D") != value)
            throw new InvalidDataException("Invalid transition UUID.");
        return value;
    }
}

public sealed record TransitionInspectionPresentation(string Summary, string PublicReport)
{
    private static readonly string[] BaseKeys = ["schemaVersion", "projectId", "projectUuid", "transitionId",
        "previousDescriptorHash", "candidateDescriptorHash", "status", "editorResumePermitted",
        "automaticActivationPermitted", "automaticRollbackPermitted", "unsavedEditorStateVerified"];
    private static readonly string[] DetailKeys = ["activeSide", "activeDescriptorHash", "activeBaselineRevision", "trustState"];

    public static TransitionInspectionPresentation FromResponse(JsonElement value, TransitionInspectionRequest request)
    {
        try
        {
            var status = TransitionInspectionRequest.Read(value, "status");
            var details = status is "guest_active_conflict" or "guest_trust_review_required" or
                "guest_scan_resource_limit" or "guest_saved_source_unavailable" or
                "guest_saved_manifest_matches" or "guest_saved_manifest_differs";
            TransitionInspectionRequest.RequireKeys(value, details ? BaseKeys.Concat(DetailKeys) : BaseKeys);
            if (!value.GetProperty("schemaVersion").TryGetInt32(out var version) || version != 1 ||
                TransitionInspectionRequest.Read(value, "projectId") != request.ProjectId ||
                TransitionInspectionRequest.Read(value, "projectUuid") != request.ProjectUuid ||
                TransitionInspectionRequest.Read(value, "transitionId") != request.TransitionId ||
                TransitionInspectionRequest.Read(value, "previousDescriptorHash") != request.PreviousDescriptorHash ||
                TransitionInspectionRequest.Read(value, "candidateDescriptorHash") != request.CandidateDescriptorHash ||
                BaseKeys.Skip(7).Any(key => value.GetProperty(key).ValueKind != JsonValueKind.False))
                throw new InvalidDataException("Unexpected transition inspection scope or permission.");
            string summary = status switch
            {
                "guest_saved_manifest_matches" => "Saved files match the selected signed version.",
                "guest_saved_manifest_differs" => "Saved files differ. Preserve local work and ask the Host to review recovery.",
                "guest_active_conflict" => "The selected project is neither of the requested versions.",
                "guest_trust_review_required" => "Local trust must be reviewed with the Host.",
                "guest_scan_resource_limit" => "The project exceeds the current inspection budget.",
                "guest_saved_source_unavailable" => "Saved files could not be verified.",
                "guest_project_missing" => "This project is not in the selected managed folder.",
                "guest_project_identity_conflict" => "The managed project identity differs from the request.",
                "guest_active_missing" => "No selected Active version could be found.",
                "guest_inspection_unavailable" => "The local managed project could not be safely inspected.",
                "guest_observation_changed" => "Local state changed during inspection. Stop competing writers and retry.",
                _ => throw new InvalidDataException("Unknown inspection status."),
            };
            if (details)
            {
                var hash = PathSafety.RequireSha256(TransitionInspectionRequest.Read(value, "activeDescriptorHash"), "Active descriptor");
                var side = TransitionInspectionRequest.Read(value, "activeSide");
                var expectedSide = hash == request.PreviousDescriptorHash ? "previous" :
                    hash == request.CandidateDescriptorHash ? "candidate" : "other";
                var trust = TransitionInspectionRequest.Read(value, "trustState");
                if (side != expectedSide || !value.GetProperty("activeBaselineRevision").TryGetInt64(out var revision) ||
                    revision < 1 || trust is not ("match" or "missing" or "invalid" or "mismatch" or "owner_conflict") ||
                    ((status == "guest_active_conflict") != (side == "other")) ||
                    (status == "guest_trust_review_required" && trust == "match") ||
                    (status is not ("guest_active_conflict" or "guest_trust_review_required") && trust != "match"))
                    throw new InvalidDataException("Inconsistent inspection details.");
                summary += $"\nSelected version: {side}, revision {revision}.";
            }
            return new(summary + "\n\nRead-only observation. Unsaved Unity edits were not verified. " +
                "This does not authorize activation, rollback or resuming collaboration.",
                JsonSerializer.Serialize(value));
        }
        catch (Exception ex) when (ex is InvalidOperationException or KeyNotFoundException or ArgumentException)
        {
            throw new InvalidDataException("Invalid transition inspection response.");
        }
    }
}

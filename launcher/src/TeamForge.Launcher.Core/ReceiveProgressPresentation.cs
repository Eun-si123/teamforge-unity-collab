using System.Globalization;
using System.Text.Json;

namespace TeamForge.Launcher.Core;

/// <summary>Receive feedback only; progress never authorizes activation or Unity launch.</summary>
public sealed record ReceiveProgressPresentation(string TransferState, string StatusText, double? Percent)
{
    public bool IsIndeterminate => Percent is null;

    public static ReceiveProgressPresentation FromMessage(JsonElement message)
    {
        var phase = (ReadString(message, "state") ?? ReadString(message, "stage"))?.ToLowerInvariant();
        var (state, explanation) = phase switch
        {
            "discovering" => ("discovering", "Finding the Host's project data…"),
            "downloading" => ("downloading", "Receiving project data…"),
            "verifying" => ("verifying", "Project data received. Verifying files before opening Unity…"),
            "awaitingtrust" => ("awaiting_trust", "Waiting for Publisher approval…"),
            "activating" => ("activating", "Preparing the verified Project…"),
            "directtransferunavailable" => ("unavailable", "The Host cannot provide the remaining data. Retry to reuse verified progress."),
            "rejected" => ("rejected", "Project verification stopped. Review the error before retrying."),
            _ => ("receiving", (string?)null),
        };

        double? percent = null;
        if (state is "receiving" or "downloading")
        {
            percent = ReadFiniteNumber(message, "percent");
            if (percent is null)
            {
                var completed = ReadFiniteNumber(message, "completedBytes") ?? ReadFiniteNumber(message, "receivedBytes");
                var total = ReadFiniteNumber(message, "totalBytes");
                if (completed is >= 0 && total is > 0)
                {
                    // Bound before dividing/multiplying so even extreme finite
                    // counters cannot overflow into a WPF-invalid NaN/Infinity.
                    percent = Math.Min(completed.Value, total.Value) / total.Value * 100;
                }
            }
            if (percent is not null) percent = Math.Clamp(percent.Value, 0, 100);
        }

        var text = ReadString(message, "message") ?? explanation ?? ReadString(message, "stage") ?? "Receiving project data…";
        return new ReceiveProgressPresentation(state, text, percent);
    }

    private static string? ReadString(JsonElement message, string name)
    {
        if (message.ValueKind != JsonValueKind.Object || !message.TryGetProperty(name, out var property) ||
            property.ValueKind != JsonValueKind.String) return null;
        var value = property.GetString();
        return string.IsNullOrWhiteSpace(value) ? null : value;
    }

    private static double? ReadFiniteNumber(JsonElement message, string name)
    {
        if (message.ValueKind != JsonValueKind.Object || !message.TryGetProperty(name, out var property)) return null;
        double value;
        if (property.ValueKind == JsonValueKind.Number && property.TryGetDouble(out value))
            return double.IsFinite(value) ? value : null;
        if (property.ValueKind == JsonValueKind.String && double.TryParse(property.GetString(),
            NumberStyles.Float, CultureInfo.InvariantCulture, out value))
            return double.IsFinite(value) ? value : null;
        return null;
    }
}

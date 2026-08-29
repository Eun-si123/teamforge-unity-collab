using System.IO.Compression;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace TeamForge.Launcher.Core;

public sealed record DiagnosticSupportBundleResult(string FullPath, long LengthBytes);

public static class DiagnosticSupportBundle
{
    public const int SchemaVersion = 1;

    private const int MaximumTextFieldCharacters = 4096;
    private static readonly UTF8Encoding Utf8NoBom = new(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true);

    public static DiagnosticSupportBundleResult Create(
        string outputPath,
        DiagnosticContext state,
        DiagnosticHistory history,
        params string?[] secrets)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(outputPath);
        ArgumentNullException.ThrowIfNull(state);
        ArgumentNullException.ThrowIfNull(history);

        var fullPath = Path.GetFullPath(outputPath);
        if (!string.Equals(Path.GetExtension(fullPath), ".zip", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidDataException("A TeamForge diagnostics bundle must use the .zip extension.");
        }

        var parent = Path.GetDirectoryName(fullPath);
        if (string.IsNullOrWhiteSpace(parent))
        {
            throw new InvalidDataException("The diagnostics bundle requires a regular parent directory.");
        }

        Directory.CreateDirectory(parent);

        var createdAt = DateTimeOffset.UtcNow;
        var redactionValues = secrets
            .Concat(new[] { state.ActivePath, state.ManagedRoot, state.StagingPath, state.Endpoint })
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Distinct(StringComparer.Ordinal)
            .ToArray();

        var manifest = new
        {
            schemaVersion = SchemaVersion,
            product = "TeamForge",
            createdAtUtc = createdAt.ToString("O"),
            manualExport = true,
            uploadedByTeamForge = false,
            redactionMode = "default",
            redacted = true,
            includes = new[]
            {
                "manifest",
                "safe runtime/platform summary",
                "safe current operation/error state",
                "bounded redacted current-run diagnostic history",
            },
            excludes = new[]
            {
                "access codes and authentication tokens",
                "private keys and authorization headers",
                "raw local paths",
                "raw endpoint addresses",
                "raw environment variables",
                "project payload/files",
                "Collaboration Invite contents",
                "arbitrary process dumps",
                "unbounded logs",
            },
        };

        var safeState = new
        {
            productVersion = SafeText(state.ProductVersion, redactionValues),
            launcherVersion = SafeText(state.LauncherVersion, redactionValues),
            packagedRuntimeVersion = SafeText(state.PackagedRuntimeVersion, redactionValues),
            runtimeManifestIdentity = SafeIdentity(state.RuntimeManifestIdentity),
            unityVersion = SafeText(state.UnityVersion, redactionValues),
            operation = SafeText(state.Operation, redactionValues),
            stableErrorCode = SafeText(state.StableErrorCode, redactionValues),
            detailedError = SafeText(state.DetailedErrorMessage, redactionValues),
            role = SafeText(state.Role, redactionValues),
            projectIdentity = DiagnosticHistory.ShortIdentity(SafeText(state.ProjectIdentity, redactionValues)),
            baselineRevision = state.BaselineRevision,
            activeRevision = state.ActiveRevision,
            transferState = SafeText(state.TransferState, redactionValues),
            processOwnershipState = SafeText(state.ProcessOwnershipState, redactionValues),
            coordinatorSeedHealth = SafeText(state.CoordinatorSeedHealthIdentity, redactionValues),
            previousVerifiedActiveAvailable = state.PreviousVerifiedActiveAvailable,
            runtimeVerificationStage = SafeText(state.RuntimeVerificationStage, redactionValues),
            pathSummary = new
            {
                activePathPresent = !string.IsNullOrWhiteSpace(state.ActivePath),
                activePathLength = SafeLength(state.ActivePath),
                managedRootPresent = !string.IsNullOrWhiteSpace(state.ManagedRoot),
                managedRootLength = SafeLength(state.ManagedRoot),
                stagingPathPresent = !string.IsNullOrWhiteSpace(state.StagingPath),
                stagingPathLength = SafeLength(state.StagingPath),
            },
            endpoint = BuildSafeEndpointSummary(state.Endpoint),
            platform = new
            {
                os = SafeText(RuntimeInformation.OSDescription, redactionValues),
                osArchitecture = RuntimeInformation.OSArchitecture.ToString(),
                processArchitecture = RuntimeInformation.ProcessArchitecture.ToString(),
                framework = SafeText(RuntimeInformation.FrameworkDescription, redactionValues),
            },
        };

        var historyText = BuildSafeHistory(history, redactionValues);
        var summaryText = BuildSummary(createdAt, safeState.productVersion, safeState.launcherVersion, safeState.unityVersion,
            safeState.operation, safeState.stableErrorCode, safeState.transferState, safeState.previousVerifiedActiveAvailable);

        using (var file = new FileStream(fullPath, FileMode.Create, FileAccess.ReadWrite, FileShare.None))
        using (var archive = new ZipArchive(file, ZipArchiveMode.Create, leaveOpen: false, entryNameEncoding: Encoding.UTF8))
        {
            WriteJson(archive, "manifest.json", manifest);
            WriteJson(archive, "state.json", safeState);
            WriteText(archive, "summary.txt", summaryText);
            WriteText(archive, "history-redacted.txt", historyText);
        }

        var length = new FileInfo(fullPath).Length;
        return new DiagnosticSupportBundleResult(fullPath, length);
    }

    private static object BuildSafeEndpointSummary(string? endpoint)
    {
        var value = (endpoint ?? string.Empty).Trim();
        if (value.Length == 0)
        {
            return new { configured = false, scheme = "unknown", port = 0, hostClass = "none" };
        }

        var candidate = value.Contains("://", StringComparison.Ordinal) ? value : $"ws://{value}";
        if (!Uri.TryCreate(candidate, UriKind.Absolute, out var uri))
        {
            return new { configured = true, scheme = "unknown", port = 0, hostClass = "unparsed" };
        }

        return new
        {
            configured = true,
            scheme = string.IsNullOrWhiteSpace(uri.Scheme) ? "unknown" : uri.Scheme,
            port = uri.IsDefaultPort ? 0 : uri.Port,
            hostClass = ClassifyHost(uri.Host),
        };
    }

    private static string ClassifyHost(string host)
    {
        if (string.Equals(host, "localhost", StringComparison.OrdinalIgnoreCase))
        {
            return "loopback";
        }

        if (!IPAddress.TryParse(host, out var address))
        {
            return "dns-name";
        }

        if (IPAddress.IsLoopback(address))
        {
            return "loopback";
        }

        if (address.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork)
        {
            var bytes = address.GetAddressBytes();
            var privateV4 = bytes[0] == 10 ||
                            (bytes[0] == 172 && bytes[1] is >= 16 and <= 31) ||
                            (bytes[0] == 192 && bytes[1] == 168) ||
                            (bytes[0] == 169 && bytes[1] == 254);
            return privateV4 ? "private-ip" : "public-ip";
        }

        var ipv6Bytes = address.GetAddressBytes();
        var uniqueLocalV6 = ipv6Bytes.Length == 16 && (ipv6Bytes[0] & 0xfe) == 0xfc;
        if (address.IsIPv6LinkLocal || address.IsIPv6SiteLocal || uniqueLocalV6)
        {
            return "private-ip";
        }

        return "public-ip";
    }

    private static string BuildSafeHistory(DiagnosticHistory history, string?[] redactionValues)
    {
        var builder = new StringBuilder();
        builder.AppendLine("TeamForge diagnostics history (bounded current run; redacted)");
        foreach (var entry in history.Entries)
        {
            builder.Append(entry.TimestampUtc.ToString("O"))
                .Append(" | ").Append(SafeText(entry.Operation, redactionValues))
                .Append(" | ").Append(SafeText(entry.Code, redactionValues))
                .Append(" | ").AppendLine(SafeText(entry.Detail, redactionValues));
        }
        return Bound(builder.ToString(), 64 * 1024);
    }

    private static string BuildSummary(
        DateTimeOffset createdAt,
        string productVersion,
        string launcherVersion,
        string unityVersion,
        string operation,
        string stableErrorCode,
        string transferState,
        bool previousVerifiedActiveAvailable)
    {
        var builder = new StringBuilder();
        builder.AppendLine("TeamForge support bundle");
        builder.AppendLine($"Created UTC: {createdAt:O}");
        builder.AppendLine("Privacy: default redaction; no automatic upload; raw paths/endpoints/secrets excluded");
        builder.AppendLine($"Product: {productVersion}");
        builder.AppendLine($"Launcher: {launcherVersion}");
        builder.AppendLine($"Unity: {unityVersion}");
        builder.AppendLine($"Operation: {operation}");
        builder.AppendLine($"Stable error code: {stableErrorCode}");
        builder.AppendLine($"Transfer state: {transferState}");
        builder.AppendLine($"Previous verified Active available: {(previousVerifiedActiveAvailable ? "yes" : "no")}");
        builder.AppendLine();
        builder.AppendLine("Review manifest.json before sharing if your environment has additional privacy requirements.");
        return builder.ToString();
    }

    private static string SafeIdentity(string? value)
    {
        var trimmed = (value ?? string.Empty).Trim();
        if (trimmed.Length == 0)
        {
            return "unknown";
        }

        return trimmed.Length <= 20 ? trimmed : $"{trimmed[..12]}…{trimmed[^6..]}";
    }

    private static int SafeLength(string? value) => string.IsNullOrEmpty(value) ? 0 : Math.Min(value.Length, 32_767);

    private static string SafeText(string? value, string?[] redactionValues)
    {
        var result = (value ?? string.Empty).Replace('\0', ' ');
        foreach (var sensitiveValue in redactionValues)
        {
            if (!string.IsNullOrEmpty(sensitiveValue))
            {
                result = result.Replace(sensitiveValue, "[redacted]", StringComparison.Ordinal);
            }
        }

        result = Regex.Replace(result, "(?i)(authorization\\s*:\\s*bearer\\s+)[^\\s]+", "$1[redacted]");
        result = Regex.Replace(result, "(?i)(access(?:[-_ ]?code)?|password|token|secret|private[-_ ]?key|api[-_ ]?key)\\s*[=:]\\s*[^\\s;,]+", "$1=[redacted]");
        result = Regex.Replace(result, @"(?i)\b(?:https?|wss?)://[^\s]+", "[url]");
        result = Regex.Replace(result, @"(?i)(?<![A-Z0-9])(?:[A-Z]:\\|\\\\)[^\r\n]+", "[path]");
        result = Regex.Replace(result, @"(?i)(?<![A-Z0-9])/(?:home|Users)/[^\r\n]+", "[path]");
        result = Regex.Replace(result, @"\b(?:\d{1,3}\.){3}\d{1,3}\b", "[ip]");
        result = Regex.Replace(result, @"(?i)(?<![A-F0-9:])(?:[A-F0-9]{0,4}::[A-F0-9:]*|(?:[A-F0-9]{1,4}:){3,7}[A-F0-9]{0,4})(?![A-F0-9:])", "[ip]");
        result = Regex.Replace(result, @"(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", "[email]");
        return Bound(result, MaximumTextFieldCharacters);
    }

    private static string Bound(string value, int maximumCharacters)
    {
        return value.Length <= maximumCharacters ? value : value[..maximumCharacters] + "…";
    }

    private static void WriteJson(ZipArchive archive, string name, object value)
    {
        var json = JsonSerializer.Serialize(value, new JsonSerializerOptions { WriteIndented = true });
        WriteText(archive, name, json + Environment.NewLine);
    }

    private static void WriteText(ZipArchive archive, string name, string value)
    {
        var entry = archive.CreateEntry(name, CompressionLevel.Optimal);
        using var stream = entry.Open();
        using var writer = new StreamWriter(stream, Utf8NoBom, bufferSize: 4096, leaveOpen: false);
        writer.Write(value);
    }
}

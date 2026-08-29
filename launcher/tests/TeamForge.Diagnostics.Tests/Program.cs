using System.IO.Compression;
using System.Text;
using System.Text.Json;
using TeamForge.Launcher.Core;

const string secret = "super-secret-access-code";
const string email = "alice@example.com";
const string rawIp = "192.168.1.77";
const string activePath = @"C:\Users\Alice\TeamForge Projects\Demo\active\9-abcdefabcdef";
const string stagingPath = @"D:\Private Projects\Demo\staging\download-1";
const string endpoint = "ws://192.168.1.77:5080/session?token=raw-token";

var root = Path.Combine(Path.GetTempPath(), $"teamforge-diagnostics-test-{Guid.NewGuid():N}");
Directory.CreateDirectory(root);
var output = Path.Combine(root, "TeamForge-Diagnostics-test.zip");

try
{
    var history = new DiagnosticHistory();
    history.Add(
        "project_receive",
        "peer_http_error",
        $"Authorization: Bearer {secret}; user={email}; file={activePath}; endpoint={endpoint}; host={rawIp}",
        secret);

    var context = new DiagnosticContext
    {
        ProductVersion = "0.5.1",
        LauncherVersion = "0.5.1",
        PackagedRuntimeVersion = "24.19.0",
        RuntimeManifestIdentity = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        UnityVersion = "6000.3.21f1",
        Operation = "project_receive",
        StableErrorCode = "peer_http_error",
        DetailedErrorMessage = $"password={secret} contact={email} source={activePath} endpoint={endpoint}",
        Role = "Guest",
        ProjectIdentity = "123e4567-e89b-42d3-a456-426614174000",
        BaselineRevision = 9,
        ActiveRevision = 8,
        ActivePath = activePath,
        ManagedRoot = @"C:\Users\Alice\TeamForge Projects",
        Endpoint = endpoint,
        ProcessOwnershipState = "guest-owned-runtime",
        CoordinatorSeedHealthIdentity = $"reachable:{rawIp}",
        TransferState = "receiving",
        StagingPath = stagingPath,
        RuntimeVerificationStage = "verified",
        PreviousVerifiedActiveAvailable = true,
    };

    var result = DiagnosticSupportBundle.Create(output, context, history, secret);
    True(File.Exists(result.FullPath), "bundle file exists");
    True(result.LengthBytes > 0 && result.LengthBytes < 256 * 1024, "bundle is non-empty and bounded");

    using var archive = ZipFile.OpenRead(output);
    var expectedEntries = new[] { "manifest.json", "state.json", "summary.txt", "history-redacted.txt" };
    foreach (var name in expectedEntries)
    {
        True(archive.GetEntry(name) is not null, $"bundle contains {name}");
    }
    Equal(expectedEntries.Length, archive.Entries.Count, "bundle contains only the documented default entries");

    var manifestText = Read(archive, "manifest.json");
    var stateText = Read(archive, "state.json");
    var summaryText = Read(archive, "summary.txt");
    var historyText = Read(archive, "history-redacted.txt");
    var allText = string.Join("\n", manifestText, stateText, summaryText, historyText);

    NotContains(allText, secret, "explicit secret");
    NotContains(allText, "raw-token", "query token");
    NotContains(allText, email, "email address");
    NotContains(allText, rawIp, "raw IP address");
    NotContains(allText, activePath, "raw Active path");
    NotContains(allText, stagingPath, "raw staging path");
    NotContains(allText, endpoint, "raw endpoint");
    NotContains(allText, "C:\\Users\\Alice", "Windows user path");
    NotContains(allText, "D:\\Private Projects", "private project path");

    using (var manifest = JsonDocument.Parse(manifestText))
    {
        var rootElement = manifest.RootElement;
        Equal(1, rootElement.GetProperty("schemaVersion").GetInt32(), "schema version");
        True(rootElement.GetProperty("manualExport").GetBoolean(), "manual export marker");
        True(rootElement.GetProperty("redacted").GetBoolean(), "redacted marker");
        False(rootElement.GetProperty("uploadedByTeamForge").GetBoolean(), "no automatic upload marker");
        var excludes = rootElement.GetProperty("excludes").EnumerateArray().Select(item => item.GetString()).ToArray();
        True(excludes.Any(item => item?.Contains("raw local paths", StringComparison.Ordinal) == true), "manifest documents raw path exclusion");
        True(excludes.Any(item => item?.Contains("raw environment variables", StringComparison.Ordinal) == true), "manifest documents environment exclusion");
    }

    using (var state = JsonDocument.Parse(stateText))
    {
        var stateRoot = state.RootElement;
        Equal("private-ip", stateRoot.GetProperty("endpoint").GetProperty("hostClass").GetString(), "endpoint host is classified, not copied");
        Equal(5080, stateRoot.GetProperty("endpoint").GetProperty("port").GetInt32(), "endpoint port retained for troubleshooting");
        True(stateRoot.GetProperty("pathSummary").GetProperty("activePathPresent").GetBoolean(), "path presence retained without path value");
        True(stateRoot.GetProperty("pathSummary").GetProperty("activePathLength").GetInt32() > 0, "path length retained without path value");
    }

    Console.WriteLine("PASS TeamForge diagnostics support bundle is bounded, local-only by contract, and privacy-safe by default.");
}
finally
{
    try
    {
        if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
    }
    catch (IOException)
    {
        // Test outcome must not be hidden by best-effort temp cleanup on Windows.
    }
    catch (UnauthorizedAccessException)
    {
        // Same as above.
    }
}

static string Read(ZipArchive archive, string name)
{
    var entry = archive.GetEntry(name) ?? throw new InvalidOperationException($"Missing ZIP entry: {name}");
    using var stream = entry.Open();
    using var reader = new StreamReader(stream, Encoding.UTF8, detectEncodingFromByteOrderMarks: true);
    return reader.ReadToEnd();
}

static void True(bool condition, string label)
{
    if (!condition) throw new InvalidOperationException($"Expected true: {label}");
}

static void False(bool condition, string label) => True(!condition, label);

static void Equal<T>(T expected, T actual, string label)
{
    if (!EqualityComparer<T>.Default.Equals(expected, actual))
    {
        throw new InvalidOperationException($"Expected {label} to be '{expected}', got '{actual}'.");
    }
}

static void NotContains(string value, string forbidden, string label)
{
    if (value.Contains(forbidden, StringComparison.OrdinalIgnoreCase))
    {
        throw new InvalidOperationException($"Diagnostics leaked {label}: {forbidden}");
    }
}

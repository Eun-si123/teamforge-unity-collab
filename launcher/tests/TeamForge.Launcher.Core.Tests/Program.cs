using System.Text;
using System.Text.Json;
using TeamForge.Launcher.Core;

var tests = new (string Name, Func<Task> Run)[]
{
    ("known folder defaults", TestKnownFoldersAsync),
    ("environment scrub", TestEnvironmentScrubAsync),
    ("path containment boundary", TestPathContainmentAsync),
    ("destination rejects Launcher subtrees", TestDestinationPolicyAsync),
    ("destination rejects UNC and device roots", TestDestinationAliasPolicyAsync),
    ("trust contract shows publisher mismatch", TestTrustContractAsync),
    ("verified runtime and process policy", TestRuntimeAndProcessPolicyAsync),
    ("runtime tamper rejected", TestRuntimeTamperAsync),
    ("runtime extra file rejected", TestRuntimeExtraFileAsync),
    ("verified Active and handoff", TestVerifiedActiveAsync),
    ("Active path shape rejected", TestActiveShapeRejectedAsync),
    ("Active root escape rejected", TestActiveEscapeRejectedAsync),
    ("handoff escape rejected", TestHandoffEscapeRejectedAsync),
    ("handoff tamper rejected", TestHandoffTamperRejectedAsync),
    ("stale verified handoff safely refreshed", TestStaleHandoffRefreshAsync),
    ("refresh rejects post-validation tamper", TestRefreshTamperRejectedAsync),
    ("refresh rejects future source timestamp", TestRefreshFutureTimestampRejectedAsync),
    ("refresh cleanup fails closed when source cannot retire", TestRefreshRetirementFailureAsync),
    ("Unity ArgumentList and environment", TestUnityStartInfoAsync),
    ("Unity version capability mismatch rejected", TestUnityCapabilityMismatchAsync),
    ("WP5 recovery model is stable-code and state driven", TestWp5RecoveryModelAsync),
    ("WP5 diagnostics are bounded and secret safe", TestWp5DiagnosticRedactionAsync),
    ("WP5 Unity path budget is actionable", TestWp5PathBudgetAsync),
    ("WP5 existing verified Active opens without session bypass", TestWp5ExistingActiveAsync),
    ("WP5.1 capability signals do not bypass Unity budget", TestPathCapabilityAsync),
    ("WP5.1 budget boundaries and Unicode", TestPathBudgetBoundariesAsync),
    ("WP5.1 managed root selection is safe and deterministic", TestManagedRootSelectorAsync),
    ("WP5.1 alias IDs preserve full identity", TestAliasAllocatorAsync),
    ("WP5.1 child toolchain environment is isolated", TestToolchainEnvironmentAsync),
    ("WP5.1 real owned execution junction lifecycle", TestExecutionAliasLifecycleAsync),
    ("WP5.1 unrelated alias root and replaced junction fail closed", TestExecutionAliasAttackAsync),
    ("WP5.1 risky verified Active launches through short alias", TestRiskyActiveLaunchPreparationAsync),
};

var failures = new List<string>();
foreach (var test in tests)
{
    try
    {
        await test.Run();
        Console.WriteLine($"PASS {test.Name}");
    }
    catch (Exception exception)
    {
        failures.Add($"{test.Name}: {exception.GetType().Name}: {exception.Message}");
        Console.WriteLine($"FAIL {test.Name}: {exception.Message}");
    }
}

Console.WriteLine($"RESULT {tests.Length - failures.Count}/{tests.Length} passed");
if (failures.Count != 0)
{
    Environment.ExitCode = 1;
}

static Task TestKnownFoldersAsync()
{
    var paths = LauncherPaths.FromKnownFolders(@"C:\Profiles\Guest\Documents", @"C:\Profiles\Guest\AppData\Local");
    Equal(@"C:\Profiles\Guest\TF", paths.DefaultProjectsRoot);
    Equal(@"C:\Profiles\Guest\AppData\Local\TeamForge\Launcher", paths.StateDirectory);
    var missingDocuments = LauncherPaths.FromKnownFolders(string.Empty, @"C:\State");
    Equal(string.Empty, missingDocuments.DefaultProjectsRoot);
    return Task.CompletedTask;
}

static Task TestEnvironmentScrubAsync()
{
    var environment = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase)
    {
        ["PATH"] = "safe",
        ["NODE_OPTIONS"] = "--require=C:\\evil.js",
        ["NODE_PATH"] = "C:\\project\\node_modules",
        ["NODE_TLS_REJECT_UNAUTHORIZED"] = "0",
        ["NODE_EXTRA_CA_CERTS"] = "C:\\evil-ca.pem",
        ["NODE_USE_ENV_PROXY"] = "1",
        ["SSL_CERT_FILE"] = "C:\\evil-ca.pem",
        ["SSL_CERT_DIR"] = "C:\\evil-certs",
        ["OPENSSL_CONF"] = "C:\\evil-openssl.cnf",
        ["npm_config_userconfig"] = "C:\\evil.npmrc",
        ["NPM_TOKEN"] = "test-value",
        ["COREPACK_HOME"] = "C:\\evil",
        ["TEAMFORGE_WORKSPACE_ROOT"] = "C:\\source",
        ["TEAMFORGE_NODE_PATH"] = "C:\\system\\node.exe",
    };
    EnvironmentPolicy.Scrub(environment);
    Equal(1, environment.Count);
    Equal("safe", environment["PATH"]);
    return Task.CompletedTask;
}

static Task TestPathContainmentAsync()
{
    var parent = Path.GetFullPath(Path.Combine(Path.GetTempPath(), "TeamForge Projects"));
    True(PathSafety.IsContainedBy(Path.Combine(parent, "child"), parent));
    False(PathSafety.IsContainedBy(parent, parent));
    False(PathSafety.IsContainedBy(parent + "-evil", parent));
    return Task.CompletedTask;
}

static Task TestDestinationPolicyAsync()
{
    var baseDirectory = Path.Combine(Path.GetTempPath(), "TeamForge Launcher");
    DriveType FixedDrive(string _) => DriveType.Fixed;
    Throws<InvalidDataException>(() => DestinationPolicy.ValidateManagedRoot(Path.Combine(baseDirectory, "projects"), baseDirectory, FixedDrive));
    Throws<InvalidDataException>(() => DestinationPolicy.ValidateManagedRoot(Path.Combine(baseDirectory, "Runtime", "projects"), baseDirectory, FixedDrive));
    Throws<InvalidDataException>(() => DestinationPolicy.ValidateManagedRoot(Path.GetDirectoryName(baseDirectory)!, baseDirectory, FixedDrive));
    var sibling = baseDirectory + "-projects";
    Equal(Path.GetFullPath(sibling), DestinationPolicy.ValidateManagedRoot(sibling, baseDirectory, FixedDrive));
    Throws<InvalidDataException>(() => DestinationPolicy.ValidateManagedRoot(sibling, baseDirectory, _ => DriveType.Network));
    Throws<InvalidDataException>(() => DestinationPolicy.ValidateManagedRoot(sibling, baseDirectory, _ => DriveType.NoRootDirectory));
    Throws<InvalidDataException>(() => DestinationPolicy.ValidateManagedRoot(sibling, baseDirectory, _ => throw new IOException("unavailable")));
    return Task.CompletedTask;
}

static Task TestDestinationAliasPolicyAsync()
{
    True(DestinationPolicy.IsOrdinaryWindowsDriveRoot(@"C:\"));
    False(DestinationPolicy.IsOrdinaryWindowsDriveRoot(@"\\server\share\"));
    False(DestinationPolicy.IsOrdinaryWindowsDriveRoot(@"\\?\C:\"));
    False(DestinationPolicy.IsOrdinaryWindowsDriveRoot(@"\\.\C:\"));
    True(DestinationPolicy.HasSafeWindowsPathShape(@"C:\Profiles\Guest\TeamForge Projects"));
    False(DestinationPolicy.HasSafeWindowsPathShape(@"C:\Profiles\\Guest\TeamForge Projects"));
    False(DestinationPolicy.HasSafeWindowsPathShape(@"C:\Profiles\Guest.\TeamForge Projects"));
    False(DestinationPolicy.HasSafeWindowsPathShape("C:\\Profiles\\Guest \\TeamForge Projects"));
    False(DestinationPolicy.HasSafeWindowsPathShape(@"C:\Profiles\CON\TeamForge Projects"));
    False(DestinationPolicy.HasSafeWindowsPathShape(@"C:\Profiles\aux.txt\TeamForge Projects"));
    False(DestinationPolicy.HasSafeWindowsPathShape(@"C:\Profiles\LPT9.data\TeamForge Projects"));
    False(DestinationPolicy.HasSafeWindowsPathShape(@"C:\Profiles\bad<name\TeamForge Projects"));
    False(DestinationPolicy.HasSafeWindowsPathShape("C:\\Profiles\\bad\u0001name\\TeamForge Projects"));
    False(DestinationPolicy.HasSafeWindowsPathShape(@"C:/Profiles/Guest/TeamForge Projects"));

    var application = Path.Combine(Path.GetTempPath(), "TeamForge Launcher");
    Throws<InvalidDataException>(() => DestinationPolicy.ValidateManagedRoot(@"\\server\share\TeamForge Projects", application, _ => DriveType.Fixed));
    Throws<InvalidDataException>(() => DestinationPolicy.ValidateManagedRoot(@"\\?\C:\TeamForge Projects", application, _ => DriveType.Fixed));
    return Task.CompletedTask;
}

static Task TestTrustContractAsync()
{
    using var message = JsonDocument.Parse("""
    {
      "challengeId":"challenge-1",
      "projectId":"Demo",
      "projectUuid":"123e4567-e89b-42d3-a456-426614174000",
      "baselineRevision":3,
      "ownerFingerprint":"owner-current-full",
      "publisherFingerprint":"publisher-current-full",
      "previousOwnerFingerprint":"owner-previous-full",
      "previousPublisherFingerprint":"publisher-previous-full",
      "containsScripts":true,
      "containsPackages":false
    }
    """);
    var presentation = TrustPresentation.FromBridgeEvent(message.RootElement);
    True(presentation.PublisherChanged);
    True(presentation.OwnerChanged);
    True(presentation.FriendlyText.Contains("Warning:", StringComparison.Ordinal));
    True(presentation.AdvancedText.Contains("publisher-previous-full", StringComparison.Ordinal));
    True(presentation.AdvancedText.Contains("Contains scripts: yes", StringComparison.Ordinal));
    True(presentation.AdvancedText.Contains("Contains packages: no", StringComparison.Ordinal));

    using var unchangedMessage = JsonDocument.Parse("""
    {
      "challengeId":"challenge-2",
      "ownerFingerprint":"owner",
      "publisherFingerprint":"publisher",
      "previousPublisherFingerprint":"publisher",
      "containsScripts":false,
      "containsPackages":false
    }
    """);
    var unchanged = TrustPresentation.FromBridgeEvent(unchangedMessage.RootElement);
    False(unchanged.PublisherChanged);
    False(unchanged.OwnerChanged);
    False(unchanged.FriendlyText.Contains("Warning:", StringComparison.Ordinal));
    return Task.CompletedTask;
}

static async Task TestRuntimeAndProcessPolicyAsync()
{
    await using var fixture = await RuntimeFixture.CreateAsync();
    var verified = await RuntimeLayoutVerifier.VerifyAsync(fixture.BaseDirectory, fixture.Pins);
    var previousNodeOptions = Environment.GetEnvironmentVariable("NODE_OPTIONS");
    var previousWorkspace = Environment.GetEnvironmentVariable("TEAMFORGE_WORKSPACE_ROOT");
    var previousNodeTls = Environment.GetEnvironmentVariable("NODE_TLS_REJECT_UNAUTHORIZED");
    var previousExtraCa = Environment.GetEnvironmentVariable("NODE_EXTRA_CA_CERTS");
    var previousSslCert = Environment.GetEnvironmentVariable("SSL_CERT_FILE");
    var previousSslDirectory = Environment.GetEnvironmentVariable("SSL_CERT_DIR");
    var previousOpenSsl = Environment.GetEnvironmentVariable("OPENSSL_CONF");
    try
    {
        Environment.SetEnvironmentVariable("NODE_OPTIONS", "--require=C:\\marker.js");
        Environment.SetEnvironmentVariable("TEAMFORGE_WORKSPACE_ROOT", "C:\\source");
        Environment.SetEnvironmentVariable("NODE_TLS_REJECT_UNAUTHORIZED", "0");
        Environment.SetEnvironmentVariable("NODE_EXTRA_CA_CERTS", "C:\\evil-ca.pem");
        Environment.SetEnvironmentVariable("SSL_CERT_FILE", "C:\\evil-ca.pem");
        Environment.SetEnvironmentVariable("SSL_CERT_DIR", "C:\\evil-certs");
        Environment.SetEnvironmentVariable("OPENSSL_CONF", "C:\\evil-openssl.cnf");
        var startInfo = RuntimeProcessPolicy.CreateBridgeStartInfo(verified);
        Equal(verified.NodeExecutable, startInfo.FileName);
        Equal(verified.BaseDirectory, startInfo.WorkingDirectory);
        False(startInfo.UseShellExecute);
        True(startInfo.RedirectStandardInput && startInfo.RedirectStandardOutput && startInfo.RedirectStandardError);
        Equal(5, startInfo.ArgumentList.Count);
        Equal(verified.Loader, startInfo.ArgumentList[0]);
        Equal("--runtime-root", startInfo.ArgumentList[1]);
        Equal(verified.RuntimeRoot, startInfo.ArgumentList[2]);
        Equal("--manifest-sha256", startInfo.ArgumentList[3]);
        Equal(fixture.Pins.RuntimeManifestSha256, startInfo.ArgumentList[4]);
        False(startInfo.Environment.ContainsKey("NODE_OPTIONS"));
        False(startInfo.Environment.ContainsKey("NODE_TLS_REJECT_UNAUTHORIZED"));
        False(startInfo.Environment.ContainsKey("NODE_EXTRA_CA_CERTS"));
        False(startInfo.Environment.ContainsKey("SSL_CERT_FILE"));
        False(startInfo.Environment.ContainsKey("SSL_CERT_DIR"));
        False(startInfo.Environment.ContainsKey("OPENSSL_CONF"));
        False(startInfo.Environment.ContainsKey("TEAMFORGE_WORKSPACE_ROOT"));
    }
    finally
    {
        Environment.SetEnvironmentVariable("NODE_OPTIONS", previousNodeOptions);
        Environment.SetEnvironmentVariable("TEAMFORGE_WORKSPACE_ROOT", previousWorkspace);
        Environment.SetEnvironmentVariable("NODE_TLS_REJECT_UNAUTHORIZED", previousNodeTls);
        Environment.SetEnvironmentVariable("NODE_EXTRA_CA_CERTS", previousExtraCa);
        Environment.SetEnvironmentVariable("SSL_CERT_FILE", previousSslCert);
        Environment.SetEnvironmentVariable("SSL_CERT_DIR", previousSslDirectory);
        Environment.SetEnvironmentVariable("OPENSSL_CONF", previousOpenSsl);
    }
}

static async Task TestRuntimeTamperAsync()
{
    await using var fixture = await RuntimeFixture.CreateAsync();
    await File.AppendAllTextAsync(fixture.BridgePath, "tamper");
    await ThrowsAsync<RuntimeVerificationException>(() => RuntimeLayoutVerifier.VerifyAsync(fixture.BaseDirectory, fixture.Pins));
}

static async Task TestRuntimeExtraFileAsync()
{
    await using var fixture = await RuntimeFixture.CreateAsync();
    await File.WriteAllTextAsync(Path.Combine(fixture.RuntimeRoot, "extra.mjs"), "malicious");
    await ThrowsAsync<RuntimeVerificationException>(() => RuntimeLayoutVerifier.VerifyAsync(fixture.BaseDirectory, fixture.Pins));
}

static async Task TestVerifiedActiveAsync()
{
    await using var fixture = await ActiveFixture.CreateAsync();
    var verified = await UnityLaunchPolicy.ValidateActiveResultAsync(fixture.ManagedRoot, fixture.StateRoot, fixture.Result.RootElement);
    Equal(fixture.ActivePath, verified.ActivePath);
    Equal("6000.0.65f1", verified.UnityVersion);
}

static async Task TestActiveShapeRejectedAsync()
{
    await using var fixture = await ActiveFixture.CreateAsync(activeName: "not-an-active-name");
    await ThrowsAsync<InvalidDataException>(() => UnityLaunchPolicy.ValidateActiveResultAsync(fixture.ManagedRoot, fixture.StateRoot, fixture.Result.RootElement));
}

static async Task TestHandoffEscapeRejectedAsync()
{
    await using var fixture = await ActiveFixture.CreateAsync();
    var escaped = Path.Combine(fixture.StateRoot, "handoff", "escaped.json");
    Directory.CreateDirectory(Path.GetDirectoryName(escaped)!);
    await File.WriteAllTextAsync(escaped, "{}");
    var hash = await PathSafety.Sha256FileAsync(escaped);
    using var result = JsonDocument.Parse(JsonSerializer.Serialize(new
    {
        activePath = fixture.ActivePath,
        unityVersion = "6000.0.65f1",
        handoffPath = escaped,
        handoffSha256 = hash,
    }));
    await ThrowsAsync<InvalidDataException>(() => UnityLaunchPolicy.ValidateActiveResultAsync(fixture.ManagedRoot, fixture.StateRoot, result.RootElement));
}

static async Task TestActiveEscapeRejectedAsync()
{
    await using var fixture = await ActiveFixture.CreateAsync();
    var escaped = Path.Combine(fixture.Root, "outside", "123e4567-e89b-42d3-a456-426614174000", "active", "3-abcdefabcdef");
    using var result = JsonDocument.Parse(JsonSerializer.Serialize(new
    {
        activePath = escaped,
        unityVersion = "6000.0.65f1",
        handoffPath = fixture.Result.RootElement.GetProperty("handoffPath").GetString(),
        handoffSha256 = fixture.Result.RootElement.GetProperty("handoffSha256").GetString(),
    }));
    await ThrowsAsync<InvalidDataException>(() => UnityLaunchPolicy.ValidateActiveResultAsync(fixture.ManagedRoot, fixture.StateRoot, result.RootElement));
}

static async Task TestHandoffTamperRejectedAsync()
{
    await using var fixture = await ActiveFixture.CreateAsync();
    var handoff = fixture.Result.RootElement.GetProperty("handoffPath").GetString()!;
    await File.AppendAllTextAsync(handoff, "tamper");
    await ThrowsAsync<InvalidDataException>(() => UnityLaunchPolicy.ValidateActiveResultAsync(fixture.ManagedRoot, fixture.StateRoot, fixture.Result.RootElement));
}

static async Task TestStaleHandoffRefreshAsync()
{
    const long originalTimestamp = 1_700_000_000_000;
    const long launchTimestamp = originalTimestamp + 16 * 60 * 1000;
    await using var fixture = await ActiveFixture.CreateAsync(createdAtUnixMs: originalTimestamp);
    var verified = await UnityLaunchPolicy.ValidateActiveResultAsync(
        fixture.ManagedRoot,
        fixture.StateRoot,
        fixture.Result.RootElement);
    var refreshed = await UnityLaunchPolicy.RefreshHandoffForUnityLaunchAsync(verified, launchTimestamp);

    False(string.Equals(verified.HandoffPath, refreshed.HandoffPath, StringComparison.OrdinalIgnoreCase));
    True(PathSafety.IsContainedBy(refreshed.HandoffPath, Path.Combine(fixture.StateRoot, "guest-core", "handoff")));
    False(File.Exists(verified.HandoffPath));
    True(File.Exists(refreshed.HandoffPath));
    Equal(refreshed.HandoffSha256, await PathSafety.Sha256FileAsync(refreshed.HandoffPath));

    using var original = JsonDocument.Parse(fixture.OriginalHandoffJson);
    using var replacement = JsonDocument.Parse(await File.ReadAllTextAsync(refreshed.HandoffPath));
    Equal(launchTimestamp, replacement.RootElement.GetProperty("createdAtUnixMs").GetInt64());
    foreach (var name in new[]
             {
                 "schemaVersion", "projectUuid", "baselineRevision", "manifestHash", "descriptorHash",
                 "ownerKeyId", "publisherKeyId", "activeProjectPath", "sessionJoinCode",
             })
    {
        Equal(original.RootElement.GetProperty(name).GetRawText(), replacement.RootElement.GetProperty(name).GetRawText());
    }
    False(replacement.RootElement.TryGetProperty("authenticationToken", out _));
    False(replacement.RootElement.TryGetProperty("accessCode", out _));

    UnityLaunchPolicy.DeleteRefreshedHandoff(refreshed);
    False(File.Exists(refreshed.HandoffPath));
}

static async Task TestRefreshTamperRejectedAsync()
{
    await using var fixture = await ActiveFixture.CreateAsync();
    var verified = await UnityLaunchPolicy.ValidateActiveResultAsync(
        fixture.ManagedRoot,
        fixture.StateRoot,
        fixture.Result.RootElement);
    await File.AppendAllTextAsync(verified.HandoffPath, "tamper-after-validation");
    await ThrowsAsync<InvalidDataException>(() => UnityLaunchPolicy.RefreshHandoffForUnityLaunchAsync(verified));
}

static async Task TestRefreshFutureTimestampRejectedAsync()
{
    const long launchTimestamp = 1_700_000_000_000;
    await using var fixture = await ActiveFixture.CreateAsync(createdAtUnixMs: launchTimestamp + 6 * 60 * 1000);
    var verified = await UnityLaunchPolicy.ValidateActiveResultAsync(
        fixture.ManagedRoot,
        fixture.StateRoot,
        fixture.Result.RootElement);
    await ThrowsAsync<InvalidDataException>(() =>
        UnityLaunchPolicy.RefreshHandoffForUnityLaunchAsync(verified, launchTimestamp));
    True(File.Exists(verified.HandoffPath));
}

static async Task TestRefreshRetirementFailureAsync()
{
    await using var fixture = await ActiveFixture.CreateAsync();
    var verified = await UnityLaunchPolicy.ValidateActiveResultAsync(
        fixture.ManagedRoot,
        fixture.StateRoot,
        fixture.Result.RootElement);
    using (var lockStream = new FileStream(verified.HandoffPath, FileMode.Open, FileAccess.Read, FileShare.Read))
    {
        await ThrowsAsync<IOException>(() => UnityLaunchPolicy.RefreshHandoffForUnityLaunchAsync(verified));
    }

    True(File.Exists(verified.HandoffPath));
    var handoffRoot = Path.Combine(fixture.StateRoot, "guest-core", "handoff");
    Equal(0, Directory.GetFiles(handoffRoot, "unity-launch-*.json").Length);
}

static Task TestUnityStartInfoAsync()
{
    var root = Path.Combine(Path.GetTempPath(), "Unity Editor & safe");
    var editor = Path.Combine(root, "Unity.exe");
    var active = Path.Combine(Path.GetTempPath(), "TeamForge Projects", "123e4567-e89b-42d3-a456-426614174000", "active", "3-abcdefabcdef");
    var handoff = Path.Combine(Path.GetTempPath(), "state", "guest-core", "handoff", "a.json");
    var project = new VerifiedActiveProject(Path.GetDirectoryName(Path.GetDirectoryName(Path.GetDirectoryName(active))!)!, active, "6000.0.65f1", handoff, new string('a', 64));
    var verifiedEditor = new VerifiedUnityEditor(editor, "6000.0.65f1");
    const string authenticationToken = "memory-only-access-code";
    var startInfo = UnityLaunchPolicy.CreateUnityOpenStartInfo(verifiedEditor, project, authenticationToken);
    False(startInfo.UseShellExecute);
    Equal(editor, startInfo.FileName);
    Equal(2, startInfo.ArgumentList.Count);
    Equal("-projectPath", startInfo.ArgumentList[0]);
    Equal(active, startInfo.ArgumentList[1]);
    Equal(handoff, startInfo.Environment["TEAMFORGE_GUEST_HANDOFF_PATH"]);
    Equal(new string('a', 64), startInfo.Environment["TEAMFORGE_GUEST_HANDOFF_SHA256"]);
    Equal(authenticationToken, startInfo.Environment[UnityLaunchPolicy.GuestAuthenticationEnvironmentVariable]);
    False(startInfo.Environment.ContainsKey("TEAMFORGE_WORKSPACE_ROOT"));
    var unauthenticated = UnityLaunchPolicy.CreateUnityOpenStartInfo(verifiedEditor, project);
    False(unauthenticated.Environment.ContainsKey(UnityLaunchPolicy.GuestAuthenticationEnvironmentVariable));
    Throws<InvalidDataException>(() => UnityLaunchPolicy.CreateUnityOpenStartInfo(verifiedEditor, project, "bad\ncode"));
    return Task.CompletedTask;
}

static Task TestUnityCapabilityMismatchAsync()
{
    var editor = new VerifiedUnityEditor(Path.Combine(Path.GetTempPath(), "Unity.exe"), "2022.3.62f1");
    var project = new VerifiedActiveProject(
        Path.Combine(Path.GetTempPath(), "TeamForge Projects"),
        Path.Combine(Path.GetTempPath(), "TeamForge Projects", "123e4567-e89b-42d3-a456-426614174000", "active", "3-abcdefabcdef"),
        "6000.0.65f1",
        Path.Combine(Path.GetTempPath(), "state", "guest-core", "handoff", "a.json"),
        new string('a', 64));
    try
    {
        UnityLaunchPolicy.CreateUnityOpenStartInfo(editor, project);
    }
    catch (InvalidDataException)
    {
        return Task.CompletedTask;
    }

    throw new InvalidOperationException("Expected mismatched verified Unity capability to be rejected.");
}

static Task TestWp5RecoveryModelAsync()
{
    var version = RecoveryUx.Resolve("teamforge_version_mismatch", new DiagnosticContext
    {
        LauncherVersion = "0.5.0",
        InviteProductVersion = "0.5.1",
    });
    Equal("TeamForge version mismatch", version.Title);
    True(version.Message.Contains("Invite: TeamForge 0.5.1", StringComparison.Ordinal));
    True(version.Message.Contains("Launcher: TeamForge 0.5.0", StringComparison.Ordinal));

    var staleScene = RecoveryUx.Resolve("scene_baseline_mismatch", new DiagnosticContext
    {
        PreviousVerifiedActiveAvailable = true,
        ActivePath = @"C:\TF\project\active\1-abcdefabcdef",
    });
    Equal("Saved Scene does not match the current Host baseline", staleScene.Title);
    True(staleScene.Actions.Contains(RecoveryActionKind.UseLatestProject));
    True(staleScene.Actions.Contains(RecoveryActionKind.OpenExistingVerifiedProject));
    True(staleScene.Message.Contains("will not bypass", StringComparison.OrdinalIgnoreCase));

    var wrongCode = RecoveryUx.Resolve("access_code_incorrect", new DiagnosticContext());
    True(wrongCode.Actions.Contains(RecoveryActionKind.EnterAccessCodeAgain));
    True(wrongCode.Actions.Contains(RecoveryActionKind.Retry));

    var port = RecoveryUx.Resolve("port_conflict", new DiagnosticContext { Role = "Host" });
    Equal("Collaboration service is already using this port", port.Title);
    True(port.Message.Contains("did not stop the unknown process", StringComparison.Ordinal));

    var transfer = RecoveryUx.Resolve("required_revision_download_failed", new DiagnosticContext
    {
        PreviousVerifiedActiveAvailable = true,
        ActivePath = @"C:\TF\project\active\1-abcdefabcdef",
    });
    True(transfer.Message.Contains("previous verified project is still safe", StringComparison.OrdinalIgnoreCase));
    True(transfer.Actions.Contains(RecoveryActionKind.OpenExistingVerifiedProject));
    return Task.CompletedTask;
}

static Task TestWp5DiagnosticRedactionAsync()
{
    const string accessCode = "memory-only-access-code";
    const string bearer = "secret-bearer-value";
    var history = new DiagnosticHistory();
    for (var index = 0; index < 40; index++)
    {
        history.Add("receive", "access_code_incorrect", $"accessCode={accessCode} Authorization: Bearer {bearer} item={index}", accessCode, bearer);
    }
    Equal(32, history.Entries.Count);
    var bundle = history.BuildCopyBundle(new DiagnosticContext
    {
        Operation = "receive",
        StableErrorCode = "access_code_incorrect",
        DetailedErrorMessage = $"token={bearer}",
        ProjectIdentity = "123e4567-e89b-42d3-a456-426614174000",
        ManagedRoot = @"C:\TF",
        Endpoint = "http://192.0.2.10:5080",
        PreviousVerifiedActiveAvailable = true,
    }, accessCode, bearer);
    False(bundle.Contains(accessCode, StringComparison.Ordinal));
    False(bundle.Contains(bearer, StringComparison.Ordinal));
    True(bundle.Contains("[redacted]", StringComparison.Ordinal));
    True(bundle.Contains("123e4567…4000", StringComparison.Ordinal));
    True(bundle.Contains("Previous verified Active available: yes", StringComparison.Ordinal));
    False(DiagnosticHistory.Redact(@"C:\Users\<user>\Documents\TF").Contains("<user>", StringComparison.Ordinal));
    var coalesced = new DiagnosticHistory();
    coalesced.Add("receive", "path_budget_risk_detected", "same");
    coalesced.Add("receive", "path_budget_risk_detected", "same");
    Equal(1, coalesced.Entries.Count);
    True(coalesced.Entries[0].Detail.EndsWith("(x2)", StringComparison.Ordinal));
    return Task.CompletedTask;
}

static Task TestWp5PathBudgetAsync()
{
    var shortPath = UnityPathBudgetPolicy.Assess(@"C:\TF", "123e4567-e89b-42d3-a456-426614174000");
    var longPath = UnityPathBudgetPolicy.Assess(
        @"D:\Very Long TeamForge Projects Root Used For Unity Package Cache Risk And Generated Assets",
        "123e4567-e89b-42d3-a456-426614174000");
    False(shortPath.HighRisk);
    True(longPath.HighRisk);
    True(longPath.EstimatedGeneratedPathLength >= UnityPathBudgetPolicy.HighRiskPathLength);
    var recovery = RecoveryUx.Resolve("path_length_risk", new DiagnosticContext());
    True(recovery.Actions.Contains(RecoveryActionKind.ChooseShorterProjectLocation));
    return Task.CompletedTask;
}

static async Task TestWp5ExistingActiveAsync()
{
    await using var fixture = await ActiveFixture.CreateAsync();
    var project = await UnityLaunchPolicy.ValidateExistingActiveAsync(
        fixture.ManagedRoot,
        fixture.ActivePath,
        "6000.0.65f1");
    var editor = new VerifiedUnityEditor(Path.Combine(Path.GetTempPath(), "Unity.exe"), "6000.0.65f1");
    var start = UnityLaunchPolicy.CreateExistingProjectOpenStartInfo(editor, project);
    Equal("-projectPath", start.ArgumentList[0]);
    Equal(fixture.ActivePath, start.ArgumentList[1]);
    False(start.Environment.ContainsKey("TEAMFORGE_GUEST_HANDOFF_PATH"));
    False(start.Environment.ContainsKey(UnityLaunchPolicy.GuestAuthenticationEnvironmentVariable));
}

static Task TestPathCapabilityAsync()
{
    var enabled = PathCapabilityProbe.FromSignals(1, launcherLongPathAware: true, "NTFS", reparsePointsSupported: true, isLocalFixedDrive: true);
    True(enabled.LongPathsEnabled);
    True(enabled.LauncherLongPathAware);
    True(enabled.ExecutionJunctionSupported);
    var disabled = PathCapabilityProbe.FromSignals(0, launcherLongPathAware: true, "NTFS", true, true);
    False(disabled.LongPathsEnabled);
    var missing = PathCapabilityProbe.FromSignals(null, launcherLongPathAware: true, "ReFS", true, true);
    False(missing.LongPathsEnabled);
    True(missing.ExecutionJunctionSupported);
    var unsupported = PathCapabilityProbe.FromSignals(1, launcherLongPathAware: true, "FAT32", false, true);
    False(unsupported.ExecutionJunctionSupported);

    var risk = PathBudgetAnalyzer.AssessExplicitLength(271);
    True(risk.HighRisk);
    var route = PathStrategyRouter.Select(risk, enabled, executionAliasAvailable: true);
    Equal(PathStrategy.ExecutionAlias, route.Strategy);
    return Task.CompletedTask;
}

static Task TestPathBudgetBoundariesAsync()
{
    False(PathBudgetAnalyzer.AssessExplicitLength(259).HighRisk);
    True(PathBudgetAnalyzer.AssessExplicitLength(260).HighRisk);
    True(PathBudgetAnalyzer.AssessExplicitLength(263).HighRisk);
    True(PathBudgetAnalyzer.AssessExplicitLength(271).HighRisk);
    var unicode = PathBudgetAnalyzer.AssessActivePath(@"C:\사용자 이름\팀 포지 프로젝트\프로젝트", "Library/PackageCache/패키지/파일.asset");
    Equal(unicode.ActivePathLength + "Library/PackageCache/패키지/파일.asset".Length + 1, unicode.EstimatedGeneratedPathLength);
    return Task.CompletedTask;
}

static Task TestManagedRootSelectorAsync()
{
    var candidates = new[]
    {
        new ManagedRootCandidate(@"C:\Users\<user>\Documents\TeamForge Projects", true, true, true, false, 271),
        new ManagedRootCandidate(@"C:\Users\<user>\TF", true, true, true, false, 224),
        new ManagedRootCandidate(@"D:\TF", true, true, false, false, 203),
    };
    var selected = ManagedRootSelector.Select(candidates);
    Equal(@"C:\Users\<user>\TF", selected.Path);
    Throws<InvalidDataException>(() => ManagedRootSelector.Select(new[]
    {
        new ManagedRootCandidate(@"C:\TF", false, true, true, false, 180),
        new ManagedRootCandidate(@"\\server\share\TF", true, false, true, false, 180),
    }));
    return Task.CompletedTask;
}

static Task TestAliasAllocatorAsync()
{
    const string project = "123e4567-e89b-42d3-a456-426614174000";
    const string manifest = "abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd";
    var first = PathAliasAllocator.Allocate(project, 2, manifest, Array.Empty<string>());
    var again = PathAliasAllocator.Allocate(project, 2, manifest, Array.Empty<string>());
    Equal(first, again);
    True(first.Length <= 18);
    var expanded = PathAliasAllocator.Allocate(project, 2, manifest, new[] { first });
    False(string.Equals(first, expanded, StringComparison.OrdinalIgnoreCase));
    True(expanded.Length > first.Length);
    return Task.CompletedTask;
}

static Task TestToolchainEnvironmentAsync()
{
    var original = Environment.GetEnvironmentVariable("UPM_CACHE_ROOT");
    var environment = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase)
    {
        ["PATH"] = "safe",
        ["UPM_CACHE_ROOT"] = @"C:\user-global",
    };
    ToolchainPathEnvironment.ApplyUnityCaches(environment, @"C:\TFX\cache");
    Equal(@"C:\TFX\cache\upm", environment["UPM_CACHE_ROOT"]);
    Equal(@"C:\TFX\cache\npm", environment["UPM_NPM_CACHE_PATH"]);
    Equal(@"C:\TFX\cache\git-lfs", environment["UPM_GIT_LFS_CACHE_PATH"]);
    Equal(original, Environment.GetEnvironmentVariable("UPM_CACHE_ROOT"));
    return Task.CompletedTask;
}

static async Task TestExecutionAliasLifecycleAsync()
{
    if (!OperatingSystem.IsWindows()) return;
    var scratch = Path.Combine(Path.GetTempPath(), "teamforge-path-alias-tests", Guid.NewGuid().ToString("N"));
    var target = Path.Combine(scratch, "target");
    var root = Path.Combine(scratch, "aliases");
    Directory.CreateDirectory(target);
    try
    {
        var identity = new ExecutionAliasIdentity(
            "123e4567-e89b-42d3-a456-426614174000",
            2,
            "abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd");
        var created = await ExecutionAliasManager.PrepareAsync(root, target, identity);
        True(created.WasCreated);
        True(Directory.Exists(created.AliasPath));
        var reused = await ExecutionAliasManager.PrepareAsync(root, target, identity);
        False(reused.WasCreated);
        Equal(created.AliasPath, reused.AliasPath);
        await ExecutionAliasManager.RemoveIfOwnedAsync(created);
        False(Directory.Exists(created.AliasPath));
    }
    finally
    {
        if (Directory.Exists(scratch)) Directory.Delete(scratch, recursive: true);
    }
}

static async Task TestExecutionAliasAttackAsync()
{
    if (!OperatingSystem.IsWindows()) return;
    var scratch = Path.Combine(Path.GetTempPath(), "teamforge-path-alias-negative-tests", Guid.NewGuid().ToString("N"));
    var target = Path.Combine(scratch, "target");
    var unrelatedRoot = Path.Combine(scratch, "unrelated");
    var ownedRoot = Path.Combine(scratch, "owned");
    Directory.CreateDirectory(target);
    Directory.CreateDirectory(unrelatedRoot);
    var identity = new ExecutionAliasIdentity(
        "123e4567-e89b-42d3-a456-426614174000",
        7,
        "abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd");
    try
    {
        await ThrowsAsync<InvalidDataException>(() => ExecutionAliasManager.PrepareAsync(unrelatedRoot, target, identity));
        var created = await ExecutionAliasManager.PrepareAsync(ownedRoot, target, identity);
        Directory.Delete(created.AliasPath);
        Directory.CreateDirectory(created.AliasPath);
        await ThrowsAsync<InvalidDataException>(() => ExecutionAliasManager.PrepareAsync(ownedRoot, target, identity));
        True(Directory.Exists(target));
    }
    finally
    {
        if (Directory.Exists(scratch)) Directory.Delete(scratch, recursive: true);
    }
}

static async Task TestRiskyActiveLaunchPreparationAsync()
{
    if (!OperatingSystem.IsWindows()) return;
    await using var fixture = await ActiveFixture.CreateAsync(rootPadding: new string('길', 90));
    var project = await UnityLaunchPolicy.ValidateActiveResultAsync(fixture.ManagedRoot, fixture.StateRoot, fixture.Result.RootElement);
    True(PathBudgetAnalyzer.AssessActivePath(project.ActivePath).HighRisk);
    var aliasRoot = Path.Combine(Path.GetTempPath(), "tfx-launch", Guid.NewGuid().ToString("N"));
    try
    {
        var prepared = await UnityPathStrategy.PrepareAsync(project, aliasRoot);
        Equal(PathStrategy.ExecutionAlias, prepared.Strategy);
        False(PathBudgetAnalyzer.AssessActivePath(prepared.UnityVisiblePath).HighRisk);
        var editor = new VerifiedUnityEditor(Path.Combine(Path.GetTempPath(), "Unity.exe"), project.UnityVersion);
        var start = UnityLaunchPolicy.CreateUnityOpenStartInfo(editor, project, "memory-only", prepared);
        Equal(prepared.UnityVisiblePath, start.ArgumentList[1]);
        True(start.Environment.ContainsKey("UPM_CACHE_ROOT"));
        Equal(project.ActivePath, prepared.CanonicalActivePath);
        if (prepared.Alias is not null) await ExecutionAliasManager.RemoveIfOwnedAsync(prepared.Alias);
    }
    finally
    {
        if (Directory.Exists(aliasRoot)) Directory.Delete(aliasRoot, recursive: true);
    }
}

static void Equal<T>(T expected, T actual)
{
    if (!EqualityComparer<T>.Default.Equals(expected, actual))
    {
        throw new InvalidOperationException($"Expected [{expected}] but got [{actual}].");
    }
}

static void True(bool value)
{
    if (!value) throw new InvalidOperationException("Expected true.");
}

static void False(bool value)
{
    if (value) throw new InvalidOperationException("Expected false.");
}

static async Task ThrowsAsync<TException>(Func<Task> action) where TException : Exception
{
    try
    {
        await action();
    }
    catch (TException)
    {
        return;
    }

    throw new InvalidOperationException($"Expected {typeof(TException).Name}.");
}

static void Throws<TException>(Action action) where TException : Exception
{
    try
    {
        action();
    }
    catch (TException)
    {
        return;
    }

    throw new InvalidOperationException($"Expected {typeof(TException).Name}.");
}

sealed class RuntimeFixture : IAsyncDisposable
{
    private RuntimeFixture(string baseDirectory, string runtimeRoot, string bridgePath, RuntimeTrustPins pins)
    {
        BaseDirectory = baseDirectory;
        RuntimeRoot = runtimeRoot;
        BridgePath = bridgePath;
        Pins = pins;
    }

    public string BaseDirectory { get; }
    public string RuntimeRoot { get; }
    public string BridgePath { get; }
    public RuntimeTrustPins Pins { get; }

    public static async Task<RuntimeFixture> CreateAsync()
    {
        var baseDirectory = Path.Combine(Path.GetTempPath(), "teamforge-launcher-runtime-tests", Guid.NewGuid().ToString("N"));
        var runtimeRoot = Path.Combine(baseDirectory, "Runtime");
        var node = Path.Combine(runtimeRoot, "platforms", "win-x64", "node.exe");
        var bridge = Path.Combine(runtimeRoot, "backend", "project-peer", "src", "guest-orchestrator-cli.mjs");
        var loader = Path.Combine(baseDirectory, "runtime-loader.mjs");
        Directory.CreateDirectory(Path.GetDirectoryName(node)!);
        Directory.CreateDirectory(Path.GetDirectoryName(bridge)!);
        await File.WriteAllBytesAsync(node, Encoding.UTF8.GetBytes("fake bundled node"));
        await File.WriteAllTextAsync(bridge, "export {};\n");
        await File.WriteAllTextAsync(loader, "export {};\n");
        var nodeHash = await PathSafety.Sha256FileAsync(node);
        var bridgeHash = await PathSafety.Sha256FileAsync(bridge);
        var manifest = new
        {
            schemaVersion = 1,
            productVersion = "0.5.1",
            backendContractVersion = 1,
            guestBridgeRelativePath = "backend/project-peer/src/guest-orchestrator-cli.mjs",
            platforms = new[] { new { id = "win-x64", os = "win32", architecture = "x64", executable = "platforms/win-x64/node.exe", sha256 = nodeHash } },
            files = new object[]
            {
                new { path = "platforms/win-x64/node.exe", size = new FileInfo(node).Length, sha256 = nodeHash },
                new { path = "backend/project-peer/src/guest-orchestrator-cli.mjs", size = new FileInfo(bridge).Length, sha256 = bridgeHash },
            },
        };
        var manifestPath = Path.Combine(runtimeRoot, "runtime-manifest.json");
        await File.WriteAllTextAsync(manifestPath, JsonSerializer.Serialize(manifest));
        var pins = new RuntimeTrustPins(
            await PathSafety.Sha256FileAsync(manifestPath),
            await PathSafety.Sha256FileAsync(loader),
            "0.5.1",
            1,
            "backend/project-peer/src/guest-orchestrator-cli.mjs");
        return new RuntimeFixture(baseDirectory, runtimeRoot, bridge, pins);
    }

    public ValueTask DisposeAsync()
    {
        if (Directory.Exists(BaseDirectory)) Directory.Delete(BaseDirectory, recursive: true);
        return ValueTask.CompletedTask;
    }
}

sealed class ActiveFixture : IAsyncDisposable
{
    private ActiveFixture(
        string root,
        string managedRoot,
        string stateRoot,
        string activePath,
        string originalHandoffJson,
        JsonDocument result)
    {
        Root = root;
        ManagedRoot = managedRoot;
        StateRoot = stateRoot;
        ActivePath = activePath;
        OriginalHandoffJson = originalHandoffJson;
        Result = result;
    }

    public string Root { get; }
    public string ManagedRoot { get; }
    public string StateRoot { get; }
    public string ActivePath { get; }
    public string OriginalHandoffJson { get; }
    public JsonDocument Result { get; }

    public static async Task<ActiveFixture> CreateAsync(
        string activeName = "3-abcdefabcdef",
        long createdAtUnixMs = 1_786_642_800_000,
        string rootPadding = "")
    {
        var root = Path.Combine(Path.GetTempPath(), "teamforge-launcher-active-tests", rootPadding, Guid.NewGuid().ToString("N"));
        var managed = Path.Combine(root, "TeamForge Projects");
        var state = Path.Combine(root, "LocalState");
        var active = Path.Combine(managed, "123e4567-e89b-42d3-a456-426614174000", "active", activeName);
        Directory.CreateDirectory(Path.Combine(active, "Assets"));
        Directory.CreateDirectory(Path.Combine(active, "Packages"));
        Directory.CreateDirectory(Path.Combine(active, "ProjectSettings"));
        await File.WriteAllTextAsync(Path.Combine(active, "Packages", "manifest.json"), "{}");
        await File.WriteAllTextAsync(Path.Combine(active, "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersion: 6000.0.65f1\n");
        var handoff = Path.Combine(state, "guest-core", "handoff", "guest.json");
        Directory.CreateDirectory(Path.GetDirectoryName(handoff)!);
        var originalHandoffJson = JsonSerializer.Serialize(new
        {
            schemaVersion = 1,
            projectUuid = "123e4567-e89b-42d3-a456-426614174000",
            baselineRevision = 3,
            manifestHash = new string('a', 64),
            descriptorHash = new string('b', 64),
            ownerKeyId = new string('c', 64),
            publisherKeyId = new string('d', 64),
            activeProjectPath = active,
            sessionJoinCode = "TF1.c2lnbmVkLXJlYWx0aW1lLXNlc3Npb24",
            createdAtUnixMs,
        });
        await File.WriteAllTextAsync(handoff, originalHandoffJson);
        var result = JsonDocument.Parse(JsonSerializer.Serialize(new
        {
            activePath = active,
            unityVersion = "6000.0.65f1",
            handoffPath = handoff,
            handoffSha256 = await PathSafety.Sha256FileAsync(handoff),
        }));
        return new ActiveFixture(root, managed, state, active, originalHandoffJson, result);
    }

    public ValueTask DisposeAsync()
    {
        Result.Dispose();
        if (Directory.Exists(Root)) Directory.Delete(Root, recursive: true);
        return ValueTask.CompletedTask;
    }
}

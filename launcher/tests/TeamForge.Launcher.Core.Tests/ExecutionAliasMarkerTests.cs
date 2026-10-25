using System.Reflection;
using System.Runtime.ExceptionServices;
using System.Text.Json;
using TeamForge.Launcher.Core;

internal static class ExecutionAliasMarkerTests
{
    private const string MarkerName = ".teamforge-path-root.json";
    private const string ValidNonce = "0123456789abcdef0123456789abcdef";

    public static Task ValidMarkerAsync()
    {
        foreach (var nonce in new[] { ValidNonce, ValidNonce.ToUpperInvariant() })
        {
            using var fixture = new Fixture(Marker(nonce));
            ValidateRoot(fixture.AliasRoot);
            fixture.AssertUnchanged();
        }
        return Task.CompletedTask;
    }

    public static Task MissingNonceAsync() => AssertRejectedAsync(JsonSerializer.Serialize(new
    {
        SchemaVersion = 1, Kind = "teamforge-execution-alias-root", CreatedAtUtc = DateTimeOffset.UtcNow,
    }));

    public static Task NullNonceAsync() => AssertRejectedAsync(Marker(null));
    public static Task MalformedJsonAsync() => AssertRejectedAsync("{public malformed marker");

    public static async Task WrongTypesAsync()
    {
        foreach (var json in new[]
        {
            "[]", "\"public scalar marker\"",
            Marker(123), Marker(ValidNonce).Replace("\"SchemaVersion\":1", "\"SchemaVersion\":\"1\"", StringComparison.Ordinal),
            Marker(ValidNonce).Replace("\"Kind\":\"teamforge-execution-alias-root\"", "\"Kind\":123", StringComparison.Ordinal),
        }) await AssertRejectedAsync(json);
    }

    public static async Task SemanticFailuresAsync()
    {
        foreach (var json in new[]
        {
            "null", Marker("short"), Marker(new string('z', 32)),
            Marker(ValidNonce).Replace("teamforge-execution-alias-root", "unrelated-owner", StringComparison.Ordinal),
            Marker(ValidNonce).Replace("\"SchemaVersion\":1", "\"SchemaVersion\":2", StringComparison.Ordinal),
            Marker(ValidNonce, DateTimeOffset.UtcNow.AddHours(1)),
        }) await AssertRejectedAsync(json);
    }

    public static Task NewAndUnrelatedRootAsync()
    {
        var scratch = Path.Combine(Path.GetTempPath(), "teamforge-marker-create-" + Guid.NewGuid().ToString("N"));
        try
        {
            var newRoot = Path.Combine(scratch, "new-aliases");
            ValidateRoot(newRoot);
            var marker = Path.Combine(newRoot, MarkerName);
            var original = File.ReadAllBytes(marker);
            ValidateRoot(newRoot);
            Require(original.SequenceEqual(File.ReadAllBytes(marker)), "Valid new ownership marker was rewritten.");

            var unrelated = Path.Combine(scratch, "unrelated");
            Directory.CreateDirectory(unrelated);
            var sentinel = Path.Combine(unrelated, "public-sentinel.txt");
            File.WriteAllText(sentinel, "public unrelated contents");
            ExpectInvalidData(() => ValidateRoot(unrelated));
            Require(!File.Exists(Path.Combine(unrelated, MarkerName)), "Unrelated directory was silently claimed.");
            Require(File.ReadAllText(sentinel) == "public unrelated contents", "Unrelated directory contents changed.");
        }
        finally { if (Directory.Exists(scratch)) Directory.Delete(scratch, recursive: true); }
        return Task.CompletedTask;
    }

    public static Task ValidOwnerRecordAsync()
    {
        using var fixture = new Fixture(Marker(ValidNonce));
        var owner = Path.Combine(fixture.AliasRoot, "public.owner.json");
        File.WriteAllText(owner, OwnerRecord(fixture.AliasRoot, fixture.Target, ValidNonce));
        var original = File.ReadAllBytes(owner);
        Require(InvokePrivate("ReadRecord", owner) is not null, "Valid ownership record was not read.");
        Require(original.SequenceEqual(File.ReadAllBytes(owner)), "Valid ownership record was rewritten.");
        File.Delete(owner);
        fixture.AssertUnchanged();
        return Task.CompletedTask;
    }

    public static Task MalformedOwnerJsonAsync() => AssertOwnerRejectedAsync((_, _) => "{public malformed owner record");

    public static async Task InvalidOwnerFieldsAsync()
    {
        foreach (var field in new[] { "alias", "target", "nonce" })
        foreach (var value in new string?[] { null, "", " " })
            await AssertOwnerRejectedAsync((alias, target) => OwnerRecord(
                field == "alias" ? value : alias,
                field == "target" ? value : target,
                field == "nonce" ? value : ValidNonce));
        await AssertOwnerRejectedAsync((alias, target) => OwnerRecord(alias, target, new string('z', 32)));
        foreach (var field in new[] { "alias", "target" })
        foreach (var value in new[] { "public-relative-path", Path.GetTempPath() + "public\0path" })
            await AssertOwnerRejectedAsync((alias, target) => OwnerRecord(
                field == "alias" ? value : alias, field == "target" ? value : target, ValidNonce));
    }

    public static async Task WrongOwnerTypesAsync()
    {
        await AssertOwnerRejectedAsync((_, _) => "[]");
        await AssertOwnerRejectedAsync((_, target) => OwnerRecord(123, target, ValidNonce));
        await AssertOwnerRejectedAsync((alias, _) => OwnerRecord(alias, false, ValidNonce));
        await AssertOwnerRejectedAsync((alias, target) => OwnerRecord(alias, target, 123));
    }

    private static async Task AssertOwnerRejectedAsync(Func<string, string, string> createJson)
    {
        using var fixture = new Fixture(Marker(ValidNonce));
        var identity = new ExecutionAliasIdentity("123e4567-e89b-42d3-a456-426614174000", 1, new string('a', 64));
        var alias = Path.Combine(fixture.AliasRoot, PathAliasAllocator.Allocate(
            identity.ProjectUuid, identity.Revision, identity.ManifestSha256, Array.Empty<string>()));
        // An existing plain directory exercises owner parsing before native
        // junction inspection. Invalid records must never cause it to be replaced.
        Directory.CreateDirectory(alias);
        var owner = alias + ".owner.json";
        File.WriteAllText(owner, createJson(alias, fixture.Target));
        var original = File.ReadAllBytes(owner);
        try
        {
            // Prove the reader rejects the malformed record itself, before a
            // plain directory could be rejected by the later junction check.
            ExpectInvalidData(() => InvokePrivate("ReadRecord", owner));
            if (OperatingSystem.IsWindows())
            {
                try
                {
                    await ExecutionAliasManager.PrepareAsync(fixture.AliasRoot, fixture.Target, identity);
                    throw new InvalidOperationException("Invalid owner record was accepted by PrepareAsync.");
                }
                catch (InvalidDataException) { }
            }
        }
        finally
        {
            Require(original.SequenceEqual(File.ReadAllBytes(owner)), "Invalid owner record was overwritten.");
            Require(Directory.Exists(alias) && !Directory.EnumerateFileSystemEntries(alias).Any(), "Existing alias directory was replaced or modified.");
            File.Delete(owner);
            Directory.Delete(alias);
            fixture.AssertUnchanged();
        }
    }

    private static string OwnerRecord(object? alias, object? target, object? nonce) => JsonSerializer.Serialize(new
    {
        SchemaVersion = 1, Nonce = nonce, AliasPath = alias, CanonicalTarget = target,
        ProjectUuid = "123e4567-e89b-42d3-a456-426614174000", Revision = 1, ManifestSha256 = new string('a', 64),
        ReparseTag = 0xA0000003u, CreatedAtUtc = DateTimeOffset.UtcNow,
        LastVerifiedAtUtc = DateTimeOffset.UtcNow, LifecycleState = "active",
    });

    private static async Task AssertRejectedAsync(string json)
    {
        using var fixture = new Fixture(json);
        try
        {
            if (OperatingSystem.IsWindows())
            {
                // Exercise the real public entry point on Windows. Invalid root
                // metadata must fail before any junction or ownership is created.
                var identity = new ExecutionAliasIdentity("123e4567-e89b-42d3-a456-426614174000", 1, new string('a', 64));
                try
                {
                    await ExecutionAliasManager.PrepareAsync(fixture.AliasRoot, fixture.Target, identity);
                    throw new InvalidOperationException("Invalid marker was accepted by PrepareAsync.");
                }
                catch (InvalidDataException) { }
            }
            else ExpectInvalidData(() => ValidateRoot(fixture.AliasRoot));
        }
        finally { fixture.AssertUnchanged(); }
    }

    private static string Marker(object? nonce, DateTimeOffset? created = null) => JsonSerializer.Serialize(new
    {
        SchemaVersion = 1, Kind = "teamforge-execution-alias-root", Nonce = nonce,
        CreatedAtUtc = created ?? DateTimeOffset.UtcNow,
    });

    private static void ValidateRoot(string root)
    {
        // This filesystem-only private seam permits the same production marker
        // validation on non-Windows hosts without exposing a new product API.
        InvokePrivate("EnsureOwnedRoot", root);
    }

    private static object? InvokePrivate(string name, string path)
    {
        var method = typeof(ExecutionAliasManager).GetMethod(name, BindingFlags.Static | BindingFlags.NonPublic)!;
        try { return method.Invoke(null, new object[] { path }); }
        catch (TargetInvocationException exception) when (exception.InnerException is { } inner)
        {
            ExceptionDispatchInfo.Capture(inner).Throw();
            throw;
        }
    }

    private static void ExpectInvalidData(Action action)
    {
        try { action(); }
        catch (InvalidDataException) { return; }
        throw new InvalidOperationException("Invalid ownership metadata was accepted.");
    }

    private static void Require(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException(message);
    }

    private sealed class Fixture : IDisposable
    {
        private readonly string _scratch = Path.Combine(Path.GetTempPath(), "teamforge-marker-negative-" + Guid.NewGuid().ToString("N"));
        private readonly string _marker;
        private readonly byte[] _originalMarker;
        public string AliasRoot { get; }
        public string Target { get; }

        public Fixture(string json)
        {
            AliasRoot = Path.Combine(_scratch, "aliases");
            Target = Path.Combine(_scratch, "target");
            Directory.CreateDirectory(AliasRoot);
            Directory.CreateDirectory(Target);
            _marker = Path.Combine(AliasRoot, MarkerName);
            File.WriteAllText(_marker, json);
            _originalMarker = File.ReadAllBytes(_marker);
            File.WriteAllText(Path.Combine(Target, "public-sentinel.txt"), "public unchanged project contents");
        }

        public void AssertUnchanged()
        {
            Require(_originalMarker.SequenceEqual(File.ReadAllBytes(_marker)), "Invalid ownership marker was overwritten.");
            Require(Directory.EnumerateFileSystemEntries(AliasRoot).Count() == 1, "Validation created an execution alias or extra owner file.");
            Require(Directory.EnumerateFileSystemEntries(Target).Count() == 1, "Validation changed the project directory.");
            Require(File.ReadAllText(Path.Combine(Target, "public-sentinel.txt")) == "public unchanged project contents", "Validation modified project contents.");
        }

        public void Dispose() => Directory.Delete(_scratch, recursive: true);
    }
}

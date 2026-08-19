using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using Microsoft.Win32.SafeHandles;

namespace TeamForge.Launcher.Core;

public sealed record ExecutionAliasIdentity(string ProjectUuid, long Revision, string ManifestSha256);

public sealed record PreparedExecutionAlias(
    string AliasRoot,
    string AliasPath,
    string CanonicalTarget,
    ExecutionAliasIdentity Identity,
    string Nonce,
    bool WasCreated);

internal sealed record ExecutionAliasRecord(
    int SchemaVersion,
    string Nonce,
    string AliasPath,
    string CanonicalTarget,
    string ProjectUuid,
    long Revision,
    string ManifestSha256,
    uint ReparseTag,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset LastVerifiedAtUtc,
    string LifecycleState);

internal sealed record ExecutionAliasRootRecord(int SchemaVersion, string Kind, string Nonce, DateTimeOffset CreatedAtUtc);

public static class ExecutionAliasManager
{
    private const string RootMarkerName = ".teamforge-path-root.json";
    private const uint MountPointReparseTag = 0xA0000003;
    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true };

    public static Task<PreparedExecutionAlias> PrepareAsync(string aliasRoot, string target, ExecutionAliasIdentity identity)
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("Execution junctions are supported only on Windows.");
        var root = PathSafety.NormalizeAbsolute(aliasRoot, "Execution alias root");
        var canonicalTarget = PathSafety.NormalizeAbsolute(target, "Execution alias target");
        if (!Guid.TryParseExact(identity.ProjectUuid, "D", out _)) throw new InvalidDataException("The execution alias project UUID is invalid.");
        PathSafety.RequireSha256(identity.ManifestSha256, "Execution alias manifest hash");
        if (!Directory.Exists(canonicalTarget)) throw new DirectoryNotFoundException("The verified Active target is missing.");
        PathSafety.RequireNoReparsePointsOnExistingPath(canonicalTarget);

        EnsureOwnedRoot(root);
        var aliasName = PathAliasAllocator.Allocate(identity.ProjectUuid, identity.Revision, identity.ManifestSha256, Array.Empty<string>());
        var alias = Path.Combine(root, aliasName);
        var recordPath = alias + ".owner.json";

        if (Directory.Exists(alias) || File.Exists(alias))
        {
            var existing = ReadRecord(recordPath);
            var existingIdentity = new ExecutionAliasIdentity(existing.ProjectUuid, existing.Revision, existing.ManifestSha256);
            Verify(alias, existing.CanonicalTarget, existingIdentity, existing);
            if (SamePath(existing.CanonicalTarget, canonicalTarget) &&
                string.Equals(existing.ProjectUuid, identity.ProjectUuid, StringComparison.OrdinalIgnoreCase) &&
                existing.Revision == identity.Revision && string.Equals(existing.ManifestSha256, identity.ManifestSha256, StringComparison.Ordinal))
            {
                return Task.FromResult(new PreparedExecutionAlias(root, alias, canonicalTarget, identity, existing.Nonce, WasCreated: false));
            }
            var occupiedAliases = Directory.EnumerateDirectories(root).Select(Path.GetFileName).Where(value => value is not null).Cast<string>();
            aliasName = PathAliasAllocator.Allocate(identity.ProjectUuid, identity.Revision, identity.ManifestSha256, occupiedAliases);
            alias = Path.Combine(root, aliasName);
            recordPath = alias + ".owner.json";
        }
        if (File.Exists(recordPath)) throw new InvalidDataException("A stale execution alias ownership record exists without its junction.");

        var nonce = Convert.ToHexStringLower(System.Security.Cryptography.RandomNumberGenerator.GetBytes(16));
        var createdAt = DateTimeOffset.UtcNow;
        try
        {
            WindowsJunction.Create(alias, canonicalTarget);
            var record = new ExecutionAliasRecord(1, nonce, alias, canonicalTarget, identity.ProjectUuid.ToLowerInvariant(), identity.Revision,
                identity.ManifestSha256, MountPointReparseTag, createdAt, createdAt, "active");
            WriteRecord(recordPath, record);
            Verify(alias, canonicalTarget, identity, record);
            return Task.FromResult(new PreparedExecutionAlias(root, alias, canonicalTarget, identity, nonce, WasCreated: true));
        }
        catch
        {
            if (Directory.Exists(alias) && WindowsJunction.TryInspect(alias, out var tag, out var resolved) && tag == MountPointReparseTag &&
                SamePath(resolved, canonicalTarget)) Directory.Delete(alias);
            if (File.Exists(recordPath)) File.Delete(recordPath);
            throw;
        }
    }

    public static Task RemoveIfOwnedAsync(PreparedExecutionAlias prepared)
    {
        var recordPath = prepared.AliasPath + ".owner.json";
        var record = ReadRecord(recordPath);
        if (!string.Equals(record.Nonce, prepared.Nonce, StringComparison.Ordinal)) throw new InvalidDataException("Execution alias ownership changed.");
        Verify(prepared.AliasPath, prepared.CanonicalTarget, prepared.Identity, record);
        Directory.Delete(prepared.AliasPath);
        File.Delete(recordPath);
        return Task.CompletedTask;
    }

    public static void VerifyImmediatelyBeforeLaunch(PreparedExecutionAlias prepared)
    {
        var record = ReadRecord(prepared.AliasPath + ".owner.json");
        if (!string.Equals(record.Nonce, prepared.Nonce, StringComparison.Ordinal)) throw new InvalidDataException("Execution alias ownership changed.");
        Verify(prepared.AliasPath, prepared.CanonicalTarget, prepared.Identity, record);
    }

    private static void EnsureOwnedRoot(string root)
    {
        var existed = Directory.Exists(root) || File.Exists(root);
        if (File.Exists(root)) throw new InvalidDataException("The execution alias root is not a directory.");
        if (!existed) Directory.CreateDirectory(root);
        PathSafety.RequireNoReparsePointsOnExistingPath(root);
        var marker = Path.Combine(root, RootMarkerName);
        if (existed && !File.Exists(marker)) throw new InvalidDataException("An unrelated directory occupies the execution alias root.");
        if (!File.Exists(marker))
        {
            var rootRecord = new ExecutionAliasRootRecord(1, "teamforge-execution-alias-root",
                Convert.ToHexStringLower(System.Security.Cryptography.RandomNumberGenerator.GetBytes(16)), DateTimeOffset.UtcNow);
            File.WriteAllText(marker, JsonSerializer.Serialize(rootRecord, JsonOptions));
        }
        PathSafety.RequireRegularFile(marker, 16 * 1024);
        var parsed = JsonSerializer.Deserialize<ExecutionAliasRootRecord>(File.ReadAllText(marker), new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
        if (parsed is null || parsed.SchemaVersion != 1 || parsed.Kind != "teamforge-execution-alias-root" ||
            parsed.Nonce.Length != 32 || !parsed.Nonce.All(Uri.IsHexDigit) || parsed.CreatedAtUtc > DateTimeOffset.UtcNow.AddMinutes(5))
            throw new InvalidDataException("The execution alias root ownership marker is invalid.");
    }

    private static void Verify(string alias, string target, ExecutionAliasIdentity identity, ExecutionAliasRecord record)
    {
        if (record.SchemaVersion != 1 || record.ReparseTag != MountPointReparseTag || record.LifecycleState != "active" ||
            !SamePath(record.AliasPath, alias) || !SamePath(record.CanonicalTarget, target) ||
            !string.Equals(record.ProjectUuid, identity.ProjectUuid, StringComparison.OrdinalIgnoreCase) ||
            record.Revision != identity.Revision || !string.Equals(record.ManifestSha256, identity.ManifestSha256, StringComparison.Ordinal))
        {
            throw new InvalidDataException("The execution alias ownership record does not match the verified Active identity.");
        }
        PathSafety.RequireNoReparsePointsOnExistingPath(target);
        if (!WindowsJunction.TryInspect(alias, out var tag, out var resolved) || tag != MountPointReparseTag || !SamePath(resolved, target))
        {
            throw new InvalidDataException("The execution alias target or reparse tag changed.");
        }
    }

    private static ExecutionAliasRecord ReadRecord(string path)
    {
        PathSafety.RequireRegularFile(path, 64 * 1024);
        return JsonSerializer.Deserialize<ExecutionAliasRecord>(File.ReadAllText(path), new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
            ?? throw new InvalidDataException("The execution alias ownership record is invalid.");
    }

    private static void WriteRecord(string path, ExecutionAliasRecord record)
    {
        var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        File.WriteAllText(temporary, JsonSerializer.Serialize(record, JsonOptions));
        File.Move(temporary, path);
    }

    private static bool SamePath(string left, string right) =>
        string.Equals(Path.TrimEndingDirectorySeparator(Path.GetFullPath(left)), Path.TrimEndingDirectorySeparator(Path.GetFullPath(right)), StringComparison.OrdinalIgnoreCase);
}

internal static class WindowsJunction
{
    private const uint MountPointReparseTag = 0xA0000003;
    private const uint GenericWrite = 0x40000000;
    private const uint FileShareAll = 0x00000007;
    private const uint OpenExisting = 3;
    private const uint FileFlagOpenReparsePoint = 0x00200000;
    private const uint FileFlagBackupSemantics = 0x02000000;
    private const uint FsctlSetReparsePoint = 0x000900A4;
    private const uint FsctlGetReparsePoint = 0x000900A8;

    public static void Create(string alias, string target)
    {
        Directory.CreateDirectory(alias);
        var substitute = @"\??\" + Path.GetFullPath(target);
        var print = Path.GetFullPath(target);
        var substituteBytes = Encoding.Unicode.GetBytes(substitute);
        var printBytes = Encoding.Unicode.GetBytes(print);
        var pathBytes = substituteBytes.Length + 2 + printBytes.Length + 2;
        var buffer = new byte[16 + pathBytes];
        BitConverter.GetBytes(MountPointReparseTag).CopyTo(buffer, 0);
        BitConverter.GetBytes((ushort)(8 + pathBytes)).CopyTo(buffer, 4);
        BitConverter.GetBytes((ushort)0).CopyTo(buffer, 8);
        BitConverter.GetBytes((ushort)substituteBytes.Length).CopyTo(buffer, 10);
        BitConverter.GetBytes((ushort)(substituteBytes.Length + 2)).CopyTo(buffer, 12);
        BitConverter.GetBytes((ushort)printBytes.Length).CopyTo(buffer, 14);
        substituteBytes.CopyTo(buffer, 16);
        printBytes.CopyTo(buffer, 16 + substituteBytes.Length + 2);

        using var handle = CreateFile(alias, GenericWrite, FileShareAll, IntPtr.Zero, OpenExisting,
            FileFlagOpenReparsePoint | FileFlagBackupSemantics, IntPtr.Zero);
        if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not open the execution alias for junction creation.");
        if (!DeviceIoControl(handle, FsctlSetReparsePoint, buffer, buffer.Length, null, 0, out _, IntPtr.Zero))
            throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not create the TeamForge execution junction.");
    }

    public static bool TryInspect(string alias, out uint tag, out string resolvedTarget)
    {
        tag = 0;
        resolvedTarget = string.Empty;
        try
        {
            var info = new DirectoryInfo(alias);
            if (!info.Exists || (info.Attributes & FileAttributes.ReparsePoint) == 0) return false;
            using var handle = CreateFile(alias, 0, FileShareAll, IntPtr.Zero, OpenExisting,
                FileFlagOpenReparsePoint | FileFlagBackupSemantics, IntPtr.Zero);
            if (handle.IsInvalid) return false;
            var raw = new byte[16 * 1024];
            if (!DeviceIoControl(handle, FsctlGetReparsePoint, null, 0, raw, raw.Length, out var returned, IntPtr.Zero) || returned < 8)
                return false;
            tag = BitConverter.ToUInt32(raw, 0);
            if (tag != MountPointReparseTag) return false;
            var final = info.ResolveLinkTarget(returnFinalTarget: true);
            if (final is null) return false;
            resolvedTarget = final.FullName;
            return true;
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or NotSupportedException)
        {
            return false;
        }
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFile(string fileName, uint desiredAccess, uint shareMode, IntPtr securityAttributes,
        uint creationDisposition, uint flagsAndAttributes, IntPtr templateFile);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DeviceIoControl(SafeFileHandle device, uint controlCode, byte[]? input, int inputSize,
        byte[]? output, int outputSize, out int bytesReturned, IntPtr overlapped);
}

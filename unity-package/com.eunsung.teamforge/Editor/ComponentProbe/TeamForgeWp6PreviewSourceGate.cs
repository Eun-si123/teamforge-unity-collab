using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using UnityEditor;
using UnityEngine.SceneManagement;

namespace EunSung.TeamForge
{
    // This is a REAL Editor Test Lab request preflight, not a cryptographic
    // Server/Publisher authority grant. It checks local *loaded* Collider
    // SerializedProperties against the exact saved .unity text bytes before
    // the existing explicitly opted-in, metadata-only WebSocket preview.
    // The existing wire request remains unchanged and the server receives
    // NO claimed Inspector values or source hashes from this helper.
    internal static class TeamForgeWp6PreviewSourceGate
    {
        private const int MaximumMetaBytes = 64 * 1024;

        internal sealed class Verified
        {
            internal Verified(string sceneGuid, string sceneFileSha256,
                string metaSha256, int colliderCount)
            {
                SceneGuid = sceneGuid;
                SceneFileSha256 = sceneFileSha256;
                MetaSha256 = metaSha256;
                ColliderCount = colliderCount;
            }

            internal string SceneGuid { get; }
            internal string SceneFileSha256 { get; }
            internal string MetaSha256 { get; }
            internal int ColliderCount { get; }
        }

        // Snapshot of the *connected* Project Coordinator Baseline and the
        // local Project descriptor. This is a metadata consistency fence,
        // NOT independent verification of the Publisher's Ed25519 signature
        // or proof the published Manifest contains this particular Scene.
        internal sealed class ProjectPin
        {
            internal ProjectPin(string connectionId, string projectId,
                string sessionId, TeamForgeProjectDescriptor descriptor,
                ProjectBaselineRecord baseline)
            {
                ConnectionId = connectionId;
                ProjectId = projectId;
                SessionId = sessionId;
                ProjectUuid = baseline.projectUuid;
                BaselineRevision = baseline.baselineRevision;
                ManifestHash = baseline.manifestHash;
                DescriptorHash = baseline.descriptorHash;
                OwnerKeyId = baseline.ownerKeyId;
                OwnerPublicKey = baseline.ownerPublicKey;
                PublisherKeyId = baseline.publisherKeyId;
                PublisherPublicKey = baseline.publisherPublicKey;
                PublisherAuthorization = baseline.publisherAuthorization;
                BaselineSignature = baseline.baselineSignature;
                PublishedByConnectionId = baseline.publishedByConnectionId;
                PublishedAtUnixMs = baseline.publishedAtUnixMs;
                DescriptorMatchesBaseline = MatchesDescriptor(descriptor, baseline);
            }

            internal string ConnectionId { get; }
            internal string ProjectId { get; }
            internal string SessionId { get; }
            internal string ProjectUuid { get; }
            internal long BaselineRevision { get; }
            internal string ManifestHash { get; }
            internal string DescriptorHash { get; }
            internal string OwnerKeyId { get; }
            internal string OwnerPublicKey { get; }
            internal string PublisherKeyId { get; }
            internal string PublisherPublicKey { get; }
            internal string PublisherAuthorization { get; }
            internal string BaselineSignature { get; }
            internal string PublishedByConnectionId { get; }
            internal long PublishedAtUnixMs { get; }
            internal bool DescriptorMatchesBaseline { get; }

            internal bool Same(ProjectPin other)
            {
                return other != null && DescriptorMatchesBaseline &&
                    other.DescriptorMatchesBaseline &&
                    ConnectionId == other.ConnectionId &&
                    ProjectId == other.ProjectId &&
                    SessionId == other.SessionId &&
                    ProjectUuid == other.ProjectUuid &&
                    BaselineRevision == other.BaselineRevision &&
                    ManifestHash == other.ManifestHash &&
                    DescriptorHash == other.DescriptorHash &&
                    OwnerKeyId == other.OwnerKeyId &&
                    OwnerPublicKey == other.OwnerPublicKey &&
                    PublisherKeyId == other.PublisherKeyId &&
                    PublisherPublicKey == other.PublisherPublicKey &&
                    PublisherAuthorization == other.PublisherAuthorization &&
                    BaselineSignature == other.BaselineSignature &&
                    PublishedByConnectionId == other.PublishedByConnectionId &&
                    PublishedAtUnixMs == other.PublishedAtUnixMs;
            }
        }

        private static bool MatchesDescriptor(
            TeamForgeProjectDescriptor descriptor, ProjectBaselineRecord baseline)
        {
            return descriptor != null && baseline != null &&
                descriptor.baselineRevision > 0 &&
                descriptor.projectUuid == baseline.projectUuid &&
                descriptor.baselineRevision == baseline.baselineRevision &&
                descriptor.manifestHash == baseline.manifestHash &&
                descriptor.descriptorHash == baseline.descriptorHash &&
                descriptor.unityVersion == baseline.unityVersion &&
                descriptor.teamForgePackageVersion == baseline.teamForgePackageVersion &&
                descriptor.realtimeProtocolVersion == baseline.realtimeProtocolVersion &&
                descriptor.transferProtocolVersion == baseline.transferProtocolVersion &&
                descriptor.manifestSchemaVersion == baseline.manifestSchemaVersion;
        }

        // The Project registry comes from the current authenticated realtime
        // connection; the descriptor is the local Project's persisted record.
        // Even an exact equality is NOT verification that the server's signed
        // publication contains this Scene's specific bytes.
        internal static bool TryCaptureCurrentProjectPin(
            out ProjectPin projectPin, out string error)
        {
            projectPin = null;
            if (TeamForgeConnectionService.State != TeamForgeConnectionState.Connected ||
                !TeamForgeConnectionService.ProjectTransferAvailable ||
                !TeamForgeProjectService.RegistrySnapshotReceived ||
                (TeamForgeProjectService.State != TeamForgeProjectBootstrapState.Ready &&
                 TeamForgeProjectService.State !=
                    TeamForgeProjectBootstrapState.BaselineAvailableNoSeed))
            {
                error = "WP6 requires the current connected published Project registry baseline.";
                return false;
            }

            var descriptor = TeamForgeProjectService.Descriptor;
            var baseline = TeamForgeProjectService.Registry.Baseline;
            if (!TeamForgeProjectValidation.TryValidateDescriptor(
                    descriptor, out _) ||
                !TeamForgeProjectValidation.TryValidateBaseline(
                    baseline, out _) ||
                !MatchesDescriptor(descriptor, baseline))
            {
                error = "Local Project descriptor does not match the current published baseline.";
                return false;
            }
            var connectionId = TeamForgeConnectionService.ConnectionId;
            var projectId = TeamForgeConnectionService.Settings.ProjectId;
            var sessionId = TeamForgeConnectionService.Settings.SessionId;
            if (string.IsNullOrWhiteSpace(connectionId) ||
                string.IsNullOrWhiteSpace(projectId) ||
                string.IsNullOrWhiteSpace(sessionId))
            {
                error = "A current registered Project, Session and Editor connection are required.";
                return false;
            }

            projectPin = new ProjectPin(connectionId, projectId.Trim(),
                sessionId.Trim(), descriptor, baseline);
            error = string.Empty;
            return true;
        }

        internal static bool TryCaptureForReadOnlyPreview(string requestedSceneGuid,
            out Verified verified, out string error)
        {
            verified = null;
            if (!CanonicalGuid(requestedSceneGuid))
            {
                error = "The WP6 preview requires the exact saved Scene GUID.";
                return false;
            }

            var active = SceneManager.GetActiveScene();
            if (!active.IsValid() || !active.isLoaded || active.isDirty ||
                string.IsNullOrEmpty(active.path))
            {
                error = "Select the exact clean saved active Scene before the WP6 preview.";
                return false;
            }

            // Validate the path and 16 MiB Scene limit *before* the general
            // BaselineFingerprint SHA-256 reader. Otherwise a malicious,
            // very large or redirected Scene would be hashed unnecessarily.
            if (!TryHashSafeMeta(active.path, requestedSceneGuid, out var metaHash))
            {
                error = "WP6 preview needs a small clean saved Scene and intact metadata.";
                return false;
            }

            if (!TeamForgeBaselineFingerprint.TryCaptureActiveScene(
                out var expected, out error) ||
                !string.Equals(expected.sceneGuid, requestedSceneGuid,
                    StringComparison.Ordinal))
            {
                error = "Select the exact clean saved active Scene before the WP6 preview.";
                return false;
            }

            if (!TeamForgeWp6SerializedSceneWitness.TryCapture(
                expected, metaHash, out var witness, out error))
            {
                // No partial accepted result. Do not imply that the Editor
                // observed a complete synchronized network baseline.
                verified = null;
                return false;
            }

            verified = new Verified(
                witness.Source.SceneGuid,
                witness.Source.SceneFileSha256,
                witness.Source.MetaSha256,
                witness.ColliderCount);
            error = string.Empty;
            return true;
        }

        // The server metadata fingerprint is NOT a Scene-source hash.
        // It may only be used as an optimization when both local saved
        // files still match the original request's verified bytes.
        internal static bool CanReuseCachedPreview(
            Verified current, string priorSceneGuid,
            string priorSceneSha256, string priorMetaSha256)
        {
            return current != null &&
                string.Equals(current.SceneGuid, priorSceneGuid,
                    StringComparison.Ordinal) &&
                string.Equals(current.SceneFileSha256, priorSceneSha256,
                    StringComparison.Ordinal) &&
                string.Equals(current.MetaSha256, priorMetaSha256,
                    StringComparison.Ordinal);
        }

        private static bool CanonicalGuid(string value)
        {
            if (value == null || value.Length != 32 ||
                value == "00000000000000000000000000000000")
                return false;
            foreach (var c in value)
                if (!((c >= 'a' && c <= 'f') || (c >= '0' && c <= '9')))
                    return false;
            return true;
        }

        private static bool TryHashSafeMeta(string relativeScenePath,
            string expectedSceneGuid, out string hash)
        {
            hash = string.Empty;
            try
            {
                if (string.IsNullOrEmpty(relativeScenePath) ||
                    !relativeScenePath.StartsWith("Assets/", StringComparison.Ordinal) ||
                    !relativeScenePath.EndsWith(".unity", StringComparison.Ordinal) ||
                    relativeScenePath.Length > 1024 ||
                    relativeScenePath.IndexOfAny(new[] { '\\', ':', '\0' }) >= 0)
                    return false;

                // Forbid redirected parents BEFORE reading. The stricter
                // serialized witness repeats these checks for the .unity.
                var current = Directory.GetCurrentDirectory();
                if ((new DirectoryInfo(current).Attributes & FileAttributes.ReparsePoint) != 0)
                    return false;
                var segments = relativeScenePath.Split('/');
                for (var i = 0; i < segments.Length - 1; i++)
                {
                    var segment = segments[i];
                    if (segment.Length == 0 || segment == "." || segment == "..")
                        return false;
                    current = Path.Combine(current, segment);
                    var directory = new DirectoryInfo(current);
                    if (!directory.Exists ||
                        (directory.Attributes & FileAttributes.ReparsePoint) != 0)
                        return false;
                }
                var sceneFile = new FileInfo(Path.GetFullPath(
                    Path.Combine(Directory.GetCurrentDirectory(), relativeScenePath)));
                if (!sceneFile.Exists || sceneFile.Length < 1 ||
                    sceneFile.Length > TeamForgeWp6YamlColliderWitness.MaximumSerializedBytes ||
                    (sceneFile.Attributes &
                        (FileAttributes.ReparsePoint | FileAttributes.Directory)) != 0)
                    return false;
                var meta = Path.GetFullPath(
                    Path.Combine(Directory.GetCurrentDirectory(),
                        relativeScenePath + ".meta"));
                var file = new FileInfo(meta);
                if (!file.Exists || file.Length < 1 ||
                    file.Length > MaximumMetaBytes ||
                    (file.Attributes & (FileAttributes.ReparsePoint | FileAttributes.Directory)) != 0)
                    return false;

                using (var stream = new FileStream(meta, FileMode.Open,
                    FileAccess.Read, FileShare.Read))
                using (var sha = SHA256.Create())
                {
                    if (stream.Length < 1 || stream.Length > MaximumMetaBytes)
                        return false;
                    // A bounded read prevents a concurrent file append from
                    // being silently treated as the previously sized file.
                    var buffer = new byte[MaximumMetaBytes + 1];
                    var length = 0;
                    int count;
                    while (length < buffer.Length &&
                        (count = stream.Read(buffer, length, buffer.Length - length)) > 0)
                        length += count;
                    if (length < 1 || length > MaximumMetaBytes || stream.Length != length)
                        return false;
                    // AssetDatabase's GUID cache can lag an out-of-band
                    // rewrite. Require the *actual .meta bytes* to contain
                    // exactly one canonical top-level GUID matching the
                    // active saved Scene rather than trusting a fresh hash
                    // of a forged .meta file.
                    var metadata = new UTF8Encoding(false, true)
                        .GetString(buffer, 0, length);
                    var guidCount = 0;
                    foreach (var line in metadata.Split('\n'))
                    {
                        var normalized = line.TrimEnd('\r');
                        if (!normalized.StartsWith("guid:", StringComparison.Ordinal))
                            continue;
                        if (++guidCount != 1 ||
                            !string.Equals(normalized,
                                "guid: " + expectedSceneGuid, StringComparison.Ordinal))
                            return false;
                    }
                    if (guidCount != 1) return false;

                    hash = BitConverter.ToString(sha.ComputeHash(buffer, 0, length))
                        .Replace("-", string.Empty).ToLowerInvariant();
                    return true;
                }
            }
            catch (Exception)
            {
                return false;
            }
        }
    }
}

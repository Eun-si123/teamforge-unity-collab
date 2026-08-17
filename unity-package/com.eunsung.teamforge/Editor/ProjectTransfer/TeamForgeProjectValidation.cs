using System;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace EunSung.TeamForge
{
    public static class TeamForgeProjectValidation
    {
        private const long MaximumUnixMilliseconds = 253402300799999;
        private const long MaximumChunkCount = 10000000;
        private static readonly Regex Unity60003Version = new Regex(
            @"^6000\.3\.\d+[abfp]\d+$",
            RegexOptions.CultureInvariant);

        public static bool TryValidateDescriptor(TeamForgeProjectDescriptor descriptor, out string error)
        {
            if (descriptor == null)
            {
                error = "Project descriptor is missing.";
                return false;
            }

            if (descriptor.schemaVersion != TeamForgeProjectContract.DescriptorSchemaVersion)
            {
                error = $"Unsupported Project descriptor schema {descriptor.schemaVersion}.";
                return false;
            }

            if (!TryValidateCanonicalProjectUuid(descriptor.projectUuid, out error) ||
                !TryValidateRevision(descriptor.baselineRevision, true, out error) ||
                !TryValidateVersion(descriptor.unityVersion, "Unity version", out error) ||
                !TryValidateVersion(descriptor.teamForgePackageVersion, "TeamForge package version", out error) ||
                !Unity60003Version.IsMatch(descriptor.unityVersion) ||
                descriptor.teamForgePackageVersion != TeamForgeProjectContract.ProductVersion ||
                descriptor.realtimeProtocolVersion != TeamForgeProtocol.Version ||
                descriptor.transferProtocolVersion != TeamForgeProjectContract.TransferProtocolVersion ||
                descriptor.manifestSchemaVersion != TeamForgeProjectContract.ManifestSchemaVersion)
            {
                if (string.IsNullOrWhiteSpace(error))
                {
                    error = "Project descriptor protocol versions are incompatible.";
                }
                return false;
            }

            if (descriptor.baselineRevision == 0)
            {
                if (!string.IsNullOrEmpty(descriptor.manifestHash) || !string.IsNullOrEmpty(descriptor.descriptorHash))
                {
                    error = "An unpublished Project descriptor cannot contain baseline hashes.";
                    return false;
                }
            }
            else if (!TryValidateSha256(descriptor.manifestHash, "Manifest hash", out error) ||
                     !TryValidateSha256(descriptor.descriptorHash, "Descriptor hash", out error))
            {
                return false;
            }

            error = string.Empty;
            return true;
        }

        public static bool TryValidateBaseline(ProjectBaselineRecord baseline, out string error)
        {
            return TryValidateBaselineCore(baseline, true, true, out error);
        }

        private static bool TryValidateBaselineCore(
            ProjectBaselineRecord baseline,
            bool requirePublicationMetadata,
            bool requireCompatibleDescriptor,
            out string error)
        {
            if (baseline == null)
            {
                error = "Project baseline is missing.";
                return false;
            }

            if (!TryValidateCanonicalProjectUuid(baseline.projectUuid, out error) ||
                !TryValidateRevision(baseline.baselineRevision, false, out error) ||
                !TryValidateSha256(baseline.manifestHash, "Manifest hash", out error) ||
                !TryValidateSha256(baseline.descriptorHash, "Descriptor hash", out error) ||
                !TryValidateVersion(baseline.unityVersion, "Unity version", out error) ||
                !TryValidateVersion(baseline.teamForgePackageVersion, "TeamForge package version", out error))
            {
                return false;
            }

            var validProtocolRange = baseline.realtimeProtocolVersion == TeamForgeProtocol.Version &&
                                     baseline.transferProtocolVersion >= 1 &&
                                     baseline.transferProtocolVersion <= 1000 &&
                                     baseline.manifestSchemaVersion >= 1 &&
                                     baseline.manifestSchemaVersion <= 1000;
            var compatibleDescriptor =
                baseline.transferProtocolVersion == TeamForgeProjectContract.TransferProtocolVersion &&
                baseline.manifestSchemaVersion == TeamForgeProjectContract.ManifestSchemaVersion &&
                baseline.teamForgePackageVersion == TeamForgeProjectContract.ProductVersion &&
                Unity60003Version.IsMatch(baseline.unityVersion);
            if (!validProtocolRange || (requireCompatibleDescriptor && !compatibleDescriptor))
            {
                error = "Project baseline protocol versions are incompatible.";
                return false;
            }

            if (!TryValidateSha256(baseline.ownerKeyId, "Owner key ID", out error) ||
                !TryValidateSpki(baseline.ownerPublicKey, "Owner public key", out error) ||
                !TryValidateSha256(baseline.publisherKeyId, "Publisher key ID", out error) ||
                !TryValidateSpki(baseline.publisherPublicKey, "Publisher public key", out error) ||
                !TryValidateSignature(baseline.baselineSignature, "Baseline signature", false, out error))
            {
                return false;
            }

            if (!TryComputeSpkiKeyId(baseline.ownerPublicKey, out var ownerKeyId, out error) ||
                !string.Equals(ownerKeyId, baseline.ownerKeyId, StringComparison.Ordinal) ||
                !TryComputeSpkiKeyId(baseline.publisherPublicKey, out var publisherKeyId, out error) ||
                !string.Equals(publisherKeyId, baseline.publisherKeyId, StringComparison.Ordinal))
            {
                if (string.IsNullOrWhiteSpace(error))
                {
                    error = "Project baseline key IDs do not match their public keys.";
                }
                return false;
            }

            var authorizationRequired = !string.Equals(
                baseline.ownerKeyId,
                baseline.publisherKeyId,
                StringComparison.Ordinal);
            if (!TryValidateSignature(
                    baseline.publisherAuthorization,
                    "Publisher authorization",
                    !authorizationRequired,
                    out error))
            {
                return false;
            }

            if (requirePublicationMetadata &&
                (!TryValidateText(baseline.publishedByUserId, "Published-by user ID", 128, false, out error) ||
                 !TryValidateText(
                     baseline.publishedByConnectionId,
                     "Published-by connection ID",
                     128,
                     false,
                     out error) ||
                 baseline.publishedAtUnixMs <= 0 ||
                 baseline.publishedAtUnixMs > MaximumUnixMilliseconds))
            {
                if (string.IsNullOrWhiteSpace(error))
                {
                    error = "Project baseline publication timestamp is invalid.";
                }
                return false;
            }

            error = string.Empty;
            return true;
        }

        public static bool TryValidatePeer(ProjectPeerRecord peer, out string error)
        {
            if (peer == null)
            {
                error = "Project peer is missing.";
                return false;
            }

            if (!TryValidateText(peer.userId, "User ID", 128, false, out error) ||
                !TryValidateText(peer.connectionId, "Connection ID", 128, false, out error) ||
                !TryValidateText(peer.userName, "User name", 64, false, out error) ||
                !TryValidateEndpoint(peer.endpoint, out error) ||
                !TryValidateText(peer.transferToken, "Peer transfer token", 512, false, out error))
            {
                return false;
            }

            if (peer.transferToken.Trim().Length < 16)
            {
                error = "Peer transfer token must contain at least 16 printable characters.";
                return false;
            }

            var baseline = new ProjectBaselineRecord
            {
                projectUuid = peer.projectUuid,
                baselineRevision = peer.baselineRevision,
                manifestHash = peer.manifestHash,
                descriptorHash = peer.descriptorHash,
                unityVersion = peer.unityVersion,
                teamForgePackageVersion = peer.teamForgePackageVersion,
                realtimeProtocolVersion = peer.realtimeProtocolVersion,
                transferProtocolVersion = peer.transferProtocolVersion,
                manifestSchemaVersion = peer.manifestSchemaVersion,
                ownerKeyId = peer.ownerKeyId,
                ownerPublicKey = peer.ownerPublicKey,
                publisherKeyId = peer.publisherKeyId,
                publisherPublicKey = peer.publisherPublicKey,
                publisherAuthorization = peer.publisherAuthorization,
                baselineSignature = peer.baselineSignature,
            };
            if (!TryValidateBaselineCore(baseline, false, peer.seedRank != 99, out error))
            {
                return false;
            }

            if (!TryValidateSignature(peer.ownerProofSignature, "Owner proof signature", true, out error))
            {
                return false;
            }

            if (peer.availableChunkCount < 0 ||
                peer.totalChunkCount < 0 ||
                peer.availableChunkCount > peer.totalChunkCount ||
                peer.totalChunkCount > MaximumChunkCount)
            {
                error = "Project peer chunk counts are invalid.";
                return false;
            }

            if (peer.observedLatencyMilliseconds < 0 || peer.observedLatencyMilliseconds > 86400000)
            {
                error = "Project peer observed latency is invalid.";
                return false;
            }

            if (!TryValidateText(peer.leaveReason, "Project peer leave reason", 128, true, out error))
            {
                return false;
            }

            if (peer.completeBaseline && peer.availableChunkCount != peer.totalChunkCount)
            {
                error = "A complete Project peer must advertise all baseline chunks.";
                return false;
            }

            if (!IsSeedRank(peer.seedRank) ||
                ((peer.seedRank == 0 || peer.seedRank == 1) && !peer.completeBaseline) ||
                (peer.seedRank == 2 && (peer.completeBaseline || peer.availableChunkCount == 0)))
            {
                error = "Project peer seed rank is inconsistent with its inventory.";
                return false;
            }

            if (peer.ownerProofVerified && string.IsNullOrWhiteSpace(peer.ownerProofSignature))
            {
                error = "A verified Owner proof requires its signature metadata.";
                return false;
            }

            if ((peer.seedRank == 0 && (!peer.ownerProofVerified || !peer.descriptorVerified)) ||
                ((peer.seedRank == 1 || peer.seedRank == 2) && !peer.descriptorVerified))
            {
                error = "Project peer seed rank is inconsistent with its verified metadata.";
                return false;
            }

            if (peer.announcedAtUnixMs <= 0 ||
                peer.announcedAtUnixMs > MaximumUnixMilliseconds ||
                peer.lastUpdatedUnixMs < peer.announcedAtUnixMs ||
                peer.lastUpdatedUnixMs > MaximumUnixMilliseconds)
            {
                error = "Project peer announcement timestamps are invalid.";
                return false;
            }

            error = string.Empty;
            return true;
        }

        public static bool TryValidateLaunchSettings(
            TeamForgeProjectPeerLaunchSettings settings,
            out string error)
        {
            if (settings == null)
            {
                error = "Project peer launch settings are missing.";
                return false;
            }

            if (settings.schemaVersion != 1 ||
                settings.realtimeProtocolVersion != TeamForgeProtocol.Version ||
                settings.transferProtocolVersion != TeamForgeProjectContract.TransferProtocolVersion ||
                settings.manifestSchemaVersion != TeamForgeProjectContract.ManifestSchemaVersion)
            {
                error = "Project peer launch settings contain unsupported protocol versions.";
                return false;
            }

            if (!TeamForgeUriBuilder.TryBuildWebSocketUri(
                    settings.serverAddress,
                    settings.realtimePath,
                    out _,
                    out error) ||
                !TeamForgeHostEndpointPolicy.TryValidateListenHost(settings.coordinatorListenHost, out error) ||
                !TryValidateText(settings.projectId, "Project ID", 128, false, out error) ||
                !TryValidateText(settings.sessionId, "Session ID", 128, false, out error) ||
                !TryValidateCanonicalProjectUuid(settings.projectUuid, out error) ||
                !TryValidateRelativeProjectPath(settings.managedProjectsRelativePath, false, out error) ||
                !TryValidateEnvironmentVariableName(
                    settings.authenticationTokenEnvironmentVariable,
                    "Authentication token environment variable",
                    out error) ||
                !TryValidateEnvironmentVariableName(
                    settings.ownerKeyEnvironmentVariable,
                    "Owner key environment variable",
                    out error))
            {
                return false;
            }

            if (settings.allowCurrentProjectAsSeedSource)
            {
                if (!TryValidateRelativeProjectPath(settings.sourceProjectRelativePath, true, out error) ||
                    !TryValidateRelativeProjectPath(settings.projectDescriptorRelativePath, false, out error))
                {
                    return false;
                }
            }
            else if (!string.IsNullOrEmpty(settings.sourceProjectRelativePath) ||
                     !string.IsNullOrEmpty(settings.projectDescriptorRelativePath))
            {
                error = "Download-only launch settings cannot name the current Project as a source.";
                return false;
            }

            error = string.Empty;
            return true;
        }

        public static bool TryValidateInvitation(TeamForgeProjectInvitation invitation, out string error)
        {
            if (invitation == null)
            {
                error = "Project invitation is missing.";
                return false;
            }

            if (!string.Equals(
                    invitation.format,
                    "teamforge-project-invite-v1",
                    StringComparison.Ordinal))
            {
                error = "Project invitation format is unsupported.";
                return false;
            }

            if (!TeamForgeUriBuilder.TryBuildWebSocketUri(
                    invitation.serverAddress,
                    invitation.realtimePath,
                    out _,
                    out error) ||
                !TryValidateText(invitation.serverAddress, "Server address", 2048, false, out error) ||
                !TryValidateText(invitation.realtimePath, "Realtime path", 512, false, out error) ||
                !TryValidateText(invitation.projectId, "Project ID", 128, false, out error) ||
                !TryValidateText(invitation.sessionId, "Session ID", 128, false, out error) ||
                !TryValidateCanonicalProjectUuid(invitation.projectUuid, out error) ||
                !TryValidateSha256(invitation.ownerKeyId, "Owner key ID", out error) ||
                !TryValidateSpki(invitation.ownerPublicKey, "Owner public key", out error) ||
                !TryValidateSignature(invitation.ownerSignature, "Owner invitation signature", false, out error) ||
                !TryComputeSpkiKeyId(invitation.ownerPublicKey, out var computedKeyId, out error))
            {
                return false;
            }

            if (!string.Equals(computedKeyId, invitation.ownerKeyId, StringComparison.Ordinal))
            {
                error = "Project invitation Owner key ID does not match its public key.";
                return false;
            }

            error = string.Empty;
            return true;
        }

        public static bool TryComputeSpkiKeyId(string publicKey, out string keyId, out string error)
        {
            keyId = string.Empty;
            if (!TryValidateSpki(publicKey, "Public key", out error))
            {
                return false;
            }

            var bytes = Convert.FromBase64String(publicKey);
            using (var sha256 = SHA256.Create())
            {
                var hash = sha256.ComputeHash(bytes);
                var builder = new StringBuilder(hash.Length * 2);
                foreach (var value in hash)
                {
                    builder.Append(value.ToString("x2"));
                }
                keyId = builder.ToString();
            }

            error = string.Empty;
            return true;
        }

        public static bool TryValidateCanonicalProjectUuid(string value, out string error)
        {
            var source = value ?? string.Empty;
            var candidate = source.Trim();
            if (!Guid.TryParseExact(candidate, "D", out var parsed) ||
                parsed == Guid.Empty ||
                !string.Equals(source, candidate, StringComparison.Ordinal) ||
                !string.Equals(candidate, parsed.ToString("D"), StringComparison.Ordinal))
            {
                error = "Project UUID must be a non-empty canonical lowercase UUID.";
                return false;
            }

            error = string.Empty;
            return true;
        }

        public static bool TryValidateProjectId(string value, out string error)
        {
            return TryValidateText(value, "Project ID", 128, false, out error);
        }

        public static bool TryValidateSha256(string value, string label, out string error)
        {
            if (string.IsNullOrEmpty(value) || value.Length != 64)
            {
                error = $"{label} must be a 64-character lowercase SHA-256 value.";
                return false;
            }

            foreach (var character in value)
            {
                if (!((character >= '0' && character <= '9') || (character >= 'a' && character <= 'f')))
                {
                    error = $"{label} must be a 64-character lowercase SHA-256 value.";
                    return false;
                }
            }

            error = string.Empty;
            return true;
        }

        public static bool TryValidateVersion(string value, string label, out string error)
        {
            var source = value ?? string.Empty;
            var candidate = source.Trim();
            if (candidate.Length == 0 || candidate.Length > 64)
            {
                error = $"{label} must contain 1-64 characters.";
                return false;
            }
            if (!string.Equals(source, candidate, StringComparison.Ordinal))
            {
                error = $"{label} cannot contain leading or trailing whitespace.";
                return false;
            }

            foreach (var character in candidate)
            {
                var allowed = (character >= 'a' && character <= 'z') ||
                              (character >= 'A' && character <= 'Z') ||
                              (character >= '0' && character <= '9') ||
                              character == '.' || character == '-' || character == '+';
                if (!allowed)
                {
                    error = $"{label} contains an unsupported character.";
                    return false;
                }
            }

            error = string.Empty;
            return true;
        }

        public static bool TryValidateRelativeProjectPath(
            string value,
            bool allowProjectRoot,
            out string error)
        {
            var candidate = value ?? string.Empty;
            if (allowProjectRoot && candidate == ".")
            {
                error = string.Empty;
                return true;
            }

            if (candidate.Length == 0 ||
                candidate.Length > 1024 ||
                candidate[0] == '/' ||
                candidate.IndexOf('\\') >= 0 ||
                candidate.IndexOf(':') >= 0 ||
                !candidate.IsNormalized(NormalizationForm.FormC))
            {
                error = "Project paths must be normalized portable relative paths.";
                return false;
            }

            var segments = candidate.Split('/');
            foreach (var segment in segments)
            {
                if (segment.Length == 0 || segment == "." || segment == "..")
                {
                    error = "Project paths cannot contain empty, current-directory, or parent-directory segments.";
                    return false;
                }

                foreach (var character in segment)
                {
                    if (char.IsControl(character))
                    {
                        error = "Project paths cannot contain control characters.";
                        return false;
                    }
                }
            }

            error = string.Empty;
            return true;
        }

        private static bool TryValidateRevision(long revision, bool allowUnpublished, out string error)
        {
            var minimum = allowUnpublished ? 0 : 1;
            if (revision < minimum || revision > long.MaxValue - 1)
            {
                error = allowUnpublished
                    ? "Baseline revision must be zero or a positive integer."
                    : "Baseline revision must be a positive integer.";
                return false;
            }

            error = string.Empty;
            return true;
        }

        private static bool TryValidateEndpoint(string value, out string error)
        {
            if ((value?.Length ?? 0) > 512)
            {
                error = "Peer endpoint exceeds its size limit.";
                return false;
            }
            if (!TryValidateHttpAddress(value, "Peer endpoint", out error))
            {
                return false;
            }

            var uri = new Uri(value, UriKind.Absolute);
            if (!string.IsNullOrEmpty(uri.UserInfo) ||
                !string.IsNullOrEmpty(uri.Query) ||
                !string.IsNullOrEmpty(uri.Fragment))
            {
                error = "Peer endpoint cannot contain user information or a fragment.";
                return false;
            }

            error = string.Empty;
            return true;
        }

        private static bool TryValidateHttpAddress(string value, string label, out string error)
        {
            var candidate = value?.Trim() ?? string.Empty;
            if (!string.Equals(value, candidate, StringComparison.Ordinal) ||
                candidate.Length == 0 || candidate.Length > 2048 ||
                !Uri.TryCreate(candidate, UriKind.Absolute, out var uri) ||
                (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps) ||
                string.IsNullOrWhiteSpace(uri.Host))
            {
                error = $"{label} must be an absolute HTTP or HTTPS URL.";
                return false;
            }

            error = string.Empty;
            return true;
        }

        private static bool TryValidateSpki(string value, string label, out string error)
        {
            if (!TryValidateBase64(value, label, false, 44, 44, out error))
            {
                return false;
            }

            // DER SubjectPublicKeyInfo prefix for Ed25519 followed by a 32-byte key.
            var expectedPrefix = new byte[]
            {
                0x30, 0x2a, 0x30, 0x05, 0x06, 0x03,
                0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
            };
            var decoded = Convert.FromBase64String(value);
            for (var index = 0; index < expectedPrefix.Length; index += 1)
            {
                if (decoded[index] != expectedPrefix[index])
                {
                    error = $"{label} is not an Ed25519 SPKI value.";
                    return false;
                }
            }

            error = string.Empty;
            return true;
        }

        private static bool TryValidateSignature(
            string value,
            string label,
            bool allowEmpty,
            out string error)
        {
            return TryValidateBase64(value, label, allowEmpty, 64, 64, out error);
        }

        private static bool TryValidateBase64(
            string value,
            string label,
            bool allowEmpty,
            int minimumBytes,
            int maximumBytes,
            out string error)
        {
            if (string.IsNullOrEmpty(value))
            {
                if (allowEmpty)
                {
                    error = string.Empty;
                    return true;
                }

                error = $"{label} is required.";
                return false;
            }

            if (value.Length > 4096)
            {
                error = $"{label} is too large.";
                return false;
            }

            try
            {
                var bytes = Convert.FromBase64String(value);
                if (bytes.Length < minimumBytes || bytes.Length > maximumBytes)
                {
                    error = $"{label} has an invalid decoded length.";
                    return false;
                }
                if (!string.Equals(Convert.ToBase64String(bytes), value, StringComparison.Ordinal))
                {
                    error = $"{label} is not canonical base64.";
                    return false;
                }
            }
            catch (FormatException)
            {
                error = $"{label} is not valid base64.";
                return false;
            }

            error = string.Empty;
            return true;
        }

        private static bool TryValidateEnvironmentVariableName(
            string value,
            string label,
            out string error)
        {
            var candidate = value ?? string.Empty;
            if (candidate.Length == 0 || candidate.Length > 128 ||
                !((candidate[0] >= 'A' && candidate[0] <= 'Z') || candidate[0] == '_'))
            {
                error = $"{label} is invalid.";
                return false;
            }

            for (var index = 1; index < candidate.Length; index += 1)
            {
                var character = candidate[index];
                if (!((character >= 'A' && character <= 'Z') ||
                      (character >= '0' && character <= '9') ||
                      character == '_'))
                {
                    error = $"{label} is invalid.";
                    return false;
                }
            }

            error = string.Empty;
            return true;
        }

        private static bool TryValidateText(
            string value,
            string label,
            int maximumLength,
            bool allowEmpty,
            out string error)
        {
            if (value == null && allowEmpty)
            {
                error = string.Empty;
                return true;
            }

            var source = value ?? string.Empty;
            var candidate = source.Trim();
            if ((!allowEmpty && candidate.Length == 0) || candidate.Length > maximumLength)
            {
                error = allowEmpty
                    ? $"{label} must contain at most {maximumLength} characters."
                    : $"{label} must contain 1-{maximumLength} characters.";
                return false;
            }

            if (!string.Equals(source, candidate, StringComparison.Ordinal))
            {
                error = $"{label} cannot contain leading or trailing whitespace.";
                return false;
            }

            foreach (var character in candidate)
            {
                if (char.IsControl(character))
                {
                    error = $"{label} cannot contain control characters.";
                    return false;
                }
            }

            error = string.Empty;
            return true;
        }

        private static bool IsSeedRank(int rank)
        {
            return rank == 0 || rank == 1 || rank == 2 || rank == 3 || rank == 99;
        }
    }
}

using System;
using System.Collections.Generic;

namespace EunSung.TeamForge
{
    public sealed class TeamForgeProjectRegistry
    {
        private readonly Dictionary<string, ProjectPeerRecord> _peers =
            new Dictionary<string, ProjectPeerRecord>(StringComparer.Ordinal);

        private ProjectBaselineRecord _baseline;

        public event Action Changed;

        public int Count => _peers.Count;
        public long Version { get; private set; }
        public ProjectBaselineRecord Baseline => CopyBaseline(_baseline);

        public bool ReplaceAll(
            ProjectBaselineRecord baseline,
            IEnumerable<ProjectPeerRecord> peers,
            out string error)
        {
            if (baseline != null && !TeamForgeProjectValidation.TryValidateBaseline(baseline, out error))
            {
                return false;
            }

            var replacement = new Dictionary<string, ProjectPeerRecord>(StringComparer.Ordinal);
            var userIds = new HashSet<string>(StringComparer.Ordinal);
            var expectedProjectUuid = baseline?.projectUuid ?? string.Empty;
            if (peers != null)
            {
                foreach (var peer in peers)
                {
                    if (!TeamForgeProjectValidation.TryValidatePeer(peer, out error) ||
                        !TryValidatePeerAgainstBaseline(peer, baseline, out error))
                    {
                        return false;
                    }

                    if (expectedProjectUuid.Length == 0)
                    {
                        expectedProjectUuid = peer.projectUuid;
                    }
                    else if (!string.Equals(expectedProjectUuid, peer.projectUuid, StringComparison.Ordinal))
                    {
                        error = "Project registry contains more than one Project UUID.";
                        return false;
                    }

                    if (replacement.ContainsKey(peer.connectionId))
                    {
                        error = $"Project registry contains duplicate connection ID '{peer.connectionId}'.";
                        return false;
                    }
                    if (!userIds.Add(peer.userId))
                    {
                        error = $"Project registry contains duplicate user ID '{peer.userId}'.";
                        return false;
                    }
                    replacement.Add(peer.connectionId, CopyPeer(peer));
                }
            }

            _baseline = CopyBaseline(baseline);
            _peers.Clear();
            foreach (var pair in replacement)
            {
                _peers.Add(pair.Key, pair.Value);
            }

            error = string.Empty;
            Version += 1;
            Changed?.Invoke();
            return true;
        }

        public bool Upsert(ProjectPeerRecord peer, out string error)
        {
            if (!TeamForgeProjectValidation.TryValidatePeer(peer, out error) ||
                !TryValidatePeerAgainstBaseline(peer, _baseline, out error))
            {
                return false;
            }

            string supersededConnectionId = null;
            foreach (var pair in _peers)
            {
                if (pair.Key != peer.connectionId && pair.Value.userId == peer.userId)
                {
                    supersededConnectionId = pair.Key;
                    break;
                }
            }

            if (supersededConnectionId != null)
            {
                _peers.Remove(supersededConnectionId);
            }
            _peers[peer.connectionId] = CopyPeer(peer);
            error = string.Empty;
            Version += 1;
            Changed?.Invoke();
            return true;
        }

        public bool ApplyBaseline(ProjectBaselineRecord baseline, out string error)
        {
            if (!TeamForgeProjectValidation.TryValidateBaseline(baseline, out error))
            {
                return false;
            }

            if (_baseline != null)
            {
                if (!string.Equals(_baseline.projectUuid, baseline.projectUuid, StringComparison.Ordinal))
                {
                    error = "A Project baseline cannot change the active Project UUID.";
                    return false;
                }
                if (baseline.baselineRevision < _baseline.baselineRevision)
                {
                    error = "A Project baseline revision cannot move backwards.";
                    return false;
                }
                if (baseline.baselineRevision == _baseline.baselineRevision &&
                    !SameBaselineIdentity(_baseline, baseline))
                {
                    error = "The same Project baseline revision cannot identify different content.";
                    return false;
                }
            }

            var revisionChanged = _baseline == null || baseline.baselineRevision != _baseline.baselineRevision;
            _baseline = CopyBaseline(baseline);
            if (revisionChanged)
            {
                // Existing rank/verification metadata was calculated against the old
                // baseline. Wait for authoritative peer events or a fresh snapshot.
                _peers.Clear();
            }

            error = string.Empty;
            Version += 1;
            Changed?.Invoke();
            return true;
        }

        public bool Remove(string connectionId)
        {
            if (string.IsNullOrWhiteSpace(connectionId) || !_peers.Remove(connectionId))
            {
                return false;
            }

            Version += 1;
            Changed?.Invoke();
            return true;
        }

        public bool TryGet(string connectionId, out ProjectPeerRecord peer)
        {
            if (_peers.TryGetValue(connectionId ?? string.Empty, out var stored))
            {
                peer = CopyPeer(stored);
                return true;
            }

            peer = null;
            return false;
        }

        public List<ProjectPeerRecord> Snapshot()
        {
            var result = new List<ProjectPeerRecord>(_peers.Count);
            foreach (var peer in _peers.Values)
            {
                result.Add(CopyPeer(peer));
            }
            result.Sort((left, right) =>
            {
                var byRank = left.seedRank.CompareTo(right.seedRank);
                if (byRank != 0)
                {
                    return byRank;
                }

                var byLatency = left.observedLatencyMilliseconds.CompareTo(right.observedLatencyMilliseconds);
                return byLatency != 0
                    ? byLatency
                    : string.Compare(left.connectionId, right.connectionId, StringComparison.Ordinal);
            });
            return result;
        }

        public void Clear()
        {
            if (_baseline == null && _peers.Count == 0)
            {
                return;
            }

            _baseline = null;
            _peers.Clear();
            Version += 1;
            Changed?.Invoke();
        }

        private static bool TryValidatePeerAgainstBaseline(
            ProjectPeerRecord peer,
            ProjectBaselineRecord baseline,
            out string error)
        {
            if (baseline == null)
            {
                if (peer.seedRank != 3 && peer.seedRank != 99)
                {
                    error = "A Project peer cannot be a verified seed before a baseline is published.";
                    return false;
                }

                error = string.Empty;
                return true;
            }

            if (!string.Equals(peer.projectUuid, baseline.projectUuid, StringComparison.Ordinal))
            {
                error = "Project peer UUID does not match the active baseline.";
                return false;
            }

            if (peer.seedRank != 99 &&
                (peer.baselineRevision != baseline.baselineRevision ||
                 !string.Equals(peer.manifestHash, baseline.manifestHash, StringComparison.Ordinal) ||
                 !string.Equals(peer.descriptorHash, baseline.descriptorHash, StringComparison.Ordinal)))
            {
                error = "A selectable Project seed must match the active baseline exactly.";
                return false;
            }

            error = string.Empty;
            return true;
        }

        private static bool SameBaselineIdentity(ProjectBaselineRecord left, ProjectBaselineRecord right)
        {
            return left.projectUuid == right.projectUuid &&
                   left.baselineRevision == right.baselineRevision &&
                   left.manifestHash == right.manifestHash &&
                   left.descriptorHash == right.descriptorHash &&
                   left.unityVersion == right.unityVersion &&
                   left.teamForgePackageVersion == right.teamForgePackageVersion &&
                   left.realtimeProtocolVersion == right.realtimeProtocolVersion &&
                   left.transferProtocolVersion == right.transferProtocolVersion &&
                   left.manifestSchemaVersion == right.manifestSchemaVersion &&
                   left.ownerKeyId == right.ownerKeyId &&
                   left.ownerPublicKey == right.ownerPublicKey &&
                   left.publisherKeyId == right.publisherKeyId &&
                   left.publisherPublicKey == right.publisherPublicKey &&
                   left.publisherAuthorization == right.publisherAuthorization &&
                   left.baselineSignature == right.baselineSignature;
        }

        private static ProjectBaselineRecord CopyBaseline(ProjectBaselineRecord source)
        {
            if (source == null)
            {
                return null;
            }

            return new ProjectBaselineRecord
            {
                projectUuid = source.projectUuid,
                baselineRevision = source.baselineRevision,
                manifestHash = source.manifestHash,
                descriptorHash = source.descriptorHash,
                unityVersion = source.unityVersion,
                teamForgePackageVersion = source.teamForgePackageVersion,
                realtimeProtocolVersion = source.realtimeProtocolVersion,
                transferProtocolVersion = source.transferProtocolVersion,
                manifestSchemaVersion = source.manifestSchemaVersion,
                ownerKeyId = source.ownerKeyId,
                ownerPublicKey = source.ownerPublicKey,
                publisherKeyId = source.publisherKeyId,
                publisherPublicKey = source.publisherPublicKey,
                publisherAuthorization = source.publisherAuthorization,
                baselineSignature = source.baselineSignature,
                publishedByUserId = source.publishedByUserId,
                publishedByConnectionId = source.publishedByConnectionId,
                publishedAtUnixMs = source.publishedAtUnixMs,
            };
        }

        private static ProjectPeerRecord CopyPeer(ProjectPeerRecord source)
        {
            if (source == null)
            {
                return null;
            }

            return new ProjectPeerRecord
            {
                userId = source.userId,
                connectionId = source.connectionId,
                userName = source.userName,
                projectUuid = source.projectUuid,
                baselineRevision = source.baselineRevision,
                manifestHash = source.manifestHash,
                descriptorHash = source.descriptorHash,
                completeBaseline = source.completeBaseline,
                availableChunkCount = source.availableChunkCount,
                totalChunkCount = source.totalChunkCount,
                endpoint = source.endpoint,
                transferToken = source.transferToken,
                unityVersion = source.unityVersion,
                teamForgePackageVersion = source.teamForgePackageVersion,
                realtimeProtocolVersion = source.realtimeProtocolVersion,
                transferProtocolVersion = source.transferProtocolVersion,
                manifestSchemaVersion = source.manifestSchemaVersion,
                ownerKeyId = source.ownerKeyId,
                ownerPublicKey = source.ownerPublicKey,
                publisherKeyId = source.publisherKeyId,
                publisherPublicKey = source.publisherPublicKey,
                publisherAuthorization = source.publisherAuthorization,
                baselineSignature = source.baselineSignature,
                ownerProofSignature = source.ownerProofSignature,
                ownerProofVerified = source.ownerProofVerified,
                descriptorVerified = source.descriptorVerified,
                seedRank = source.seedRank,
                observedLatencyMilliseconds = source.observedLatencyMilliseconds,
                announcedAtUnixMs = source.announcedAtUnixMs,
                lastUpdatedUnixMs = source.lastUpdatedUnixMs,
                leaveReason = source.leaveReason,
            };
        }
    }
}

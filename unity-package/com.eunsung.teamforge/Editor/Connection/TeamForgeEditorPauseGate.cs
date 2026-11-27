using System;

namespace EunSung.TeamForge
{
    // A deliberately narrow, connection-local pause. This does NOT confirm
    // on-disk Project/Asset/Guest state and never grants a Baseline commit.
    // Server failure or Domain Reload must disconnect, never silently resume
    // publication under the old pause. Local Unity changes are NOT discarded.
    internal sealed class TeamForgeEditorPauseGate
    {
        private string _pauseId = string.Empty;
        private string _connectionId = string.Empty;
        private string _authorityEpoch = string.Empty;
        private string _durableSessionId = string.Empty;
        private long _serverRevision;
        private long _expiresAtUnixMs;
        private bool _locallyChanged;

        internal bool IsPaused => _pauseId.Length != 0;
        internal string PauseId => _pauseId;
        internal long ExpiresAtUnixMs => _expiresAtUnixMs;
        internal bool LocallyChanged => _locallyChanged;

        internal bool TryBegin(ProjectEditPauseRequestMessage request,
            ProjectBaselineRecord baseline, string connectionId,
            string authorityEpoch, string durableSessionId, long observedRevision,
            bool localReady, long nowUnixMs)
        {
            if (IsPaused || !localReady || request == null || baseline == null ||
                string.IsNullOrEmpty(connectionId) ||
                !IsCanonicalUuid(request.pauseId) || !IsCanonicalUuid(request.projectUuid) ||
                !IsCanonicalUuid(authorityEpoch) || !IsCanonicalUuid(durableSessionId) ||
                !IsHash(request.descriptorHash) || !IsHash(request.manifestHash) ||
                request.baselineRevision < 1 || request.serverRevision < 0 ||
                nowUnixMs < 1 || request.expiresAtUnixMs <= nowUnixMs ||
                request.expiresAtUnixMs - nowUnixMs > 30000 ||
                baseline.projectUuid != request.projectUuid ||
                baseline.baselineRevision != request.baselineRevision ||
                baseline.descriptorHash != request.descriptorHash ||
                baseline.manifestHash != request.manifestHash ||
                request.authorityEpoch != authorityEpoch ||
                request.durableSessionId != durableSessionId ||
                request.serverRevision != observedRevision)
                return false;

            _pauseId = request.pauseId;
            _connectionId = connectionId;
            _authorityEpoch = authorityEpoch;
            _durableSessionId = durableSessionId;
            _serverRevision = observedRevision;
            _expiresAtUnixMs = request.expiresAtUnixMs;
            _locallyChanged = false;
            return true;
        }

        internal bool AllowsOutbound(string type)
        {
            return !IsPaused || type == "ping" || type == "project_edit_pause_ack" || type == "project_guest_transition_proof";
        }

        internal bool IsCurrent(string connectionId, string epoch,
            string durableSessionId, long revision, long nowUnixMs)
        {
            return IsPaused && !_locallyChanged &&
                connectionId == _connectionId && epoch == _authorityEpoch &&
                durableSessionId == _durableSessionId && revision == _serverRevision &&
                nowUnixMs <= _expiresAtUnixMs;
        }

        internal void ObserveLocalChange()
        {
            if (IsPaused) _locallyChanged = true;
        }

        internal bool Cancel(string pauseId)
        {
            if (!IsPaused || pauseId != _pauseId) return false;
            Clear();
            return true;
        }

        internal void Clear()
        {
            _pauseId = _connectionId = _authorityEpoch = _durableSessionId = string.Empty;
            _serverRevision = _expiresAtUnixMs = 0;
            _locallyChanged = false;
        }

        private static bool IsHash(string value)
        {
            if (value == null || value.Length != 64) return false;
            foreach (var c in value)
                if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
            return true;
        }

        private static bool IsCanonicalUuid(string value)
        {
            return value != null && value.Length == 36 &&
                Guid.TryParseExact(value, "D", out var parsed) &&
                parsed != Guid.Empty &&
                string.Equals(parsed.ToString("D"), value, StringComparison.Ordinal);
        }
    }
}

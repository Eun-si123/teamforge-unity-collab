using System;
using System.Collections.Generic;

namespace EunSung.TeamForge
{
    // A pure, in-memory client-side state machine for the real Server's
    // explicitly opt-in one-time freshness probe. NEVER an attestation,
    // source receipt, Component lock, Inspector apply or write authorization.
    internal sealed class TeamForgeWp6ServerChallengeFlow
    {
        private string _issueId = string.Empty;
        private string _echoId = string.Empty;
        // A few late results can arrive while a newer probe is pending.
        // Keep only the last eight IDs, not an unbounded replay registry.
        private readonly Queue<string> _retiredIds = new Queue<string>();
        private DateTime _deadlineUtc;
        private TeamForgeWp6PreviewSourceGate.ProjectPin _project;
        private string _sceneId = string.Empty;
        private string _sceneSha = string.Empty;
        private string _metaSha = string.Empty;

        internal string Status { get; private set; } =
            "OFF — server source challenge not requested.";
        internal bool Pending => _issueId.Length > 0 || _echoId.Length > 0;
        internal string SceneId => _sceneId;
        internal string SceneSha => _sceneSha;
        internal string MetaSha => _metaSha;
        internal TeamForgeWp6PreviewSourceGate.ProjectPin Project => _project;

        private static bool Hash(string value, int length)
        {
            if (value == null || value.Length != length) return false;
            foreach (char c in value)
                if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')))
                    return false;
            return true;
        }

        internal void Reset()
        {
            _issueId = _echoId = string.Empty;
            _retiredIds.Clear();
            _project = null;
            _sceneId = _sceneSha = _metaSha = string.Empty;
            _deadlineUtc = default;
            Status = "OFF — server source challenge not requested.";
        }

        private void Retire(string id)
        {
            if (string.IsNullOrEmpty(id) || _retiredIds.Contains(id)) return;
            if (_retiredIds.Count >= 8) _retiredIds.Dequeue();
            _retiredIds.Enqueue(id);
        }

        private void ClearCurrent()
        {
            _issueId = _echoId = string.Empty;
            _project = null;
            _sceneId = _sceneSha = _metaSha = string.Empty;
            _deadlineUtc = default;
        }

        internal bool TryBegin(
            TeamForgeWp6PreviewSourceGate.ProjectPin project,
            TeamForgeWp6PreviewSourceGate.Verified scene,
            DateTime nowUtc, out ComponentSourceChallengeRequestMessage request,
            out string error)
        {
            request = null;
            error = "A current clean saved Scene and connected signed Project are required.";
            if (Pending || project == null || !project.DescriptorMatchesBaseline ||
                scene == null || !Hash(scene.SceneGuid, 32) ||
                !Hash(scene.SceneFileSha256, 64) || !Hash(scene.MetaSha256, 64) ||
                scene.SceneGuid == new string('0', 32))
            {
                if (Pending)
                    error = "A WP6 source challenge is already in flight.";
                return false;
            }
            _project = project;
            _sceneId = scene.SceneGuid;
            _sceneSha = scene.SceneFileSha256;
            _metaSha = scene.MetaSha256;
            _issueId = Guid.NewGuid().ToString("N");
            _deadlineUtc = nowUtc.AddSeconds(15);
            request = new ComponentSourceChallengeRequestMessage
            {
                type = "component_source_challenge_request",
                protocolVersion = TeamForgeProtocol.Version,
                requestId = _issueId,
                sceneId = _sceneId,
            };
            Status = "REQUESTED — one-time server freshness challenge. No source attestation.";
            error = string.Empty;
            return true;
        }

        internal bool MatchesCurrent(
            TeamForgeWp6PreviewSourceGate.ProjectPin current,
            TeamForgeWp6PreviewSourceGate.Verified scene)
        {
            return Pending && current != null && _project != null &&
                _project.Same(current) && scene != null &&
                scene.SceneGuid == _sceneId &&
                scene.SceneFileSha256 == _sceneSha &&
                scene.MetaSha256 == _metaSha;
        }

        internal bool IgnoreExpired(string requestId)
        {
            return !string.IsNullOrEmpty(requestId) &&
                _retiredIds.Contains(requestId);
        }

        internal bool Expire(DateTime nowUtc)
        {
            if (!Pending || nowUtc < _deadlineUtc) return false;
            Retire(_issueId);
            Retire(_echoId);
            ClearCurrent();
            Status = "TIMEOUT — freshness challenge expired without verifying source.";
            return true;
        }

        internal bool TryAcceptIssued(
            ComponentSourceChallengeMessage response, DateTime nowUtc,
            out ComponentSourceChallengeEchoMessage echo, out string error)
        {
            echo = null;
            error = "Unsolicited or invalid WP6 server freshness challenge.";
            if (response == null || response.type != "component_source_challenge" ||
                !Pending || _issueId.Length == 0 ||
                response.requestId != _issueId ||
                response.protocolVersion != TeamForgeProtocol.Version ||
                response.status != "server_source_freshness_probe_unverified" ||
                response.sceneId != _sceneId ||
                response.projectUuid != _project?.ProjectUuid ||
                response.baselineRevision != _project.BaselineRevision ||
                response.manifestHash != _project.ManifestHash ||
                response.descriptorHash != _project.DescriptorHash ||
                !Hash(response.nonce, 64) ||
                response.sessionRevision < 0 || response.expiresAtUnixMs <= 0 ||
                response.sceneBytesAttested ||
                response.editorApplyVerified || response.networkWriteAuthorized ||
                nowUtc >= _deadlineUtc)
                return false;

            Retire(_issueId); // delayed duplicate is non-authoritative.
            _issueId = string.Empty;
            _echoId = Guid.NewGuid().ToString("N");
            echo = new ComponentSourceChallengeEchoMessage
            {
                type = "component_source_challenge_echo",
                protocolVersion = TeamForgeProtocol.Version,
                requestId = _echoId,
                sceneId = _sceneId,
                nonce = response.nonce,
            };
            Status = "ECHO REQUESTED — same socket only; no verified Scene source.";
            error = string.Empty;
            return true;
        }

        internal bool TryAcceptEchoed(
            ComponentSourceChallengeEchoResultMessage response, DateTime nowUtc,
            out string error)
        {
            error = "Unsolicited or invalid WP6 server challenge echo.";
            if (response == null || response.type != "component_source_challenge_echo_result" ||
                !Pending || _echoId.Length == 0 ||
                response.requestId != _echoId ||
                response.protocolVersion != TeamForgeProtocol.Version ||
                response.status != "same_connection_challenge_echo_unverified" ||
                !response.challengeConsumed ||
                response.sceneId != _sceneId ||
                response.projectUuid != _project?.ProjectUuid ||
                response.baselineRevision != _project.BaselineRevision ||
                response.manifestHash != _project.ManifestHash ||
                response.descriptorHash != _project.DescriptorHash ||
                response.sceneBytesAttested ||
                response.editorApplyVerified || response.networkWriteAuthorized ||
                nowUtc >= _deadlineUtc)
                return false;

            Retire(_echoId);
            ClearCurrent();
            Status = "SERVER NONCE ECHO ONLY — exact live socket returned one challenge. " +
                "Scene source NOT authenticated; Inspector apply/ACK NOT verified.";
            error = string.Empty;
            return true;
        }

        internal bool TryRefuse(string requestId, string code)
        {
            if (string.IsNullOrEmpty(requestId) ||
                (requestId != _issueId && requestId != _echoId))
                return false;
            Retire(_issueId);
            Retire(_echoId);
            ClearCurrent();
            Status = "REFUSED — " + (code ?? "unknown") +
                ". No source proof, Scene edit or connection change.";
            return true;
        }

        internal void RefuseStale()
        {
            Retire(_issueId);
            Retire(_echoId);
            ClearCurrent();
            Status = "STALE — Project, Session or loaded Scene changed. No proof accepted.";
        }
    }
}

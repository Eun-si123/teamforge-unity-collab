using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;

namespace EunSung.TeamForge
{
    public static partial class TeamForgeConnectionService
    {
        // Only accepted Launcher handoff can establish this local pin.
        // It is intentionally not serialized across domain reloads.
        private static TeamForgeGuestHandoffData _participantHandoff;
        private static TeamForgeJoinCodePayload _participantSession;
        private static bool _guestProofOffered;
        private static bool _guestProofAvailable;
        private static CancellationTokenSource _guestProofWorker;
        private static string _guestProofRequestId = string.Empty;
        private static string _guestProofPauseId = string.Empty;

        [Serializable] private sealed class ParticipantLocal
        {
            public string managedRoot, stateRoot, activePath, projectUuid, projectId, manifestHash, descriptorHash, ownerKeyId, publisherKeyId;
            public long baselineRevision;
        }
        [Serializable] private sealed class ParticipantContext
        {
            public string projectId, projectUuid, descriptorHash, pauseId, connectionId, sessionId, authorityEpoch, durableSessionId;
            public long serverRevision, expiresAtUnixMs;
        }
        [Serializable] private sealed class ParticipantWorkerInput
        {
            public ParticipantLocal local;
            public ParticipantContext context;
            public ProjectGuestTransitionChallengeMessage challenge;
        }
        [Serializable] private sealed class ParticipantWorkerReply
        {
            public string pauseId, challengeId, signature;
        }

        internal static void PinGuestParticipantHandoff(TeamForgeGuestHandoffData handoff)
        {
            _participantHandoff = null;
            _participantSession = null;
            if (handoff != null && TeamForgeJoinCode.TryParse(handoff.sessionJoinCode, out var session, out _))
            {
                _participantHandoff = handoff;
                _participantSession = session;
            }
        }

        private static ParticipantLocal CurrentParticipantLocal()
        {
            var h = _participantHandoff;
            var session = _participantSession;
            var descriptor = TeamForgeProjectService.Descriptor;
            if (h == null || session == null || descriptor == null ||
                session.projectId != Settings.ProjectId.Trim() || session.sessionId != Settings.SessionId.Trim() ||
                session.serverAddress != Settings.ServerAddress.Trim() || session.realtimePath != Settings.RealtimePath.Trim() ||
                !string.IsNullOrEmpty(_ownedHostControlAddress) ||
                h.projectUuid != descriptor.projectUuid || h.descriptorHash != descriptor.descriptorHash ||
                h.manifestHash != descriptor.manifestHash || h.baselineRevision != descriptor.baselineRevision)
                return null;
            try
            {
                var policy = ResolvedProfile.Connection;
                if (policy.ServerAddress != session.serverAddress || policy.RealtimePath != session.realtimePath ||
                    !ConnectionStrategy.TryCreateAttempts(session.serverAddress, session.realtimePath,
                        Settings.EffectiveAuthenticationToken, policy.KeepAliveSeconds, out var attempts, out _) ||
                    attempts == null || attempts.Length != 1 || attempts[0].Endpoint.ToString() != CurrentEndpoint)
                    return null;
                var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                if (string.IsNullOrWhiteSpace(local)) return null;
                var state = Path.GetFullPath(Path.Combine(local, "TeamForge", "Launcher"));
                var active = new DirectoryInfo(h.activeProjectPath);
                var root = active.Parent?.Parent?.Parent;
                if (root == null || active.Parent.Name != "active" || active.Parent.Parent.Name != h.projectUuid)
                    return null;
                var key = Path.Combine(state, "guest-core", "participants", h.projectUuid + "-" + h.ownerKeyId + ".json");
                // This cheap existence hint only decides whether to offer a
                // capability. The verified Node worker checks all trust/paths.
                if (!File.Exists(key)) return null;
                return new ParticipantLocal { managedRoot = root.FullName, stateRoot = state, activePath = active.FullName,
                    projectUuid = h.projectUuid, projectId = session.projectId, baselineRevision = h.baselineRevision,
                    manifestHash = h.manifestHash, descriptorHash = h.descriptorHash, ownerKeyId = h.ownerKeyId,
                    publisherKeyId = h.publisherKeyId };
            }
            catch (Exception) { return null; }
        }

        private static void RetireGuestProof()
        {
            var worker = _guestProofWorker;
            _guestProofWorker = null;
            _guestProofRequestId = _guestProofPauseId = string.Empty;
            worker?.Cancel();
        }

        private static bool GuestProofCurrent(int epoch, IRealtimeTransport transport, ParticipantWorkerInput input)
        {
            var context = input.context;
            var local = CurrentParticipantLocal();
            return IsCurrent(epoch, transport) && !_editorIsShuttingDown &&
                State == TeamForgeConnectionState.Connected && _guestProofAvailable &&
                ProjectEditPause.PauseId == context.pauseId &&
                ProjectEditPause.IsCurrent(ConnectionId, AuthorityEpoch, DurableSessionId,
                    TeamForgeAuthorityView.Current.SessionRevision, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()) &&
                IsLocallyQuiescentForPause(context.serverRevision) &&
                local != null && local.descriptorHash == input.local.descriptorHash &&
                local.projectId == context.projectId && local.activePath == input.local.activePath &&
                local.ownerKeyId == input.local.ownerKeyId && local.publisherKeyId == input.local.publisherKeyId &&
                ConnectionId == context.connectionId && AuthorityEpoch == context.authorityEpoch &&
                DurableSessionId == context.durableSessionId && Settings.SessionId.Trim() == context.sessionId;
        }

        private static void HandleGuestTransitionChallenge(int epoch, IRealtimeTransport transport, string text)
        {
            var local = CurrentParticipantLocal();
            var challenge = text.Length <= 16384 ? TeamForgeProtocol.Deserialize<ProjectGuestTransitionChallengeMessage>(text) : null;
            if (local == null || challenge == null || !_guestProofAvailable || _guestProofWorker != null ||
                _guestProofRequestId.Length != 0 || challenge.type != "project_guest_transition_challenge" ||
                challenge.protocolVersion != TeamForgeProtocol.Version || challenge.requestId != string.Empty || challenge.pauseId != ProjectEditPause.PauseId ||
                !TeamForgeDurableSessionWire.IsCanonicalUuid(challenge.challengeId) ||
                challenge.expiresAtUnixMs != ProjectEditPause.ExpiresAtUnixMs ||
                string.IsNullOrEmpty(challenge.payload) || challenge.payload.Length > 4096)
            {
                HandleConnectionLoss(epoch, transport, "Participant proof request rejected; no Project transition authorized.", true);
                return;
            }
            var input = new ParticipantWorkerInput { local = local, challenge = challenge, context = new ParticipantContext
            {
                projectId = local.projectId, projectUuid = local.projectUuid, descriptorHash = local.descriptorHash,
                pauseId = ProjectEditPause.PauseId, connectionId = ConnectionId, sessionId = Settings.SessionId.Trim(),
                authorityEpoch = AuthorityEpoch, durableSessionId = DurableSessionId,
                serverRevision = TeamForgeAuthorityView.Current.SessionRevision, expiresAtUnixMs = ProjectEditPause.ExpiresAtUnixMs,
            }};
            if (!GuestProofCurrent(epoch, transport, input))
            {
                HandleConnectionLoss(epoch, transport, "Local pause changed before participant proof.", true);
                return;
            }

            _ = RespondToGuestTransitionChallengeAsync(epoch, transport, input);
        }

        private static async Task RespondToGuestTransitionChallengeAsync(int epoch, IRealtimeTransport transport, ParticipantWorkerInput input)
        {
            var challenge = input.challenge;
            using var cancellation = new CancellationTokenSource();
            _guestProofWorker = cancellation;
            _guestProofPauseId = challenge.pauseId;
            try
            {
                // Runtime discovery uses Unity's PackageInfo on the main thread.
                // The isolated worker re-verifies the selected entrypoint.
                var runtime = TeamForgeRuntimeDiscovery.Resolve();
                var remaining = contextRemaining(input.context.expiresAtUnixMs);
                if (remaining <= 0) throw new IOException();
                cancellation.CancelAfter(remaining);
                var json = JsonUtility.ToJson(input);
                var response = await Task.Run(() => RunGuestProofWorker(runtime, json, cancellation.Token));
                if (!ReferenceEquals(_guestProofWorker, cancellation) || !IsCurrent(epoch, transport)) return;
                if (cancellation.IsCancellationRequested || !GuestProofCurrent(epoch, transport, input))
                    throw new OperationCanceledException();
                var proof = JsonUtility.FromJson<ParticipantWorkerReply>(response);
                if (proof == null || proof.pauseId != challenge.pauseId || proof.challengeId != challenge.challengeId ||
                    !IsCanonicalProofSignature(proof.signature)) throw new InvalidDataException();
                _guestProofRequestId = Guid.NewGuid().ToString("N");
                if (!TrySendPreparedMessage(new ProjectGuestTransitionProofMessage
                {
                    type = "project_guest_transition_proof", protocolVersion = TeamForgeProtocol.Version,
                    requestId = _guestProofRequestId, pauseId = proof.pauseId, challengeId = proof.challengeId, signature = proof.signature,
                }, epoch, "Participant proof")) throw new IOException();
            }
            catch (Exception)
            {
                if (ReferenceEquals(_guestProofWorker, cancellation) && IsCurrent(epoch, transport))
                    HandleConnectionLoss(epoch, transport, "Participant proof unavailable; local work and keys were preserved.", true);
            }
            finally
            {
                if (ReferenceEquals(_guestProofWorker, cancellation)) _guestProofWorker = null;
            }
        }

        private static int contextRemaining(long expires) =>
            (int)Math.Max(0, Math.Min(30000, expires - DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()));

        internal static bool IsCanonicalProofSignature(string signature)
        {
            if (signature == null || signature.Length != 88) return false;
            try
            {
                var bytes = Convert.FromBase64String(signature);
                return bytes.Length == 64 && Convert.ToBase64String(bytes) == signature;
            }
            catch (FormatException) { return false; }
        }

        private static void HandleGuestTransitionProofAck(int epoch, IRealtimeTransport transport, string text)
        {
            var ack = TeamForgeProtocol.Deserialize<ProjectGuestTransitionProofAckMessage>(text);
            if (!_guestProofAvailable || !ProjectEditPause.IsPaused || ack == null ||
                ack.type != "project_guest_transition_proof_ack" || ack.protocolVersion != TeamForgeProtocol.Version ||
                _guestProofRequestId.Length == 0 || ack.requestId != _guestProofRequestId ||
                ack.pauseId != _guestProofPauseId || ack.pauseId != ProjectEditPause.PauseId ||
                ack.commitPermitted || ack.confirmedCount < 1 || ack.expectedCount < ack.confirmedCount || ack.expectedCount > 128)
            {
                HandleConnectionLoss(epoch, transport, "Invalid participant proof acknowledgement.", true);
                return;
            }
            // Keep the request ID until pause cancellation; one proof per pause.
            TeamForgeDiagnostics.Info("Participant identity confirmed for this pause; no Project transition authorized.");
        }

        private static async Task<string> RunGuestProofWorker(TeamForgeRuntimeResolution runtime, string input, CancellationToken token)
        {
            var cli = TeamForgeRuntimeDiscovery.ResolveVerifiedWorker(runtime, "guest-participant-proof-cli.mjs", token);
            if (cli == null || cli.IndexOf('"') >= 0) throw new IOException();
            token.ThrowIfCancellationRequested();
            var start = new ProcessStartInfo
            {
                FileName = runtime.NodeExecutable, WorkingDirectory = runtime.WorkspaceRoot,
                Arguments = "\"" + cli + "\"", UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true,
            };
            start.EnvironmentVariables.Clear();
            foreach (var name in new[] { "SystemRoot", "WINDIR", "TEMP", "TMP", "TMPDIR" })
            {
                var value = Environment.GetEnvironmentVariable(name);
                if (!string.IsNullOrEmpty(value)) start.EnvironmentVariables[name] = value;
            }
            using var worker = new Process { StartInfo = start };
            if (!worker.Start()) throw new IOException();
            void Stop() { try { if (!worker.HasExited) worker.Kill(); } catch (InvalidOperationException) { } catch (System.ComponentModel.Win32Exception) { } }
            using var cancellation = token.Register(Stop);
            try
            {
                var drain = worker.StandardError.BaseStream.CopyToAsync(Stream.Null, 4096, token);
                var bytes = new UTF8Encoding(false, true).GetBytes(input);
                if (bytes.Length > 32768) throw new IOException();
                await worker.StandardInput.BaseStream.WriteAsync(bytes, 0, bytes.Length, token).ConfigureAwait(false);
                worker.StandardInput.Close();
                var buffer = new byte[4097];
                var length = 0;
                while (length < buffer.Length)
                {
                    var read = await worker.StandardOutput.BaseStream.ReadAsync(buffer, length, buffer.Length - length, token).ConfigureAwait(false);
                    if (read == 0) break;
                    length += read;
                }
                if (length == buffer.Length) throw new IOException();
                await drain.ConfigureAwait(false);
                token.ThrowIfCancellationRequested();
                if (!worker.WaitForExit(1000) || worker.ExitCode != 0) throw new IOException();
                return new UTF8Encoding(false, true).GetString(buffer, 0, length);
            }
            finally { Stop(); }
        }
    }
}

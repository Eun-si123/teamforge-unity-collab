using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using UnityEditor;
using UnityEngine;

namespace EunSung.TeamForge
{
    [InitializeOnLoad]
    public static class TeamForgeProjectService
    {
        private const int MaximumDescriptorBytes = 65536;
        private const int MaximumInvitationCharacters = 65536;
        private static readonly string[] DescriptorFields =
        {
            "schemaVersion", "projectUuid", "baselineRevision", "manifestHash", "descriptorHash",
            "unityVersion", "teamForgePackageVersion", "realtimeProtocolVersion",
            "transferProtocolVersion", "manifestSchemaVersion",
        };
        private static readonly string[] InvitationFields =
        {
            "format", "serverAddress", "realtimePath", "projectId", "projectUuid", "sessionId",
            "ownerKeyId", "ownerPublicKey", "ownerSignature",
        };

        private static TeamForgeProjectDescriptor _descriptor;
        private static TeamForgeProjectInvitation _invitation;
        private static string _descriptorError = string.Empty;
        private static string _lastError = string.Empty;
        private static string _registryProjectUuid = string.Empty;
        private static string _syncReason = string.Empty;
        private static bool _receivedRegistrySnapshot;
        private static bool _currentProjectSeedSourceSelected;
        private static bool _syncRequired;
        private static bool _wasProjectConnected;

        static TeamForgeProjectService()
        {
            Registry.Changed += OnRegistryChanged;
            TeamForgeConnectionService.Changed += OnConnectionChanged;
            TeamForgeConnectionService.ProjectMessageReceived += OnProjectMessageReceived;
            ReloadDescriptorInternal(false);
            RefreshState(false);
        }

        public static event Action Changed;

        public static TeamForgeProjectRegistry Registry { get; } = new TeamForgeProjectRegistry();
        public static TeamForgeProjectBootstrapState State { get; private set; }
        public static long Version { get; private set; }
        public static TeamForgeProjectDescriptor Descriptor => CopyDescriptor(_descriptor);
        public static TeamForgeProjectInvitation Invitation => CopyInvitation(_invitation);
        public static string DescriptorError => _descriptorError;
        public static string LastError => _lastError;
        public static string SyncReason => _syncReason;
        public static bool CurrentProjectSeedSourceSelected => _currentProjectSeedSourceSelected;
        public static bool RegistrySnapshotReceived => _receivedRegistrySnapshot;
        public static bool InvitationRequiresSidecarSignatureVerification => _invitation != null;
        public static bool InvitationRequiresNewAuthentication =>
            _invitation != null && string.IsNullOrEmpty(TeamForgeConnectionService.Settings.EffectiveAuthenticationToken);

        public static string RemoteProjectUuid
        {
            get
            {
                var baseline = Registry.Baseline;
                return baseline?.projectUuid ?? _registryProjectUuid;
            }
        }

        public static string PublisherFingerprint
        {
            get
            {
                var baseline = Registry.Baseline;
                return baseline?.publisherKeyId ?? _invitation?.ownerKeyId ?? string.Empty;
            }
        }

        public static string ManagedStagingLocation
        {
            get
            {
                var projectUuid = RemoteProjectUuid;
                return TeamForgeProjectValidation.TryValidateCanonicalProjectUuid(projectUuid, out _)
                    ? $"{TeamForgeProjectContract.ManagedProjectsRelativePath}/{projectUuid}/staging/<download-id>"
                    : $"{TeamForgeProjectContract.ManagedProjectsRelativePath}/<project-uuid>/staging/<download-id>";
            }
        }

        public static void ReloadDescriptor()
        {
            ReloadDescriptorInternal(true);
        }

        public static bool TryEnsureCurrentProjectDescriptor(
            out TeamForgeProjectDescriptor descriptor,
            out string error)
        {
            ReloadDescriptorInternal(false);
            if (_descriptor == null && string.IsNullOrEmpty(_descriptorError))
            {
                if (!TryCreateDescriptor(out error))
                {
                    descriptor = null;
                    return false;
                }
            }

            if (_descriptor == null)
            {
                descriptor = null;
                error = string.IsNullOrWhiteSpace(_descriptorError)
                    ? "The current Project has no valid TeamForge descriptor."
                    : _descriptorError;
                return false;
            }

            descriptor = CopyDescriptor(_descriptor);
            error = string.Empty;
            return true;
        }

        public static bool TrySelectCurrentProjectAsSeedSource(out string error)
        {
            ReloadDescriptorInternal(false);
            if (_descriptor == null && string.IsNullOrEmpty(_descriptorError))
            {
                if (!TryCreateDescriptor(out error))
                {
                    return false;
                }
            }

            if (_descriptor == null)
            {
                error = string.IsNullOrWhiteSpace(_descriptorError)
                    ? "The current Project has no valid TeamForge descriptor."
                    : _descriptorError;
                return false;
            }

            var remoteProjectUuid = RemoteProjectUuid;
            if (!string.IsNullOrEmpty(remoteProjectUuid) &&
                !string.Equals(remoteProjectUuid, _descriptor.projectUuid, StringComparison.Ordinal))
            {
                error = "The current Project UUID differs from the session Project. It cannot be used as a seed source.";
                return false;
            }

            if (_invitation != null &&
                !string.Equals(_invitation.projectUuid, _descriptor.projectUuid, StringComparison.Ordinal))
            {
                error = "The current Project UUID differs from the imported invitation. It cannot be used as a seed source.";
                return false;
            }

            // This explicit opt-in records intent only. Unity does not scan, upload,
            // sign, publish, or start the project-peer sidecar here.
            _currentProjectSeedSourceSelected = true;
            _lastError = string.Empty;
            TeamForgeDiagnostics.Info(
                "Current Project was selected as an explicit seed source. Export sidecar settings to scan or publish it.");
            error = string.Empty;
            RefreshState(true);
            return true;
        }

        public static void ClearCurrentProjectSeedSourceSelection()
        {
            if (!_currentProjectSeedSourceSelected)
            {
                return;
            }

            _currentProjectSeedSourceSelected = false;
            RefreshState(true);
        }

        public static bool TryBuildLaunchSettingsJson(out string json, out string error)
        {
            json = string.Empty;
            var baseline = Registry.Baseline;
            var projectUuid = _currentProjectSeedSourceSelected
                ? _descriptor?.projectUuid
                : baseline?.projectUuid ?? _registryProjectUuid;
            if (string.IsNullOrEmpty(projectUuid))
            {
                projectUuid = _invitation?.projectUuid ?? _descriptor?.projectUuid;
            }

            var launchSettings = new TeamForgeProjectPeerLaunchSettings
            {
                serverAddress = TeamForgeConnectionService.Settings.ServerAddress?.Trim(),
                coordinatorListenHost = TeamForgeConnectionService.Settings.CoordinatorListenHost?.Trim(),
                realtimePath = TeamForgeConnectionService.Settings.RealtimePath?.Trim(),
                projectId = TeamForgeConnectionService.Settings.ProjectId?.Trim(),
                sessionId = TeamForgeConnectionService.Settings.SessionId?.Trim(),
                projectUuid = projectUuid,
                sourceProjectRelativePath = _currentProjectSeedSourceSelected ? "." : string.Empty,
                projectDescriptorRelativePath = _currentProjectSeedSourceSelected
                    ? TeamForgeProjectContract.DescriptorRelativePath
                    : string.Empty,
                managedProjectsRelativePath = TeamForgeProjectContract.ManagedProjectsRelativePath,
                allowCurrentProjectAsSeedSource = _currentProjectSeedSourceSelected,
            };
            if (!TeamForgeProjectValidation.TryValidateLaunchSettings(launchSettings, out error))
            {
                return false;
            }

            json = JsonUtility.ToJson(launchSettings, true);
            return true;
        }

        public static bool TryParseInvitation(
            string json,
            out TeamForgeProjectInvitation invitation,
            out string error)
        {
            invitation = null;
            if (string.IsNullOrWhiteSpace(json) || json.Length > MaximumInvitationCharacters)
            {
                error = "Project invitation is empty or exceeds its size limit.";
                return false;
            }

            if (ContainsForbiddenSecretField(json) || !HasExactJsonFields(json, InvitationFields))
            {
                error =
                    "Project invitation fields are missing, unknown, or contain credentials/private paths.";
                return false;
            }

            try
            {
                invitation = JsonUtility.FromJson<TeamForgeProjectInvitation>(json);
            }
            catch (Exception)
            {
                error = "Project invitation is not valid JSON.";
                return false;
            }

            if (!TeamForgeProjectValidation.TryValidateInvitation(invitation, out error))
            {
                invitation = null;
                return false;
            }

            return true;
        }

        public static bool TryApplyInvitation(TeamForgeProjectInvitation invitation, out string error)
        {
            if (!TeamForgeProjectValidation.TryValidateInvitation(invitation, out error))
            {
                return false;
            }

            if (!TeamForgeProjectInvitationPolicy.CanApplyConnectionState(
                    TeamForgeConnectionService.ConnectionDesired,
                    TeamForgeConnectionService.State))
            {
                error = "Disconnect before applying a Project invitation.";
                return false;
            }

            _invitation = CopyInvitation(invitation);
            TeamForgeConnectionService.CancelAutomaticResumeForConfigurationChange();
            var settings = TeamForgeConnectionService.Settings;
            TeamForgeProjectInvitationPolicy.ApplyConnectionFields(invitation, settings);
            settings.SaveSettings();
            _currentProjectSeedSourceSelected = false;
            _lastError = string.Empty;
            error = string.Empty;
            RefreshState(true);
            return true;
        }

        public static bool TryGetPreferredSeed(out ProjectPeerRecord peer)
        {
            var peers = Registry.Snapshot();
            foreach (var candidate in peers)
            {
                if (candidate.seedRank >= 0 && candidate.seedRank <= 2)
                {
                    peer = candidate;
                    return true;
                }
            }

            peer = null;
            return false;
        }

        private static bool TryCreateDescriptor(out string error)
        {
            string descriptorPath;
            try
            {
                descriptorPath = DescriptorPath();
                var parent = Path.GetDirectoryName(descriptorPath);
                if (string.IsNullOrEmpty(parent))
                {
                    error = "The ProjectSettings directory could not be resolved.";
                    return false;
                }
                Directory.CreateDirectory(parent);
            }
            catch (Exception exception)
            {
                error = $"The TeamForge descriptor location is unavailable ({exception.GetType().Name}).";
                return false;
            }

            var descriptor = new TeamForgeProjectDescriptor
            {
                projectUuid = Guid.NewGuid().ToString("D"),
                baselineRevision = 0,
                manifestHash = string.Empty,
                descriptorHash = string.Empty,
                unityVersion = Application.unityVersion,
            };
            if (!TeamForgeProjectValidation.TryValidateDescriptor(descriptor, out error))
            {
                return false;
            }

            try
            {
                using (var stream = new FileStream(
                           descriptorPath,
                           FileMode.CreateNew,
                           FileAccess.Write,
                           FileShare.None))
                using (var writer = new StreamWriter(stream, new UTF8Encoding(false)))
                {
                    writer.Write(JsonUtility.ToJson(descriptor, true));
                }
            }
            catch (IOException)
            {
                ReloadDescriptorInternal(false);
                error = _descriptor != null
                    ? "A TeamForge descriptor already exists; it was kept unchanged."
                    : "The TeamForge descriptor could not be created safely (IOException).";
                return false;
            }
            catch (Exception exception)
            {
                error = $"The TeamForge descriptor could not be created safely ({exception.GetType().Name}).";
                return false;
            }

            ReloadDescriptorInternal(false);
            if (_descriptor == null)
            {
                error = string.IsNullOrWhiteSpace(_descriptorError)
                    ? "The new TeamForge descriptor could not be verified."
                    : _descriptorError;
                return false;
            }

            TeamForgeDiagnostics.Info(
                $"Created {TeamForgeProjectContract.DescriptorRelativePath}; no Project files were scanned or transferred.");
            error = string.Empty;
            return true;
        }

        private static void ReloadDescriptorInternal(bool notify)
        {
            _descriptor = null;
            _descriptorError = string.Empty;
            string descriptorPath;
            try
            {
                descriptorPath = DescriptorPath();
                if (!File.Exists(descriptorPath))
                {
                    if (notify)
                    {
                        RefreshState(true);
                    }
                    return;
                }

                var attributes = File.GetAttributes(descriptorPath);
                if ((attributes & FileAttributes.ReparsePoint) != 0)
                {
                    _descriptorError = "The TeamForge descriptor cannot be a symbolic link or reparse point.";
                }
                else
                {
                    var information = new FileInfo(descriptorPath);
                    if (information.Length <= 0 || information.Length > MaximumDescriptorBytes)
                    {
                        _descriptorError = "The TeamForge descriptor is empty or exceeds its size limit.";
                    }
                    else
                    {
                        var json = File.ReadAllText(descriptorPath, Encoding.UTF8);
                        if (ContainsForbiddenSecretField(json) || !HasExactJsonFields(json, DescriptorFields))
                        {
                            _descriptorError =
                                "The TeamForge descriptor cannot contain credentials, private keys, or local paths.";
                        }
                        else
                        {
                            var descriptor = JsonUtility.FromJson<TeamForgeProjectDescriptor>(json);
                            if (TeamForgeProjectValidation.TryValidateDescriptor(descriptor, out var validationError))
                            {
                                _descriptor = descriptor;
                            }
                            else
                            {
                                _descriptorError = validationError;
                            }
                        }
                    }
                }
            }
            catch (Exception exception)
            {
                _descriptorError = $"The TeamForge descriptor could not be read safely ({exception.GetType().Name}).";
            }

            if (_descriptor == null)
            {
                _currentProjectSeedSourceSelected = false;
            }

            if (notify)
            {
                RefreshState(true);
            }
        }

        private static void OnConnectionChanged()
        {
            var projectConnected = TeamForgeConnectionService.State == TeamForgeConnectionState.Connected &&
                                   TeamForgeConnectionService.ProjectTransferAvailable;
            if (projectConnected != _wasProjectConnected)
            {
                _wasProjectConnected = projectConnected;
                Registry.Clear();
                _registryProjectUuid = string.Empty;
                _receivedRegistrySnapshot = false;
                _syncRequired = false;
                _syncReason = string.Empty;
            }

            RefreshState(true);
        }

        private static void OnRegistryChanged()
        {
            RefreshState(true);
        }

        private static void OnProjectMessageReceived(string messageType, string json)
        {
            switch (messageType)
            {
                case "project_registry_snapshot":
                    HandleRegistrySnapshot(json);
                    break;
                case "project_peer_joined":
                case "project_peer_updated":
                    HandlePeerChanged(json);
                    break;
                case "project_peer_left":
                    HandlePeerLeft(json);
                    break;
                case "project_baseline_changed":
                    HandleBaselineChanged(json);
                    break;
                case "project_sync_required":
                    HandleSyncRequired(json);
                    break;
            }
        }

        private static void HandleRegistrySnapshot(string json)
        {
            var snapshot = TeamForgeProtocol.Deserialize<ProjectRegistrySnapshotMessage>(json);
            var error = "Project registry snapshot is empty.";
            if (snapshot == null || snapshot.peers == null)
            {
                RejectProjectMessage(error);
                return;
            }
            if (!TeamForgeProjectValidation.TryValidateProjectId(snapshot.projectId, out error) ||
                !string.Equals(
                    snapshot.projectId,
                    TeamForgeConnectionService.Settings.ProjectId.Trim(),
                    StringComparison.Ordinal))
            {
                RejectProjectMessage(string.IsNullOrWhiteSpace(error)
                    ? "Project registry snapshot routing metadata is invalid."
                    : error);
                return;
            }

            if (!TryValidateSnapshotProjectUuid(snapshot, out error) ||
                !Registry.ReplaceAll(snapshot.baseline, snapshot.peers, out error))
            {
                RejectProjectMessage(error);
                return;
            }

            _registryProjectUuid = snapshot.projectUuid ?? string.Empty;
            _receivedRegistrySnapshot = true;
            _syncRequired = false;
            _syncReason = string.Empty;
            _lastError = string.Empty;
            RefreshState(true);
        }

        private static bool TryValidateSnapshotProjectUuid(
            ProjectRegistrySnapshotMessage snapshot,
            out string error)
        {
            var projectUuid = snapshot.projectUuid ?? string.Empty;
            if (projectUuid.Length == 0)
            {
                if (snapshot.baseline != null || snapshot.peers.Length != 0)
                {
                    error = "A non-empty Project registry requires a Project UUID.";
                    return false;
                }

                error = string.Empty;
                return true;
            }

            if (!TeamForgeProjectValidation.TryValidateCanonicalProjectUuid(projectUuid, out error))
            {
                return false;
            }
            if (snapshot.baseline != null && snapshot.baseline.projectUuid != projectUuid)
            {
                error = "Project registry baseline UUID does not match its routing UUID.";
                return false;
            }
            foreach (var peer in snapshot.peers)
            {
                if (peer == null || peer.projectUuid != projectUuid)
                {
                    error = "Project registry peer UUID does not match its routing UUID.";
                    return false;
                }
            }

            error = string.Empty;
            return true;
        }

        private static void HandlePeerChanged(string json)
        {
            var changed = TeamForgeProtocol.Deserialize<ProjectPeerChangedMessage>(json);
            var error = "Project peer event is empty.";
            if (changed == null || !Registry.Upsert(changed.peer, out error))
            {
                RejectProjectMessage(error);
            }
        }

        private static void HandlePeerLeft(string json)
        {
            var left = TeamForgeProtocol.Deserialize<ProjectPeerLeftMessage>(json);
            var error = "Project peer leave event is invalid.";
            if (left == null || !TeamForgeProjectValidation.TryValidatePeer(left.peer, out error))
            {
                RejectProjectMessage(string.IsNullOrWhiteSpace(error)
                    ? "Project peer leave event is invalid."
                    : error);
                return;
            }

            Registry.Remove(left.peer.connectionId);
        }

        private static void HandleBaselineChanged(string json)
        {
            var changed = TeamForgeProtocol.Deserialize<ProjectBaselineChangedMessage>(json);
            var error = "Project baseline event is empty.";
            if (changed == null || !Registry.ApplyBaseline(changed.baseline, out error))
            {
                RejectProjectMessage(error);
                return;
            }

            _registryProjectUuid = changed.baseline.projectUuid;
            _syncRequired = false;
            _syncReason = string.Empty;
            _lastError = string.Empty;
            RefreshState(true);
        }

        private static void HandleSyncRequired(string json)
        {
            var required = TeamForgeProtocol.Deserialize<ProjectSyncRequiredMessage>(json);
            var error = "Project sync-required event is empty.";
            if (required == null ||
                !TryValidateReason(required.reason, out error) ||
                !Registry.ApplyBaseline(required.baseline, out error))
            {
                RejectProjectMessage(error);
                return;
            }

            _registryProjectUuid = required.baseline.projectUuid;
            _syncRequired = true;
            _syncReason = required.reason.Trim();
            _lastError = string.Empty;
            RefreshState(true);
        }

        private static bool TryValidateReason(string reason, out string error)
        {
            var candidate = reason?.Trim() ?? string.Empty;
            if (candidate.Length == 0 || candidate.Length > 256)
            {
                error = "Project sync reason must contain 1-256 characters.";
                return false;
            }
            foreach (var character in candidate)
            {
                if (char.IsControl(character))
                {
                    error = "Project sync reason cannot contain control characters.";
                    return false;
                }
            }

            error = string.Empty;
            return true;
        }

        private static void RejectProjectMessage(string error)
        {
            _lastError = string.IsNullOrWhiteSpace(error)
                ? "Project Coordinator message was rejected."
                : error;
            TeamForgeDiagnostics.Warning($"Rejected Project Coordinator message: {_lastError}");
            RefreshState(true);
        }

        private static void RefreshState(bool notify)
        {
            var previousState = State;
            State = CalculateState();
            if (notify || State != previousState)
            {
                Version += 1;
                Changed?.Invoke();
            }
        }

        private static TeamForgeProjectBootstrapState CalculateState()
        {
            if (!string.IsNullOrEmpty(_descriptorError))
            {
                return TeamForgeProjectBootstrapState.DescriptorInvalid;
            }
            if (_descriptor != null && _invitation != null &&
                !string.Equals(_descriptor.projectUuid, _invitation.projectUuid, StringComparison.Ordinal))
            {
                return TeamForgeProjectBootstrapState.InvitationMismatch;
            }
            if (TeamForgeConnectionService.State != TeamForgeConnectionState.Connected)
            {
                return TeamForgeProjectBootstrapState.Offline;
            }
            if (!TeamForgeConnectionService.ProjectTransferAvailable)
            {
                return TeamForgeProjectBootstrapState.CapabilityUnavailable;
            }
            if (!_receivedRegistrySnapshot)
            {
                return TeamForgeProjectBootstrapState.WaitingForRegistry;
            }

            var baseline = Registry.Baseline;
            var remoteProjectUuid = baseline?.projectUuid ?? _registryProjectUuid;
            if (_invitation != null &&
                (!string.Equals(_invitation.projectUuid, remoteProjectUuid, StringComparison.Ordinal) ||
                 (baseline != null &&
                  !string.Equals(
                      _invitation.ownerKeyId,
                      baseline.ownerKeyId,
                      StringComparison.Ordinal))))
            {
                return TeamForgeProjectBootstrapState.InvitationMismatch;
            }
            if (_descriptor != null &&
                !string.IsNullOrEmpty(remoteProjectUuid) &&
                !string.Equals(_descriptor.projectUuid, remoteProjectUuid, StringComparison.Ordinal))
            {
                return TeamForgeProjectBootstrapState.ProjectUuidMismatch;
            }
            if (_syncRequired)
            {
                return TeamForgeProjectBootstrapState.SyncRequired;
            }
            if (baseline == null)
            {
                return TeamForgeProjectBootstrapPolicy.ResolveAvailability(false, false);
            }
            if (_descriptor == null)
            {
                return TeamForgeProjectBootstrapState.DescriptorMissing;
            }
            if (_descriptor.baselineRevision != baseline.baselineRevision ||
                !string.Equals(_descriptor.manifestHash, baseline.manifestHash, StringComparison.Ordinal) ||
                !string.Equals(_descriptor.descriptorHash, baseline.descriptorHash, StringComparison.Ordinal))
            {
                return TeamForgeProjectBootstrapState.SyncRequired;
            }
            return TeamForgeProjectBootstrapPolicy.ResolveAvailability(
                true,
                TryGetPreferredSeed(out _));
        }

        private static string DescriptorPath()
        {
            var assetsPath = Application.dataPath;
            var projectRoot = Directory.GetParent(assetsPath);
            if (projectRoot == null)
            {
                throw new InvalidOperationException("Unity Project root is unavailable.");
            }

            return Path.Combine(projectRoot.FullName, "ProjectSettings", "TeamForgeProject.json");
        }

        private static bool ContainsForbiddenSecretField(string json)
        {
            if (string.IsNullOrEmpty(json))
            {
                return false;
            }

            var forbiddenNames = new[]
            {
                "\"privateKey\"",
                "\"privateKeyPath\"",
                "\"token\"",
                "\"authenticationToken\"",
                "\"absolutePath\"",
                "\"projectRoot\"",
                "\"sourcePath\"",
            };
            foreach (var forbiddenName in forbiddenNames)
            {
                if (json.IndexOf(forbiddenName, StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    return true;
                }
            }

            return false;
        }

        private static bool HasExactJsonFields(string json, IEnumerable<string> expectedFields)
        {
            var expected = new HashSet<string>(expectedFields, StringComparer.Ordinal);
            var found = new HashSet<string>(StringComparer.Ordinal);
            var matches = Regex.Matches(json ?? string.Empty, "\"(?<key>(?:\\\\.|[^\"\\\\])*)\"\\s*:");
            foreach (Match match in matches)
            {
                var key = match.Groups["key"].Value;
                if (!expected.Contains(key) || !found.Add(key))
                {
                    return false;
                }
            }

            return found.SetEquals(expected);
        }

        private static TeamForgeProjectDescriptor CopyDescriptor(TeamForgeProjectDescriptor source)
        {
            if (source == null)
            {
                return null;
            }

            return new TeamForgeProjectDescriptor
            {
                schemaVersion = source.schemaVersion,
                projectUuid = source.projectUuid,
                baselineRevision = source.baselineRevision,
                manifestHash = source.manifestHash,
                descriptorHash = source.descriptorHash,
                unityVersion = source.unityVersion,
                teamForgePackageVersion = source.teamForgePackageVersion,
                realtimeProtocolVersion = source.realtimeProtocolVersion,
                transferProtocolVersion = source.transferProtocolVersion,
                manifestSchemaVersion = source.manifestSchemaVersion,
            };
        }

        private static TeamForgeProjectInvitation CopyInvitation(TeamForgeProjectInvitation source)
        {
            if (source == null)
            {
                return null;
            }

            return new TeamForgeProjectInvitation
            {
                format = source.format,
                serverAddress = source.serverAddress,
                realtimePath = source.realtimePath,
                projectId = source.projectId,
                projectUuid = source.projectUuid,
                sessionId = source.sessionId,
                ownerKeyId = source.ownerKeyId,
                ownerPublicKey = source.ownerPublicKey,
                ownerSignature = source.ownerSignature,
            };
        }
    }
}

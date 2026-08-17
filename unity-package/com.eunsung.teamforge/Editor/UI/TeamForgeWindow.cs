using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using UnityEditor;
using UnityEngine;
using UnityEngine.UIElements;

namespace EunSung.TeamForge
{
    public sealed class TeamForgeWindow : EditorWindow
    {
        private readonly List<VisualElement> _configurationFields = new List<VisualElement>();

        private Label _statusValue;
        private Label _endpointValue;
        private Label _rttValue;
        private Label _revisionValue;
        private Label _messagesValue;
        private Label _reconnectValue;
        private Label _presenceStatusValue;
        private Label _transformStatusValue;
        private Label _hierarchyStatusValue;
        private Label _lockStatusValue;
        private Label _projectCapabilityValue;
        private Label _projectBootstrapValue;
        private Label _projectDownloadValue;
        private Label _projectTrustValue;
        private Label _projectLocalIdentityValue;
        private Label _projectRemoteBaselineValue;
        private Label _projectManifestValue;
        private Label _projectPeerValue;
        private Label _projectProtocolValue;
        private Label _errorValue;
        private TextField _logField;
        private VisualElement _presenceContainer;
        private Button _connectButton;
        private Button _disconnectButton;
        private Button _pingButton;
        private Button _requestLockButton;
        private Button _releaseLockButton;
        private Button _importInvitationButton;
        private Button _exportPeerSettingsButton;
        private Button _selectSeedSourceButton;
        private Button _clearSeedSourceButton;
        private Button _copyPublisherFingerprintButton;
        private Button _copySyncCommandButton;
        private double _nextRefreshAt;
        private long _lastPresenceVersion = -1;
        private bool _lastPresenceAvailable;
        private TeamForgeConnectionState _lastPresenceConnectionState = (TeamForgeConnectionState)(-1);

        [MenuItem("Window/TeamForge/Advanced", priority = 150)]
        public static void Open()
        {
            var window = GetWindow<TeamForgeWindow>();
            window.titleContent = new GUIContent("TeamForge");
            window.minSize = new Vector2(450, 680);
        }

        private void OnEnable()
        {
            TeamForgeConnectionService.Changed += OnServiceChanged;
            TeamForgePresenceService.Registry.Changed += OnServiceChanged;
            TeamForgeTransformSyncService.Changed += OnServiceChanged;
            TeamForgeHierarchySyncService.Changed += OnServiceChanged;
            TeamForgeProjectService.Changed += OnServiceChanged;
        }

        private void OnDisable()
        {
            TeamForgeConnectionService.Changed -= OnServiceChanged;
            TeamForgePresenceService.Registry.Changed -= OnServiceChanged;
            TeamForgeTransformSyncService.Changed -= OnServiceChanged;
            TeamForgeHierarchySyncService.Changed -= OnServiceChanged;
            TeamForgeProjectService.Changed -= OnServiceChanged;
        }

        public void CreateGUI()
        {
            var settings = TeamForgeConnectionService.Settings;
            settings.EnsureDefaults();
            _configurationFields.Clear();
            rootVisualElement.Clear();
            rootVisualElement.style.paddingLeft = 10;
            rootVisualElement.style.paddingRight = 10;
            rootVisualElement.style.paddingTop = 8;
            rootVisualElement.style.paddingBottom = 8;

            var scrollView = new ScrollView(ScrollViewMode.Vertical);
            scrollView.style.flexGrow = 1;
            rootVisualElement.Add(scrollView);

            scrollView.Add(CreateTitle("Unity TeamForge", 18));
            var phaseLabel = new Label("Phase 4 · Realtime Collaboration / Hierarchy Synchronization");
            phaseLabel.style.marginBottom = 8;
            scrollView.Add(phaseLabel);

            scrollView.Add(CreateTitle("Connection", 14));
            AddTextField(scrollView, "Advertised Guest Address", settings.ServerAddress, value => settings.ServerAddress = value);
            AddTextField(scrollView, "User Name", settings.UserName, value => settings.UserName = value);
            AddTextField(scrollView, "User Color (#RRGGBB)", settings.UserColorHtml, value => settings.UserColorHtml = value);
            AddTextField(scrollView, "Project ID", settings.ProjectId, value => settings.ProjectId = value);
            AddTextField(scrollView, "Session ID", settings.SessionId, value => settings.SessionId = value);

            var advanced = new Foldout { text = "Advanced", value = false };
            advanced.style.marginTop = 4;
            advanced.style.marginBottom = 8;
            scrollView.Add(advanced);
            AddTextField(advanced, "Coordinator Listen Address", settings.CoordinatorListenHost, value => settings.CoordinatorListenHost = value);
            AddTextField(advanced, "Realtime Path", settings.RealtimePath, value => settings.RealtimePath = value);

            var token = new TextField("Bearer Token")
            {
                value = settings.AuthenticationToken,
                isPasswordField = true,
                isDelayed = true,
                tooltip = "Stored locally in UserSettings as plain text. Do not reuse an account password.",
            };
            token.RegisterValueChangedCallback(evt =>
            {
                settings.AuthenticationToken = evt.newValue ?? string.Empty;
                SaveSettings();
            });
            TrackConfigurationField(advanced, token);

            var timeout = new IntegerField("Connect Timeout (s)") { value = settings.ConnectionTimeoutSeconds };
            timeout.RegisterValueChangedCallback(evt =>
            {
                settings.ConnectionTimeoutSeconds = Mathf.Clamp(evt.newValue, 1, 120);
                timeout.SetValueWithoutNotify(settings.ConnectionTimeoutSeconds);
                SaveSettings();
            });
            TrackConfigurationField(advanced, timeout);

            var reconnect = new Toggle("Auto Reconnect") { value = settings.AutoReconnect };
            reconnect.RegisterValueChangedCallback(evt =>
            {
                settings.AutoReconnect = evt.newValue;
                SaveSettings();
            });
            TrackConfigurationField(advanced, reconnect);

            var maximumDelay = new IntegerField("Max Reconnect Delay (s)")
            {
                value = settings.MaximumReconnectDelaySeconds,
            };
            maximumDelay.RegisterValueChangedCallback(evt =>
            {
                settings.MaximumReconnectDelaySeconds = Mathf.Clamp(evt.newValue, 1, 300);
                maximumDelay.SetValueWithoutNotify(settings.MaximumReconnectDelaySeconds);
                SaveSettings();
            });
            TrackConfigurationField(advanced, maximumDelay);

            var presenceRate = new IntegerField("Presence Updates / s")
            {
                value = settings.PresenceUpdatesPerSecond,
            };
            presenceRate.RegisterValueChangedCallback(evt =>
            {
                settings.PresenceUpdatesPerSecond = Mathf.Clamp(evt.newValue, 1, 20);
                presenceRate.SetValueWithoutNotify(settings.PresenceUpdatesPerSecond);
                SaveSettings();
            });
            TrackConfigurationField(advanced, presenceRate);

            var heartbeat = new IntegerField("Presence Heartbeat (s)")
            {
                value = settings.PresenceHeartbeatSeconds,
            };
            heartbeat.RegisterValueChangedCallback(evt =>
            {
                settings.PresenceHeartbeatSeconds = Mathf.Clamp(evt.newValue, 2, 60);
                heartbeat.SetValueWithoutNotify(settings.PresenceHeartbeatSeconds);
                SaveSettings();
            });
            TrackConfigurationField(advanced, heartbeat);

            var transformRate = new IntegerField("Transform Updates / s")
            {
                value = settings.TransformUpdatesPerSecond,
            };
            transformRate.RegisterValueChangedCallback(evt =>
            {
                settings.TransformUpdatesPerSecond = Mathf.Clamp(evt.newValue, 1, 30);
                transformRate.SetValueWithoutNotify(settings.TransformUpdatesPerSecond);
                SaveSettings();
            });
            TrackConfigurationField(advanced, transformRate);

            var lockRenewal = new IntegerField("Lock Renewal (s)")
            {
                value = settings.LockRenewalSeconds,
            };
            lockRenewal.RegisterValueChangedCallback(evt =>
            {
                settings.LockRenewalSeconds = Mathf.Clamp(evt.newValue, 1, 30);
                lockRenewal.SetValueWithoutNotify(settings.LockRenewalSeconds);
                SaveSettings();
            });
            TrackConfigurationField(advanced, lockRenewal);

            var logLevel = new EnumField("Log Level", settings.LogLevel);
            logLevel.RegisterValueChangedCallback(evt =>
            {
                settings.LogLevel = (TeamForgeLogLevel)evt.newValue;
                TeamForgeDiagnostics.Configure(settings.LogLevel);
                SaveSettings();
            });
            TrackConfigurationField(advanced, logLevel);

            var buttonRow = new VisualElement();
            buttonRow.style.flexDirection = FlexDirection.Row;
            buttonRow.style.marginBottom = 10;
            scrollView.Add(buttonRow);

            _connectButton = new Button(TeamForgeConnectionService.Connect) { text = "Connect" };
            _disconnectButton = new Button(TeamForgeConnectionService.Disconnect) { text = "Disconnect" };
            _pingButton = new Button(() => TeamForgeConnectionService.Ping()) { text = "Ping Now" };
            AddRowButton(buttonRow, _connectButton);
            AddRowButton(buttonRow, _disconnectButton);
            AddRowButton(buttonRow, _pingButton);

            scrollView.Add(CreateTitle("Status", 14));
            _statusValue = AddReadOnlyRow(scrollView, "State");
            _endpointValue = AddReadOnlyRow(scrollView, "Endpoint");
            _rttValue = AddReadOnlyRow(scrollView, "Round Trip");
            _revisionValue = AddReadOnlyRow(scrollView, "Protocol / Revision");
            _messagesValue = AddReadOnlyRow(scrollView, "Messages");
            _reconnectValue = AddReadOnlyRow(scrollView, "Reconnect");
            _presenceStatusValue = AddReadOnlyRow(scrollView, "Presence");
            _transformStatusValue = AddReadOnlyRow(scrollView, "Transform Sync");
            _hierarchyStatusValue = AddReadOnlyRow(scrollView, "Hierarchy Sync");
            _lockStatusValue = AddReadOnlyRow(scrollView, "Selected Lock");

            _errorValue = new Label();
            _errorValue.style.whiteSpace = WhiteSpace.Normal;
            _errorValue.style.marginTop = 6;
            _errorValue.style.marginBottom = 8;
            scrollView.Add(_errorValue);

            var lockButtons = new VisualElement();
            lockButtons.style.flexDirection = FlexDirection.Row;
            lockButtons.style.marginBottom = 8;
            scrollView.Add(lockButtons);
            _requestLockButton = new Button(() => TeamForgeTransformSyncService.RequestSelectedLock())
            {
                text = "Acquire Selected Lock",
            };
            _releaseLockButton = new Button(() => TeamForgeTransformSyncService.ReleaseSelectedLock())
            {
                text = "Release Selected Lock",
            };
            AddRowButton(lockButtons, _requestLockButton);
            AddRowButton(lockButtons, _releaseLockButton);

            scrollView.Add(CreateTitle("Team Members", 14));
            _presenceContainer = new VisualElement();
            _presenceContainer.style.marginBottom = 8;
            scrollView.Add(_presenceContainer);

            scrollView.Add(CreateTitle("Project Bootstrap", 14));
            _projectCapabilityValue = AddReadOnlyRow(scrollView, "Capability");
            _projectBootstrapValue = AddReadOnlyRow(scrollView, "Bootstrap State");
            _projectDownloadValue = AddReadOnlyRow(scrollView, "Download Approval");
            _projectTrustValue = AddReadOnlyRow(scrollView, "Publisher Trust");

            var projectSafety = new Label(
                "Project files never travel through the collaboration WebSocket. The standalone " +
                "project-peer sidecar performs direct transfer into a managed staging directory. " +
                "Review the Publisher fingerprint in the sidecar before approving activation; " +
                "TeamForge will not overwrite this open Unity Project.");
            projectSafety.style.whiteSpace = WhiteSpace.Normal;
            projectSafety.style.marginTop = 5;
            projectSafety.style.marginBottom = 6;
            projectSafety.style.color = new Color(1f, 0.7f, 0.35f);
            scrollView.Add(projectSafety);

            var projectActions = new VisualElement();
            projectActions.style.flexDirection = FlexDirection.Row;
            projectActions.style.marginBottom = 4;
            scrollView.Add(projectActions);
            _importInvitationButton = new Button(ImportProjectInvitation) { text = "Import Invite" };
            _exportPeerSettingsButton = new Button(ExportProjectPeerSettings)
            {
                text = "Export Publish/Seed Settings",
            };
            AddRowButton(projectActions, _importInvitationButton);
            AddRowButton(projectActions, _exportPeerSettingsButton);

            var seedActions = new VisualElement();
            seedActions.style.flexDirection = FlexDirection.Row;
            seedActions.style.marginBottom = 4;
            scrollView.Add(seedActions);
            _selectSeedSourceButton = new Button(SelectCurrentProjectAsSeedSource)
            {
                text = "Use Current Project as Seed Source",
            };
            _clearSeedSourceButton = new Button(TeamForgeProjectService.ClearCurrentProjectSeedSourceSelection)
            {
                text = "Clear Seed Source",
            };
            AddRowButton(seedActions, _selectSeedSourceButton);
            AddRowButton(seedActions, _clearSeedSourceButton);

            var trustActions = new VisualElement();
            trustActions.style.flexDirection = FlexDirection.Row;
            trustActions.style.marginBottom = 6;
            scrollView.Add(trustActions);
            _copyPublisherFingerprintButton = new Button(CopyPublisherFingerprint)
            {
                text = "Copy Publisher Fingerprint",
            };
            _copySyncCommandButton = new Button(CopySidecarSyncCommand)
            {
                text = "Copy Sidecar Sync Command",
            };
            AddRowButton(trustActions, _copyPublisherFingerprintButton);
            AddRowButton(trustActions, _copySyncCommandButton);
            AddRowButton(
                trustActions,
                new Button(TeamForgeProjectService.ReloadDescriptor) { text = "Reload Project Descriptor" });

            var projectDiagnostics = new Foldout
            {
                text = "Project Bootstrap Diagnostics (read-only)",
                value = false,
            };
            projectDiagnostics.style.marginBottom = 8;
            scrollView.Add(projectDiagnostics);
            _projectLocalIdentityValue = AddReadOnlyRow(projectDiagnostics, "Local Descriptor");
            _projectRemoteBaselineValue = AddReadOnlyRow(projectDiagnostics, "Remote Baseline");
            _projectManifestValue = AddReadOnlyRow(projectDiagnostics, "Manifest Hash");
            _projectPeerValue = AddReadOnlyRow(projectDiagnostics, "Preferred Seed");
            _projectProtocolValue = AddReadOnlyRow(projectDiagnostics, "Project Protocols");

            scrollView.Add(CreateTitle("Diagnostics", 14));
            _logField = new TextField
            {
                multiline = true,
                isReadOnly = true,
            };
            _logField.style.height = 150;
            _logField.style.marginBottom = 6;
            scrollView.Add(_logField);

            var diagnosticsButtons = new VisualElement();
            diagnosticsButtons.style.flexDirection = FlexDirection.Row;
            scrollView.Add(diagnosticsButtons);
            AddRowButton(diagnosticsButtons, new Button(TeamForgeDiagnostics.Clear) { text = "Clear Log" });
            AddRowButton(diagnosticsButtons, new Button(ExportDiagnostics) { text = "Export Log" });

            RefreshView();
        }

        private void Update()
        {
            if (EditorApplication.timeSinceStartup < _nextRefreshAt)
            {
                return;
            }

            _nextRefreshAt = EditorApplication.timeSinceStartup + 0.2;
            RefreshView();
        }

        private void OnServiceChanged()
        {
            Repaint();
        }

        private void RefreshView()
        {
            if (_statusValue == null)
            {
                return;
            }

            var serviceState = TeamForgeConnectionService.State;
            _statusValue.text = serviceState.ToString();
            _statusValue.style.color = serviceState == TeamForgeConnectionState.Connected
                ? new Color(0.3f, 0.8f, 0.4f)
                : serviceState == TeamForgeConnectionState.Faulted
                    ? new Color(1f, 0.35f, 0.3f)
                    : Color.white;
            _endpointValue.text = string.IsNullOrWhiteSpace(TeamForgeConnectionService.CurrentEndpoint)
                ? "—"
                : TeamForgeConnectionService.CurrentEndpoint;
            _rttValue.text = TeamForgeConnectionService.LastRoundTripMilliseconds.HasValue
                ? $"{TeamForgeConnectionService.LastRoundTripMilliseconds.Value:F2} ms"
                : "—";
            _revisionValue.text =
                $"v{TeamForgeProtocol.Version} / Session r{TeamForgeTransformSyncService.CurrentRevision}";
            _messagesValue.text = $"TX {TeamForgeConnectionService.MessagesSent} / RX {TeamForgeConnectionService.MessagesReceived}";
            _reconnectValue.text = serviceState == TeamForgeConnectionState.Reconnecting
                ? $"Attempt {TeamForgeConnectionService.ReconnectAttempt}, in {TeamForgeConnectionService.SecondsUntilReconnect:F1}s"
                : "—";
            _presenceStatusValue.text = TeamForgeConnectionService.PresenceAvailable
                ? $"{TeamForgePresenceService.Registry.Count} member(s), local {ShortId(TeamForgePresenceService.LocalUserId)}"
                : serviceState == TeamForgeConnectionState.Connected
                    ? "Not supported by server"
                    : "Offline";
            _transformStatusValue.text = TeamForgeConnectionService.TransformSyncAvailable
                ? $"Enabled · {TeamForgeTransformSyncService.Locks.Count} lock(s) · " +
                  $"{TeamForgeTransformSyncService.SnapshotConflictCount} protected conflict(s)"
                : serviceState == TeamForgeConnectionState.Connected
                    ? "Not supported by server"
                    : "Offline";
            _hierarchyStatusValue.text = TeamForgeConnectionService.HierarchySyncAvailable
                ? $"{TeamForgeHierarchySyncService.Status} · {TeamForgeHierarchySyncService.TrackedObjectCount} object(s) · " +
                  $"{TeamForgeHierarchySyncService.ConflictCount} conflict(s)"
                : serviceState == TeamForgeConnectionState.Connected
                    ? "Not supported by server"
                    : "Offline";
            _lockStatusValue.text = TeamForgeTransformSyncService.SelectedLockStatus;
            var projectState = TeamForgeProjectService.State;
            var descriptor = TeamForgeProjectService.Descriptor;
            var baseline = TeamForgeProjectService.Registry.Baseline;
            var publisherFingerprint = TeamForgeProjectService.PublisherFingerprint;
            _projectCapabilityValue.text = TeamForgeConnectionService.ProjectTransferAvailable
                ? "Enabled · metadata coordination only"
                : serviceState == TeamForgeConnectionState.Connected
                    ? "Not supported by server"
                    : "Offline";
            _projectBootstrapValue.text = ProjectStateSummary(projectState);
            _projectBootstrapValue.style.color =
                projectState == TeamForgeProjectBootstrapState.Ready
                    ? new Color(0.3f, 0.8f, 0.4f)
                    : projectState == TeamForgeProjectBootstrapState.ProjectUuidMismatch ||
                      projectState == TeamForgeProjectBootstrapState.InvitationMismatch ||
                      projectState == TeamForgeProjectBootstrapState.DescriptorInvalid
                        ? new Color(1f, 0.35f, 0.3f)
                        : new Color(1f, 0.7f, 0.35f);
            _projectDownloadValue.text =
                projectState == TeamForgeProjectBootstrapState.ProjectUuidMismatch ||
                projectState == TeamForgeProjectBootstrapState.InvitationMismatch
                    ? $"Blocked for this open Project · use {TeamForgeProjectService.ManagedStagingLocation}"
                    : TeamForgeProjectService.TryGetPreferredSeed(out _)
                        ? $"Run sidecar sync with the signed invite, review fingerprint, then approve · {TeamForgeProjectService.ManagedStagingLocation}"
                        : projectState == TeamForgeProjectBootstrapState.BaselineAvailableNoSeed
                            ? "Published baseline retained · waiting for a verified direct-transfer seed"
                            : projectState == TeamForgeProjectBootstrapState.BaselineUnavailable
                                ? "Waiting for a verified baseline and direct-transfer seed"
                                : "Waiting for a verified direct-transfer seed";
            _projectTrustValue.text = string.IsNullOrWhiteSpace(publisherFingerprint)
                ? "No verified Publisher fingerprint"
                : TeamForgeProjectService.InvitationRequiresSidecarSignatureVerification && baseline == null
                    ? $"Invite Owner {ShortHash(publisherFingerprint)} · sidecar verification" +
                      (TeamForgeProjectService.InvitationRequiresNewAuthentication
                          ? " · new server token required"
                          : string.Empty)
                    : $"Review Publisher {ShortHash(publisherFingerprint)} in project-peer before activation";

            _projectLocalIdentityValue.text = descriptor == null
                ? string.IsNullOrWhiteSpace(TeamForgeProjectService.DescriptorError)
                    ? $"Missing · {TeamForgeProjectContract.DescriptorRelativePath}"
                    : $"Invalid · {TeamForgeProjectService.DescriptorError}"
                : $"{descriptor.projectUuid} · r{descriptor.baselineRevision}" +
                  (TeamForgeProjectService.CurrentProjectSeedSourceSelected ? " · explicit seed source" : string.Empty);
            _projectRemoteBaselineValue.text = baseline == null
                ? "No published baseline"
                : $"{baseline.projectUuid} · r{baseline.baselineRevision} · Publisher {baseline.publisherKeyId}";
            _projectManifestValue.text = baseline?.manifestHash ?? descriptor?.manifestHash ?? "—";
            _projectPeerValue.text = TeamForgeProjectService.TryGetPreferredSeed(out var preferredSeed)
                ? $"rank {preferredSeed.seedRank} · {preferredSeed.userName} · " +
                  $"{preferredSeed.availableChunkCount}/{preferredSeed.totalChunkCount} chunks"
                : $"None · {TeamForgeProjectService.Registry.Count} advertised peer(s)";
            _projectProtocolValue.text =
                $"Realtime v{TeamForgeProtocol.Version} · Transfer v{TeamForgeProjectContract.TransferProtocolVersion} · " +
                $"Manifest v{TeamForgeProjectContract.ManifestSchemaVersion} · Package {TeamForgeProjectContract.ProductVersion}";
            _errorValue.text = string.IsNullOrWhiteSpace(TeamForgeConnectionService.LastError)
                ? string.IsNullOrWhiteSpace(TeamForgeProjectService.LastError)
                    ? "No recent connection or Project Coordinator error."
                    : TeamForgeProjectService.LastError
                : TeamForgeConnectionService.LastError;
            _errorValue.style.color = string.IsNullOrWhiteSpace(TeamForgeConnectionService.LastError) &&
                                      string.IsNullOrWhiteSpace(TeamForgeProjectService.LastError)
                ? new Color(0.65f, 0.65f, 0.65f)
                : new Color(1f, 0.55f, 0.35f);
            _logField.SetValueWithoutNotify(TeamForgeDiagnostics.Snapshot());

            var desired = TeamForgeConnectionService.ConnectionDesired;
            _connectButton.SetEnabled(!desired &&
                                      serviceState != TeamForgeConnectionState.Connecting &&
                                      serviceState != TeamForgeConnectionState.Handshaking &&
                                      serviceState != TeamForgeConnectionState.Connected &&
                                      serviceState != TeamForgeConnectionState.Disconnecting);
            _disconnectButton.SetEnabled(desired ||
                                         serviceState == TeamForgeConnectionState.Connecting ||
                                         serviceState == TeamForgeConnectionState.Handshaking ||
                                         serviceState == TeamForgeConnectionState.Connected ||
                                         serviceState == TeamForgeConnectionState.Reconnecting);
            _pingButton.SetEnabled(serviceState == TeamForgeConnectionState.Connected);
            var hasSelectedTransformTarget =
                TeamForgeConnectionService.TransformSyncAvailable &&
                !TeamForgeTransformSyncService.SelectedObjectBlocked &&
                !string.IsNullOrWhiteSpace(TeamForgeTransformSyncService.SelectedObjectId);
            var hasSelectedLock =
                TeamForgeTransformSyncService.TryGetSelectedLock(out var selectedLock);
            var ownsSelectedLock =
                hasSelectedLock &&
                selectedLock.ownerConnectionId == TeamForgeConnectionService.ConnectionId;
            _requestLockButton.SetEnabled(hasSelectedTransformTarget && !hasSelectedLock);
            _releaseLockButton.SetEnabled(hasSelectedTransformTarget && ownsSelectedLock);

            var configurationEnabled = !desired &&
                                       serviceState != TeamForgeConnectionState.Connecting &&
                                       serviceState != TeamForgeConnectionState.Handshaking &&
                                       serviceState != TeamForgeConnectionState.Connected &&
                                       serviceState != TeamForgeConnectionState.Disconnecting;
            foreach (var field in _configurationFields)
            {
                field.SetEnabled(configurationEnabled);
            }
            _importInvitationButton.SetEnabled(configurationEnabled);
            _exportPeerSettingsButton.SetEnabled(
                TeamForgeProjectService.CurrentProjectSeedSourceSelected &&
                TeamForgeProjectService.TryBuildLaunchSettingsJson(out _, out _));
            var projectIdentityBlocked =
                projectState == TeamForgeProjectBootstrapState.ProjectUuidMismatch ||
                projectState == TeamForgeProjectBootstrapState.InvitationMismatch ||
                projectState == TeamForgeProjectBootstrapState.DescriptorInvalid;
            _selectSeedSourceButton.SetEnabled(
                !projectIdentityBlocked && !TeamForgeProjectService.CurrentProjectSeedSourceSelected);
            _clearSeedSourceButton.SetEnabled(TeamForgeProjectService.CurrentProjectSeedSourceSelected);
            _copyPublisherFingerprintButton.SetEnabled(!string.IsNullOrWhiteSpace(publisherFingerprint));
            _copySyncCommandButton.SetEnabled(TeamForgeProjectService.Invitation != null);

            if (_lastPresenceVersion != TeamForgePresenceService.Registry.Version ||
                _lastPresenceAvailable != TeamForgeConnectionService.PresenceAvailable ||
                _lastPresenceConnectionState != serviceState)
            {
                _lastPresenceVersion = TeamForgePresenceService.Registry.Version;
                _lastPresenceAvailable = TeamForgeConnectionService.PresenceAvailable;
                _lastPresenceConnectionState = serviceState;
                RebuildPresenceList();
            }
        }

        private void RebuildPresenceList()
        {
            if (_presenceContainer == null)
            {
                return;
            }

            _presenceContainer.Clear();
            var members = TeamForgePresenceService.RemoteMembers();
            if (members.Count == 0)
            {
                var empty = new Label(
                    TeamForgeConnectionService.PresenceAvailable
                        ? "No other editors are in this project/session."
                        : "Connect to a Presence-capable server to see teammates.");
                empty.style.color = new Color(0.65f, 0.65f, 0.65f);
                empty.style.whiteSpace = WhiteSpace.Normal;
                _presenceContainer.Add(empty);
                return;
            }

            foreach (var member in members)
            {
                var memberUserId = member.userId;
                var card = new VisualElement();
                card.style.paddingTop = 5;
                card.style.paddingBottom = 6;
                card.style.borderBottomWidth = 1;
                card.style.borderBottomColor = new Color(0.3f, 0.3f, 0.3f);
                _presenceContainer.Add(card);

                var heading = new VisualElement();
                heading.style.flexDirection = FlexDirection.Row;
                heading.style.alignItems = Align.Center;
                card.Add(heading);

                var swatch = new VisualElement();
                swatch.style.width = 10;
                swatch.style.height = 10;
                swatch.style.marginRight = 6;
                if (ColorUtility.TryParseHtmlString(member.color, out var color))
                {
                    swatch.style.backgroundColor = color;
                }
                heading.Add(swatch);

                var name = new Label($"{member.displayName} · {member.activity}");
                name.style.unityFontStyleAndWeight = FontStyle.Bold;
                heading.Add(name);

                var scene = string.IsNullOrWhiteSpace(member.sceneName) ? "Unsaved / no active Scene" : member.sceneName;
                var selection = string.IsNullOrWhiteSpace(member.selectedObjectName) ? "Nothing selected" : member.selectedObjectName;
                var ageSeconds = Math.Max(
                    0,
                    (DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - member.lastHeartbeatUnixMs) / 1000.0);
                var details = new Label($"Scene: {scene}\nSelection: {selection}\nLast update: {ageSeconds:F1}s ago");
                details.style.whiteSpace = WhiteSpace.Normal;
                details.style.marginTop = 2;
                details.style.marginBottom = 3;
                card.Add(details);

                var actions = new VisualElement();
                actions.style.flexDirection = FlexDirection.Row;
                card.Add(actions);

                var frameButton = new Button(() =>
                {
                    if (!TeamForgePresenceService.TryFrameRemoteSelection(memberUserId))
                    {
                        TeamForgeDiagnostics.Warning("The remote selection is not available in the loaded local Scene.");
                    }
                }) { text = "Frame Selection" };
                frameButton.SetEnabled(!string.IsNullOrWhiteSpace(member.selectedObjectId));
                AddRowButton(actions, frameButton);

                var cameraButton = new Button(() =>
                {
                    if (!TeamForgePresenceService.TryMoveToRemoteCamera(memberUserId))
                    {
                        TeamForgeDiagnostics.Warning("The teammate has no usable Scene View camera state.");
                    }
                }) { text = "Go to Camera" };
                cameraButton.SetEnabled(member.hasSceneView);
                AddRowButton(actions, cameraButton);
            }
        }

        private void ImportProjectInvitation()
        {
            var path = EditorUtility.OpenFilePanel("Import TeamForge Project Invitation", string.Empty, "json");
            if (string.IsNullOrWhiteSpace(path))
            {
                return;
            }

            string json;
            try
            {
                var information = new FileInfo(path);
                if (information.Length <= 0 || information.Length > 65536 ||
                    (information.Attributes & FileAttributes.ReparsePoint) != 0)
                {
                    EditorUtility.DisplayDialog(
                        "TeamForge Project Invitation",
                        "The invitation is empty, too large, or uses an unsupported link.",
                        "OK");
                    return;
                }
                json = File.ReadAllText(path, Encoding.UTF8);
            }
            catch (Exception exception)
            {
                EditorUtility.DisplayDialog(
                    "TeamForge Project Invitation",
                    $"The invitation could not be read safely ({exception.GetType().Name}).",
                    "OK");
                return;
            }

            if (!TeamForgeProjectService.TryParseInvitation(json, out var invitation, out var error))
            {
                EditorUtility.DisplayDialog("TeamForge Project Invitation", error, "OK");
                return;
            }

            var accepted = EditorUtility.DisplayDialog(
                "Apply TeamForge Project Invitation?",
                $"Project: {invitation.projectId}\n" +
                $"Session: {invitation.sessionId}\n" +
                $"Project UUID: {ShortHash(invitation.projectUuid)}\n" +
                $"Owner fingerprint: {ShortHash(invitation.ownerKeyId)}\n\n" +
                "Only the server/project/session fields and expected public identity are imported. " +
                "Unity validates the invite shape and Owner key fingerprint; project-peer must verify the " +
                "Ed25519 invitation signature before download. No token, private key, or local path is " +
                "accepted, and the open Project is never overwritten. The existing Bearer Token is cleared " +
                "so it cannot be sent to the invited server, and Unity will not connect automatically.",
                "Apply",
                "Cancel");
            if (!accepted)
            {
                return;
            }

            if (!TeamForgeProjectService.TryApplyInvitation(invitation, out error))
            {
                EditorUtility.DisplayDialog("TeamForge Project Invitation", error, "OK");
                return;
            }

            EditorUtility.DisplayDialog(
                "TeamForge Project Invitation",
                "Invitation settings were applied while disconnected. The previous Bearer Token was cleared. " +
                "Verify the invite in project-peer, enter a token issued for the invited server if required, " +
                "then connect manually.",
                "OK");

            EditorApplication.delayCall += () =>
            {
                if (this != null)
                {
                    CreateGUI();
                }
            };
        }

        private static void ExportProjectPeerSettings()
        {
            if (!TeamForgeProjectService.TryBuildLaunchSettingsJson(out var json, out var error))
            {
                EditorUtility.DisplayDialog("TeamForge project-peer", error, "OK");
                return;
            }

            var path = EditorUtility.SaveFilePanel(
                "Export TeamForge project-peer Launch Settings",
                CurrentProjectRootForDialog(),
                "teamforge-project-peer.launch.json",
                "json");
            if (string.IsNullOrWhiteSpace(path))
            {
                return;
            }

            if (TeamForgeProjectService.CurrentProjectSeedSourceSelected &&
                !IsFileInCurrentProjectRoot(path))
            {
                EditorUtility.DisplayDialog(
                    "TeamForge project-peer",
                    "Seed launch settings use paths relative to the settings file. Save this file directly in " +
                    "the Unity Project root so '.' identifies the explicitly selected source Project.",
                    "OK");
                return;
            }

            try
            {
                File.WriteAllText(path, json, new UTF8Encoding(false));
                EditorUtility.DisplayDialog(
                    "TeamForge project-peer",
                    "Secret-free sidecar settings were exported. Provide authentication and Owner keys " +
                    "to project-peer through its documented environment/configuration; Unity did not export them. " +
                    "All relative paths are resolved from the exported settings file's directory. Run " +
                    "'teamforge-project-peer publish --launch-settings <file>' or the equivalent seed command.",
                    "OK");
            }
            catch (Exception exception)
            {
                EditorUtility.DisplayDialog(
                    "TeamForge project-peer",
                    $"Sidecar settings could not be exported ({exception.GetType().Name}).",
                    "OK");
            }
        }

        private static void SelectCurrentProjectAsSeedSource()
        {
            var accepted = EditorUtility.DisplayDialog(
                "Use Current Project as Seed Source?",
                "This explicit opt-in creates or reads only ProjectSettings/TeamForgeProject.json and marks " +
                "the current Project as a potential source. Unity does not scan, upload, sign, publish, or " +
                "start a transfer. Those operations happen only when you separately run the project-peer sidecar.",
                "Select Source",
                "Cancel");
            if (!accepted)
            {
                return;
            }

            if (!TeamForgeProjectService.TrySelectCurrentProjectAsSeedSource(out var error))
            {
                EditorUtility.DisplayDialog("TeamForge Project Seed", error, "OK");
            }
        }

        private static void CopyPublisherFingerprint()
        {
            var fingerprint = TeamForgeProjectService.PublisherFingerprint;
            if (string.IsNullOrWhiteSpace(fingerprint))
            {
                return;
            }

            EditorGUIUtility.systemCopyBuffer = fingerprint;
            TeamForgeDiagnostics.Info(
                TeamForgeProjectService.InvitationRequiresSidecarSignatureVerification &&
                TeamForgeProjectService.Registry.Baseline == null
                    ? "Copied the Invite Owner key ID. The invitation signature still requires sidecar verification."
                    : "Copied the Coordinator Publisher fingerprint. Compare it out-of-band before sidecar activation.");
        }

        private static void CopySidecarSyncCommand()
        {
            if (TeamForgeProjectService.Invitation == null)
            {
                return;
            }

            EditorGUIUtility.systemCopyBuffer =
                "teamforge-project-peer sync --invite teamforge-project.invite.json";
            TeamForgeDiagnostics.Info(
                "Copied a secret-free sidecar sync command. Replace the invite filename if needed; " +
                "project-peer performs the Ed25519 verification and trust approval.");
        }

        private static string CurrentProjectRootForDialog()
        {
            try
            {
                return Directory.GetParent(Application.dataPath)?.FullName ?? string.Empty;
            }
            catch
            {
                return string.Empty;
            }
        }

        private static bool IsFileInCurrentProjectRoot(string filePath)
        {
            try
            {
                var expected = Path.GetFullPath(CurrentProjectRootForDialog())
                    .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
                var actual = Path.GetFullPath(Path.GetDirectoryName(filePath) ?? string.Empty)
                    .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
                var comparison = Application.platform == RuntimePlatform.WindowsEditor
                    ? StringComparison.OrdinalIgnoreCase
                    : StringComparison.Ordinal;
                return string.Equals(expected, actual, comparison);
            }
            catch
            {
                return false;
            }
        }

        private static string ProjectStateSummary(TeamForgeProjectBootstrapState state)
        {
            switch (state)
            {
                case TeamForgeProjectBootstrapState.Offline:
                    return "Offline · import an invite or connect";
                case TeamForgeProjectBootstrapState.CapabilityUnavailable:
                    return "Server has no Project Transfer capability";
                case TeamForgeProjectBootstrapState.DescriptorMissing:
                    return "Local descriptor missing · managed download is available";
                case TeamForgeProjectBootstrapState.DescriptorInvalid:
                    return "Local descriptor rejected · current Project is protected";
                case TeamForgeProjectBootstrapState.WaitingForRegistry:
                    return "Waiting for Project registry snapshot";
                case TeamForgeProjectBootstrapState.BaselineUnavailable:
                    return "No verified baseline has been published";
                case TeamForgeProjectBootstrapState.BaselineAvailableNoSeed:
                    return "Verified baseline exists · no direct seed is online";
                case TeamForgeProjectBootstrapState.Ready:
                    return "Identity and baseline metadata match";
                case TeamForgeProjectBootstrapState.SyncRequired:
                    return string.IsNullOrWhiteSpace(TeamForgeProjectService.SyncReason)
                        ? "Managed staging sync required"
                        : $"Managed staging sync required · {TeamForgeProjectService.SyncReason}";
                case TeamForgeProjectBootstrapState.ProjectUuidMismatch:
                    return "Project UUID mismatch · never overwrite this open Project";
                case TeamForgeProjectBootstrapState.InvitationMismatch:
                    return "Invitation identity mismatch · download/activation blocked";
                default:
                    return state.ToString();
            }
        }

        private static string ShortHash(string value)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                return "—";
            }
            return value.Length <= 16 ? value : $"{value.Substring(0, 8)}…{value.Substring(value.Length - 8)}";
        }

        private static string ShortId(string value)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                return "—";
            }
            return value.Length <= 8 ? value : value.Substring(0, 8);
        }

        private static Label CreateTitle(string text, int size)
        {
            var label = new Label(text);
            label.style.fontSize = size;
            label.style.unityFontStyleAndWeight = FontStyle.Bold;
            label.style.marginTop = 4;
            label.style.marginBottom = 4;
            return label;
        }

        private void AddTextField(VisualElement parent, string label, string initialValue, Action<string> assign)
        {
            var field = new TextField(label)
            {
                value = initialValue ?? string.Empty,
                isDelayed = true,
            };
            field.RegisterValueChangedCallback(evt =>
            {
                assign(evt.newValue ?? string.Empty);
                SaveSettings();
            });
            TrackConfigurationField(parent, field);
        }

        private void TrackConfigurationField(VisualElement parent, VisualElement field)
        {
            field.style.marginBottom = 3;
            parent.Add(field);
            _configurationFields.Add(field);
        }

        private static void AddRowButton(VisualElement row, Button button)
        {
            button.style.flexGrow = 1;
            button.style.marginRight = 4;
            row.Add(button);
        }

        private static Label AddReadOnlyRow(VisualElement parent, string name)
        {
            var row = new VisualElement();
            row.style.flexDirection = FlexDirection.Row;
            row.style.marginBottom = 2;
            parent.Add(row);

            var key = new Label(name);
            key.style.width = 125;
            key.style.unityFontStyleAndWeight = FontStyle.Bold;
            row.Add(key);

            var value = new Label("—");
            value.style.flexGrow = 1;
            value.style.whiteSpace = WhiteSpace.Normal;
            row.Add(value);
            return value;
        }

        private static void SaveSettings()
        {
            TeamForgeConnectionService.Settings.SaveSettings();
        }

        private static void ExportDiagnostics()
        {
            var path = EditorUtility.SaveFilePanel(
                "Export TeamForge Diagnostics",
                string.Empty,
                $"teamforge-diagnostics-{DateTime.Now:yyyyMMdd-HHmmss}.log",
                "log");
            if (string.IsNullOrWhiteSpace(path))
            {
                return;
            }

            try
            {
                var header =
                    $"Unity TeamForge diagnostics{Environment.NewLine}" +
                    $"UTC: {DateTime.UtcNow:O}{Environment.NewLine}" +
                    $"State: {TeamForgeConnectionService.State}{Environment.NewLine}" +
                    $"Endpoint: {TeamForgeConnectionService.CurrentEndpoint}{Environment.NewLine}" +
                    $"Protocol: {TeamForgeProtocol.Version}{Environment.NewLine}" +
                    $"Server: {TeamForgeConnectionService.ServerVersion}{Environment.NewLine}" +
                    $"Session revision: {TeamForgeTransformSyncService.CurrentRevision}{Environment.NewLine}" +
                    $"Transform Sync: {TeamForgeConnectionService.TransformSyncAvailable}{Environment.NewLine}" +
                    $"Hierarchy Sync: {TeamForgeConnectionService.HierarchySyncAvailable} · {TeamForgeHierarchySyncService.Status} · objects {TeamForgeHierarchySyncService.TrackedObjectCount} · tombstones {TeamForgeHierarchySyncService.TombstoneCount} · conflicts {TeamForgeHierarchySyncService.ConflictCount}{Environment.NewLine}" +
                    $"Project Transfer: {TeamForgeConnectionService.ProjectTransferAvailable}{Environment.NewLine}" +
                    $"Project Bootstrap: {TeamForgeProjectService.State}{Environment.NewLine}" +
                    $"Project Protocols: realtime {TeamForgeProtocol.Version}, transfer {TeamForgeProjectContract.TransferProtocolVersion}, manifest {TeamForgeProjectContract.ManifestSchemaVersion}{Environment.NewLine}" +
                    $"Project trust fingerprint: {TeamForgeProjectService.PublisherFingerprint}{Environment.NewLine}" +
                    $"Invite signature requires sidecar: {TeamForgeProjectService.InvitationRequiresSidecarSignatureVerification}{Environment.NewLine}" +
                    $"Selected lock: {TeamForgeTransformSyncService.SelectedLockStatus}{Environment.NewLine}" +
                    $"Messages: TX {TeamForgeConnectionService.MessagesSent} / RX {TeamForgeConnectionService.MessagesReceived}{Environment.NewLine}" +
                    $"Last error: {TeamForgeConnectionService.LastError}{Environment.NewLine}{Environment.NewLine}";
                File.WriteAllText(path, header + TeamForgeDiagnostics.Snapshot());
            }
            catch (Exception exception)
            {
                TeamForgeDiagnostics.Error($"Could not export diagnostics: {exception.Message}");
            }
        }
    }
}

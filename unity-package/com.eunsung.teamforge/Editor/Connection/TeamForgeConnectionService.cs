using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;
using UnityEditor;

namespace EunSung.TeamForge
{
    public enum TeamForgeConnectionState
    {
        Disconnected,
        Connecting,
        Handshaking,
        Connected,
        Reconnecting,
        Disconnecting,
        Faulted,
    }

    [InitializeOnLoad]
    public static class TeamForgeConnectionService
    {
        private const int MaximumMainThreadActionsPerUpdate = 256;
        private const int MaximumQueuedMainThreadActions = 4096;

        private static readonly ConcurrentQueue<Action> MainThreadActions = new ConcurrentQueue<Action>();
        private static readonly Dictionary<string, long> PendingPings = new Dictionary<string, long>();
        private static readonly IConnectionStrategy ConnectionStrategy = new LegacyServerStrategy();
        private static readonly IRealtimeTransportFactory TransportFactory = new WebSocketTransportFactory();

        private static IRealtimeTransport _transport;
        private static int _connectionEpoch;
        private static int _reconnectAttempt;
        private static bool _connectionDesired;
        private static bool _editorIsShuttingDown;
        private static DateTime _nextReconnectUtc;
        private static DateTime _handshakeDeadlineUtc;
        private static string _helloRequestId = string.Empty;
        private static int _queuedMainThreadActions;
        private static int _mainThreadQueueOverflowed;
        private static bool _resumeAfterAssemblyReloadPending;
        // Explicit Test Lab-only opt-in. Never persisted or carried across assembly reload.
        private static bool _componentPreviewOptInForTestLab;
        private static bool _componentDeclarationOptInForTestLab;
        private static bool _componentDeclarationOffered;
        private static string _componentDeclarationPendingRequestId = string.Empty;
        private static DateTime _componentDeclarationPendingDeadlineUtc;
        private static bool _componentPreviewOffered;
        private static string _componentPreviewPendingRequestId = string.Empty;
        private static string _componentPreviewPendingSceneId = string.Empty;
        private static DateTime _componentPreviewPendingDeadlineUtc;
        private static long _componentPreviewPendingKnownRevision;
        private static string _componentPreviewPendingKnownFingerprint = string.Empty;
        private static string _componentPreviewCachedSceneId = string.Empty;
        private static long _componentPreviewCachedRevision;
        private static string _componentPreviewCachedFingerprint = string.Empty;

        static TeamForgeConnectionService()
        {
            Settings.EnsureDefaults();
            TeamForgeDiagnostics.Configure(Settings.LogLevel);

            EditorApplication.update += Update;
            EditorApplication.quitting += OnEditorQuitting;
            AssemblyReloadEvents.beforeAssemblyReload += BeforeAssemblyReload;

            if (Settings.ResumeAfterAssemblyReload && ResolvedProfile.Connection.AutoReconnect)
            {
                _resumeAfterAssemblyReloadPending = true;
                Settings.ResumeAfterAssemblyReload = false;
                Settings.SaveSettings();
                EditorApplication.delayCall += ResumeAfterAssemblyReload;
            }
        }

        public static event Action Changed;
        internal static event Action Disconnecting;
        internal static event Action<string, string> PresenceMessageReceived;
        internal static event Action<string, string> TransformMessageReceived;
        internal static event Action<string, string> HierarchyMessageReceived;
        internal static event Action<string, string> ProjectMessageReceived;
        internal static event Action<ProtocolErrorMessage> ProtocolErrorReceived;

        public static TeamForgeConnectionSettings Settings => TeamForgeConnectionSettings.instance;
        internal static TeamForgeProfile ResolvedProfile => TeamForgeProfile.ResolveLegacy(Settings);
        public static TeamForgeConnectionState State { get; private set; } = TeamForgeConnectionState.Disconnected;
        public static bool ConnectionDesired => _connectionDesired;
        public static string CurrentEndpoint { get; private set; } = string.Empty;
        public static string ConnectionId { get; private set; } = string.Empty;
        public static string ServerVersion { get; private set; } = string.Empty;
        public static bool PresenceAvailable { get; private set; }
        public static bool TransformSyncAvailable { get; private set; }
        public static bool HierarchySyncAvailable { get; private set; }
        public static bool ComponentRecoveryPreviewAvailable { get; private set; }
        public static bool ComponentDeclarationPreviewAvailable { get; private set; }
        public static bool ComponentDeclarationOptInForTestLab => _componentDeclarationOptInForTestLab;
        public static string ComponentDeclarationPreviewStatus { get; private set; } =
            "OFF — first-Editor Collider declaration not requested.";
        public static bool ComponentRecoveryPreviewOptInForTestLab => _componentPreviewOptInForTestLab;
        public static string ComponentRecoveryPreviewStatus { get; private set; } =
            "OFF — WP6 read-only recovery preview not requested.";
        public static bool ProjectTransferAvailable { get; private set; }
        public static string LastError { get; private set; } = string.Empty;
        public static double? LastRoundTripMilliseconds { get; private set; }
        public static long MessagesSent { get; private set; }
        public static long MessagesReceived { get; private set; }
        public static int ReconnectAttempt => _reconnectAttempt;

        public static double SecondsUntilReconnect
        {
            get
            {
                if (State != TeamForgeConnectionState.Reconnecting)
                {
                    return 0;
                }

                return Math.Max(0, (_nextReconnectUtc - DateTime.UtcNow).TotalSeconds);
            }
        }

        public static void Connect()
        {
            if (_editorIsShuttingDown ||
                State == TeamForgeConnectionState.Connecting ||
                State == TeamForgeConnectionState.Handshaking ||
                State == TeamForgeConnectionState.Connected ||
                State == TeamForgeConnectionState.Disconnecting)
            {
                return;
            }

            Settings.SaveSettings();
            _resumeAfterAssemblyReloadPending = false;
            TeamForgeDiagnostics.Configure(Settings.LogLevel);

            if (!TryValidateSettings(out _, out var error))
            {
                _connectionDesired = false;
                LastError = error;
                SetState(TeamForgeConnectionState.Faulted);
                TeamForgeDiagnostics.Error(error);
                return;
            }

            _connectionDesired = true;
            _reconnectAttempt = 0;
            LastError = string.Empty;
            LastRoundTripMilliseconds = null;
            BeginConnect(false);
        }

        public static void Disconnect()
        {
            if (State == TeamForgeConnectionState.Connected && _transport != null)
            {
                try
                {
                    Disconnecting?.Invoke();
                }
                catch (Exception exception)
                {
                    TeamForgeDiagnostics.Error($"Disconnect preflight failed: {exception.Message}");
                }
            }

            _connectionDesired = false;
            TeamForgeConnectionSettings.ClearTestLabGuestAuthenticationOverride();
            Settings.ResumeAfterAssemblyReload = false;
            _resumeAfterAssemblyReloadPending = false;
            Settings.SaveSettings();
            PendingPings.Clear();
            _helloRequestId = string.Empty;
            PresenceAvailable = false;
            TransformSyncAvailable = false;
            HierarchySyncAvailable = false;
            ComponentRecoveryPreviewAvailable = false;
            ComponentDeclarationPreviewAvailable = false;
            _componentDeclarationOffered = false;
            _componentDeclarationPendingRequestId = string.Empty;
            _componentDeclarationPendingDeadlineUtc = default;
            _componentPreviewOffered = false;
            _componentPreviewPendingRequestId = string.Empty;
            _componentPreviewPendingSceneId = string.Empty;
            _componentPreviewPendingDeadlineUtc = default;
            _componentPreviewPendingKnownRevision = 0;
            _componentPreviewPendingKnownFingerprint = string.Empty;
            _componentPreviewCachedSceneId = string.Empty;
            _componentPreviewCachedRevision = 0;
            _componentPreviewCachedFingerprint = string.Empty;
            ProjectTransferAvailable = false;

            var transport = _transport;
            _transport = null;
            var disconnectEpoch = ++_connectionEpoch;

            if (transport == null)
            {
                ConnectionId = string.Empty;
                SetState(TeamForgeConnectionState.Disconnected);
                return;
            }

            SetState(TeamForgeConnectionState.Disconnecting);
            _ = FinishDisconnectAsync(transport, disconnectEpoch);
        }

        public static bool Ping()
        {
            if (State != TeamForgeConnectionState.Connected || _transport == null)
            {
                return false;
            }

            if (PendingPings.Count >= 16)
            {
                PendingPings.Clear();
                TeamForgeDiagnostics.Warning("Pending Ping table was reset after reaching its safety limit.");
            }

            var requestId = Guid.NewGuid().ToString("N");
            PendingPings[requestId] = Stopwatch.GetTimestamp();
            var ping = new PingMessage
            {
                type = "ping",
                protocolVersion = TeamForgeProtocol.Version,
                requestId = requestId,
                clientTimestampUnixMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            };

            SendMessage(ping, _connectionEpoch, "Ping");
            return true;
        }

        private static void BeginConnect(bool isReconnect)
        {
            if (!_connectionDesired || _editorIsShuttingDown)
            {
                return;
            }

            if (!TryValidateSettings(out var attempts, out var error))
            {
                _connectionDesired = false;
                LastError = error;
                SetState(TeamForgeConnectionState.Faulted);
                TeamForgeDiagnostics.Error(error);
                return;
            }

            _transport?.Dispose();
            var attempt = attempts[0];
            var transport = TransportFactory.Create(attempt);
            var epoch = ++_connectionEpoch;
            _transport = transport;
            CurrentEndpoint = attempt.Endpoint.ToString();
            ConnectionId = string.Empty;
            ServerVersion = string.Empty;
            PresenceAvailable = false;
            TransformSyncAvailable = false;
            HierarchySyncAvailable = false;
            ComponentRecoveryPreviewAvailable = false;
            ComponentDeclarationPreviewAvailable = false;
            _componentDeclarationOffered = false;
            _componentDeclarationPendingRequestId = string.Empty;
            _componentDeclarationPendingDeadlineUtc = default;
            _componentPreviewOffered = false;
            _componentPreviewPendingRequestId = string.Empty;
            _componentPreviewPendingSceneId = string.Empty;
            _componentPreviewPendingDeadlineUtc = default;
            _componentPreviewPendingKnownRevision = 0;
            _componentPreviewPendingKnownFingerprint = string.Empty;
            _componentPreviewCachedSceneId = string.Empty;
            _componentPreviewCachedRevision = 0;
            _componentPreviewCachedFingerprint = string.Empty;
            ProjectTransferAvailable = false;

            transport.Connected += () => Enqueue(() => OnTransportConnected(epoch, transport));
            transport.TextReceived += text => Enqueue(() => OnTextReceived(epoch, transport, text));
            transport.Closed += reason => Enqueue(() => OnTransportClosed(epoch, transport, reason));
            transport.Faulted += exception => Enqueue(() => OnTransportFaulted(epoch, transport, exception));

            // Reconnecting means "waiting for the backoff timer". Once an actual socket
            // attempt starts, move to Connecting so Update cannot start overlapping attempts.
            SetState(TeamForgeConnectionState.Connecting);
            TeamForgeDiagnostics.Info(
                isReconnect
                    ? $"Starting reconnect attempt {_reconnectAttempt} to {CurrentEndpoint}."
                    : $"Connecting to {CurrentEndpoint}.");
            _ = ConnectTransportAsync(transport, epoch);
        }

        private static async Task ConnectTransportAsync(IRealtimeTransport transport, int epoch)
        {
            var connectionTimeoutSeconds = ResolvedProfile.Connection.ConnectionTimeoutSeconds;
            using (var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(connectionTimeoutSeconds)))
            {
                try
                {
                    await transport.ConnectAsync(timeout.Token);
                }
                catch (OperationCanceledException)
                {
                    Enqueue(() =>
                        OnConnectAttemptFailed(
                            epoch,
                            transport,
                            $"Connection timed out after {connectionTimeoutSeconds} seconds."));
                }
                catch (Exception exception)
                {
                    Enqueue(() => OnConnectAttemptFailed(epoch, transport, exception.Message));
                }
            }
        }

        private static void OnTransportConnected(int epoch, IRealtimeTransport transport)
        {
            if (!IsCurrent(epoch, transport))
            {
                return;
            }

            SetState(TeamForgeConnectionState.Handshaking);
            _handshakeDeadlineUtc = DateTime.UtcNow.AddSeconds(
                ResolvedProfile.Connection.ConnectionTimeoutSeconds);
            _helloRequestId = Guid.NewGuid().ToString("N");

            _componentPreviewOffered = _componentPreviewOptInForTestLab;
            _componentDeclarationOffered =
                _componentPreviewOffered && _componentDeclarationOptInForTestLab;
            HelloMessage hello = _componentDeclarationOffered
                ? new ComponentDeclarationPreviewHelloMessage()
                : _componentPreviewOffered
                    ? new ComponentRecoveryPreviewHelloMessage()
                    : new HelloMessage();
            hello.type = "hello";
            hello.protocolVersion = TeamForgeProtocol.Version;
            hello.requestId = _helloRequestId;
            hello.userName = Settings.UserName.Trim();
            hello.projectId = Settings.ProjectId.Trim();
            hello.sessionId = Settings.SessionId.Trim();
            hello.supportsPresence = true;
            hello.supportsTransformSync = true;
            hello.supportsHierarchySync = true;
            hello.supportsProjectTransfer = true;
            hello.userId = Settings.UserId.Trim();
            hello.userColor = Settings.UserColorHtml.Trim().ToUpperInvariant();

            TeamForgeDiagnostics.Trace("WebSocket open; sending protocol Hello.");
            SendMessage(hello, epoch, "Hello");
        }

        private static void OnTextReceived(int epoch, IRealtimeTransport transport, string text)
        {
            if (!IsCurrent(epoch, transport))
            {
                return;
            }

            MessagesReceived += 1;
            if (!TeamForgeProtocol.TryReadEnvelope(text, out var envelope, out var error))
            {
                HandleConnectionLoss(epoch, transport, error, false);
                return;
            }

            try
            {
                switch (envelope.type)
                {
                    case "hello_ack":
                        HandleHelloAck(epoch, transport, text);
                        break;
                    case "pong":
                        HandlePong(text);
                        break;
                    case "component_recovery_preview":
                        HandleComponentRecoveryPreview(epoch, transport, text);
                        break;
                    case "component_declaration_preview_accepted":
                        HandleComponentDeclarationAccepted(epoch, transport, text);
                        break;
                    case "presence_snapshot":
                    case "user_joined":
                    case "presence_updated":
                    case "user_left":
                        if (State != TeamForgeConnectionState.Connected || !PresenceAvailable)
                        {
                            HandleConnectionLoss(
                                epoch,
                                transport,
                                "Server sent Presence data before the capability was negotiated.",
                                false);
                            return;
                        }
                        PresenceMessageReceived?.Invoke(envelope.type, text);
                        break;
                    case "transform_snapshot":
                    case "transform_applied":
                    case "lock_granted":
                    case "lock_denied":
                    case "lock_state_changed":
                    case "lock_released":
                        if (State != TeamForgeConnectionState.Connected || !TransformSyncAvailable)
                        {
                            HandleConnectionLoss(
                                epoch,
                                transport,
                                "Server sent Transform data before the capability was negotiated.",
                                false);
                            return;
                        }
                        TransformMessageReceived?.Invoke(envelope.type, text);
                        break;
                    case "hierarchy_snapshot":
                    case "hierarchy_seed_accepted":
                    case "hierarchy_applied":
                    case "hierarchy_conflict":
                        if (State != TeamForgeConnectionState.Connected || !HierarchySyncAvailable)
                        {
                            HandleConnectionLoss(
                                epoch,
                                transport,
                                "Server sent Hierarchy data before the capability was negotiated.",
                                false);
                            return;
                        }
                        HierarchyMessageReceived?.Invoke(envelope.type, text);
                        break;
                    case "project_registry_snapshot":
                    case "project_peer_joined":
                    case "project_peer_updated":
                    case "project_peer_left":
                    case "project_baseline_changed":
                    case "project_sync_required":
                        if (State != TeamForgeConnectionState.Connected || !ProjectTransferAvailable)
                        {
                            HandleConnectionLoss(
                                epoch,
                                transport,
                                "Server sent Project Coordinator data before the capability was negotiated.",
                                false);
                            return;
                        }
                        ProjectMessageReceived?.Invoke(envelope.type, text);
                        break;
                    case "error":
                        HandleProtocolError(epoch, transport, text);
                        break;
                    default:
                        TeamForgeDiagnostics.Warning($"Ignored unsupported server message type '{envelope.type}'.");
                        break;
                }
            }
            catch (Exception exception)
            {
                HandleConnectionLoss(
                    epoch,
                    transport,
                    $"Server message could not be decoded safely: {exception.Message}",
                    false);
                return;
            }

            RaiseChanged();
        }

        private static void HandleHelloAck(int epoch, IRealtimeTransport transport, string text)
        {
            var acknowledgement = TeamForgeProtocol.Deserialize<HelloAckMessage>(text);
            if (State != TeamForgeConnectionState.Handshaking ||
                acknowledgement == null ||
                acknowledgement.requestId != _helloRequestId ||
                string.IsNullOrWhiteSpace(acknowledgement.connectionId) ||
                acknowledgement.connectionId.Length > 128 ||
                (acknowledgement.serverVersion?.Length ?? 0) > 64 ||
                ((acknowledgement.presenceEnabled || acknowledgement.projectTransferEnabled) &&
                 acknowledgement.userId != Settings.UserId.Trim()) ||
                (acknowledgement.transformSyncEnabled && !acknowledgement.presenceEnabled) ||
                (acknowledgement.hierarchySyncEnabled &&
                 (!acknowledgement.presenceEnabled || !acknowledgement.transformSyncEnabled)) ||
                (acknowledgement.componentRecoveryPreviewEnabled &&
                 (!_componentPreviewOffered || !acknowledgement.hierarchySyncEnabled)) ||
                (acknowledgement.componentDeclarationPreviewEnabled &&
                 (!_componentDeclarationOffered ||
                  !acknowledgement.componentRecoveryPreviewEnabled)))
            {
                HandleConnectionLoss(epoch, transport, "Invalid or uncorrelated Hello acknowledgement.", false);
                return;
            }

            ConnectionId = acknowledgement.connectionId;
            ServerVersion = acknowledgement.serverVersion ?? string.Empty;
            PresenceAvailable = acknowledgement.presenceEnabled;
            TransformSyncAvailable = acknowledgement.transformSyncEnabled;
            HierarchySyncAvailable = acknowledgement.hierarchySyncEnabled;
            ComponentRecoveryPreviewAvailable = _componentPreviewOffered &&
                acknowledgement.componentRecoveryPreviewEnabled;
            ComponentDeclarationPreviewAvailable = _componentDeclarationOffered &&
                acknowledgement.componentDeclarationPreviewEnabled;
            ComponentDeclarationPreviewStatus = ComponentDeclarationPreviewAvailable
                ? "NEGOTIATED — first-Editor read-only Collider declaration allowed."
                : _componentDeclarationOffered
                    ? "DENIED — server disabled the Collider declaration preview."
                    : "OFF — first-Editor Collider declaration not requested.";
            ComponentRecoveryPreviewStatus = ComponentRecoveryPreviewAvailable
                ? "NEGOTIATED — read-only preview enabled; no Inspector edits or Unity Scene changes."
                : _componentPreviewOffered
                    ? "DENIED — server did not enable the experimental recovery preview."
                    : "OFF — WP6 read-only recovery preview not requested.";
            ProjectTransferAvailable = acknowledgement.projectTransferEnabled;
            _helloRequestId = string.Empty;
            _reconnectAttempt = 0;
            LastError = string.Empty;
            SetState(TeamForgeConnectionState.Connected);
            TeamForgeDiagnostics.Info($"Connected. Server {ServerVersion}, connection {ConnectionId}.");
            if (!PresenceAvailable)
            {
                TeamForgeDiagnostics.Warning("The connected server did not negotiate Presence; Phase 0 Ping/Pong remains available.");
            }
            else if (!TransformSyncAvailable)
            {
                TeamForgeDiagnostics.Warning("The connected server did not negotiate Transform Sync; Phase 1 Presence remains available.");
            }
            else if (!HierarchySyncAvailable)
            {
                TeamForgeDiagnostics.Warning("The connected server did not negotiate Hierarchy Sync; Phase 0-3 behavior remains available.");
            }
            if (!ProjectTransferAvailable)
            {
                TeamForgeDiagnostics.Warning(
                    "The connected server did not negotiate Project Transfer; Phase 0-2 collaboration remains available.");
            }
            Ping();
        }

        private static void HandlePong(string text)
        {
            var pong = TeamForgeProtocol.Deserialize<PongMessage>(text);
            if (pong == null || string.IsNullOrWhiteSpace(pong.requestId) ||
                !PendingPings.TryGetValue(pong.requestId, out var startedAt))
            {
                TeamForgeDiagnostics.Warning("Ignored an uncorrelated Pong.");
                return;
            }

            PendingPings.Remove(pong.requestId);
            var elapsedTicks = Stopwatch.GetTimestamp() - startedAt;
            LastRoundTripMilliseconds = elapsedTicks * 1000.0 / Stopwatch.Frequency;
            TeamForgeDiagnostics.Trace($"Pong received in {LastRoundTripMilliseconds.Value:F2} ms.");
        }

        private static void HandleProtocolError(int epoch, IRealtimeTransport transport, string text)
        {
            var protocolError = TeamForgeProtocol.Deserialize<ProtocolErrorMessage>(text);
            if (protocolError != null &&
                !string.IsNullOrEmpty(_componentDeclarationPendingRequestId) &&
                protocolError.requestId == _componentDeclarationPendingRequestId)
            {
                _componentDeclarationPendingRequestId = string.Empty;
                _componentDeclarationPendingDeadlineUtc = default;
                ComponentDeclarationPreviewStatus =
                    "REFUSED — " + (protocolError.code ?? "unknown") +
                    ". No Collider declaration was accepted.";
            }
            if (protocolError != null &&
                !string.IsNullOrEmpty(_componentPreviewPendingRequestId) &&
                protocolError.requestId == _componentPreviewPendingRequestId)
            {
                _componentPreviewPendingRequestId = string.Empty;
                _componentPreviewPendingSceneId = string.Empty;
                _componentPreviewPendingDeadlineUtc = default;
                ComponentRecoveryPreviewStatus =
                    "REFUSED — " + (protocolError.code ?? "unknown") +
                    ". Server has not provided authoritative Component data.";
            }
            var message = protocolError == null
                ? "Server returned an unreadable protocol error."
                : $"Server error {protocolError.code}: {protocolError.message}";

            if (protocolError != null && protocolError.code == "hierarchy_object_deleted")
            {
                TeamForgeDiagnostics.Warning(
                    "A stale edit targeted an object that was already deleted. " +
                    "The authoritative deletion was kept and the stale edit was discarded.");
            }
            else
            {
                LastError = message;
                TeamForgeDiagnostics.Error(message);
            }
            ProtocolErrorReceived?.Invoke(protocolError);
            if (protocolError != null && protocolError.code == "session_superseded")
            {
                _connectionDesired = false;
                Settings.ResumeAfterAssemblyReload = false;
                Settings.SaveSettings();
                TeamForgeDiagnostics.Warning(
                    "Automatic reconnect was stopped because another Editor is using the same stable User ID.");
            }
            if (State == TeamForgeConnectionState.Handshaking)
            {
                HandleConnectionLoss(epoch, transport, message, false);
            }
        }

        private static void OnConnectAttemptFailed(int epoch, IRealtimeTransport transport, string reason)
        {
            if (!IsCurrent(epoch, transport))
            {
                return;
            }

            HandleConnectionLoss(epoch, transport, reason, true);
        }

        private static void OnTransportFaulted(int epoch, IRealtimeTransport transport, Exception exception)
        {
            if (!IsCurrent(epoch, transport))
            {
                return;
            }

            HandleConnectionLoss(epoch, transport, exception.Message, true);
        }

        private static void OnTransportClosed(int epoch, IRealtimeTransport transport, string reason)
        {
            if (!IsCurrent(epoch, transport))
            {
                return;
            }

            HandleConnectionLoss(epoch, transport, reason, true);
        }

        private static void HandleConnectionLoss(
            int epoch,
            IRealtimeTransport transport,
            string reason,
            bool allowReconnect)
        {
            if (!IsCurrent(epoch, transport))
            {
                return;
            }

            _transport = null;
            ++_connectionEpoch;
            transport.Dispose();
            PendingPings.Clear();
            _helloRequestId = string.Empty;
            ConnectionId = string.Empty;
            PresenceAvailable = false;
            TransformSyncAvailable = false;
            HierarchySyncAvailable = false;
            ComponentRecoveryPreviewAvailable = false;
            ComponentDeclarationPreviewAvailable = false;
            _componentDeclarationOffered = false;
            _componentDeclarationPendingRequestId = string.Empty;
            _componentDeclarationPendingDeadlineUtc = default;
            _componentPreviewOffered = false;
            _componentPreviewPendingRequestId = string.Empty;
            _componentPreviewPendingSceneId = string.Empty;
            _componentPreviewPendingDeadlineUtc = default;
            _componentPreviewPendingKnownRevision = 0;
            _componentPreviewPendingKnownFingerprint = string.Empty;
            _componentPreviewCachedSceneId = string.Empty;
            _componentPreviewCachedRevision = 0;
            _componentPreviewCachedFingerprint = string.Empty;
            ProjectTransferAvailable = false;
            LastError = string.IsNullOrWhiteSpace(reason) ? "Connection ended." : reason;
            TeamForgeDiagnostics.Warning(LastError);

            var connectionPolicy = ResolvedProfile.Connection;
            if (_connectionDesired && allowReconnect && connectionPolicy.AutoReconnect && !_editorIsShuttingDown)
            {
                _reconnectAttempt += 1;
                var exponent = Math.Min(10, Math.Max(0, _reconnectAttempt - 1));
                var delay = Math.Min(connectionPolicy.MaximumReconnectDelaySeconds, Math.Pow(2, exponent));
                _nextReconnectUtc = DateTime.UtcNow.AddSeconds(delay);
                SetState(TeamForgeConnectionState.Reconnecting);
                TeamForgeDiagnostics.Info($"Reconnect attempt {_reconnectAttempt} scheduled in {delay:F0} seconds.");
            }
            else
            {
                _connectionDesired = false;
                SetState(TeamForgeConnectionState.Faulted);
            }
        }

        private static void SendMessage(object message, int epoch, string operation)
        {
            var transport = _transport;
            if (transport == null || epoch != _connectionEpoch)
            {
                return;
            }

            MessagesSent += 1;
            var json = TeamForgeProtocol.Serialize(message);
            _ = ObserveSendAsync(transport, epoch, json, operation);
            RaiseChanged();
        }

        // No runtime setting or automatic reconnect can silently turn this on.
        // Must be selected in the Editor Test Lab while disconnected.
        public static bool TrySetComponentRecoveryPreviewTestOptIn(bool enabled, out string error)
        {
            if (State != TeamForgeConnectionState.Disconnected &&
                State != TeamForgeConnectionState.Faulted)
            {
                error = "Disconnect before changing experimental WP6 Hello opt-in.";
                return false;
            }

            _componentPreviewOptInForTestLab = enabled;
            if (!enabled)
            {
                _componentDeclarationOptInForTestLab = false;
                ComponentDeclarationPreviewStatus =
                    "OFF — first-Editor Collider declaration not requested.";
            }
            ComponentRecoveryPreviewStatus = enabled
                ? "ARMED — reconnect to request read-only WP6 preview support."
                : "OFF — WP6 read-only recovery preview not requested.";
            error = string.Empty;
            RaiseChanged();
            return true;
        }

        // The declaration is a separate, stronger developer-only explicit
        // permission than read-only preview; it is never stored as a setting.
        public static bool TrySetComponentDeclarationPreviewTestOptIn(bool enabled, out string error)
        {
            if (State != TeamForgeConnectionState.Disconnected &&
                State != TeamForgeConnectionState.Faulted)
            {
                error = "Disconnect before changing experimental Collider declaration opt-in.";
                return false;
            }
            if (enabled && !_componentPreviewOptInForTestLab)
            {
                error = "Enable read-only WP6 recovery preview first.";
                return false;
            }
            _componentDeclarationOptInForTestLab = enabled;
            ComponentDeclarationPreviewStatus = enabled
                ? "ARMED — next connection may declare one selected saved Collider."
                : "OFF — first-Editor Collider declaration not requested.";
            error = string.Empty;
            RaiseChanged();
            return true;
        }

        // Only a saved Scene GUID may be requested. The response is metadata
        // only; values are never deserialized into or applied to Unity Objects.
        public static bool RequestComponentRecoveryPreview(string sceneId, out string error)
        {
            if (State != TeamForgeConnectionState.Connected ||
                !ComponentRecoveryPreviewAvailable || _transport == null)
            {
                error = "The server and Test Lab must first negotiate read-only WP6 preview support.";
                return false;
            }
            if (string.IsNullOrEmpty(sceneId) || sceneId.Length != 32)
            {
                error = "Select a saved Scene with a 32-character Unity GUID.";
                return false;
            }
            foreach (var character in sceneId)
            {
                if (!((character >= '0' && character <= '9') ||
                      (character >= 'a' && character <= 'f')))
                {
                    error = "Scene GUID must use canonical lowercase hexadecimal.";
                    return false;
                }
            }
            if (!string.IsNullOrEmpty(_componentPreviewPendingRequestId))
            {
                error = "A WP6 preview request is already awaiting a response.";
                return false;
            }

            var requestId = Guid.NewGuid().ToString("N");
            var sameScene = _componentPreviewCachedSceneId == sceneId &&
                _componentPreviewCachedFingerprint.Length == 64;
            var request = new ComponentRecoveryPreviewRequestMessage
            {
                type = "component_recovery_preview_request",
                protocolVersion = TeamForgeProtocol.Version,
                requestId = requestId,
                sceneId = sceneId,
                knownRevision = sameScene ? _componentPreviewCachedRevision : 0,
                knownFingerprint = sameScene ? _componentPreviewCachedFingerprint : string.Empty,
            };
            _componentPreviewPendingRequestId = requestId;
            _componentPreviewPendingSceneId = sceneId;
            _componentPreviewPendingKnownRevision = request.knownRevision;
            _componentPreviewPendingKnownFingerprint = request.knownFingerprint;
            _componentPreviewPendingDeadlineUtc = DateTime.UtcNow.AddSeconds(15);
            ComponentRecoveryPreviewStatus = "REQUESTED — waiting for server; nothing will be applied to the Scene.";
            SendMessage(request, _connectionEpoch, "WP6 read-only preview");
            error = string.Empty;
            return true;
        }

        private static void HandleComponentDeclarationAccepted(
            int epoch, IRealtimeTransport transport, string text)
        {
            if (!ComponentDeclarationPreviewAvailable ||
                State != TeamForgeConnectionState.Connected ||
                string.IsNullOrEmpty(_componentDeclarationPendingRequestId) ||
                string.IsNullOrEmpty(text) || text.Length > 8192)
            {
                HandleConnectionLoss(epoch, transport,
                    "Unsolicited or oversized Collider declaration response.", false);
                return;
            }

            var result = TeamForgeProtocol.Deserialize<ComponentDeclarationPreviewAcceptedMessage>(text);
            if (result == null ||
                result.requestId != _componentDeclarationPendingRequestId ||
                result.status != "first_editor_declaration_recorded_unverified" ||
                result.recordedComponents != 1 || result.recordedProperties != 3 ||
                result.serverRevision != 0)
            {
                HandleConnectionLoss(epoch, transport,
                    "Invalid or uncorrelated Collider declaration acknowledgement.", false);
                return;
            }
            _componentDeclarationPendingRequestId = string.Empty;
            _componentDeclarationPendingDeadlineUtc = default;
            ComponentDeclarationPreviewStatus =
                "ACCEPTED (UNVERIFIED) — server retained one Collider observation. " +
                "No Unity Scene or Inspector changes were applied.";
        }

        private static void HandleComponentRecoveryPreview(
            int epoch, IRealtimeTransport transport, string text)
        {
            if (!ComponentRecoveryPreviewAvailable ||
                State != TeamForgeConnectionState.Connected ||
                string.IsNullOrEmpty(_componentPreviewPendingRequestId) ||
                text == null || text.Length > 96 * 1024)
            {
                HandleConnectionLoss(epoch, transport,
                    "Unexpected or oversized WP6 recovery preview.", false);
                return;
            }

            var response = TeamForgeProtocol.Deserialize<ComponentRecoveryPreviewMetadataMessage>(text);
            if (response == null ||
                response.requestId != _componentPreviewPendingRequestId ||
                response.sceneId != _componentPreviewPendingSceneId ||
                response.serverRevision < 0 ||
                (response.status != "local_preview_resnapshot" &&
                 response.status != "local_preview_unchanged") ||
                !IsCanonicalSha256(response.fingerprint) ||
                (response.status == "local_preview_unchanged" &&
                 (response.serverRevision != _componentPreviewPendingKnownRevision ||
                  response.fingerprint != _componentPreviewPendingKnownFingerprint)))
            {
                HandleConnectionLoss(epoch, transport,
                    "Invalid or uncorrelated WP6 recovery preview.", false);
                return;
            }

            // The wire response may carry observedProperties, but their shape,
            // Unity owner and reconciliation contract are not yet established.
            // They are deliberately ignored, never trusted/applied or cached.
            _componentPreviewCachedSceneId = response.sceneId;
            _componentPreviewCachedRevision = response.serverRevision;
            _componentPreviewCachedFingerprint = response.fingerprint;
            _componentPreviewPendingRequestId = string.Empty;
            _componentPreviewPendingSceneId = string.Empty;
            _componentPreviewPendingDeadlineUtc = default;
            ComponentRecoveryPreviewStatus = response.status == "local_preview_unchanged"
                ? "UNCHANGED — digest/revision match; no Unity changes."
                : "OBSERVED — server returned a preview; Component values NOT applied to Unity.";
        }

        private static bool IsCanonicalSha256(string value)
        {
            if (value == null || value.Length != 64) return false;
            foreach (var character in value)
            {
                if (!((character >= '0' && character <= '9') ||
                      (character >= 'a' && character <= 'f')))
                {
                    return false;
                }
            }
            return true;
        }

        internal static bool SendPresence(PresenceUpdateMessage message)
        {
            if (message == null ||
                State != TeamForgeConnectionState.Connected ||
                !PresenceAvailable ||
                _transport == null)
            {
                return false;
            }

            SendMessage(message, _connectionEpoch, "Presence");
            return true;
        }

        internal static bool SendTransform(object message, string operation)
        {
            if (message == null ||
                State != TeamForgeConnectionState.Connected ||
                !TransformSyncAvailable ||
                _transport == null)
            {
                return false;
            }

            SendMessage(message, _connectionEpoch, operation);
            return true;
        }

        internal static bool SendHierarchy(object message, string operation)
        {
            if (message == null ||
                State != TeamForgeConnectionState.Connected ||
                !HierarchySyncAvailable ||
                _transport == null)
            {
                return false;
            }

            SendMessage(message, _connectionEpoch, operation);
            return true;
        }

        internal static bool SendProject(object message, string operation)
        {
            if (message == null ||
                State != TeamForgeConnectionState.Connected ||
                !ProjectTransferAvailable ||
                _transport == null)
            {
                return false;
            }

            SendMessage(message, _connectionEpoch, operation);
            return true;
        }

        internal static void CancelAutomaticResumeForConfigurationChange()
        {
            _resumeAfterAssemblyReloadPending = false;
            _connectionDesired = false;
            Settings.ResumeAfterAssemblyReload = false;
        }

        private static async Task ObserveSendAsync(
            IRealtimeTransport transport,
            int epoch,
            string json,
            string operation)
        {
            try
            {
                await transport.SendTextAsync(json, CancellationToken.None);
            }
            catch (Exception exception)
            {
                Enqueue(() =>
                {
                    if (IsCurrent(epoch, transport))
                    {
                        HandleConnectionLoss(epoch, transport, $"{operation} send failed: {exception.Message}", true);
                    }
                });
            }
        }

        private static async Task FinishDisconnectAsync(IRealtimeTransport transport, int disconnectEpoch)
        {
            try
            {
                // Give final Transform and lock-release sends queued by Disconnecting a
                // short non-blocking drain window before the close handshake.
                await Task.Delay(100);
                using (var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2)))
                {
                    await transport.DisconnectAsync(timeout.Token);
                }
            }
            catch (Exception exception)
            {
                TeamForgeDiagnostics.Trace($"Graceful disconnect fallback: {exception.Message}");
            }
            finally
            {
                transport.Dispose();
                Enqueue(() =>
                {
                    if (disconnectEpoch == _connectionEpoch)
                    {
                        ConnectionId = string.Empty;
                        PresenceAvailable = false;
                        TransformSyncAvailable = false;
                        ProjectTransferAvailable = false;
                        SetState(TeamForgeConnectionState.Disconnected);
                        TeamForgeDiagnostics.Info("Disconnected by user.");
                    }
                });
            }
        }

        private static bool TryValidateSettings(
            out RealtimeConnectionAttempt[] attempts,
            out string error)
        {
            Settings.EnsureDefaults();
            var connectionPolicy = ResolvedProfile.Connection;
            if (!ConnectionStrategy.TryCreateAttempts(
                    connectionPolicy.ServerAddress,
                    connectionPolicy.RealtimePath,
                    Settings.EffectiveAuthenticationToken,
                    connectionPolicy.KeepAliveSeconds,
                    out attempts,
                    out error))
            {
                return false;
            }

            if (attempts == null || attempts.Length != 1 || attempts[0] == null)
            {
                attempts = Array.Empty<RealtimeConnectionAttempt>();
                error = "Legacy Server strategy must produce exactly one connection attempt.";
                return false;
            }

            return TeamForgeInputValidator.TryValidateIdentity(
                       Settings.UserName,
                       Settings.ProjectId,
                       Settings.SessionId,
                       out error) &&
                   TeamForgeInputValidator.TryValidatePresenceIdentity(
                       Settings.UserId,
                       Settings.UserColorHtml,
                       out error);
        }

        private static bool IsCurrent(int epoch, IRealtimeTransport transport)
        {
            return epoch == _connectionEpoch && ReferenceEquals(transport, _transport);
        }

        private static void Update()
        {
            if (Interlocked.Exchange(ref _mainThreadQueueOverflowed, 0) != 0)
            {
                var transport = _transport;
                if (transport != null)
                {
                    HandleConnectionLoss(
                        _connectionEpoch,
                        transport,
                        "Inbound callback queue exceeded its safety limit.",
                        false);
                }
            }

            var processed = 0;
            while (processed < MaximumMainThreadActionsPerUpdate && MainThreadActions.TryDequeue(out var action))
            {
                Interlocked.Decrement(ref _queuedMainThreadActions);
                processed += 1;
                try
                {
                    action();
                }
                catch (Exception exception)
                {
                    TeamForgeDiagnostics.Error($"Main-thread callback failed: {exception}");
                }
            }

            if (!string.IsNullOrEmpty(_componentDeclarationPendingRequestId) &&
                DateTime.UtcNow >= _componentDeclarationPendingDeadlineUtc)
            {
                _componentDeclarationPendingRequestId = string.Empty;
                _componentDeclarationPendingDeadlineUtc = default;
                ComponentDeclarationPreviewStatus =
                    "TIMEOUT — Collider declaration status unknown; do not blindly retry.";
                RaiseChanged();
            }

            // An unresponsive preview request must not block future diagnostics.
            // Do not turn this into an unsolicited retry or a Scene operation.
            if (!string.IsNullOrEmpty(_componentPreviewPendingRequestId) &&
                DateTime.UtcNow >= _componentPreviewPendingDeadlineUtc)
            {
                _componentPreviewPendingRequestId = string.Empty;
                _componentPreviewPendingSceneId = string.Empty;
                _componentPreviewPendingDeadlineUtc = default;
                ComponentRecoveryPreviewStatus =
                    "TIMEOUT — no correlated preview response; no Unity state changed.";
                RaiseChanged();
            }

            if (State == TeamForgeConnectionState.Handshaking && DateTime.UtcNow >= _handshakeDeadlineUtc)
            {
                var transport = _transport;
                if (transport != null)
                {
                    HandleConnectionLoss(_connectionEpoch, transport, "Protocol Hello timed out.", true);
                }
            }

            if (_connectionDesired && State == TeamForgeConnectionState.Reconnecting && DateTime.UtcNow >= _nextReconnectUtc)
            {
                BeginConnect(true);
            }
        }

        private static void BeforeAssemblyReload()
        {
            Settings.ResumeAfterAssemblyReload =
                _connectionDesired && ResolvedProfile.Connection.AutoReconnect &&
                !TeamForgeConnectionSettings.HasTestLabGuestAuthenticationOverride &&
                State != TeamForgeConnectionState.Disconnected &&
                State != TeamForgeConnectionState.Faulted;
            Settings.SaveSettings();

            _editorIsShuttingDown = true;
            ++_connectionEpoch;
            _transport?.Dispose();
            _transport = null;
        }

        private static void ResumeAfterAssemblyReload()
        {
            if (_editorIsShuttingDown || !_resumeAfterAssemblyReloadPending)
            {
                return;
            }

            _resumeAfterAssemblyReloadPending = false;
            TeamForgeDiagnostics.Info("Restoring the requested connection after Assembly Reload.");
            Connect();
        }

        private static void OnEditorQuitting()
        {
            _editorIsShuttingDown = true;
            _connectionDesired = false;
            Settings.ResumeAfterAssemblyReload = false;
            Settings.SaveSettings();
            ++_connectionEpoch;
            _transport?.Dispose();
            _transport = null;
        }

        private static void Enqueue(Action action)
        {
            if (action == null)
            {
                return;
            }

            if (Interlocked.Increment(ref _queuedMainThreadActions) > MaximumQueuedMainThreadActions)
            {
                Interlocked.Decrement(ref _queuedMainThreadActions);
                Interlocked.Exchange(ref _mainThreadQueueOverflowed, 1);
                return;
            }
            MainThreadActions.Enqueue(action);
        }

        private static void SetState(TeamForgeConnectionState state)
        {
            if (State == state)
            {
                RaiseChanged();
                return;
            }

            State = state;
            RaiseChanged();
        }

        private static void RaiseChanged()
        {
            Changed?.Invoke();
        }
    }
}

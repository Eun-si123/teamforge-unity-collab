using System;
using System.Collections.Generic;
using System.IO;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace EunSung.TeamForge
{
    // Owns the live Editor boundary. Saved signed Scene provenance admits the
    // initial identities; all later dirty-Scene edits use the server ledger.
    // The recovery inbox holds local work before any targeted reconciliation.
    [InitializeOnLoad]
    internal static class TeamForgeColliderSyncService
    {
        private const string StateKey = "EunSung.TeamForge.ColliderSync.Session.v1";
        private const int MaximumRecovery = 1536;
        private static readonly Dictionary<string, TeamForgeColliderProperty> Authoritative =
            new Dictionary<string, TeamForgeColliderProperty>(StringComparer.Ordinal);
        private static readonly Dictionary<string, TeamForgeColliderProperty> Recovery =
            new Dictionary<string, TeamForgeColliderProperty>(StringComparer.Ordinal);
        private static readonly List<string> RowOrder = new List<string>();
        private static readonly List<OwnOperation> Undoable = new List<OwnOperation>();
        private static readonly List<OwnOperation> Redoable = new List<OwnOperation>();
        private static readonly HashSet<string> ReceivedOperations = new HashSet<string>(StringComparer.Ordinal);
        private static string _stateProjectId = string.Empty;
        private static string _stateSessionId = string.Empty;
        private static string _sceneId = string.Empty;
        private static string _scenePath = string.Empty;
        private static string _epoch = string.Empty;
        private static string _snapshotHash = string.Empty;
        private static TeamForgeComponentSource _source;
        private static TeamForgeWp6PreviewSourceGate.ProjectPin _pin;
        private static string _joinedConnection = string.Empty;
        private static string _snapshotRequest = string.Empty;
        private static string _reportRequest = string.Empty;
        private static long _reportedRevision;
        private static bool _rejoinRequested;
        private static PendingOperation _pending;
        private static bool _ready;
        private static bool _awaitingJoinSnapshot;
        private static bool _wasConnected;
        private static double _nextObservation;
        private static double _requestDeadline;
        private static long _revision;
        internal static string Status { get; private set; } = "Local only — Collider collaboration is off.";
        internal static string EditorApplyStatus { get; private set; } = "No server state applied.";
        internal static string ReportStatus { get; private set; } = "No Editor apply report acknowledged.";
        internal static bool Ready => _ready;
        internal static int RecoveryCount => Recovery.Count;
        internal static bool Pending => _pending != null;
        internal static bool CanUndo => _ready && _pending == null && Undoable.Count > 0;
        internal static bool CanRedo => _ready && _pending == null && Redoable.Count > 0;
        internal static string SceneId => _sceneId;
        internal static event Action Changed;

        private sealed class OwnOperation
        {
            internal TeamForgeColliderProperty Before;
            internal TeamForgeColliderProperty After;
            internal string OperationId;
        }
        private sealed class PendingOperation
        {
            internal string RequestId;
            internal string OperationId;
            internal TeamForgeColliderProperty Before;
            internal TeamForgeColliderProperty Desired;
            internal string Compensates;
            internal int HistoryDirection;
            internal double SentAt;
            internal string Json;
        }
        [Serializable]
        private sealed class SavedState
        {
            public string sceneId;
            public string scenePath;
            public string projectId;
            public string sessionId;
            public string projectUuid;
            public string epoch;
            public TeamForgeComponentSource source;
            public string[] properties;
            public string[] recovery;
        }

        static TeamForgeColliderSyncService()
        {
            Restore();
            TeamForgeConnectionService.ComponentMessageReceived += OnMessage;
            TeamForgeConnectionService.ProtocolErrorReceived += OnError;
            TeamForgeConnectionService.Changed += OnConnectionChanged;
            TeamForgeConnectionService.Disconnecting += PreserveBeforeDisconnect;
            EditorApplication.update += Update;
            AssemblyReloadEvents.beforeAssemblyReload += PreserveBeforeDisconnect;
            EditorApplication.quitting += PreserveBeforeDisconnect;
            Undo.undoRedoPerformed += OnUndoRedo;
            Undo.postprocessModifications += modifications => { _nextObservation = 0; return modifications; };
            EditorSceneManager.sceneSaved += _ => RaiseChanged();
            EditorSceneManager.sceneClosing += (scene, _) => { if (scene.path == _scenePath) PreserveBeforeDisconnect(); };
        }

        internal static bool JoinActiveScene(out string error)
        {
            error = string.Empty;
            if (!TeamForgeConnectionService.ComponentPropertySyncAvailable ||
                TeamForgeConnectionService.State != TeamForgeConnectionState.Connected)
            { error = "Enable Collider collaboration while disconnected, then connect to an M1 server."; return false; }
            if (!string.IsNullOrEmpty(_snapshotRequest) && EditorApplication.timeSinceStartup < _requestDeadline)
                return true; // A manual reconnect click can share the automatic in-flight admission.
            _rejoinRequested = false;
            if (!TeamForgeWp6PreviewSourceGate.TryCaptureCurrentProjectPin(out var pin, out error)) return false;
            var scene = SceneManager.GetActiveScene();
            var guid = scene.IsValid() ? AssetDatabase.AssetPathToGUID(scene.path) : string.Empty;
            if (!TeamForgeWp6SceneInventory.TryCapture(scene, out var inventory, out error)) return false;
            if (inventory.Observations.Count == 0)
            { error = "The saved Scene needs at least one supported BoxCollider or SphereCollider."; return false; }
            var continuing = guid == _sceneId && _source != null && SameProject(pin, _source) && Authoritative.Count > 0 &&
                _stateProjectId == pin.ProjectId && _stateSessionId == pin.SessionId;
            if (!continuing)
            {
                if (Recovery.Count > 0)
                { error = "Resolve the previous Scene's recovery inbox before joining a different source."; return false; }
                if (!TeamForgeWp6PreviewSourceGate.TryCaptureForReadOnlyPreview(guid, out var verified, out error)) return false;
                _source = new TeamForgeComponentSource
                {
                    projectUuid = pin.ProjectUuid, baselineRevision = pin.BaselineRevision,
                    manifestHash = pin.ManifestHash, descriptorHash = pin.DescriptorHash,
                    scenePath = scene.path, sceneFileSha256 = verified.SceneFileSha256, sceneMetaSha256 = verified.MetaSha256,
                };
                Authoritative.Clear();
                foreach (var observation in inventory.Observations)
                    foreach (var property in observation.Properties)
                    {
                        var row = TeamForgeColliderProperty.FromObservation(observation, property);
                        Authoritative.Add(row.Key, row);
                    }
                _epoch = string.Empty;
                Undoable.Clear(); Redoable.Clear(); ReceivedOperations.Clear();
            }
            else CaptureUnconfirmedChanges();
            _stateProjectId = pin.ProjectId; _stateSessionId = pin.SessionId;
            _sceneId = guid; _scenePath = scene.path; _pin = pin;
            var join = new TeamForgeComponentJoin
            {
                type = "component_scene_join", protocolVersion = TeamForgeProtocol.Version,
                requestId = Guid.NewGuid().ToString("N"), sceneId = guid, scenePath = scene.path,
                baseRevision = TeamForgeAuthorityView.Current.SessionRevision,
                sceneFileSha256 = _source.sceneFileSha256, sceneMetaSha256 = _source.sceneMetaSha256,
            };
            var identities = new StringBuilder(); var properties = new StringBuilder();
            foreach (var observation in inventory.Observations)
            {
                if (identities.Length > 0) identities.Append(',');
                identities.Append(JsonUtility.ToJson(new TeamForgeComponentIdentityRow
                { objectId = observation.ObjectId, componentId = observation.ComponentId, typeName = observation.TypeName }));
                foreach (var property in observation.Properties)
                {
                    if (properties.Length > 0) properties.Append(',');
                    properties.Append(TeamForgeColliderProperty.FromObservation(observation, property).ToWireJson(false));
                }
            }
            var json = Append(JsonUtility.ToJson(join), "\"components\":[" + identities + "],\"properties\":[" + properties + "]");
            _snapshotRequest = join.requestId; _awaitingJoinSnapshot = true; _ready = false;
            if (!TeamForgeConnectionService.SendComponentJson(json, "Join Collider Scene"))
            { error = "Collider Scene admission could not be sent."; _snapshotRequest = string.Empty; return false; }
            _joinedConnection = TeamForgeConnectionService.ConnectionId;
            _requestDeadline = EditorApplication.timeSinceStartup + 15;
            SetStatus("Joining saved Collider Scene — server verification pending.");
            Save(); return true;
        }

        private static bool SameProject(TeamForgeWp6PreviewSourceGate.ProjectPin pin, TeamForgeComponentSource source)
        {
            return pin != null && source != null && pin.ProjectUuid == source.projectUuid &&
                pin.BaselineRevision == source.baselineRevision && pin.ManifestHash == source.manifestHash &&
                pin.DescriptorHash == source.descriptorHash;
        }
        private static bool SourceMatches(TeamForgeComponentSource source)
        {
            return source != null && _source != null && source.projectUuid == _source.projectUuid &&
                source.baselineRevision == _source.baselineRevision && source.manifestHash == _source.manifestHash &&
                source.descriptorHash == _source.descriptorHash && source.scenePath == _scenePath && Hash(source.sceneFileSha256) && Hash(source.sceneMetaSha256) &&
                (_awaitingJoinSnapshot || source.sceneFileSha256 == _source.sceneFileSha256 &&
                 source.sceneMetaSha256 == _source.sceneMetaSha256);
        }
        private static bool CurrentContext()
        {
            var scene = SceneManager.GetActiveScene();
            return _pin != null && scene.IsValid() && scene.isLoaded && scene.path == _scenePath &&
                AssetDatabase.AssetPathToGUID(scene.path) == _sceneId &&
                TeamForgeConnectionService.ConnectionId == _joinedConnection &&
                TeamForgeWp6PreviewSourceGate.TryCaptureCurrentProjectPin(out var pin, out _) && _pin.Same(pin);
        }

        private static void OnConnectionChanged()
        {
            var connected = TeamForgeConnectionService.State == TeamForgeConnectionState.Connected;
            if (!connected && _wasConnected) PreserveBeforeDisconnect();
            if (connected && !_wasConnected && TeamForgeConnectionService.ComponentPropertySyncAvailable &&
                !string.IsNullOrEmpty(_sceneId)) { _nextObservation = 0; _rejoinRequested = true; }
            _wasConnected = connected;
            RaiseChanged();
        }
        private static void PreserveBeforeDisconnect()
        {
            CaptureUnconfirmedChanges();
            PreservePendingLocal();
            _ready = false; _pending = null; _snapshotRequest = string.Empty; _reportRequest = string.Empty;
            _rejoinRequested = false; _joinedConnection = string.Empty; _pin = null;
            Save();
            SetStatus("Disconnected — unconfirmed Collider work is preserved in the recovery inbox.");
        }
        private static void CaptureUnconfirmedChanges()
        {
            foreach (var pair in Authoritative)
                if (TeamForgeColliderProperty.TryRead(pair.Value, out var actual, out _) &&
                    !actual.SameValue(pair.Value)) Keep(actual);
        }
        private static void PreservePendingLocal()
        {
            if (_pending == null) return;
            // A newer Inspector edit (including Undo while sending) wins over
            // the immutable in-flight payload when preserving local intent.
            if (TeamForgeColliderProperty.TryRead(_pending.Desired, out var actual, out _)) Keep(actual);
            else if (!Recovery.ContainsKey(_pending.Desired.Key)) Keep(_pending.Desired);
        }
        private static void Keep(TeamForgeColliderProperty local)
        {
            if (local == null || !local.IsValid || Recovery.Count >= MaximumRecovery && !Recovery.ContainsKey(local.Key)) return;
            Recovery[local.Key] = local;
        }

        private static void Update()
        {
            if (EditorApplication.isPlayingOrWillChangePlaymode) return;
            var now = EditorApplication.timeSinceStartup;
            if (!_ready)
            {
                if (_rejoinRequested && string.IsNullOrEmpty(_snapshotRequest) &&
                    TeamForgeConnectionService.ComponentPropertySyncAvailable &&
                    TeamForgeWp6PreviewSourceGate.TryCaptureCurrentProjectPin(out _, out _))
                {
                    _rejoinRequested = false;
                    if (!JoinActiveScene(out var rejoinError)) SetStatus("Automatic Collider recovery paused: " + rejoinError);
                }
                if (!string.IsNullOrEmpty(_snapshotRequest) && now > _requestDeadline)
                {
                    _snapshotRequest = string.Empty;
                    SetStatus("Collider admission/snapshot timed out — local work remains preserved. Retry Join Scene.");
                }
                return;
            }
            if (!CurrentContext())
            { PreserveBeforeDisconnect(); SetStatus("Scene or signed Project changed — join the intended Scene again."); return; }
            if (_pending != null)
            {
                // Exact immutable operation retry handles lost ACK without a second write.
                if (now - _pending.SentAt > 3)
                {
                    TeamForgeConnectionService.SendComponentJson(_pending.Json, "Retry Collider operation");
                    _pending.SentAt = now;
                }
                return;
            }
            if (now < _nextObservation) return;
            _nextObservation = now + 0.25;
            foreach (var pair in Authoritative)
            {
                if (!TeamForgeColliderProperty.TryRead(pair.Value, out var actual, out var error))
                { _ready = false; SetStatus("Collider identity changed: " + error + " Component add/remove requires M2."); return; }
                if (actual.SameValue(pair.Value) || Recovery.ContainsKey(pair.Key)) continue;
                Send(pair.Value, actual, string.Empty, 0);
                return;
            }
        }

        private static void OnUndoRedo()
        {
            if (!_ready) { CaptureUnconfirmedChanges(); Save(); return; }
            TeamForgeColliderProperty compensationBefore = null;
            TeamForgeColliderProperty compensationDesired = null;
            // Unity's native Undo may restore a whole Component, including fields
            // changed remotely since its Undo record. Classify every shared delta
            // before the polling observer may interpret any as a fresh edit.
            foreach (var before in Authoritative.Values)
            {
                if (!TeamForgeColliderProperty.TryRead(before, out var actual, out _)) continue;
                if (_pending != null && before.Key == _pending.Desired.Key)
                {
                    // An unrelated native Undo must not roll back an in-flight
                    // Collider just because it differs from the last server value.
                    if (!actual.SameValue(_pending.Desired)) Keep(actual);
                    continue;
                }
                if (actual.SameValue(before)) continue;
                if (_pending == null && compensationBefore == null && CanNativeCompensate(before, actual))
                { compensationBefore = before; compensationDesired = actual; continue; }
                Keep(actual);
                if (!TeamForgeColliderProperty.TryApply(actual, before, out _))
                { _ready = false; SetStatus("Native Undo overlaps a shared field that could not be restored. Local work is preserved."); }
            }
            if (_ready && compensationBefore != null) TryNativeCompensation(compensationBefore, compensationDesired);
            Save(); _nextObservation = EditorApplication.timeSinceStartup + 0.25;
            RaiseChanged();
        }
        private static bool CanNativeCompensate(TeamForgeColliderProperty current, TeamForgeColliderProperty observed)
        {
            foreach (var history in new[] { Undoable, Redoable })
            {
                if (history.Count == 0) continue;
                var op = history[history.Count - 1];
                if (current.SameTarget(op.After) && current.SameValue(op.After) &&
                    current.Revision == op.After.Revision && observed.SameValue(op.Before)) return true;
            }
            return false;
        }
        private static bool OwnsLock(TeamForgeColliderProperty row)
        {
            return TeamForgeAuthorityView.Current.Locks.TryGet(row.SceneId, row.ObjectId, out var lease) &&
                lease.ownerConnectionId == TeamForgeConnectionService.ConnectionId;
        }
        private static bool Send(TeamForgeColliderProperty before, TeamForgeColliderProperty desired,
            string compensates, int historyDirection)
        {
            if (!_ready || _pending != null || !CurrentContext()) return false;
            if (!OwnsLock(before))
            {
                Keep(desired);
                TeamForgeColliderProperty.TryApply(desired, before, out _);
                Save(); SetStatus("Collider edit refused locally — select its GameObject and acquire its shared lock. Work preserved.");
                return false;
            }
            var metadata = new TeamForgeComponentSet
            {
                type = "component_property_set", protocolVersion = TeamForgeProtocol.Version,
                requestId = Guid.NewGuid().ToString("N"), operationId = Guid.NewGuid().ToString("N"),
                epoch = _epoch, sceneId = _sceneId,
                baseRevision = TeamForgeAuthorityView.Current.SessionRevision,
                expectedRevision = before.Revision, compensatesOperationId = compensates ?? string.Empty,
            };
            var rowJson = desired.ToWireJson(false);
            var expected = before.ToWireJson(false);
            // The codec emits the value last. Extract through its typed writer,
            // rather than accepting arbitrary JSON from an Editor text field.
            var valueIndex = expected.LastIndexOf("\"value\":", StringComparison.Ordinal);
            var expectedValue = expected.Substring(valueIndex + 8, expected.Length - valueIndex - 9);
            var json = Append(JsonUtility.ToJson(metadata), rowJson.Substring(1, rowJson.Length - 2) +
                ",\"expectedValue\":" + expectedValue);
            _pending = new PendingOperation
            {
                RequestId = metadata.requestId, OperationId = metadata.operationId,
                Before = before, Desired = desired, Compensates = compensates,
                HistoryDirection = historyDirection, SentAt = EditorApplication.timeSinceStartup, Json = json,
            };
            if (!TeamForgeConnectionService.SendComponentJson(json, "Collider property edit"))
            { Keep(desired); _pending = null; Save(); return false; }
            Save(); SetStatus("Sending Collider edit — server acceptance pending."); return true;
        }

        internal static bool UndoOwnEdit()
        {
            return CanUndo && Compensate(Undoable[Undoable.Count - 1], -1);
        }
        internal static bool RedoOwnEdit()
        {
            return CanRedo && Compensate(Redoable[Redoable.Count - 1], 1);
        }
        private static bool Compensate(OwnOperation op, int direction)
        {
            if (!Authoritative.TryGetValue(op.After.Key, out var current) ||
                !current.SameValue(op.After) || current.Revision != op.After.Revision)
            { SetStatus("Shared Undo/Redo refused: another operation changed this property."); return false; }
            return Send(current, op.Before, op.OperationId, direction);
        }
        private static bool TryNativeCompensation(TeamForgeColliderProperty current, TeamForgeColliderProperty observed)
        {
            if (Undoable.Count > 0)
            {
                var op = Undoable[Undoable.Count - 1];
                if (current.SameTarget(op.After) && current.SameValue(op.After) &&
                    current.Revision == op.After.Revision && observed.SameValue(op.Before))
                    return Send(current, observed, op.OperationId, -1);
            }
            if (Redoable.Count > 0)
            {
                var op = Redoable[Redoable.Count - 1];
                if (current.SameTarget(op.After) && current.SameValue(op.After) &&
                    current.Revision == op.After.Revision && observed.SameValue(op.Before))
                    return Send(current, observed, op.OperationId, 1);
            }
            return false;
        }

        internal static bool ResubmitRecovery(string selectedKey = null)
        {
            if (!_ready || _pending != null || Recovery.Count == 0) return false;
            foreach (var pair in Recovery)
            {
                if (selectedKey != null && pair.Key != selectedKey) continue;
                if (!Authoritative.TryGetValue(pair.Key, out var current)) continue;
                var desired = pair.Value;
                if (current.SameValue(desired)) { Recovery.Remove(pair.Key); Save(); RaiseChanged(); return true; }
                if (!OwnsLock(current))
                { SetStatus("Select the recovery item's GameObject and acquire its shared lock before resubmitting."); return false; }
                Recovery.Remove(pair.Key);
                var sent = Send(current, desired, string.Empty, 0);
                if (!sent) Keep(desired);
                Save(); return sent;
            }
            SetStatus("Recovery target no longer exists in this Scene. Export or keep the local Scene before discarding.");
            return false;
        }
        internal static bool LeaveScene(bool discardRecovery, out string error)
        {
            error = string.Empty;
            if (TeamForgeConnectionService.State == TeamForgeConnectionState.Connected ||
                TeamForgeConnectionService.State == TeamForgeConnectionState.Connecting ||
                TeamForgeConnectionService.State == TeamForgeConnectionState.Handshaking ||
                TeamForgeConnectionService.State == TeamForgeConnectionState.Reconnecting)
            { error = "Disconnect before leaving a shared Collider Scene."; return false; }
            CaptureUnconfirmedChanges(); PreservePendingLocal();
            if (Recovery.Count > 0 && !discardRecovery)
            { error = "Local Collider work remains in the recovery inbox. Export or explicitly discard it first."; return false; }
            Recovery.Clear(); Authoritative.Clear(); RowOrder.Clear(); Undoable.Clear(); Redoable.Clear(); ReceivedOperations.Clear();
            _pending = null; _ready = false; _sceneId = string.Empty; _scenePath = string.Empty;
            _epoch = string.Empty; _source = null; _pin = null; _joinedConnection = string.Empty; _snapshotRequest = string.Empty;
            Save(); SetStatus("Left shared Collider Scene. Current local Scene values are preserved."); return true;
        }

        internal static void DiscardRecovery()
        {
            Recovery.Clear(); Save(); SetStatus("Recovery inbox cleared explicitly. Shared server state retained.");
        }
        internal static bool ExportRecovery(string path, out string error)
        {
            error = string.Empty;
            try
            {
                var rows = new List<string>();
                foreach (var row in Recovery.Values) rows.Add(row.ToWireJson());
                File.WriteAllText(path, Append(JsonUtility.ToJson(new SceneName { sceneId = _sceneId }),
                    "\"properties\":[" + string.Join(",", rows) + "]"), new UTF8Encoding(false));
                return true;
            }
            catch (Exception) { error = "Collider recovery export could not be written. The inbox remains preserved."; return false; }
        }
        [Serializable] private sealed class SceneName { public string sceneId; }

        internal static string RecoverySummary()
        {
            var text = new StringBuilder();
            foreach (var row in Recovery.Values)
            {
                if (text.Length > 0) text.Append('\n');
                text.Append(row.TypeName).Append(" · ").Append(row.Path).Append(" · ").Append(row.ComponentId)
                    .Append("\nLocal: ").Append(ValueText(row)).Append(" · Shared: ")
                    .Append(Authoritative.TryGetValue(row.Key, out var shared) ? ValueText(shared) : "target unavailable");
            }
            return text.ToString();
        }

        internal static IReadOnlyList<TeamForgeColliderProperty> RecoveryRows() =>
            new List<TeamForgeColliderProperty>(Recovery.Values).AsReadOnly();
        internal static string SharedValueText(TeamForgeColliderProperty row) =>
            Authoritative.TryGetValue(row.Key, out var shared) ? ValueText(shared) : "target unavailable";
        internal static string ValueText(TeamForgeColliderProperty row)
        {
            if (row.Kind == "boolean") return row.Boolean ? "true" : "false";
            if (row.Kind == "float") return row.Number.ToString("R", CultureInfo.InvariantCulture);
            return "(" + row.Vector.x.ToString("R", CultureInfo.InvariantCulture) + ", " +
                row.Vector.y.ToString("R", CultureInfo.InvariantCulture) + ", " + row.Vector.z.ToString("R", CultureInfo.InvariantCulture) + ")";
        }
        internal static bool SelectRecoveryTarget(TeamForgeColliderProperty row)
        {
            if (!TeamForgeWp6ComponentIdentity.TryResolve(new TeamForgeWp6ComponentIdentity.Record(
                row.SceneId, row.ObjectId, row.ComponentId, row.TypeName), out var component, out _)) return false;
            Selection.activeGameObject = component.gameObject;
            EditorGUIUtility.PingObject(component);
            return true;
        }

        private static void OnMessage(string type, string json)
        {
            var message = JsonUtility.FromJson<TeamForgeComponentMessage>(json);
            if (message == null || !CurrentContext() || message.sceneId != _sceneId)
            { _ready = false; SetStatus("Discarded Collider response for a changed Scene/Project connection."); return; }
            if (type == "component_snapshot") { ApplySnapshot(message, json); return; }
            if (message.epoch != _epoch)
            { PreserveBeforeDisconnect(); SetStatus("Collider Session epoch changed — join again; local work is preserved."); return; }
            if (type == "component_property_applied") ApplyOperation(message, json);
            else if (type == "component_property_rejected")
            {
                if (_pending != null && message.operationId == _pending.OperationId)
                { PreservePendingLocal(); _pending = null; }
                _ready = false; Save();
                SetStatus("Collider edit rejected: " + message.error + ". Refreshing server state; local intent preserved.");
                RequestSnapshot();
            }
            else if (type == "component_apply_report_ack")
            {
                if (message.requestId != _reportRequest || message.serverRevision != _reportedRevision ||
                    message.status != "editor_report_recorded") return;
                _reportRequest = string.Empty;
                ReportStatus = "Server received Editor apply report at revision " + message.serverRevision + ". Disk save is separate.";
                RaiseChanged();
            }
        }
        private static void ApplySnapshot(TeamForgeComponentMessage message, string json)
        {
            if (message.requestId != _snapshotRequest || string.IsNullOrEmpty(message.epoch) ||
                !Guid.TryParse(message.epoch, out var parsedEpoch) || parsedEpoch.ToString("D") != message.epoch ||
                message.serverRevision < 0 || (!_awaitingJoinSnapshot && (message.serverRevision < _revision || message.epoch != _epoch)) ||
                !Hash(message.snapshotHash) ||
                !SourceMatches(message.source) ||
                !TeamForgeColliderProperty.TryParseRows(json, out var rows, out var error) || rows.Count != Authoritative.Count)
            { _ready = false; SetStatus("Collider snapshot refused: source, identity, or revision validation failed."); return; }
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var row in rows)
                if (row.SceneId != _sceneId || row.Revision > message.serverRevision || !seen.Add(row.Key) ||
                    !Authoritative.ContainsKey(row.Key))
                { _ready = false; SetStatus("Collider snapshot contains a missing, duplicate, or foreign target."); return; }
            if (TeamForgeColliderSnapshotDigest.Compute(message.source, message.epoch, message.sceneId,
                message.serverRevision, rows) != message.snapshotHash)
            { _ready = false; SetStatus("Collider snapshot digest mismatch. No Scene values changed."); return; }
            // Validate every live target and capture local values before the
            // first Scene write. A failed batch rolls back only its own fields.
            var localRows = new List<TeamForgeColliderProperty>(rows.Count);
            foreach (var row in rows)
            {
                if (!TeamForgeColliderProperty.TryRead(Authoritative[row.Key], out var local, out _))
                { _ready = false; SetStatus("Collider snapshot refused: a saved target no longer resolves. No fields changed."); return; }
                localRows.Add(local);
                if (!local.SameValue(Authoritative[row.Key]) && !local.SameValue(row)) Keep(local);
            }
            var conflicts = 0;
            var changed = new List<int>();
            for (var index = 0; index < rows.Count; index++)
            {
                if (localRows[index].SameValue(rows[index])) continue;
                if (!TeamForgeColliderProperty.TryApply(localRows[index], rows[index], out _))
                {
                    conflicts++;
                    for (var undoIndex = changed.Count - 1; undoIndex >= 0; undoIndex--)
                    {
                        var appliedIndex = changed[undoIndex];
                        if (!TeamForgeColliderProperty.TryApply(rows[appliedIndex], localRows[appliedIndex], out _)) conflicts++;
                    }
                    break;
                }
                changed.Add(index);
            }
            if (conflicts == 0)
                foreach (var row in rows)
                {
                    Authoritative[row.Key] = row;
                    if (Recovery.TryGetValue(row.Key, out var recovered) && recovered.SameValue(row)) Recovery.Remove(row.Key);
                }
            _source = message.source;
            if (conflicts == 0)
            {
                RowOrder.Clear();
                foreach (var row in rows) RowOrder.Add(row.Key);
            }
            _awaitingJoinSnapshot = false;
            if (_epoch != message.epoch) { Undoable.Clear(); Redoable.Clear(); ReceivedOperations.Clear(); }
            _epoch = message.epoch; _revision = message.serverRevision; _snapshotHash = message.snapshotHash;
            _snapshotRequest = string.Empty; _pending = null; _ready = conflicts == 0;
            TeamForgeAuthorityView.ObserveRevision(message.serverRevision);
            EditorApplyStatus = conflicts == 0 ? "Collider snapshot applied in this Editor at revision " + _revision + "." :
                "Collider snapshot has " + conflicts + " unresolved Editor targets.";
            Report(conflicts == 0 ? "applied" : "conflict");
            Save(); SetStatus(conflicts == 0 ? "Shared Collider state ready. Select a GameObject to acquire its lock, then edit Inspector." :
                "Editor apply conflict — local work preserved; repair identities and Join Scene again.");
        }
        private static void ApplyOperation(TeamForgeComponentMessage message, string json)
        {
            if (!_ready || message.serverRevision < 1 || message.baseRevision >= message.serverRevision ||
                !Hash(message.snapshotHash) || string.IsNullOrEmpty(message.operationId) ||
                !TeamForgeColliderProperty.TryParseRow(json, out var row, out _) || row.Revision != message.serverRevision ||
                !Authoritative.TryGetValue(row.Key, out var before))
            { _ready = false; SetStatus("Collider operation validation failed. Request current server snapshot."); RequestSnapshot(); return; }
            if (ReceivedOperations.Contains(message.operationId)) return;
            var ownPending = _pending != null && _pending.OperationId == message.operationId ? _pending : null;
            if (ownPending != null && (message.requestId != ownPending.RequestId ||
                message.userId != TeamForgeConnectionService.Settings.UserId.Trim()))
            { _ready = false; SetStatus("Collider acknowledgement does not match the sending Editor operation."); return; }
            // A replay older than the accepted snapshot confirms an operation;
            // it never replaces a newer property or generates another Undo step.
            if (row.Revision <= before.Revision)
            {
                if (ownPending != null) { PreservePendingLocal(); _pending = null; Save(); }
                return;
            }
            var candidateRows = new List<TeamForgeColliderProperty>(RowOrder.Count);
            foreach (var key in RowOrder) candidateRows.Add(key == row.Key ? row : Authoritative[key]);
            if (candidateRows.Count != Authoritative.Count ||
                TeamForgeColliderSnapshotDigest.Compute(_source, message.epoch, message.sceneId,
                    message.serverRevision, candidateRows) != message.snapshotHash)
            { _ready = false; SetStatus("Collider operation digest mismatch. No Scene values changed."); RequestSnapshot(); return; }
            if (message.baseRevision < _revision || !TeamForgeColliderProperty.TryRead(before, out var local, out _))
            { _ready = false; RequestSnapshot(); return; }
            if (!local.SameValue(before) && !local.SameValue(row)) Keep(local);
            var applied = local.SameValue(row) || TeamForgeColliderProperty.TryApply(local, row, out _);
            Authoritative[row.Key] = row;
            _revision = message.serverRevision; _snapshotHash = message.snapshotHash;
            TeamForgeAuthorityView.ObserveRevision(message.serverRevision);
            if (ownPending != null)
            {
                _pending = null;
                var history = new OwnOperation { Before = ownPending.Before, After = row, OperationId = message.operationId };
                if (ownPending.HistoryDirection == -1)
                {
                    if (Undoable.Count > 0) Undoable.RemoveAt(Undoable.Count - 1);
                    Redoable.Add(history);
                }
                else if (ownPending.HistoryDirection == 1)
                {
                    if (Redoable.Count > 0) Redoable.RemoveAt(Redoable.Count - 1);
                    Undoable.Add(history);
                }
                else { Undoable.Add(history); Redoable.Clear(); }
                if (Undoable.Count > 256) Undoable.RemoveAt(0);
                if (Recovery.TryGetValue(row.Key, out var recovered) && recovered.SameValue(row)) Recovery.Remove(row.Key);
            }
            if (ReceivedOperations.Count >= 4096) ReceivedOperations.Clear();
            ReceivedOperations.Add(message.operationId);
            _ready = applied;
            EditorApplyStatus = applied ? "Collider property applied in this Editor at revision " + _revision + "." :
                "Server committed revision " + _revision + "; this Editor could not apply it.";
            Report(applied ? "applied" : "conflict");
            Save(); SetStatus("Server accepted Collider operation at revision " + _revision +
                (!applied ? ". Editor apply failed; local work remains preserved for review." :
                 Recovery.Count > 0 ? ". Local work awaits recovery review." : ". Shared state synchronized."));
        }
        private static void RequestSnapshot()
        {
            if (string.IsNullOrEmpty(_epoch) || !CurrentContext()) return;
            var request = new TeamForgeComponentRequest
            {
                type = "component_snapshot_request", protocolVersion = TeamForgeProtocol.Version,
                requestId = Guid.NewGuid().ToString("N"), sceneId = _sceneId, epoch = _epoch,
            };
            _snapshotRequest = request.requestId; _requestDeadline = EditorApplication.timeSinceStartup + 15;
            TeamForgeConnectionService.SendComponentJson(JsonUtility.ToJson(request), "Collider resnapshot");
        }
        private static void Report(string status)
        {
            var report = new TeamForgeComponentApplyReport
            {
                type = "component_apply_report", protocolVersion = TeamForgeProtocol.Version,
                requestId = Guid.NewGuid().ToString("N"), sceneId = _sceneId, epoch = _epoch,
                serverRevision = _revision, snapshotHash = _snapshotHash, status = status,
            };
            _reportRequest = report.requestId; _reportedRevision = report.serverRevision;
            TeamForgeConnectionService.SendComponentJson(JsonUtility.ToJson(report), "Collider Editor apply report");
            ReportStatus = "Editor reported " + status + " at revision " + _revision + "; server acknowledgement pending.";
        }
        private static void OnError(ProtocolErrorMessage error)
        {
            if (error == null) return;
            if (error.requestId == _reportRequest)
            {
                _reportRequest = string.Empty;
                ReportStatus = "Server did not accept the Editor report: " + error.code + ". Scene disk save remains separate.";
                RaiseChanged(); return;
            }
            if (error.requestId != _snapshotRequest && (_pending == null || error.requestId != _pending.RequestId)) return;
            PreservePendingLocal();
            _pending = null; _ready = false; _snapshotRequest = string.Empty; Save();
            SetStatus("Collider request refused: " + error.code + ". Local changes preserved.");
        }
        private static bool Hash(string text)
        {
            if (text == null || text.Length != 64) return false;
            foreach (var c in text) if (!(c >= '0' && c <= '9') && !(c >= 'a' && c <= 'f')) return false;
            return true;
        }
        private static string Append(string json, string fields)
        { return json.Substring(0, json.Length - 1) + "," + fields + "}"; }

        private static void Save()
        {
            var properties = new List<string>(); var recovery = new List<string>();
            foreach (var row in Authoritative.Values) properties.Add(Append(row.ToWireJson(), "\"serverRevision\":" + row.Revision));
            foreach (var row in Recovery.Values) recovery.Add(Append(row.ToWireJson(), "\"serverRevision\":" + row.Revision));
            if (_pending != null && !Recovery.ContainsKey(_pending.Desired.Key))
                recovery.Add(Append(_pending.Desired.ToWireJson(), "\"serverRevision\":" + _pending.Desired.Revision));
            var savedJson = JsonUtility.ToJson(new SavedState
            {
                sceneId = _sceneId, scenePath = _scenePath,
                projectId = string.IsNullOrEmpty(_stateProjectId) ? TeamForgeConnectionService.Settings.ProjectId : _stateProjectId,
                sessionId = string.IsNullOrEmpty(_stateSessionId) ? TeamForgeConnectionService.Settings.SessionId : _stateSessionId,
                projectUuid = _source?.projectUuid, source = _source, epoch = _epoch,
                properties = properties.ToArray(), recovery = recovery.ToArray(),
            });
            SessionState.SetString(StateKey + Path.GetFileName(LocalStatePath()), savedJson);
            try
            {
                if (savedJson.Length > 2 * 1024 * 1024) throw new IOException("Local recovery state exceeds its bounded file budget.");
                var path = LocalStatePath();
                var library = Path.GetDirectoryName(Path.GetDirectoryName(path));
                if (!SafeDirectory(library, true) || !SafeDirectory(Path.GetDirectoryName(path), true))
                    throw new IOException("Local recovery directory is redirected.");
                if (File.Exists(path) && (new FileInfo(path).Attributes & FileAttributes.ReparsePoint) != 0)
                    throw new IOException("Local recovery file is redirected.");
                var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
                using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                using (var writer = new StreamWriter(stream, new UTF8Encoding(false))) writer.Write(savedJson);
                if (File.Exists(path)) File.Replace(temporary, path, null);
                else File.Move(temporary, path);
            }
            catch (Exception)
            {
                EditorApplyStatus = "Local recovery is retained for this Editor session; writing the project Library recovery file failed.";
            }
        }
        private static string LocalStatePath()
        {
            var key = (string.IsNullOrEmpty(_stateProjectId) ? TeamForgeConnectionService.Settings.ProjectId : _stateProjectId) + "\n" +
                (string.IsNullOrEmpty(_stateSessionId) ? TeamForgeConnectionService.Settings.SessionId : _stateSessionId);
            using (var sha = SHA256.Create())
            {
                var hash = BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(key))).Replace("-", string.Empty);
                return Path.Combine(Directory.GetCurrentDirectory(), "Library", "TeamForge", "ColliderRecovery-" + hash + ".json");
            }
        }
        private static bool SafeDirectory(string path, bool create)
        {
            var directory = new DirectoryInfo(path);
            if (!directory.Exists && create) directory.Create();
            return directory.Exists && (directory.Attributes & FileAttributes.ReparsePoint) == 0;
        }
        private static void Restore()
        {
            try
            {
                var json = SessionState.GetString(StateKey + Path.GetFileName(LocalStatePath()), string.Empty);
                var file = new FileInfo(LocalStatePath());
                if (string.IsNullOrEmpty(json) && file.Exists &&
                    SafeDirectory(file.Directory.Parent.FullName, false) && SafeDirectory(file.Directory.FullName, false) &&
                    (file.Attributes & FileAttributes.ReparsePoint) == 0)
                {
                    using (var stream = new FileStream(file.FullName, FileMode.Open, FileAccess.Read, FileShare.Read))
                    {
                        const int maximum = 2 * 1024 * 1024;
                        if (stream.Length < 1 || stream.Length > maximum) return;
                        var bytes = new byte[maximum + 1]; var length = 0; int count;
                        while (length < bytes.Length && (count = stream.Read(bytes, length, bytes.Length - length)) > 0) length += count;
                        if (length > maximum || stream.Length != length) return;
                        json = new UTF8Encoding(false, true).GetString(bytes, 0, length);
                    }
                }
                if (string.IsNullOrEmpty(json) || json.Length > 2 * 1024 * 1024) return;
                var saved = JsonUtility.FromJson<SavedState>(json);
                if (saved == null || saved.properties == null || saved.recovery == null ||
                    saved.properties.Length > MaximumRecovery || saved.recovery.Length > MaximumRecovery ||
                    saved.projectId != TeamForgeConnectionService.Settings.ProjectId ||
                    saved.sessionId != TeamForgeConnectionService.Settings.SessionId) return;
                var rows = new Dictionary<string, TeamForgeColliderProperty>(StringComparer.Ordinal);
                foreach (var rowJson in saved.properties)
                {
                    if (!TeamForgeColliderProperty.TryParseRow(rowJson, out var row, out _) || row.SceneId != saved.sceneId || rows.ContainsKey(row.Key)) return;
                    rows.Add(row.Key, row);
                }
                foreach (var rowJson in saved.recovery)
                {
                    if (!TeamForgeColliderProperty.TryParseRow(rowJson, out var row, out _) || row.SceneId != saved.sceneId) return;
                    Recovery[row.Key] = row;
                }
                foreach (var pair in rows) Authoritative.Add(pair.Key, pair.Value);
                _stateProjectId = saved.projectId; _stateSessionId = saved.sessionId;
                _sceneId = saved.sceneId; _scenePath = saved.scenePath; _source = saved.source; _epoch = saved.epoch;
                Status = "Collider session restored locally — Join Scene to confirm server state. Recovery items are never auto-submitted.";
            }
            catch (Exception) { Status = "Local Collider session could not be restored. Existing Scene values were preserved."; }
        }
        private static void SetStatus(string status) { Status = status; RaiseChanged(); }
        private static void RaiseChanged() { Changed?.Invoke(); }
    }
}

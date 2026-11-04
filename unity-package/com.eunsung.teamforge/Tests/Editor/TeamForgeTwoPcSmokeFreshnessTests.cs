using System;
using System.Collections;
using System.Collections.Generic;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;
using UnityEngine.UIElements;
using Object = UnityEngine.Object;

namespace EunSung.TeamForge.Tests
{
    [NonParallelizable]
    public sealed class TeamForgeTwoPcSmokeFreshnessTests
    {
        [Test]
        public void WindowRequiresItsOwnPongEvenWithCachedRoundTripAndReadyCollaboration()
        {
            using (var fixture = new SmokeFixture())
            {
                Assert.That(TeamForgeTwoPcSmokeCheck.Capture().Passed, Is.True,
                    "The compatibility snapshot must establish that only freshness is missing.");
                fixture.Run();
                var own = fixture.Probe;
                Assert.That(own, Is.Not.Null);
                Assert.That(TeamForgeConnectionService.LastRoundTripMilliseconds, Is.EqualTo(4.0));
                fixture.Refresh();
                Assert.That(fixture.Active, Is.True);
                Assert.That(fixture.Status, Does.StartWith("RUNNING"));
                Assert.That(fixture.Transport.Sent.Count, Is.EqualTo(1), "Updates must not keep issuing probes.");

                fixture.DeliverPong(own.RequestId);
                Assert.That(own.RoundTripMilliseconds.HasValue, Is.True);
                // An unchanged legacy display value must not veto a real, matching
                // response or substitute for the request-specific observation.
                fixture.SetConnection("<LastRoundTripMilliseconds>k__BackingField", (double?)4.0);
                Assert.That(TeamForgeTwoPcSmokeCheck.Capture(own).RoundTripMilliseconds,
                    Is.EqualTo(own.RoundTripMilliseconds));
                fixture.Refresh();
                Assert.That(fixture.Status, Does.StartWith("PASS (connection smoke only)"));
                Assert.That(fixture.Active, Is.False);
                Assert.That(fixture.Probe, Is.Null);
            }
        }

        [Test]
        public void OtherPendingUnknownAndOutOfOrderPongsCannotReplaceTheAttemptReceipt()
        {
            using (var fixture = new SmokeFixture())
            {
                Assert.That(TeamForgeConnectionService.TryPing(out var previous), Is.True);
                fixture.Run();
                var own = fixture.Probe;
                fixture.DeliverPong(previous.RequestId);
                fixture.DeliverPong("unknown-request");
                fixture.Refresh();
                Assert.That(own.RoundTripMilliseconds, Is.Null);
                Assert.That(fixture.Status, Does.StartWith("RUNNING"));

                Assert.That(TeamForgeConnectionService.TryPing(out var later), Is.True);
                fixture.DeliverPong(own.RequestId);
                var ownMeasurement = own.RoundTripMilliseconds;
                fixture.DeliverPong(later.RequestId);
                Assert.That(own.RoundTripMilliseconds, Is.EqualTo(ownMeasurement));
                fixture.Refresh();
                Assert.That(fixture.Status, Does.StartWith("PASS (connection smoke only)"));
            }
        }

        [TestCase(false, "epoch")]
        [TestCase(true, "epoch")]
        [TestCase(false, "transport")]
        [TestCase(true, "transport")]
        public void ConnectionReplacementInvalidatesPendingOrCompletedProbeEvenWithSameConnectionId(
            bool completeFirst, string replacement)
        {
            using (var fixture = new SmokeFixture())
            using (var replacementTransport = new RecordingTransport())
            {
                fixture.Run();
                var own = fixture.Probe;
                fixture.DeliverPong(own.RequestId, fixture.Epoch - 1);
                Assert.That(own.RoundTripMilliseconds, Is.Null, "An old transport callback must be fenced.");
                if (completeFirst) fixture.DeliverPong(own.RequestId);
                var completed = own.RoundTripMilliseconds;
                if (replacement == "epoch") fixture.SetConnection("_connectionEpoch", fixture.Epoch + 1);
                else fixture.SetConnection("_transport", replacementTransport);
                fixture.DeliverPong(own.RequestId, origin: replacement == "transport" ? replacementTransport : fixture.Transport);
                Assert.That(own.RoundTripMilliseconds, Is.EqualTo(completed));
                Assert.That(own.IsCurrent, Is.False);
                Assert.That(TeamForgeTwoPcSmokeCheck.Capture(own).Passed, Is.False);
                fixture.Refresh();
                Assert.That(fixture.Status, Does.StartWith("FAILED"));
                Assert.That(fixture.Active, Is.False);
                Assert.That(fixture.Transport.Sent.Count, Is.EqualTo(1), "Do not silently restart the attempt.");
                Assert.That(replacementTransport.Sent, Is.Empty);
            }
        }

        [Test]
        public void GuestStyleConnectingAttemptIssuesOneNewProbeOnlyAfterConnected()
        {
            using (var fixture = new SmokeFixture())
            {
                fixture.SetConnection("<State>k__BackingField", TeamForgeConnectionState.Connecting);
                fixture.SetConnection("<ConnectionId>k__BackingField", string.Empty);
                fixture.Begin();
                fixture.Refresh();
                Assert.That(fixture.Transport.Sent, Is.Empty);
                Assert.That(fixture.Probe, Is.Null);

                fixture.SetConnection("<State>k__BackingField", TeamForgeConnectionState.Connected);
                fixture.SetConnection("<ConnectionId>k__BackingField", "fixture-connection");
                // This models the separate Hello acknowledgement's automatic Ping.
                Assert.That(TeamForgeConnectionService.TryPing(out var helloPing), Is.True);
                fixture.DeliverPong(helloPing.RequestId);
                fixture.Refresh();
                var own = fixture.Probe;
                Assert.That(own, Is.Not.Null);
                Assert.That(own.RequestId, Is.Not.EqualTo(helloPing.RequestId));
                fixture.Refresh();
                Assert.That(fixture.Transport.Sent.Count, Is.EqualTo(2));
                Assert.That(fixture.Status, Does.StartWith("RUNNING"));
                fixture.DeliverPong(own.RequestId);
                fixture.Refresh();
                Assert.That(fixture.Status, Does.StartWith("PASS (connection smoke only)"));
            }
        }

        [TestCase("CancelTwoPcCheck")]
        [TestCase("OnDisable")]
        [TestCase("timeout")]
        public void EndedAttemptCannotPassOnLatePongOrSupplyARepeatedCheck(string ending)
        {
            using (var fixture = new SmokeFixture())
            {
                fixture.Run();
                var old = fixture.Probe;
                if (ending == "timeout")
                {
                    fixture.SetWindow("_twoPcCheckDeadline", EditorApplication.timeSinceStartup - 1);
                    fixture.Refresh();
                    Assert.That(fixture.Status, Does.StartWith("FAILED"));
                }
                else fixture.InvokeWindow(ending);
                Assert.That(fixture.Active, Is.False);
                Assert.That(fixture.Probe, Is.Null);
                var stoppedStatus = fixture.Status;
                fixture.DeliverPong(old.RequestId);
                fixture.Refresh();
                Assert.That(fixture.Status, Is.EqualTo(stoppedStatus));
                Assert.That(fixture.Transport.Sent.Count, Is.EqualTo(1));

                fixture.Run();
                var next = fixture.Probe;
                Assert.That(next.RequestId, Is.Not.EqualTo(old.RequestId));
                fixture.Refresh();
                Assert.That(next.RoundTripMilliseconds, Is.Null);
                Assert.That(fixture.Status, Does.StartWith("RUNNING"));
                fixture.DeliverPong(next.RequestId);
                fixture.Refresh();
                Assert.That(fixture.Status, Does.StartWith("PASS (connection smoke only)"));
            }
        }

        [Test]
        public void MissingTransportRefusesProbeWithoutUsingCachedRoundTrip()
        {
            using (var fixture = new SmokeFixture())
            {
                fixture.SetConnection("_transport", null);
                Assert.That(TeamForgeConnectionService.TryPing(out var probe), Is.False);
                Assert.That(probe, Is.Null);
                fixture.Run();
                Assert.That(fixture.Status, Does.Not.StartWith("PASS"));
                Assert.That(fixture.Active, Is.False);
                Assert.That(fixture.Transport.Sent, Is.Empty);
                Assert.That(TeamForgeConnectionService.LastRoundTripMilliseconds, Is.EqualTo(4.0));
            }
        }

        [TestCase(false)]
        [TestCase(true)]
        public void DeadlineWinsOverCompletedPongAndDeferredProbe(bool pongCompleted)
        {
            using (var fixture = new SmokeFixture())
            {
                if (pongCompleted)
                {
                    fixture.Run();
                    fixture.DeliverPong(fixture.Probe.RequestId);
                    Assert.That(fixture.Probe.RoundTripMilliseconds.HasValue, Is.True);
                }
                else
                {
                    fixture.SetConnection("<State>k__BackingField", TeamForgeConnectionState.Connecting);
                    fixture.SetConnection("<ConnectionId>k__BackingField", string.Empty);
                    fixture.Begin();
                    fixture.Refresh();
                    Assert.That(fixture.Transport.Sent, Is.Empty);
                    fixture.SetConnection("<State>k__BackingField", TeamForgeConnectionState.Connected);
                    fixture.SetConnection("<ConnectionId>k__BackingField", "fixture-connection");
                }
                fixture.SetWindow("_twoPcCheckDeadline", EditorApplication.timeSinceStartup - 1);
                fixture.Refresh();
                Assert.That(fixture.Status, Does.StartWith("FAILED"));
                Assert.That(fixture.Active, Is.False);
                Assert.That(fixture.Probe, Is.Null);
                Assert.That(fixture.Transport.Sent.Count, Is.EqualTo(pongCompleted ? 1 : 0),
                    "An expired deferred check must not issue a Ping when connection finally arrives.");
            }
        }

        private sealed class SmokeFixture : IDisposable
        {
            private const BindingFlags Members = BindingFlags.Static | BindingFlags.Instance |
                                                 BindingFlags.Public | BindingFlags.NonPublic;
            private readonly List<Action> _restore = new List<Action>();
            private TeamForgeTestLabWindow _window;
            private Label _status;
            internal readonly RecordingTransport Transport = new RecordingTransport();
            internal int Epoch => (int)Field(typeof(TeamForgeConnectionService), "_connectionEpoch").GetValue(null);
            internal bool Active => (bool)Field(typeof(TeamForgeTestLabWindow), "_twoPcCheckActive").GetValue(_window);
            internal string Status => _status.text;
            internal TeamForgeConnectionService.PingProbe Probe =>
                (TeamForgeConnectionService.PingProbe)Field(typeof(TeamForgeTestLabWindow), "_twoPcPingProbe").GetValue(_window);

            internal SmokeFixture()
            {
                try
                {
                    var settings = TeamForgeConnectionService.Settings;
                    var registry = TeamForgePresenceService.Registry;
                    _ = TeamForgeHierarchySyncService.SnapshotReady; // Finish static subscriptions before saving them.
                    // Expected unknown/stale-Pong paths must not evict existing
                    // diagnostic entries or add console warnings during this fixture.
                    SaveAndSet(typeof(TeamForgeDiagnostics), null, "_minimumLevel", TeamForgeLogLevel.Off);
                    SaveAndSet(typeof(TeamForgeConnectionService), null, "Changed", null);
                    SaveAndSet(typeof(TeamForgeConnectionService), null, "_transport", Transport);
                    SaveAndSet(typeof(TeamForgeConnectionService), null, "_connectionEpoch", Epoch + 1);
                    SaveAndSet(typeof(TeamForgeConnectionService), null, "<State>k__BackingField", TeamForgeConnectionState.Connected);
                    SaveAndSet(typeof(TeamForgeConnectionService), null, "<ConnectionId>k__BackingField", "fixture-connection");
                    SaveAndSet(typeof(TeamForgeConnectionService), null, "<PresenceAvailable>k__BackingField", true);
                    SaveAndSet(typeof(TeamForgeConnectionService), null, "<TransformSyncAvailable>k__BackingField", true);
                    SaveAndSet(typeof(TeamForgeConnectionService), null, "<HierarchySyncAvailable>k__BackingField", true);
                    SaveAndSet(typeof(TeamForgeConnectionService), null, "<LastRoundTripMilliseconds>k__BackingField", (double?)4.0);
                    SaveAndSet(typeof(TeamForgeConnectionService), null, "<MessagesSent>k__BackingField", 0L);
                    SaveAndSet(typeof(TeamForgeConnectionService), null, "<MessagesReceived>k__BackingField", 0L);
                    SaveAndSet(typeof(TeamForgeHierarchySyncService), null, "_receivedSnapshot", true);
                    SaveAndSet(typeof(TeamForgeHierarchySyncService), null, "_recoveryBlocked", false);
                    SaveAndSet(typeof(TeamForgeConnectionSettings), settings, "ProjectId", "freshness-project");
                    SaveAndSet(typeof(TeamForgeConnectionSettings), settings, "SessionId", "freshness-session");
                    SaveAndSet(typeof(TeamForgeConnectionSettings), settings, "UserId", "freshness-local");
                    PreserveAndClear((IDictionary)Field(typeof(TeamForgeConnectionService), "PendingPings").GetValue(null));
                    var members = (IDictionary)Field(typeof(TeamForgePresenceRegistry), "_members").GetValue(registry);
                    PreserveAndClear(members);
                    members.Add("freshness-remote", new PresenceRecord
                    {
                        userId = "freshness-remote", connectionId = "remote-connection", displayName = "Remote fixture",
                        color = "#64B5F6", cameraPosition = new TeamForgeVector3Dto(),
                        cameraRotation = new TeamForgeQuaternionDto { w = 1 }, cameraPivot = new TeamForgeVector3Dto(),
                        cameraSize = 10, lastHeartbeatUnixMs = 1,
                    });
                    _window = ScriptableObject.CreateInstance<TeamForgeTestLabWindow>();
                    _status = new Label("fixture");
                    SetWindow("_twoPcStatus", _status);
                }
                catch
                {
                    Dispose();
                    throw;
                }
            }

            internal void Run() { InvokeWindow("RunTwoPcSmokeCheck"); Refresh(); }
            internal void Begin() => InvokeWindow("BeginTwoPcCheck");
            internal void Refresh()
            {
                SetWindow("_twoPcNextStatusAt", 0.0);
                InvokeWindow("UpdateTwoPcCheck");
            }
            internal void SetWindow(string name, object value) => Field(typeof(TeamForgeTestLabWindow), name).SetValue(_window, value);
            internal void SetConnection(string name, object value) => Field(typeof(TeamForgeConnectionService), name).SetValue(null, value);
            internal void InvokeWindow(string name) => Method(typeof(TeamForgeTestLabWindow), name).Invoke(_window, null);
            internal void DeliverPong(string requestId, int? epoch = null, IRealtimeTransport origin = null)
            {
                var json = TeamForgeProtocol.Serialize(new PongMessage
                {
                    type = "pong", protocolVersion = TeamForgeProtocol.Version, requestId = requestId,
                });
                Method(typeof(TeamForgeConnectionService), "OnTextReceived").Invoke(null,
                    new object[] { epoch ?? Epoch, origin ?? Transport, json });
            }

            private void SaveAndSet(Type type, object target, string name, object value)
            {
                var field = Field(type, name);
                var original = field.GetValue(target);
                _restore.Add(() => field.SetValue(target, original));
                field.SetValue(target, value);
            }

            private void PreserveAndClear(IDictionary dictionary)
            {
                var entries = new List<DictionaryEntry>();
                foreach (DictionaryEntry entry in dictionary) entries.Add(entry);
                _restore.Add(() =>
                {
                    dictionary.Clear();
                    foreach (var entry in entries) dictionary.Add(entry.Key, entry.Value);
                });
                dictionary.Clear();
            }

            public void Dispose()
            {
                var errors = new List<Exception>();
                try { if (_window != null) Object.DestroyImmediate(_window); }
                catch (Exception error) { errors.Add(error); }
                Transport.Dispose();
                for (var index = _restore.Count - 1; index >= 0; index--)
                {
                    try { _restore[index](); }
                    catch (Exception error) { errors.Add(error); }
                }
                _restore.Clear();
                if (errors.Count != 0) throw new AggregateException("Smoke fixture restoration failed.", errors);
            }

            private static FieldInfo Field(Type type, string name) => type.GetField(name, Members) ??
                throw new MissingFieldException(type.FullName, name);
            private static MethodInfo Method(Type type, string name) => type.GetMethod(name, Members) ??
                throw new MissingMethodException(type.FullName, name);
        }

        private sealed class RecordingTransport : IRealtimeTransport
        {
            internal readonly List<string> Sent = new List<string>();
            public event Action Connected { add { } remove { } }
            public event Action<string> TextReceived { add { } remove { } }
            public event Action<string> Closed { add { } remove { } }
            public event Action<Exception> Faulted { add { } remove { } }
            public Task ConnectAsync(CancellationToken cancellationToken) =>
                throw new InvalidOperationException("A smoke unit fixture must not open a real connection.");
            public Task SendTextAsync(string text, CancellationToken cancellationToken)
            {
                Sent.Add(text);
                return Task.CompletedTask;
            }
            public Task DisconnectAsync(CancellationToken cancellationToken) => Task.CompletedTask;
            public void Dispose() { }
        }
    }
}

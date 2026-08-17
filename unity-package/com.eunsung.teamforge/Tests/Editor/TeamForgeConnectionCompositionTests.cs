using System;
using System.Net.WebSockets;
using System.Reflection;
using System.Threading;
using NUnit.Framework;

namespace EunSung.TeamForge.Tests
{
    public sealed class TeamForgeConnectionCompositionTests
    {
        private const BindingFlags InstanceMembers =
            BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;

        [Test]
        public void LegacyServerStrategyProducesExactlyOneConfiguredAttempt()
        {
            var strategyType = RequiredEditorType("EunSung.TeamForge.LegacyServerStrategy");
            var strategy = Activator.CreateInstance(strategyType, true);
            var createAttempts = strategyType.GetMethod("TryCreateAttempts", InstanceMembers) ??
                                 throw new MissingMethodException(strategyType.FullName, "TryCreateAttempts");
            var arguments = new object[]
            {
                "https://teamforge.example/base",
                "/ws/",
                " local-token ",
                2,
                null,
                string.Empty,
            };

            Assert.That(createAttempts.Invoke(strategy, arguments), Is.EqualTo(true), arguments[5] as string);
            var attempts = arguments[4] as Array;
            Assert.That(attempts, Is.Not.Null);
            Assert.That(attempts.Length, Is.EqualTo(1));

            var attempt = attempts.GetValue(0);
            Assert.That(ReadProperty<Uri>(attempt, "Endpoint").AbsoluteUri,
                Is.EqualTo("wss://teamforge.example/base/ws"));
            Assert.That(ReadProperty<string>(attempt, "BearerToken"), Is.EqualTo(" local-token "));
            Assert.That(ReadProperty<int>(attempt, "KeepAliveSeconds"), Is.EqualTo(5));
        }

        [Test]
        public void WebSocketTransportFactoryCreatesTheConfiguredExistingAdapter()
        {
            var attemptType = RequiredEditorType("EunSung.TeamForge.RealtimeConnectionAttempt");
            var constructor = attemptType.GetConstructor(
                InstanceMembers,
                null,
                new[] { typeof(Uri), typeof(string), typeof(int) },
                null) ?? throw new MissingMethodException(attemptType.FullName, ".ctor");
            var attempt = constructor.Invoke(new object[]
            {
                new Uri("ws://127.0.0.1:5080/ws"),
                string.Empty,
                17,
            });
            var factoryType = RequiredEditorType("EunSung.TeamForge.WebSocketTransportFactory");
            var factory = Activator.CreateInstance(factoryType, true);
            var create = factoryType.GetMethod("Create", InstanceMembers) ??
                         throw new MissingMethodException(factoryType.FullName, "Create");
            var transport = create.Invoke(factory, new[] { attempt });

            try
            {
                Assert.That(transport.GetType().FullName,
                    Is.EqualTo("EunSung.TeamForge.ClientWebSocketTransport"));
                Assert.That(ReadField<Uri>(transport, "_endpoint").AbsoluteUri,
                    Is.EqualTo("ws://127.0.0.1:5080/ws"));
                Assert.That(ReadField<ClientWebSocket>(transport, "_socket").Options.KeepAliveInterval,
                    Is.EqualTo(TimeSpan.FromSeconds(17)));
            }
            finally
            {
                (transport as IDisposable)?.Dispose();
            }
        }

        [Test]
        public void RealtimeTransportConnectContractIsAttemptConfiguredAndTextFocused()
        {
            var transportType = RequiredEditorType("EunSung.TeamForge.IRealtimeTransport");
            var connect = transportType.GetMethod("ConnectAsync") ??
                          throw new MissingMethodException(transportType.FullName, "ConnectAsync");
            var parameters = connect.GetParameters();

            Assert.That(parameters.Length, Is.EqualTo(1));
            Assert.That(parameters[0].ParameterType, Is.EqualTo(typeof(CancellationToken)));
            Assert.That(transportType.GetMethod("SendTextAsync"), Is.Not.Null);
            Assert.That(transportType.GetMethod("DisconnectAsync"), Is.Not.Null);
        }

        private static Type RequiredEditorType(string name)
        {
            return typeof(TeamForgeConnectionService).Assembly.GetType(name, true);
        }

        private static T ReadProperty<T>(object instance, string name)
        {
            var property = instance.GetType().GetProperty(name, InstanceMembers) ??
                           throw new MissingMemberException(instance.GetType().FullName, name);
            return (T)property.GetValue(instance);
        }

        private static T ReadField<T>(object instance, string name)
        {
            var field = instance.GetType().GetField(name, InstanceMembers) ??
                        throw new MissingFieldException(instance.GetType().FullName, name);
            return (T)field.GetValue(instance);
        }
    }
}

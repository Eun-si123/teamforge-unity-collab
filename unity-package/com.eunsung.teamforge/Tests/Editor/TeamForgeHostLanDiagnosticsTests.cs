using System;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;

namespace EunSung.TeamForge.Tests
{
    public sealed class TeamForgeHostLanDiagnosticsTests
    {
        private static TeamForgeHostLanTarget Target(int seedPort = 5091, bool active = true, long generation = 1, string context = "fixture")
        {
            return new TeamForgeHostLanTarget("http://192.0.2.19:5080", "0.0.0.0", seedPort, active, generation, context);
        }

        private static TeamForgeHostLanResult Matching(TeamForgeHostLanTarget target)
        {
            return TeamForgeHostLanResult.FromProbe(target, TeamForgeHostLanProfile.Private,
                TeamForgeHostLanRules.Matches, TeamForgeHostLanRules.Matches);
        }

        [Test]
        public void TargetUsesSelectedCoordinatorAndActualSeedPortWithoutInventingReachability()
        {
            var target = Target(53781);
            Assert.That(target.CanProbe, Is.True);
            Assert.That(target.HostIpv4, Is.EqualTo("192.0.2.19"));
            Assert.That(target.CoordinatorPort, Is.EqualTo(5080));
            Assert.That(target.SeedPort, Is.EqualTo(53781));
            Assert.That(target.ActiveHost, Is.True);
            Assert.That(Target(5091).Key, Is.Not.EqualTo(target.Key));
            Assert.That(Target(53781, false).Key, Is.Not.EqualTo(target.Key));
            Assert.That(Target(53781, true, 2).Key, Is.Not.EqualTo(target.Key));
            Assert.That(Target(53781, true, 1, "changed").Key, Is.Not.EqualTo(target.Key));
        }

        [TestCase("http://host.example:5080")]
        [TestCase("http://[2001:db8::19]:5080")]
        [TestCase("http://192.0.2.:5080")]
        [TestCase("http://192.000.2.19:5080")]
        [TestCase("http://0xC0000213:5080")]
        [TestCase("http://user:private-code@192.0.2.19:5080")]
        [TestCase("http://192.0.2.19:5080?private-code=value")]
        [TestCase("http://192.0.2.19:5080/#private-code")]
        [TestCase("http://192.0.2.19:5080/private-path")]
        [TestCase("http://192.0.2.19:5080\n")]
        public void UnsupportedTargetIsUnknownWithoutEchoingRawAddress(string address)
        {
            var target = new TeamForgeHostLanTarget(address, "0.0.0.0", 5091, false, 1, "private-context");
            Assert.That(target.CanProbe, Is.False);
            Assert.That(target.Reason, Does.Not.Contain(address));
            Assert.That(target.Reason, Does.Not.Contain("private-code"));
            Assert.That(target.Reason, Does.Not.Contain("private-context"));
        }

        [TestCase("http://127.0.0.1:5080", "127.0.0.1")]
        [TestCase("http://localhost:5080", "localhost")]
        [TestCase("http://[::1]:5080", "::1")]
        public void LoopbackIsExplicitLocalOnly(string address, string listener)
        {
            var target = new TeamForgeHostLanTarget(address, listener, 5091, false, 1, "fixture");
            Assert.That(target.CanProbe, Is.False);
            Assert.That(target.ReasonCode, Is.EqualTo("local_only"));
        }

        [TestCase("http://192.0.2.19:5080", "127.0.0.1")]
        [TestCase("http://localhost:5080", "0.0.0.0")]
        [TestCase("http://127.0.0.1:5080", "0.0.0.0")]
        public void MixedLocalAndLanEndpointsAreUnsupportedWarnings(string address, string listener)
        {
            var target = new TeamForgeHostLanTarget(address, listener, 5091, false, 1, "fixture");
            Assert.That(target.CanProbe, Is.False);
            Assert.That(target.ReasonCode, Is.EqualTo("listener_mismatch"));
            using (var session = new TeamForgeHostLanSession((_, token) => throw new InvalidOperationException("Probe must not run.")))
            {
                session.UpdateTarget(target);
                session.BeginCheck();
                Assert.That(session.Result.Level, Is.EqualTo(TeamForgeHostLanLevel.Warning));
            }
        }

        [TestCase(null)]
        [TestCase("")]
        [TestCase(" ")]
        [TestCase("127.0.0.1/path")]
        [TestCase("127.0.0.1\n")]
        [TestCase("http://127.0.0.1")]
        [TestCase("[[127.0.0.1]]")]
        [TestCase("[127.0.0.1]")]
        [TestCase("[localhost]")]
        [TestCase("[::1]]")]
        public void MalformedListenerCannotBecomeAnInformationalLocalOnlyResult(string listener)
        {
            var target = new TeamForgeHostLanTarget("http://127.0.0.1:5080", listener, 5091, false, 1, "fixture");
            Assert.That(target.CanProbe, Is.False);
            Assert.That(target.ReasonCode, Is.EqualTo("unsupported_listener"));
        }

        [TestCase(0, true)]
        [TestCase(-1, false)]
        [TestCase(65536, false)]
        public void InvalidOrMissingActiveSeedCannotBeReportedAsBound(int port, bool active)
        {
            Assert.That(Target(port, active).CanProbe, Is.False);
        }

        [TestCase((int)TeamForgeHostLanProfile.Public)]
        [TestCase((int)TeamForgeHostLanProfile.DomainAuthenticated)]
        public void NonPrivateProfileWarnsEvenWhenNamedRulesMatch(int profileValue)
        {
            var result = TeamForgeHostLanResult.FromProbe(Target(), (TeamForgeHostLanProfile)profileValue,
                TeamForgeHostLanRules.Matches, TeamForgeHostLanRules.Matches);
            Assert.That(result.Code, Is.EqualTo("profile_mismatch"));
            Assert.That(result.Level, Is.EqualTo(TeamForgeHostLanLevel.Warning));
            Assert.That(result.Summary, Does.Contain("reachability is unverified"));
        }

        [Test]
        public void PrivateProfileDoesNotHideCoordinatorOrSeedRuleMismatch()
        {
            foreach (var coordinatorMismatch in new[] { true, false })
            {
                var result = TeamForgeHostLanResult.FromProbe(Target(), TeamForgeHostLanProfile.Private,
                    coordinatorMismatch ? TeamForgeHostLanRules.Mismatch : TeamForgeHostLanRules.Matches,
                    coordinatorMismatch ? TeamForgeHostLanRules.Matches : TeamForgeHostLanRules.Mismatch);
                Assert.That(result.Code, Is.EqualTo("firewall_rules_mismatch"));
                Assert.That(result.Level, Is.EqualTo(TeamForgeHostLanLevel.Warning));
            }
            var unknown = TeamForgeHostLanResult.FromProbe(Target(), TeamForgeHostLanProfile.Unknown,
                TeamForgeHostLanRules.Matches, TeamForgeHostLanRules.Matches);
            Assert.That(unknown.Code, Is.EqualTo("profile_unknown"));
        }

        [Test]
        public void MatchingConfigurationKeepsGuestReachabilityUnverifiedAndReportPrivate()
        {
            var result = Matching(Target(53781, true, 1, "private-context-value"));
            Assert.That(result.Code, Is.EqualTo("configuration_matches"));
            Assert.That(result.Level, Is.EqualTo(TeamForgeHostLanLevel.Info));
            var report = result.ToReportString();
            Assert.That(report, Does.Contain("reachability is unverified"));
            Assert.That(report, Does.Not.Contain("192.0.2.19"));
            Assert.That(report, Does.Not.Contain("private-context-value"));
            Assert.That(result.CheckedAtUtc.Kind, Is.EqualTo(DateTimeKind.Utc));
            var planned = Matching(Target(5091, false));
            Assert.That(planned.Summary, Does.Contain("Selected settings only"));
            Assert.That(planned.Summary, Does.Contain("not verified as running"));
        }

        [Test]
        public async Task BeginCheckDoesNotBlockOnTheWorkerAndRejectsDuplicateChecks()
        {
            using (var release = new ManualResetEventSlim())
            using (var session = new TeamForgeHostLanSession((target, token) =>
            {
                release.Wait();
                return Matching(target);
            }))
            {
                session.UpdateTarget(Target());
                try
                {
                    var begun = Task.Run(() => session.BeginCheck());
                    await CompleteWithin(begun);
                    Assert.That(await begun, Is.True);
                    Assert.That(session.IsChecking, Is.True);
                    Assert.That(session.BeginCheck(), Is.False);
                    Assert.That(session.Result, Is.Null);
                    release.Set();
                    await PollResult(session);
                    Assert.That(session.Result.Code, Is.EqualTo("configuration_matches"));
                }
                finally { release.Set(); }
            }
        }

        [Test]
        public async Task LateResultForOldTargetCannotOverwriteNewTargetResult()
        {
            using (var releaseOld = new ManualResetEventSlim())
            {
                var oldStarted = new TaskCompletionSource<bool>();
                var oldFinished = new TaskCompletionSource<bool>();
                using (var session = new TeamForgeHostLanSession((target, token) =>
                {
                    if (target.SeedPort == 5091)
                    {
                        oldStarted.TrySetResult(true);
                        releaseOld.Wait(); // Deliberately ignores cancellation.
                        oldFinished.TrySetResult(true);
                        return TeamForgeHostLanResult.FromProbe(target, TeamForgeHostLanProfile.Public,
                            TeamForgeHostLanRules.Mismatch, TeamForgeHostLanRules.Mismatch);
                    }
                    return Matching(target);
                }))
                {
                    try
                    {
                        session.UpdateTarget(Target());
                        session.BeginCheck();
                        await CompleteWithin(oldStarted.Task);
                        session.UpdateTarget(Target(53781));
                        Assert.That(session.Result, Is.Null);
                        Assert.That(session.IsChecking, Is.False);
                        session.BeginCheck();
                        await PollResult(session);
                        var current = session.Result;
                        releaseOld.Set();
                        await CompleteWithin(oldFinished.Task);
                        session.Poll();
                        Assert.That(session.Result, Is.SameAs(current));
                        Assert.That(current.Code, Is.EqualTo("configuration_matches"));
                    }
                    finally { releaseOld.Set(); }
                }
            }
        }

        [Test]
        public async Task TimeoutRetiresNoncooperativeWorkerAndDiscardsItsLateSuccess()
        {
            using (var release = new ManualResetEventSlim())
            using (var session = new TeamForgeHostLanSession((target, token) =>
            {
                release.Wait();
                return Matching(target);
            }, 30))
            {
                try
                {
                    session.UpdateTarget(Target());
                    session.BeginCheck();
                    await PollResult(session);
                    Assert.That(session.Result.Code, Is.EqualTo("probe_timeout"));
                    Assert.That(session.IsChecking, Is.False);
                    var timedOut = session.Result;
                    release.Set();
                    session.Poll();
                    Assert.That(session.Result, Is.SameAs(timedOut));
                }
                finally { release.Set(); }
            }
        }

        [Test]
        public async Task WorkerFailureIsGenericAndCannotEchoPrivateErrors()
        {
            using (var session = new TeamForgeHostLanSession((target, token) =>
                throw new InvalidOperationException("private-stderr-access-code")))
            {
                session.UpdateTarget(Target());
                session.BeginCheck();
                await PollResult(session);
                Assert.That(session.Result.Code, Is.EqualTo("probe_failed"));
                Assert.That(session.Result.ToReportString(), Does.Not.Contain("private-stderr-access-code"));
            }
        }

        [Test]
        public async Task WorkerCancellationIsReportedWithoutBecomingAProfileVerdict()
        {
            using (var session = new TeamForgeHostLanSession((target, token) => throw new OperationCanceledException()))
            {
                session.UpdateTarget(Target());
                session.BeginCheck();
                await PollResult(session);
                Assert.That(session.Result.Code, Is.EqualTo("cancelled"));
                Assert.That(session.Result.Profile, Is.EqualTo(TeamForgeHostLanProfile.Unknown));
            }
        }

        [TestCase(false)]
        [TestCase(true)]
        public async Task CancelAndDisposeDiscardLateWorkerResults(bool dispose)
        {
            using (var release = new ManualResetEventSlim())
            {
                var started = new TaskCompletionSource<bool>();
                var finished = new TaskCompletionSource<bool>();
                var session = new TeamForgeHostLanSession((target, token) =>
                {
                    started.TrySetResult(true);
                    release.Wait();
                    finished.TrySetResult(true);
                    return Matching(target);
                });
                try
                {
                    session.UpdateTarget(Target());
                    session.BeginCheck();
                    await CompleteWithin(started.Task);
                    if (dispose) session.Dispose(); else session.Cancel();
                    Assert.That(session.IsChecking, Is.False);
                    Assert.That(session.Result, Is.Null);
                    release.Set();
                    await CompleteWithin(finished.Task);
                    Assert.That(session.Poll(), Is.False);
                    Assert.That(session.Result, Is.Null);
                    if (dispose) Assert.That(session.BeginCheck(), Is.False);
                }
                finally { release.Set(); session.Dispose(); }
            }
        }

        private static async Task CompleteWithin(Task task)
        {
            Assert.That(await Task.WhenAny(task, Task.Delay(3000)), Is.SameAs(task), "Controlled worker did not settle before the test deadline.");
            await task;
        }

        private static async Task PollResult(TeamForgeHostLanSession session)
        {
            var deadline = DateTime.UtcNow.AddSeconds(3);
            while (session.Result == null && DateTime.UtcNow < deadline)
            {
                session.Poll();
                if (session.Result == null) await Task.Delay(10);
            }
            Assert.That(session.Result, Is.Not.Null, "A completed or timed-out check did not produce a result.");
        }
    }
}

using System.Collections.Generic;
using System.Threading;
using NUnit.Framework;
using UnityEngine.UIElements;

namespace EunSung.TeamForge.Tests
{
    public sealed class TeamForgeHostLanDiagnosticsViewTests
    {
        private static TeamForgeHostLanTarget Target(string address = "192.0.2.19", long generation = 1)
        {
            return new TeamForgeHostLanTarget("http://" + address + ":5080", "0.0.0.0", 53781,
                true, generation, "private-context-not-for-report");
        }

        private static TeamForgeHostLanResult Matched(TeamForgeHostLanTarget target)
        {
            return TeamForgeHostLanResult.FromProbe(target, TeamForgeHostLanProfile.Private,
                TeamForgeHostLanRules.Matches, TeamForgeHostLanRules.Matches);
        }

        [Test]
        public void HomeDiagnosticRefreshDoesNotProbeAndExplicitCheckCopiesOnlySafeSnapshot()
        {
            var target = Target();
            var requests = 0;
            using (var view = new TeamForgeHostLanDiagnosticsView(new VisualElement(), () => target,
                () => false, (english, korean) => english, (captured, cancellation) =>
                {
                    Interlocked.Increment(ref requests);
                    return Matched(captured);
                }))
            {
                for (var index = 0; index < 5; index++) view.Refresh();
                Assert.That(requests, Is.Zero, "Doctor/UI refresh must never launch a probe.");
                view.Check();
                Assert.That(SpinWait.SpinUntil(() =>
                {
                    var report = new List<TeamForgeDoctorResult>();
                    view.AppendToReport(report);
                    return report[0].Message.Contains("configuration_matches");
                }, 5000), Is.True, "The explicit result must reach the UI report.");
                var completed = new List<TeamForgeDoctorResult>();
                view.AppendToReport(completed);
                Assert.That(requests, Is.EqualTo(1));
                Assert.That(completed[0].Message, Does.Contain("5080").And.Contain("53781"));
                Assert.That(completed[0].Message, Does.Contain("Guest reachability is unverified"));
                Assert.That(completed[0].Message, Does.Not.Contain("192.0.2.19"));
                Assert.That(completed[0].Message, Does.Not.Contain("private-context"));
            }
        }

        [Test]
        public void HomeDiagnosticReportNeverMarksCancelledWorkerAsPassing()
        {
            using (var view = new TeamForgeHostLanDiagnosticsView(new VisualElement(), () => Target(),
                () => false, (english, korean) => english, (captured, cancellation) =>
                {
                    throw new System.OperationCanceledException();
                }))
            {
                view.Check();
                var report = new List<TeamForgeDoctorResult>();
                Assert.That(SpinWait.SpinUntil(() =>
                {
                    report.Clear();
                    view.AppendToReport(report);
                    return report[0].Message.Contains("cancelled");
                }, 5000), Is.True);
                Assert.That(report[0].Level, Is.EqualTo(TeamForgeDoctorLevel.Warning));
            }
        }

        [Test]
        public void HomeDiagnosticDiscardsOldTargetAndWindowDisposalCancelsOwnedCheck()
        {
            var target = Target();
            using (var started = new ManualResetEventSlim())
            using (var retired = new ManualResetEventSlim())
            {
                var view = new TeamForgeHostLanDiagnosticsView(new VisualElement(), () => target,
                    () => false, (english, korean) => english, (captured, cancellation) =>
                    {
                        started.Set();
                        cancellation.WaitHandle.WaitOne();
                        retired.Set();
                        return Matched(captured);
                    });
                try
                {
                    view.Check();
                    Assert.That(started.Wait(5000), Is.True);
                    target = Target("192.0.2.20", 2);
                    view.Refresh();
                    Assert.That(retired.Wait(5000), Is.True);
                    var report = new List<TeamForgeDoctorResult>();
                    view.AppendToReport(report);
                    Assert.That(report[0].Message, Does.Contain("No completed local LAN check"));
                    Assert.That(report[0].Message, Does.Not.Contain("configuration_matches"));
                    started.Reset();
                    retired.Reset();
                    view.Check();
                    Assert.That(started.Wait(5000), Is.True);
                    view.Dispose();
                    Assert.That(retired.Wait(5000), Is.True);
                }
                finally { view.Dispose(); }
            }
        }
    }
}

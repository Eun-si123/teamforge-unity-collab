using System;
using System.Collections.Generic;
using System.Threading;
using UnityEngine.UIElements;

namespace EunSung.TeamForge
{
    // UI-thread adapter around the independently tested diagnostic session.
    // No polling path launches a process; only the explicit Check action does.
    internal sealed class TeamForgeHostLanDiagnosticsView : IDisposable
    {
        private readonly Func<TeamForgeHostLanTarget> _captureTarget;
        private readonly Func<bool> _settingsChanged;
        private readonly Func<string, string, string> _text;
        private readonly TeamForgeHostLanSession _session;
        private readonly Label _ports;
        private readonly Label _summary;
        private readonly Label _snapshot;
        private readonly Button _check;
        private readonly Button _cancel;
        private bool _disposed;

        internal TeamForgeHostLanDiagnosticsView(VisualElement parent,
            Func<TeamForgeHostLanTarget> captureTarget, Func<bool> settingsChanged,
            Func<string, string, string> text,
            Func<TeamForgeHostLanTarget, CancellationToken, TeamForgeHostLanResult> worker = null)
        {
            _captureTarget = captureTarget;
            _settingsChanged = settingsChanged;
            _text = text;
            _session = new TeamForgeHostLanSession(worker ?? TeamForgeWindowsFirewall.ReadHostLanDiagnostics);
            var section = new VisualElement();
            section.style.marginTop = 10;
            parent.Add(section);
            section.Add(new Label(_text("Host LAN configuration", "호스트 LAN 구성")));
            var hint = new Label(_text(
                "Read-only local snapshot. Guest reachability is unverified; other local policies may still block connections.",
                "로컬 구성을 읽기만 합니다. Guest 연결 가능 여부는 미검증이며 다른 로컬 정책이 연결을 차단할 수 있습니다."));
            hint.style.whiteSpace = WhiteSpace.Normal;
            section.Add(hint);
            _ports = new Label();
            _ports.style.whiteSpace = WhiteSpace.Normal;
            section.Add(_ports);
            var actions = new VisualElement();
            actions.style.flexDirection = FlexDirection.Row;
            actions.style.marginTop = 4;
            _check = new Button(Check) { text = _text("Check LAN configuration", "LAN 구성 확인") };
            _check.tooltip = _text("Checks the selected Host IPv4 profile and named firewall rule fields without changing them.",
                "선택한 호스트 IPv4의 네트워크 프로필과 이름 있는 방화벽 규칙 항목을 변경 없이 확인합니다.");
            _cancel = new Button(Cancel) { text = _text("Cancel check", "확인 취소") };
            actions.Add(_check);
            actions.Add(_cancel);
            section.Add(actions);
            _summary = new Label();
            _summary.style.whiteSpace = WhiteSpace.Normal;
            section.Add(_summary);
            _snapshot = new Label();
            _snapshot.style.whiteSpace = WhiteSpace.Normal;
            section.Add(_snapshot);
            Refresh();
        }

        internal void Check()
        {
            if (_disposed) return;
            _session.UpdateTarget(_captureTarget());
            _session.BeginCheck();
            Refresh();
        }

        internal void Cancel()
        {
            _session.Cancel();
            Refresh();
        }

        internal void Refresh()
        {
            if (_disposed) return;
            _session.UpdateTarget(_captureTarget());
            _session.Poll();
            var target = _session.Target;
            _check.SetEnabled(!_session.IsChecking);
            _cancel.SetEnabled(_session.IsChecking);
            _cancel.style.display = _session.IsChecking ? DisplayStyle.Flex : DisplayStyle.None;
            var scope = target.ActiveHost ? _text("Running Host snapshot", "실행 중인 호스트 스냅샷")
                : _text("Selected settings; Seed is not verified as running", "선택한 설정이며 Seed 실행은 미검증");
            var address = string.IsNullOrEmpty(target.HostIpv4) ? _text("unverified", "확인 불가") : target.HostIpv4;
            _ports.text = scope + "\n" + _text("Host IPv4", "호스트 IPv4") + ": " + address +
                " · " + _text("Coordinator advertised TCP", "Coordinator 광고 TCP") + ": " + Port(target.CoordinatorPort) +
                " · " + _text("Bound Seed TCP", "실행 중인 Seed TCP") + ": " + Port(target.SeedPort);
            var result = _session.Result;
            _summary.text = _session.IsChecking ? _text("Checking local profile and rule fields…", "로컬 프로필과 규칙 항목 확인 중…")
                : result == null ? _text("Not checked for this configuration.", "현재 구성은 아직 확인하지 않았습니다.")
                : Describe(result);
            _snapshot.text = result == null ? string.Empty : _text("Last check attempt", "마지막 점검 시도") + ": " +
                result.CheckedAtUtc.ToString("yyyy-MM-dd HH:mm:ss 'UTC'") + " · " +
                _text("Recheck after network changes.", "네트워크 변경 후 다시 확인하세요.");
            if (_settingsChanged())
                _snapshot.text += "\n" + _text(
                    "Saved settings differ from the running Host. This check uses its startup snapshot; restart Host to apply new settings.",
                    "저장된 설정이 실행 중인 호스트와 다릅니다. 시작 당시 구성을 검사하며 새 설정 적용에는 호스트 재시작이 필요합니다.");
        }

        internal void AppendToReport(List<TeamForgeDoctorResult> results)
        {
            if (_disposed) return;
            Refresh();
            var result = _session.Result;
            var target = _session.Target;
            var message = result == null
                ? "No completed local LAN check for this configuration. Guest reachability is unverified."
                : result.ToReportString();
            message += " Coordinator advertised TCP: " + Port(target.CoordinatorPort) +
                       "; bound Seed TCP: " + Port(target.SeedPort) + ".";
            if (_settingsChanged()) message += " Saved settings differ from the running Host snapshot.";
            results.Add(new TeamForgeDoctorResult("Host LAN configuration snapshot",
                result != null && result.Code == "configuration_matches" &&
                result.Level == TeamForgeHostLanLevel.Info && !_settingsChanged()
                    ? TeamForgeDoctorLevel.Pass : TeamForgeDoctorLevel.Warning, message));
        }

        private string Describe(TeamForgeHostLanResult result)
        {
            var korean = "프로필: " + result.Profile + ". Coordinator 규칙 항목: " + result.CoordinatorRules +
                         ". Seed 규칙 항목: " + result.SeedRules + ". ";
            switch (result.Code)
            {
                case "profile_mismatch": korean += result.Profile == TeamForgeHostLanProfile.DomainAuthenticated
                    ? "Private 전용 규칙은 Domain 프로필에 적용되지 않습니다. 네트워크 관리자에게 승인된 연결 방법을 문의하세요."
                    : "Private 전용 규칙은 Public 프로필에 적용되지 않습니다. 신뢰하는 LAN에서만 Windows 네트워크 설정을 검토하세요."; break;
                case "configuration_matches": korean += "예상 프로필/TCP 포트/LAN 범위 항목을 확인했습니다."; break;
                case "firewall_rules_mismatch": korean += "예상 프로필/TCP 포트/LAN 범위 항목과 다른 규칙이 있습니다."; break;
                case "probe_timeout": korean += "로컬 점검 시간이 초과됐습니다."; break;
                case "cancelled": korean += "점검이 취소되어 확인 결과가 없습니다."; break;
                case "local_only": korean += "로컬 전용 구성이므로 LAN 점검을 적용하지 않습니다."; break;
                default: korean += "일부 구성을 확인할 수 없습니다. 선택한 호스트 주소와 실행 상태를 확인하세요."; break;
            }
            return _text(result.Summary, korean + " Guest 연결 가능 여부는 미검증이며 다른 로컬 정책도 영향을 줄 수 있습니다.");
        }

        private string Port(int port) => port > 0 && port <= 65535 ? port.ToString() : _text("unverified", "미검증");

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;
            _session.Dispose();
        }
    }
}

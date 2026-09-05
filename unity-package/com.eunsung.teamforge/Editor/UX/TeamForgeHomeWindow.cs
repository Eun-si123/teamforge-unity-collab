using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.UIElements;

namespace EunSung.TeamForge
{
    public sealed class TeamForgeHomeWindow : EditorWindow
    {
        private const string UiLanguagePreferenceKey = "EunSung.TeamForge.UiLanguage";
        private const string PendingJoinCodeKey = "EunSung.TeamForge.PendingJoin.Code";
        private const string PendingJoinProjectUuidKey = "EunSung.TeamForge.PendingJoin.ProjectUuid";
        private const string PendingJoinExpiryTicksKey = "EunSung.TeamForge.PendingJoin.ExpiryTicks";
        private static readonly TimeSpan PendingJoinLifetime = TimeSpan.FromMinutes(15);

        private Label _roleLabel;
        private Label _headline;
        private Label _detail;
        private Label _projectValue;
        private Label _sessionValue;
        private Label _membersValue;
        private Label _healthValue;
        private TextField _inviteCodeField;
        private Button _startButton;
        private Button _joinButton;
        private Button _connectCurrentButton;
        private Button _copyInviteButton;
        private Button _copyProjectInviteButton;
        private Button _saveProjectInviteButton;
        private Button _stopHostButton;
        private Label _hostFlowStatus;
        private Button _leaveButton;
        private Button _fixButton;
        private Label _recoveryCodeValue;
        private Label _technicalDetailValue;
        private string _lastRecoveryCode = "none";
        private string _lastRecoveryDetail = string.Empty;
        private double _nextRefreshAt;
        private double _nextDoctorAt;
        private string _doctorSummary = "Checking…";

        [MenuItem("Window/TeamForge/Collaboration", priority = 100)]
        public static void Open()
        {
            var window = GetWindow<TeamForgeHomeWindow>();
            window.titleContent = new GUIContent("TeamForge");
            window.minSize = new Vector2(430, 560);
        }

        [InitializeOnLoadMethod]
        private static void RestorePendingInviteWindowAfterProjectSwitch()
        {
            EditorApplication.delayCall += () =>
            {
                if (HasPendingInviteForCurrentProject())
                {
                    Open();
                }
            };
        }

        private void OnEnable()
        {
            TeamForgeConnectionService.Changed += Refresh;
            TeamForgeProjectService.Changed += Refresh;
            TeamForgePresenceService.Registry.Changed += Refresh;
            TeamForgeHostFlow.Changed += Refresh;
        }

        private void OnDisable()
        {
            TeamForgeConnectionService.Changed -= Refresh;
            TeamForgeProjectService.Changed -= Refresh;
            TeamForgePresenceService.Registry.Changed -= Refresh;
            TeamForgeHostFlow.Changed -= Refresh;
        }

        public void CreateGUI()
        {
            var retainedInvite = _inviteCodeField?.value ?? string.Empty;
            var restoredPendingInvite = false;
            if (string.IsNullOrWhiteSpace(retainedInvite) && TryTakePendingInviteForCurrentProject(out var pendingInvite))
            {
                retainedInvite = pendingInvite;
                restoredPendingInvite = true;
            }

            var settings = TeamForgeConnectionService.Settings;
            settings.EnsureDefaults();

            rootVisualElement.Clear();
            rootVisualElement.style.paddingLeft = 12;
            rootVisualElement.style.paddingRight = 12;
            rootVisualElement.style.paddingTop = 10;
            rootVisualElement.style.paddingBottom = 10;

            var scroll = new ScrollView(ScrollViewMode.Vertical);
            scroll.style.flexGrow = 1;
            rootVisualElement.Add(scroll);

            var header = new VisualElement { style = { flexDirection = FlexDirection.Row } };
            scroll.Add(header);
            var title = new Label("TeamForge");
            title.style.fontSize = 22;
            title.style.unityFontStyleAndWeight = FontStyle.Bold;
            title.style.flexGrow = 1;
            header.Add(title);
            _roleLabel = new Label();
            _roleLabel.style.unityFontStyleAndWeight = FontStyle.Bold;
            header.Add(_roleLabel);

            AddLanguageSelector(scroll);

            var subtitle = new Label(T(
                "Start, invite, and collaborate. Technical settings stay out of the normal path.",
                "세션을 시작하거나 초대 코드로 참가해 협업하세요. 일반 사용에서는 기술 설정을 숨겨 둡니다."));
            subtitle.style.whiteSpace = WhiteSpace.Normal;
            subtitle.style.marginBottom = 10;
            scroll.Add(subtitle);

            var statusCard = Card(scroll);
            _headline = new Label();
            _headline.style.fontSize = 16;
            _headline.style.unityFontStyleAndWeight = FontStyle.Bold;
            statusCard.Add(_headline);
            _detail = new Label();
            _detail.style.whiteSpace = WhiteSpace.Normal;
            _detail.style.marginTop = 4;
            statusCard.Add(_detail);

            Section(
                scroll,
                T("Start or join", "시작 또는 참가"),
                T(
                    "Host: Start Collaboration preflights, reviews, explicitly publishes, starts the protected Server/Seed, and copies one signed Collaboration Invite. Guest TF1 session joining remains below.",
                    "호스트: 협업 시작은 보호된 서버/Seed를 시작하고 서명된 협업 초대 하나를 자동으로 복사합니다. 참가자: 아래에 TF1… 초대 코드를 붙여넣고 초대로 참가를 누르세요. 저장된 세션 연결은 초대 코드 입력칸을 사용하지 않습니다."));

            var startRow = new VisualElement { style = { flexDirection = FlexDirection.Row } };
            scroll.Add(startRow);
            _startButton = new Button(StartCollaboration)
            {
                text = T("Start Collaboration", "협업 시작"),
                tooltip = T(
                    "Runs the saved-source Publish Review and starts collaboration only after explicit Publish & Start approval.",
                    "이 프로젝트용 새 세션을 만들고 현재 에디터를 연결한 뒤 안전한 초대 코드를 클립보드에 복사합니다."),
            };
            LargeFlexButton(startRow, _startButton);

            _hostFlowStatus = new Label();
            _hostFlowStatus.style.whiteSpace = WhiteSpace.Normal;
            _hostFlowStatus.style.marginTop = 5;
            scroll.Add(_hostFlowStatus);

            var hostReadyActions = new VisualElement
            {
                style = { flexDirection = FlexDirection.Row, marginTop = 4 },
            };
            scroll.Add(hostReadyActions);
            _copyProjectInviteButton = new Button(CopyProjectTransferInvite)
            {
                text = T("Copy Collaboration Invite", "협업 초대 복사"),
                tooltip = T(
                    "Copies the one signed Host Ready invite used by the standalone Guest Launcher.",
                    "독립 실행형 Guest Launcher에서 사용하는 Host Ready 서명 초대 하나를 복사합니다."),
            };
            _saveProjectInviteButton = new Button(SaveProjectTransferInvite)
            {
                text = T("Save Collaboration Invite", "협업 초대 저장"),
                tooltip = T(
                    "Saves the signed, credential-free Collaboration Invite to a selected JSON file.",
                    "서명되고 자격 증명이 없는 협업 초대를 선택한 JSON 파일에 저장합니다."),
            };
            _stopHostButton = new Button(TeamForgeHostFlow.StopCollaboration)
            {
                text = T("Stop Collaboration", "협업 중지"),
                tooltip = T(
                    "Stops only the WP2-owned Seed and Coordinator. Approved metadata and Project data are preserved.",
                    "WP2가 소유한 Seed와 Coordinator만 중지합니다. 승인된 메타데이터와 프로젝트 데이터는 보존됩니다."),
            };
            AddFlexButton(hostReadyActions, _copyProjectInviteButton);
            AddFlexButton(hostReadyActions, _saveProjectInviteButton);
            AddFlexButton(hostReadyActions, _stopHostButton);

            _inviteCodeField = new TextField(T("Invite code", "초대 코드"))
            {
                value = retainedInvite,
                isDelayed = false,
                tooltip = T(
                    "Paste the TF1… code copied by the host. Invite codes do not contain the Bearer token or private keys.",
                    "호스트가 복사한 TF1… 코드를 붙여넣으세요. 초대 코드에는 Bearer 토큰이나 개인 키가 들어가지 않습니다."),
            };
            _inviteCodeField.style.marginTop = 8;
            scroll.Add(_inviteCodeField);

            var inviteActions = new VisualElement { style = { flexDirection = FlexDirection.Row, marginTop = 4 } };
            scroll.Add(inviteActions);
            var pasteInviteButton = new Button(PasteInviteFromClipboard)
            {
                text = T("Paste", "붙여넣기"),
                tooltip = T(
                    "Copies the current system clipboard into the invite field. This does not connect yet.",
                    "현재 시스템 클립보드 내용을 초대 코드 입력칸에 넣습니다. 이 단계에서는 아직 연결하지 않습니다."),
            };
            _joinButton = new Button(JoinInvite)
            {
                text = T("Join Invite", "초대로 참가"),
                tooltip = T(
                    "Validates the invite, Project identity, and saved Scene baseline before connecting.",
                    "연결 전에 초대 코드, 프로젝트 정체성, 저장된 Scene 기준 상태가 일치하는지 검사합니다."),
            };
            AddFlexButton(inviteActions, pasteInviteButton);
            AddFlexButton(inviteActions, _joinButton);

            var inviteSafety = new HelpBox(
                T(
                    "A session invite connects collaborators; it does not silently replace Project files. If this Editor has a different Project identity, TeamForge will help you choose the matching host Project or open Project Bootstrap guidance.",
                    "세션 초대는 협업 세션에 연결하는 기능이며 프로젝트 파일을 몰래 덮어쓰지 않습니다. 현재 에디터의 프로젝트 정체성이 다르면 TeamForge가 일치하는 호스트 프로젝트를 선택하거나 Project Bootstrap 안내로 이동하도록 도와줍니다."),
                HelpBoxMessageType.Info);
            inviteSafety.style.marginTop = 5;
            scroll.Add(inviteSafety);

            var connectedActions = new VisualElement { style = { flexDirection = FlexDirection.Row, marginTop = 8 } };
            scroll.Add(connectedActions);
            _connectCurrentButton = new Button(ConnectCurrentSession)
            {
                text = T("Connect Saved Session", "저장된 세션 연결"),
                tooltip = T(
                    "Reconnects using the Project ID and Session ID already saved in this Unity Project. It does NOT read the invite field or clipboard.",
                    "이 Unity 프로젝트에 이미 저장된 Project ID와 Session ID로 다시 연결합니다. 초대 코드 입력칸이나 클립보드는 사용하지 않습니다."),
            };
            _leaveButton = new Button(LeaveSession)
            {
                text = T("Leave", "나가기"),
                tooltip = T("Disconnects this Editor from TeamForge.", "현재 에디터의 TeamForge 연결을 끊습니다."),
            };
            AddFlexButton(connectedActions, _connectCurrentButton);
            AddFlexButton(connectedActions, _leaveButton);

            var userName = new TextField(T("Your name", "내 이름"))
            {
                value = settings.UserName,
                isDelayed = true,
                tooltip = T(
                    "Display name shown to other collaborators in this session.",
                    "이 세션의 다른 협업자에게 표시되는 이름입니다."),
            };
            userName.style.marginTop = 8;
            userName.RegisterValueChangedCallback(evt =>
            {
                settings.UserName = evt.newValue ?? string.Empty;
                settings.SaveSettings();
            });
            scroll.Add(userName);

            Section(
                scroll,
                T("Session", "세션"),
                T(
                    "Shows the local Project identity, saved session, and how many collaborators are connected to this exact session.",
                    "현재 로컬 프로젝트 정체성, 저장된 세션, 그리고 이 정확한 세션에 연결된 협업자 수를 표시합니다."));
            _projectValue = Row(scroll, T("Project", "프로젝트"));
            _sessionValue = Row(scroll, T("Session", "세션"));
            _membersValue = Row(scroll, T("People", "인원"));

            Section(
                scroll,
                T("Health", "상태 점검"),
                T(
                    "TeamForge Doctor checks safe local prerequisites. Warnings can be inspected without weakening Project or Scene identity checks.",
                    "TeamForge Doctor가 안전한 로컬 사전 조건을 점검합니다. 프로젝트/Scene 정체성 검사를 약화시키지 않고 경고를 확인할 수 있습니다."));
            var healthCard = Card(scroll);
            _healthValue = new Label();
            _healthValue.style.whiteSpace = WhiteSpace.Normal;
            healthCard.Add(_healthValue);
            var healthActions = new VisualElement { style = { flexDirection = FlexDirection.Row, marginTop = 6 } };
            healthCard.Add(healthActions);
            _fixButton = new Button(FixSafeIssues)
            {
                text = T("Fix Safe Issues", "안전한 문제 수정"),
                tooltip = T(
                    "Attempts only safe automatic fixes such as missing local defaults. It does not bypass identity validation.",
                    "누락된 로컬 기본값처럼 안전하게 자동 수정할 수 있는 항목만 처리합니다. 정체성 검사를 우회하지 않습니다."),
            };
            AddFlexButton(healthActions, _fixButton);
            AddFlexButton(healthActions, new Button(CopyDoctorReport)
            {
                text = T("Copy Report", "보고서 복사"),
                tooltip = T(
                    "Copies a diagnostic report without stored authentication secrets.",
                    "저장된 인증 비밀정보를 제외한 진단 보고서를 복사합니다."),
            });

            var technicalDetails = new Foldout
            {
                text = T("Advanced / Technical Details", "고급 / 기술 세부 정보"),
                value = false,
                tooltip = T(
                    "Shows stable failure identity and copyable current-run diagnostics. Secrets are redacted.",
                    "안정적인 실패 식별자와 복사 가능한 현재 실행 진단을 표시합니다. 비밀정보는 제거됩니다."),
            };
            technicalDetails.style.marginTop = 8;
            scroll.Add(technicalDetails);
            _recoveryCodeValue = Row(technicalDetails, T("Stable code", "안정 코드"));
            _technicalDetailValue = Row(technicalDetails, T("Current detail", "현재 세부 정보"));
            _technicalDetailValue.style.whiteSpace = WhiteSpace.Normal;
            AddFlexButton(technicalDetails, new Button(CopyRecoveryDiagnostics)
            {
                text = T("Copy diagnostics", "진단 복사"),
                tooltip = T(
                    "Copies bounded current-run diagnostics without access codes, bearer tokens, or private keys.",
                    "액세스 코드, Bearer 토큰, 개인 키를 제외한 제한된 현재 실행 진단을 복사합니다."),
            });

            Section(
                scroll,
                T("Developer shortcuts", "개발자 바로가기"),
                T(
                    "Testing and advanced diagnostics. Normal collaborators usually do not need these controls.",
                    "테스트와 고급 진단 기능입니다. 일반 협업자는 보통 사용할 필요가 없습니다."));
            var devActions = new VisualElement { style = { flexDirection = FlexDirection.Row } };
            scroll.Add(devActions);
            AddFlexButton(devActions, new Button(CreateQuickLab)
            {
                text = "Quick A/B/C Lab",
                tooltip = T(
                    "Creates the standard multi-Editor A/B/C test lab, including the late-join setup.",
                    "Late Join 구성을 포함한 표준 다중 에디터 A/B/C 테스트 랩을 만듭니다."),
            });
            AddFlexButton(devActions, new Button(TeamForgeTestLabWindow.Open)
            {
                text = "Test Lab",
                tooltip = T("Opens detailed TeamForge test-lab controls.", "TeamForge 테스트 랩의 상세 제어 화면을 엽니다."),
            });
            AddFlexButton(devActions, new Button(TeamForgeWindow.Open)
            {
                text = T("Advanced", "고급"),
                tooltip = T("Opens the full technical TeamForge window.", "전체 기술 설정이 있는 TeamForge 고급 창을 엽니다."),
            });

            var advanced = new Foldout
            {
                text = T("Manual connection settings", "수동 연결 설정"),
                value = false,
                tooltip = T(
                    "Low-level saved connection values. Most users should use Start Collaboration or an invite instead.",
                    "저수준 연결 저장값입니다. 대부분의 사용자는 협업 시작 또는 초대 코드 참가를 사용하면 됩니다."),
            };
            advanced.style.marginTop = 10;
            scroll.Add(advanced);
            AddDelayedTextField(advanced, T("Guest address", "Guest 주소"), settings.ServerAddress, value => settings.ServerAddress = value,
                T("Address placed in invites. For two PCs, use the Host's reachable LAN address, never 127.0.0.1 or a bind wildcard.", "초대에 들어가는 주소입니다. 두 PC에서는 127.0.0.1이나 바인드 와일드카드가 아닌, Guest PC에서 도달 가능한 Host LAN 주소를 사용하세요."));
            AddDelayedTextField(advanced, T("Coordinator listen address", "Coordinator 수신 주소"), settings.CoordinatorListenHost, value => settings.CoordinatorListenHost = value,
                T("0.0.0.0 accepts LAN connections and requires a Server access code. Use 127.0.0.1 only for explicit same-PC testing.", "0.0.0.0은 LAN 연결을 수신하며 서버 액세스 코드가 필요합니다. 명시적인 동일 PC 테스트에만 127.0.0.1을 사용하세요."));
            AddDelayedTextField(advanced, "Realtime Path", settings.RealtimePath, value => settings.RealtimePath = value,
                T("WebSocket path used by realtime collaboration.", "실시간 협업에 사용하는 WebSocket 경로입니다."));
            AddDelayedTextField(advanced, "Project ID", settings.ProjectId, value => settings.ProjectId = value,
                T("Routing ID for the TeamForge Project. This is not the Project UUID identity.", "TeamForge 프로젝트의 라우팅 ID입니다. 프로젝트 UUID 정체성과는 다른 값입니다."));
            AddDelayedTextField(advanced, "Session ID", settings.SessionId, value => settings.SessionId = value,
                T("Exact collaboration session to reconnect to.", "다시 연결할 정확한 협업 세션 ID입니다."));
            var token = new TextField(T("Server access code (Bearer Token)", "서버 액세스 코드 (Bearer Token)"))
            {
                value = settings.AuthenticationToken,
                isPasswordField = true,
                isDelayed = true,
                tooltip = T(
                    "Stored only in this Project's UserSettings. Join codes never include this value.",
                    "이 프로젝트의 UserSettings에만 저장됩니다. 초대 코드에는 이 값이 절대 포함되지 않습니다."),
            };
            token.RegisterValueChangedCallback(evt =>
            {
                settings.AuthenticationToken = evt.newValue ?? string.Empty;
                settings.SaveSettings();
                RefreshDoctorNow();
            });
            advanced.Add(token);
            _copyInviteButton = new Button(CopyInvite)
            {
                text = T("Copy session-only TF1 code", "세션 전용 TF1 코드 복사"),
                tooltip = T(
                    "Advanced: copies only the TF1 realtime code for collaborators who already have the exact Project. It is not accepted by the standalone Guest Launcher.",
                    "고급: 정확한 프로젝트가 이미 있는 협업자용 TF1 실시간 코드만 복사합니다. 독립 실행형 Guest Launcher에서는 사용할 수 없습니다."),
            };
            advanced.Add(_copyInviteButton);
            if (TeamForgeWindowsFirewall.IsSupportedPlatform)
            {
                var cleanupRow = new VisualElement();
                cleanupRow.style.flexDirection = FlexDirection.Row;
                cleanupRow.style.alignItems = Align.Center;

                var cleanupToggle = new Toggle(T(
                    "Remove LAN firewall rules when Host stops",
                    "호스트 중지 시 LAN 방화벽 규칙 제거"))
                {
                    value = settings.RemoveLanFirewallRulesOnStop,
                    tooltip = T(
                        "On: stop listeners first, then remove TeamForge's two named LAN rules. Off: keep the narrow Private/LocalSubnet rules for faster restart.",
                        "켜짐: 수신 리스너를 먼저 중지한 뒤 TeamForge의 이름 있는 LAN 규칙 두 개를 제거합니다. 꺼짐: 빠른 재시작을 위해 좁은 Private/LocalSubnet 규칙을 유지합니다."),
                };
                cleanupToggle.style.flexGrow = 1;
                cleanupToggle.RegisterValueChangedCallback(evt =>
                {
                    settings.RemoveLanFirewallRulesOnStop = evt.newValue;
                    settings.SaveSettings();
                });
                cleanupRow.Add(cleanupToggle);

                var cleanupInfo = new Button(ShowWindowsLanFirewallCleanupInfo)
                {
                    text = "ⓘ",
                    tooltip = T(
                        "Explain the security and UAC trade-off for firewall cleanup on Host stop.",
                        "호스트 중지 시 방화벽 정리의 보안/UAC 차이를 설명합니다."),
                };
                cleanupInfo.style.width = 30;
                cleanupInfo.style.minWidth = 30;
                cleanupInfo.style.marginLeft = 4;
                cleanupRow.Add(cleanupInfo);
                advanced.Add(cleanupRow);

                advanced.Add(new Button(RemoveWindowsLanFirewallRules)
                {
                    text = T("Remove TeamForge LAN firewall rules", "TeamForge LAN 방화벽 규칙 제거"),
                    tooltip = T(
                        "After stopping Host collaboration, removes only the two named TeamForge Coordinator/Seed LAN rules. Administrator approval is required when rules are present.",
                        "호스트 협업을 중지한 뒤 TeamForge가 만든 Coordinator/Seed LAN 규칙 두 개만 제거합니다. 규칙이 있으면 관리자 승인이 필요합니다."),
                });
            }

            var security = new HelpBox(
                T(
                    "Invites do not contain Bearer tokens or private keys. A mismatched Project is never forced; TeamForge offers a safe matching-Project/Bootstrap recovery flow before connecting.",
                    "초대 코드에는 Bearer 토큰이나 개인 키가 들어가지 않습니다. 프로젝트가 다르면 정체성을 강제로 바꾸지 않고, 연결 전에 안전한 일치 프로젝트 선택/Bootstrap 복구 절차를 제공합니다."),
                HelpBoxMessageType.Info);
            security.style.marginTop = 8;
            scroll.Add(security);

            RefreshDoctorNow();
            Refresh();
            if (restoredPendingInvite)
            {
                EditorApplication.delayCall += () =>
                {
                    if (this != null)
                    {
                        ShowNotification(new GUIContent(T(
                            "Matching Project opened · invite restored",
                            "일치하는 프로젝트 열림 · 초대 코드 복원됨")));
                    }
                };
            }
        }

        private void Update()
        {
            var now = EditorApplication.timeSinceStartup;
            if (now >= _nextDoctorAt)
            {
                _nextDoctorAt = now + 2.0;
                RefreshDoctorNow();
            }
            if (now < _nextRefreshAt) return;
            _nextRefreshAt = now + 0.5;
            Refresh();
        }

        private void AddLanguageSelector(VisualElement parent)
        {
            var languageRow = new VisualElement
            {
                style =
                {
                    flexDirection = FlexDirection.Row,
                    justifyContent = Justify.FlexEnd,
                    marginTop = 2,
                    marginBottom = 6,
                },
            };
            parent.Add(languageRow);

            var info = InfoLabel(T(
                "Language affects the Collaboration home UI. Auto follows the operating-system language when Korean is detected; otherwise it uses English.",
                "언어는 Collaboration 홈 UI에 적용됩니다. 자동은 운영체제가 한국어면 한국어를 사용하고, 그 외에는 영어를 사용합니다."));
            info.style.marginRight = 6;
            languageRow.Add(info);

            var choices = new List<string> { "Auto", "English", "한국어" };
            var saved = EditorPrefs.GetString(UiLanguagePreferenceKey, "Auto");
            var index = string.Equals(saved, "English", StringComparison.Ordinal) ? 1 :
                string.Equals(saved, "Korean", StringComparison.Ordinal) ? 2 : 0;
            var language = new PopupField<string>(T("Language", "언어"))
            {
                choices = choices,
                tooltip = T(
                    "Choose Auto, English, or Korean for this TeamForge home window.",
                    "TeamForge 홈 창에서 사용할 언어를 자동, 영어, 한국어 중에서 선택합니다."),
            };
            language.SetValueWithoutNotify(choices[index]);
            language.style.minWidth = 170;
            language.RegisterValueChangedCallback(evt =>
            {
                var preference = evt.newValue == "한국어" ? "Korean" : evt.newValue == "English" ? "English" : "Auto";
                EditorPrefs.SetString(UiLanguagePreferenceKey, preference);
                EditorApplication.delayCall += RebuildLocalizedUi;
            });
            languageRow.Add(language);
        }

        private void RebuildLocalizedUi()
        {
            if (this == null) return;
            CreateGUI();
        }

        private void RefreshDoctorNow()
        {
            try
            {
                var results = TeamForgeDoctor.Run();
                _doctorSummary = TeamForgeDoctor.Summary(results);
            }
            catch (Exception exception)
            {
                _doctorSummary = T(
                    $"Doctor could not run ({exception.GetType().Name}).",
                    $"Doctor를 실행할 수 없습니다 ({exception.GetType().Name}).");
            }
            Refresh();
        }

        private void Refresh()
        {
            if (_headline == null) return;

            var settings = TeamForgeConnectionService.Settings;
            settings.EnsureDefaults();
            var descriptor = TeamForgeProjectService.Descriptor;
            var state = TeamForgeConnectionService.State;
            var connected = state == TeamForgeConnectionState.Connected;
            var busy = state == TeamForgeConnectionState.Connecting ||
                       state == TeamForgeConnectionState.Handshaking ||
                       state == TeamForgeConnectionState.Disconnecting ||
                       state == TeamForgeConnectionState.Reconnecting;

            var role = TeamForgeQuickStartUtility.TestLabRole();
            _roleLabel.text = string.IsNullOrWhiteSpace(role)
                ? string.Empty
                : T($"Test Lab · {role}", $"테스트 랩 · {role}");

            if (TeamForgeHostFlow.State == TeamForgeHostFlowState.Ready)
            {
                _headline.text = T("✓ Host Ready", "✓ 호스트 준비 완료");
                _detail.text = TeamForgeHostFlow.Detail;
            }
            else if (TeamForgeHostFlow.IsBusy)
            {
                _headline.text = T("… Preparing Host", "… 호스트 준비 중");
                _detail.text = TeamForgeHostFlow.Detail;
            }
            else if (TeamForgeHostFlow.State == TeamForgeHostFlowState.NeedsAction)
            {
                _headline.text = T("⚠ Host needs attention", "⚠ 호스트 확인 필요");
                _detail.text = TeamForgeHostFlow.Detail;
            }
            else if (connected)
            {
                var hierarchyWaiting = TeamForgeConnectionService.HierarchySyncAvailable &&
                                       !TeamForgeHierarchySyncService.SnapshotReady;
                if (hierarchyWaiting)
                {
                    _headline.text = T("⚠ Collaboration partially ready", "⚠ 협업 일부 준비됨");
                    _detail.text = T(
                        $"Realtime: connected · Hierarchy: {TeamForgeHierarchySyncService.Status} · " +
                        $"Transform: {(TeamForgeConnectionService.TransformSyncAvailable ? "ready" : "unavailable")}",
                        $"실시간: 연결됨 · Hierarchy: {TeamForgeHierarchySyncService.Status} · " +
                        $"Transform: {(TeamForgeConnectionService.TransformSyncAvailable ? "준비됨" : "사용 불가")}");
                }
                else
                {
                    _headline.text = T("● Collaboration active", "● 협업 활성화됨");
                    _detail.text = T(
                        $"Hierarchy: {TeamForgeHierarchySyncService.Status} · " +
                        $"Transform: {(TeamForgeConnectionService.TransformSyncAvailable ? "ready" : "unavailable")}",
                        $"Hierarchy: {TeamForgeHierarchySyncService.Status} · " +
                        $"Transform: {(TeamForgeConnectionService.TransformSyncAvailable ? "준비됨" : "사용 불가")}");
                }
            }
            else if (busy)
            {
                _headline.text = T("◐ Connecting…", "◐ 연결 중…");
                _detail.text = string.IsNullOrWhiteSpace(TeamForgeConnectionService.LastError)
                    ? T("TeamForge is establishing the collaboration session.", "TeamForge가 협업 세션에 연결하고 있습니다.")
                    : TeamForgeQuickStartUtility.FriendlyConnectionError(TeamForgeConnectionService.LastError);
            }
            else if (!string.IsNullOrWhiteSpace(TeamForgeConnectionService.LastError))
            {
                _headline.text = T("⚠ Needs attention", "⚠ 확인 필요");
                _detail.text = TeamForgeQuickStartUtility.FriendlyConnectionError(TeamForgeConnectionService.LastError);
            }
            else if (descriptor == null)
            {
                _headline.text = T("○ Ready to start", "○ 시작 준비됨");
                _detail.text = T(
                    "Start Collaboration will set up this Project automatically.",
                    "협업 시작을 누르면 이 프로젝트를 자동으로 설정합니다.");
            }
            else
            {
                _headline.text = T("○ Ready", "○ 준비됨");
                _detail.text = T(
                    "Start a new session, join with an invite code, or reconnect the saved session.",
                    "새 세션을 시작하거나 초대 코드로 참가하거나 저장된 세션에 다시 연결할 수 있습니다.");
            }

            _projectValue.text = descriptor == null
                ? T("Will be created automatically", "자동으로 생성 예정")
                : $"{settings.ProjectId} · {TeamForgeQuickStartUtility.ShortProjectIdentity()}";
            _sessionValue.text = string.IsNullOrWhiteSpace(settings.SessionId) ? "—" : settings.SessionId;
            _membersValue.text = connected
                ? T(
                    $"{TeamForgePresenceService.RemoteMembers().Count + 1} connected",
                    $"{TeamForgePresenceService.RemoteMembers().Count + 1}명 연결됨")
                : T("Offline", "오프라인");
            _healthValue.text = _doctorSummary;
            if (TeamForgeHostFlow.State == TeamForgeHostFlowState.NeedsAction)
            {
                _lastRecoveryCode = TeamForgeHostFlow.ErrorCode;
                _lastRecoveryDetail = TeamForgeHostFlow.Detail;
            }
            _recoveryCodeValue.text = string.IsNullOrWhiteSpace(_lastRecoveryCode) ? "none" : _lastRecoveryCode;
            _technicalDetailValue.text = string.IsNullOrWhiteSpace(_lastRecoveryDetail) ? "—" : _lastRecoveryDetail;

            if (_hostFlowStatus != null)
            {
                _hostFlowStatus.text = TeamForgeHostFlow.Detail;
            }

            _startButton.SetEnabled(!connected && !busy && !TeamForgeHostFlow.IsBusy &&
                                    TeamForgeHostFlow.State != TeamForgeHostFlowState.Ready);
            _joinButton.SetEnabled(!connected && !busy);
            if (_inviteCodeField != null)
            {
                _inviteCodeField.SetEnabled(!connected && !busy);
            }
            _connectCurrentButton.SetEnabled(!connected && !busy && descriptor != null && !string.IsNullOrWhiteSpace(settings.SessionId));
            _copyInviteButton.SetEnabled(descriptor != null && !string.IsNullOrWhiteSpace(settings.SessionId));
            _leaveButton.SetEnabled(connected || busy || TeamForgeConnectionService.ConnectionDesired);
            _fixButton.SetEnabled(!busy);
            _copyProjectInviteButton?.SetEnabled(TeamForgeHostFlow.HasCollaborationInvite);
            _saveProjectInviteButton?.SetEnabled(TeamForgeHostFlow.HasCollaborationInvite);
            _stopHostButton?.SetEnabled(TeamForgeHostFlow.State == TeamForgeHostFlowState.Ready &&
                                        !TeamForgeHostFlow.IsBusy);
        }

        private void StartCollaboration()
        {
            TeamForgeHostFlow.StartCollaboration();
            Refresh();
        }

        private void CopyProjectTransferInvite()
        {
            if (!TeamForgeHostFlow.CopyCollaborationInvite(out var error))
            {
                if (!string.IsNullOrWhiteSpace(error)) EditorUtility.DisplayDialog("TeamForge Host", error, "OK");
                return;
            }
            ShowNotification(new GUIContent(T("Signed Collaboration Invite copied", "서명된 협업 초대 복사됨")));
        }

        private void SaveProjectTransferInvite()
        {
            if (!TeamForgeHostFlow.SaveCollaborationInvite(out var error) && !string.IsNullOrWhiteSpace(error))
            {
                EditorUtility.DisplayDialog("TeamForge Host", error, "OK");
            }
        }

        private void PasteInviteFromClipboard()
        {
            if (_inviteCodeField == null) return;
            _inviteCodeField.value = EditorGUIUtility.systemCopyBuffer ?? string.Empty;
            _inviteCodeField.Focus();
            ShowNotification(new GUIContent(T("Invite pasted · review and join", "초대 코드 붙여넣음 · 확인 후 참가하세요")));
        }

        private void JoinInvite()
        {
            if (TeamForgeConnectionService.ConnectionDesired ||
                TeamForgeConnectionService.State == TeamForgeConnectionState.Connected)
            {
                EditorUtility.DisplayDialog(
                    "TeamForge",
                    T("Leave the current session before joining another one.", "다른 세션에 참가하려면 현재 세션에서 먼저 나가세요."),
                    "OK");
                return;
            }

            var code = _inviteCodeField?.value?.Trim() ?? string.Empty;
            if (string.IsNullOrWhiteSpace(code))
            {
                EditorUtility.DisplayDialog(
                    T("TeamForge Invite", "TeamForge 초대"),
                    T("Paste an invite code into the Invite code field first.", "먼저 초대 코드 입력칸에 초대 코드를 붙여넣으세요."),
                    "OK");
                return;
            }

            JoinCode(code);
        }

        private void JoinCode(string code)
        {
            if (!TeamForgeJoinCode.TryParse(code, out var payload, out var parseError))
            {
                ShowRecovery("invalid_join_code", parseError);
                return;
            }

            var projectCompatibility = TeamForgeJoinCode.EvaluateProjectCompatibility(
                payload,
                TeamForgeProjectService.Descriptor);
            if (projectCompatibility != TeamForgeJoinProjectCompatibility.Compatible)
            {
                ShowProjectCompatibilityAssistant(payload, code, projectCompatibility);
                return;
            }

            if (!EditorUtility.DisplayDialog(
                    T("Join TeamForge Session?", "TeamForge 세션에 참가할까요?"),
                    DescribeInvite(payload),
                    T("Join", "참가"),
                    T("Cancel", "취소")))
            {
                return;
            }

            if (!TeamForgeQuickStartUtility.TryJoinCode(code, true, out var error, out var failureCode))
            {
                ShowRecovery(failureCode, error);
                RefreshDoctorNow();
                return;
            }

            TeamForgeConnectionService.Connect();
            ShowNotification(new GUIContent(T("Joining TeamForge session…", "TeamForge 세션 참가 중…")));
            RefreshDoctorNow();
        }

        private void ShowProjectCompatibilityAssistant(
            TeamForgeJoinCodePayload payload,
            string code,
            TeamForgeJoinProjectCompatibility compatibility)
        {
            var localDescriptor = TeamForgeProjectService.Descriptor;
            var localIdentity = localDescriptor == null
                ? T("not configured", "설정되지 않음")
                : ShortIdentity(localDescriptor.projectUuid);
            var hostIdentity = ShortIdentity(payload?.projectUuid);
            var reason = compatibility == TeamForgeJoinProjectCompatibility.LocalProjectIdentityMissing
                ? T(
                    "This Unity Project has no matching TeamForge Project identity yet.",
                    "현재 Unity 프로젝트에는 일치하는 TeamForge 프로젝트 정체성이 아직 없습니다.")
                : T(
                    "This Unity Project belongs to a different TeamForge Project.",
                    "현재 Unity 프로젝트는 다른 TeamForge 프로젝트입니다.");

            var message = T(
                $"The invite itself is valid, but TeamForge will not force Project identity or overwrite this open Project.\n\n{reason}\nHost Project: {hostIdentity}\nCurrent Project: {localIdentity}\n\nIf you already have a copy/sync of the host Project, choose it now. If you do not have it yet, open the transfer guide.",
                $"초대 코드 자체는 정상입니다. 하지만 TeamForge는 프로젝트 정체성을 강제로 바꾸거나 현재 열린 프로젝트를 덮어쓰지 않습니다.\n\n{reason}\n호스트 프로젝트: {hostIdentity}\n현재 프로젝트: {localIdentity}\n\n호스트 프로젝트의 복사본/동기화본이 이미 있다면 지금 선택하세요. 아직 없다면 프로젝트 받기 안내를 여세요.");

            var action = EditorUtility.DisplayDialogComplex(
                T("Host Project Required", "호스트 프로젝트가 필요합니다"),
                message,
                T("Choose Matching Project", "일치하는 프로젝트 선택"),
                T("Cancel", "취소"),
                T("Get Host Project", "호스트 프로젝트 받기"));

            if (action == 0)
            {
                ChooseAndOpenMatchingProject(payload, code);
            }
            else if (action == 2)
            {
                ShowProjectTransferGuide(payload);
            }
        }

        private void ChooseAndOpenMatchingProject(TeamForgeJoinCodePayload payload, string code)
        {
            if (payload == null || string.IsNullOrWhiteSpace(payload.projectUuid))
            {
                EditorUtility.DisplayDialog(
                    T("TeamForge Invite", "TeamForge 초대"),
                    T("This invite does not contain a Project identity to match.", "이 초대 코드에는 확인할 프로젝트 정체성이 없습니다."),
                    "OK");
                return;
            }

            var folder = EditorUtility.OpenFolderPanel(
                T("Choose the host Unity Project", "호스트 Unity 프로젝트 선택"),
                string.Empty,
                string.Empty);
            if (string.IsNullOrWhiteSpace(folder))
            {
                return;
            }

            if (!TeamForgeJoinProjectLocator.TryValidateMatchingProjectFolder(
                    folder,
                    payload.projectUuid,
                    out _,
                    out var error))
            {
                EditorUtility.DisplayDialog(
                    T("That Project Does Not Match", "프로젝트가 일치하지 않습니다"),
                    T(
                        $"TeamForge did not open that folder.\n\n{error}\n\nChoose the actual copy/sync of the host Project. Do not edit ProjectSettings/TeamForgeProject.json to bypass this check.",
                        $"TeamForge가 해당 폴더를 열지 않았습니다.\n\n{error}\n\n실제 호스트 프로젝트의 복사본/동기화본을 선택하세요. 이 검사를 우회하려고 ProjectSettings/TeamForgeProject.json을 수정하면 안 됩니다."),
                    "OK");
                return;
            }

            if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo())
            {
                return;
            }

            StorePendingInvite(code, payload.projectUuid);
            TeamForgeDiagnostics.Info(
                "A matching host Project was selected. The secret-free session invite will be restored after Unity opens that Project.");
            EditorApplication.OpenProject(folder);
        }

        private void ShowProjectTransferGuide(TeamForgeJoinCodePayload payload)
        {
            var project = payload == null || string.IsNullOrWhiteSpace(payload.projectId)
                ? T("the host Project", "호스트 프로젝트")
                : payload.projectId.Trim();
            var message = T(
                $"The TF1 session invite intentionally does not contain Project files.\n\nTo join {project}:\n1. Get a trusted copy/sync of the host Unity Project, OR use TeamForge Project Transfer (Publish → Project Invite → Sync).\n2. Keep ProjectSettings/TeamForgeProject.json from the host Project unchanged.\n3. Open that downloaded/copied Project in Unity.\n4. Paste the same TF1 invite and join.\n\nThe Advanced window contains Project Bootstrap controls for the transfer workflow.",
                $"TF1 세션 초대에는 의도적으로 프로젝트 파일이 들어있지 않습니다.\n\n{project}에 참가하려면:\n1. 신뢰할 수 있는 호스트 Unity 프로젝트 복사본/동기화본을 받거나 TeamForge Project Transfer(Publish → Project Invite → Sync)를 사용합니다.\n2. 호스트 프로젝트의 ProjectSettings/TeamForgeProject.json을 그대로 유지합니다.\n3. 받은 프로젝트를 Unity에서 엽니다.\n4. 같은 TF1 초대 코드를 붙여넣고 참가합니다.\n\n고급 창의 Project Bootstrap에서 프로젝트 전송 절차를 사용할 수 있습니다.");

            var action = EditorUtility.DisplayDialogComplex(
                T("Get the Host Project", "호스트 프로젝트 받기"),
                message,
                T("Open Project Bootstrap", "Project Bootstrap 열기"),
                T("Close", "닫기"),
                T("Copy Steps", "절차 복사"));
            if (action == 0)
            {
                TeamForgeWindow.Open();
            }
            else if (action == 2)
            {
                EditorGUIUtility.systemCopyBuffer = message;
                ShowNotification(new GUIContent(T("Project transfer steps copied", "프로젝트 받기 절차 복사됨")));
            }
        }

        private static string ShortIdentity(string value)
        {
            if (string.IsNullOrWhiteSpace(value)) return "—";
            var trimmed = value.Trim();
            return trimmed.Length <= 12 ? trimmed : trimmed.Substring(0, 8) + "…" + trimmed.Substring(trimmed.Length - 4);
        }

        private static void StorePendingInvite(string code, string projectUuid)
        {
            ClearPendingInvite();
            EditorPrefs.SetString(PendingJoinCodeKey, code ?? string.Empty);
            EditorPrefs.SetString(PendingJoinProjectUuidKey, projectUuid ?? string.Empty);
            EditorPrefs.SetString(
                PendingJoinExpiryTicksKey,
                DateTime.UtcNow.Add(PendingJoinLifetime).Ticks.ToString());
        }

        private static bool HasPendingInviteForCurrentProject()
        {
            if (!TryReadPendingInvite(out _, out var expectedProjectUuid))
            {
                return false;
            }

            var descriptor = TeamForgeProjectService.Descriptor;
            return descriptor != null &&
                   string.Equals(descriptor.projectUuid, expectedProjectUuid, StringComparison.Ordinal);
        }

        private static bool TryTakePendingInviteForCurrentProject(out string code)
        {
            code = string.Empty;
            if (!TryReadPendingInvite(out var candidate, out var expectedProjectUuid))
            {
                return false;
            }

            var descriptor = TeamForgeProjectService.Descriptor;
            if (descriptor == null ||
                !string.Equals(descriptor.projectUuid, expectedProjectUuid, StringComparison.Ordinal))
            {
                return false;
            }

            code = candidate;
            ClearPendingInvite();
            return true;
        }

        private static bool TryReadPendingInvite(out string code, out string projectUuid)
        {
            code = EditorPrefs.GetString(PendingJoinCodeKey, string.Empty);
            projectUuid = EditorPrefs.GetString(PendingJoinProjectUuidKey, string.Empty);
            var expiryText = EditorPrefs.GetString(PendingJoinExpiryTicksKey, string.Empty);
            if (string.IsNullOrWhiteSpace(code) ||
                string.IsNullOrWhiteSpace(projectUuid) ||
                !long.TryParse(expiryText, out var expiryTicks) ||
                expiryTicks <= DateTime.UtcNow.Ticks)
            {
                ClearPendingInvite();
                code = string.Empty;
                projectUuid = string.Empty;
                return false;
            }

            if (!TeamForgeJoinCode.TryParse(code, out var payload, out _) ||
                payload == null ||
                !string.Equals(payload.projectUuid, projectUuid, StringComparison.Ordinal))
            {
                ClearPendingInvite();
                code = string.Empty;
                projectUuid = string.Empty;
                return false;
            }

            return true;
        }

        private static void ClearPendingInvite()
        {
            EditorPrefs.DeleteKey(PendingJoinCodeKey);
            EditorPrefs.DeleteKey(PendingJoinProjectUuidKey);
            EditorPrefs.DeleteKey(PendingJoinExpiryTicksKey);
        }

        private string DescribeInvite(TeamForgeJoinCodePayload payload)
        {
            if (payload == null)
            {
                return T("Unknown TeamForge session", "알 수 없는 TeamForge 세션");
            }

            var host = string.IsNullOrWhiteSpace(payload.hostDisplayName)
                ? T("TeamForge host", "TeamForge 호스트")
                : payload.hostDisplayName.Trim();
            var scene = payload.sceneBaseline == null || string.IsNullOrWhiteSpace(payload.sceneBaseline.scenePath)
                ? T("Scene baseline not included", "Scene 기준 상태가 포함되지 않음")
                : payload.sceneBaseline.scenePath;
            return T(
                $"Host: {host}\nProject: {payload.projectId}\nSession: {payload.sessionId}\nScene: {scene}\nServer: {payload.serverAddress}",
                $"호스트: {host}\n프로젝트: {payload.projectId}\n세션: {payload.sessionId}\nScene: {scene}\n서버: {payload.serverAddress}");
        }

        private void ConnectCurrentSession()
        {
            if (!TeamForgeQuickStartUtility.TryEnsureProjectSetup(false, out var error))
            {
                EditorUtility.DisplayDialog("TeamForge", error, "OK");
                return;
            }
            TeamForgeConnectionService.Connect();
            ShowNotification(new GUIContent(T("Connecting to saved session…", "저장된 세션에 연결 중…")));
        }

        private void CopyInvite()
        {
            if (!TeamForgeJoinCode.TryCreate(out var code, out var error))
            {
                EditorUtility.DisplayDialog(T("TeamForge Invite", "TeamForge 초대"), error, "OK");
                return;
            }
            EditorGUIUtility.systemCopyBuffer = code;
            ShowNotification(new GUIContent(T("Session-only TF1 code copied", "세션 전용 TF1 코드 복사됨")));
            TeamForgeDiagnostics.Info(
                "Advanced session-only TF1 code copied. It does not contain Project transfer authority or Launcher bootstrap data.");
        }

        private void ShowWindowsLanFirewallCleanupInfo()
        {
            EditorUtility.DisplayDialog(
                T("Firewall cleanup when Host stops", "호스트 중지 시 방화벽 정리"),
                T(
                    "On (recommended): TeamForge first stops its owned Coordinator/Seed listeners, then removes only the two named TeamForge inbound LAN rules. Windows administrator approval may appear, and the next Host start may ask again to recreate the rules.\n\nOff: the listeners still stop, but the exact Private + LocalSubnet rules remain for faster restart. Nothing in TeamForge listens on those ports after a clean stop, but another program that later binds the same port could benefit from that inbound allowance.\n\nIf Unity or Windows terminates abruptly, automatic cleanup cannot run; use the manual Remove TeamForge LAN firewall rules button after reopening if needed.",
                    "켜짐(권장): TeamForge가 자신이 소유한 Coordinator/Seed 리스너를 먼저 중지한 뒤 TeamForge 이름으로 만든 인바운드 LAN 규칙 두 개만 제거합니다. Windows 관리자 승인이 나타날 수 있고, 다음 호스트 시작 때 규칙을 다시 만들기 위해 다시 승인을 요청할 수 있습니다.\n\n꺼짐: 리스너는 그대로 중지되지만 빠른 재시작을 위해 정확한 Private + LocalSubnet 규칙은 남겨둡니다. 정상 중지 후 TeamForge가 해당 포트를 수신하지는 않지만, 나중에 다른 프로그램이 같은 포트를 바인드하면 그 인바운드 허용의 영향을 받을 수 있습니다.\n\nUnity나 Windows가 갑자기 종료되면 자동 정리를 실행할 수 없으므로 필요하면 다시 연 뒤 수동 방화벽 규칙 제거 버튼을 사용하세요."),
                "OK");
        }

        private void RemoveWindowsLanFirewallRules()
        {
            if (TeamForgeHostFlow.State == TeamForgeHostFlowState.Ready || TeamForgeHostFlow.IsBusy)
            {
                EditorUtility.DisplayDialog(
                    T("Stop Host first", "먼저 호스트를 중지하세요"),
                    T(
                        "Stop Collaboration before removing its Windows LAN firewall rules.",
                        "Windows LAN 방화벽 규칙을 제거하기 전에 협업 중지를 눌러 호스트를 중지하세요."),
                    "OK");
                return;
            }
            if (!EditorUtility.DisplayDialog(
                    T("Remove TeamForge LAN firewall rules?", "TeamForge LAN 방화벽 규칙을 제거할까요?"),
                    T(
                        "This removes only the named TeamForge Coordinator and Seed inbound rules. The remembered Seed port is kept for the next start.",
                        "TeamForge 이름으로 만든 Coordinator 및 Seed 인바운드 규칙만 제거합니다. 다음 시작을 위해 기억한 Seed 포트는 유지합니다."),
                    T("Remove Rules", "규칙 제거"),
                    T("Cancel", "취소")))
            {
                return;
            }
            if (!TeamForgeWindowsFirewall.TryRemoveLanRules(out var error))
            {
                EditorUtility.DisplayDialog("TeamForge — Windows LAN Firewall", error, "OK");
                return;
            }
            TeamForgeRecoveryUx.Record(
                "host_collaboration",
                "lan_firewall_removed",
                "Named TeamForge Coordinator/Seed LAN firewall rules removed by explicit user action.");
            ShowNotification(new GUIContent(T(
                "TeamForge LAN firewall rules removed",
                "TeamForge LAN 방화벽 규칙 제거됨")));
        }

        private void LeaveSession()
        {
            TeamForgeConnectionService.Disconnect();
            ShowNotification(new GUIContent(T("Left TeamForge session", "TeamForge 세션에서 나감")));
        }

        private void FixSafeIssues()
        {
            if (!TeamForgeDoctor.TryAutoFixSafeIssues(out var summary))
            {
                EditorUtility.DisplayDialog("TeamForge Doctor", summary, "OK");
                RefreshDoctorNow();
                return;
            }
            ShowNotification(new GUIContent(summary));
            RefreshDoctorNow();
        }

        private static void CopyDoctorReport()
        {
            var results = TeamForgeDoctor.Run();
            EditorGUIUtility.systemCopyBuffer = TeamForgeDoctor.BuildReport(results);
            TeamForgeDiagnostics.Info("TeamForge Doctor report copied to clipboard. Secrets are not included.");
        }

        private void ShowRecovery(string code, string technicalDetail)
        {
            _lastRecoveryCode = string.IsNullOrWhiteSpace(code) ? "teamforge_operation_failed" : code;
            _lastRecoveryDetail = technicalDetail ?? string.Empty;
            var presentation = TeamForgeRecoveryUx.FromStableCode(_lastRecoveryCode);
            TeamForgeRecoveryUx.Record("guest_join", _lastRecoveryCode, _lastRecoveryDetail);
            var action = EditorUtility.DisplayDialogComplex(
                presentation.Title,
                presentation.Message + "\n\nCode: " + presentation.Code,
                presentation.PrimaryAction,
                T("Close", "닫기"),
                T("Copy diagnostics", "진단 복사"));
            if (action == 0 &&
                (string.Equals(_lastRecoveryCode, "scene_baseline_mismatch", StringComparison.Ordinal) ||
                 string.Equals(_lastRecoveryCode, "project_identity_mismatch", StringComparison.Ordinal)))
            {
                TeamForgeWindow.Open();
            }
            else if (action == 2)
            {
                CopyRecoveryDiagnostics();
            }
            Refresh();
        }

        private void CopyRecoveryDiagnostics()
        {
            var role = TeamForgeHostFlow.State == TeamForgeHostFlowState.Ready || TeamForgeHostFlow.IsBusy
                ? "Host"
                : "Guest";
            EditorGUIUtility.systemCopyBuffer = TeamForgeRecoveryUx.BuildCopyDiagnostics(
                role,
                role == "Host" ? "host_collaboration" : "guest_join",
                _lastRecoveryCode,
                _lastRecoveryDetail,
                false);
            ShowNotification(new GUIContent(T("Diagnostics copied · secrets redacted", "진단 복사됨 · 비밀정보 제거됨")));
        }

        private void CreateQuickLab()
        {
            if (!TeamForgeTestLab.TryCreateStandardLab(out var paths, out var error))
            {
                EditorUtility.DisplayDialog("TeamForge Quick Lab", error, "OK");
                return;
            }
            ShowNotification(new GUIContent(T(
                $"Test Lab ready · {paths.Count + 1} Editors",
                $"테스트 랩 준비됨 · 에디터 {paths.Count + 1}개")));
        }

        private static VisualElement Card(VisualElement parent)
        {
            var card = new VisualElement();
            card.style.paddingLeft = 10;
            card.style.paddingRight = 10;
            card.style.paddingTop = 8;
            card.style.paddingBottom = 8;
            card.style.marginBottom = 8;
            card.style.borderBottomWidth = 1;
            card.style.borderTopWidth = 1;
            card.style.borderLeftWidth = 1;
            card.style.borderRightWidth = 1;
            parent.Add(card);
            return card;
        }

        private static void Section(VisualElement parent, string text, string tooltip)
        {
            var row = new VisualElement
            {
                style =
                {
                    flexDirection = FlexDirection.Row,
                    alignItems = Align.Center,
                    marginTop = 10,
                    marginBottom = 4,
                },
            };
            var label = new Label(text);
            label.style.fontSize = 14;
            label.style.unityFontStyleAndWeight = FontStyle.Bold;
            label.style.flexGrow = 1;
            row.Add(label);
            row.Add(InfoLabel(tooltip));
            parent.Add(row);
        }

        private static Label InfoLabel(string tooltip)
        {
            var info = new Label("ⓘ") { tooltip = tooltip };
            info.style.fontSize = 14;
            info.style.unityFontStyleAndWeight = FontStyle.Bold;
            info.style.minWidth = 22;
            info.style.unityTextAlign = TextAnchor.MiddleCenter;
            return info;
        }

        private static Label Row(VisualElement parent, string name)
        {
            var row = new VisualElement { style = { flexDirection = FlexDirection.Row } };
            var key = new Label(name);
            key.style.minWidth = 72;
            key.style.unityFontStyleAndWeight = FontStyle.Bold;
            row.Add(key);
            var value = new Label();
            value.style.flexGrow = 1;
            value.style.whiteSpace = WhiteSpace.Normal;
            row.Add(value);
            parent.Add(row);
            return value;
        }

        private static void LargeFlexButton(VisualElement row, Button button)
        {
            button.style.flexGrow = 1;
            button.style.height = 36;
            button.style.marginRight = 4;
            button.style.unityFontStyleAndWeight = FontStyle.Bold;
            row.Add(button);
        }

        private static void AddFlexButton(VisualElement row, Button button)
        {
            button.style.flexGrow = 1;
            button.style.marginRight = 4;
            row.Add(button);
        }

        private static void AddDelayedTextField(
            VisualElement parent,
            string label,
            string value,
            Action<string> setter,
            string tooltip)
        {
            var field = new TextField(label) { value = value, isDelayed = true, tooltip = tooltip };
            field.RegisterValueChangedCallback(evt =>
            {
                TeamForgeConnectionService.CancelAutomaticResumeForConfigurationChange();
                setter(evt.newValue ?? string.Empty);
                TeamForgeConnectionService.Settings.SaveSettings();
            });
            parent.Add(field);
        }

        private static bool UseKorean()
        {
            var preference = EditorPrefs.GetString(UiLanguagePreferenceKey, "Auto");
            if (string.Equals(preference, "Korean", StringComparison.Ordinal)) return true;
            if (string.Equals(preference, "English", StringComparison.Ordinal)) return false;
            return Application.systemLanguage == SystemLanguage.Korean;
        }

        private static string T(string english, string korean)
        {
            return UseKorean() ? korean : english;
        }
    }
}

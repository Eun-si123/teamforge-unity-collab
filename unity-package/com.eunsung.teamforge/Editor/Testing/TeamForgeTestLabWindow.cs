using System;
using UnityEditor;
using UnityEngine;
using UnityEngine.UIElements;

namespace EunSung.TeamForge
{
    public sealed class TeamForgeTestLabWindow : EditorWindow
    {
        private TextField _destinationField;
        private IntegerField _cloneCountField;
        private Toggle _launchToggle;
        private Toggle _autoConnectToggle;
        private Toggle _keepLastOfflineToggle;
        private Label _status;
        private ScrollView _content;
        private Label _twoPcStatus;
        private Label _twoPcVisualStatus;
        private TextField _twoPcJoinCode;
        private TextField _twoPcAccessCode;
        private bool _twoPcCheckActive;
        private double _twoPcCheckDeadline;
        private double _twoPcNextStatusAt;
        private string _twoPcCheckConnectionId = string.Empty;

        [MenuItem("Window/TeamForge/Test Lab", priority = 130)]
        public static void Open()
        {
            var window = GetWindow<TeamForgeTestLabWindow>();
            window.titleContent = new GUIContent("TeamForge Test Lab");
            window.minSize = new Vector2(500, 500);
        }

        public void CreateGUI()
        {
            rootVisualElement.Clear();
            rootVisualElement.style.paddingLeft = 12;
            rootVisualElement.style.paddingRight = 12;
            rootVisualElement.style.paddingTop = 10;
            rootVisualElement.style.paddingBottom = 10;

            _content = new ScrollView();
            _content.style.flexGrow = 1;
            rootVisualElement.Add(_content);

            var title = new Label("Test Lab");
            title.style.fontSize = 20;
            title.style.unityFontStyleAndWeight = FontStyle.Bold;
            _content.Add(title);

            AddTwoPcControls();

            var localTitle = new Label("Single-PC A/B/C lab");
            localTitle.style.fontSize = 15;
            localTitle.style.unityFontStyleAndWeight = FontStyle.Bold;
            localTitle.style.marginTop = 18;
            _content.Add(localTitle);

            var description = new Label(
                "Make a real A/B/C collaboration lab without hand-copying Projects. B joins automatically; C opens offline for Late Join by default.");
            description.style.whiteSpace = WhiteSpace.Normal;
            description.style.marginBottom = 10;
            _content.Add(description);

            var quick = new Button(CreateStandardLab) { text = "Create Standard A/B/C Lab" };
            quick.style.height = 34;
            quick.style.unityFontStyleAndWeight = FontStyle.Bold;
            _content.Add(quick);

            var quickNote = new HelpBox(
                "One click: save/verify baseline → prepare a session → clone B/C → launch both → auto-connect B → keep C offline for Late Join. On Windows, Test Lab uses robocopy when available and falls back safely to managed copying.",
                HelpBoxMessageType.Info);
            quickNote.style.marginTop = 6;
            _content.Add(quickNote);

            var folderRow = new VisualElement { style = { flexDirection = FlexDirection.Row, marginTop = 6 } };
            _content.Add(folderRow);
            AddFlexButton(folderRow, new Button(RevealLastLab) { text = "Show Last Lab Folder" });
            AddFlexButton(folderRow, new Button(TeamForgeHomeWindow.Open) { text = "Back to Collaboration" });

            var advanced = new Foldout { text = "Custom lab", value = false };
            advanced.style.marginTop = 10;
            _content.Add(advanced);

            _destinationField = new TextField("Clone root")
            {
                value = TeamForgeTestLab.DefaultDestinationRoot(),
                isDelayed = true,
            };
            advanced.Add(_destinationField);

            _cloneCountField = new IntegerField("Additional Editors") { value = 2 };
            _cloneCountField.RegisterValueChangedCallback(evt =>
            {
                _cloneCountField.SetValueWithoutNotify(Mathf.Clamp(evt.newValue, 1, 3));
                RefreshOptionState();
            });
            advanced.Add(_cloneCountField);

            _launchToggle = new Toggle("Launch clones after creation") { value = true };
            _autoConnectToggle = new Toggle("Auto-connect clones to this session") { value = true };
            _keepLastOfflineToggle = new Toggle("Keep last clone offline for Late Join") { value = true };
            _autoConnectToggle.RegisterValueChangedCallback(_ => RefreshOptionState());
            advanced.Add(_launchToggle);
            advanced.Add(_autoConnectToggle);
            advanced.Add(_keepLastOfflineToggle);
            RefreshOptionState();

            var create = new Button(CreateCustomLab) { text = "Create Custom Lab" };
            create.style.marginTop = 8;
            advanced.Add(create);

            _status = new Label("Ready.");
            _status.style.whiteSpace = WhiteSpace.Normal;
            _status.style.marginTop = 10;
            _content.Add(_status);
        }

        private void AddTwoPcControls()
        {
            var heading = new Label("Two-PC Test Lab (inside Unity)");
            heading.style.fontSize = 16;
            heading.style.unityFontStyleAndWeight = FontStyle.Bold;
            heading.style.marginTop = 10;
            _content.Add(heading);

            var note = new HelpBox(
                "Open Test Lab on both PCs. No Git, Node.js or SSH setup is needed for this Editor-only smoke check. " +
                "Both Editors must have the same saved Host Project/Scene and TeamForge package. " +
                "Host uses existing verified Publish/Start; Guest joins through TF1 session code " +
                "and separately shared access code, only if not already connected through the Launcher. " +
                "Connected Guests can Run checks without another invite. " +
                "This checks networking/presence, not full Transform/Lock or Launcher E2E.",
                HelpBoxMessageType.Info);
            note.style.marginTop = 5;
            _content.Add(note);

            var visualNote = new HelpBox(
                "Live-created remote Hierarchy objects currently receive identity/name/Transform only. " +
                "MeshFilter, MeshRenderer, Collider, materials and other Components are NOT copied. " +
                "Use a saved, shared baseline for visible primitives until Component Sync is supported. " +
                "Inspect selection visuals below on each PC to confirm the difference.",
                HelpBoxMessageType.Warning);
            visualNote.style.marginTop = 5;
            _content.Add(visualNote);

            var hostRow = new VisualElement { style = { flexDirection = FlexDirection.Row, marginTop = 6 } };
            _content.Add(hostRow);
            AddFlexButton(hostRow, new Button(StartTwoPcHost) { text = "1. Host: Start" });
            AddFlexButton(hostRow, new Button(CopyTwoPcSessionCode) { text = "Copy TF1" });
            AddFlexButton(hostRow, new Button(CopyTwoPcHostAccessCode) { text = "Copy access code" });

            _twoPcJoinCode = new TextField("2. Guest: TF1 code") { isDelayed = false };
            _twoPcJoinCode.style.marginTop = 6;
            _content.Add(_twoPcJoinCode);
            _twoPcAccessCode = new TextField("Guest: access code")
            {
                isPasswordField = true,
                isDelayed = false,
                tooltip = "Share separately from the TF1 session code. Not written to disk or diagnostics by Test Lab.",
            };
            _content.Add(_twoPcAccessCode);

            var guestRow = new VisualElement { style = { flexDirection = FlexDirection.Row, marginTop = 5 } };
            _content.Add(guestRow);
            AddFlexButton(guestRow, new Button(() => _twoPcJoinCode.value = EditorGUIUtility.systemCopyBuffer)
            {
                text = "Paste TF1",
            });
            AddFlexButton(guestRow, new Button(JoinTwoPcSession) { text = "Guest: Join & check" });
            AddFlexButton(guestRow, new Button(RunTwoPcSmokeCheck) { text = "3. Run checks" });

            _twoPcStatus = new Label("NOT RUN — Start Host on PC A, then join from PC B.");
            _twoPcStatus.style.whiteSpace = WhiteSpace.Normal;
            _twoPcStatus.style.marginTop = 5;
            _content.Add(_twoPcStatus);

            var visualRow = new VisualElement { style = { flexDirection = FlexDirection.Row, marginTop = 7 } };
            _content.Add(visualRow);
            AddFlexButton(visualRow, new Button(InspectSelectedVisuals)
            {
                text = "Inspect selected object's visuals (local)"
            });
            _twoPcVisualStatus = new Label("NOT RUN — select the same Scene object on each PC to compare Inspector components.");
            _twoPcVisualStatus.style.whiteSpace = WhiteSpace.Normal;
            _twoPcVisualStatus.style.marginTop = 4;
            _content.Add(_twoPcVisualStatus);
        }

        private void StartTwoPcHost()
        {
            CancelTwoPcCheck();
            if (TeamForgeHostFlow.State == TeamForgeHostFlowState.Ready)
            {
                _twoPcStatus.text = "Host is already Ready. Copy TF1 and access code separately to the Guest.";
                return;
            }
            if (TeamForgeHostFlow.IsBusy)
            {
                _twoPcStatus.text = "Host preparation is already running. Follow the Publish review dialogs.";
                return;
            }
            _twoPcStatus.text = "Opening the existing secure Host setup. Approve Publish review to start.";
            TeamForgeHostFlow.StartCollaboration();
        }

        private void CopyTwoPcSessionCode()
        {
            if (TeamForgeHostFlow.State != TeamForgeHostFlowState.Ready)
            {
                _twoPcStatus.text = "Host is not Ready. Start Host and finish Publish review first.";
                return;
            }
            if (!TeamForgeJoinCode.TryCreateFresh(out var code, out var error))
            {
                _twoPcStatus.text = "Cannot create TF1 code: " + error;
                return;
            }
            EditorGUIUtility.systemCopyBuffer = code;
            _twoPcStatus.text = "TF1 code copied. Share with Guest, then copy access code separately.";
        }

        private void CopyTwoPcHostAccessCode()
        {
            if (TeamForgeHostFlow.State != TeamForgeHostFlowState.Ready)
            {
                _twoPcStatus.text = "Host must be Ready before sharing access code.";
                return;
            }
            var token = TeamForgeConnectionService.Settings.EffectiveAuthenticationToken;
            if (string.IsNullOrWhiteSpace(token))
            {
                _twoPcStatus.text = "No Host access code. LAN Host setup must enable authentication.";
                return;
            }
            EditorGUIUtility.systemCopyBuffer = token;
            _twoPcStatus.text = "Access code copied separately. Treat it like a password; not included in TF1.";
        }

        private void JoinTwoPcSession()
        {
            CancelTwoPcCheck();
            if (TeamForgeConnectionService.State == TeamForgeConnectionState.Connected)
            {
                // A Launcher-provisioned Guest is already in a verified session;
                // do not demand a second TF1/password or silently switch targets.
                if (!string.IsNullOrWhiteSpace(_twoPcJoinCode.value) ||
                    !string.IsNullOrWhiteSpace(_twoPcAccessCode.value))
                {
                    _twoPcStatus.text = "Already connected. Use Run checks; disconnect before joining a different session.";
                    return;
                }
                RunTwoPcSmokeCheck();
                return;
            }
            var code = _twoPcJoinCode.value?.Trim() ?? string.Empty;
            var token = _twoPcAccessCode.value ?? string.Empty;
            if (string.IsNullOrWhiteSpace(code) || string.IsNullOrWhiteSpace(token))
            {
                _twoPcStatus.text = "Guest needs TF1 code AND separate Host access code.";
                return;
            }
            var settings = TeamForgeConnectionService.Settings;
            var existingCode = settings.AuthenticationToken;
            var useOneShotOverride = !string.IsNullOrWhiteSpace(existingCode) &&
                !string.Equals(existingCode, token, StringComparison.Ordinal);
            if (useOneShotOverride && !EditorUtility.DisplayDialog(
                    "Use a one-time Guest access code?",
                    "A different manual access code is saved for this Unity Project. " +
                    "Use the supplied Host code ONLY for the session being joined? " +
                    "The existing saved credential will remain unchanged. " +
                    "A different target or explicit Disconnect clears the temporary authorization.",
                    "Use for this join", "Cancel"))
            {
                _twoPcStatus.text = "Join cancelled. The saved manual access code was not changed.";
                return;
            }
            if (!TeamForgeQuickStartUtility.TryJoinCode(code, true, out var error))
            {
                _twoPcStatus.text = "Join refused (Project/Scene identity must match): " + error;
                return;
            }
            if (!(useOneShotOverride
                    ? TeamForgeConnectionSettings.TrySetTestLabGuestAuthenticationOverride(settings, token, out error)
                    : TeamForgeConnectionSettings.TrySetGuestTransientAuthenticationToken(token, out error)))
            {
                _twoPcStatus.text = "Access code rejected: " + error;
                return;
            }
            _twoPcAccessCode.SetValueWithoutNotify(string.Empty);
            TeamForgeConnectionService.Connect();
            BeginTwoPcCheck();
        }

        private void RunTwoPcSmokeCheck()
        {
            CancelTwoPcCheck();
            if (TeamForgeConnectionService.State != TeamForgeConnectionState.Connected)
            {
                _twoPcStatus.text = "NOT RUN — connect to a verified Host session first.";
                return;
            }
            if (!TeamForgeConnectionService.Ping())
            {
                _twoPcStatus.text = "NOT RUN — could not send real server Ping.";
                return;
            }
            BeginTwoPcCheck();
        }

        private void BeginTwoPcCheck()
        {
            _twoPcCheckActive = true;
            _twoPcCheckDeadline = EditorApplication.timeSinceStartup + 90.0;
            _twoPcNextStatusAt = 0;
            _twoPcCheckConnectionId = TeamForgeConnectionService.ConnectionId;
            EditorApplication.update -= UpdateTwoPcCheck;
            EditorApplication.update += UpdateTwoPcCheck;
            _twoPcStatus.text = "RUNNING — waiting for authenticated connection, snapshot, Ping/Pong and remote peer…";
        }

        private void UpdateTwoPcCheck()
        {
            if (!_twoPcCheckActive) return;
            var now = EditorApplication.timeSinceStartup;
            if (now < _twoPcNextStatusAt) return;
            _twoPcNextStatusAt = now + 0.5;

            var currentConnection = TeamForgeConnectionService.ConnectionId;
            if (string.IsNullOrWhiteSpace(_twoPcCheckConnectionId) &&
                !string.IsNullOrWhiteSpace(currentConnection))
            {
                _twoPcCheckConnectionId = currentConnection;
            }
            if (!string.IsNullOrWhiteSpace(_twoPcCheckConnectionId) &&
                !string.Equals(_twoPcCheckConnectionId, currentConnection, StringComparison.Ordinal))
            {
                _twoPcStatus.text = "FAILED — connection changed during test; restart check.";
                CancelTwoPcCheck();
                return;
            }

            var report = TeamForgeTwoPcSmokeCheck.Capture();
            if (report.Passed)
            {
                _twoPcStatus.text = "PASS (connection smoke only) — " + report.Detail;
                CancelTwoPcCheck();
                return;
            }

            if (now >= _twoPcCheckDeadline)
            {
                _twoPcStatus.text = "FAILED [" + report.Code + "] — " + report.Detail;
                CancelTwoPcCheck();
                return;
            }

            _twoPcStatus.text = "RUNNING [" + report.Code + "] — " + report.Detail;
        }

        private void InspectSelectedVisuals()
        {
            // Read-only: never repair, create a primitive, or infer its type from its name.
            var report = TeamForgeSelectedVisualCheck.Capture(Selection.activeGameObject);
            _twoPcVisualStatus.text = report.Detail;
        }

        private void CancelTwoPcCheck()
        {
            _twoPcCheckActive = false;
            EditorApplication.update -= UpdateTwoPcCheck;
        }

        private void OnDisable()
        {
            CancelTwoPcCheck();
            if (_twoPcAccessCode != null) _twoPcAccessCode.SetValueWithoutNotify(string.Empty);
        }

        private void CreateStandardLab()
        {
            if (!EditorUtility.DisplayDialog(
                    "Create standard TeamForge lab?",
                    "TeamForge will create/replace TF-B and TF-C in the default lab folder, launch both Editors, auto-connect B, and leave C offline for Late Join.",
                    "Create",
                    "Cancel"))
            {
                return;
            }

            _status.text = "Creating A/B/C lab…";
            if (!TeamForgeTestLab.TryCreateStandardLab(out var paths, out var error))
            {
                _status.text = error;
                EditorUtility.DisplayDialog("TeamForge Test Lab", error, "OK");
                return;
            }

            _status.text =
                $"Ready. B will join automatically; C is intentionally offline. {paths.Count} clone(s) launched.";
        }

        private void CreateCustomLab()
        {
            if (string.IsNullOrWhiteSpace(_destinationField.value))
            {
                _status.text = "Choose a clone destination.";
                return;
            }

            var count = Mathf.Clamp(_cloneCountField.value, 1, 3);
            if (!EditorUtility.DisplayDialog(
                    "Create TeamForge Test Lab?",
                    $"This will create {count} clean Project clone(s) under:\n{_destinationField.value}\n\nExisting TF-B/TF-C/TF-D folders at that location will be replaced.",
                    "Create",
                    "Cancel"))
            {
                return;
            }

            if (!TeamForgeTestLab.TryCreateAndLaunchClones(
                    _destinationField.value,
                    count,
                    _launchToggle.value,
                    _autoConnectToggle.value,
                    _keepLastOfflineToggle.value,
                    out var paths,
                    out var error))
            {
                _status.text = error;
                EditorUtility.DisplayDialog("TeamForge Test Lab", error, "OK");
                return;
            }

            if (_autoConnectToggle.value &&
                (TeamForgeConnectionService.State == TeamForgeConnectionState.Disconnected ||
                 TeamForgeConnectionService.State == TeamForgeConnectionState.Faulted))
            {
                TeamForgeConnectionService.Connect();
            }

            var lateJoinText = _autoConnectToggle.value && _keepLastOfflineToggle.value && paths.Count > 1
                ? " Last clone is intentionally offline for Late Join."
                : string.Empty;
            _status.text =
                $"Created {paths.Count} clone(s). Session: {TeamForgeConnectionService.Settings.SessionId}.{lateJoinText}";
        }

        private void RevealLastLab()
        {
            if (!TeamForgeTestLab.TryRevealLastLab(out var error))
            {
                _status.text = error;
            }
        }

        private void RefreshOptionState()
        {
            if (_keepLastOfflineToggle == null || _autoConnectToggle == null || _cloneCountField == null)
            {
                return;
            }
            _keepLastOfflineToggle.SetEnabled(_autoConnectToggle.value && _cloneCountField.value > 1);
        }

        private static void AddFlexButton(VisualElement row, Button button)
        {
            button.style.flexGrow = 1;
            button.style.marginRight = 4;
            row.Add(button);
        }
    }
}

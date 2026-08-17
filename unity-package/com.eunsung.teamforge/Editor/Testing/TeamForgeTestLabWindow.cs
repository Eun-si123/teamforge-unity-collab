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

        [MenuItem("Window/TeamForge/Test Lab", priority = 130)]
        public static void Open()
        {
            var window = GetWindow<TeamForgeTestLabWindow>();
            window.titleContent = new GUIContent("TeamForge Test Lab");
            window.minSize = new Vector2(470, 390);
        }

        public void CreateGUI()
        {
            rootVisualElement.Clear();
            rootVisualElement.style.paddingLeft = 12;
            rootVisualElement.style.paddingRight = 12;
            rootVisualElement.style.paddingTop = 10;
            rootVisualElement.style.paddingBottom = 10;

            var title = new Label("Test Lab");
            title.style.fontSize = 20;
            title.style.unityFontStyleAndWeight = FontStyle.Bold;
            rootVisualElement.Add(title);

            var description = new Label(
                "Make a real A/B/C collaboration lab without hand-copying Projects. B joins automatically; C opens offline for Late Join by default.");
            description.style.whiteSpace = WhiteSpace.Normal;
            description.style.marginBottom = 10;
            rootVisualElement.Add(description);

            var quick = new Button(CreateStandardLab) { text = "Create Standard A/B/C Lab" };
            quick.style.height = 34;
            quick.style.unityFontStyleAndWeight = FontStyle.Bold;
            rootVisualElement.Add(quick);

            var quickNote = new HelpBox(
                "One click: save/verify baseline → prepare a session → clone B/C → launch both → auto-connect B → keep C offline for Late Join. On Windows, Test Lab uses robocopy when available and falls back safely to managed copying.",
                HelpBoxMessageType.Info);
            quickNote.style.marginTop = 6;
            rootVisualElement.Add(quickNote);

            var folderRow = new VisualElement { style = { flexDirection = FlexDirection.Row, marginTop = 6 } };
            rootVisualElement.Add(folderRow);
            AddFlexButton(folderRow, new Button(RevealLastLab) { text = "Show Last Lab Folder" });
            AddFlexButton(folderRow, new Button(TeamForgeHomeWindow.Open) { text = "Back to Collaboration" });

            var advanced = new Foldout { text = "Custom lab", value = false };
            advanced.style.marginTop = 10;
            rootVisualElement.Add(advanced);

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
            rootVisualElement.Add(_status);
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

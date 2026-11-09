using UnityEditor;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace EunSung.TeamForge
{
    // Developer-only read-only diagnostics. Nothing here seeds Component state,
    // changes an Inspector, or writes a Unity Scene. Default sessions stay off.
    public sealed class TeamForgeComponentRecoveryPreviewWindow : EditorWindow
    {
        // Input stays only in memory. Never persist a report as EditorPrefs
        // or upgrade it to a trusted Server/Editor signed proof.
        private string _localPeerReferenceJson = string.Empty;
        private string _localReferenceResult = "Not compared.";

        [MenuItem("Window/TeamForge/Test Lab: WP6 Recovery Preview", priority = 131)]
        public static void Open()
        {
            var window = GetWindow<TeamForgeComponentRecoveryPreviewWindow>();
            window.titleContent = new GUIContent("WP6 Preview");
            window.minSize = new Vector2(450, 240);
        }

        private void OnEnable()
        {
            TeamForgeConnectionService.Changed -= Repaint;
            TeamForgeConnectionService.Changed += Repaint;
        }

        private void OnDisable()
        {
            TeamForgeConnectionService.Changed -= Repaint;
            _localPeerReferenceJson = string.Empty;
            _localReferenceResult = "Not compared.";
        }

        private void OnGUI()
        {
            EditorGUILayout.LabelField("Experimental WP6 Component recovery preview",
                EditorStyles.boldLabel);
            EditorGUILayout.HelpBox(
                "Read-only developer check. Both the Server operator and this Editor must opt in. " +
                "No Component state is seeded from live Unity yet; a request normally returns " +
                "component_transaction_unseeded after the Hierarchy Scene has been seeded. " +
                "Before sending, the active Scene must be clean and its saved Collider values " +
                "must exactly match Unity Editor observations. This local check does NOT " +
                "authenticate the published Project or prove remote application. " +
                "No Inspector, Undo, Mesh or Scene changes are applied.",
                MessageType.Warning);

            var canChange = TeamForgeConnectionService.State == TeamForgeConnectionState.Disconnected ||
                            TeamForgeConnectionService.State == TeamForgeConnectionState.Faulted;
            using (new EditorGUI.DisabledScope(!canChange))
            {
                var enabled = EditorGUILayout.ToggleLeft(
                    "Opt into read-only WP6 preview for the next connection (not saved)",
                    TeamForgeConnectionService.ComponentRecoveryPreviewOptInForTestLab);
                if (enabled != TeamForgeConnectionService.ComponentRecoveryPreviewOptInForTestLab)
                {
                    if (!TeamForgeConnectionService.TrySetComponentRecoveryPreviewTestOptIn(
                        enabled, out var error))
                    {
                        ShowNotification(new GUIContent(error));
                    }
                }
            }

            EditorGUILayout.Space();
            EditorGUILayout.LabelField("Connection",
                TeamForgeConnectionService.State.ToString());
            EditorGUILayout.LabelField("Preview capability",
                TeamForgeConnectionService.ComponentRecoveryPreviewAvailable
                    ? "Explicitly negotiated (read only)"
                    : "Not negotiated");

            using (new EditorGUI.DisabledScope(
                !TeamForgeConnectionService.ComponentRecoveryPreviewAvailable))
            {
                if (GUILayout.Button("Request saved active Scene preview"))
                {
                    var scene = SceneManager.GetActiveScene();
                    if (!scene.IsValid() || !scene.isLoaded ||
                        string.IsNullOrWhiteSpace(scene.path))
                    {
                        ShowNotification(new GUIContent("Save the active Scene first."));
                    }
                    else
                    {
                        var sceneId = AssetDatabase.AssetPathToGUID(scene.path);
                        if (!TeamForgeConnectionService.RequestComponentRecoveryPreview(
                            sceneId, out var error))
                        {
                            ShowNotification(new GUIContent(error));
                        }
                    }
                }
            }

            EditorGUILayout.HelpBox(
                TeamForgeConnectionService.ComponentRecoveryPreviewStatus,
                MessageType.Info);

            EditorGUILayout.Space();
            EditorGUILayout.LabelField("Project Peer Active Scene local-source comparison",
                EditorStyles.boldLabel);
            EditorGUILayout.HelpBox(
                "Paste the JSON printed by the local Project Peer wp6-scene-source command. " +
                "The comparison rechecks the connected Project metadata plus actual saved " +
                "Scene Collider values. Pasted JSON has NO authenticated sender identity; " +
                "MATCH does not authorize remote Sync, Inspector write or ACK.",
                MessageType.Warning);
            var nextReference = EditorGUILayout.TextArea(
                _localPeerReferenceJson, GUILayout.MinHeight(56), GUILayout.MaxHeight(110));
            if (nextReference != _localPeerReferenceJson)
            {
                _localPeerReferenceJson = nextReference.Length <= 8192
                    ? nextReference : string.Empty;
                _localReferenceResult = "Not compared (input changed).";
            }
            if (GUILayout.Button("Compare local source to current Editor Scene (no changes)"))
            {
                TeamForgeWp6ActiveSourceReportComparison.TryCompareCurrent(
                    _localPeerReferenceJson, out _localReferenceResult);
            }
            EditorGUILayout.HelpBox(_localReferenceResult, MessageType.Info);
        }
    }
}

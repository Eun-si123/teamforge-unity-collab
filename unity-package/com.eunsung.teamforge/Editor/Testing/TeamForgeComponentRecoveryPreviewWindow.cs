using UnityEditor;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace EunSung.TeamForge
{
    // Developer-only read-only diagnostics. Nothing here seeds Component state,
    // changes an Inspector, or writes a Unity Scene. Default sessions stay off.
    public sealed class TeamForgeComponentRecoveryPreviewWindow : EditorWindow
    {
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
        }

        private void OnGUI()
        {
            EditorGUILayout.LabelField("Experimental WP6 Component recovery preview",
                EditorStyles.boldLabel);
            EditorGUILayout.HelpBox(
                "Read-only developer check. Both the Server operator and this Editor must opt in. " +
                "No Component state is seeded from live Unity yet; a request normally returns " +
                "component_transaction_unseeded after the Hierarchy Scene has been seeded. " +
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
        }
    }
}

using UnityEditor;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace EunSung.TeamForge
{
    // Developer-only WP6 declaration and recovery diagnostics. Only the
    // optional first-Editor preview ledger can be seeded; Unity Scenes, Undo,
    // Component values and default collaboration remain unchanged.
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
                "A separate stronger opt-in can publish one saved Collider declaration " +
                "from the first Editor into a server preview ledger. The Server cannot " +
                "independently verify that declaration against project files. " +
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

                using (new EditorGUI.DisabledScope(
                    !TeamForgeConnectionService.ComponentRecoveryPreviewOptInForTestLab))
                {
                    var declaration = EditorGUILayout.ToggleLeft(
                        "Also request first-Editor Collider declaration (not saved; stronger opt-in)",
                        TeamForgeConnectionService.ComponentDeclarationOptInForTestLab);
                    if (declaration != TeamForgeConnectionService.ComponentDeclarationOptInForTestLab &&
                        !TeamForgeConnectionService.TrySetComponentDeclarationPreviewTestOptIn(
                            declaration, out var declarationError))
                    {
                        ShowNotification(new GUIContent(declarationError));
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
            EditorGUILayout.LabelField("Declaration capability",
                TeamForgeConnectionService.ComponentDeclarationPreviewAvailable
                    ? "Explicitly negotiated (first Editor only)"
                    : "Not negotiated");

            using (new EditorGUI.DisabledScope(
                !TeamForgeConnectionService.ComponentDeclarationPreviewAvailable))
            {
                if (GUILayout.Button("Declare selected saved Box/SphereCollider (no Scene edits)"))
                {
                    var component = Selection.activeObject as Component;
                    if (!(component is BoxCollider) && !(component is SphereCollider))
                    {
                        var selected = Selection.activeGameObject;
                        component = selected != null
                            ? (Component)selected.GetComponent<BoxCollider>() ??
                                selected.GetComponent<SphereCollider>()
                            : null;
                    }
                    if (component == null)
                    {
                        ShowNotification(new GUIContent("Select a saved BoxCollider or SphereCollider."));
                    }
                    else if (!TeamForgeConnectionService.TryDeclareSelectedColliderForPreview(
                        component, out var declarationError))
                    {
                        ShowNotification(new GUIContent(declarationError));
                    }
                }
            }
            EditorGUILayout.HelpBox(
                "Declaration requires: saved clean Scene; already seeded Hierarchy; " +
                "only one connected Editor; current object lock; first revision 0. " +
                "Server must explicitly enable both preview and declaration flags.",
                MessageType.None);
            EditorGUILayout.HelpBox(
                TeamForgeConnectionService.ComponentDeclarationPreviewStatus,
                MessageType.Info);

            using (new EditorGUI.DisabledScope(
                !TeamForgeConnectionService.ComponentRecoveryPreviewAvailable))
            {
                if (GUILayout.Button("Compare selected Collider to first Editor (read only)"))
                {
                    var component = Selection.activeObject as Component;
                    if (!(component is BoxCollider) && !(component is SphereCollider))
                    {
                        var selected = Selection.activeGameObject;
                        component = selected != null
                            ? (Component)selected.GetComponent<BoxCollider>() ??
                                selected.GetComponent<SphereCollider>()
                            : null;
                    }
                    if (component == null)
                    {
                        ShowNotification(new GUIContent("Select a saved BoxCollider or SphereCollider."));
                    }
                    else if (!TeamForgeConnectionService.TryCompareSelectedColliderForPreview(
                        component, out var compareError))
                    {
                        ShowNotification(new GUIContent(compareError));
                    }
                }
            }
            EditorGUILayout.HelpBox(
                "Read-only comparison reports MATCH / DIFFER / REFUSED. A difference " +
                "is diagnostic evidence, not proof that either Editor is correct. " +
                "No values are copied and no Inspector/Undo changes are performed.",
                MessageType.None);
            EditorGUILayout.HelpBox(
                TeamForgeConnectionService.ComponentRecoveryCompareStatus,
                MessageType.Info);

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

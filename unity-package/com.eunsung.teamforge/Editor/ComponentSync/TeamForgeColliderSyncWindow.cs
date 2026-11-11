using UnityEditor;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace EunSung.TeamForge
{
    internal sealed class TeamForgeColliderSyncWindow : EditorWindow
    {
        private string _message = string.Empty;
        private Vector2 _scroll;

        [MenuItem("Window/TeamForge/Collider Collaboration")]
        private static void Open() { GetWindow<TeamForgeColliderSyncWindow>("Collider Collaboration"); }
        private void OnEnable()
        {
            minSize = new Vector2(410, 360);
            TeamForgeColliderSyncService.Changed += Repaint;
            TeamForgeConnectionService.Changed += Repaint;
        }
        private void OnDisable()
        {
            TeamForgeColliderSyncService.Changed -= Repaint;
            TeamForgeConnectionService.Changed -= Repaint;
        }
        private void OnGUI()
        {
            _scroll = EditorGUILayout.BeginScrollView(_scroll);
            EditorGUILayout.LabelField("Collider collaboration", EditorStyles.boldLabel);
            EditorGUILayout.LabelField("Saved, non-Prefab Scenes · BoxCollider and SphereCollider", EditorStyles.wordWrappedLabel);
            EditorGUILayout.LabelField("Shared: Is Trigger, Center, Size / Radius. Other Inspector fields remain local.", EditorStyles.wordWrappedLabel);
            var enabled = EditorGUILayout.Toggle("Enable when connecting", TeamForgeConnectionService.ComponentPropertySyncOptIn);
            if (enabled != TeamForgeConnectionService.ComponentPropertySyncOptIn &&
                !TeamForgeConnectionService.TrySetComponentPropertySyncOptIn(enabled, out _message)) Repaint();
            EditorGUILayout.Space();
            EditorGUILayout.LabelField("Connection", TeamForgeConnectionService.State.ToString());
            EditorGUILayout.LabelField("Collider compatibility", TeamForgeConnectionService.ComponentPropertySyncAvailable ? "Negotiated" : "Unavailable");
            EditorGUILayout.HelpBox(TeamForgeColliderSyncService.Status, MessageType.Info);
            using (new EditorGUI.DisabledScope(!TeamForgeConnectionService.ComponentPropertySyncAvailable || TeamForgeColliderSyncService.Pending))
                if (GUILayout.Button(TeamForgeColliderSyncService.Ready ? "Refresh shared Scene" : "Join active Scene / reconnect"))
                    TeamForgeColliderSyncService.JoinActiveScene(out _message);
            EditorGUILayout.LabelField("Server acceptance and Editor application", EditorStyles.boldLabel);
            EditorGUILayout.LabelField(TeamForgeColliderSyncService.EditorApplyStatus, EditorStyles.wordWrappedLabel);
            EditorGUILayout.LabelField(TeamForgeColliderSyncService.ReportStatus, EditorStyles.wordWrappedLabel);
            var scene = SceneManager.GetActiveScene();
            EditorGUILayout.LabelField("Disk", scene.IsValid() && scene.isDirty ? "Unsaved local Scene changes" : "Scene currently saved locally");
            EditorGUILayout.LabelField("Saving in this Editor does not confirm that another Editor saved its Scene.", EditorStyles.wordWrappedMiniLabel);
            EditorGUILayout.Space();
            EditorGUILayout.BeginHorizontal();
            using (new EditorGUI.DisabledScope(!TeamForgeColliderSyncService.CanUndo))
                if (GUILayout.Button("Undo my shared edit")) TeamForgeColliderSyncService.UndoOwnEdit();
            using (new EditorGUI.DisabledScope(!TeamForgeColliderSyncService.CanRedo))
                if (GUILayout.Button("Redo my shared edit")) TeamForgeColliderSyncService.RedoOwnEdit();
            EditorGUILayout.EndHorizontal();
            EditorGUILayout.LabelField("Undo submits a conditional inverse. A newer change to that property is preserved.", EditorStyles.wordWrappedMiniLabel);
            EditorGUILayout.Space();
            EditorGUILayout.LabelField("Recovery inbox · " + TeamForgeColliderSyncService.RecoveryCount, EditorStyles.boldLabel);
            if (TeamForgeColliderSyncService.RecoveryCount > 0)
            {
                EditorGUILayout.HelpBox("Local edits awaiting review are kept in this project's Library folder. Select the intended GameObject and acquire its lock before resubmitting. A rejected edit never calls global Unity Undo.", MessageType.Warning);
                foreach (var row in TeamForgeColliderSyncService.RecoveryRows())
                {
                    EditorGUILayout.BeginVertical(EditorStyles.helpBox);
                    EditorGUILayout.LabelField(row.TypeName + " · " + row.Path, EditorStyles.wordWrappedLabel);
                    EditorGUILayout.LabelField("Local: " + TeamForgeColliderSyncService.ValueText(row) +
                        "    Shared: " + TeamForgeColliderSyncService.SharedValueText(row), EditorStyles.wordWrappedLabel);
                    EditorGUILayout.BeginHorizontal();
                    if (GUILayout.Button("Select target")) TeamForgeColliderSyncService.SelectRecoveryTarget(row);
                    using (new EditorGUI.DisabledScope(!TeamForgeColliderSyncService.Ready || TeamForgeColliderSyncService.Pending))
                        if (GUILayout.Button("Resubmit this value")) TeamForgeColliderSyncService.ResubmitRecovery(row.Key);
                    EditorGUILayout.EndHorizontal();
                    EditorGUILayout.EndVertical();
                }
                EditorGUILayout.BeginHorizontal();
                using (new EditorGUI.DisabledScope(!TeamForgeColliderSyncService.Ready || TeamForgeColliderSyncService.Pending))
                    if (GUILayout.Button("Resubmit next local value")) TeamForgeColliderSyncService.ResubmitRecovery();
                if (GUILayout.Button("Export local values"))
                {
                    var path = EditorUtility.SaveFilePanel("Export Collider recovery values", "", "teamforge-collider-recovery.json", "json");
                    if (!string.IsNullOrEmpty(path)) TeamForgeColliderSyncService.ExportRecovery(path, out _message);
                }
                EditorGUILayout.EndHorizontal();
                if (GUILayout.Button("Discard recovery inbox…") && EditorUtility.DisplayDialog("Discard local Collider recovery?",
                    "This removes preserved local Collider values from the inbox. Current Scene values and shared server values remain.", "Discard", "Keep"))
                    TeamForgeColliderSyncService.DiscardRecovery();
            }
            if (GUILayout.Button("Leave Collider Scene…"))
                TeamForgeColliderSyncService.LeaveScene(false, out _message);
            if (!string.IsNullOrEmpty(_message)) EditorGUILayout.HelpBox(_message, MessageType.Warning);
            EditorGUILayout.EndScrollView();
        }
    }
}

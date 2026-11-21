using UnityEditor;
using UnityEngine;

namespace EunSung.TeamForge
{
    internal sealed class TeamForgeSessionRecoveryWindow : EditorWindow
    {
        private string message;
        private Vector2 scroll;
        [MenuItem("Window/TeamForge/Session Recovery")]
        private static void Open() => GetWindow<TeamForgeSessionRecoveryWindow>("Session Recovery");
        private void OnEnable()
        {
            minSize = new Vector2(430, 310);
            TeamForgeTransformSyncService.Changed += Repaint;
            TeamForgeConnectionService.Changed += Repaint;
        }
        private void OnDisable()
        {
            TeamForgeTransformSyncService.Changed -= Repaint;
            TeamForgeConnectionService.Changed -= Repaint;
        }
        private void OnGUI()
        {
            scroll = EditorGUILayout.BeginScrollView(scroll);
            EditorGUILayout.LabelField("Session recovery · Transform", EditorStyles.boldLabel);
            EditorGUILayout.HelpBox("Unconfirmed local poses are preserved in this Project's Library folder. Review the current shared pose, restore it locally, acquire the target's fresh lock, then explicitly resubmit your desired pose. Saving a Scene is separate from Coordinator acceptance.", MessageType.Info);
            var rows = TeamForgeTransformSyncService.RecoveryRows();
            EditorGUILayout.LabelField(rows.Count + " preserved target(s)");
            foreach (var row in rows)
            {
                EditorGUILayout.BeginVertical(EditorStyles.helpBox);
                EditorGUILayout.LabelField(row.scenePath, EditorStyles.boldLabel);
                EditorGUILayout.LabelField(row.objectId, EditorStyles.wordWrappedMiniLabel);
                EditorGUILayout.LabelField(row.needsReview ? "Review required" : "Awaiting Coordinator acceptance");
                EditorGUILayout.LabelField("Local desired: " + Pose(row.desired), EditorStyles.wordWrappedLabel);
                var hasShared = TeamForgeTransformSyncService.TryRecoveryShared(row.Key, out var shared, out var revision);
                EditorGUILayout.LabelField(hasShared ? "Shared r" + revision + ": " + Pose(shared) :
                    "Shared: unavailable until the same durable Session and exact source are joined.", EditorStyles.wordWrappedLabel);
                using (new EditorGUI.DisabledScope(!hasShared))
                {
                    EditorGUILayout.BeginHorizontal();
                    if (GUILayout.Button("Select target")) TeamForgeTransformSyncService.SelectRecoveryTarget(row.Key, out message);
                    if (GUILayout.Button("Restore shared pose")) TeamForgeTransformSyncService.RestoreSharedRecoveryTarget(row.Key, out message);
                    EditorGUILayout.EndHorizontal();
                    EditorGUILayout.BeginHorizontal();
                    if (GUILayout.Button("Acquire selected lock")) TeamForgeTransformSyncService.RequestSelectedLock();
                    if (GUILayout.Button("Resubmit reviewed local pose")) TeamForgeTransformSyncService.ResubmitRecovery(row.Key, revision, out message);
                    EditorGUILayout.EndHorizontal();
                }
                if (GUILayout.Button("Discard this preserved intent…") && EditorUtility.DisplayDialog("Discard preserved Transform?",
                    "This removes only the local recovery intent. Current Scene and shared poses remain unchanged.", "Discard", "Keep"))
                    TeamForgeTransformSyncService.DiscardRecovery(row.Key, out message);
                EditorGUILayout.EndVertical();
            }
            if (rows.Count > 0 && GUILayout.Button("Export preserved Transform intents"))
            {
                var path = EditorUtility.SaveFilePanel("Export Transform recovery", "", "teamforge-transform-recovery.json", "json");
                if (!string.IsNullOrEmpty(path)) TeamForgeTransformSyncService.ExportRecovery(path, out message);
            }
            if (!string.IsNullOrEmpty(message)) EditorGUILayout.HelpBox(message, MessageType.Warning);
            EditorGUILayout.EndScrollView();
        }
        private static string Pose(TeamForgeTransformState pose) => pose == null ? "unavailable" :
            "Position " + pose.LocalPosition.ToString("G7") + " · Rotation " + pose.LocalRotation.ToString("G7") +
            " · Scale " + pose.LocalScale.ToString("G7");
    }
}

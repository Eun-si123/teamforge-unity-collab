using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

namespace EunSung.TeamForge
{
    internal sealed class TeamForgeSessionRecoveryWindow : EditorWindow
    {
        private string message;
        private Vector2 scroll;
        private readonly Dictionary<string, RenderedReparent> renderedReparents = new Dictionary<string, RenderedReparent>();
        private readonly Dictionary<string, RenderedSibling> renderedSiblings = new Dictionary<string, RenderedSibling>();
        private readonly Dictionary<string, long> renderedPrimitiveDeletes = new Dictionary<string, long>();

        private sealed class RenderedSibling
        {
            internal long SessionRevision, HierarchyRevision;
            internal TeamForgeSiblingRecoveryMember[] Desired;
        }

        private sealed class RenderedReparent
        {
            internal long SessionRevision, HierarchyRevision, TransformRevision;
            internal TeamForgeReparentPlacement Desired;
        }
        [MenuItem("Window/TeamForge/Session Recovery")]
        private static void Open() => GetWindow<TeamForgeSessionRecoveryWindow>("Session Recovery");
        private void OnEnable()
        {
            minSize = new Vector2(430, 310);
            TeamForgeTransformSyncService.Changed += Repaint;
            TeamForgeHierarchySyncService.Changed += Repaint;
            TeamForgeConnectionService.Changed += Repaint;
        }
        private void OnDisable()
        {
            TeamForgeTransformSyncService.Changed -= Repaint;
            TeamForgeHierarchySyncService.Changed -= Repaint;
            TeamForgeConnectionService.Changed -= Repaint;
        }
        private void OnGUI()
        {
            scroll = EditorGUILayout.BeginScrollView(scroll);
            DrawHierarchyRenameRecovery();
            EditorGUILayout.Space();
            DrawHierarchyReparentRecovery();
            EditorGUILayout.Space();
            DrawHierarchySiblingRecovery();
            EditorGUILayout.Space();
            DrawPrimitiveDeleteRecovery();
            EditorGUILayout.LabelField("Transform", EditorStyles.boldLabel);
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

        private void DrawHierarchyRenameRecovery()
        {
            EditorGUILayout.LabelField("Hierarchy names", EditorStyles.boldLabel);
            if (!string.IsNullOrEmpty(TeamForgeHierarchySyncService.RenameRecoveryArchiveError))
                EditorGUILayout.HelpBox(TeamForgeHierarchySyncService.RenameRecoveryArchiveError, MessageType.Warning);
            var rows = TeamForgeHierarchySyncService.RecoveryRenameRows();
            if (rows.Count == 0)
            {
                EditorGUILayout.LabelField("No preserved name changes.");
                return;
            }
            EditorGUILayout.HelpBox("Compare the preserved name with the current shared name. Restore the shared name, select that target, acquire its lock and resubmit the reviewed name. Save the Scene separately.", MessageType.Info);
            foreach (var row in rows)
            {
                EditorGUILayout.BeginVertical(EditorStyles.helpBox);
                EditorGUILayout.LabelField(row.scenePath, EditorStyles.boldLabel);
                EditorGUILayout.LabelField(row.objectId, EditorStyles.wordWrappedMiniLabel);
                EditorGUILayout.LabelField(row.needsReview ? "Review required" : "Awaiting Coordinator acceptance");
                EditorGUILayout.LabelField("Preserved: " + row.desiredName, EditorStyles.wordWrappedLabel);
                var hasShared = TeamForgeHierarchySyncService.TryRecoveryRenameShared(row.Key, out var name, out var revision);
                EditorGUILayout.LabelField(hasShared ? "Shared at revision " + revision + ": " + name :
                    "Shared name unavailable in the current Session.", EditorStyles.wordWrappedLabel);
                using (new EditorGUI.DisabledScope(!hasShared))
                {
                    EditorGUILayout.BeginHorizontal();
                    if (GUILayout.Button("Restore shared name")) TeamForgeHierarchySyncService.RestoreSharedRecoveryName(row.Key, out message);
                    if (GUILayout.Button("Select target")) TeamForgeHierarchySyncService.SelectRecoveryRenameTarget(row.Key, out message);
                    EditorGUILayout.EndHorizontal();
                    EditorGUILayout.BeginHorizontal();
                    if (GUILayout.Button("Acquire target lock")) TeamForgeHierarchySyncService.RequestRecoveryRenameLock(row.Key, out message);
                    if (GUILayout.Button("Resubmit reviewed name")) TeamForgeHierarchySyncService.ResubmitRecoveryRename(row.Key, revision, out message);
                    EditorGUILayout.EndHorizontal();
                }
                if (GUILayout.Button("Discard preserved name…") && EditorUtility.DisplayDialog("Discard preserved name?",
                    "This removes the name from Session Recovery.", "Discard", "Keep"))
                    TeamForgeHierarchySyncService.DiscardRecoveryRename(row.Key, out message);
                EditorGUILayout.EndVertical();
            }
        }

        private void DrawHierarchyReparentRecovery()
        {
            var isRepaint = Event.current.type == EventType.Repaint;
            if (isRepaint) renderedReparents.Clear();
            EditorGUILayout.LabelField("Hierarchy placement", EditorStyles.boldLabel);
            if (!string.IsNullOrEmpty(TeamForgeHierarchySyncService.ReparentRecoveryArchiveError))
                EditorGUILayout.HelpBox(TeamForgeHierarchySyncService.ReparentRecoveryArchiveError, MessageType.Warning);
            var rows = TeamForgeHierarchySyncService.RecoveryReparentRows();
            if (rows.Count == 0)
            {
                EditorGUILayout.LabelField("No preserved parent changes.");
                return;
            }

            EditorGUILayout.HelpBox("Compare the current shared and preserved placement. Restore the shared placement, select the object, acquire its lock and resubmit the reviewed move.", MessageType.Info);
            foreach (var row in rows)
            {
                var key = row.Key;
                var hasShared = TeamForgeHierarchySyncService.TryRecoveryReparentShared(key, out var shared,
                    out var sessionRevision, out var transformRevision);
                if (isRepaint && hasShared)
                    renderedReparents[key] = new RenderedReparent { SessionRevision = sessionRevision, HierarchyRevision = shared.HierarchyRevision,
                        TransformRevision = transformRevision, Desired = row.desired };

                EditorGUILayout.BeginVertical(EditorStyles.helpBox);
                EditorGUILayout.LabelField(row.scenePath, EditorStyles.boldLabel);
                EditorGUILayout.LabelField(row.objectId, EditorStyles.wordWrappedMiniLabel);
                EditorGUILayout.LabelField(row.needsReview ? "Review required" : "Awaiting Coordinator acceptance");
                EditorGUILayout.LabelField("Preserved: " + Placement(row.desired.parentObjectId, row.desired.siblingIndex, row.desired.pose), EditorStyles.wordWrappedLabel);
                EditorGUILayout.LabelField(hasShared ? "Shared session revision " + sessionRevision + ": " +
                    Placement(shared.ParentObjectId, shared.SiblingIndex, shared.Transform) : "Shared placement unavailable in the current Session.",
                    EditorStyles.wordWrappedLabel);
                using (new EditorGUI.DisabledScope(!hasShared))
                {
                    EditorGUILayout.BeginHorizontal();
                    if (GUILayout.Button("Restore shared placement")) TeamForgeHierarchySyncService.RestoreSharedRecoveryPlacement(key, out message);
                    if (GUILayout.Button("Select target")) TeamForgeHierarchySyncService.SelectRecoveryReparentTarget(key, out message);
                    EditorGUILayout.EndHorizontal();
                    EditorGUILayout.BeginHorizontal();
                    if (GUILayout.Button("Acquire target lock")) TeamForgeHierarchySyncService.RequestRecoveryReparentLock(key, out message);
                    if (GUILayout.Button("Resubmit reviewed move"))
                    {
                        if (renderedReparents.TryGetValue(key, out var reviewed) && row.desired.Matches(reviewed.Desired))
                            TeamForgeHierarchySyncService.ResubmitRecoveryReparent(key, reviewed.SessionRevision, reviewed.HierarchyRevision,
                                reviewed.TransformRevision, out message);
                        else message = "The preserved placement changed. Review the updated values before submitting.";
                    }
                    EditorGUILayout.EndHorizontal();
                }
                if (GUILayout.Button("Discard preserved move…") && EditorUtility.DisplayDialog("Discard preserved move?",
                    "This removes the placement from Session Recovery.", "Discard", "Keep"))
                    TeamForgeHierarchySyncService.DiscardRecoveryReparent(key, out message);
                EditorGUILayout.EndVertical();
            }
        }

        private void DrawHierarchySiblingRecovery()
        {
            var isRepaint = Event.current.type == EventType.Repaint;
            if (isRepaint) renderedSiblings.Clear();
            EditorGUILayout.LabelField("Hierarchy sibling order", EditorStyles.boldLabel);
            if (!string.IsNullOrEmpty(TeamForgeHierarchySyncService.SiblingRecoveryArchiveError))
                EditorGUILayout.HelpBox(TeamForgeHierarchySyncService.SiblingRecoveryArchiveError, MessageType.Warning);
            var rows = TeamForgeHierarchySyncService.RecoverySiblingRows();
            if (rows.Count == 0)
            {
                EditorGUILayout.LabelField("No preserved sibling moves.");
                return;
            }

            EditorGUILayout.HelpBox("Compare the current and preserved order. Restore the shared order, select the exact child and acquire its lock before resubmitting.", MessageType.Info);
            foreach (var row in rows)
            {
                var key = row.Key;
                var hasShared = TeamForgeHierarchySyncService.TryRecoverySiblingShared(key, out var shared, out var sessionRevision);
                var sharedOrder = hasShared ? TeamForgeHierarchySyncService.RecoverySiblingSharedOrder(shared) : null;
                var sameGroupOrder = TeamForgeSiblingOrder.SameOrder(row.beforeOrder, sharedOrder);
                if (isRepaint && hasShared && sameGroupOrder)
                    renderedSiblings[key] = new RenderedSibling { SessionRevision = sessionRevision,
                        HierarchyRevision = shared.HierarchyRevision, Desired = row.desiredOrder };

                EditorGUILayout.BeginVertical(EditorStyles.helpBox);
                EditorGUILayout.LabelField(row.scenePath, EditorStyles.boldLabel);
                EditorGUILayout.LabelField(row.parentObjectId.Length == 0 ? "Scene root" : "Parent " + row.parentObjectId, EditorStyles.wordWrappedLabel);
                EditorGUILayout.LabelField("Moved child " + row.objectId, EditorStyles.wordWrappedMiniLabel);
                EditorGUILayout.LabelField((row.needsReview ? "Review required" : "Awaiting Coordinator acceptance") +
                    " · Index " + row.beforeIndex + " → " + row.desiredIndex);
                EditorGUILayout.LabelField("Preserved ordered children: " + SiblingOrderLabel(row.desiredOrder), EditorStyles.wordWrappedLabel);
                EditorGUILayout.LabelField(hasShared ? "Shared session revision " + sessionRevision + ": " + SiblingOrderLabel(sharedOrder) :
                    "Shared sibling order unavailable in the current Session.", EditorStyles.wordWrappedLabel);
                if (hasShared && !sameGroupOrder)
                    EditorGUILayout.HelpBox("Shared order or membership changed after this draft. The original move remains available for manual reconciliation.", MessageType.Warning);
                using (new EditorGUI.DisabledScope(!hasShared))
                {
                    EditorGUILayout.BeginHorizontal();
                    if (GUILayout.Button("Restore shared order")) TeamForgeHierarchySyncService.RestoreSharedRecoverySiblingOrder(key, out message);
                    if (GUILayout.Button("Select child")) TeamForgeHierarchySyncService.SelectRecoverySiblingTarget(key, out message);
                    EditorGUILayout.EndHorizontal();
                    EditorGUILayout.BeginHorizontal();
                    if (GUILayout.Button("Acquire child lock")) TeamForgeHierarchySyncService.RequestRecoverySiblingLock(key, out message);
                    using (new EditorGUI.DisabledScope(!sameGroupOrder))
                        if (GUILayout.Button("Resubmit reviewed order"))
                        {
                            if (renderedSiblings.TryGetValue(key, out var reviewed) && TeamForgeSiblingOrder.SameOrder(row.desiredOrder, reviewed.Desired))
                                TeamForgeHierarchySyncService.ResubmitRecoverySibling(key, reviewed.SessionRevision, reviewed.HierarchyRevision, out message);
                            else message = "The preserved order changed. Review the updated group before submitting.";
                        }
                    EditorGUILayout.EndHorizontal();
                }
                if (GUILayout.Button("Discard preserved order…") && EditorUtility.DisplayDialog("Discard preserved order?",
                    "This removes the order from Session Recovery.", "Discard", "Keep"))
                    TeamForgeHierarchySyncService.DiscardRecoverySibling(key, out message);
                EditorGUILayout.EndVertical();
            }
        }

        private void DrawPrimitiveDeleteRecovery()
        {
            var rows = TeamForgeHierarchySyncService.RecoveryPrimitiveDeletes();
            var archiveError = TeamForgeHierarchySyncService.PrimitiveDeleteArchiveError;
            var repaint = Event.current.type == EventType.Repaint;
            if (repaint) renderedPrimitiveDeletes.Clear();
            if (rows.Count == 0 && string.IsNullOrEmpty(archiveError)) return;

            EditorGUILayout.LabelField("Shared primitive deletions", EditorStyles.boldLabel);
            if (!string.IsNullOrEmpty(archiveError)) EditorGUILayout.HelpBox(archiveError, MessageType.Warning);
            foreach (var row in rows)
            {
                var canReview = TeamForgeHierarchySyncService.TryRecoveryPrimitiveDeleteShared(row.Key, out var shared,
                    out var sessionRevision, out var reviewError);
                if (repaint && canReview) renderedPrimitiveDeletes[row.Key] = sessionRevision;

                EditorGUILayout.BeginVertical(EditorStyles.helpBox);
                EditorGUILayout.LabelField(row.scenePath, EditorStyles.boldLabel);
                EditorGUILayout.LabelField(row.name + " · " + row.objectId, EditorStyles.wordWrappedLabel);
                EditorGUILayout.LabelField(canReview ? "Shared at revision " + sessionRevision + " · " + shared.Name + " · " + Pose(shared.Transform) : reviewError,
                    EditorStyles.wordWrappedLabel);
                using (new EditorGUI.DisabledScope(!canReview))
                {
                    EditorGUILayout.BeginHorizontal();
                    if (GUILayout.Button("Select primitive")) TeamForgeHierarchySyncService.SelectRecoveryPrimitiveDelete(row.Key, out message);
                    if (GUILayout.Button("Acquire lock")) TeamForgeHierarchySyncService.RequestRecoveryPrimitiveDeleteLock(row.Key, out message);
                    EditorGUILayout.EndHorizontal();
                    if (GUILayout.Button("Submit reviewed deletion…"))
                    {
                        if (!renderedPrimitiveDeletes.TryGetValue(row.Key, out var reviewed))
                            message = "Review the current primitive before submitting the deletion.";
                        else if (EditorUtility.DisplayDialog("Delete shared primitive?",
                            "Delete " + shared.Name + " and its shared Colliders from the current Scene?", "Delete", "Keep"))
                            TeamForgeHierarchySyncService.ResubmitRecoveryPrimitiveDelete(row.Key, reviewed, out message);
                    }
                }
                if (GUILayout.Button("Discard preserved deletion…") && EditorUtility.DisplayDialog("Discard preserved deletion?",
                    "Remove this deletion request from Session Recovery?", "Discard", "Keep"))
                    TeamForgeHierarchySyncService.DiscardRecoveryPrimitiveDelete(row.Key, out message);
                EditorGUILayout.EndVertical();
            }
            EditorGUILayout.Space();
        }

        private static string SiblingOrderLabel(TeamForgeSiblingRecoveryMember[] members)
        {
            if (members == null) return "unavailable";
            var labels = new string[members.Length];
            for (var index = 0; index < members.Length; index++)
            {
                var id = members[index].objectId;
                labels[index] = TeamForgeObjectIdentity.TryResolveGameObject(id, out var target) && target != null
                    ? target.name : id;
            }
            return string.Join(" → ", labels);
        }

        private static string Placement(string parentId, int index, TeamForgeTransformState pose) =>
            "Parent " + (string.IsNullOrEmpty(parentId) ? "Scene root" : parentId) + " · Sibling index " + index + " · " + Pose(pose);

        private static string Pose(TeamForgeTransformState pose) => pose == null ? "unavailable" :
            "Position " + pose.LocalPosition.ToString("G7") + " · Rotation " + pose.LocalRotation.ToString("G7") +
            " · Scale " + pose.LocalScale.ToString("G7");
    }
}

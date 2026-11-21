using System;
using System.Collections.Generic;
using System.IO;
using UnityEngine;

namespace EunSung.TeamForge
{
    [Serializable]
    internal sealed class TeamForgeReparentPlacement
    {
        public string parentObjectId;
        public long parentCreatedRevision;
        public int siblingIndex;
        public TeamForgeTransformState pose;

        internal bool IsValid => parentObjectId != null && (parentObjectId.Length == 0 ? parentCreatedRevision == 0 :
            TeamForgeTransformRecoveryScope.Text(parentObjectId, 512) && parentCreatedRevision >= 0 && parentCreatedRevision <= 9007199254740991L) &&
            siblingIndex >= 0 && TeamForgeTransformRecoveryRow.ValidPose(pose);

        internal bool Matches(TeamForgeReparentPlacement other) => other != null && parentObjectId == other.parentObjectId &&
            parentCreatedRevision == other.parentCreatedRevision && siblingIndex == other.siblingIndex && pose.ApproximatelyEquals(other.pose);
    }

    [Serializable]
    internal sealed class TeamForgeHierarchyReparentRecoveryRow
    {
        public TeamForgeTransformRecoveryScope scope;
        public string sceneId, scenePath, objectId, authorityEpoch, operationId;
        public long createdRevision;
        public TeamForgeReparentPlacement before, desired;
        public bool needsReview;

        internal string Key => TeamForgeTransformRecoveryStore.TargetKey(scope.Key, sceneId, objectId);
        internal bool IsValid => scope != null && scope.IsValid && TeamForgeWp6ComponentIdentity.IsSceneGuid(sceneId) &&
            TeamForgeHierarchyRenameRecoveryRow.ValidScenePath(scenePath) && TeamForgeTransformRecoveryScope.Text(objectId, 512) &&
            TeamForgeDurableSessionWire.IsCanonicalUuid(authorityEpoch) &&
            (string.IsNullOrEmpty(operationId) || TeamForgeTransformRecoveryScope.Text(operationId, 128)) &&
            createdRevision >= 0 && createdRevision <= 9007199254740991L && before != null && before.IsValid && desired != null && desired.IsValid &&
            before.parentObjectId != objectId && desired.parentObjectId != objectId && before.parentObjectId != desired.parentObjectId;

        internal TeamForgeHierarchyReparentRecoveryRow Copy() =>
            JsonUtility.FromJson<TeamForgeHierarchyReparentRecoveryRow>(JsonUtility.ToJson(this));
    }

    internal sealed class TeamForgeHierarchyReparentRecoveryStore
    {
        private const int MaximumRows = 64;
        [Serializable] private sealed class Snapshot { public int version = 1; public TeamForgeHierarchyReparentRecoveryRow[] rows; }
        private readonly Dictionary<string, TeamForgeHierarchyReparentRecoveryRow> rows =
            new Dictionary<string, TeamForgeHierarchyReparentRecoveryRow>(StringComparer.Ordinal);
        private readonly TeamForgeHierarchyRecoveryFile file;
        private bool readable = true;

        internal TeamForgeHierarchyReparentRecoveryStore(string path) { file = new TeamForgeHierarchyRecoveryFile(path); }

        internal IReadOnlyList<TeamForgeHierarchyReparentRecoveryRow> Rows()
        {
            var result = new List<TeamForgeHierarchyReparentRecoveryRow>();
            foreach (var row in rows.Values) result.Add(row.Copy());
            result.Sort((left, right) => string.CompareOrdinal(left.Key, right.Key));
            return result;
        }

        internal bool TryGet(string key, out TeamForgeHierarchyReparentRecoveryRow row)
        {
            row = rows.TryGetValue(key, out var stored) ? stored.Copy() : null;
            return row != null;
        }

        internal bool Put(TeamForgeHierarchyReparentRecoveryRow row, out string error)
        {
            if (!readable || row == null || !row.IsValid || (!rows.ContainsKey(row.Key) && rows.Count == MaximumRows))
            { error = "The reparent recovery inbox is unavailable, full or contains an invalid placement."; return false; }
            return Change(row.Key, row.Copy(), out error);
        }

        internal bool Remove(string key, out string error) => Change(key, null, out error);

        private bool Change(string key, TeamForgeHierarchyReparentRecoveryRow next, out string error)
        {
            error = string.Empty;
            rows.TryGetValue(key, out var prior);
            if (next == null && prior == null) return true;
            if (next == null) rows.Remove(key);
            else rows[key] = next;
            try
            {
                file.Write(JsonUtility.ToJson(new Snapshot { rows = new List<TeamForgeHierarchyReparentRecoveryRow>(rows.Values).ToArray() }));
                return true;
            }
            catch (Exception)
            {
                if (prior == null) rows.Remove(key);
                else rows[key] = prior;
                error = "The reparent recovery checkpoint could not be updated. The previous checkpoint was preserved.";
                return false;
            }
        }

        internal bool Load(out string error)
        {
            error = string.Empty;
            try
            {
                var payload = file.Read();
                if (payload == null) return true;
                var snapshot = JsonUtility.FromJson<Snapshot>(payload);
                if (snapshot?.rows == null || snapshot.version != 1 || snapshot.rows.Length > MaximumRows) throw new IOException();
                var loaded = new Dictionary<string, TeamForgeHierarchyReparentRecoveryRow>(StringComparer.Ordinal);
                foreach (var row in snapshot.rows)
                {
                    if (row == null || !row.IsValid || !loaded.TryAdd(row.Key, row)) throw new IOException();
                    row.needsReview = true;
                }
                rows.Clear();
                foreach (var pair in loaded) rows.Add(pair.Key, pair.Value);
                readable = true;
                return true;
            }
            catch (Exception)
            {
                readable = false;
                error = "The previous reparent recovery file could not be verified and remains on disk.";
                return false;
            }
        }
    }
}

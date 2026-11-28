using System;
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEngine;

namespace EunSung.TeamForge
{
    [Serializable]
    internal sealed class TeamForgePrimitiveDeleteRecoveryRow
    {
        public TeamForgeTransformRecoveryScope scope;
        public string sceneId, scenePath, objectId, name, template, savedObjectId;
        public long createdRevision;
        // Older v1 rows remain readable, but have no evidence for automatic deletion.
        public string colliderDigest;
        public string submissionState;

        internal const string Unsubmitted = "unsubmitted";
        internal const string MayBeSubmitted = "may_be_submitted";
        internal bool CanDiscard => submissionState == Unsubmitted;

        internal string Key => TeamForgeTransformRecoveryStore.TargetKey(scope.Key, sceneId, objectId);
        internal bool IsValid => scope != null && scope.IsValid && TeamForgeWp6ComponentIdentity.IsSceneGuid(sceneId) &&
            TeamForgeHierarchyRenameRecoveryRow.ValidScenePath(scenePath) && TeamForgeHierarchyIdentityRegistry.IsLogicalId(objectId) &&
            TeamForgeHierarchyRenameRecoveryRow.ValidName(name) && TeamForgePrimitiveTemplateRuntime.IsTemplate(template) &&
            createdRevision > 0 && createdRevision <= 9007199254740991L && ValidSavedAlias() &&
            (string.IsNullOrEmpty(submissionState) || CanDiscard || submissionState == MayBeSubmitted);

        private bool ValidSavedAlias() => string.IsNullOrEmpty(savedObjectId) ||
            (GlobalObjectId.TryParse(savedObjectId, out var id) && id.ToString() == savedObjectId &&
             id.identifierType == 2 && id.targetObjectId != 0UL && id.targetPrefabId == 0UL && id.assetGUID.ToString() == sceneId);

        internal TeamForgePrimitiveDeleteRecoveryRow Copy() =>
            JsonUtility.FromJson<TeamForgePrimitiveDeleteRecoveryRow>(JsonUtility.ToJson(this));
    }

    internal sealed class TeamForgePrimitiveDeleteRecoveryStore
    {
        [Serializable]
        private sealed class Snapshot
        {
            public int version = 1;
            public TeamForgePrimitiveDeleteRecoveryRow[] rows;
        }

        private readonly TeamForgeHierarchyRecoveryFile file;
        private Dictionary<string, TeamForgePrimitiveDeleteRecoveryRow> rows =
            new Dictionary<string, TeamForgePrimitiveDeleteRecoveryRow>(StringComparer.Ordinal);
        private bool readable = true;

        internal TeamForgePrimitiveDeleteRecoveryStore(string path) { file = new TeamForgeHierarchyRecoveryFile(path); }
        internal int Count => rows.Count;

        internal IReadOnlyList<TeamForgePrimitiveDeleteRecoveryRow> Rows()
        {
            var result = new List<TeamForgePrimitiveDeleteRecoveryRow>();
            foreach (var row in rows.Values) result.Add(row.Copy());
            result.Sort((left, right) => string.CompareOrdinal(left.Key, right.Key));
            return result;
        }

        internal bool TryGet(string key, out TeamForgePrimitiveDeleteRecoveryRow row)
        {
            row = rows.TryGetValue(key, out var saved) ? saved.Copy() : null;
            return row != null;
        }

        internal bool Put(TeamForgePrimitiveDeleteRecoveryRow row, out string error)
        {
            if (!readable || row == null || !row.IsValid || rows.ContainsKey(row.Key) || rows.Count >= TeamForgeTransformRecoveryStore.MaximumRows)
            {
                error = "The primitive deletion inbox is unavailable, full, or already has a request for this object.";
                return false;
            }
            var next = new Dictionary<string, TeamForgePrimitiveDeleteRecoveryRow>(rows, StringComparer.Ordinal) { [row.Key] = row.Copy() };
            return Write(next, out error);
        }

        internal bool MarkForSubmission(string key, out string error)
        {
            error = string.Empty;
            if (!readable || !rows.TryGetValue(key, out var row))
            {
                error = "The primitive deletion recovery record is unavailable. No deletion was requested.";
                return false;
            }
            if (row.submissionState == TeamForgePrimitiveDeleteRecoveryRow.MayBeSubmitted) return true;
            var submitted = row.Copy();
            submitted.submissionState = TeamForgePrimitiveDeleteRecoveryRow.MayBeSubmitted;
            var next = new Dictionary<string, TeamForgePrimitiveDeleteRecoveryRow>(rows, StringComparer.Ordinal)
            { [key] = submitted };
            return Write(next, out error);
        }

        internal bool Remove(string key, out string error)
        {
            error = string.Empty;
            if (!rows.ContainsKey(key)) return true;
            if (!readable) { error = "The primitive deletion inbox is unavailable."; return false; }
            var next = new Dictionary<string, TeamForgePrimitiveDeleteRecoveryRow>(rows, StringComparer.Ordinal);
            next.Remove(key);
            return Write(next, out error);
        }

        private bool Write(Dictionary<string, TeamForgePrimitiveDeleteRecoveryRow> next, out string error)
        {
            try
            {
                var snapshot = new Snapshot { rows = new List<TeamForgePrimitiveDeleteRecoveryRow>(next.Values).ToArray() };
                file.Write(JsonUtility.ToJson(snapshot));
                rows = next;
                error = string.Empty;
                return true;
            }
            catch (Exception)
            {
                error = "The primitive deletion inbox could not be saved. Its previous contents were preserved.";
                return false;
            }
        }

        internal bool Load(out string error)
        {
            try
            {
                var next = new Dictionary<string, TeamForgePrimitiveDeleteRecoveryRow>(StringComparer.Ordinal);
                var payload = file.Read();
                if (payload != null)
                {
                    var snapshot = JsonUtility.FromJson<Snapshot>(payload);
                    if (snapshot?.rows == null || snapshot.version != 1 || snapshot.rows.Length > TeamForgeTransformRecoveryStore.MaximumRows)
                        throw new IOException();
                    foreach (var row in snapshot.rows)
                        if (row == null || !row.IsValid || !next.TryAdd(row.Key, row)) throw new IOException();
                }
                rows = next;
                readable = true;
                error = string.Empty;
                return true;
            }
            catch (Exception)
            {
                readable = false;
                error = "The previous primitive deletion inbox could not be verified and remains on disk.";
                return false;
            }
        }
    }
}

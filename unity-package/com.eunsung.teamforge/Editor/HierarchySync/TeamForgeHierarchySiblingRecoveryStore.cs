using System;
using System.Collections.Generic;
using System.IO;
using UnityEngine;

namespace EunSung.TeamForge
{
    [Serializable]
    internal sealed class TeamForgeSiblingRecoveryMember
    {
        public string objectId;
        public long createdRevision;
    }

    internal enum TeamForgeSiblingOrderChange { Unchanged, SingleMove, MembershipMismatch, Ambiguous, MultipleMoves }

    internal static class TeamForgeSiblingOrder
    {
        internal const long MaximumRevision = 9007199254740991L;

        internal static bool SameOrder(TeamForgeSiblingRecoveryMember[] left, TeamForgeSiblingRecoveryMember[] right)
        {
            if (left == null || right == null || left.Length != right.Length) return false;
            for (var index = 0; index < left.Length; index++)
                if (!SameMember(left[index], right[index])) return false;
            return true;
        }

        internal static TeamForgeSiblingOrderChange Compare(TeamForgeSiblingRecoveryMember[] before,
            TeamForgeSiblingRecoveryMember[] desired, string preferredObjectId, out int beforeIndex, out int desiredIndex)
        {
            beforeIndex = desiredIndex = -1;
            if (!SameMembership(before, desired)) return TeamForgeSiblingOrderChange.MembershipMismatch;

            var first = 0;
            while (first < before.Length && SameMember(before[first], desired[first])) first++;
            if (first == before.Length) return TeamForgeSiblingOrderChange.Unchanged;
            var last = before.Length - 1;
            while (SameMember(before[last], desired[last])) last--;

            // A single move shifts one contiguous range. Its first and last changed
            // slots are the only possible source and destination positions.
            var forward = IsExactMove(before, desired, first, last);
            var backward = IsExactMove(before, desired, last, first);
            if (!forward && !backward) return TeamForgeSiblingOrderChange.MultipleMoves;
            if (forward && backward)
            {
                if (before[first].objectId == preferredObjectId) backward = false;
                else if (before[last].objectId == preferredObjectId) forward = false;
                else return TeamForgeSiblingOrderChange.Ambiguous;
            }
            beforeIndex = forward ? first : last;
            desiredIndex = forward ? last : first;
            return TeamForgeSiblingOrderChange.SingleMove;
        }

        private static bool SameMembership(TeamForgeSiblingRecoveryMember[] before, TeamForgeSiblingRecoveryMember[] desired)
        {
            if (before == null || desired == null || before.Length != desired.Length) return false;
            var remaining = new Dictionary<string, long>(StringComparer.Ordinal);
            foreach (var member in before)
            {
                if (member == null || !TeamForgeTransformRecoveryScope.Text(member.objectId, 512) ||
                    member.createdRevision < 0 || member.createdRevision > MaximumRevision ||
                    !remaining.TryAdd(member.objectId, member.createdRevision)) return false;
            }
            foreach (var member in desired)
            {
                if (member == null || member.objectId == null || !remaining.TryGetValue(member.objectId, out var revision) ||
                    revision != member.createdRevision) return false;
                remaining.Remove(member.objectId);
            }
            return true;
        }

        private static bool IsExactMove(TeamForgeSiblingRecoveryMember[] before, TeamForgeSiblingRecoveryMember[] desired,
            int from, int to)
        {
            if (!SameMember(before[from], desired[to])) return false;
            var shift = from < to ? 1 : -1;
            for (var position = from; position != to; position += shift)
                if (!SameMember(before[position + shift], desired[position])) return false;
            return true;
        }

        private static bool SameMember(TeamForgeSiblingRecoveryMember left, TeamForgeSiblingRecoveryMember right) =>
            left != null && right != null && left.objectId == right.objectId && left.createdRevision == right.createdRevision;
    }

    [Serializable]
    internal sealed class TeamForgeHierarchySiblingRecoveryRow
    {
        public TeamForgeTransformRecoveryScope scope;
        public string sceneId, scenePath, objectId, authorityEpoch, operationId, parentObjectId;
        public long createdRevision, parentCreatedRevision;
        public TeamForgeSiblingRecoveryMember[] beforeOrder, desiredOrder;
        public int beforeIndex, desiredIndex;
        public bool needsReview;

        internal string Key => TeamForgeTransformRecoveryStore.TargetKey(scope.Key, sceneId, objectId);

        internal bool IsValid
        {
            get
            {
                if (scope == null || !scope.IsValid || !TeamForgeWp6ComponentIdentity.IsSceneGuid(sceneId) ||
                    !TeamForgeHierarchyRenameRecoveryRow.ValidScenePath(scenePath) ||
                    !TeamForgeTransformRecoveryScope.Text(objectId, 512) ||
                    !TeamForgeDurableSessionWire.IsCanonicalUuid(authorityEpoch) ||
                    (!string.IsNullOrEmpty(operationId) && !TeamForgeTransformRecoveryScope.Text(operationId, 128)) ||
                    parentObjectId == null || (parentObjectId.Length == 0 ? parentCreatedRevision != 0 :
                        !TeamForgeTransformRecoveryScope.Text(parentObjectId, 512) || parentCreatedRevision < 0 ||
                        parentCreatedRevision > TeamForgeSiblingOrder.MaximumRevision)) return false;
                if (TeamForgeSiblingOrder.Compare(beforeOrder, desiredOrder, objectId, out var from, out var to) !=
                    TeamForgeSiblingOrderChange.SingleMove || from != beforeIndex || to != desiredIndex ||
                    beforeOrder[from].objectId != objectId || beforeOrder[from].createdRevision != createdRevision) return false;
                foreach (var member in beforeOrder)
                    if (member.objectId == parentObjectId) return false;
                return true;
            }
        }

        internal TeamForgeHierarchySiblingRecoveryRow Copy() =>
            JsonUtility.FromJson<TeamForgeHierarchySiblingRecoveryRow>(JsonUtility.ToJson(this));
    }

    internal sealed class TeamForgeHierarchySiblingRecoveryStore
    {
        private const int MaximumRows = 64;
        [Serializable] private sealed class Snapshot { public int version = 1; public TeamForgeHierarchySiblingRecoveryRow[] rows; }
        private Dictionary<string, TeamForgeHierarchySiblingRecoveryRow> rows =
            new Dictionary<string, TeamForgeHierarchySiblingRecoveryRow>(StringComparer.Ordinal);
        private readonly TeamForgeHierarchyRecoveryFile file;
        private bool readable = true;

        internal TeamForgeHierarchySiblingRecoveryStore(string path) { file = new TeamForgeHierarchyRecoveryFile(path); }

        internal IReadOnlyList<TeamForgeHierarchySiblingRecoveryRow> Rows()
        {
            var result = new List<TeamForgeHierarchySiblingRecoveryRow>();
            foreach (var row in rows.Values) result.Add(row.Copy());
            result.Sort((left, right) => string.CompareOrdinal(left.Key, right.Key));
            return result;
        }

        internal bool TryGet(string key, out TeamForgeHierarchySiblingRecoveryRow row)
        {
            row = key != null && rows.TryGetValue(key, out var stored) ? stored.Copy() : null;
            return row != null;
        }

        internal bool TryGetGroup(string scopeKey, string sceneId, string parentObjectId, out TeamForgeHierarchySiblingRecoveryRow row)
        {
            foreach (var stored in rows.Values)
            {
                if (stored.sceneId != sceneId || stored.parentObjectId != parentObjectId || stored.scope.Key != scopeKey) continue;
                row = stored.Copy();
                return true;
            }
            row = null;
            return false;
        }

        internal bool Put(TeamForgeHierarchySiblingRecoveryRow row, out string error)
        {
            if (!readable || row == null || !row.IsValid)
            { error = "The sibling order recovery inbox is unavailable or the order is invalid."; return false; }
            if (rows.TryGetValue(row.Key, out var prior))
            {
                if (prior.parentObjectId != row.parentObjectId || prior.parentCreatedRevision != row.parentCreatedRevision ||
                    prior.createdRevision != row.createdRevision || prior.scenePath != row.scenePath)
                { error = "The archived sibling move belongs to a different saved target or parent."; return false; }
            }
            else if (rows.Count >= MaximumRows || TryGetGroup(row.scope.Key, row.sceneId, row.parentObjectId, out _))
            { error = "The sibling order recovery inbox is full or this group already has a saved move."; return false; }
            return Change(row.Key, row.Copy(), out error);
        }

        internal bool Remove(string key, out string error) => Change(key, null, out error);

        private bool Change(string key, TeamForgeHierarchySiblingRecoveryRow next, out string error)
        {
            error = string.Empty;
            if (!readable) { error = "The sibling order recovery inbox is unavailable."; return false; }
            if (key == null) return true;
            rows.TryGetValue(key, out var prior);
            if (next == null && prior == null) return true;
            if (next == null) rows.Remove(key);
            else rows[key] = next;
            try
            {
                file.Write(JsonUtility.ToJson(new Snapshot { rows = new List<TeamForgeHierarchySiblingRecoveryRow>(rows.Values).ToArray() }));
                return true;
            }
            catch (Exception)
            {
                if (prior == null) rows.Remove(key);
                else rows[key] = prior;
                error = "The sibling order recovery checkpoint could not be updated. The previous checkpoint was preserved.";
                return false;
            }
        }

        internal bool Load(out string error)
        {
            error = string.Empty;
            try
            {
                var loaded = new Dictionary<string, TeamForgeHierarchySiblingRecoveryRow>(StringComparer.Ordinal);
                var payload = file.Read();
                if (payload != null)
                {
                    var snapshot = JsonUtility.FromJson<Snapshot>(payload);
                    if (snapshot?.rows == null || snapshot.version != 1 || snapshot.rows.Length > MaximumRows) throw new IOException();
                    var groups = new HashSet<string>(StringComparer.Ordinal);
                    foreach (var row in snapshot.rows)
                    {
                        if (row == null || !row.IsValid || !loaded.TryAdd(row.Key, row) ||
                            !groups.Add(TeamForgeTransformRecoveryStore.TargetKey(row.scope.Key, row.sceneId, row.parentObjectId)))
                            throw new IOException();
                        row.needsReview = true;
                    }
                }
                rows = loaded;
                readable = true;
                return true;
            }
            catch (Exception)
            {
                readable = false;
                error = "The previous sibling order recovery file could not be verified and remains on disk.";
                return false;
            }
        }
    }
}

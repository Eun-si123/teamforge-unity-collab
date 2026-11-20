using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using UnityEngine;

namespace EunSung.TeamForge
{
    [Serializable]
    internal sealed class TeamForgeHierarchyRenameRecoveryRow
    {
        public TeamForgeTransformRecoveryScope scope;
        public string sceneId, scenePath, objectId, authorityEpoch, operationId;
        public string beforeName, desiredName;
        public long createdRevision;
        public bool needsReview;

        internal string Key => TeamForgeTransformRecoveryStore.TargetKey(scope.Key, sceneId, objectId);
        internal bool IsValid => scope != null && scope.IsValid && TeamForgeWp6ComponentIdentity.IsSceneGuid(sceneId) &&
            ValidScenePath(scenePath) && TeamForgeTransformRecoveryScope.Text(objectId, 512) &&
            TeamForgeDurableSessionWire.IsCanonicalUuid(authorityEpoch) &&
            (string.IsNullOrEmpty(operationId) || TeamForgeTransformRecoveryScope.Text(operationId, 128)) &&
            createdRevision >= 0 && createdRevision <= 9007199254740991L && ValidName(beforeName) && ValidName(desiredName);

        internal TeamForgeHierarchyRenameRecoveryRow Copy() =>
            JsonUtility.FromJson<TeamForgeHierarchyRenameRecoveryRow>(JsonUtility.ToJson(this));

        internal static bool ValidName(string value)
        {
            if (string.IsNullOrWhiteSpace(value) || value.Length > 128) return false;
            foreach (var character in value)
                if (char.IsControl(character) || character == '\u2028' || character == '\u2029') return false;
            return true;
        }

        private static bool ValidScenePath(string value)
        {
            if (!TeamForgeTransformRecoveryScope.Text(value, 1024) || !value.StartsWith("Assets/", StringComparison.Ordinal) ||
                !value.EndsWith(".unity", StringComparison.Ordinal) || value.Contains("\\")) return false;
            foreach (var part in value.Split('/')) if (part.Length == 0 || part == "." || part == "..") return false;
            return true;
        }
    }

    internal sealed class TeamForgeHierarchyRenameRecoveryStore
    {
        private const int MaximumRows = 64;
        private const int MaximumBytes = 256 * 1024;
        private static readonly UTF8Encoding Encoding = new UTF8Encoding(false, true);
        [Serializable] private sealed class Snapshot { public int version = 1; public TeamForgeHierarchyRenameRecoveryRow[] rows; }
        [Serializable] private sealed class Envelope { public string payload, checksum; }
        private readonly Dictionary<string, TeamForgeHierarchyRenameRecoveryRow> rows =
            new Dictionary<string, TeamForgeHierarchyRenameRecoveryRow>(StringComparer.Ordinal);
        private readonly string path;
        private bool readable = true;

        internal TeamForgeHierarchyRenameRecoveryStore(string path) { this.path = path; }

        internal IReadOnlyList<TeamForgeHierarchyRenameRecoveryRow> Rows()
        {
            var result = new List<TeamForgeHierarchyRenameRecoveryRow>();
            foreach (var row in rows.Values) result.Add(row.Copy());
            result.Sort((left, right) => string.CompareOrdinal(left.Key, right.Key));
            return result;
        }

        internal bool TryGet(string key, out TeamForgeHierarchyRenameRecoveryRow row)
        {
            row = rows.TryGetValue(key, out var stored) ? stored.Copy() : null;
            return row != null;
        }

        internal bool Put(TeamForgeHierarchyRenameRecoveryRow row, out string error)
        {
            error = "The rename recovery inbox is unavailable, full or contains an invalid name.";
            if (!readable || row == null || !row.IsValid) return false;
            var key = row.Key;
            rows.TryGetValue(key, out var prior);
            if (prior == null && rows.Count >= MaximumRows) return false;
            rows[key] = row.Copy();
            if (Save(out error)) return true;
            if (prior == null) rows.Remove(key);
            else rows[key] = prior;
            return false;
        }

        internal bool Remove(string key, out string error)
        {
            error = string.Empty;
            if (!rows.TryGetValue(key, out var prior)) return true;
            rows.Remove(key);
            if (Save(out error)) return true;
            rows[key] = prior;
            return false;
        }

        internal bool Load(out string error)
        {
            error = string.Empty;
            try
            {
                if (!File.Exists(path)) return true;
                RequireSafeFile(false);
                var bytes = new byte[MaximumBytes + 1];
                var count = 0;
                using (var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read))
                {
                    while (count < bytes.Length)
                    {
                        var read = stream.Read(bytes, count, bytes.Length - count);
                        if (read == 0) break;
                        count += read;
                    }
                }
                if (count > MaximumBytes) throw new IOException();
                var envelope = JsonUtility.FromJson<Envelope>(Encoding.GetString(bytes, 0, count));
                if (envelope?.payload == null || envelope.checksum != TeamForgeTransformRecoveryStore.Digest(envelope.payload))
                    throw new IOException();
                var snapshot = JsonUtility.FromJson<Snapshot>(envelope.payload);
                if (snapshot?.rows == null || snapshot.version != 1 || snapshot.rows.Length > MaximumRows) throw new IOException();
                var loaded = new Dictionary<string, TeamForgeHierarchyRenameRecoveryRow>(StringComparer.Ordinal);
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
                error = "The previous rename recovery file could not be verified and remains on disk. New rename submissions are paused.";
                return false;
            }
        }

        private bool Save(out string error)
        {
            error = string.Empty;
            var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try
            {
                var payload = JsonUtility.ToJson(new Snapshot { rows = new List<TeamForgeHierarchyRenameRecoveryRow>(rows.Values).ToArray() });
                var bytes = Encoding.GetBytes(JsonUtility.ToJson(new Envelope
                    { payload = payload, checksum = TeamForgeTransformRecoveryStore.Digest(payload) }));
                if (bytes.Length > MaximumBytes) throw new IOException();
                RequireSafeFile(true);
                using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                {
                    stream.Write(bytes, 0, bytes.Length);
                    stream.Flush(true);
                }
                if (File.Exists(path)) File.Replace(temporary, path, null);
                else File.Move(temporary, path);
                return true;
            }
            catch (Exception)
            {
                error = "The rename recovery checkpoint could not be updated. The previous checkpoint was preserved.";
                return false;
            }
            finally
            {
                try { if (File.Exists(temporary)) File.Delete(temporary); }
                catch (Exception) { TeamForgeDiagnostics.Warning("Rename recovery temporary file cleanup failed."); }
            }
        }

        private void RequireSafeFile(bool create)
        {
            var directory = new DirectoryInfo(Path.GetDirectoryName(path));
            for (var parent = directory; parent != null; parent = parent.Parent)
            {
                if (parent.Exists && (parent.Attributes & FileAttributes.ReparsePoint) != 0) throw new IOException();
            }
            if (create) directory.Create();
            if (File.Exists(path) && (new FileInfo(path).Attributes & FileAttributes.ReparsePoint) != 0) throw new IOException();
        }
    }
}

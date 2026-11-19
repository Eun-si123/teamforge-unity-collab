using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using UnityEngine;

namespace EunSung.TeamForge
{
    [Serializable]
    internal sealed class TeamForgeTransformRecoveryScope
    {
        public string projectId, sessionId, projectUuid, durableSessionId, manifestHash, descriptorHash;
        public long baselineRevision;
        internal string Key => TeamForgeTransformRecoveryStore.Digest(JsonUtility.ToJson(this));
        internal bool IsValid => Text(projectId, 128) && Text(sessionId, 128) &&
            TeamForgeDurableSessionWire.IsCanonicalUuid(projectUuid) && TeamForgeDurableSessionWire.IsCanonicalUuid(durableSessionId) &&
            Hash(manifestHash) && Hash(descriptorHash) && baselineRevision >= 0 && baselineRevision <= 9007199254740991L;
        internal static bool Text(string value, int max)
        {
            if (string.IsNullOrEmpty(value) || value != value.Trim() || value.Length > max) return false;
            foreach (var c in value) if (char.IsControl(c)) return false;
            return true;
        }
        private static bool Hash(string value)
        {
            if (value == null || value.Length != 64) return false;
            foreach (var c in value) if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
            return true;
        }
    }

    [Serializable]
    internal sealed class TeamForgeTransformRecoveryRow
    {
        public TeamForgeTransformRecoveryScope scope;
        public string sceneId, scenePath, objectId, parentObjectId, authorityEpoch, operationId;
        public TeamForgeTransformState desired, before;
        public bool needsReview;
        internal string Key => TeamForgeTransformRecoveryStore.TargetKey(scope.Key, sceneId, objectId);
        internal bool IsValid => scope != null && scope.IsValid && TeamForgeWp6ComponentIdentity.IsSceneGuid(sceneId) &&
            IsSceneAssetPath(scenePath) &&
            TeamForgeTransformRecoveryScope.Text(objectId, 512) && parentObjectId != null &&
            (parentObjectId.Length == 0 || TeamForgeTransformRecoveryScope.Text(parentObjectId, 512)) &&
            TeamForgeDurableSessionWire.IsCanonicalUuid(authorityEpoch) &&
            (string.IsNullOrEmpty(operationId) || TeamForgeTransformRecoveryScope.Text(operationId, 128)) &&
            ValidPose(desired) && (before == null || ValidPose(before));
        internal TeamForgeTransformRecoveryRow Copy() => JsonUtility.FromJson<TeamForgeTransformRecoveryRow>(JsonUtility.ToJson(this));
        private static bool IsSceneAssetPath(string candidate)
        {
            if (!TeamForgeTransformRecoveryScope.Text(candidate, 1024) || !candidate.StartsWith("Assets/", StringComparison.Ordinal) ||
                !candidate.EndsWith(".unity", StringComparison.Ordinal) || candidate.Contains("\\")) return false;
            foreach (var part in candidate.Split('/')) if (part.Length == 0 || part == "." || part == "..") return false;
            return true;
        }
        internal static bool ValidPose(TeamForgeTransformState state) => state != null &&
            TeamForgeTransformState.TryFromMessage(new TransformAppliedMessage { localPosition = state.PositionDto(),
                localRotation = state.RotationDto(), localScale = state.ScaleDto() }, out _, out _);
    }

    // Local intent is written before sending. This file cannot authorize a
    // target: review independently checks the current source, owner and lock.
    internal sealed class TeamForgeTransformRecoveryStore
    {
        internal const int MaximumRows = 64;
        private const int MaximumBytes = 256 * 1024;
        [Serializable] private sealed class Snapshot { public int version = 1; public TeamForgeTransformRecoveryRow[] rows; }
        [Serializable] private sealed class Envelope { public string payload, checksum; }
        private readonly Dictionary<string, TeamForgeTransformRecoveryRow> rows = new Dictionary<string, TeamForgeTransformRecoveryRow>(StringComparer.Ordinal);
        private readonly string path;
        private bool readable = true;
        internal TeamForgeTransformRecoveryStore(string path) { this.path = path; }
        internal IReadOnlyList<TeamForgeTransformRecoveryRow> Rows()
        {
            var result = new List<TeamForgeTransformRecoveryRow>();
            foreach (var row in rows.Values) result.Add(row.Copy());
            result.Sort((a, b) => string.CompareOrdinal(a.Key, b.Key)); return result;
        }
        internal bool TryGet(string key, out TeamForgeTransformRecoveryRow row)
        { if (rows.TryGetValue(key, out var value)) { row = value.Copy(); return true; } row = null; return false; }
        internal bool Put(TeamForgeTransformRecoveryRow row, out string error)
        {
            error = "Transform recovery intent is invalid or its bounded inbox is full.";
            if (!readable || row == null || !row.IsValid || (!rows.ContainsKey(row.Key) && rows.Count >= MaximumRows)) return false;
            rows[row.Key] = row.Copy(); return Save(out error);
        }
        internal bool Remove(string key, out string error)
        {
            error = string.Empty;
            if (!readable) { error = "The existing recovery file requires repair or export."; return false; }
            if (!rows.TryGetValue(key, out var previous)) return true;
            rows.Remove(key);
            if (Save(out error)) return true;
            rows[key] = previous;
            return false;
        }
        internal bool NeedsReview(string scopeKey, string sceneId, string objectId) =>
            rows.TryGetValue(TargetKey(scopeKey, sceneId, objectId), out var row) && row.needsReview;
        internal bool ConfirmShared(string scopeKey, string sceneId, string objectId, TeamForgeTransformState pose, out string error)
        {
            error = string.Empty;
            var key = TargetKey(scopeKey, sceneId, objectId);
            return !rows.TryGetValue(key, out var row) || !row.desired.ApproximatelyEquals(pose) || Remove(key, out error);
        }
        internal bool Load(out string error)
        {
            error = string.Empty;
            if (!File.Exists(path)) return true;
            try
            {
                if (!SafeDirectory(Path.GetDirectoryName(path), false) ||
                    (new FileInfo(path).Attributes & FileAttributes.ReparsePoint) != 0) throw new IOException();
                string json;
                using (var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read))
                {
                    if (stream.Length > MaximumBytes) throw new IOException();
                    var bytes = new byte[MaximumBytes + 1]; var count = 0;
                    while (count < bytes.Length)
                    { var read = stream.Read(bytes, count, bytes.Length - count); if (read == 0) break; count += read; }
                    if (count > MaximumBytes) throw new IOException();
                    json = new UTF8Encoding(false, true).GetString(bytes, 0, count);
                }
                var envelope = JsonUtility.FromJson<Envelope>(json);
                if (envelope == null || envelope.payload == null || envelope.checksum != Digest(envelope.payload)) throw new IOException();
                var snapshot = JsonUtility.FromJson<Snapshot>(envelope.payload);
                if (snapshot == null || snapshot.version != 1 || snapshot.rows == null || snapshot.rows.Length > MaximumRows) throw new IOException();
                var next = new Dictionary<string, TeamForgeTransformRecoveryRow>(StringComparer.Ordinal);
                foreach (var row in snapshot.rows)
                { if (row == null || !row.IsValid || next.ContainsKey(row.Key)) throw new IOException(); row.needsReview = true; next.Add(row.Key, row); }
                rows.Clear(); foreach (var pair in next) rows.Add(pair.Key, pair.Value);
                readable = true; return true;
            }
            catch (Exception) { readable = false; error = "Transform recovery file could not be verified. It was preserved; shared submissions are paused."; return false; }
        }
        private bool Save(out string error)
        {
            error = string.Empty; string temporary = null;
            try
            {
                var payload = JsonUtility.ToJson(new Snapshot { rows = new List<TeamForgeTransformRecoveryRow>(rows.Values).ToArray() });
                var json = JsonUtility.ToJson(new Envelope { payload = payload, checksum = Digest(payload) });
                if (Encoding.UTF8.GetByteCount(json) > MaximumBytes || !SafeDirectory(Path.GetDirectoryName(path), true) ||
                    (File.Exists(path) && (new FileInfo(path).Attributes & FileAttributes.ReparsePoint) != 0)) throw new IOException();
                temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
                using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                {
                    var bytes = new UTF8Encoding(false).GetBytes(json); stream.Write(bytes, 0, bytes.Length); stream.Flush(true);
                }
                if (File.Exists(path)) File.Replace(temporary, path, null); else File.Move(temporary, path);
                return true;
            }
            catch (Exception) { error = "Transform intent remains in this Editor, but its recovery checkpoint could not be saved. No command was sent."; return false; }
            finally
            {
                try { if (temporary != null && File.Exists(temporary)) File.Delete(temporary); }
                catch (Exception) { TeamForgeDiagnostics.Warning("Transform recovery temporary file cleanup failed; the prior checkpoint remains preserved."); }
            }
        }
        private static bool SafeDirectory(string directory, bool create)
        {
            var current = new DirectoryInfo(directory);
            if (!current.Exists)
            { if (!create || current.Parent == null || !SafeDirectory(current.Parent.FullName, true)) return false; current.Create(); }
            for (var part = current; part != null; part = part.Parent)
                if ((part.Attributes & FileAttributes.ReparsePoint) != 0) return false;
            return true;
        }
        internal static string Digest(string value)
        { using (var sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(value))).Replace("-", string.Empty).ToLowerInvariant(); }
        internal static string TargetKey(string scopeKey, string sceneId, string objectId) => Digest(scopeKey + "\n" + sceneId + "\n" + objectId);
    }
}

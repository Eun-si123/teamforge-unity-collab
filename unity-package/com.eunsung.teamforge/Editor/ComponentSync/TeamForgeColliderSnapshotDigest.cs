using System;
using System.Collections.Generic;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace EunSung.TeamForge
{
    // The wire digest has an explicit representation shared with Node: canonical
    // identity lines, IEEE754 binary32 values, LF separators, no trailing LF.
    internal static class TeamForgeColliderSnapshotDigest
    {
        internal static string Compute(TeamForgeComponentSource source, string epoch, string sceneId,
            long revision, IReadOnlyList<TeamForgeColliderProperty> rows)
        {
            if (source == null || rows == null) throw new ArgumentException("A complete Collider snapshot is required.");
            var fields = new List<string>
            {
                "teamforge-collider-snapshot-v1", source.projectUuid,
                source.baselineRevision.ToString(CultureInfo.InvariantCulture), source.manifestHash,
                source.descriptorHash, source.scenePath, source.sceneFileSha256, source.sceneMetaSha256,
                epoch, sceneId, revision.ToString(CultureInfo.InvariantCulture),
            };
            foreach (var row in rows)
            {
                if (row == null || !row.IsValid) throw new ArgumentException("Invalid Collider digest row.");
                fields.Add(row.SceneId); fields.Add(row.ObjectId); fields.Add(row.ComponentId);
                fields.Add(row.TypeName); fields.Add(row.Path); fields.Add(row.Kind);
                fields.Add(row.Revision.ToString(CultureInfo.InvariantCulture));
                fields.Add(row.Kind == "boolean" ? row.Boolean ? "1" : "0" :
                    row.Kind == "float" ? FloatHex(row.Number) :
                    FloatHex(row.Vector.x) + FloatHex(row.Vector.y) + FloatHex(row.Vector.z));
            }
            using (var sha = SHA256.Create())
                return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(string.Join("\n", fields))))
                    .Replace("-", string.Empty).ToLowerInvariant();
        }

        private static string FloatHex(float value)
        {
            if (value == 0f) value = 0f; // Normalize IEEE754 negative zero.
            var bytes = BitConverter.GetBytes(value);
            if (BitConverter.IsLittleEndian) Array.Reverse(bytes);
            return BitConverter.ToString(bytes).Replace("-", string.Empty).ToLowerInvariant();
        }
    }
}

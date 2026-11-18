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

        internal static string ComputeV2(TeamForgeComponentSource source, string epoch, string sceneId,
            long revision, long structureRevision,
            IReadOnlyList<TeamForgeColliderComponentCatalogRow> components,
            IReadOnlyList<TeamForgeColliderComponentCatalogRow> tombstones,
            IReadOnlyList<TeamForgeColliderProperty> rows)
        {
            if (source == null || components == null || tombstones == null || rows == null ||
                !TeamForgeWp6ComponentIdentity.IsSceneGuid(sceneId) || revision < 0 ||
                revision > 9007199254740991L || structureRevision < 0 || structureRevision > revision ||
                components.Count > 512 || tombstones.Count > 4096 || rows.Count != components.Count * 3)
                throw new ArgumentException("A complete bounded runtime Collider catalog is required.");
            var fields = new List<string>
            {
                "teamforge-collider-snapshot-v2", source.projectUuid,
                source.baselineRevision.ToString(CultureInfo.InvariantCulture), source.manifestHash,
                source.descriptorHash, source.scenePath, source.sceneFileSha256, source.sceneMetaSha256,
                epoch, sceneId, revision.ToString(CultureInfo.InvariantCulture),
                structureRevision.ToString(CultureInfo.InvariantCulture),
            };
            var identities = new HashSet<string>(StringComparer.Ordinal);
            AppendCatalog("components", components, sceneId, revision, identities, fields);
            AppendCatalog("tombstones", tombstones, sceneId, revision, identities, fields);
            fields.Add("properties"); fields.Add(rows.Count.ToString(CultureInfo.InvariantCulture));
            foreach (var row in rows)
            {
                if (row == null || !row.IsValid || row.SceneId != sceneId || row.Revision > revision)
                    throw new ArgumentException("Invalid runtime Collider digest row.");
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

        private static void AppendCatalog(string label,
            IReadOnlyList<TeamForgeColliderComponentCatalogRow> rows, string sceneId, long revision,
            HashSet<string> identities, List<string> fields)
        {
            fields.Add(label); fields.Add(rows.Count.ToString(CultureInfo.InvariantCulture));
            string previous = null;
            foreach (var row in rows)
            {
                if (row == null || !row.IsValid || row.sceneId != sceneId || row.serverRevision > revision ||
                    !identities.Add(row.componentId) ||
                    (previous != null && string.CompareOrdinal(previous, row.componentId) >= 0))
                    throw new ArgumentException("Invalid, duplicate or unordered runtime Collider catalog identity.");
                fields.Add(row.sceneId); fields.Add(row.objectId); fields.Add(row.componentId);
                fields.Add(row.typeName); fields.Add(row.serverRevision.ToString(CultureInfo.InvariantCulture));
                previous = row.componentId;
            }
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

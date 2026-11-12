using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using UnityEditor;
using UnityEngine;

namespace EunSung.TeamForge
{
    // Source-only WP6 witness: compares each exact loaded allowlisted
    // Collider's SerializedProperties with its serialized *saved .unity*
    // YAML document under an expected file GUID/hash. NOT remote authority.
    internal static class TeamForgeWp6SerializedSceneWitness
    {
        internal sealed class Verified
        {
            internal Verified(TeamForgeWp6LoadedSceneSource.Capture source, int colliderCount)
            {
                Source = source;
                ColliderCount = colliderCount;
            }
            internal TeamForgeWp6LoadedSceneSource.Capture Source { get; }
            internal int ColliderCount { get; }
        }

        internal static bool TryCapture(TeamForgeSceneBaseline expected,
            string expectedMetaSha256, out Verified verified, out string error)
        {
            verified = null;
            // Parent #512 first checks clean active Scene, identity, both
            // file hashes pre/post inventory, and all-or-nothing Collider set.
            if (!TeamForgeWp6LoadedSceneSource.TryCapture(
                expected, expectedMetaSha256, out var source, out error))
                return false;

            try
            {
                if (!WithinSourceParents(expected.scenePath))
                {
                    error = "WP6 serialized Scene has a redirected or unsafe parent directory.";
                    return false;
                }
                var path = Path.GetFullPath(
                    Path.Combine(Directory.GetCurrentDirectory(), expected.scenePath));
                var info = new FileInfo(path);
                if (!info.Exists || info.Length < 1 ||
                    info.Length > TeamForgeWp6YamlColliderWitness.MaximumSerializedBytes ||
                    (info.Attributes & (FileAttributes.Directory | FileAttributes.ReparsePoint)) != 0)
                {
                    error = "WP6 serialized witness requires a bounded Unity text Scene file.";
                    return false;
                }

                string yaml;
                using (var input = new FileStream(path, FileMode.Open,
                    FileAccess.Read, FileShare.Read))
                {
                    // Bind the exact bytes about to be parsed to the expected
                    // source. Pre/post path hashes alone permit an ABA swap
                    // between those observations and this read.
                    if (!TryReadVerifiedText(input, expected.sha256, out yaml, out error))
                        return false;
                }
                if (!TryPrepare(source.Inventory, out var colliders, out error) ||
                    !TeamForgeWp6YamlColliderWitness.TryVerify(yaml, colliders, out error))
                    return false;

                // Fence a Unity Editor/Scene change or on-disk rewrite while
                // parsing: recapture the clean source and require the same
                // exact ID/type/property values (no approximate Vector3 ==).
                if (!TeamForgeWp6LoadedSceneSource.TryCapture(
                    expected, expectedMetaSha256, out var after, out error) ||
                    !SameObservations(source.Inventory, after.Inventory))
                {
                    error = "WP6 loaded serialized Scene changed during its value comparison.";
                    return false;
                }

                verified = new Verified(after, colliders.Count);
                error = string.Empty;
                return true;
            }
            catch (Exception)
            {
                error = "WP6 serialized Collider witness failed to compare saved Scene bytes.";
                return false;
            }
        }

        // The initial stream length bounds allocation and every read. One
        // sentinel byte detects growth without ever allocating the grown
        // file. Hash the same immutable buffer decoded below, never a second
        // path read that could observe a different file generation.
        internal static bool TryReadVerifiedText(Stream input, string expectedSha256,
            out string yaml, out string error)
        {
            yaml = null;
            error = "WP6 serialized Scene bytes do not match the bounded expected source.";
            if (input == null || !input.CanRead || !input.CanSeek ||
                expectedSha256 == null || expectedSha256.Length != 64)
                return false;
            foreach (var value in expectedSha256)
                if (!((value >= '0' && value <= '9') || (value >= 'a' && value <= 'f')))
                    return false;
            try
            {
                var length = input.Length;
                if (input.Position != 0 || length < 1 ||
                    length > TeamForgeWp6YamlColliderWitness.MaximumSerializedBytes)
                    return false;
                var bytes = new byte[(int)length];
                var offset = 0;
                while (offset < bytes.Length)
                {
                    var count = input.Read(bytes, offset, bytes.Length - offset);
                    if (count <= 0)
                        return false;
                    offset += count;
                }
                if (input.ReadByte() != -1 || input.Length != length)
                    return false;
                using (var sha = SHA256.Create())
                {
                    var hash = BitConverter.ToString(sha.ComputeHash(bytes))
                        .Replace("-", string.Empty).ToLowerInvariant();
                    if (!string.Equals(hash, expectedSha256, StringComparison.Ordinal))
                        return false;
                }
                // Strict UTF-8 rejects binary/malformed serialization. No
                // YAML heuristics or default values replace missing input.
                yaml = new UTF8Encoding(false, true).GetString(bytes);
                error = string.Empty;
                return true;
            }
            catch (Exception)
            {
                return false;
            }
        }

        private static bool WithinSourceParents(string relative)
        {
            if (string.IsNullOrEmpty(relative)) return false;
            var current = Directory.GetCurrentDirectory();
            if ((new DirectoryInfo(current).Attributes & FileAttributes.ReparsePoint) != 0)
                return false;
            var parts = relative.Split('/');
            for (var i = 0; i < parts.Length - 1; i++)
            {
                if (parts[i].Length == 0 || parts[i] == "." || parts[i] == "..")
                    return false;
                current = Path.Combine(current, parts[i]);
                var info = new DirectoryInfo(current);
                if (!info.Exists || (info.Attributes & FileAttributes.ReparsePoint) != 0)
                    return false;
            }
            return true;
        }

        private static bool TryPrepare(TeamForgeWp6SceneInventory.Snapshot inventory,
            out List<TeamForgeWp6YamlColliderWitness.Collider> colliders, out string error)
        {
            colliders = new List<TeamForgeWp6YamlColliderWitness.Collider>();
            if (inventory == null || inventory.SceneDirty ||
                !TeamForgeWp6ComponentIdentity.IsSceneGuid(inventory.SceneId) ||
                inventory.Observations == null ||
                inventory.Observations.Count > TeamForgeWp6YamlColliderWitness.MaximumColliders)
            {
                error = "WP6 requires a clean bounded saved Scene Collider inventory.";
                return false;
            }

            foreach (var item in inventory.Observations)
            {
                if (item == null || item.SceneDirty ||
                    !GlobalObjectId.TryParse(item.ComponentId, out var id) ||
                    !GlobalObjectId.TryParse(item.ObjectId, out var owner) ||
                    id.identifierType != 2 || owner.identifierType != 2 ||
                    id.targetPrefabId != 0 || owner.targetPrefabId != 0 ||
                    !string.Equals(id.ToString(), item.ComponentId, StringComparison.Ordinal) ||
                    !string.Equals(owner.ToString(), item.ObjectId, StringComparison.Ordinal) ||
                    id.targetObjectId == 0 || owner.targetObjectId == 0 ||
                    !string.Equals(id.assetGUID.ToString(), inventory.SceneId, StringComparison.Ordinal) ||
                    !string.Equals(owner.assetGUID.ToString(), inventory.SceneId, StringComparison.Ordinal) ||
                    item.Properties == null || item.Properties.Count != 3)
                {
                    error = "WP6 Collider witness requires exact saved Scene GlobalObjectIds.";
                    return false;
                }
                var box = string.Equals(item.TypeName, "UnityEngine.BoxCollider", StringComparison.Ordinal);
                if (!box && item.TypeName != "UnityEngine.SphereCollider")
                {
                    error = "WP6 witness supports only exact built-in Collider types.";
                    return false;
                }
                var trigger = item.Properties[0];
                var center = item.Properties[1];
                var extent = item.Properties[2];
                if (trigger.Path != "m_IsTrigger" || trigger.Kind != "boolean" ||
                    center.Path != "m_Center" || center.Kind != "vector3" ||
                    (box ? extent.Path != "m_Size" || extent.Kind != "vector3" :
                           extent.Path != "m_Radius" || extent.Kind != "float"))
                {
                    error = "WP6 serialized properties do not match the strict allowlist.";
                    return false;
                }
                colliders.Add(new TeamForgeWp6YamlColliderWitness.Collider(
                    id.targetObjectId, owner.targetObjectId, box, trigger.Boolean,
                    center.Vector.x, center.Vector.y, center.Vector.z,
                    box ? extent.Vector.x : 0f,
                    box ? extent.Vector.y : 0f,
                    box ? extent.Vector.z : 0f,
                    box ? 0f : extent.Number));
            }
            error = string.Empty;
            return true;
        }

        private static bool SameObservations(TeamForgeWp6SceneInventory.Snapshot first,
            TeamForgeWp6SceneInventory.Snapshot second)
        {
            if (first.SceneDirty || second.SceneDirty ||
                first.SceneId != second.SceneId ||
                first.Observations.Count != second.Observations.Count)
                return false;
            for (var i = 0; i < first.Observations.Count; i++)
            {
                var before = first.Observations[i];
                var after = second.Observations[i];
                if (before.SceneId != after.SceneId ||
                    before.ObjectId != after.ObjectId ||
                    before.ComponentId != after.ComponentId ||
                    before.TypeName != after.TypeName ||
                    before.Properties.Count != after.Properties.Count)
                    return false;
                for (var p = 0; p < before.Properties.Count; p++)
                {
                    var a = before.Properties[p];
                    var b = after.Properties[p];
                    if (a.Path != b.Path || a.Kind != b.Kind || a.Boolean != b.Boolean ||
                        a.Number != b.Number ||
                        a.Vector.x != b.Vector.x || a.Vector.y != b.Vector.y ||
                        a.Vector.z != b.Vector.z)
                        return false;
                }
            }
            return true;
        }
    }
}

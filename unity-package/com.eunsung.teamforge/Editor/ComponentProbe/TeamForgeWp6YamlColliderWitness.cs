using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text.RegularExpressions;

namespace EunSung.TeamForge
{
    // Narrow, pure-C# Unity text Scene verifier for the exact Collider
    // allowlist. NOT a general YAML deserializer or an authority grant.
    // Refuse a serialized form we cannot interpret without ambiguity.
    internal static class TeamForgeWp6YamlColliderWitness
    {
        internal const int MaximumSerializedBytes = 16 * 1024 * 1024;
        internal const int MaximumDocuments = 65536;
        internal const int MaximumColliders = 512;

        private static readonly Regex Header = new Regex(
            // Unity 6 SceneRoots is class ID 1660057539 (10 digits).
            // Collider IDs are 65/135; other bounded class IDs are
            // preserved for global fileID collision detection.
            @"^--- !u!([0-9]{1,10}) &(-?[1-9][0-9]{0,19})$",
            RegexOptions.CultureInvariant);
        private static readonly Regex ComponentReference = new Regex(
            @"^  - component: \{fileID: (-?[1-9][0-9]{0,19})\}$",
            RegexOptions.CultureInvariant);
        private static readonly Regex Vector = new Regex(
            @"^\{x: ([^,}]{1,32}), y: ([^,}]{1,32}), z: ([^,}]{1,32})\}$",
            RegexOptions.CultureInvariant);
        private static readonly Regex ObjectReference = new Regex(
            @"^\{fileID: (-?[1-9][0-9]{0,19})\}$",
            RegexOptions.CultureInvariant);

        internal sealed class Collider
        {
            internal Collider(ulong componentFileId, ulong ownerFileId, bool box,
                bool trigger, float centerX, float centerY, float centerZ,
                float sizeX, float sizeY, float sizeZ, float radius)
            {
                ComponentFileId = componentFileId;
                OwnerFileId = ownerFileId;
                IsBox = box;
                IsTrigger = trigger;
                CenterX = centerX;
                CenterY = centerY;
                CenterZ = centerZ;
                SizeX = sizeX;
                SizeY = sizeY;
                SizeZ = sizeZ;
                Radius = radius;
            }

            internal ulong ComponentFileId { get; }
            internal ulong OwnerFileId { get; }
            internal bool IsBox { get; }
            internal bool IsTrigger { get; }
            internal float CenterX { get; }
            internal float CenterY { get; }
            internal float CenterZ { get; }
            internal float SizeX { get; }
            internal float SizeY { get; }
            internal float SizeZ { get; }
            internal float Radius { get; }
        }

        private sealed class Document
        {
            internal int ClassId;
            internal ulong FileId;
            internal string Root;
            internal readonly Dictionary<string, string> Fields =
                new Dictionary<string, string>(StringComparer.Ordinal);
            internal readonly HashSet<ulong> ComponentRefs = new HashSet<ulong>();
            internal bool ComponentList;
        }

        internal static bool TryVerify(string yaml, IReadOnlyList<Collider> observations,
            out string error)
        {
            error = string.Empty;
            if (yaml == null || yaml.Length > MaximumSerializedBytes ||
                observations == null || observations.Count > MaximumColliders)
            {
                error = "WP6 serialized Scene observation exceeds its bounded input contract.";
                return false;
            }

            var expected = new Dictionary<ulong, Collider>();
            foreach (var observation in observations)
            {
                if (observation == null || observation.ComponentFileId == 0 ||
                    observation.OwnerFileId == 0 ||
                    observation.ComponentFileId == observation.OwnerFileId ||
                    expected.ContainsKey(observation.ComponentFileId))
                {
                    error = "WP6 serialized Collider expected IDs are ambiguous.";
                    return false;
                }
                expected.Add(observation.ComponentFileId, observation);
            }

            var owners = new Dictionary<ulong, Document>();
            var serialized = new Dictionary<ulong, Document>();
            var globalIds = new HashSet<ulong>();
            using (var input = new StringReader(yaml))
            {
                if (!string.Equals(input.ReadLine(), "%YAML 1.1", StringComparison.Ordinal) ||
                    !string.Equals(input.ReadLine(), "%TAG !u! tag:unity3d.com,2011:",
                        StringComparison.Ordinal))
                {
                    error = "WP6 supports only the canonical Unity text Scene YAML header.";
                    return false;
                }
                Document current = null;
                var documentCount = 0;
                string line;
                while ((line = input.ReadLine()) != null)
                {
                    if (line.Length > 16384)
                    {
                        error = "WP6 Unity Scene YAML line exceeds the bounded input contract.";
                        return false;
                    }
                    if (line.StartsWith("---", StringComparison.Ordinal))
                    {
                        if (current != null && !Collect(current, owners, serialized))
                        {
                            error = "WP6 Unity Scene contains an unsupported or duplicate Collider document.";
                            return false;
                        }
                        if (++documentCount > MaximumDocuments ||
                            !TryHeader(line, globalIds, out current) ||
                            current.ClassId == 1001)
                        {
                            error = "WP6 Unity Scene YAML document identity or Prefab is unsupported.";
                            return false;
                        }
                        continue;
                    }
                    if (current == null)
                    {
                        if (line.Length > 0)
                        {
                            error = "WP6 Unity Scene YAML contains data outside a document.";
                            return false;
                        }
                        continue;
                    }
                    if (current.ClassId != 1 && current.ClassId != 65 &&
                        current.ClassId != 135)
                        continue;
                    if (current.Root == null)
                    {
                        current.Root = line;
                        continue;
                    }
                    if (line.StartsWith("  m_Component:", StringComparison.Ordinal))
                    {
                        if (current.ClassId != 1 || current.ComponentList ||
                            !string.Equals(line, "  m_Component:", StringComparison.Ordinal))
                        {
                            error = "WP6 Unity GameObject Component list is ambiguous.";
                            return false;
                        }
                        current.ComponentList = true;
                    }
                    else if (current.ClassId == 1 && current.ComponentList &&
                             line.StartsWith("  - component:", StringComparison.Ordinal))
                    {
                        var match = ComponentReference.Match(line);
                        if (!match.Success ||
                            !TryLocalFileId(match.Groups[1].Value, out var reference) ||
                            !current.ComponentRefs.Add(reference))
                        {
                            error = "WP6 Unity GameObject references duplicate or invalid Components.";
                            return false;
                        }
                    }
                    else if (line.StartsWith("  m_", StringComparison.Ordinal))
                    {
                        // Unity serializes some *unrelated* fields with an
                        // empty scalar (e.g. m_EditorClassIdentifier:). Do
                        // not confuse an empty value with malformed YAML,
                        // while preserving exact-key duplicate rejection.
                        // Missing values on an allowlisted Collider field
                        // are still refused by SameCollider below.
                        var split = line.IndexOf(':', 2);
                        if (split <= 2 ||
                            (split + 1 < line.Length && line[split + 1] != ' '))
                        {
                            error = "WP6 Unity serialized property structure is unsupported.";
                            return false;
                        }
                        var name = line.Substring(2, split - 2);
                        var value = split + 1 == line.Length ? string.Empty :
                            line.Substring(split + 2);
                        if (!current.Fields.TryAdd(name, value))
                        {
                            error = "WP6 Unity Scene contains duplicate serialized property names.";
                            return false;
                        }
                    }
                }
                if (current != null && !Collect(current, owners, serialized))
                {
                    error = "WP6 Unity Scene contains invalid Collider or GameObject documents.";
                    return false;
                }
            }

            // The entire allowlisted Scene inventory must match the file.
            // A partial "verified" view with a missing Collider is forbidden.
            if (serialized.Count != expected.Count)
            {
                error = "WP6 loaded Collider set differs from the serialized Scene set.";
                return false;
            }
            // A Collider must occur only under its declared GameObject.
            // Checking that the correct owner lists it is insufficient when
            // another GameObject also lists the same Collider fileID.
            foreach (var owner in owners.Values)
            {
                foreach (var reference in owner.ComponentRefs)
                {
                    if (serialized.TryGetValue(reference, out var collider) &&
                        (!TryRef(collider, "m_GameObject", out var declaredOwner) ||
                         declaredOwner != owner.FileId))
                    {
                        error = "WP6 Unity GameObject lists a Collider owned by another object.";
                        return false;
                    }
                }
            }
            foreach (var entry in serialized)
            {
                if (!expected.TryGetValue(entry.Key, out var observed) ||
                    !SameCollider(entry.Value, observed) ||
                    !owners.TryGetValue(observed.OwnerFileId, out var owner) ||
                    !owner.ComponentList || !owner.ComponentRefs.Contains(entry.Key))
                {
                    error = "WP6 Unity serialized Collider identity, owner or property value differs.";
                    return false;
                }
            }
            return true;
        }

        private static bool TryHeader(string header, HashSet<ulong> globalIds, out Document doc)
        {
            doc = null;
            var match = Header.Match(header);
            if (!match.Success ||
                !int.TryParse(match.Groups[1].Value, NumberStyles.None,
                    CultureInfo.InvariantCulture, out var classId) ||
                classId < 1 ||
                !TryLocalFileId(match.Groups[2].Value, out var fileId) ||
                !globalIds.Add(fileId))
                return false;
            doc = new Document { ClassId = classId, FileId = fileId };
            return true;
        }

        // Unity text Scene document IDs are signed 64-bit decimal numbers,
        // while GlobalObjectId.targetObjectId is exposed as ulong.
        // Preserve their exact two's-complement identity for comparison.
        // Do NOT accept unsigned overflow, -0, a plus sign or whitespace.
        private static bool TryLocalFileId(string text, out ulong value)
        {
            value = 0;
            if (string.IsNullOrEmpty(text) || text == "-0" ||
                !long.TryParse(text, NumberStyles.AllowLeadingSign,
                    CultureInfo.InvariantCulture, out var signed) ||
                signed == 0)
                return false;
            value = unchecked((ulong)signed);
            return true;
        }

        private static bool Collect(Document doc,
            Dictionary<ulong, Document> owners, Dictionary<ulong, Document> colliders)
        {
            if (doc.ClassId == 1)
            {
                if (doc.Root != "GameObject:" || !NoPrefabReferences(doc) ||
                    owners.ContainsKey(doc.FileId))
                    return false;
                owners.Add(doc.FileId, doc);
            }
            else if (doc.ClassId == 65 || doc.ClassId == 135)
            {
                if (doc.Root != (doc.ClassId == 65 ? "BoxCollider:" : "SphereCollider:") ||
                    !NoPrefabReferences(doc) || colliders.Count >= MaximumColliders ||
                    colliders.ContainsKey(doc.FileId))
                    return false;
                colliders.Add(doc.FileId, doc);
            }
            return true;
        }

        private static bool NoPrefabReferences(Document doc)
        {
            return IsZeroReference(doc, "m_CorrespondingSourceObject") &&
                IsZeroReference(doc, "m_PrefabInstance") &&
                IsZeroReference(doc, "m_PrefabAsset");
        }

        private static bool IsZeroReference(Document doc, string property)
        {
            return doc.Fields.TryGetValue(property, out var value) &&
                value == "{fileID: 0}";
        }

        private static bool SameCollider(Document doc, Collider value)
        {
            if (doc.FileId != value.ComponentFileId ||
                (doc.ClassId == 65) != value.IsBox ||
                !TryRef(doc, "m_GameObject", out var ownerId) ||
                ownerId != value.OwnerFileId ||
                !doc.Fields.TryGetValue("m_IsTrigger", out var trigger) ||
                (trigger != "0" && trigger != "1") ||
                (trigger == "1") != value.IsTrigger ||
                !TryVector(doc, "m_Center", out var cx, out var cy, out var cz) ||
                cx != value.CenterX || cy != value.CenterY || cz != value.CenterZ)
                return false;
            if (value.IsBox)
            {
                return TryVector(doc, "m_Size", out var sx, out var sy, out var sz) &&
                    sx == value.SizeX && sy == value.SizeY && sz == value.SizeZ;
            }
            return doc.Fields.TryGetValue("m_Radius", out var radiusText) &&
                TryNumber(radiusText, out var radius) && radius == value.Radius;
        }

        private static bool TryRef(Document doc, string name, out ulong value)
        {
            value = 0;
            if (!doc.Fields.TryGetValue(name, out var text))
                return false;
            var match = ObjectReference.Match(text);
            return match.Success && TryLocalFileId(match.Groups[1].Value, out value);
        }

        private static bool TryVector(Document doc, string name,
            out float x, out float y, out float z)
        {
            x = y = z = 0f;
            if (!doc.Fields.TryGetValue(name, out var text))
                return false;
            var match = Vector.Match(text);
            return match.Success &&
                TryNumber(match.Groups[1].Value, out x) &&
                TryNumber(match.Groups[2].Value, out y) &&
                TryNumber(match.Groups[3].Value, out z);
        }

        private static bool TryNumber(string text, out float value)
        {
            return float.TryParse(text, NumberStyles.Float,
                CultureInfo.InvariantCulture, out value) &&
                !float.IsNaN(value) && !float.IsInfinity(value) &&
                value >= -100f && value <= 100f;
        }
    }
}

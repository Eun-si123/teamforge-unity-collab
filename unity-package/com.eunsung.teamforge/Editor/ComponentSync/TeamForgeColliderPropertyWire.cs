using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using UnityEngine;

namespace EunSung.TeamForge
{
    // JsonUtility cannot represent heterogeneous native JSON values in one
    // array. This bounded scanner isolates each row, checks required fields
    // and native value types, then constructs immutable allowlisted values.
    internal static class TeamForgeColliderPropertyWire
    {
        private const int MaximumBytes = 512 * 1024;
        private const int MaximumProperties = 1536;
        [Serializable] private sealed class StringValue { public string value; }

        internal static string Serialize(TeamForgeColliderProperty row, bool includeSceneId)
        {
            if (row == null || !row.IsValid) throw new ArgumentException("Invalid Collider property.");
            var result = "{";
            if (includeSceneId) result += "\"sceneId\":" + Quote(row.SceneId) + ",";
            result += "\"objectId\":" + Quote(row.ObjectId) + ",\"componentId\":" + Quote(row.ComponentId) +
                ",\"typeName\":" + Quote(row.TypeName) + ",\"propertyPath\":" + Quote(row.Path) +
                ",\"valueKind\":" + Quote(row.Kind) + ",\"value\":";
            if (row.Kind == "boolean") result += row.Boolean ? "true" : "false";
            else if (row.Kind == "float") result += Number(row.Number);
            else result += "{\"x\":" + Number(row.Vector.x) + ",\"y\":" + Number(row.Vector.y) +
                    ",\"z\":" + Number(row.Vector.z) + "}";
            return result + "}";
        }

        internal static bool TryParseRows(string json, out List<TeamForgeColliderProperty> rows, out string error)
        {
            rows = null;
            error = "Invalid or oversized Collider snapshot.";
            if (!TryObject(json, out var root) || !String(root, "sceneId", out var scene) ||
                !root.TryGetValue("serverRevision", out var revisionText) || !Revision(revisionText, out var revision) ||
                !root.TryGetValue("properties", out var array)) return false;
            var scan = new Scanner(array);
            if (!scan.ReadArray(out var values) || values.Count > MaximumProperties) return false;
            var result = new List<TeamForgeColliderProperty>(values.Count);
            var keys = new HashSet<string>(StringComparer.Ordinal);
            foreach (var value in values)
            {
                if (!TryObject(value, out var rowFields) || !rowFields.ContainsKey("serverRevision") ||
                    !TryParseRow(value, scene, out var row, out error) || row.Revision > revision || !keys.Add(row.Key))
                {
                    error = "Snapshot contains an invalid, duplicated or future Collider property.";
                    return false;
                }
                result.Add(row);
            }
            rows = result;
            error = string.Empty;
            return true;
        }

        internal static bool TryParseRow(string json, string inheritedSceneId,
            out TeamForgeColliderProperty row, out string error)
        {
            row = null;
            error = "Collider identity, required value or native JSON value type is invalid.";
            if (!TryObject(json, out var fields) ||
                !String(fields, "objectId", out var owner) || !String(fields, "componentId", out var component) ||
                !String(fields, "typeName", out var type) || !String(fields, "propertyPath", out var path) ||
                !String(fields, "valueKind", out var kind) || !fields.TryGetValue("value", out var value)) return false;
            var scene = inheritedSceneId;
            if (fields.ContainsKey("sceneId") && (!String(fields, "sceneId", out scene) ||
                (inheritedSceneId != null && inheritedSceneId != scene))) return false;
            long revision = 0;
            if (fields.TryGetValue("serverRevision", out var revisionText) && !Revision(revisionText, out revision)) return false;
            var boolean = false;
            var number = 0f;
            var vector = Vector3.zero;
            if (kind == "boolean")
            {
                if (value != "true" && value != "false") return false;
                boolean = value == "true";
            }
            else if (kind == "float")
            {
                if (!Float(value, out number)) return false;
            }
            else if (kind == "vector3")
            {
                if (!TryObject(value, out var axes) || axes.Count != 3 ||
                    !axes.TryGetValue("x", out var x) || !Float(x, out vector.x) ||
                    !axes.TryGetValue("y", out var y) || !Float(y, out vector.y) ||
                    !axes.TryGetValue("z", out var z) || !Float(z, out vector.z)) return false;
            }
            else return false;
            var result = new TeamForgeColliderProperty(scene, owner, component, type, path, kind, boolean, number, vector, revision);
            if (!result.IsValid) return false;
            row = result;
            error = string.Empty;
            return true;
        }

        private static bool TryObject(string json, out Dictionary<string, string> fields)
        {
            fields = null;
            return json != null && json.Length <= MaximumBytes && Encoding.UTF8.GetByteCount(json) <= MaximumBytes &&
                new Scanner(json).ReadObject(out fields);
        }
        private static bool String(Dictionary<string, string> fields, string name, out string value)
        {
            value = null;
            if (!fields.TryGetValue(name, out var raw) || raw.Length < 2 || raw[0] != '"') return false;
            try { value = JsonUtility.FromJson<StringValue>("{\"value\":" + raw + "}").value; return value != null; }
            catch (Exception) { return false; }
        }
        private static string Quote(string value)
        {
            var json = JsonUtility.ToJson(new StringValue { value = value });
            return json.Substring(9, json.Length - 10);
        }
        private static string Number(float value) => value.ToString("R", CultureInfo.InvariantCulture);
        private static bool Float(string raw, out float value) =>
            float.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out value) &&
            !float.IsNaN(value) && !float.IsInfinity(value);
        private static bool Revision(string raw, out long revision) =>
            long.TryParse(raw, NumberStyles.None, CultureInfo.InvariantCulture, out revision) && revision >= 0 && revision <= 9007199254740991L;

        private sealed class Scanner
        {
            private readonly string source;
            private int index;
            internal Scanner(string source) { this.source = source; }
            internal bool ReadObject(out Dictionary<string, string> fields)
            {
                fields = new Dictionary<string, string>(StringComparer.Ordinal);
                Space();
                if (!Take('{')) return false;
                Space();
                if (Take('}')) return End();
                do
                {
                    Space(); var keyStart = index;
                    if (!ReadString()) return false;
                    var rawKey = source.Substring(keyStart, index - keyStart);
                    string key;
                    try { key = JsonUtility.FromJson<StringValue>("{\"value\":" + rawKey + "}").value; }
                    catch (Exception) { return false; }
                    Space(); if (!Take(':')) return false;
                    Space(); var valueStart = index;
                    if (!Value(0) || key == null || fields.ContainsKey(key)) return false;
                    fields.Add(key, source.Substring(valueStart, index - valueStart));
                    Space();
                    if (Take('}')) return End();
                } while (Take(','));
                return false;
            }
            internal bool ReadArray(out List<string> values)
            {
                values = new List<string>(); Space();
                if (!Take('[')) return false;
                Space(); if (Take(']')) return End();
                do
                {
                    Space(); var start = index;
                    if (values.Count >= MaximumProperties || !Value(0)) return false;
                    values.Add(source.Substring(start, index - start));
                    Space(); if (Take(']')) return End();
                } while (Take(','));
                return false;
            }
            private bool Value(int depth)
            {
                if (depth > 16 || index >= source.Length) return false;
                if (source[index] == '"') return ReadString();
                if (source[index] == '{' || source[index] == '[')
                {
                    var obj = source[index++] == '{'; var close = obj ? '}' : ']';
                    Space(); if (Take(close)) return true;
                    do
                    {
                        Space();
                        if (obj) { if (!ReadString()) return false; Space(); if (!Take(':')) return false; Space(); }
                        if (!Value(depth + 1)) return false;
                        Space(); if (Take(close)) return true;
                    } while (Take(','));
                    return false;
                }
                if (source[index] == 't') return Literal("true");
                if (source[index] == 'f') return Literal("false");
                if (source[index] == 'n') return Literal("null");
                Take('-');
                if (!Take('0'))
                {
                    if (index >= source.Length || source[index] < '1' || source[index] > '9') return false;
                    while (Digit()) index++;
                }
                if (Take('.')) { if (!Digit()) return false; while (Digit()) index++; }
                if (Take('e') || Take('E'))
                {
                    if (!Take('+')) Take('-');
                    if (!Digit()) return false; while (Digit()) index++;
                }
                return true;
            }
            private bool ReadString()
            {
                if (!Take('"')) return false;
                while (index < source.Length)
                {
                    var c = source[index++];
                    if (c == '"') return true;
                    if (c < ' ') return false;
                    if (c != '\\') continue;
                    if (index >= source.Length) return false;
                    c = source[index++];
                    if (c == 'u')
                    {
                        for (var n = 0; n < 4; n++)
                        {
                            if (index >= source.Length || !Uri.IsHexDigit(source[index++])) return false;
                        }
                    }
                    else if (c != '"' && c != '\\' && c != '/' && c != 'b' && c != 'f' && c != 'n' && c != 'r' && c != 't')
                        return false;
                }
                return false;
            }
            private bool Literal(string literal)
            {
                if (index + literal.Length > source.Length ||
                    string.CompareOrdinal(source, index, literal, 0, literal.Length) != 0) return false;
                index += literal.Length; return true;
            }
            private bool Digit() => index < source.Length && source[index] >= '0' && source[index] <= '9';
            private bool Take(char c) { if (index >= source.Length || source[index] != c) return false; index++; return true; }
            private void Space() { while (index < source.Length && (source[index] == ' ' || source[index] == '\t' || source[index] == '\r' || source[index] == '\n')) index++; }
            private bool End() { Space(); return index == source.Length; }
        }
    }
}

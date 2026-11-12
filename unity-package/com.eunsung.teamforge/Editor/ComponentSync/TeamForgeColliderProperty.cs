using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace EunSung.TeamForge
{
    // Immutable, exact saved-Component target and one bounded value. Socket
    // authorization belongs to ComponentSync; this class only performs CAS
    // on one allowlisted SerializedProperty and never manipulates global Undo.
    internal sealed class TeamForgeColliderProperty
    {
        internal TeamForgeColliderProperty(string sceneId, string objectId, string componentId,
            string typeName, string path, string kind, bool boolean, float number, Vector3 vector, long revision = 0)
        {
            SceneId = sceneId; ObjectId = objectId; ComponentId = componentId;
            TypeName = typeName; Path = path; Kind = kind;
            Boolean = boolean; Number = number; Vector = vector; Revision = revision;
        }

        internal long Revision { get; }
        internal string SceneId { get; }
        internal string ObjectId { get; }
        internal string ComponentId { get; }
        internal string TypeName { get; }
        internal string Path { get; }
        internal string Kind { get; }
        internal bool Boolean { get; }
        internal float Number { get; }
        internal Vector3 Vector { get; }
        internal string Key => SceneId + "|" + ObjectId + "|" + ComponentId + "|" + TypeName + "|" + Path + "|" + Kind;

        internal bool IsValid
        {
            get
            {
                if (Revision < 0 || !TeamForgeWp6ComponentIdentity.IsSceneGuid(SceneId) ||
                    !ValidId(ObjectId, SceneId) || !ValidId(ComponentId, SceneId) ||
                    ObjectId == ComponentId ||
                    (TypeName != "UnityEngine.BoxCollider" && TypeName != "UnityEngine.SphereCollider"))
                    return false;
                if (Path == "m_IsTrigger") return Kind == "boolean";
                if (Path == "m_Radius")
                    return TypeName == "UnityEngine.SphereCollider" && Kind == "float" && InRange(Number, true);
                if (Path != "m_Center" && !(Path == "m_Size" && TypeName == "UnityEngine.BoxCollider"))
                    return false;
                return Kind == "vector3" && InRange(Vector.x, Path == "m_Size") &&
                       InRange(Vector.y, Path == "m_Size") && InRange(Vector.z, Path == "m_Size");
            }
        }

        internal bool SameTarget(TeamForgeColliderProperty other) => other != null && Key == other.Key;
        internal bool SameValue(TeamForgeColliderProperty other)
        {
            if (other == null || Kind != other.Kind) return false;
            if (Kind == "boolean") return Boolean == other.Boolean;
            if (Kind == "float") return Number.Equals(other.Number);
            return Vector.x.Equals(other.Vector.x) && Vector.y.Equals(other.Vector.y) && Vector.z.Equals(other.Vector.z);
        }
        internal TeamForgeColliderProperty WithValue(bool value) =>
            new TeamForgeColliderProperty(SceneId, ObjectId, ComponentId, TypeName, Path, Kind, value, Number, Vector, Revision);
        internal TeamForgeColliderProperty WithValue(float value) =>
            new TeamForgeColliderProperty(SceneId, ObjectId, ComponentId, TypeName, Path, Kind, Boolean, value, Vector, Revision);
        internal TeamForgeColliderProperty WithValue(Vector3 value) =>
            new TeamForgeColliderProperty(SceneId, ObjectId, ComponentId, TypeName, Path, Kind, Boolean, Number, value, Revision);

        internal TeamForgeColliderProperty WithRevision(long revision) =>
            new TeamForgeColliderProperty(SceneId, ObjectId, ComponentId, TypeName, Path, Kind, Boolean, Number, Vector, revision);

        internal static TeamForgeColliderProperty FromObservation(
            TeamForgeWp6InspectorProbe.Observation target, TeamForgeWp6InspectorProbe.PropertyObservation value) =>
            new TeamForgeColliderProperty(target.SceneId, target.ObjectId, target.ComponentId, target.TypeName,
                value.Path, value.Kind, value.Boolean, value.Number, value.Vector);

        internal static bool TryRead(TeamForgeColliderProperty target, out TeamForgeColliderProperty current,
            out string error)
        {
            current = null;
            if (!Resolve(target, out var component, out error)) return false;
            if (!TeamForgeWp6InspectorProbe.TryCapture(component, out var observation, out error)) return false;
            foreach (var property in observation.Properties)
                if (property.Path == target.Path && property.Kind == target.Kind)
                {
                    current = FromObservation(observation, property);
                    error = string.Empty;
                    return true;
                }
            error = "The exact Collider property is unavailable.";
            return false;
        }

        internal static bool TryApply(TeamForgeColliderProperty expectedCurrent, TeamForgeColliderProperty desired,
            out string error)
        {
            if (expectedCurrent == null || desired == null || !desired.IsValid ||
                !expectedCurrent.SameTarget(desired))
            {
                error = "A bounded value for the same exact Collider property is required.";
                return false;
            }
            if (!TryRead(expectedCurrent, out var actual, out error)) return false;
            if (!actual.SameValue(expectedCurrent))
            {
                error = "The Collider property changed locally; the local value was preserved for review.";
                return false;
            }
            if (actual.SameValue(desired)) { error = string.Empty; return true; }
            if (!Resolve(expectedCurrent, out var component, out error)) return false;
            var writeAttempted = false;
            try
            {
                var serialized = new SerializedObject(component);
                serialized.UpdateIfRequiredOrScript();
                var property = serialized.FindProperty(desired.Path);
                if (property == null || !MatchesPropertyType(property, desired.Kind))
                {
                    error = "The exact SerializedProperty type no longer matches.";
                    return false;
                }
                Write(property, desired);
                writeAttempted = true;
                serialized.ApplyModifiedPropertiesWithoutUndo();
                EditorSceneManager.MarkSceneDirty(component.gameObject.scene);
                if (TryRead(desired, out var after, out error) && after.SameValue(desired))
                {
                    error = string.Empty;
                    return true;
                }
                // This synchronous main-thread call owns only this field. If Unity
                // normalized/clamped it, restore its captured before-image too.
                // Checking only equality with the desired value would leave that
                // failed after-image behind when reporting a rejected batch.
                RollbackOwnField(component, expectedCurrent);
                error = "Unity did not retain the exact requested Collider value.";
                return false;
            }
            catch (Exception)
            {
                if (writeAttempted) RollbackOwnField(component, expectedCurrent);
                error = "The exact Collider property could not be applied safely.";
                return false;
            }
        }

        private static void RollbackOwnField(Component component, TeamForgeColliderProperty before)
        {
            try
            {
                if (!Resolve(before, out var resolved, out _) || resolved != component) return;
                var serialized = new SerializedObject(component);
                serialized.UpdateIfRequiredOrScript();
                var property = serialized.FindProperty(before.Path);
                if (property == null || !MatchesPropertyType(property, before.Kind)) return;
                Write(property, before);
                serialized.ApplyModifiedPropertiesWithoutUndo();
            }
            catch (Exception)
            {
                // The caller reports apply failure and blocks collaboration; it
                // must never claim a removed/unresolvable field was restored.
            }
        }

        internal string ToWireJson(bool includeSceneId = true) => TeamForgeColliderPropertyWire.Serialize(this, includeSceneId);
        internal static bool TryParseRow(string json, out TeamForgeColliderProperty row, out string error) =>
            TeamForgeColliderPropertyWire.TryParseRow(json, null, out row, out error);
        internal static bool TryParseRows(string json, out List<TeamForgeColliderProperty> rows, out string error) =>
            TeamForgeColliderPropertyWire.TryParseRows(json, out rows, out error);

        private static bool Resolve(TeamForgeColliderProperty target, out Component component, out string error)
        {
            component = null;
            if (target == null || !target.IsValid)
            {
                error = "Collider identity, property type or value is invalid.";
                return false;
            }
            return TeamForgeWp6ComponentIdentity.TryResolve(new TeamForgeWp6ComponentIdentity.Record(
                target.SceneId, target.ObjectId, target.ComponentId, target.TypeName), out component, out error);
        }
        private static bool ValidId(string text, string sceneId) => text != null && text.Length <= 512 &&
            GlobalObjectId.TryParse(text, out var id) && id.ToString() == text && id.identifierType == 2 &&
            id.assetGUID.ToString() == sceneId && id.targetObjectId != 0 && id.targetPrefabId == 0;
        private static bool InRange(float value, bool nonNegative) => !float.IsNaN(value) && !float.IsInfinity(value) &&
            value <= 100f && value >= (nonNegative ? 0f : -100f);
        private static bool MatchesPropertyType(SerializedProperty property, string kind) =>
            (kind == "boolean" && property.propertyType == SerializedPropertyType.Boolean) ||
            (kind == "float" && property.propertyType == SerializedPropertyType.Float) ||
            (kind == "vector3" && property.propertyType == SerializedPropertyType.Vector3);
        private static void Write(SerializedProperty property, TeamForgeColliderProperty value)
        {
            if (value.Kind == "boolean") property.boolValue = value.Boolean;
            else if (value.Kind == "float") property.floatValue = value.Number;
            else property.vector3Value = value.Vector;
        }
    }
}

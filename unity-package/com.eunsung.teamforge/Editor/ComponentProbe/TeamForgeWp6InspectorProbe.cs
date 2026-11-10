using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

namespace EunSung.TeamForge
{
    // WP6 pre-wire only. This helper never writes SerializedObject data,
    // creates Undo groups or sends an operation to the realtime authority.
    // It is not a live Inspector sync or a supported transfer payload.
    internal static class TeamForgeWp6InspectorProbe
    {
        private const float MaximumValue = 100f;

        internal sealed class PropertyObservation
        {
            internal PropertyObservation(string path, string kind, bool boolean, float number, Vector3 vector)
            {
                Path = path;
                Kind = kind;
                Boolean = boolean;
                Number = number;
                Vector = vector;
            }

            internal string Path { get; }
            internal string Kind { get; }
            internal bool Boolean { get; }
            internal float Number { get; }
            internal Vector3 Vector { get; }
        }

        internal sealed class Observation
        {
            internal Observation(string sceneId, string objectId, string componentId,
                string typeName, bool sceneDirty, List<PropertyObservation> properties)
            {
                SceneId = sceneId;
                ObjectId = objectId;
                ComponentId = componentId;
                TypeName = typeName;
                SceneDirty = sceneDirty;
                Properties = properties.AsReadOnly();
            }

            internal string SceneId { get; }
            internal string ObjectId { get; }
            internal string ComponentId { get; }
            internal string TypeName { get; }
            internal bool SceneDirty { get; }
            internal IReadOnlyList<PropertyObservation> Properties { get; }
        }

        internal static bool TryCapture(Component component, out Observation observation, out string error)
        {
            observation = null;
            error = string.Empty;
            if (component == null || component.gameObject == null)
            {
                error = "A live saved Scene Component is required.";
                return false;
            }

            // Never claim arbitrary custom scripts or copied Prefab assets have
            // the same serializable contract as these exact built-in types.
            var isBox = component.GetType() == typeof(BoxCollider);
            var isSphere = component.GetType() == typeof(SphereCollider);
            if (!isBox && !isSphere)
            {
                error = "Only BoxCollider and SphereCollider are supported by this read-only probe.";
                return false;
            }

            // The same exact-identity check will guard future WP6 property
            // reconciliation, rather than falling back to type/Inspector index.
            if (!TeamForgeWp6ComponentIdentity.TryCapture(component, out var identity, out error))
                return false;
            if (!TeamForgeWp6ComponentIdentity.TryResolve(identity, out var resolved, out error) ||
                resolved != component)
            {
                error = "The exact saved Scene Component could not be resolved safely.";
                return false;
            }

            var scene = component.gameObject.scene;

            // A dirty Scene is still an observable local Editor state; it is
            // *not* an approved saved project baseline or server revision.
            try
            {
                var serialized = new SerializedObject(component);
                serialized.UpdateIfRequiredOrScript();
                var properties = new List<PropertyObservation>(isBox ? 3 : 3);
                if (!CaptureBoolean(serialized, "m_IsTrigger", properties) ||
                    !CaptureVector(serialized, "m_Center", properties))
                {
                    error = "Expected exact allowlisted Collider SerializedProperties.";
                    return false;
                }
                if (isBox)
                {
                    if (!CaptureVector(serialized, "m_Size", properties, true))
                    {
                        error = "BoxCollider size is missing, mismatched or out of bounds.";
                        return false;
                    }
                }
                else if (!CaptureFloat(serialized, "m_Radius", properties))
                {
                    error = "SphereCollider radius is missing, mismatched or out of bounds.";
                    return false;
                }

                observation = new Observation(identity.SceneId, identity.ObjectId,
                    identity.ComponentId, identity.TypeName, scene.isDirty, properties);
                return true;
            }
            catch (Exception)
            {
                // Do not report Unity object data or private paths from an
                // exception. Failure never returns a partial observation.
                observation = null;
                error = "Unity SerializedProperty observation could not complete.";
                return false;
            }
        }

        private static bool CaptureBoolean(SerializedObject serialized, string path,
            List<PropertyObservation> result)
        {
            var property = serialized.FindProperty(path);
            if (property == null || property.propertyType != SerializedPropertyType.Boolean)
                return false;
            result.Add(new PropertyObservation(path, "boolean", property.boolValue, 0f, Vector3.zero));
            return true;
        }

        private static bool CaptureVector(SerializedObject serialized, string path,
            List<PropertyObservation> result, bool nonNegative = false)
        {
            var property = serialized.FindProperty(path);
            if (property == null || property.propertyType != SerializedPropertyType.Vector3)
                return false;
            var value = property.vector3Value;
            if (!InRange(value.x, nonNegative) || !InRange(value.y, nonNegative) ||
                !InRange(value.z, nonNegative))
                return false;
            result.Add(new PropertyObservation(path, "vector3", false, 0f, value));
            return true;
        }

        private static bool CaptureFloat(SerializedObject serialized, string path,
            List<PropertyObservation> result)
        {
            var property = serialized.FindProperty(path);
            if (property == null || property.propertyType != SerializedPropertyType.Float ||
                !InRange(property.floatValue, true))
                return false;
            result.Add(new PropertyObservation(path, "float", false, property.floatValue, Vector3.zero));
            return true;
        }

        private static bool InRange(float value, bool nonNegative)
        {
            return !float.IsNaN(value) && !float.IsInfinity(value) &&
                value <= MaximumValue && value >= (nonNegative ? 0f : -MaximumValue);
        }
    }
}

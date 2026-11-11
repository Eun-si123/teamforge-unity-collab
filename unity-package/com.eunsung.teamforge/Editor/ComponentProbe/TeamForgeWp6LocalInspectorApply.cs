using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace EunSung.TeamForge
{
    // WP6 local-only, intentionally NOT registered as a production command.
    // A caller can construct the "applied" record below; it is therefore
    // NOT authenticated Server authority. The contract exists to test the
    // exact-ID, stale-state, type, Undo and rejection behavior before adding
    // any trusted wire transport.
    internal static class TeamForgeWp6LocalInspectorApply
    {
        internal sealed class AppliedRecord
        {
            internal AppliedRecord(string operationId, long baseRevision, long serverRevision,
                string sceneId, string objectId, string componentId, string typeName,
                TeamForgeWp6InspectorProbe.PropertyObservation property)
            {
                OperationId = operationId;
                BaseRevision = baseRevision;
                ServerRevision = serverRevision;
                SceneId = sceneId;
                ObjectId = objectId;
                ComponentId = componentId;
                TypeName = typeName;
                Property = property;
            }

            internal string OperationId { get; }
            internal long BaseRevision { get; }
            internal long ServerRevision { get; }
            internal string SceneId { get; }
            internal string ObjectId { get; }
            internal string ComponentId { get; }
            internal string TypeName { get; }
            internal TeamForgeWp6InspectorProbe.PropertyObservation Property { get; }
        }

        internal sealed class Preview
        {
            internal readonly TeamForgeSceneBaseline source;
            internal readonly string metaSha256;
            internal readonly TeamForgeWp6SceneInventory.Snapshot initial;
            internal long revision;
            internal AppliedRecord consumedOperation;
            internal TeamForgeWp6SceneInventory.Snapshot accepted;
            internal int undoGroup = -1;

            internal Preview(TeamForgeSceneBaseline source, string metaSha256,
                TeamForgeWp6SceneInventory.Snapshot initial, long revision)
            {
                this.source = source;
                this.metaSha256 = metaSha256;
                this.initial = initial;
                this.revision = revision;
            }

            internal long Revision => revision;
            internal bool Consumed => consumedOperation != null;
            internal int UndoGroup => undoGroup;
        }

        internal sealed class Outcome
        {
            internal Outcome(bool replayed, long revision, int undoGroup)
            {
                Replayed = replayed;
                ServerRevision = revision;
                UndoGroup = undoGroup;
            }
            internal bool Replayed { get; }
            internal long ServerRevision { get; }
            internal int UndoGroup { get; }
        }

        // The supplied source expectation and revision are deliberately NOT
        // verified against a realtime Server here. Never use this factory in
        // a socket handler or treat a Preview as a privilege token.
        internal static bool TryBeginForLocalTest(TeamForgeSceneBaseline expected,
            string expectedMetaSha256, long expectedRevision, out Preview preview, out string error)
        {
            preview = null;
            if (expectedRevision < 0 || expectedRevision >= long.MaxValue ||
                !TeamForgeWp6SerializedSceneWitness.TryCapture(
                    expected, expectedMetaSha256, out var witness, out error))
            {
                error = "A clean verified local Collider source and bounded revision are required.";
                return false;
            }

            // Copy expected fields: the caller may mutate its DTO after this
            // point but must not silently alter our fixed source expectation.
            var source = new TeamForgeSceneBaseline {
                scenePath = expected.scenePath,
                sceneGuid = expected.sceneGuid,
                sha256 = expected.sha256,
            };
            preview = new Preview(source, expectedMetaSha256, witness.Source.Inventory, expectedRevision);
            error = string.Empty;
            return true;
        }

        internal static bool TryApplyForLocalTest(Preview preview, AppliedRecord applied,
            out Outcome outcome, out string error)
        {
            outcome = null;
            if (preview == null || applied == null || !ValidOperationId(applied.OperationId) ||
                applied.Property == null)
            {
                error = "A locally witnessed preview and bounded operation are required.";
                return false;
            }

            if (preview.Consumed)
            {
                // An Undo or later edit invalidates even an identical replay.
                // Never acknowledge an operation based solely on a remembered
                // ID if Unity no longer holds the recorded resulting state.
                var scene = SceneManager.GetActiveScene();
                if (SameOperation(preview.consumedOperation, applied) &&
                    scene.IsValid() && scene.isLoaded &&
                    string.Equals(scene.path, preview.source.scenePath,
                        StringComparison.Ordinal) &&
                    TeamForgeWp6SceneInventory.TryCapture(
                        scene, out var currentInventory, out _) &&
                    SameSnapshot(preview.accepted, currentInventory))
                {
                    outcome = new Outcome(true, preview.Revision, preview.UndoGroup);
                    error = string.Empty;
                    return true;
                }
                error = "The accepted local preview was undone, changed or superseded; resnapshot required.";
                return false;
            }

            if (applied.BaseRevision != preview.Revision ||
                applied.ServerRevision != preview.Revision + 1 ||
                !string.Equals(applied.SceneId, preview.initial.SceneId, StringComparison.Ordinal) ||
                !ValidProperty(applied.TypeName, applied.Property))
            {
                error = "The typed property operation has a stale or invalid local revision.";
                return false;
            }

            if (!TeamForgeWp6SerializedSceneWitness.TryCapture(
                preview.source, preview.metaSha256, out var current, out error) ||
                !SameSnapshot(preview.initial, current.Source.Inventory))
            {
                error = "The local Collider inventory changed since the witnessed baseline.";
                return false;
            }

            var initial = Find(preview.initial, applied.ComponentId);
            if (initial == null ||
                !string.Equals(initial.ObjectId, applied.ObjectId, StringComparison.Ordinal) ||
                !string.Equals(initial.TypeName, applied.TypeName, StringComparison.Ordinal) ||
                !string.Equals(initial.SceneId, applied.SceneId, StringComparison.Ordinal))
            {
                error = "The exact Component or owner differs from the witnessed baseline.";
                return false;
            }

            var old = Find(initial, applied.Property.Path);
            if (old == null || old.Kind != applied.Property.Kind ||
                SameValue(old, applied.Property))
            {
                error = "The new property value is unsupported or already matches the baseline.";
                return false;
            }

            var identity = new TeamForgeWp6ComponentIdentity.Record(
                initial.SceneId, initial.ObjectId, initial.ComponentId, initial.TypeName);
            if (!TeamForgeWp6ComponentIdentity.TryResolve(identity, out var component, out error) ||
                component == null || component.gameObject.scene != SceneManager.GetActiveScene())
            {
                error = "The exact saved Collider target is no longer available.";
                return false;
            }
            if (!TeamForgeWp6InspectorProbe.TryCapture(component, out var latest, out error) ||
                !SameObservation(initial, latest))
            {
                error = "A local Inspector change occurred before applying the operation.";
                return false;
            }

            // All untrusted operation checks are complete before the first
            // mutation. Use Unity's serialized-object Undo entry, not a raw
            // Component setter or a save/reimport operation.
            var undoGroup = -1;
            var didWrite = false;
            try
            {
                var serialized = new SerializedObject(component);
                serialized.UpdateIfRequiredOrScript();
                var property = serialized.FindProperty(applied.Property.Path);
                if (property == null || !TypeMatches(property, applied.Property.Kind))
                {
                    error = "The exact SerializedProperty is no longer present or typed correctly.";
                    return false;
                }
                Undo.IncrementCurrentGroup();
                undoGroup = Undo.GetCurrentGroup();
                Undo.SetCurrentGroupName("TeamForge WP6 local Collider preview");
                Write(property, applied.Property);
                didWrite = serialized.ApplyModifiedProperties();
                Undo.FlushUndoRecordObjects();
                if (!didWrite || !TeamForgeWp6InspectorProbe.TryCapture(
                        component, out var after, out _) ||
                    !ChangedExactly(initial, after, applied.Property))
                {
                    Undo.RevertAllDownToGroup(undoGroup);
                    error = "The local Inspector write did not produce the exact allowed property delta.";
                    return false;
                }

                // Keep a complete after-image for idempotency checks. A
                // later Undo/foreign edit must not be falsely acknowledged.
                if (!TeamForgeWp6SceneInventory.TryCapture(
                        component.gameObject.scene, out var accepted, out _))
                {
                    Undo.RevertAllDownToGroup(undoGroup);
                    error = "The local resulting Scene inventory was not observable.";
                    return false;
                }
                preview.accepted = accepted;
                preview.consumedOperation = applied;
                preview.revision = applied.ServerRevision;
                preview.undoGroup = undoGroup;
                outcome = new Outcome(false, applied.ServerRevision, undoGroup);
                error = string.Empty;
                return true;
            }
            catch (Exception)
            {
                // If an exception occurs once Unity might have mutated the
                // serialized object, revert only our newly opened group.
                if (undoGroup >= 0)
                {
                    try { Undo.RevertAllDownToGroup(undoGroup); }
                    catch (Exception) { /* report a conservative failure */ }
                }
                error = "The local Collider edit failed and must be recaptured before retry.";
                return false;
            }
        }

        private static bool ValidOperationId(string text)
        {
            if (string.IsNullOrEmpty(text) || text.Length > 128)
                return false;
            foreach (var c in text)
                if (!(c >= 'a' && c <= 'z') && !(c >= 'A' && c <= 'Z') &&
                    !(c >= '0' && c <= '9') && c != '-' && c != '_')
                    return false;
            return true;
        }

        private static bool Finite(float value, bool nonnegative = false)
        {
            return !float.IsNaN(value) && !float.IsInfinity(value) &&
                value >= (nonnegative ? 0 : -100f) && value <= 100f;
        }

        private static bool ValidProperty(string typeName,
            TeamForgeWp6InspectorProbe.PropertyObservation property)
        {
            if (property == null)
                return false;
            var box = string.Equals(typeName, "UnityEngine.BoxCollider", StringComparison.Ordinal);
            if (!box && typeName != "UnityEngine.SphereCollider")
                return false;
            if (property.Path == "m_IsTrigger")
                return property.Kind == "boolean" && property.Number == 0f &&
                    property.Vector.x == 0f && property.Vector.y == 0f && property.Vector.z == 0f;
            if (property.Path == "m_Center" ||
                (box && property.Path == "m_Size"))
            {
                var nonnegative = property.Path == "m_Size";
                return property.Kind == "vector3" && !property.Boolean &&
                    property.Number == 0f &&
                    Finite(property.Vector.x, nonnegative) &&
                    Finite(property.Vector.y, nonnegative) &&
                    Finite(property.Vector.z, nonnegative);
            }
            return !box && property.Path == "m_Radius" &&
                property.Kind == "float" && !property.Boolean &&
                property.Vector.x == 0f && property.Vector.y == 0f &&
                property.Vector.z == 0f && Finite(property.Number, true);
        }

        private static bool TypeMatches(SerializedProperty property, string kind)
        {
            return (kind == "boolean" && property.propertyType == SerializedPropertyType.Boolean) ||
                (kind == "vector3" && property.propertyType == SerializedPropertyType.Vector3) ||
                (kind == "float" && property.propertyType == SerializedPropertyType.Float);
        }

        private static void Write(SerializedProperty destination,
            TeamForgeWp6InspectorProbe.PropertyObservation value)
        {
            if (value.Kind == "boolean") destination.boolValue = value.Boolean;
            else if (value.Kind == "vector3") destination.vector3Value = value.Vector;
            else destination.floatValue = value.Number;
        }

        private static bool SameValue(TeamForgeWp6InspectorProbe.PropertyObservation a,
            TeamForgeWp6InspectorProbe.PropertyObservation b)
        {
            return a.Kind == b.Kind && a.Boolean == b.Boolean &&
                a.Number == b.Number &&
                a.Vector.x == b.Vector.x && a.Vector.y == b.Vector.y &&
                a.Vector.z == b.Vector.z;
        }

        private static bool SameOperation(AppliedRecord a, AppliedRecord b)
        {
            return a.OperationId == b.OperationId && a.BaseRevision == b.BaseRevision &&
                a.ServerRevision == b.ServerRevision && a.SceneId == b.SceneId &&
                a.ObjectId == b.ObjectId && a.ComponentId == b.ComponentId &&
                a.TypeName == b.TypeName && a.Property.Path == b.Property.Path &&
                SameValue(a.Property, b.Property);
        }

        private static TeamForgeWp6InspectorProbe.Observation Find(
            TeamForgeWp6SceneInventory.Snapshot snapshot, string componentId)
        {
            foreach (var value in snapshot.Observations)
                if (value.ComponentId == componentId) return value;
            return null;
        }

        private static TeamForgeWp6InspectorProbe.PropertyObservation Find(
            TeamForgeWp6InspectorProbe.Observation observation, string path)
        {
            foreach (var value in observation.Properties)
                if (value.Path == path) return value;
            return null;
        }

        private static bool SameObservation(TeamForgeWp6InspectorProbe.Observation a,
            TeamForgeWp6InspectorProbe.Observation b)
        {
            if (a.SceneId != b.SceneId || a.ObjectId != b.ObjectId ||
                a.ComponentId != b.ComponentId || a.TypeName != b.TypeName ||
                a.SceneDirty != b.SceneDirty || a.Properties.Count != b.Properties.Count)
                return false;
            for (var i = 0; i < a.Properties.Count; i++)
                if (a.Properties[i].Path != b.Properties[i].Path ||
                    !SameValue(a.Properties[i], b.Properties[i]))
                    return false;
            return true;
        }

        private static bool SameSnapshot(TeamForgeWp6SceneInventory.Snapshot a,
            TeamForgeWp6SceneInventory.Snapshot b)
        {
            if (a.SceneId != b.SceneId || a.SceneDirty != b.SceneDirty ||
                a.Observations.Count != b.Observations.Count)
                return false;
            for (var i = 0; i < a.Observations.Count; i++)
                if (!SameObservation(a.Observations[i], b.Observations[i]))
                    return false;
            return true;
        }

        private static bool ChangedExactly(TeamForgeWp6InspectorProbe.Observation before,
            TeamForgeWp6InspectorProbe.Observation after,
            TeamForgeWp6InspectorProbe.PropertyObservation change)
        {
            if (before.SceneId != after.SceneId || before.ObjectId != after.ObjectId ||
                before.ComponentId != after.ComponentId || before.TypeName != after.TypeName ||
                before.Properties.Count != after.Properties.Count)
                return false;
            var changed = false;
            for (var i = 0; i < before.Properties.Count; i++)
            {
                var prior = before.Properties[i];
                var next = after.Properties[i];
                if (prior.Path != next.Path || prior.Kind != next.Kind)
                    return false;
                if (prior.Path == change.Path)
                {
                    if (!SameValue(change, next)) return false;
                    changed = true;
                }
                else if (!SameValue(prior, next))
                    return false;
            }
            return changed;
        }
    }
}

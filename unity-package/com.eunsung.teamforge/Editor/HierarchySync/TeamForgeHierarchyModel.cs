using System;
using System.Collections.Generic;
using UnityEngine;

namespace EunSung.TeamForge
{
    public sealed class TeamForgeHierarchyState
    {
        public string SceneId = string.Empty;
        public string ObjectId = string.Empty;
        public string Name = string.Empty;
        public string ParentObjectId = string.Empty;
        public int SiblingIndex;
        public TeamForgeTransformState Transform = new TeamForgeTransformState();
        public long CreatedRevision;
        public long HierarchyRevision;

        public TeamForgeHierarchyState Clone()
        {
            return new TeamForgeHierarchyState
            {
                SceneId = SceneId,
                ObjectId = ObjectId,
                Name = Name,
                ParentObjectId = ParentObjectId,
                SiblingIndex = SiblingIndex,
                Transform = Transform?.Clone(),
                CreatedRevision = CreatedRevision,
                HierarchyRevision = HierarchyRevision,
            };
        }

        public TeamForgeHierarchyObjectRecord ToRecord()
        {
            var transform = Transform ?? new TeamForgeTransformState();
            return new TeamForgeHierarchyObjectRecord
            {
                sceneId = SceneId,
                objectId = ObjectId,
                name = Name,
                parentObjectId = ParentObjectId,
                siblingIndex = SiblingIndex,
                localPosition = transform.PositionDto(),
                localRotation = transform.RotationDto(),
                localScale = transform.ScaleDto(),
                createdRevision = CreatedRevision,
                hierarchyRevision = HierarchyRevision,
            };
        }

        public static bool TryFromRecord(TeamForgeHierarchyObjectRecord record, out TeamForgeHierarchyState state, out string error)
        {
            state = null;
            if (record == null ||
                !ValidText(record.sceneId, 128) ||
                !ValidText(record.objectId, 512) ||
                !ValidName(record.name, 128) ||
                !ValidTextOrEmpty(record.parentObjectId, 512) ||
                record.siblingIndex < 0 ||
                record.createdRevision < 0 ||
                record.hierarchyRevision < 0)
            {
                error = "Hierarchy object metadata is invalid.";
                return false;
            }

            var synthetic = new TransformAppliedMessage
            {
                localPosition = record.localPosition,
                localRotation = record.localRotation,
                localScale = record.localScale,
            };
            if (!TeamForgeTransformState.TryFromMessage(synthetic, out var transform, out error))
            {
                return false;
            }

            state = new TeamForgeHierarchyState
            {
                SceneId = record.sceneId.Trim(),
                ObjectId = record.objectId.Trim(),
                Name = record.name,
                ParentObjectId = record.parentObjectId?.Trim() ?? string.Empty,
                SiblingIndex = record.siblingIndex,
                Transform = transform,
                CreatedRevision = record.createdRevision,
                HierarchyRevision = record.hierarchyRevision,
            };
            error = string.Empty;
            return true;
        }

        public bool StructuralEquals(TeamForgeHierarchyState other)
        {
            return other != null &&
                   string.Equals(Name, other.Name, StringComparison.Ordinal) &&
                   string.Equals(ParentObjectId, other.ParentObjectId, StringComparison.Ordinal) &&
                   SiblingIndex == other.SiblingIndex;
        }

        private static bool ValidName(string value, int maximumLength)
        {
            if (value == null || value.Length == 0 || value.Length > maximumLength || value.Trim().Length == 0)
            {
                return false;
            }
            foreach (var character in value)
            {
                if (char.IsControl(character))
                {
                    return false;
                }
            }
            return true;
        }

        private static bool ValidText(string value, int maximumLength)
        {
            var candidate = value?.Trim() ?? string.Empty;
            if (candidate.Length == 0 || candidate.Length > maximumLength)
            {
                return false;
            }
            foreach (var character in candidate)
            {
                if (char.IsControl(character))
                {
                    return false;
                }
            }
            return true;
        }

        private static bool ValidTextOrEmpty(string value, int maximumLength)
        {
            var candidate = value?.Trim() ?? string.Empty;
            if (candidate.Length > maximumLength)
            {
                return false;
            }
            foreach (var character in candidate)
            {
                if (char.IsControl(character))
                {
                    return false;
                }
            }
            return true;
        }
    }

    public sealed class TeamForgeHierarchyRegistry
    {
        private readonly Dictionary<string, TeamForgeHierarchyState> _objects =
            new Dictionary<string, TeamForgeHierarchyState>(StringComparer.Ordinal);
        private readonly HashSet<string> _tombstones = new HashSet<string>(StringComparer.Ordinal);

        public int Count => _objects.Count;
        public int TombstoneCount => _tombstones.Count;

        public bool TryGet(string sceneId, string objectId, out TeamForgeHierarchyState state)
        {
            if (_objects.TryGetValue(Key(sceneId, objectId), out var stored))
            {
                state = stored.Clone();
                return true;
            }
            state = null;
            return false;
        }

        public bool Contains(string sceneId, string objectId)
        {
            return _objects.ContainsKey(Key(sceneId, objectId));
        }

        public bool IsTombstoned(string sceneId, string objectId)
        {
            return _tombstones.Contains(Key(sceneId, objectId));
        }

        public void Upsert(TeamForgeHierarchyState state)
        {
            if (state == null || string.IsNullOrWhiteSpace(state.SceneId) || string.IsNullOrWhiteSpace(state.ObjectId))
            {
                return;
            }
            var key = Key(state.SceneId, state.ObjectId);
            _objects[key] = state.Clone();
            _tombstones.Remove(key);
        }

        public void Remove(string sceneId, string objectId, bool tombstone)
        {
            var key = Key(sceneId, objectId);
            _objects.Remove(key);
            if (tombstone)
            {
                _tombstones.Add(key);
            }
        }

        public void ReplaceAll(IEnumerable<TeamForgeHierarchyState> states, IEnumerable<TeamForgeHierarchyTombstoneRecord> tombstones)
        {
            _objects.Clear();
            _tombstones.Clear();
            if (states != null)
            {
                foreach (var state in states)
                {
                    Upsert(state);
                }
            }
            if (tombstones != null)
            {
                foreach (var tombstone in tombstones)
                {
                    if (tombstone == null || string.IsNullOrWhiteSpace(tombstone.sceneId) || string.IsNullOrWhiteSpace(tombstone.objectId))
                    {
                        continue;
                    }
                    var key = Key(tombstone.sceneId, tombstone.objectId);
                    _objects.Remove(key);
                    _tombstones.Add(key);
                }
            }
        }

        public List<TeamForgeHierarchyState> SceneSnapshot(string sceneId)
        {
            var result = new List<TeamForgeHierarchyState>();
            foreach (var state in _objects.Values)
            {
                if (state.SceneId == sceneId)
                {
                    result.Add(state.Clone());
                }
            }
            result.Sort((left, right) =>
            {
                var parent = string.CompareOrdinal(left.ParentObjectId, right.ParentObjectId);
                if (parent != 0) return parent;
                var sibling = left.SiblingIndex.CompareTo(right.SiblingIndex);
                return sibling != 0 ? sibling : string.CompareOrdinal(left.ObjectId, right.ObjectId);
            });
            return result;
        }

        public List<TeamForgeHierarchyState> Snapshot()
        {
            var result = new List<TeamForgeHierarchyState>();
            foreach (var state in _objects.Values)
            {
                result.Add(state.Clone());
            }
            return result;
        }

        public void Clear()
        {
            _objects.Clear();
            _tombstones.Clear();
        }

        private static string Key(string sceneId, string objectId)
        {
            return (sceneId ?? string.Empty) + "\n" + (objectId ?? string.Empty);
        }
    }

    public sealed class TeamForgePendingHierarchyOperation
    {
        public TeamForgePendingHierarchyOperation(string operationId, string requestId, string sceneId, string objectId, string kind)
        {
            OperationId = operationId;
            RequestId = requestId;
            SceneId = sceneId;
            ObjectId = objectId;
            Kind = kind;
        }

        public string OperationId { get; }
        public string RequestId { get; }
        public string SceneId { get; }
        public string ObjectId { get; }
        public string Kind { get; }
    }
}

using System;
using System.Collections.Generic;
using UnityEngine;

namespace EunSung.TeamForge
{
    public static class TeamForgePresenceValidation
    {
        private const long MaximumUnixMilliseconds = 253402300799999;

        public static bool TryValidate(PresenceRecord presence, out string error)
        {
            if (presence == null)
            {
                error = "Presence record is missing.";
                return false;
            }

            if (!TryValidateText(presence.userId, "User ID", 128, false, out error) ||
                !TryValidateText(presence.connectionId, "Connection ID", 128, false, out error) ||
                !TryValidateText(presence.displayName, "Display name", 64, false, out error) ||
                !TryValidateText(presence.sceneId, "Scene ID", 128, true, out error) ||
                !TryValidateText(presence.sceneName, "Scene name", 128, true, out error) ||
                !TryValidateText(presence.selectedObjectId, "Selected object ID", 512, true, out error) ||
                !TryValidateText(presence.selectedObjectName, "Selected object name", 128, true, out error) ||
                !TryValidateText(presence.activity, "Activity", 64, true, out error))
            {
                return false;
            }

            if (string.IsNullOrWhiteSpace(presence.color) ||
                presence.color.Length != 7 ||
                presence.color[0] != '#' ||
                !ColorUtility.TryParseHtmlString(presence.color, out _))
            {
                error = "Presence color is invalid.";
                return false;
            }

            if (!IsFinite(presence.cameraPosition) ||
                !IsFinite(presence.cameraRotation) ||
                !IsFinite(presence.cameraPivot) ||
                !IsFinite(presence.cameraSize) ||
                presence.cameraSize < 0.001f ||
                presence.cameraSize > 1000000000f)
            {
                error = "Presence camera data is invalid.";
                return false;
            }

            if (presence.lastHeartbeatUnixMs < 0 || presence.lastHeartbeatUnixMs > MaximumUnixMilliseconds)
            {
                error = "Presence heartbeat timestamp is invalid.";
                return false;
            }

            error = string.Empty;
            return true;
        }

        private static bool TryValidateText(
            string value,
            string label,
            int maximumLength,
            bool allowEmpty,
            out string error)
        {
            var candidate = value?.Trim() ?? string.Empty;
            if ((!allowEmpty && candidate.Length == 0) || candidate.Length > maximumLength)
            {
                error = allowEmpty
                    ? $"{label} must contain at most {maximumLength} characters."
                    : $"{label} must contain 1-{maximumLength} characters.";
                return false;
            }

            foreach (var character in candidate)
            {
                if (char.IsControl(character))
                {
                    error = $"{label} cannot contain control characters.";
                    return false;
                }
            }

            error = string.Empty;
            return true;
        }

        private static bool IsFinite(TeamForgeVector3Dto value)
        {
            return value != null && IsFinite(value.x) && IsFinite(value.y) && IsFinite(value.z) &&
                   Mathf.Abs(value.x) <= 1000000000f &&
                   Mathf.Abs(value.y) <= 1000000000f &&
                   Mathf.Abs(value.z) <= 1000000000f;
        }

        private static bool IsFinite(TeamForgeQuaternionDto value)
        {
            return value != null && IsFinite(value.x) && IsFinite(value.y) &&
                   IsFinite(value.z) && IsFinite(value.w);
        }

        private static bool IsFinite(float value)
        {
            return !float.IsNaN(value) && !float.IsInfinity(value);
        }
    }

    public sealed class TeamForgePresenceRegistry
    {
        private readonly Dictionary<string, PresenceRecord> _members =
            new Dictionary<string, PresenceRecord>(StringComparer.Ordinal);

        public event Action Changed;

        public int Count => _members.Count;
        public long Version { get; private set; }

        public bool ReplaceAll(IEnumerable<PresenceRecord> members, out string error)
        {
            var replacement = new Dictionary<string, PresenceRecord>(StringComparer.Ordinal);
            if (members != null)
            {
                foreach (var member in members)
                {
                    if (!TeamForgePresenceValidation.TryValidate(member, out error))
                    {
                        return false;
                    }

                    if (replacement.ContainsKey(member.userId))
                    {
                        error = $"Presence snapshot contains duplicate user ID '{member.userId}'.";
                        return false;
                    }
                    replacement.Add(member.userId, member);
                }
            }

            _members.Clear();
            foreach (var pair in replacement)
            {
                _members.Add(pair.Key, pair.Value);
            }
            error = string.Empty;
            Version += 1;
            Changed?.Invoke();
            return true;
        }

        public bool Upsert(PresenceRecord member, out string error)
        {
            if (!TeamForgePresenceValidation.TryValidate(member, out error))
            {
                return false;
            }

            _members[member.userId] = member;
            Version += 1;
            Changed?.Invoke();
            return true;
        }

        public bool Remove(string userId)
        {
            if (string.IsNullOrWhiteSpace(userId) || !_members.Remove(userId))
            {
                return false;
            }

            Version += 1;
            Changed?.Invoke();
            return true;
        }

        public bool TryGet(string userId, out PresenceRecord member)
        {
            return _members.TryGetValue(userId ?? string.Empty, out member);
        }

        public List<PresenceRecord> Snapshot()
        {
            var snapshot = new List<PresenceRecord>(_members.Values);
            snapshot.Sort((left, right) =>
            {
                var byName = string.Compare(left.displayName, right.displayName, StringComparison.OrdinalIgnoreCase);
                return byName != 0
                    ? byName
                    : string.Compare(left.userId, right.userId, StringComparison.Ordinal);
            });
            return snapshot;
        }

        public void Clear()
        {
            if (_members.Count == 0)
            {
                return;
            }

            _members.Clear();
            Version += 1;
            Changed?.Invoke();
        }
    }
}

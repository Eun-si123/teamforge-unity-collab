using System;
using System.Collections.Generic;

namespace EunSung.TeamForge
{
    // Epoch binding happens once, before a retry payload is retained. A retired
    // payload is refused; it is never rewritten for the next authority epoch.
    internal static class TeamForgeDurableSessionWire
    {
        private static readonly HashSet<string> BoundTypes = new HashSet<string>(StringComparer.Ordinal)
        { "hierarchy_seed", "hierarchy_operation", "transform_update", "lock_request", "lock_release", "component_scene_join" };

        internal static bool IsCanonicalUuid(string value) =>
            Guid.TryParseExact(value, "D", out var parsed) && parsed != Guid.Empty && parsed.ToString("D") == value;

        internal static bool TryPrepare(string json, bool enabled, string authorityEpoch,
            out string prepared, out string error)
        {
            prepared = null; error = "The durable command envelope is invalid.";
            if (!TeamForgeProtocol.TryReadEnvelope(json, out var envelope, out _)) return false;
            if (!BoundTypes.Contains(envelope.type)) { prepared = json; error = string.Empty; return true; }
            if (!TeamForgeColliderPropertyWire.TryReadOptionalTopLevelString(json, "authorityEpoch", 1024 * 1024,
                out var present, out var previous) || (present && !IsCanonicalUuid(previous))) return false;
            if (!enabled)
            {
                if (present) { error = "A retained command belongs to a durable epoch that this connection did not negotiate."; return false; }
                prepared = json; error = string.Empty; return true;
            }
            if (!IsCanonicalUuid(authorityEpoch)) return false;
            if (present)
            {
                if (previous != authorityEpoch)
                { error = "The retained command belongs to an earlier authority epoch. Review current shared state before resubmitting."; return false; }
                prepared = json; error = string.Empty; return true;
            }
            var close = json.Length - 1;
            while (close >= 0 && char.IsWhiteSpace(json[close])) close--;
            if (close < 0 || json[close] != '}') return false;
            prepared = json.Substring(0, close) + ",\"authorityEpoch\":\"" + authorityEpoch + "\"}" + json.Substring(close + 1);
            error = string.Empty; return true;
        }

    }
}

using System;
using System.Collections.Generic;

namespace EunSung.TeamForge
{
    /// <summary>
    /// Tracks the narrow subset of protected Transform conflicts that can be
    /// recovered automatically: a local Transform operation rejected with
    /// lock_required. Generic protected conflicts remain fail-closed.
    /// </summary>
    internal sealed class TeamForgeTransformConflictRecoveryRegistry
    {
        private readonly HashSet<string> _lockRequiredKeys =
            new HashSet<string>(StringComparer.Ordinal);
        private readonly Dictionary<string, TransformAppliedMessage> _deferredAuthoritativeTransforms =
            new Dictionary<string, TransformAppliedMessage>(StringComparer.Ordinal);

        internal int Count => _lockRequiredKeys.Count;

        internal void MarkLockRequired(string sceneId, string objectId)
        {
            _lockRequiredKeys.Add(Key(sceneId, objectId));
        }

        internal void MarkNonRecoverable(string sceneId, string objectId)
        {
            Remove(sceneId, objectId);
        }

        internal bool IsLockRequired(string sceneId, string objectId)
        {
            return _lockRequiredKeys.Contains(Key(sceneId, objectId));
        }

        internal void DeferAuthoritativeTransform(TransformAppliedMessage message)
        {
            if (message == null || !IsLockRequired(message.sceneId, message.objectId))
            {
                return;
            }

            var key = Key(message.sceneId, message.objectId);
            if (!_deferredAuthoritativeTransforms.TryGetValue(key, out var current) ||
                current == null ||
                message.serverRevision > current.serverRevision)
            {
                _deferredAuthoritativeTransforms[key] = message;
            }
        }

        internal bool TryGetDeferredAuthoritativeTransform(
            string sceneId,
            string objectId,
            out TransformAppliedMessage message)
        {
            return _deferredAuthoritativeTransforms.TryGetValue(
                Key(sceneId, objectId),
                out message);
        }

        internal void Remove(string sceneId, string objectId)
        {
            var key = Key(sceneId, objectId);
            _lockRequiredKeys.Remove(key);
            _deferredAuthoritativeTransforms.Remove(key);
        }

        internal void Clear()
        {
            _lockRequiredKeys.Clear();
            _deferredAuthoritativeTransforms.Clear();
        }

        private static string Key(string sceneId, string objectId)
        {
            return (sceneId ?? string.Empty) + "\n" + (objectId ?? string.Empty);
        }
    }
}

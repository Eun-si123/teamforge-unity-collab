using System;
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEngine;

namespace EunSung.TeamForge
{
    [InitializeOnLoad]
    public static class TeamForgeHierarchyIdentityRegistry
    {
        private const string LogicalPrefix = "tf:";
        private const string PersistencePath = "Library/TeamForge/hierarchy-ids-v1.json";
        private static readonly Dictionary<EntityId, string> LogicalByEntityId = new Dictionary<EntityId, string>();
        private static readonly Dictionary<string, EntityId> EntityIdByLogical = new Dictionary<string, EntityId>(StringComparer.Ordinal);
        private static readonly Dictionary<string, string> GlobalByLogical = new Dictionary<string, string>(StringComparer.Ordinal);
        private static readonly Dictionary<string, string> LogicalByGlobal = new Dictionary<string, string>(StringComparer.Ordinal);
        private static readonly HashSet<string> SessionCanonicalLogicalIds = new HashSet<string>(StringComparer.Ordinal);
        private static string _connectionIdentityEpoch = string.Empty;

        internal static event Action SessionIdentityChanged;

        static TeamForgeHierarchyIdentityRegistry()
        {
            Load();
            AssemblyReloadEvents.beforeAssemblyReload += Persist;
            EditorApplication.quitting += Persist;
        }

        public static bool IsLogicalId(string objectId)
        {
            if (string.IsNullOrWhiteSpace(objectId) || !objectId.StartsWith(LogicalPrefix, StringComparison.Ordinal) || objectId.Length != 35)
            {
                return false;
            }
            for (var index = LogicalPrefix.Length; index < objectId.Length; index += 1)
            {
                var character = objectId[index];
                if (!((character >= '0' && character <= '9') || (character >= 'a' && character <= 'f')))
                {
                    return false;
                }
            }
            return true;
        }

        internal static bool BeginConnectionIdentityEpoch(string connectionId)
        {
            var nextEpoch = connectionId?.Trim() ?? string.Empty;
            if (string.Equals(_connectionIdentityEpoch, nextEpoch, StringComparison.Ordinal))
            {
                return false;
            }

            _connectionIdentityEpoch = nextEpoch;
            var changed = SessionCanonicalLogicalIds.Count > 0;
            SessionCanonicalLogicalIds.Clear();
            if (changed)
            {
                SessionIdentityChanged?.Invoke();
            }
            return true;
        }

        internal static bool IsSessionCanonicalLogicalId(string logicalId)
        {
            return IsLogicalId(logicalId) && SessionCanonicalLogicalIds.Contains(logicalId);
        }

        internal static bool TryGetSessionLogicalId(GameObject target, out string logicalId)
        {
            if (TryGetLogicalId(target, out logicalId) && SessionCanonicalLogicalIds.Contains(logicalId))
            {
                return true;
            }
            logicalId = string.Empty;
            return false;
        }

        public static bool TryGetKnownId(GameObject target, out string objectId)
        {
            objectId = string.Empty;
            if (target == null || !target.scene.IsValid() || !target.scene.isLoaded)
            {
                return false;
            }

            var entityId = target.GetEntityId();
            if (LogicalByEntityId.TryGetValue(entityId, out objectId) && IsLogicalId(objectId))
            {
                if (BindGlobalIfAvailable(objectId, target))
                {
                    SessionIdentityChanged?.Invoke();
                }
                return true;
            }

            if (TeamForgeObjectIdentity.TryGetGlobalObjectId(target, out var globalObjectId))
            {
                if (LogicalByGlobal.TryGetValue(globalObjectId, out var logicalId) && IsLogicalId(logicalId))
                {
                    BindLogicalCore(logicalId, target, false);
                    objectId = logicalId;
                    return true;
                }
                objectId = globalObjectId;
                return true;
            }
            return false;
        }

        public static bool TryGetLogicalId(GameObject target, out string logicalId)
        {
            logicalId = string.Empty;
            if (target == null)
            {
                return false;
            }
            var entityId = target.GetEntityId();
            if (LogicalByEntityId.TryGetValue(entityId, out logicalId) && IsLogicalId(logicalId))
            {
                return true;
            }
            if (TeamForgeObjectIdentity.TryGetGlobalObjectId(target, out var globalObjectId) &&
                LogicalByGlobal.TryGetValue(globalObjectId, out logicalId) && IsLogicalId(logicalId))
            {
                BindLogicalCore(logicalId, target, false);
                return true;
            }
            logicalId = string.Empty;
            return false;
        }

        public static string GetOrCreateLogicalId(GameObject target)
        {
            if (target == null)
            {
                return string.Empty;
            }
            if (LogicalByEntityId.TryGetValue(target.GetEntityId(), out var existing) &&
                IsLogicalId(existing) &&
                SessionCanonicalLogicalIds.Contains(existing))
            {
                return existing;
            }

            var logicalId = LogicalPrefix + Guid.NewGuid().ToString("N");
            BindLogical(logicalId, target);
            return logicalId;
        }

        public static bool BindLogical(string logicalId, GameObject target)
        {
            return BindLogicalCore(logicalId, target, true);
        }

        private static bool BindLogicalCore(string logicalId, GameObject target, bool sessionCanonical)
        {
            if (!IsLogicalId(logicalId) || target == null || !target.scene.IsValid() || !target.scene.isLoaded)
            {
                return false;
            }

            var entityId = target.GetEntityId();
            var sessionIdentityChanged = false;
            if (LogicalByEntityId.TryGetValue(entityId, out var previousLogicalId) && previousLogicalId != logicalId)
            {
                EntityIdByLogical.Remove(previousLogicalId);
                sessionIdentityChanged |= SessionCanonicalLogicalIds.Remove(previousLogicalId);
            }
            if (EntityIdByLogical.TryGetValue(logicalId, out var previousEntityId) && previousEntityId != entityId)
            {
                LogicalByEntityId.Remove(previousEntityId);
            }
            LogicalByEntityId[entityId] = logicalId;
            EntityIdByLogical[logicalId] = entityId;
            if (sessionCanonical)
            {
                sessionIdentityChanged |= SessionCanonicalLogicalIds.Add(logicalId);
            }
            sessionIdentityChanged |= BindGlobalIfAvailable(logicalId, target);
            if (sessionIdentityChanged)
            {
                SessionIdentityChanged?.Invoke();
            }
            return true;
        }

        public static bool TryResolve(string logicalId, out GameObject target)
        {
            target = null;
            if (!IsLogicalId(logicalId))
            {
                return false;
            }

            if (EntityIdByLogical.TryGetValue(logicalId, out var entityId))
            {
                target = Resources.EntityIdToObject(entityId) as GameObject;
                if (target != null && target.scene.IsValid() && target.scene.isLoaded)
                {
                    return true;
                }
                EntityIdByLogical.Remove(logicalId);
                LogicalByEntityId.Remove(entityId);
            }

            if (!GlobalByLogical.TryGetValue(logicalId, out var globalObjectId) ||
                !GlobalObjectId.TryParse(globalObjectId, out var parsed) || parsed.identifierType == 0)
            {
                return false;
            }

            var resolved = GlobalObjectId.GlobalObjectIdentifierToObjectSlow(parsed);
            target = resolved as GameObject;
            if (target == null && resolved is Component component)
            {
                target = component.gameObject;
            }
            if (target == null || !target.scene.IsValid() || !target.scene.isLoaded)
            {
                target = null;
                return false;
            }
            BindLogicalCore(logicalId, target, false);
            return true;
        }

        public static void ForgetLiveObject(string logicalId)
        {
            if (!IsLogicalId(logicalId))
            {
                return;
            }
            if (EntityIdByLogical.TryGetValue(logicalId, out var entityId))
            {
                EntityIdByLogical.Remove(logicalId);
                LogicalByEntityId.Remove(entityId);
            }
            if (SessionCanonicalLogicalIds.Remove(logicalId))
            {
                SessionIdentityChanged?.Invoke();
            }
        }

        public static void RefreshAndPersist()
        {
            var sessionIdentityChanged = false;
            foreach (var pair in new List<KeyValuePair<string, EntityId>>(EntityIdByLogical))
            {
                var target = Resources.EntityIdToObject(pair.Value) as GameObject;
                if (target != null)
                {
                    sessionIdentityChanged |= BindGlobalIfAvailable(pair.Key, target);
                }
            }
            if (sessionIdentityChanged)
            {
                SessionIdentityChanged?.Invoke();
            }
            Persist();
        }

        private static bool BindGlobalIfAvailable(string logicalId, GameObject target)
        {
            if (!TeamForgeObjectIdentity.TryGetGlobalObjectId(target, out var globalObjectId))
            {
                return false;
            }
            var sessionIdentityChanged = false;
            if (GlobalByLogical.TryGetValue(logicalId, out var previousGlobal) && previousGlobal != globalObjectId)
            {
                LogicalByGlobal.Remove(previousGlobal);
            }
            if (LogicalByGlobal.TryGetValue(globalObjectId, out var previousLogical) && previousLogical != logicalId)
            {
                GlobalByLogical.Remove(previousLogical);
                if (EntityIdByLogical.TryGetValue(previousLogical, out var previousEntityId))
                {
                    EntityIdByLogical.Remove(previousLogical);
                    if (LogicalByEntityId.TryGetValue(previousEntityId, out var boundLogical) &&
                        boundLogical == previousLogical)
                    {
                        LogicalByEntityId.Remove(previousEntityId);
                    }
                }
                sessionIdentityChanged |= SessionCanonicalLogicalIds.Remove(previousLogical);
            }
            GlobalByLogical[logicalId] = globalObjectId;
            LogicalByGlobal[globalObjectId] = logicalId;
            return sessionIdentityChanged;
        }

        private static void Load()
        {
            try
            {
                if (!File.Exists(PersistencePath))
                {
                    return;
                }
                var snapshot = JsonUtility.FromJson<PersistedSnapshot>(File.ReadAllText(PersistencePath));
                if (snapshot?.entries == null)
                {
                    return;
                }
                foreach (var entry in snapshot.entries)
                {
                    if (entry == null || !IsLogicalId(entry.logicalId) || string.IsNullOrWhiteSpace(entry.globalObjectId))
                    {
                        continue;
                    }
                    GlobalByLogical[entry.logicalId] = entry.globalObjectId;
                    LogicalByGlobal[entry.globalObjectId] = entry.logicalId;
                }
            }
            catch (Exception exception)
            {
                TeamForgeDiagnostics.Warning($"Hierarchy identity cache could not be loaded: {exception.Message}");
            }
        }

        private static void Persist()
        {
            try
            {
                var directory = Path.GetDirectoryName(PersistencePath);
                if (!string.IsNullOrWhiteSpace(directory))
                {
                    Directory.CreateDirectory(directory);
                }
                var entries = new List<PersistedEntry>();
                foreach (var pair in GlobalByLogical)
                {
                    entries.Add(new PersistedEntry { logicalId = pair.Key, globalObjectId = pair.Value });
                }
                entries.Sort((left, right) => string.CompareOrdinal(left.logicalId, right.logicalId));
                File.WriteAllText(PersistencePath, JsonUtility.ToJson(new PersistedSnapshot { entries = entries.ToArray() }, true));
            }
            catch (Exception exception)
            {
                TeamForgeDiagnostics.Warning($"Hierarchy identity cache could not be saved: {exception.Message}");
            }
        }

        [Serializable]
        private sealed class PersistedSnapshot
        {
            public PersistedEntry[] entries;
        }

        [Serializable]
        private sealed class PersistedEntry
        {
            public string logicalId;
            public string globalObjectId;
        }
    }
}

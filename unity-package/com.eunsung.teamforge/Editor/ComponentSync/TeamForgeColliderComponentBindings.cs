using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using UnityEditor;
using UnityEngine;

namespace EunSung.TeamForge
{
    // Local aliases for already accepted runtime identities. No source baseline
    // is inferred from this cache, and it never grants a network operation.
    [InitializeOnLoad]
    internal static class TeamForgeColliderComponentBindings
    {
        private const int MaximumBindings = 512;
        private const int MaximumKnownIdentities = MaximumBindings + 4096;
        private const int MaximumBytes = 2 * 1024 * 1024;
        private const string ProcessKey = "EunSung.TeamForge.ColliderBindings.Process.v1";
        private const string StateKey = "EunSung.TeamForge.ColliderBindings.State.v1.";
        private static readonly Dictionary<string, Binding> Bindings = new Dictionary<string, Binding>(StringComparer.Ordinal);
        private static Context context;
        private static string processNonce;
        private static bool contextVerified;
        internal static string ContextIdentity { get; private set; } = string.Empty;
        internal static string Status { get; private set; } = "No runtime Collider identity context.";

        [Serializable] private sealed class Context
        {
            public string projectId, sessionId, projectUuid, sceneId, epoch;
        }
        [Serializable] private sealed class Binding
        {
            public TeamForgeColliderComponentCatalogRow row;
            public string savedAlias;
            // EntityId is 32-bit in Unity 6000.3 and 64-bit in 6000.6. Serialize
            // it opaquely; never cast to obsolete int/InstanceID APIs.
            public EntityId entityId;
            public string processNonce;
            public bool removed;
            public bool hadNative;
        }
        [Serializable] private sealed class Snapshot
        {
            public int version;
            public Context context;
            public Binding[] bindings;
        }
        [Serializable] private sealed class Envelope
        {
            public string payload;
            public string checksum;
        }

        static TeamForgeColliderComponentBindings()
        {
            AssemblyReloadEvents.beforeAssemblyReload += PersistBeforeReload;
            EditorApplication.quitting += PersistBeforeReload;
            UnityEditor.SceneManagement.EditorSceneManager.sceneSaved += scene =>
            {
                if (context != null && AssetDatabase.AssetPathToGUID(scene.path) == context.sceneId &&
                    !RefreshSavedBindings(out var error)) TeamForgeDiagnostics.Warning(error);
            };
        }

        internal static bool IsActiveFor(string sceneId) => contextVerified && context != null && context.sceneId == sceneId;

        internal static void ClearContext()
        {
            Bindings.Clear(); context = null; contextVerified = false; ContextIdentity = string.Empty;
            Status = "No runtime Collider identity context.";
        }

        internal static bool SetContext(string projectId, string sessionId, string projectUuid,
            string sceneId, string epoch, out string error)
        {
            error = string.Empty;
            if (!CanonicalText(projectId, 128) || !CanonicalText(sessionId, 128) ||
                !Guid.TryParseExact(projectUuid, "D", out var projectGuid) || projectGuid.ToString("D") != projectUuid ||
                !Guid.TryParseExact(epoch, "D", out var epochGuid) || epochGuid.ToString("D") != epoch ||
                !TeamForgeWp6ComponentIdentity.IsSceneGuid(sceneId))
            { error = "A canonical Project, Session, Scene and server epoch are required for runtime Collider binding."; return false; }
            var next = new Context { projectId = projectId, sessionId = sessionId,
                projectUuid = projectUuid, sceneId = sceneId, epoch = epoch };
            var identity = Digest(JsonUtility.ToJson(next));
            if (ContextIdentity == identity && contextVerified) return true;
            context = next; contextVerified = false; ContextIdentity = identity; Bindings.Clear();
            EnsureProcessNonce();
            if (!Load(out error)) { Status = error; return false; }
            contextVerified = true;
            Status = "Runtime Collider identities loaded for the verified Scene/epoch.";
            return true;
        }

        internal static bool HasBinding(TeamForgeColliderComponentCatalogRow row) =>
            row != null && IsActiveFor(row.sceneId) &&
            Bindings.TryGetValue(row.componentId ?? string.Empty, out var binding) && !binding.removed;

        internal static bool TryResolveOwner(string sceneId, string objectId, out GameObject owner, out string error)
        {
            try { return TryResolveOwnerCore(sceneId, objectId, out owner, out error); }
            catch (Exception)
            { owner = null; error = "The exact Collider owner changed during Unity Scene identity lookup."; return false; }
        }

        private static bool TryResolveOwnerCore(string sceneId, string objectId, out GameObject owner, out string error)
        {
            owner = null;
            error = "The exact loaded non-Prefab Collider owner is unavailable.";
            if (!TeamForgeWp6ComponentIdentity.IsSceneGuid(sceneId) ||
                !TeamForgeColliderComponentCatalogRow.IsOwnerId(objectId, sceneId) ||
                !TeamForgeObjectIdentity.TryResolveGameObject(objectId, out var resolved) || resolved == null ||
                !resolved.scene.IsValid() || !resolved.scene.isLoaded || string.IsNullOrEmpty(resolved.scene.path) ||
                AssetDatabase.AssetPathToGUID(resolved.scene.path) != sceneId || PrefabUtility.IsPartOfAnyPrefab(resolved)) return false;
            if (TeamForgeHierarchyIdentityRegistry.IsLogicalId(objectId))
            {
                if (!TeamForgeHierarchyIdentityRegistry.TryGetSessionLogicalId(resolved, out var canonical) || canonical != objectId) return false;
            }
            else if (GlobalObjectId.GetGlobalObjectIdSlow(resolved).ToString() != objectId) return false;
            owner = resolved; error = string.Empty; return true;
        }

        internal static bool TryResolve(string sceneId, string objectId, string componentId, string typeName,
            out Component component, out string error)
        {
            try { return TryResolveCore(sceneId, objectId, componentId, typeName, false, out component, out error); }
            catch (Exception)
            { component = null; error = "The exact runtime Collider changed during native identity lookup."; return false; }
        }

        private static bool TryResolveCore(string sceneId, string objectId, string componentId, string typeName,
            bool forRemoval, out Component component, out string error)
        {
            component = null;
            var row = new TeamForgeColliderComponentCatalogRow { sceneId = sceneId, objectId = objectId,
                componentId = componentId, typeName = typeName };
            if (!row.IsValid || !TryResolveOwner(sceneId, objectId, out var owner, out error))
            { error = "Collider identity or exact owner is invalid."; return false; }
            if (IsActiveFor(sceneId) && Bindings.TryGetValue(componentId, out var binding))
            {
                if (!SameTarget(binding.row, row))
                { error = "The runtime Collider identity belongs to another exact owner/type."; return false; }
                if (binding.removed && !forRemoval)
                { error = "This canonical Collider identity is currently removed."; return false; }
                EnsureProcessNonce();
                if (binding.processNonce == processNonce && binding.entityId.IsValid())
                    component = Resources.EntityIdToObject(binding.entityId) as Component;
                if (!Matches(component, owner, typeName) && !string.IsNullOrEmpty(binding.savedAlias) &&
                    TeamForgeColliderComponentCatalogRow.IsSavedId(binding.savedAlias, sceneId) &&
                    GlobalObjectId.TryParse(binding.savedAlias, out var alias))
                    component = GlobalObjectId.GlobalObjectIdentifierToObjectSlow(alias) as Component;
                if (Matches(component, owner, typeName))
                {
                    if (forRemoval)
                        foreach (var other in Bindings.Values)
                            if (!other.removed && other.row.componentId != componentId &&
                                ((other.processNonce == processNonce && other.entityId == component.GetEntityId()) ||
                                 (!string.IsNullOrEmpty(binding.savedAlias) && other.savedAlias == binding.savedAlias)))
                            { component = null; error = "The removed Collider alias now belongs to another active identity."; return false; }
                    binding.entityId = component.GetEntityId(); binding.processNonce = processNonce;
                    error = string.Empty; return true;
                }
                component = null;
                error = "The accepted runtime Collider binding has no exact live native target.";
                return false;
            }
            // M1 retains its strict saved-ID resolver. A logical Component never
            // falls back to a sibling/type/index or an unverified local object.
            if (TeamForgeWp6ComponentIdentity.TryResolve(new TeamForgeWp6ComponentIdentity.Record(
                sceneId, objectId, componentId, typeName), out component, out error)) return true;
            component = null; return false;
        }

        // Only a verified topology tombstone uses this lookup. Normal property
        // reads cannot revive a deleted canonical ID through its old saved alias.
        internal static bool TryResolveForRemoval(TeamForgeColliderComponentCatalogRow row,
            out Component component, out string error)
        {
            component = null;
            if (row == null || !row.IsValid || !IsActiveFor(row.sceneId))
            { error = "The removed Collider identity context is not active."; return false; }
            try { return TryResolveCore(row.sceneId, row.objectId, row.componentId, row.typeName, true, out component, out error); }
            catch (Exception)
            { component = null; error = "The removed Collider alias changed during native lookup."; return false; }
        }

        internal static bool CanCreateMissing(TeamForgeColliderComponentCatalogRow row, out string error)
        {
            error = string.Empty;
            if (row == null || !row.IsValid || !IsActiveFor(row.sceneId))
            { error = "The accepted Collider identity context is not active."; return false; }
            if (Bindings.TryGetValue(row.componentId, out var binding) && !SameTarget(binding.row, row))
            { error = "A removed Collider identity cannot be retargeted to another owner/type."; return false; }
            if (binding != null && binding.hadNative &&
                string.IsNullOrEmpty(binding.savedAlias) && binding.processNonce != processNonce)
            {
                error = "An unsaved Collider alias cannot be recovered across Editor process loss. Review the local Scene before recreating it.";
                return false;
            }
            return true;
        }

        internal static bool TryBind(TeamForgeColliderComponentCatalogRow row, Component component, out string error)
        {
            error = string.Empty;
            if (row == null || !row.IsValid || !IsActiveFor(row.sceneId) ||
                !TryResolveOwner(row.sceneId, row.objectId, out var owner, out error) || !Matches(component, owner, row.typeName))
            { error = "Only an accepted exact Collider target in the active Scene/epoch may be bound."; return false; }
            EnsureProcessNonce();
            foreach (var entry in Bindings.Values)
            {
                if (entry.removed || entry.row.componentId == row.componentId) continue;
                if (entry.processNonce == processNonce && entry.entityId == component.GetEntityId())
                { error = "A native Collider is already bound to another canonical Component identity."; return false; }
                var native = SavedAlias(component, row.sceneId);
                if (!string.IsNullOrEmpty(native) && native == entry.savedAlias)
                { error = "A saved Collider alias is already bound to another canonical Component identity."; return false; }
            }
            if (Bindings.TryGetValue(row.componentId, out var prior) && !SameTarget(prior.row, row))
            { error = "A canonical Collider identity cannot change its owner or type."; return false; }
            if (prior != null && TryResolveCore(row.sceneId, row.objectId, row.componentId, row.typeName,
                    true, out var priorNative, out _) && priorNative != component)
            { error = "A canonical Collider identity is already bound to another live native Component."; return false; }
            if (prior == null && TeamForgeColliderComponentCatalogRow.IsSavedId(row.componentId, row.sceneId) &&
                GlobalObjectId.TryParse(row.componentId, out var canonicalId))
            {
                var original = GlobalObjectId.GlobalObjectIdentifierToObjectSlow(canonicalId);
                if (original != null && original != component)
                { error = "A live saved Component identity cannot be aliased to a different native object."; return false; }
            }
            var activeCount = 0;
            foreach (var entry in Bindings.Values) if (!entry.removed) activeCount++;
            if ((!Bindings.TryGetValue(row.componentId, out var existing) || existing.removed) && activeCount >= MaximumBindings)
            { error = "The bounded active Collider binding capacity is full."; return false; }
            if (existing == null && Bindings.Count >= MaximumKnownIdentities)
            { error = "The bounded Collider identity/tombstone capacity is full."; return false; }
            Bindings[row.componentId] = new Binding { row = row.Copy(), savedAlias = SavedAlias(component, row.sceneId),
                entityId = component.GetEntityId(), processNonce = processNonce, hadNative = true };
            return true;
        }

        internal static bool Forget(TeamForgeColliderComponentCatalogRow row, out string error)
        {
            error = string.Empty;
            if (row == null || !row.IsValid || !IsActiveFor(row.sceneId))
            { error = "The Collider binding context changed before deletion."; return false; }
            if (Bindings.TryGetValue(row.componentId, out var entry) && !SameTarget(entry.row, row))
            { error = "The removed Collider binding belongs to another target."; return false; }
            if (entry == null)
            {
                if (Bindings.Count >= MaximumKnownIdentities)
                { error = "The bounded Collider tombstone identity capacity is full."; return false; }
                EnsureProcessNonce();
                entry = new Binding { row = row.Copy(), processNonce = processNonce,
                    savedAlias = TeamForgeColliderComponentCatalogRow.IsSavedId(row.componentId, row.sceneId)
                        ? row.componentId : string.Empty };
                Bindings.Add(row.componentId, entry);
            }
            entry.removed = true; entry.row = row.Copy(); return true;
        }

        internal static bool RefreshSavedBindings(out string error)
        {
            error = string.Empty;
            if (context == null) return true;
            if (!contextVerified) { error = Status; return false; }
            foreach (var entry in Bindings.Values)
            {
                if (entry.removed) continue;
                if (!TryResolve(entry.row.sceneId, entry.row.objectId, entry.row.componentId,
                    entry.row.typeName, out var component, out _)) continue;
                entry.savedAlias = SavedAlias(component, entry.row.sceneId);
            }
            return Persist(out error);
        }

        private static bool Load(out string error)
        {
            error = string.Empty;
            try
            {
                var json = SessionState.GetString(StateKey + ContextIdentity, string.Empty);
                if (string.IsNullOrEmpty(json))
                {
                    var path = StatePath();
                    if (!SafeDirectories(false)) throw new IOException();
                    if (!File.Exists(path)) return true;
                    if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0) throw new IOException();
                    using (var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read))
                    {
                        if (stream.Length < 1 || stream.Length > MaximumBytes) throw new IOException();
                        var bytes = new byte[(int)stream.Length]; var offset = 0;
                        while (offset < bytes.Length)
                        { var count = stream.Read(bytes, offset, bytes.Length - offset); if (count == 0) throw new IOException(); offset += count; }
                        if (stream.ReadByte() != -1 || stream.Length != bytes.Length) throw new IOException();
                        json = new UTF8Encoding(false, true).GetString(bytes);
                    }
                }
                if (Encoding.UTF8.GetByteCount(json) > MaximumBytes) throw new IOException();
                var envelope = JsonUtility.FromJson<Envelope>(json);
                if (envelope == null || string.IsNullOrEmpty(envelope.payload) || envelope.checksum != Digest(envelope.payload)) throw new IOException();
                var snapshot = JsonUtility.FromJson<Snapshot>(envelope.payload);
                if (snapshot == null || snapshot.version != 2 || snapshot.context == null ||
                    Digest(JsonUtility.ToJson(snapshot.context)) != ContextIdentity || snapshot.bindings == null ||
                    snapshot.bindings.Length > MaximumKnownIdentities) throw new IOException();
                var next = new Dictionary<string, Binding>(StringComparer.Ordinal);
                var aliases = new HashSet<string>(StringComparer.Ordinal);
                var entities = new HashSet<EntityId>();
                var activeCount = 0;
                foreach (var entry in snapshot.bindings)
                {
                    if (entry?.row == null || !entry.row.IsValid || entry.row.sceneId != context.sceneId ||
                        !CanonicalText(entry.processNonce, 64) || next.ContainsKey(entry.row.componentId) ||
                        (!string.IsNullOrEmpty(entry.savedAlias) &&
                         (!TeamForgeColliderComponentCatalogRow.IsSavedId(entry.savedAlias, context.sceneId) ||
                          (!entry.removed && !aliases.Add(entry.savedAlias)))) ||
                        (!entry.removed && entry.processNonce == processNonce && entry.entityId.IsValid() && !entities.Add(entry.entityId))) throw new IOException();
                    if (!entry.removed && ++activeCount > MaximumBindings) throw new IOException();
                    next.Add(entry.row.componentId, entry);
                }
                foreach (var pair in next) Bindings.Add(pair.Key, pair.Value);
                return true;
            }
            catch (Exception)
            { error = "The bounded local Collider binding cache could not be verified; no aliases were accepted."; Bindings.Clear(); return false; }
        }

        private static bool Persist(out string error)
        {
            error = string.Empty;
            if (context == null) return true;
            string temporary = null;
            try
            {
                var entries = new List<Binding>(Bindings.Values);
                entries.Sort((left, right) => string.CompareOrdinal(left.row.componentId, right.row.componentId));
                var payload = JsonUtility.ToJson(new Snapshot { version = 2, context = context, bindings = entries.ToArray() });
                var json = JsonUtility.ToJson(new Envelope { payload = payload, checksum = Digest(payload) });
                if (Encoding.UTF8.GetByteCount(json) > MaximumBytes) throw new IOException();
                // Preserve native references over domain reload even if the
                // Scene has not yet assigned persistent local file IDs.
                SessionState.SetString(StateKey + ContextIdentity, json);
                if (!SafeDirectories(true)) throw new IOException();
                var path = StatePath();
                if (File.Exists(path) && (File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0) throw new IOException();
                temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
                using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                using (var writer = new StreamWriter(stream, new UTF8Encoding(false))) writer.Write(json);
                if (File.Exists(path)) File.Replace(temporary, path, null);
                else File.Move(temporary, path);
                temporary = null; Status = "Collider aliases checkpointed locally; Scene disk save remains separate.";
                return true;
            }
            catch (Exception)
            { error = "Collider aliases remain in this Editor session, but the project Library checkpoint could not be written."; Status = error; return false; }
            finally
            {
                if (temporary != null)
                    try { if (File.Exists(temporary) && (File.GetAttributes(temporary) & FileAttributes.ReparsePoint) == 0) File.Delete(temporary); }
                    catch (Exception)
                    { error = "The Collider checkpoint and temporary file cleanup could not complete."; Status = error; }
            }
        }

        private static void PersistBeforeReload()
        {
            if (context != null && !RefreshSavedBindings(out var error)) TeamForgeDiagnostics.Warning(error);
        }
        private static void EnsureProcessNonce()
        {
            if (!string.IsNullOrEmpty(processNonce)) return;
            processNonce = SessionState.GetString(ProcessKey, string.Empty);
            if (string.IsNullOrEmpty(processNonce))
            { processNonce = Guid.NewGuid().ToString("N"); SessionState.SetString(ProcessKey, processNonce); }
        }
        private static string StatePath() => Path.Combine(Directory.GetParent(Application.dataPath).FullName,
            "Library", "TeamForge", "ColliderBindings", ContextIdentity + ".json");
        private static bool SafeDirectories(bool create)
        {
            var root = Directory.GetParent(Application.dataPath).FullName;
            foreach (var segment in new[] { "Library", "TeamForge", "ColliderBindings" })
            {
                root = Path.Combine(root, segment);
                if (File.Exists(root)) return false;
                if (!Directory.Exists(root))
                { if (!create) return true; Directory.CreateDirectory(root); }
                if ((File.GetAttributes(root) & FileAttributes.ReparsePoint) != 0) return false;
            }
            return true;
        }
        private static string SavedAlias(Component component, string sceneId)
        {
            var alias = GlobalObjectId.GetGlobalObjectIdSlow(component).ToString();
            return TeamForgeColliderComponentCatalogRow.IsSavedId(alias, sceneId) ? alias : string.Empty;
        }
        private static bool Matches(Component component, GameObject owner, string typeName) => component != null &&
            component.gameObject == owner && !PrefabUtility.IsPartOfAnyPrefab(component) &&
            (typeName == "UnityEngine.BoxCollider" ? component.GetType() == typeof(BoxCollider) :
             typeName == "UnityEngine.SphereCollider" && component.GetType() == typeof(SphereCollider));
        private static bool SameTarget(TeamForgeColliderComponentCatalogRow a, TeamForgeColliderComponentCatalogRow b) =>
            a.sceneId == b.sceneId && a.objectId == b.objectId && a.componentId == b.componentId && a.typeName == b.typeName;
        private static bool CanonicalText(string value, int limit)
        {
            if (string.IsNullOrEmpty(value) || value.Length > limit || value != value.Trim()) return false;
            foreach (var c in value) if (c < 32 || c == 127) return false;
            return true;
        }
        private static string Digest(string value)
        {
            using (var sha = SHA256.Create())
                return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(value))).Replace("-", string.Empty).ToLowerInvariant();
        }
    }
}

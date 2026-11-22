using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using NUnit.Framework;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace EunSung.TeamForge.Tests
{
    public sealed class TeamForgeColliderComponentBindingTests
    {
        private const string Folder = "Assets/__TeamForgeColliderBindingTests";
        private const string CacheKey = "EunSung.TeamForge.ColliderBindings.State.v1.";
        private const BindingFlags PrivateStatic = BindingFlags.Static | BindingFlags.NonPublic;
        private readonly List<string> ownedContexts = new List<string>();
        private readonly Dictionary<FieldInfo, object> savedFields = new Dictionary<FieldInfo, object>();
        private readonly List<DictionaryEntry> savedBindings = new List<DictionaryEntry>();
        private Scene previousActive;
        private Scene scene;
        private string scenePath, sceneId, projectId, sessionId, projectUuid, epoch;
        private GameObject owner;
        private BoxCollider initial;
        private bool started;
        private bool replacedEmptyUntitledScene;

        [SetUp]
        public void SetUp()
        {
            if (TeamForgeConnectionService.State != TeamForgeConnectionState.Disconnected)
                Assert.Ignore("Binding fixtures require a disconnected Editor; the live collaboration was preserved.");
            for (var index = 0; index < SceneManager.sceneCount; index++)
                if (SceneManager.GetSceneAt(index).isDirty)
                    Assert.Ignore("Binding fixtures require clean open Scenes; unsaved user work was preserved.");
            foreach (var field in typeof(TeamForgeColliderComponentBindings).GetFields(PrivateStatic))
                if (!field.IsInitOnly && !field.IsLiteral) savedFields[field] = field.GetValue(null);
            foreach (DictionaryEntry entry in BindingMap()) savedBindings.Add(entry);
            started = true;
            TeamForgeColliderComponentBindings.ClearContext();
            previousActive = SceneManager.GetActiveScene();
            // Unity cannot open an additive Scene while an untitled Scene is
            // loaded. An automated batch Editor can replace its clean test
            // Scenes; interactive Editors may replace only one empty untitled Scene.
            // In particular, never discard a user's nonempty local Scene.
            var isolatedBatchEditor = Application.isBatchMode;
            var hasUntitled = false;
            for (var index = 0; index < SceneManager.sceneCount; index++)
                if (string.IsNullOrEmpty(SceneManager.GetSceneAt(index).path)) hasUntitled = true;
            replacedEmptyUntitledScene = hasUntitled && (isolatedBatchEditor ||
                (SceneManager.sceneCount == 1 && previousActive.IsValid() &&
                 previousActive.GetRootGameObjects().Length == 0));
            if (hasUntitled && !replacedEmptyUntitledScene)
                Assert.Ignore("Binding fixtures preserve nonempty or multi-Scene untitled Editor state.");
            if (!AssetDatabase.IsValidFolder(Folder)) AssetDatabase.CreateFolder("Assets", "__TeamForgeColliderBindingTests");
            scenePath = Folder + "/" + Guid.NewGuid().ToString("N") + ".unity";
            scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene,
                replacedEmptyUntitledScene ? NewSceneMode.Single : NewSceneMode.Additive);
            SceneManager.SetActiveScene(scene);
            owner = new GameObject("Exact runtime Collider owner");
            initial = owner.AddComponent<BoxCollider>();
            Assert.That(EditorSceneManager.SaveScene(scene, scenePath), Is.True);
            sceneId = AssetDatabase.AssetPathToGUID(scenePath);
            projectId = "binding-project-" + Guid.NewGuid().ToString("N");
            sessionId = "binding-session-" + Guid.NewGuid().ToString("N");
            projectUuid = Guid.NewGuid().ToString("D"); epoch = Guid.NewGuid().ToString("D");
            SetContext();
        }

        [TearDown]
        public void TearDown()
        {
            if (!started) return;
            try
            {
                TeamForgeColliderComponentBindings.ClearContext();
                if (replacedEmptyUntitledScene)
                    EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                else
                {
                    if (scene.IsValid() && scene.isLoaded) EditorSceneManager.CloseScene(scene, true);
                    if (previousActive.IsValid() && previousActive.isLoaded) SceneManager.SetActiveScene(previousActive);
                }
                if (!string.IsNullOrEmpty(scenePath)) AssetDatabase.DeleteAsset(scenePath);
                if (AssetDatabase.IsValidFolder(Folder) && AssetDatabase.FindAssets(string.Empty, new[] { Folder }).Length == 0)
                    AssetDatabase.DeleteAsset(Folder);
                foreach (var identity in ownedContexts)
                {
                    SessionState.EraseString(CacheKey + identity);
                    var path = CachePath(identity);
                    if (File.Exists(path)) File.Delete(path);
                    else if (Directory.Exists(path)) Directory.Delete(path);
                }
            }
            finally
            {
                BindingMap().Clear();
                foreach (var entry in savedBindings) BindingMap().Add(entry.Key, entry.Value);
                foreach (var pair in savedFields) pair.Key.SetValue(null, pair.Value);
                started = false; ownedContexts.Clear(); savedFields.Clear(); savedBindings.Clear();
            }
        }

        [Test]
        public void UndoDuringPendingNativeDeleteNeverRemovesRestoredCollider()
        {
            // The already-saved, exact native Collider owner from SetUp is
            // restored locally after an M3 delete was sent. M2's later signed
            // topology frame must not strip this user's Undo Component.
            var witnessField = typeof(TeamForgeHierarchySyncService).GetField(
                "_nativeDeletionWitness", PrivateStatic);
            var prepareTarget = typeof(TeamForgeColliderTopologyTransaction).GetMethod(
                "TryTarget", PrivateStatic);
            Assert.That(witnessField, Is.Not.Null);
            Assert.That(prepareTarget, Is.Not.Null);
            var saved = witnessField.GetValue(null);
            var witness = Activator.CreateInstance(witnessField.FieldType, true);
            const BindingFlags instance = BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public;
            var objectId = "tf:" + Guid.NewGuid().ToString("N");
            witnessField.FieldType.GetField("SceneId", instance).SetValue(witness, sceneId);
            witnessField.FieldType.GetField("ObjectId", instance).SetValue(witness, objectId);
            witnessField.FieldType.GetField("OperationId", instance).SetValue(witness, "sent-native-delete");
            witnessField.FieldType.GetField("Owner", instance).SetValue(witness, owner);
            var row = new TeamForgeColliderComponentCatalogRow
            {
                sceneId = sceneId, objectId = objectId,
                componentId = "tf:c:" + Guid.NewGuid().ToString("N"),
                typeName = "UnityEngine.BoxCollider",
            };
            try
            {
                witnessField.SetValue(null, witness);
                Assert.That(TeamForgeHierarchySyncService.HasLocallyUndonePendingPrimitiveDelete(
                    sceneId, objectId), Is.True);
                Assert.That(TeamForgeHierarchySyncService.HasLocallyUndonePendingPrimitiveDelete(
                    sceneId, "tf:" + Guid.NewGuid().ToString("N")), Is.False);
                var args = new object[] { row, true, new HashSet<EntityId>(), null, null };
                Assert.That((bool)prepareTarget.Invoke(null, args), Is.False);
                Assert.That((string)args[4], Does.Contain("Undo"));
                Assert.That(owner.GetComponent<BoxCollider>(), Is.SameAs(initial),
                    "A later Collider deletion must not destroy or replace a restored native Component.");
            }
            finally { witnessField.SetValue(null, saved); }
        }

        [Test]
        public void NativeCubeCreationPreflightRefusesMiddleInsertionOrExtraLocalRoots()
        {
            // Reuse the already-saved, exact isolated Editor Scene fixture.
            // This catches a Unity Undo that restores a deleted primitive at
            // its OLD middle sibling index. The Coordinator must not commit a
            // create that the same Editor's M3 receipt will refuse afterward.
            var registryField = typeof(TeamForgeHierarchySyncService).GetField("Authoritative", PrivateStatic);
            var preflight = typeof(TeamForgeHierarchySyncService).GetMethod(
                "NativeCreationRootMembershipExact", PrivateStatic);
            Assert.That(registryField, Is.Not.Null);
            Assert.That(preflight, Is.Not.Null);
            var registry = registryField.GetValue(null) as TeamForgeHierarchyRegistry;
            Assert.That(registry, Is.Not.Null);
            Assert.That(TeamForgeObjectIdentity.TryGetGlobalObjectId(owner, out var originalId), Is.True);
            Assert.That(registry.Contains(sceneId, originalId), Is.False,
                "The isolated test Scene cannot reuse a live authoritative GameObject.");
            var native = new GameObject("Unity native Cube creation candidate");
            GameObject unrelated = null;
            try
            {
                registry.Upsert(new TeamForgeHierarchyState
                {
                    SceneId = sceneId, ObjectId = originalId, Name = owner.name,
                    ParentObjectId = string.Empty, SiblingIndex = 0,
                    Transform = TeamForgeTransformState.Capture(owner.transform),
                });
                Assert.That((bool)preflight.Invoke(null, new object[] { sceneId, 1, native }), Is.True,
                    "An exactly appended native root must pass without adding a new protocol.");
                native.transform.SetSiblingIndex(0);
                Assert.That((bool)preflight.Invoke(null, new object[] { sceneId, 0, native }), Is.False,
                    "A restored old middle index may not be sent as a root append.");
                native.transform.SetSiblingIndex(1);
                unrelated = new GameObject("Unshared local sibling");
                Assert.That((bool)preflight.Invoke(null, new object[] { sceneId, 1, native }), Is.False,
                    "A hidden extra local root must block this exact native publish.");
            }
            finally
            {
                if (unrelated != null) UnityEngine.Object.DestroyImmediate(unrelated);
                UnityEngine.Object.DestroyImmediate(native);
                registry.Remove(sceneId, originalId, false);
            }
        }

        [Test]
        public void SavedOwnerWithoutColliderRetainsPreAddMembershipAcrossRepeatedServerSnapshots()
        {
            // An ordinary Inspector Add on an existing empty GameObject must
            // work even when Unity delivers selectionChanged AFTER the add.
            // A later unrelated server snapshot must not absorb that unsent
            // local Collider into the accepted native membership.
            var service = typeof(TeamForgeConnectionService).Assembly.GetType(
                "EunSung.TeamForge.TeamForgeColliderSyncService", true);
            var idField = service.GetField("_sceneId", PrivateStatic);
            var pathField = service.GetField("_scenePath", PrivateStatic);
            var contextField = service.GetField("_nativeBaselineContext", PrivateStatic);
            var ownerField = service.GetField("_observedNativeOwner", PrivateStatic);
            var cacheField = service.GetField("NativeOwnerColliderBaselines", PrivateStatic);
            var witnessesField = service.GetField("NativeColliderWitnesses", PrivateStatic);
            var observedField = service.GetField("ObservedNativeColliders", PrivateStatic);
            var capture = service.GetMethod("CaptureAcceptedNativeColliderWitnesses", PrivateStatic);
            var prime = service.GetMethod("PrimeNativeColliderObservation", PrivateStatic);
            Assert.That(new object[] { idField, pathField, contextField, ownerField,
                cacheField, witnessesField, observedField, capture, prime }, Does.Not.Contain(null));
            var cache = (IDictionary)cacheField.GetValue(null);
            var witnesses = (IDictionary)witnessesField.GetValue(null);
            var observed = (HashSet<EntityId>)observedField.GetValue(null);
            var retained = new List<DictionaryEntry>();
            foreach (DictionaryEntry entry in cache) retained.Add(entry);
            var retainedWitnesses = new List<DictionaryEntry>();
            foreach (DictionaryEntry entry in witnesses) retainedWitnesses.Add(entry);
            var known = new HashSet<EntityId>(observed);
            var originalSceneId = idField.GetValue(null);
            var originalScenePath = pathField.GetValue(null);
            var originalContext = contextField.GetValue(null);
            var originalOwner = ownerField.GetValue(null);
            var originalSelection = Selection.activeObject;
            try
            {
                cache.Clear(); observed.Clear();
                idField.SetValue(null, sceneId);
                pathField.SetValue(null, scenePath);
                contextField.SetValue(null, string.Empty);
                var empty = new GameObject("Saved baseline owner with no Collider");
                Assert.That(EditorSceneManager.SaveScene(scene, scenePath), Is.True);
                capture.Invoke(null, null);
                Assert.That(cache.Contains(empty), Is.True,
                    "Verified saved owners need a before-image even if they have zero Colliders.");
                var initial = (HashSet<EntityId>)cache[empty];
                Assert.That(initial, Is.Empty);
                using (TeamForgeTransformSyncService.SuppressSelectionLock())
                    Selection.activeGameObject = empty;
                var newNative = Undo.AddComponent<SphereCollider>(empty);
                Assert.That(newNative, Is.Not.Null);
                prime.Invoke(null, null); // Simulate the late selectionChanged event.
                Assert.That(observed.Contains(newNative.GetEntityId()), Is.False,
                    "A late selection callback must not classify a newly added Collider as old.");
                capture.Invoke(null, null); // An unrelated accepted server snapshot.
                Assert.That(((HashSet<EntityId>)cache[empty]).Contains(newNative.GetEntityId()), Is.False,
                    "A remote snapshot may not consume an unsent native Inspector change.");
                prime.Invoke(null, null);
                Assert.That(observed.Contains(newNative.GetEntityId()), Is.False);
            }
            finally
            {
                using (TeamForgeTransformSyncService.SuppressSelectionLock())
                    Selection.activeObject = originalSelection;
                idField.SetValue(null, originalSceneId);
                pathField.SetValue(null, originalScenePath);
                contextField.SetValue(null, originalContext);
                ownerField.SetValue(null, originalOwner);
                cache.Clear();
                foreach (var entry in retained) cache.Add(entry.Key, entry.Value);
                witnesses.Clear();
                foreach (var entry in retainedWitnesses) witnesses.Add(entry.Key, entry.Value);
                observed.Clear(); observed.UnionWith(known);
            }
        }

        [Test]
        public void SameTypeLogicalComponentsKeepDistinctCanonicalIdsDuringDirtyPropertyEdits()
        {
            var first = owner.AddComponent<BoxCollider>();
            var second = owner.AddComponent<BoxCollider>();
            var a = LogicalRow(); var b = LogicalRow();
            Assert.That(TeamForgeColliderComponentBindings.TryBind(a, first, out var error), Is.True, error);
            Assert.That(TeamForgeColliderComponentBindings.TryBind(b, second, out error), Is.True, error);
            var center = Property(a);
            Assert.That(TeamForgeColliderProperty.TryRead(center, out var actual, out error), Is.True, error);
            Assert.That(actual.ComponentId, Is.EqualTo(a.componentId));
            Assert.That(TeamForgeColliderProperty.TryApply(actual, actual.WithValue(new Vector3(3f, 4f, 5f)), out error), Is.True, error);
            Assert.That(first.center, Is.EqualTo(new Vector3(3f, 4f, 5f)));
            Assert.That(second.center, Is.EqualTo(Vector3.zero));
            Assert.That(initial.center, Is.EqualTo(Vector3.zero), "An unbound local/saved sibling is never adopted by type or index.");
            Assert.That(TeamForgeColliderComponentBindings.TryBind(LogicalRow(), first, out error), Is.False,
                "One native Component cannot acquire a second canonical runtime identity.");
            Assert.That(TeamForgeColliderComponentBindings.TryBind(a, second, out error), Is.False,
                "An existing canonical identity cannot be rebound to a different live sibling.");
        }

        [TestCase(false)]
        [TestCase(true)]
        public void SavedAliasesResolveExactLogicalComponentsAfterSceneReopenAndDiskReload(bool durableRestart)
        {
            var durableSessionId = Guid.NewGuid().ToString("D");
            if (durableRestart) SetDurableContext(durableSessionId);
            var first = owner.AddComponent<BoxCollider>(); first.center = new Vector3(1f, 2f, 3f);
            var second = owner.AddComponent<BoxCollider>(); second.center = new Vector3(7f, 8f, 9f);
            var a = LogicalRow(); var b = LogicalRow();
            Assert.That(TeamForgeColliderComponentBindings.TryBind(a, first, out var error), Is.True, error);
            Assert.That(TeamForgeColliderComponentBindings.TryBind(b, second, out error), Is.True, error);
            Assert.That(EditorSceneManager.SaveScene(scene, scenePath), Is.True);
            Assert.That(TeamForgeColliderComponentBindings.RefreshSavedBindings(out error), Is.True, error);
            var identity = TeamForgeColliderComponentBindings.ContextIdentity;
            Assert.That(File.Exists(CachePath(identity)), Is.True);
            TeamForgeColliderComponentBindings.ClearContext();
            SessionState.EraseString(CacheKey + identity); // Exercise the bounded on-disk loader, not the session fast path.
            if (replacedEmptyUntitledScene)
            {
                // A replacement fixture Scene is the only loaded Scene.
                // Unity refuses CloseScene(lastScene), so reopen it in
                // Single mode to destroy the original native instances.
                scene = EditorSceneManager.OpenScene(scenePath, OpenSceneMode.Single);
            }
            else
            {
                EditorSceneManager.CloseScene(scene, true);
                scene = EditorSceneManager.OpenScene(scenePath, OpenSceneMode.Additive);
            }
            SceneManager.SetActiveScene(scene);
            if (durableRestart)
            {
                epoch = Guid.NewGuid().ToString("D");
                SetDurableContext(durableSessionId);
                Assert.That(TeamForgeColliderComponentBindings.ContextIdentity, Is.EqualTo(identity),
                    "A new authority epoch retains aliases only for the same verified durable Session.");
            }
            else SetContext();
            Assert.That(first == null && second == null, Is.True);
            Assert.That(Resolve(a, out var restoredA), Is.True);
            Assert.That(Resolve(b, out var restoredB), Is.True);
            Assert.That(restoredA, Is.Not.SameAs(restoredB));
            Assert.That(((BoxCollider)restoredA).center, Is.EqualTo(new Vector3(1f, 2f, 3f)));
            Assert.That(((BoxCollider)restoredB).center, Is.EqualTo(new Vector3(7f, 8f, 9f)));
            Assert.That(TeamForgeColliderProperty.TryRead(Property(a), out var actual, out error), Is.True, error);
            Assert.That(actual.ComponentId, Is.EqualTo(a.componentId), "Saving never substitutes a peer-local file ID on the wire.");
        }

        [Test]
        public void DurableAliasesCannotCrossStableSessionOrProjectSessionBoundaries()
        {
            var durableSessionId = Guid.NewGuid().ToString("D");
            SetDurableContext(durableSessionId);
            var native = owner.AddComponent<BoxCollider>(); var row = LogicalRow();
            Assert.That(TeamForgeColliderComponentBindings.TryBind(row, native, out var error), Is.True, error);
            Assert.That(TeamForgeColliderComponentBindings.RefreshSavedBindings(out error), Is.True, error);
            var identity = TeamForgeColliderComponentBindings.ContextIdentity;
            SetDurableContext(Guid.NewGuid().ToString("D"));
            Assert.That(TeamForgeColliderComponentBindings.ContextIdentity, Is.Not.EqualTo(identity));
            Assert.That(Resolve(row, out _), Is.False);
            Assert.That(TeamForgeColliderComponentBindings.SetDurableContext(projectId, sessionId + "-other", projectUuid,
                sceneId, epoch, durableSessionId, out error), Is.True, error);
            RememberContext();
            Assert.That(Resolve(row, out _), Is.False);
            Assert.That(TeamForgeColliderComponentBindings.SetDurableContext(projectId, sessionId, Guid.NewGuid().ToString("D"),
                sceneId, epoch, durableSessionId, out error), Is.True, error);
            RememberContext();
            Assert.That(Resolve(row, out _), Is.False);
            epoch = Guid.NewGuid().ToString("D");
            SetDurableContext(durableSessionId);
            Assert.That(Resolve(row, out var restored), Is.True);
            Assert.That(restored, Is.SameAs(native), "An unsaved accepted target is recovered by its exact validated local alias.");
        }

        [Test]
        public void SessionCheckpointRecoversAnUnsavedNativeBindingAcrossManagedStateReload()
        {
            var native = owner.AddComponent<BoxCollider>();
            var row = LogicalRow();
            Assert.That(TeamForgeColliderComponentBindings.TryBind(row, native, out var error), Is.True, error);
            Assert.That(TeamForgeColliderComponentBindings.RefreshSavedBindings(out error), Is.True, error);
            var entity = native.GetEntityId();
            TeamForgeColliderComponentBindings.ClearContext();
            SetContext();
            Assert.That(Resolve(row, out var restored), Is.True);
            Assert.That(restored.GetEntityId(), Is.EqualTo(entity));
            Assert.That(restored, Is.SameAs(native));
        }

        [Test]
        public void RemovedIdentityCannotBeReadOrRetargetedButExactApprovedRestoreCanReuseItsAlias()
        {
            var native = owner.AddComponent<BoxCollider>();
            var row = LogicalRow();
            Assert.That(TeamForgeColliderComponentBindings.TryBind(row, native, out var error), Is.True, error);
            Assert.That(TeamForgeColliderComponentBindings.Forget(row, out error), Is.True, error);
            Assert.That(Resolve(row, out _), Is.False);
            Assert.That(TeamForgeColliderComponentBindings.TryResolveForRemoval(row, out var removed, out error), Is.True, error);
            Assert.That(removed, Is.SameAs(native));
            var wrongType = row.Copy(); wrongType.typeName = "UnityEngine.SphereCollider";
            Assert.That(TeamForgeColliderComponentBindings.CanCreateMissing(wrongType, out error), Is.False);
            Assert.That(TeamForgeColliderComponentBindings.TryBind(wrongType, owner.AddComponent<SphereCollider>(), out error), Is.False);
            Assert.That(TeamForgeColliderComponentBindings.TryBind(row, native, out error), Is.True, error);
            Assert.That(Resolve(row, out var restored), Is.True);
            Assert.That(restored, Is.SameAs(native));
        }

        [Test]
        public void AnotherSessionOrEpochCannotReuseLogicalAliasesAndM1KeepsItsStrictSavedLookup()
        {
            var row = LogicalRow(); var native = owner.AddComponent<BoxCollider>();
            Assert.That(TeamForgeColliderComponentBindings.TryBind(row, native, out var error), Is.True, error);
            Assert.That(TeamForgeColliderComponentBindings.RefreshSavedBindings(out error), Is.True, error);
            Assert.That(TeamForgeColliderComponentBindings.SetContext(projectId, sessionId + "-other", projectUuid,
                sceneId, epoch, out error), Is.True, error);
            RememberContext();
            Assert.That(Resolve(row, out _), Is.False);
            Assert.That(TeamForgeColliderComponentBindings.SetContext(projectId, sessionId, projectUuid,
                sceneId, Guid.NewGuid().ToString("D"), out error), Is.True, error);
            RememberContext();
            Assert.That(Resolve(row, out _), Is.False);
            TeamForgeColliderComponentBindings.ClearContext();
            Assert.That(Resolve(row, out _), Is.False);
            Assert.That(TeamForgeWp6ComponentIdentity.TryCapture(initial, out var saved, out error), Is.True, error);
            Assert.That(TeamForgeColliderComponentBindings.TryResolve(saved.SceneId, saved.ObjectId, saved.ComponentId,
                saved.TypeName, out var legacy, out error), Is.True, error);
            Assert.That(legacy, Is.SameAs(initial));
        }

        [TestCase(false)]
        [TestCase(true)]
        public void CorruptOrOversizedCacheFailsClosedAndExplicitRetryLoadsOnlyTheRepairedExactCache(bool oversized)
        {
            var row = LogicalRow(); var native = owner.AddComponent<BoxCollider>();
            Assert.That(TeamForgeColliderComponentBindings.TryBind(row, native, out var error), Is.True, error);
            Assert.That(EditorSceneManager.SaveScene(scene, scenePath), Is.True);
            Assert.That(TeamForgeColliderComponentBindings.RefreshSavedBindings(out error), Is.True, error);
            var identity = TeamForgeColliderComponentBindings.ContextIdentity;
            var path = CachePath(identity); var valid = File.ReadAllBytes(path);
            TeamForgeColliderComponentBindings.ClearContext(); SessionState.EraseString(CacheKey + identity);
            if (oversized) { using (var stream = new FileStream(path, FileMode.Create, FileAccess.Write)) stream.SetLength(2 * 1024 * 1024 + 1); }
            else File.WriteAllText(path, "{\"payload\":\"truncated\",\"checksum\":\"invalid\"}");
            Assert.That(TeamForgeColliderComponentBindings.SetContext(projectId, sessionId, projectUuid, sceneId, epoch, out error), Is.False);
            Assert.That(TeamForgeColliderComponentBindings.IsActiveFor(sceneId), Is.False);
            Assert.That(Resolve(row, out _), Is.False);
            Assert.That(TeamForgeColliderComponentBindings.SetContext(projectId, sessionId, projectUuid, sceneId, epoch, out error), Is.False,
                "Repeating Join cannot turn an unreadable cache into accepted empty aliases.");
            Assert.That(native != null, Is.True);
            File.WriteAllBytes(path, valid);
            Assert.That(TeamForgeColliderComponentBindings.SetContext(projectId, sessionId, projectUuid, sceneId, epoch, out error), Is.True, error);
            Assert.That(Resolve(row, out var restored), Is.True);
            Assert.That(restored, Is.SameAs(native));
        }

        [Test]
        public void FailedDiskCheckpointKeepsTheNewestExactAliasForManagedReload()
        {
            var row = LogicalRow(); var native = owner.AddComponent<BoxCollider>();
            Assert.That(TeamForgeColliderComponentBindings.TryBind(row, native, out var error), Is.True, error);
            Assert.That(TeamForgeColliderComponentBindings.RefreshSavedBindings(out error), Is.True, error);
            var identity = TeamForgeColliderComponentBindings.ContextIdentity;
            var path = CachePath(identity);
            File.Delete(path); Directory.CreateDirectory(path); // Deterministic atomic-replace failure on every OS.
            Assert.That(TeamForgeColliderComponentBindings.RefreshSavedBindings(out error), Is.False);
            Assert.That(error, Does.Contain("Editor session"));
            TeamForgeColliderComponentBindings.ClearContext(); SetContext();
            Assert.That(Resolve(row, out var restored), Is.True);
            Assert.That(restored, Is.SameAs(native));
            Directory.Delete(path);
        }

        [Test]
        public void SavedComponentIdCannotMasqueradeAsItsGameObjectOwner()
        {
            Assert.That(TeamForgeWp6ComponentIdentity.TryCapture(initial, out var saved, out var error), Is.True, error);
            Assert.That(TeamForgeColliderComponentBindings.TryResolveOwner(sceneId, saved.ComponentId, out _, out _), Is.False,
                "The general ObjectIdentity convenience resolver accepts Component→owner, but structural authority must not.");
            var extra = owner.AddComponent<BoxCollider>();
            var alias = new TeamForgeColliderComponentCatalogRow { sceneId = sceneId, objectId = saved.ObjectId,
                componentId = saved.ComponentId, typeName = saved.TypeName };
            Assert.That(TeamForgeColliderComponentBindings.TryBind(alias, extra, out _), Is.False,
                "An existing saved identity must not be redirected to an unbound local sibling.");
        }

        private TeamForgeColliderComponentCatalogRow LogicalRow() => new TeamForgeColliderComponentCatalogRow
        {
            sceneId = sceneId, objectId = GlobalObjectId.GetGlobalObjectIdSlow(owner).ToString(),
            componentId = "tf:c:" + Guid.NewGuid().ToString("N"), typeName = "UnityEngine.BoxCollider", serverRevision = 1,
        };
        private static TeamForgeColliderProperty Property(TeamForgeColliderComponentCatalogRow row) =>
            new TeamForgeColliderProperty(row.sceneId, row.objectId, row.componentId, row.typeName,
                "m_Center", "vector3", false, 0f, Vector3.zero);
        private static bool Resolve(TeamForgeColliderComponentCatalogRow row, out Component component) =>
            TeamForgeColliderComponentBindings.TryResolve(row.sceneId, row.objectId, row.componentId, row.typeName, out component, out _);
        private void SetContext()
        {
            Assert.That(TeamForgeColliderComponentBindings.SetContext(projectId, sessionId, projectUuid, sceneId, epoch, out var error), Is.True, error);
            RememberContext();
        }
        private void SetDurableContext(string durableSessionId)
        {
            Assert.That(TeamForgeColliderComponentBindings.SetDurableContext(projectId, sessionId, projectUuid,
                sceneId, epoch, durableSessionId, out var error), Is.True, error);
            RememberContext();
        }
        private void RememberContext()
        {
            var identity = TeamForgeColliderComponentBindings.ContextIdentity;
            if (!ownedContexts.Contains(identity)) ownedContexts.Add(identity);
        }
        private static IDictionary BindingMap() => (IDictionary)typeof(TeamForgeColliderComponentBindings).GetField("Bindings", PrivateStatic).GetValue(null);
        private static string CachePath(string identity) => Path.Combine(Directory.GetParent(Application.dataPath).FullName,
            "Library", "TeamForge", "ColliderBindings", identity + ".json");
    }
}

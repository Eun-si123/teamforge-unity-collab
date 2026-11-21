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
    public sealed class TeamForgeColliderTopologyTransactionTests
    {
        private const string Folder = "Assets/__TeamForgeColliderTopologyTests";
        private const string Project = "topology-fixture-project";
        private static readonly TeamForgeColliderComponentCatalogRow[] NoComponents =
            Array.Empty<TeamForgeColliderComponentCatalogRow>();
        private static readonly TeamForgeColliderProperty[] NoProperties = Array.Empty<TeamForgeColliderProperty>();
        private RegistryScope scope;
        private string scenePath;
        private Scene scene;
        private GameObject owner;
        private string sceneId;
        private string sessionId;
        private string projectUuid;
        private string epoch;
        private readonly List<string> ownContextIds = new List<string>();

        [SetUp]
        public void SetUp()
        {
            for (var index = 0; index < SceneManager.sceneCount; index++)
                if (SceneManager.GetSceneAt(index).isDirty)
                    Assert.Ignore("Topology tests require clean open Scenes; unsaved work was preserved.");
            if (TeamForgeConnectionService.State != TeamForgeConnectionState.Disconnected)
                Assert.Ignore("Topology tests require a disconnected Editor; the current connection was preserved.");
            scope = new RegistryScope();
            if (!AssetDatabase.IsValidFolder(Folder)) AssetDatabase.CreateFolder("Assets", "__TeamForgeColliderTopologyTests");
            scenePath = Folder + "/" + Guid.NewGuid().ToString("N") + ".unity";
            scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            owner = new GameObject("Exact topology fixture owner");
            Assert.That(EditorSceneManager.SaveScene(scene, scenePath), Is.True);
            sceneId = AssetDatabase.AssetPathToGUID(scenePath);
            sessionId = "topology-" + Guid.NewGuid().ToString("N");
            projectUuid = Guid.NewGuid().ToString("D");
            epoch = Guid.NewGuid().ToString("D");
            SetContext(epoch);
        }

        [TearDown]
        public void TearDown()
        {
            if (scope == null) return;
            try
            {
                TeamForgeColliderComponentBindings.ClearContext();
                EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                if (!string.IsNullOrEmpty(scenePath)) AssetDatabase.DeleteAsset(scenePath);
                if (AssetDatabase.IsValidFolder(Folder) && AssetDatabase.FindAssets(string.Empty, new[] { Folder }).Length == 0)
                    AssetDatabase.DeleteAsset(Folder);
                foreach (var contextId in ownContextIds)
                {
                    var path = ContextPath(contextId);
                    if (File.Exists(path)) File.Delete(path);
                    if (Directory.Exists(path)) Directory.Delete(path);
                    SessionState.EraseString(StateKey() + contextId);
                }
                ownContextIds.Clear();
            }
            finally { scope.Dispose(); scope = null; }
        }

        [Test]
        public void NativeUnityCubeAndSphereAreIdentifiedByExactEngineComponentsNotTheirNames()
        {
            var cube = GameObject.CreatePrimitive(PrimitiveType.Cube);
            var sphere = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            try
            {
                cube.name = "Imported Looking Name";
                Assert.That(TeamForgePrimitiveTemplateRuntime.TryIdentifyNativeDefault(cube, out var cubeTemplate),
                    Is.True, "A genuinely built-in Cube should not require a TeamForge-specific creation menu. " +
                    DescribePrimitive(cube));
                Assert.That(cubeTemplate, Is.EqualTo(TeamForgePrimitiveTemplateRuntime.Cube));
                Assert.That(TeamForgePrimitiveTemplateRuntime.TryIdentifyNativeDefault(sphere, out var sphereTemplate),
                    Is.True, "A genuinely built-in Sphere should be recognized by its actual Component/Mesh.");
                Assert.That(sphereTemplate, Is.EqualTo(TeamForgePrimitiveTemplateRuntime.Sphere));
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(cube);
                UnityEngine.Object.DestroyImmediate(sphere);
            }
        }

        [Test]
        public void NativePrimitiveAutoDetectRejectsCustomVisualsAndExtraComponents()
        {
            var cube = GameObject.CreatePrimitive(PrimitiveType.Cube);
            try
            {
                Assert.That(TeamForgePrimitiveTemplateRuntime.TryIdentifyNativeDefault(cube, out _),
                    Is.True, DescribePrimitive(cube));
                var renderer = cube.GetComponent<MeshRenderer>();
                var material = renderer.sharedMaterial;
                renderer.sharedMaterial = null;
                Assert.That(TeamForgePrimitiveTemplateRuntime.TryIdentifyNativeDefault(cube, out _), Is.False,
                    "An imported or changed Material must not be silently substituted with the engine default.");
                renderer.sharedMaterial = material;

                var extra = cube.AddComponent<SphereCollider>();
                Assert.That(TeamForgePrimitiveTemplateRuntime.TryIdentifyNativeDefault(cube, out _), Is.False,
                    "A user-supplied Component must not be silently discarded.");
                UnityEngine.Object.DestroyImmediate(extra);

                var box = cube.GetComponent<BoxCollider>();
                box.center = Vector3.one;
                Assert.That(TeamForgePrimitiveTemplateRuntime.TryIdentifyNativeDefault(cube, out _), Is.False,
                    "Edited Collider geometry needs its own authoritative property operation.");
            }
            finally { UnityEngine.Object.DestroyImmediate(cube); }
        }

        private static string DescribePrimitive(GameObject target)
        {
            var parts = target.GetComponents<Component>();
            var renderer = target.GetComponent<MeshRenderer>();
            var filter = target.GetComponent<MeshFilter>();
            var box = target.GetComponent<BoxCollider>();
            var reference = Resources.GetBuiltinResource<Material>("Default-Material.mat");
            var cube = Resources.GetBuiltinResource<Mesh>("Cube.fbx");
            return "components=" + string.Join(",", Array.ConvertAll(parts,
                part => part == null ? "(null)" : part.GetType().Name)) +
                "; mesh=" + (filter?.sharedMesh == null ? "null" : filter.sharedMesh.name) +
                "; sameBuiltinMesh=" + (filter?.sharedMesh == cube) +
                "; material=" + (renderer?.sharedMaterial == null ? "null" : renderer.sharedMaterial.name) +
                "; matAssetPath=" + (renderer?.sharedMaterial == null ? "null" :
                    AssetDatabase.GetAssetPath(renderer.sharedMaterial)) +
                "; builtinMaterial=" + (reference == null ? "null" : reference.name) +
                "; sameBuiltinMaterial=" + (renderer?.sharedMaterial == reference) +
                "; isTrigger=" + (box?.isTrigger.ToString() ?? "null") +
                "; offset=" + (box?.contactOffset.ToString() ?? "null") +
                "; center=" + (box?.center.ToString() ?? "null") +
                "; size=" + (box?.size.ToString() ?? "null");
        }

        [Test]
        public void TwoLogicalCollidersAreDistinctAndNeverAdoptAnUnknownLocalSibling()
        {
            var localOnly = owner.AddComponent<BoxCollider>();
            localOnly.center = new Vector3(9f, 8f, 7f);
            var first = Logical("UnityEngine.BoxCollider");
            var second = Logical("UnityEngine.BoxCollider");
            var plan = Prepare(new[] { first, second }, NoComponents);
            Assert.That(plan.Apply(out var error), Is.True, error);
            Assert.That(plan.Commit(out error), Is.True, error);
            Assert.That(Resolve(first), Is.Not.SameAs(localOnly));
            Assert.That(Resolve(second), Is.Not.SameAs(localOnly));
            Assert.That(Resolve(first), Is.Not.SameAs(Resolve(second)));
            Assert.That(owner.GetComponents<BoxCollider>(), Has.Length.EqualTo(3));
            Assert.That(localOnly.center, Is.EqualTo(new Vector3(9f, 8f, 7f)));

            var tombstone = first.Copy();
            tombstone.serverRevision = 2;
            var remove = Prepare(new[] { second }, new[] { tombstone });
            Assert.That(remove.Apply(out error), Is.True, error);
            Assert.That(remove.Commit(out error), Is.True, error);
            Assert.That(EditorSceneManager.SaveScene(scene, scenePath), Is.True);
            var localOnlySavedId = GlobalObjectId.GetGlobalObjectIdSlow(localOnly);
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            scene = EditorSceneManager.OpenScene(scenePath, OpenSceneMode.Single);
            TeamForgeColliderComponentBindings.ClearContext();
            SetContext(epoch);
            Assert.That(TeamForgeColliderComponentBindings.TryResolveOwner(sceneId, second.objectId,
                out owner, out error), Is.True, error);

            var repeated = Prepare(new[] { second }, new[] { tombstone });
            Assert.That(repeated.Apply(out error), Is.True, error);
            Assert.That(repeated.Commit(out error), Is.True, error);
            var remaining = (BoxCollider)Resolve(second);
            Assert.That(remaining.center, Is.EqualTo(Vector3.zero));
            Assert.That(remaining.size, Is.EqualTo(Vector3.one));
            Assert.That(TeamForgeColliderComponentBindings.TryResolve(first.sceneId, first.objectId,
                first.componentId, first.typeName, out _, out _), Is.False,
                "Saving/reopening and replaying a tombstone must not resurrect its exact removed logical identity.");
            var unshared = GlobalObjectId.GlobalObjectIdentifierToObjectSlow(localOnlySavedId) as BoxCollider;
            Assert.That(unshared != null, Is.True);
            Assert.That(unshared.center, Is.EqualTo(new Vector3(9f, 8f, 7f)));
            Assert.That(owner.GetComponents<BoxCollider>(), Has.Length.EqualTo(2),
                "Only the accepted remaining identity and the unrelated local sibling may remain.");
        }

        [Test]
        public void DuplicateCatalogIsRejectedBeforeAnyNativeOrBindingMutation()
        {
            var first = Logical("UnityEngine.BoxCollider");
            var second = first.Copy();
            Assert.That(TeamForgeColliderTopologyTransaction.TryPrepare(new[] { first, second }, NoComponents,
                Rows(first, second), NoProperties, out _, out var error), Is.False);
            Assert.That(error, Does.Contain("duplicated"));
            Assert.That(owner.GetComponents<Collider>(), Is.Empty);
            Assert.That(TeamForgeColliderComponentBindings.HasBinding(first), Is.False);
        }

        [Test]
        public void PreparationCopiesCallerRowsAndDoesNotRetargetWhenTheirFieldsChange()
        {
            var original = Logical("UnityEngine.BoxCollider");
            var accepted = original.Copy();
            var plan = Prepare(new[] { original }, NoComponents);
            original.typeName = "UnityEngine.SphereCollider";
            original.objectId = "not-an-owner";
            Assert.That(plan.Apply(out var error), Is.True, error);
            Assert.That(plan.Commit(out error), Is.True, error);
            Assert.That(Resolve(accepted).GetType(), Is.EqualTo(typeof(BoxCollider)));
            Assert.That(owner.GetComponents<SphereCollider>(), Is.Empty);
        }

        [Test]
        public void LastRequiredColliderCannotBeRemoved()
        {
            var box = owner.AddComponent<BoxCollider>();
            var dependency = owner.AddComponent<TeamForgeRequiresBoxColliderProbe>();
            Assert.That(EditorSceneManager.SaveScene(scene, scenePath), Is.True);
            var saved = Saved(box);
            Assert.That(TeamForgeColliderTopologyTransaction.TryPrepare(NoComponents, new[] { saved },
                NoProperties, NoProperties, out _, out var error), Is.False);
            Assert.That(error, Does.Contain("RequireComponent"));
            Assert.That(box != null && dependency != null, Is.True);
            Assert.That(owner.GetComponents<BoxCollider>(), Has.Length.EqualTo(1));
        }

        [Test]
        public void NativeTargetDestroyedAfterPreflightIsNotReplacedByTheOldPlan()
        {
            var native = owner.AddComponent<BoxCollider>();
            var logical = Logical("UnityEngine.BoxCollider");
            Assert.That(TeamForgeColliderComponentBindings.TryBind(logical, native, out var error), Is.True, error);
            var plan = Prepare(new[] { logical }, NoComponents);
            UnityEngine.Object.DestroyImmediate(native);
            Assert.That(plan.Apply(out error), Is.False);
            Assert.That(owner.GetComponents<BoxCollider>(), Is.Empty,
                "A newly missing target needs a fresh authenticated snapshot/preflight, not a stale plan.");
        }

        [Test]
        public void ContactOffsetChangedAfterPreflightRefusesRemovalWithoutLosingLocalWork()
        {
            var native = owner.AddComponent<BoxCollider>();
            native.contactOffset = 0.07f;
            Assert.That(EditorSceneManager.SaveScene(scene, scenePath), Is.True);
            var saved = Saved(native);
            var plan = Prepare(NoComponents, new[] { saved });
            native.contactOffset = 0.13f;
            Assert.That(plan.Apply(out var error), Is.False);
            Assert.That(native != null, Is.True);
            Assert.That(native.contactOffset, Is.EqualTo(0.13f).Within(0.000001f));
        }

        [Test]
        public void ContextChangeAfterPreflightCannotCreateAnyComponent()
        {
            var plan = Prepare(new[] { Logical("UnityEngine.SphereCollider") }, NoComponents);
            SetContext(Guid.NewGuid().ToString("D"));
            Assert.That(plan.Apply(out var error), Is.False);
            Assert.That(error, Does.Contain("context"));
            Assert.That(owner.GetComponents<Collider>(), Is.Empty);
        }

        [Test]
        public void LaterFieldConflictRollsBackTopologyAndPreservesUnsharedColliderFields()
        {
            var old = owner.AddComponent<BoxCollider>();
            old.contactOffset = 0.07f;
            old.enabled = false;
            old.size = new Vector3(2f, 3f, 4f);
            var sibling = owner.AddComponent<BoxCollider>();
            sibling.center = new Vector3(9f, 8f, 7f);
            Assert.That(EditorSceneManager.SaveScene(scene, scenePath), Is.True);
            var saved = Saved(old);
            var added = Logical("UnityEngine.SphereCollider", 2);
            var plan = Prepare(new[] { added }, new[] { saved });
            Assert.That(plan.Apply(out var error), Is.True, error);
            Assert.That(old == null, Is.True);
            var created = (SphereCollider)Resolve(added);
            var radius = Rows(added)[2];
            created.radius = 3f;
            Assert.That(TeamForgeColliderProperty.TryApply(radius, radius.WithValue(4f), out _), Is.False,
                "This represents a later property CAS failure after successful topology application.");
            Assert.That(plan.Rollback(out error), Is.True, error);
            var restored = (BoxCollider)Resolve(saved);
            Assert.That(restored.contactOffset, Is.EqualTo(0.07f).Within(0.000001f));
            Assert.That(restored.enabled, Is.False);
            Assert.That(restored.size, Is.EqualTo(new Vector3(2f, 3f, 4f)));
            Assert.That(created == null, Is.True);
            Assert.That(sibling.center, Is.EqualTo(new Vector3(9f, 8f, 7f)));
            Assert.That(owner.GetComponents<BoxCollider>(), Has.Length.EqualTo(2));
        }

        [Test]
        public void RollbackRestoresRequiredOriginalBeforeRemovingItsReplacement()
        {
            var old = owner.AddComponent<BoxCollider>();
            owner.AddComponent<TeamForgeRequiresBoxColliderProbe>();
            old.contactOffset = 0.06f;
            Assert.That(EditorSceneManager.SaveScene(scene, scenePath), Is.True);
            var saved = Saved(old);
            var replacement = Logical("UnityEngine.BoxCollider", 2);
            var plan = Prepare(new[] { replacement }, new[] { saved });
            Assert.That(plan.Apply(out var error), Is.True, error);
            Assert.That(old == null, Is.True);
            Assert.That(plan.Rollback(out error), Is.True, error);
            Assert.That(owner.GetComponents<BoxCollider>(), Has.Length.EqualTo(1));
            Assert.That(((BoxCollider)Resolve(saved)).contactOffset, Is.EqualTo(0.06f).Within(0.000001f));
            Assert.That(owner.GetComponent<TeamForgeRequiresBoxColliderProbe>() != null, Is.True);
        }

        [Test]
        public void CommittedRemovalCanRestoreItsExactLocalUnsupportedBeforeImage()
        {
            var old = owner.AddComponent<BoxCollider>();
            old.contactOffset = 0.08f;
            old.enabled = false;
            Assert.That(EditorSceneManager.SaveScene(scene, scenePath), Is.True);
            var saved = Saved(old);
            var remove = Prepare(NoComponents, new[] { saved });
            Assert.That(remove.Apply(out var error), Is.True, error);
            Assert.That(remove.Commit(out error), Is.True, error);
            Assert.That(owner.GetComponents<BoxCollider>(), Is.Empty);
            saved.serverRevision = 3;
            var restore = Prepare(new[] { saved }, NoComponents);
            Assert.That(restore.Apply(out error), Is.True, error);
            Assert.That(restore.Commit(out error), Is.True, error);
            var restored = (BoxCollider)Resolve(saved);
            Assert.That(restored.contactOffset, Is.EqualTo(0.08f).Within(0.000001f));
            Assert.That(restored.enabled, Is.False);
        }

        [Test]
        public void RemoveLastEmptySnapshotAndReaddKeepExactIdentities()
        {
            var box = owner.AddComponent<BoxCollider>();
            Assert.That(EditorSceneManager.SaveScene(scene, scenePath), Is.True);
            var saved = Saved(box);
            var remove = Prepare(NoComponents, new[] { saved });
            Assert.That(remove.Apply(out var error), Is.True, error);
            Assert.That(remove.Commit(out error), Is.True, error);
            var empty = Prepare(NoComponents, new[] { saved });
            Assert.That(empty.Apply(out error), Is.True, error);
            Assert.That(empty.Commit(out error), Is.True, error);
            var added = Logical("UnityEngine.SphereCollider", 3);
            var readd = Prepare(new[] { added }, new[] { saved });
            Assert.That(readd.Apply(out error), Is.True, error);
            Assert.That(readd.Commit(out error), Is.True, error);
            Assert.That(Resolve(added).GetType(), Is.EqualTo(typeof(SphereCollider)));
            Assert.That(owner.GetComponents<Collider>(), Has.Length.EqualTo(1));
        }

        [Test]
        public void RetainedComponentTombstoneAcceptsAnAuthoritativelyDeletedAbsentOwner()
        {
            var box = owner.AddComponent<BoxCollider>();
            Assert.That(EditorSceneManager.SaveScene(scene, scenePath), Is.True);
            var removed = Saved(box);
            MarkAuthoritativelyDeleted(removed.objectId);
            UnityEngine.Object.DestroyImmediate(owner);
            Assert.That(TeamForgeObjectIdentity.TryResolveGameObject(removed.objectId, out _), Is.False);
            var plan = Prepare(NoComponents, new[] { removed });
            Assert.That(plan.Apply(out var error), Is.True, error);
            Assert.That(plan.Commit(out error), Is.True, error);
            Assert.That(scene.IsValid() && scene.isLoaded, Is.True);
        }

        [Test]
        public void AbsentOwnerWithoutAnAuthoritativeTombstoneRemainsAConflict()
        {
            var box = owner.AddComponent<BoxCollider>();
            Assert.That(EditorSceneManager.SaveScene(scene, scenePath), Is.True);
            var removed = Saved(box);
            UnityEngine.Object.DestroyImmediate(owner);
            Assert.That(TeamForgeColliderTopologyTransaction.TryPrepare(NoComponents, new[] { removed },
                NoProperties, NoProperties, out _, out var error), Is.False);
            Assert.That(error, Does.Contain("GameObject"));
        }

        [Test]
        public void AuthoritativeTombstoneCannotHideALiveOwnerRejectedByExactIdentityValidation()
        {
            var box = owner.AddComponent<BoxCollider>();
            var other = owner.AddComponent<BoxCollider>();
            Assert.That(EditorSceneManager.SaveScene(scene, scenePath), Is.True);
            var removed = Saved(box);
            // The permissive legacy object lookup can resolve a Component ID
            // to its GameObject; the strict binding owner check must reject it.
            removed.objectId = GlobalObjectId.GetGlobalObjectIdSlow(other).ToString();
            MarkAuthoritativelyDeleted(removed.objectId);
            Assert.That(TeamForgeObjectIdentity.TryResolveGameObject(removed.objectId, out var live), Is.True);
            Assert.That(live, Is.SameAs(owner));
            Assert.That(TeamForgeColliderTopologyTransaction.TryPrepare(NoComponents, new[] { removed },
                NoProperties, NoProperties, out _, out _), Is.False);
            Assert.That(box != null && other != null, Is.True);
        }

        [Test]
        public void FailedDiskCheckpointThenRollbackKeepsCorrectDomainReloadAliases()
        {
            var old = owner.AddComponent<BoxCollider>();
            old.contactOffset = 0.09f;
            Assert.That(EditorSceneManager.SaveScene(scene, scenePath), Is.True);
            var saved = Saved(old);
            var added = Logical("UnityEngine.SphereCollider", 2);
            var plan = Prepare(new[] { added }, new[] { saved });
            Assert.That(plan.Apply(out var error), Is.True, error);
            var blockedPath = ContextPath(TeamForgeColliderComponentBindings.ContextIdentity);
            Directory.CreateDirectory(Path.GetDirectoryName(blockedPath));
            // sceneSaved may already have checkpointed this fixture's empty
            // context. Replace only that task-owned cache with the IO fault.
            if (File.Exists(blockedPath)) File.Delete(blockedPath);
            Directory.CreateDirectory(blockedPath); // Deterministic task-owned IO fault.
            Assert.That(plan.Commit(out _), Is.False);
            Assert.That(plan.Rollback(out error), Is.False,
                "The native rollback succeeds but persistent IO is still blocked and must be reported.");
            Assert.That(error, Does.Contain("checkpoint"));
            TeamForgeColliderComponentBindings.ClearContext();
            SetContext(epoch);
            Assert.That(((BoxCollider)Resolve(saved)).contactOffset, Is.EqualTo(0.09f).Within(0.000001f));
            Assert.That(TeamForgeColliderComponentBindings.TryResolve(added.sceneId, added.objectId, added.componentId,
                added.typeName, out _, out _), Is.False, "Domain reload must not resurrect the stale post-apply alias map.");
            Directory.Delete(blockedPath);
            Assert.That(plan.Rollback(out error), Is.True, error);
        }

        private TeamForgeColliderTopologyTransaction.Plan Prepare(
            TeamForgeColliderComponentCatalogRow[] active, TeamForgeColliderComponentCatalogRow[] removed)
        {
            Assert.That(TeamForgeColliderTopologyTransaction.TryPrepare(active, removed, Rows(active), NoProperties,
                out var plan, out var error), Is.True, error);
            return plan;
        }

        private void SetContext(string nextEpoch)
        {
            Assert.That(TeamForgeColliderComponentBindings.SetContext(Project, sessionId, projectUuid,
                sceneId, nextEpoch, out var error), Is.True, error);
            if (!ownContextIds.Contains(TeamForgeColliderComponentBindings.ContextIdentity))
                ownContextIds.Add(TeamForgeColliderComponentBindings.ContextIdentity);
        }

        private void MarkAuthoritativelyDeleted(string objectId)
        {
            var hierarchy = typeof(TeamForgeHierarchySyncService);
            const BindingFlags flags = BindingFlags.Static | BindingFlags.NonPublic;
            hierarchy.GetField("_wasConnected", flags).SetValue(null, true);
            hierarchy.GetField("_receivedSnapshot", flags).SetValue(null, true);
            ((HashSet<string>)hierarchy.GetField("AuthoritativeSceneIds", flags).GetValue(null)).Add(sceneId);
            ((TeamForgeHierarchyRegistry)hierarchy.GetField("Authoritative", flags).GetValue(null))
                .Remove(sceneId, objectId, true);
        }

        private TeamForgeColliderComponentCatalogRow Logical(string typeName, long revision = 1) =>
            new TeamForgeColliderComponentCatalogRow { sceneId = sceneId, objectId = GlobalObjectId.GetGlobalObjectIdSlow(owner).ToString(),
                componentId = "tf:c:" + Guid.NewGuid().ToString("N"), typeName = typeName, serverRevision = revision };

        private TeamForgeColliderComponentCatalogRow Saved(Component component) =>
            new TeamForgeColliderComponentCatalogRow { sceneId = sceneId, objectId = GlobalObjectId.GetGlobalObjectIdSlow(owner).ToString(),
                componentId = GlobalObjectId.GetGlobalObjectIdSlow(component).ToString(),
                typeName = component.GetType() == typeof(BoxCollider) ? "UnityEngine.BoxCollider" : "UnityEngine.SphereCollider",
                serverRevision = 1 };

        private static Component Resolve(TeamForgeColliderComponentCatalogRow row)
        {
            Assert.That(TeamForgeColliderComponentBindings.TryResolve(row.sceneId, row.objectId, row.componentId,
                row.typeName, out var component, out var error), Is.True, error);
            return component;
        }

        private static TeamForgeColliderProperty[] Rows(params TeamForgeColliderComponentCatalogRow[] components)
        {
            var rows = new List<TeamForgeColliderProperty>();
            foreach (var row in components)
            {
                rows.Add(new TeamForgeColliderProperty(row.sceneId, row.objectId, row.componentId, row.typeName,
                    "m_IsTrigger", "boolean", false, 0f, Vector3.zero, row.serverRevision));
                rows.Add(new TeamForgeColliderProperty(row.sceneId, row.objectId, row.componentId, row.typeName,
                    "m_Center", "vector3", false, 0f, Vector3.zero, row.serverRevision));
                rows.Add(new TeamForgeColliderProperty(row.sceneId, row.objectId, row.componentId, row.typeName,
                    row.typeName == "UnityEngine.BoxCollider" ? "m_Size" : "m_Radius",
                    row.typeName == "UnityEngine.BoxCollider" ? "vector3" : "float",
                    false, 0.5f, Vector3.one, row.serverRevision));
            }
            return rows.ToArray();
        }

        private static string ContextPath(string contextId) => Path.Combine(
            Directory.GetParent(Application.dataPath).FullName, "Library", "TeamForge", "ColliderBindings", contextId + ".json");
        private static string StateKey() => (string)typeof(TeamForgeColliderComponentBindings)
            .GetField("StateKey", BindingFlags.Static | BindingFlags.NonPublic).GetRawConstantValue();

        // Exercise real production methods while preserving another test/editor's
        // current context; no test-only authorization hooks enter production.
        private sealed class RegistryScope : IDisposable
        {
            private readonly Dictionary<FieldInfo, object> fields = new Dictionary<FieldInfo, object>();
            private readonly List<CollectionSnapshot> collections = new List<CollectionSnapshot>();
            internal RegistryScope()
            {
                Snapshot(typeof(TeamForgeColliderComponentBindings));
                Snapshot(typeof(TeamForgeColliderTopologyTransaction));
                Snapshot(typeof(TeamForgeHierarchySyncService));
            }
            private void Snapshot(Type type)
            {
                foreach (var field in type.GetFields(BindingFlags.Static | BindingFlags.NonPublic))
                {
                    if (field.IsLiteral) continue;
                    var value = field.GetValue(null);
                    if (!field.IsInitOnly) fields.Add(field, value);
                    else if (value is IEnumerable) collections.Add(new CollectionSnapshot(value));
                    else if (value is TeamForgeHierarchyRegistry)
                        foreach (var nested in value.GetType().GetFields(BindingFlags.Instance | BindingFlags.NonPublic))
                            if (nested.GetValue(value) is IEnumerable collection)
                                collections.Add(new CollectionSnapshot(collection));
                }
            }
            public void Dispose()
            {
                foreach (var collection in collections) collection.Restore();
                foreach (var field in fields) field.Key.SetValue(null, field.Value);
            }
        }

        private sealed class CollectionSnapshot
        {
            private readonly object collection;
            private readonly List<DictionaryEntry> entries;
            private readonly List<object> items;
            internal CollectionSnapshot(object value)
            {
                collection = value;
                if (value is IDictionary dictionary)
                { entries = new List<DictionaryEntry>(); foreach (DictionaryEntry item in dictionary) entries.Add(item); }
                else
                { items = new List<object>(); foreach (var item in (IEnumerable)value) items.Add(item); }
            }
            internal void Restore()
            {
                collection.GetType().GetMethod("Clear").Invoke(collection, null);
                if (collection is IDictionary dictionary)
                    foreach (var item in entries) dictionary.Add(item.Key, item.Value);
                else
                {
                    var append = collection.GetType().GetMethod("Enqueue") ?? collection.GetType().GetMethod("Add");
                    foreach (var item in items) append.Invoke(collection, new[] { item });
                }
            }
        }
    }
}

using System.Collections.Generic;
using System.Reflection;
using NUnit.Framework;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace EunSung.TeamForge.Tests
{
    public sealed class TeamForgeHierarchyModelTests
    {
        [Test]
        public void LogicalHierarchyIdsUseStrictLowercaseSessionFormat()
        {
            Assert.That(TeamForgeHierarchyIdentityRegistry.IsLogicalId("tf:0123456789abcdef0123456789abcdef"), Is.True);
            Assert.That(TeamForgeHierarchyIdentityRegistry.IsLogicalId("tf:0123456789ABCDEF0123456789abcdef"), Is.False);
            Assert.That(TeamForgeHierarchyIdentityRegistry.IsLogicalId("tf:0123"), Is.False);
            Assert.That(TeamForgeHierarchyIdentityRegistry.IsLogicalId("GlobalObjectId_V1-2-scene-1-0"), Is.False);
        }

        [Test]
        public void HierarchyStateRoundTripsMetadataAndInitialTransform()
        {
            var source = new TeamForgeHierarchyState
            {
                SceneId = "scene-guid",
                ObjectId = "tf:0123456789abcdef0123456789abcdef",
                Name = "New Child",
                ParentObjectId = "GlobalObjectId_V1-2-scene-guid-1-0",
                SiblingIndex = 3,
                Transform = new TeamForgeTransformState
                {
                    LocalPosition = new Vector3(1, 2, 3),
                    LocalRotation = Quaternion.Euler(10, 20, 30),
                    LocalScale = new Vector3(2, 3, 4),
                },
                CreatedRevision = 11,
                HierarchyRevision = 12,
            };

            var success = TeamForgeHierarchyState.TryFromRecord(source.ToRecord(), out var restored, out var error);

            Assert.That(success, Is.True, error);
            Assert.That(restored.SceneId, Is.EqualTo(source.SceneId));
            Assert.That(restored.ObjectId, Is.EqualTo(source.ObjectId));
            Assert.That(restored.Name, Is.EqualTo(source.Name));
            Assert.That(restored.ParentObjectId, Is.EqualTo(source.ParentObjectId));
            Assert.That(restored.SiblingIndex, Is.EqualTo(3));
            Assert.That(restored.CreatedRevision, Is.EqualTo(11));
            Assert.That(restored.HierarchyRevision, Is.EqualTo(12));
            Assert.That(restored.Transform.ApproximatelyEquals(source.Transform), Is.True);
        }

        [Test]
        public void HierarchyStatePreservesPrintableLeadingAndTrailingNameSpaces()
        {
            var source = State("scene-a", "tf:0123456789abcdef0123456789abcdef", "  Spaced Name  ", string.Empty, 0);

            var success = TeamForgeHierarchyState.TryFromRecord(source.ToRecord(), out var restored, out var error);

            Assert.That(success, Is.True, error);
            Assert.That(restored.Name, Is.EqualTo("  Spaced Name  "));
        }

        [Test]
        public void HierarchyRegistryKeepsCloneIsolationAndTombstonesDeletedIdentity()
        {
            var registry = new TeamForgeHierarchyRegistry();
            var state = State("scene-a", "tf:0123456789abcdef0123456789abcdef", "Cube", string.Empty, 0);

            registry.Upsert(state);
            state.Name = "Mutated Outside Registry";

            Assert.That(registry.TryGet("scene-a", "tf:0123456789abcdef0123456789abcdef", out var stored), Is.True);
            Assert.That(stored.Name, Is.EqualTo("Cube"));

            registry.Remove("scene-a", stored.ObjectId, true);

            Assert.That(registry.Contains("scene-a", stored.ObjectId), Is.False);
            Assert.That(registry.IsTombstoned("scene-a", stored.ObjectId), Is.True);
            Assert.That(registry.Count, Is.Zero);
            Assert.That(registry.TombstoneCount, Is.EqualTo(1));
        }

        [Test]
        public void TransformBaselineCanTrackHierarchyCreateReparentAndDelete()
        {
            var baseline = new TeamForgeObjectBaselineRegistry();
            const string sceneId = "scene-guid";
            const string parentA = "parent-a";
            const string parentB = "parent-b";
            const string child = "tf:0123456789abcdef0123456789abcdef";

            baseline.Upsert(sceneId, parentA, string.Empty);
            baseline.Upsert(sceneId, parentB, string.Empty);
            baseline.Upsert(sceneId, child, parentA);
            Assert.That(baseline.Contains(sceneId, child), Is.True);
            Assert.That(baseline.MatchesParent(sceneId, child, parentA), Is.True);

            baseline.Upsert(sceneId, child, parentB);
            Assert.That(baseline.MatchesParent(sceneId, child, parentB), Is.True);

            baseline.Remove(sceneId, child);
            Assert.That(baseline.Contains(sceneId, child), Is.False);
        }

        [Test]
        public void LogicalIdentityBindsWithoutAddingSceneMetadataComponent()
        {
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var target = new GameObject("Logical Object");
            try
            {
                var logicalId = TeamForgeHierarchyIdentityRegistry.GetOrCreateLogicalId(target);

                Assert.That(TeamForgeHierarchyIdentityRegistry.IsLogicalId(logicalId), Is.True);
                Assert.That(TeamForgeHierarchyIdentityRegistry.TryGetLogicalId(target, out var restoredId), Is.True);
                Assert.That(restoredId, Is.EqualTo(logicalId));
                Assert.That(TeamForgeHierarchyIdentityRegistry.TryResolve(logicalId, out var resolved), Is.True);
                Assert.That(resolved, Is.SameAs(target));
                Assert.That(target.GetComponents<Component>(), Has.Length.EqualTo(1));
                Assert.That(target.GetComponent<Transform>(), Is.Not.Null);
            }
            finally
            {
                Object.DestroyImmediate(target);
                EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            }
        }

        [Test]
        public void NewRemoteCubeAndEmptyGameObjectsRemainTransformOnlyWithOneBoundedScopeNotice()
        {
            const string temporaryFolder = "Assets/__TeamForgeHierarchyOnlyNoticeTests";
            if (!AssetDatabase.IsValidFolder(temporaryFolder))
            {
                AssetDatabase.CreateFolder("Assets", "__TeamForgeHierarchyOnlyNoticeTests");
            }

            var scenePath = $"{temporaryFolder}/{System.Guid.NewGuid():N}.unity";
            var serviceType = typeof(TeamForgeHierarchySyncService);
            var flags = BindingFlags.Static | BindingFlags.NonPublic;
            var wasConnected = serviceType.GetField("_wasConnected", flags);
            var warned = serviceType.GetField("_hierarchyOnlyCreationNoticeIssued", flags);
            var previousConnected = (bool)wasConnected.GetValue(null);
            var previousWarned = (bool)warned.GetValue(null);
            var diagnosticsLevel = typeof(TeamForgeDiagnostics).GetField("_minimumLevel", flags);
            var previousLevel = (TeamForgeLogLevel)diagnosticsLevel.GetValue(null);
            GameObject createdCube = null;
            GameObject createdEmpty = null;
            var cubeId = "tf:" + System.Guid.NewGuid().ToString("N");
            var emptyId = "tf:" + System.Guid.NewGuid().ToString("N");
            try
            {
                var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                Assert.That(EditorSceneManager.SaveScene(scene, scenePath), Is.True);
                var sceneId = AssetDatabase.AssetPathToGUID(scenePath);
                Assert.That(sceneId, Is.Not.Empty);

                wasConnected.SetValue(null, true);
                warned.SetValue(null, false);
                TeamForgeDiagnostics.Configure(TeamForgeLogLevel.Info);
                TeamForgeDiagnostics.Clear();

                var ensure = serviceType.GetMethod("EnsureAndApplyObject", flags);
                Assert.That(ensure, Is.Not.Null);
                var cube = new object[] { State(sceneId, cubeId, "Cube", string.Empty, 0), null, null, true };
                Assert.That((bool)ensure.Invoke(null, cube), Is.True, cube[2] as string);
                createdCube = cube[1] as GameObject;
                Assert.That(createdCube, Is.Not.Null);
                Assert.That(createdCube.GetComponents<Component>(), Has.Length.EqualTo(1));
                Assert.That(createdCube.GetComponent<MeshFilter>(), Is.Null);
                Assert.That(createdCube.GetComponent<MeshRenderer>(), Is.Null);
                Assert.That(createdCube.GetComponent<BoxCollider>(), Is.Null);

                var empty = new object[] { State(sceneId, emptyId, "Empty", string.Empty, 1), null, null, true };
                Assert.That((bool)ensure.Invoke(null, empty), Is.True, empty[2] as string);
                createdEmpty = empty[1] as GameObject;
                Assert.That(createdEmpty, Is.Not.Null);
                Assert.That(createdEmpty.GetComponents<Component>(), Has.Length.EqualTo(1));

                // Reconciliation is idempotent and never guesses geometry from
                // a name. Warn once per live connection, not on every object.
                var repeated = new object[] { State(sceneId, cubeId, "Cube", string.Empty, 0), null, null, true };
                Assert.That((bool)ensure.Invoke(null, repeated), Is.True, repeated[2] as string);
                Assert.That(repeated[1], Is.SameAs(createdCube));
                var log = TeamForgeDiagnostics.Snapshot();
                const string notice = "A newly received live Hierarchy GameObject has Transform only.";
                Assert.That(log.Split(new[] { notice }, System.StringSplitOptions.None).Length - 1, Is.EqualTo(1));
                Assert.That(log, Does.Contain("saved Project baseline"));
                Assert.That(log, Does.Contain("will not guess a Unity primitive"));
            }
            finally
            {
                wasConnected.SetValue(null, previousConnected);
                warned.SetValue(null, previousWarned);
                TeamForgeDiagnostics.Configure(previousLevel);
                TeamForgeDiagnostics.Clear();
                TeamForgeHierarchyIdentityRegistry.ForgetLiveObject(cubeId);
                TeamForgeHierarchyIdentityRegistry.ForgetLiveObject(emptyId);
                if (createdCube != null) UnityEngine.Object.DestroyImmediate(createdCube);
                if (createdEmpty != null) UnityEngine.Object.DestroyImmediate(createdEmpty);
                Selection.activeObject = null;
                EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                AssetDatabase.DeleteAsset(temporaryFolder);
            }
        }

        [Test]
        public void RemoteRenamePreservesLiveTransformWhenHierarchyRecordTransformIsStale()
        {
            const string temporaryFolder = "Assets/__TeamForgePhase4HierarchyTests";
            if (!AssetDatabase.IsValidFolder(temporaryFolder))
            {
                AssetDatabase.CreateFolder("Assets", "__TeamForgePhase4HierarchyTests");
            }

            var scenePath = $"{temporaryFolder}/{System.Guid.NewGuid():N}.unity";
            GameObject target = null;
            var logicalId = string.Empty;
            try
            {
                var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                target = new GameObject("Before Rename");
                Assert.That(EditorSceneManager.SaveScene(scene, scenePath), Is.True);
                var sceneId = AssetDatabase.AssetPathToGUID(scenePath);
                Assert.That(sceneId, Is.Not.Empty);

                logicalId = TeamForgeHierarchyIdentityRegistry.GetOrCreateLogicalId(target);
                target.transform.localPosition = new Vector3(4.65f, 5.62f, 4.61f);

                var staleHierarchyState = new TeamForgeHierarchyState
                {
                    SceneId = sceneId,
                    ObjectId = logicalId,
                    Name = "After Rename",
                    ParentObjectId = string.Empty,
                    SiblingIndex = target.transform.GetSiblingIndex(),
                    Transform = new TeamForgeTransformState
                    {
                        LocalPosition = Vector3.zero,
                        LocalRotation = Quaternion.identity,
                        LocalScale = Vector3.one,
                    },
                    CreatedRevision = 1,
                    HierarchyRevision = 2,
                };

                var method = typeof(TeamForgeHierarchySyncService).GetMethod(
                    "EnsureAndApplyObject",
                    BindingFlags.Static | BindingFlags.NonPublic);
                Assert.That(method, Is.Not.Null);
                var arguments = new object[] { staleHierarchyState, null, null, false };

                var applied = (bool)method.Invoke(null, arguments);

                Assert.That(applied, Is.True, arguments[2] as string);
                Assert.That(arguments[1], Is.SameAs(target));
                Assert.That(target.name, Is.EqualTo("After Rename"));
                Assert.That(target.transform.localPosition, Is.EqualTo(new Vector3(4.65f, 5.62f, 4.61f)));
            }
            finally
            {
                if (!string.IsNullOrWhiteSpace(logicalId))
                {
                    TeamForgeHierarchyIdentityRegistry.ForgetLiveObject(logicalId);
                }
                Selection.activeObject = null;
                EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                AssetDatabase.DeleteAsset(temporaryFolder);
            }
        }

        [Test]
        public void InitialSnapshotDeletesOfflineEditedTombstoneAndAcceptsMatchingDirtyLiveHierarchy()
        {
            const string temporaryFolder = "Assets/__TeamForgePhase4TombstoneTests";
            if (!AssetDatabase.IsValidFolder(temporaryFolder))
            {
                AssetDatabase.CreateFolder("Assets", "__TeamForgePhase4TombstoneTests");
            }

            var scenePath = $"{temporaryFolder}/{System.Guid.NewGuid():N}.unity";
            GameObject live = null;
            GameObject stale = null;
            var staleLogicalId = string.Empty;
            try
            {
                var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                live = new GameObject("Live");
                stale = new GameObject("Stale Deleted");
                Assert.That(EditorSceneManager.SaveScene(scene, scenePath), Is.True);
                var sceneId = AssetDatabase.AssetPathToGUID(scenePath);
                Assert.That(sceneId, Is.Not.Empty);
                Assert.That(TeamForgeObjectIdentity.TryGetGlobalObjectId(live, out var liveId), Is.True);

                staleLogicalId = TeamForgeHierarchyIdentityRegistry.GetOrCreateLogicalId(stale);
                stale.name = "Offline Rename";
                stale.transform.localPosition = new Vector3(9, 8, 7);
                EditorSceneManager.MarkSceneDirty(scene);
                Assert.That(scene.isDirty, Is.True);

                var liveState = new TeamForgeHierarchyState
                {
                    SceneId = sceneId,
                    ObjectId = liveId,
                    Name = live.name,
                    ParentObjectId = string.Empty,
                    SiblingIndex = live.transform.GetSiblingIndex(),
                    Transform = TeamForgeTransformState.Capture(live.transform),
                    CreatedRevision = 1,
                    HierarchyRevision = 3,
                };
                var tombstones = new[]
                {
                    new TeamForgeHierarchyTombstoneRecord
                    {
                        sceneId = sceneId,
                        objectId = staleLogicalId,
                        deletedRevision = 3,
                        deletedByUserId = "editor-a",
                    },
                };

                var method = typeof(TeamForgeHierarchySyncService).GetMethod(
                    "PrepareInitialSnapshot",
                    BindingFlags.Static | BindingFlags.NonPublic);
                Assert.That(method, Is.Not.Null);
                var arguments = new object[]
                {
                    new List<TeamForgeHierarchyState> { liveState },
                    tombstones,
                    new[] { sceneId },
                    null,
                };

                var accepted = (bool)method.Invoke(null, arguments);

                Assert.That(accepted, Is.True, arguments[3] as string);
                Assert.That(stale == null, Is.True, "Authoritative tombstone must delete the stale offline object.");
                Assert.That(live, Is.Not.Null);
                Assert.That(live.name, Is.EqualTo("Live"));
            }
            finally
            {
                if (!string.IsNullOrWhiteSpace(staleLogicalId))
                {
                    TeamForgeHierarchyIdentityRegistry.ForgetLiveObject(staleLogicalId);
                }
                Selection.activeObject = null;
                EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                AssetDatabase.DeleteAsset(temporaryFolder);
            }
        }

        [Test]
        public void InitialSnapshotStillRejectsDirtyLiveHierarchyDivergenceAfterTombstoneCleanup()
        {
            const string temporaryFolder = "Assets/__TeamForgePhase4TombstoneSafetyTests";
            if (!AssetDatabase.IsValidFolder(temporaryFolder))
            {
                AssetDatabase.CreateFolder("Assets", "__TeamForgePhase4TombstoneSafetyTests");
            }

            var scenePath = $"{temporaryFolder}/{System.Guid.NewGuid():N}.unity";
            GameObject live = null;
            GameObject stale = null;
            var staleLogicalId = string.Empty;
            try
            {
                var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                live = new GameObject("Live Authoritative");
                stale = new GameObject("Stale Deleted");
                Assert.That(EditorSceneManager.SaveScene(scene, scenePath), Is.True);
                var sceneId = AssetDatabase.AssetPathToGUID(scenePath);
                Assert.That(TeamForgeObjectIdentity.TryGetGlobalObjectId(live, out var liveId), Is.True);
                staleLogicalId = TeamForgeHierarchyIdentityRegistry.GetOrCreateLogicalId(stale);

                var authoritativeLive = new TeamForgeHierarchyState
                {
                    SceneId = sceneId,
                    ObjectId = liveId,
                    Name = live.name,
                    ParentObjectId = string.Empty,
                    SiblingIndex = live.transform.GetSiblingIndex(),
                    Transform = TeamForgeTransformState.Capture(live.transform),
                    CreatedRevision = 1,
                    HierarchyRevision = 4,
                };

                live.name = "Unsaved Local Rename";
                stale.transform.localPosition = new Vector3(1, 2, 3);
                EditorSceneManager.MarkSceneDirty(scene);

                var tombstones = new[]
                {
                    new TeamForgeHierarchyTombstoneRecord
                    {
                        sceneId = sceneId,
                        objectId = staleLogicalId,
                        deletedRevision = 4,
                        deletedByUserId = "editor-a",
                    },
                };
                var method = typeof(TeamForgeHierarchySyncService).GetMethod(
                    "PrepareInitialSnapshot",
                    BindingFlags.Static | BindingFlags.NonPublic);
                Assert.That(method, Is.Not.Null);
                var arguments = new object[]
                {
                    new List<TeamForgeHierarchyState> { authoritativeLive },
                    tombstones,
                    new[] { sceneId },
                    null,
                };

                var accepted = (bool)method.Invoke(null, arguments);

                Assert.That(accepted, Is.False);
                Assert.That(stale == null, Is.True, "Tombstone delete must still dominate before live-edit safety rejection.");
                Assert.That(arguments[3] as string, Does.Contain("unsaved Hierarchy/Transform changes"));
                Assert.That(live.name, Is.EqualTo("Unsaved Local Rename"), "Unrelated live dirty edit must not be overwritten.");
            }
            finally
            {
                if (!string.IsNullOrWhiteSpace(staleLogicalId))
                {
                    TeamForgeHierarchyIdentityRegistry.ForgetLiveObject(staleLogicalId);
                }
                Selection.activeObject = null;
                EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                AssetDatabase.DeleteAsset(temporaryFolder);
            }
        }

        [Test]
        public void HierarchyProtocolCapabilityAndSnapshotRoundTripRemainProtocolV1()
        {
            var hello = new HelloMessage
            {
                type = "hello",
                protocolVersion = TeamForgeProtocol.Version,
                requestId = "hello-hierarchy",
                userName = "Editor A",
                projectId = "project-a",
                sessionId = "session-a",
                supportsPresence = true,
                supportsTransformSync = true,
                supportsHierarchySync = true,
            };
            var restoredHello = TeamForgeProtocol.Deserialize<HelloMessage>(TeamForgeProtocol.Serialize(hello));
            Assert.That(TeamForgeProtocol.Version, Is.EqualTo(1));
            Assert.That(restoredHello.supportsHierarchySync, Is.True);

            var snapshot = new HierarchySnapshotMessage
            {
                type = "hierarchy_snapshot",
                protocolVersion = TeamForgeProtocol.Version,
                requestId = "snapshot-hierarchy",
                serverRevision = 9,
                sceneIds = new[] { "scene-a", "scene-empty" },
                objects = new[] { State("scene-a", "tf:0123456789abcdef0123456789abcdef", "Child", string.Empty, 0).ToRecord() },
                tombstones = new[]
                {
                    new TeamForgeHierarchyTombstoneRecord
                    {
                        sceneId = "scene-a",
                        objectId = "tf:fedcba9876543210fedcba9876543210",
                        deletedRevision = 8,
                        deletedByUserId = "editor-b",
                    },
                },
            };
            var restoredSnapshot = TeamForgeProtocol.Deserialize<HierarchySnapshotMessage>(TeamForgeProtocol.Serialize(snapshot));
            Assert.That(restoredSnapshot.serverRevision, Is.EqualTo(9));
            Assert.That(restoredSnapshot.sceneIds, Is.EqualTo(new[] { "scene-a", "scene-empty" }));
            Assert.That(restoredSnapshot.objects, Has.Length.EqualTo(1));
            Assert.That(restoredSnapshot.tombstones, Has.Length.EqualTo(1));
            Assert.That(restoredSnapshot.objects[0].name, Is.EqualTo("Child"));
        }

        private static TeamForgeHierarchyState State(
            string sceneId,
            string objectId,
            string name,
            string parentObjectId,
            int siblingIndex)
        {
            return new TeamForgeHierarchyState
            {
                SceneId = sceneId,
                ObjectId = objectId,
                Name = name,
                ParentObjectId = parentObjectId,
                SiblingIndex = siblingIndex,
                Transform = new TeamForgeTransformState
                {
                    LocalPosition = Vector3.zero,
                    LocalRotation = Quaternion.identity,
                    LocalScale = Vector3.one,
                },
                CreatedRevision = 1,
                HierarchyRevision = 1,
            };
        }
    }
}

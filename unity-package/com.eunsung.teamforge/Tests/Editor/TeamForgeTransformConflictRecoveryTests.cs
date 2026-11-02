using System;
using System.Collections;
using System.Collections.Generic;
using System.Reflection;
using NUnit.Framework;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace EunSung.TeamForge.Tests
{
    public sealed class TeamForgeTransformConflictRecoveryTests
    {
        private const BindingFlags StaticNonPublic = BindingFlags.Static | BindingFlags.NonPublic;
        private const string SceneId = "recovery-scene";
        private const string ObjectId = "recovery-object";

        [Test]
        public void RecoveryRegistryOnlyKeepsLatestDeferredAuthoritativeTransform()
        {
            var registry = new TeamForgeTransformConflictRecoveryRegistry();
            registry.MarkLockRequired(SceneId, ObjectId);

            registry.DeferAuthoritativeTransform(new TransformAppliedMessage
            {
                sceneId = SceneId,
                objectId = ObjectId,
                serverRevision = 9,
            });
            registry.DeferAuthoritativeTransform(new TransformAppliedMessage
            {
                sceneId = SceneId,
                objectId = ObjectId,
                serverRevision = 7,
            });
            registry.DeferAuthoritativeTransform(new TransformAppliedMessage
            {
                sceneId = SceneId,
                objectId = ObjectId,
                serverRevision = 12,
            });

            Assert.That(registry.IsLockRequired(SceneId, ObjectId), Is.True);
            Assert.That(
                registry.TryGetDeferredAuthoritativeTransform(SceneId, ObjectId, out var deferred),
                Is.True);
            Assert.That(deferred.serverRevision, Is.EqualTo(12));

            registry.MarkNonRecoverable(SceneId, ObjectId);
            Assert.That(registry.IsLockRequired(SceneId, ObjectId), Is.False);
            Assert.That(
                registry.TryGetDeferredAuthoritativeTransform(SceneId, ObjectId, out _),
                Is.False);
        }

        [Test]
        public void InitialSnapshotDirtyTrackingIgnoresRemoteApplyAndPreservesLocalDirtiness()
        {
            var serviceType = typeof(TeamForgeTransformSyncService);
            var previousActiveScene = SceneManager.GetActiveScene();
            Scene localScene = default;
            Scene remoteScene = default;

            try
            {
                localScene = SceneManager.CreateScene("TeamForge Dirty Local " + Guid.NewGuid().ToString("N"));
                remoteScene = SceneManager.CreateScene("TeamForge Dirty Remote " + Guid.NewGuid().ToString("N"));
                Assert.That(localScene.path, Is.Empty);
                Assert.That(remoteScene.path, Is.Empty);
                Assert.That(SceneManager.SetActiveScene(localScene), Is.True);
                var target = new GameObject("Initial Snapshot Local Target");
                SceneManager.MoveGameObjectToScene(target, localScene);

                ResetInitialSnapshotDirtyTracking(serviceType);
                RequiredField(serviceType, "_awaitingInitialTransformSnapshot").SetValue(null, true);

                using (TeamForgeRemoteApplyScope.Enter())
                {
                    RequiredMethod(serviceType, "OnSceneDirtied").Invoke(null, new object[] { remoteScene });
                }

                Assert.That(InitialSnapshotDirtyScenes(serviceType).Contains(remoteScene), Is.False);

                RequiredMethod(serviceType, "OnSceneDirtied").Invoke(null, new object[] { localScene });
                RequiredMethod(serviceType, "OnSceneDirtied").Invoke(null, new object[] { target.scene });
                Assert.That(InitialSnapshotDirtyScenes(serviceType), Is.EquivalentTo(new[] { localScene }));

                var consumed = (HashSet<Scene>)RequiredMethod(
                    serviceType,
                    "ConsumeInitialTransformSnapshotDirtyScenes").Invoke(null, null);

                Assert.That(consumed.Contains(target.scene), Is.True);
                Assert.That(consumed.Contains(remoteScene), Is.False);
                Assert.That(
                    (bool)RequiredField(serviceType, "_awaitingInitialTransformSnapshot").GetValue(null),
                    Is.False);
                Assert.That(InitialSnapshotDirtyScenes(serviceType), Is.Empty);

                RequiredMethod(serviceType, "OnSceneDirtied").Invoke(null, new object[] { remoteScene });
                Assert.That(InitialSnapshotDirtyScenes(serviceType), Is.Empty);
                RequiredField(serviceType, "_awaitingInitialTransformSnapshot").SetValue(null, true);
                RequiredMethod(serviceType, "OnSceneDirtied").Invoke(null, new object[] { remoteScene });
                Assert.That(InitialSnapshotDirtyScenes(serviceType).Contains(remoteScene), Is.True);
                Assert.That(consumed.Contains(remoteScene), Is.False,
                    "Consumed membership must remain independent of the next snapshot's tracking.");
            }
            finally
            {
                ResetInitialSnapshotDirtyTracking(serviceType);
                CloseFixtureScenes(previousActiveScene, localScene, remoteScene);
            }
        }

        [Test]
        public void InitialSnapshotCapturesDirtyScenesAndRetainsSubsequentLocalDirtyEvents()
        {
            var serviceType = typeof(TeamForgeTransformSyncService);
            var previousActiveScene = SceneManager.GetActiveScene();
            Scene initialScene = default;
            Scene subsequentScene = default;

            try
            {
                ResetInitialSnapshotDirtyTracking(serviceType);
                initialScene = SceneManager.CreateScene("TeamForge Dirty Initial " + Guid.NewGuid().ToString("N"));
                subsequentScene = SceneManager.CreateScene("TeamForge Dirty Subsequent " + Guid.NewGuid().ToString("N"));
                Assert.That(initialScene.isDirty, Is.False);
                Assert.That(subsequentScene.isDirty, Is.False);
                Assert.That(EditorSceneManager.MarkSceneDirty(initialScene), Is.True);

                var captured = (HashSet<Scene>)RequiredMethod(serviceType, "CaptureDirtyScenes").Invoke(null, null);
                Assert.That(captured.Contains(initialScene), Is.True);
                Assert.That(captured.Contains(subsequentScene), Is.False);

                RequiredMethod(serviceType, "BeginInitialTransformSnapshotDirtyTracking").Invoke(null, null);
                Assert.That(InitialSnapshotDirtyScenes(serviceType).Contains(initialScene), Is.True);
                Assert.That(InitialSnapshotDirtyScenes(serviceType).Contains(subsequentScene), Is.False);
                Assert.That(EditorSceneManager.MarkSceneDirty(subsequentScene), Is.True);

                var consumed = (HashSet<Scene>)RequiredMethod(
                    serviceType, "ConsumeInitialTransformSnapshotDirtyScenes").Invoke(null, null);
                Assert.That(consumed.Contains(initialScene), Is.True);
                Assert.That(consumed.Contains(subsequentScene), Is.True);
                Assert.That(InitialSnapshotDirtyScenes(serviceType), Is.Empty);
                Assert.That(captured.Contains(subsequentScene), Is.False);

                var fallback = (HashSet<Scene>)RequiredMethod(
                    serviceType, "ConsumeInitialTransformSnapshotDirtyScenes").Invoke(null, null);
                Assert.That(fallback.Contains(initialScene), Is.True);
                Assert.That(fallback.Contains(subsequentScene), Is.True);
            }
            finally
            {
                ResetInitialSnapshotDirtyTracking(serviceType);
                CloseFixtureScenes(previousActiveScene, initialScene, subsequentScene);
            }
        }

        [Test]
        public void LockRequiredConflictRestoresLastConfirmedValueWhenInteractionIsQuiescent()
        {
            var target = new GameObject("Lock Required Recovery Target");
            var serviceType = typeof(TeamForgeTransformSyncService);
            var previousHotControl = GUIUtility.hotControl;
            try
            {
                ResetAuthorityView();
                ResetServiceState(serviceType);
                GUIUtility.hotControl = 0;

                target.transform.localPosition = new Vector3(1f, 2f, 3f);
                var confirmed = TeamForgeTransformState.Capture(target.transform);
                target.transform.localPosition = new Vector3(101f, 202f, 303f);
                var rejected = TeamForgeTransformState.Capture(target.transform);

                ConfigureSelectedConflict(serviceType, target, confirmed, rejected, recoverable: true);

                Assert.That(TeamForgeTransformSyncService.SelectedObjectBlocked, Is.True);
                Assert.That(TeamForgeTransformSyncService.TryRecoverSelectedLockRequiredConflict(), Is.True);
                Assert.That(target.transform.localPosition, Is.EqualTo(confirmed.LocalPosition));
                Assert.That(TeamForgeTransformSyncService.SelectedObjectBlocked, Is.False);
                Assert.That(RecoveryRegistry(serviceType).IsLockRequired(SceneId, ObjectId), Is.False);
                Assert.That(ProtectedKeys(serviceType).Contains(ObjectKey()), Is.False);
            }
            finally
            {
                GUIUtility.hotControl = previousHotControl;
                ResetServiceState(serviceType);
                ResetAuthorityView();
                UnityEngine.Object.DestroyImmediate(target);
            }
        }

        [Test]
        public void LockRequiredConflictWaitsUntilHotControlIsReleased()
        {
            var target = new GameObject("Hot Control Recovery Target");
            var serviceType = typeof(TeamForgeTransformSyncService);
            var previousHotControl = GUIUtility.hotControl;
            try
            {
                ResetAuthorityView();
                ResetServiceState(serviceType);

                target.transform.localPosition = new Vector3(4f, 5f, 6f);
                var confirmed = TeamForgeTransformState.Capture(target.transform);
                target.transform.localPosition = new Vector3(400f, 500f, 600f);
                var rejected = TeamForgeTransformState.Capture(target.transform);
                ConfigureSelectedConflict(serviceType, target, confirmed, rejected, recoverable: true);

                GUIUtility.hotControl = 912345;
                Assert.That(TeamForgeTransformSyncService.TryRecoverSelectedLockRequiredConflict(), Is.False);
                Assert.That(target.transform.localPosition, Is.EqualTo(rejected.LocalPosition));
                Assert.That(TeamForgeTransformSyncService.SelectedObjectBlocked, Is.True);

                GUIUtility.hotControl = 0;
                Assert.That(TeamForgeTransformSyncService.TryRecoverSelectedLockRequiredConflict(), Is.True);
                Assert.That(target.transform.localPosition, Is.EqualTo(confirmed.LocalPosition));
                Assert.That(TeamForgeTransformSyncService.SelectedObjectBlocked, Is.False);
            }
            finally
            {
                GUIUtility.hotControl = previousHotControl;
                ResetServiceState(serviceType);
                ResetAuthorityView();
                UnityEngine.Object.DestroyImmediate(target);
            }
        }

        [Test]
        public void ForeignLockOwnerDuringLocalEditBecomesRecoverableAndWaitsForHotControlRelease()
        {
            var target = new GameObject("Foreign Lock Recovery Target");
            var serviceType = typeof(TeamForgeTransformSyncService);
            var previousHotControl = GUIUtility.hotControl;
            try
            {
                ResetAuthorityView();
                ResetServiceState(serviceType);

                target.transform.localPosition = new Vector3(10f, 20f, 30f);
                var confirmed = TeamForgeTransformState.Capture(target.transform);
                target.transform.localPosition = new Vector3(110f, 220f, 330f);
                var localEdit = TeamForgeTransformState.Capture(target.transform);
                ConfigureSelectedTracking(serviceType, target, confirmed, localEdit);

                Assert.That(
                    TeamForgeTransformSyncService.Locks.Upsert(
                        new TeamForgeLockRecord
                        {
                            sceneId = SceneId,
                            objectId = ObjectId,
                            ownerUserId = "peer-b-user",
                            ownerConnectionId = "peer-b-connection",
                            ownerDisplayName = "Peer B",
                            ownerColor = "#3366FF",
                            expiresAtUnixMs = DateTimeOffset.UtcNow.AddMinutes(1).ToUnixTimeMilliseconds(),
                        },
                        out var lockError),
                    Is.True,
                    lockError);

                GUIUtility.hotControl = 912345;
                RequiredMethod(serviceType, "RefreshSelectedLockFromRegistry").Invoke(
                    null,
                    new object[] { 0L });

                Assert.That(TeamForgeTransformSyncService.SelectedObjectBlocked, Is.True);
                Assert.That(ProtectedKeys(serviceType).Contains(ObjectKey()), Is.True);
                Assert.That(RecoveryRegistry(serviceType).IsLockRequired(SceneId, ObjectId), Is.True);
                Assert.That(target.transform.localPosition, Is.EqualTo(localEdit.LocalPosition));
                Assert.That(TeamForgeTransformSyncService.TryRecoverSelectedLockRequiredConflict(), Is.False);

                GUIUtility.hotControl = 0;
                Assert.That(TeamForgeTransformSyncService.TryRecoverSelectedLockRequiredConflict(), Is.True);
                Assert.That(target.transform.localPosition, Is.EqualTo(confirmed.LocalPosition));
                Assert.That(TeamForgeTransformSyncService.SelectedObjectBlocked, Is.False);
                Assert.That(ProtectedKeys(serviceType).Contains(ObjectKey()), Is.False);
                Assert.That(RecoveryRegistry(serviceType).IsLockRequired(SceneId, ObjectId), Is.False);
            }
            finally
            {
                GUIUtility.hotControl = previousHotControl;
                ResetServiceState(serviceType);
                ResetAuthorityView();
                UnityEngine.Object.DestroyImmediate(target);
            }
        }

        [Test]
        public void GenericProtectedConflictRemainsFailClosed()
        {
            var target = new GameObject("Generic Protected Conflict Target");
            var serviceType = typeof(TeamForgeTransformSyncService);
            var previousHotControl = GUIUtility.hotControl;
            try
            {
                ResetAuthorityView();
                ResetServiceState(serviceType);
                GUIUtility.hotControl = 0;

                target.transform.localPosition = new Vector3(7f, 8f, 9f);
                var confirmed = TeamForgeTransformState.Capture(target.transform);
                target.transform.localPosition = new Vector3(700f, 800f, 900f);
                var localConflict = TeamForgeTransformState.Capture(target.transform);
                ConfigureSelectedConflict(serviceType, target, confirmed, localConflict, recoverable: false);

                Assert.That(TeamForgeTransformSyncService.TryRecoverSelectedLockRequiredConflict(), Is.False);
                Assert.That(target.transform.localPosition, Is.EqualTo(localConflict.LocalPosition));
                Assert.That(TeamForgeTransformSyncService.SelectedObjectBlocked, Is.True);
                Assert.That(ProtectedKeys(serviceType).Contains(ObjectKey()), Is.True);
            }
            finally
            {
                GUIUtility.hotControl = previousHotControl;
                ResetServiceState(serviceType);
                ResetAuthorityView();
                UnityEngine.Object.DestroyImmediate(target);
            }
        }

        private static void ConfigureSelectedTracking(
            Type serviceType,
            GameObject target,
            TeamForgeTransformState confirmed,
            TeamForgeTransformState observed)
        {
            RequiredField(serviceType, "_selectedObject").SetValue(null, target);
            RequiredField(serviceType, "_selectedSceneId").SetValue(null, SceneId);
            RequiredField(serviceType, "_selectedObjectId").SetValue(null, ObjectId);
            RequiredField(serviceType, "_lastConfirmedState").SetValue(null, confirmed.Clone());
            RequiredField(serviceType, "_lastObservedState").SetValue(null, observed.Clone());
            RequiredField(serviceType, "_selectedLockGranted").SetValue(null, true);
            RequiredField(serviceType, "_selectedLockExpiresAt").SetValue(null, 0d);
            RequiredField(serviceType, "_pendingLockRequestId").SetValue(null, string.Empty);
            RequiredField(serviceType, "_dirty").SetValue(null, true);
            RequiredField(serviceType, "_syncBlocked").SetValue(null, false);
        }

        private static void ConfigureSelectedConflict(
            Type serviceType,
            GameObject target,
            TeamForgeTransformState confirmed,
            TeamForgeTransformState observed,
            bool recoverable)
        {
            ConfigureSelectedTracking(serviceType, target, confirmed, observed);
            RequiredField(serviceType, "_selectedLockGranted").SetValue(null, false);
            RequiredField(serviceType, "_syncBlocked").SetValue(null, true);

            ProtectedKeys(serviceType).Add(ObjectKey());
            if (recoverable)
            {
                RecoveryRegistry(serviceType).MarkLockRequired(SceneId, ObjectId);
            }
        }

        private static HashSet<string> ProtectedKeys(Type serviceType)
        {
            return (HashSet<string>)RequiredField(serviceType, "ProtectedConflictKeys").GetValue(null);
        }

        private static TeamForgeTransformConflictRecoveryRegistry RecoveryRegistry(Type serviceType)
        {
            return (TeamForgeTransformConflictRecoveryRegistry)RequiredField(
                serviceType,
                "RecoverableTransformConflicts").GetValue(null);
        }

        private static HashSet<Scene> InitialSnapshotDirtyScenes(Type serviceType)
        {
            return (HashSet<Scene>)RequiredField(
                serviceType,
                "InitialSnapshotLocalDirtyScenes").GetValue(null);
        }

        private static void ResetInitialSnapshotDirtyTracking(Type serviceType)
        {
            InitialSnapshotDirtyScenes(serviceType).Clear();
            RequiredField(serviceType, "_awaitingInitialTransformSnapshot").SetValue(null, false);
        }

        private static void CloseFixtureScenes(Scene previousActiveScene, params Scene[] scenes)
        {
            if (previousActiveScene.IsValid() && previousActiveScene.isLoaded)
            {
                SceneManager.SetActiveScene(previousActiveScene);
            }
            foreach (var scene in scenes)
            {
                if (scene.IsValid() && scene.isLoaded)
                {
                    EditorSceneManager.CloseScene(scene, true);
                }
            }
        }

        private static void ResetServiceState(Type serviceType)
        {
            RequiredMethod(serviceType, "ResetSelectionTracking").Invoke(null, null);
            ProtectedKeys(serviceType).Clear();
            RecoveryRegistry(serviceType).Clear();
            ResetInitialSnapshotDirtyTracking(serviceType);
            ClearCollection(RequiredField(serviceType, "PendingLocalOperations").GetValue(null));
            ClearCollection(RequiredField(serviceType, "PendingOperationByRequestId").GetValue(null));
        }

        private static void ResetAuthorityView()
        {
            var authorityType = typeof(TeamForgeTransformSyncService).Assembly.GetType(
                "EunSung.TeamForge.TeamForgeAuthorityView",
                true);
            RequiredMethod(authorityType, "ResetSession").Invoke(null, null);
        }

        private static FieldInfo RequiredField(Type type, string name)
        {
            return type.GetField(name, StaticNonPublic) ??
                   throw new MissingFieldException(type.FullName, name);
        }

        private static MethodInfo RequiredMethod(Type type, string name)
        {
            return type.GetMethod(name, StaticNonPublic) ??
                   throw new MissingMethodException(type.FullName, name);
        }

        private static void ClearCollection(object collection)
        {
            if (collection is IDictionary dictionary)
            {
                dictionary.Clear();
                return;
            }
            if (collection is IList list)
            {
                list.Clear();
                return;
            }

            var clear = collection?.GetType().GetMethod("Clear", Type.EmptyTypes);
            clear?.Invoke(collection, null);
        }

        private static string ObjectKey()
        {
            return SceneId + "\n" + ObjectId;
        }
    }
}

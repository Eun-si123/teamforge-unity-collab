using System;
using System.Collections;
using System.Collections.Generic;
using System.Reflection;
using NUnit.Framework;
using UnityEditor;
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
        public void ForeignLockSceneCueIdentifiesOtherConnectionAndBoundsTheOwnerLabel()
        {
            var method = RequiredMethod(
                typeof(TeamForgeTransformSyncService), "TryGetForeignLockOwnerLabel");
            var lockState = new TeamForgeLockRecord
            {
                ownerUserId = "peer-user",
                ownerConnectionId = "peer-connection",
                ownerDisplayName = new string('A', 64),
            };

            var arguments = new object[] { lockState, "our-connection", string.Empty };
            Assert.That(method.Invoke(null, arguments), Is.EqualTo(true));
            Assert.That((string)arguments[2], Is.EqualTo(new string('A', 48) + "…"));

            lockState.ownerDisplayName = null;
            arguments = new object[] { lockState, "our-connection", string.Empty };
            Assert.That(method.Invoke(null, arguments), Is.EqualTo(true));
            Assert.That((string)arguments[2], Is.EqualTo("another editor"));
        }

        [Test]
        public void ForeignLockSceneCueNeverClaimsAnOwnedOrUnknownConnectionIsForeign()
        {
            var method = RequiredMethod(
                typeof(TeamForgeTransformSyncService), "TryGetForeignLockOwnerLabel");
            var lockState = new TeamForgeLockRecord
            {
                ownerUserId = "peer-user",
                ownerConnectionId = "our-connection",
                ownerDisplayName = "Us",
            };

            foreach (var localId in new[] { "our-connection", "", null })
            {
                var arguments = new object[] { lockState, localId, "old label" };
                Assert.That(method.Invoke(null, arguments), Is.EqualTo(false));
                Assert.That((string)arguments[2], Is.Empty);
            }

            var missing = new object[] { null, "our-connection", "old label" };
            Assert.That(method.Invoke(null, missing), Is.EqualTo(false));
            Assert.That((string)missing[2], Is.Empty);
            lockState.ownerConnectionId = "";
            missing = new object[] { lockState, "our-connection", "old label" };
            Assert.That(method.Invoke(null, missing), Is.EqualTo(false));
            Assert.That((string)missing[2], Is.Empty);

            // Rejoining with the same user ID has a new connection identity;
            // the label must still show the actual foreign session owner.
            lockState.ownerConnectionId = "new-connection";
            missing = new object[] { lockState, "our-connection", string.Empty };
            Assert.That(method.Invoke(null, missing), Is.EqualTo(true));
            Assert.That((string)missing[2], Is.EqualTo("Us"));
        }

        [Test]
        public void NativeHandleVisibilityLeaseHidesOnlyDuringForeignLockAndRestoresPriorVisibleState()
        {
            var originalHidden = Tools.hidden;
            var lease = new TeamForgeNativeHandleVisibilityLease();
            try
            {
                Tools.hidden = false;
                lease.Refresh(showForeignLock: false, interactionIdle: true);
                Assert.That(Tools.hidden, Is.False);
                Assert.That(lease.OwnsHiddenState, Is.False);

                lease.Refresh(showForeignLock: true, interactionIdle: true);
                Assert.That(Tools.hidden, Is.True);
                Assert.That(lease.OwnsHiddenState, Is.True);
                lease.Refresh(showForeignLock: true, interactionIdle: true);
                Assert.That(lease.OwnsHiddenState, Is.True);

                lease.Refresh(showForeignLock: false, interactionIdle: true);
                Assert.That(Tools.hidden, Is.False);
                Assert.That(lease.OwnsHiddenState, Is.False);
            }
            finally
            {
                lease.Restore();
                Tools.hidden = originalHidden;
            }
        }

        [Test]
        public void NativeHandleVisibilityLeasePreservesPreexistingHiddenPreference()
        {
            var originalHidden = Tools.hidden;
            var lease = new TeamForgeNativeHandleVisibilityLease();
            try
            {
                Tools.hidden = true;
                lease.Refresh(showForeignLock: true, interactionIdle: true);
                Assert.That(lease.OwnsHiddenState, Is.False);
                lease.Refresh(showForeignLock: false, interactionIdle: true);
                Assert.That(Tools.hidden, Is.True);
                Assert.That(lease.OwnsHiddenState, Is.False);
            }
            finally
            {
                lease.Restore();
                Tools.hidden = originalHidden;
            }
        }

        [Test]
        public void NativeHandleVisibilityLeaseWaitsForIdleAndRestoresAfterManualVisibilityChange()
        {
            var originalHidden = Tools.hidden;
            var lease = new TeamForgeNativeHandleVisibilityLease();
            try
            {
                Tools.hidden = false;
                lease.Refresh(showForeignLock: true, interactionIdle: false);
                Assert.That(Tools.hidden, Is.False,
                    "Do not hide the active Unity Gizmo midway through a drag.");
                Assert.That(lease.OwnsHiddenState, Is.False);

                lease.Refresh(showForeignLock: true, interactionIdle: true);
                Assert.That(Tools.hidden, Is.True);
                Assert.That(lease.OwnsHiddenState, Is.True);

                // Another Editor script can make the handles visible; a
                // later unlock must not undo that third-party write.
                Tools.hidden = false;
                lease.Restore();
                Assert.That(Tools.hidden, Is.False);
                Assert.That(lease.OwnsHiddenState, Is.False);
            }
            finally
            {
                lease.Restore();
                Tools.hidden = originalHidden;
            }
        }

        // Bookkeeping uses real loaded Scene values without changing Scene state.
        // Native multi-Scene creation/event injection remains separate coverage;
        // TeamForgeTransformModelTests exercises native remote-apply dirty state.
        [Test]
        public void InitialSnapshotDirtyTrackingIgnoresRemoteApplyAndPreservesLocalDirtiness()
        {
            var serviceType = typeof(TeamForgeTransformSyncService);
            var scene = SceneManager.GetActiveScene();
            Assert.That(scene.IsValid(), Is.True);
            Assert.That(scene.isLoaded, Is.True);
            var observedScenes = CaptureLoadedSceneObservations();

            try
            {
                ResetInitialSnapshotDirtyTracking(serviceType);
                RequiredField(serviceType, "_awaitingInitialTransformSnapshot").SetValue(null, true);

                using (TeamForgeRemoteApplyScope.Enter())
                {
                    RequiredMethod(serviceType, "OnSceneDirtied").Invoke(null, new object[] { scene });
                }

                RequiredMethod(serviceType, "OnSceneDirtied").Invoke(null, new object[] { default(Scene) });
                Assert.That(InitialSnapshotDirtyScenes(serviceType), Is.Empty);

                RequiredMethod(serviceType, "OnSceneDirtied").Invoke(null, new object[] { scene });
                var sceneCopy = SceneManager.GetActiveScene();
                RequiredMethod(serviceType, "OnSceneDirtied").Invoke(null, new object[] { sceneCopy });
                Assert.That(InitialSnapshotDirtyScenes(serviceType), Is.EquivalentTo(new[] { scene }));
                Assert.That(InitialSnapshotDirtyScenes(serviceType).Contains(default(Scene)), Is.False);

                var consumed = (HashSet<Scene>)RequiredMethod(
                    serviceType,
                    "ConsumeInitialTransformSnapshotDirtyScenes").Invoke(null, null);

                Assert.That(consumed.Contains(sceneCopy), Is.True);
                Assert.That(
                    (bool)RequiredField(serviceType, "_awaitingInitialTransformSnapshot").GetValue(null),
                    Is.False);
                Assert.That(InitialSnapshotDirtyScenes(serviceType), Is.Empty);

                RequiredMethod(serviceType, "OnSceneDirtied").Invoke(null, new object[] { scene });
                Assert.That(InitialSnapshotDirtyScenes(serviceType), Is.Empty);
                consumed.Clear();
                RequiredField(serviceType, "_awaitingInitialTransformSnapshot").SetValue(null, true);
                RequiredMethod(serviceType, "OnSceneDirtied").Invoke(null, new object[] { sceneCopy });
                Assert.That(InitialSnapshotDirtyScenes(serviceType).Contains(scene), Is.True);
                Assert.That(consumed, Is.Empty,
                    "Consumed membership must remain independent of the next snapshot's tracking.");
            }
            finally
            {
                ResetInitialSnapshotDirtyTracking(serviceType);
                AssertLoadedSceneObservationsUnchanged(observedScenes);
                Assert.That(SceneManager.GetActiveScene(), Is.EqualTo(scene));
            }
        }

        [Test]
        public void InitialSnapshotCapturesCurrentDirtyScenesWithoutChangingLoadedScenes()
        {
            var serviceType = typeof(TeamForgeTransformSyncService);
            var activeScene = SceneManager.GetActiveScene();
            var observedScenes = CaptureLoadedSceneObservations();
            var expectedDirtyScenes = new HashSet<Scene>();
            foreach (var observed in observedScenes)
            {
                if (observed.IsValid && observed.IsLoaded && observed.IsDirty)
                {
                    expectedDirtyScenes.Add(observed.Scene);
                }
            }

            try
            {
                ResetInitialSnapshotDirtyTracking(serviceType);
                var captured = (HashSet<Scene>)RequiredMethod(serviceType, "CaptureDirtyScenes").Invoke(null, null);
                Assert.That(captured, Is.EquivalentTo(expectedDirtyScenes));

                RequiredMethod(serviceType, "BeginInitialTransformSnapshotDirtyTracking").Invoke(null, null);
                Assert.That(InitialSnapshotDirtyScenes(serviceType), Is.EquivalentTo(expectedDirtyScenes));

                var consumed = (HashSet<Scene>)RequiredMethod(
                    serviceType, "ConsumeInitialTransformSnapshotDirtyScenes").Invoke(null, null);
                Assert.That(consumed, Is.EquivalentTo(expectedDirtyScenes));
                Assert.That(InitialSnapshotDirtyScenes(serviceType), Is.Empty);
                Assert.That(
                    (bool)RequiredField(serviceType, "_awaitingInitialTransformSnapshot").GetValue(null), Is.False);

                var fallback = (HashSet<Scene>)RequiredMethod(
                    serviceType, "ConsumeInitialTransformSnapshotDirtyScenes").Invoke(null, null);
                Assert.That(fallback, Is.EquivalentTo(expectedDirtyScenes));
            }
            finally
            {
                ResetInitialSnapshotDirtyTracking(serviceType);
                AssertLoadedSceneObservationsUnchanged(observedScenes);
                Assert.That(SceneManager.GetActiveScene(), Is.EqualTo(activeScene));
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

        private static List<LoadedSceneObservation> CaptureLoadedSceneObservations()
        {
            var observations = new List<LoadedSceneObservation>();
            for (var index = 0; index < SceneManager.sceneCount; index += 1)
            {
                observations.Add(new LoadedSceneObservation(SceneManager.GetSceneAt(index)));
            }
            return observations;
        }

        private static void AssertLoadedSceneObservationsUnchanged(List<LoadedSceneObservation> expected)
        {
            Assert.That(SceneManager.sceneCount, Is.EqualTo(expected.Count));
            for (var index = 0; index < expected.Count; index += 1)
            {
                var actual = new LoadedSceneObservation(SceneManager.GetSceneAt(index));
                Assert.That(actual.Scene, Is.EqualTo(expected[index].Scene));
                Assert.That(actual.IsValid, Is.EqualTo(expected[index].IsValid));
                Assert.That(actual.IsLoaded, Is.EqualTo(expected[index].IsLoaded));
                Assert.That(actual.Path, Is.EqualTo(expected[index].Path));
                Assert.That(actual.IsDirty, Is.EqualTo(expected[index].IsDirty));
                Assert.That(actual.RootCount, Is.EqualTo(expected[index].RootCount));
            }
        }

        private readonly struct LoadedSceneObservation
        {
            internal readonly Scene Scene;
            internal readonly bool IsValid;
            internal readonly bool IsLoaded;
            internal readonly string Path;
            internal readonly bool IsDirty;
            internal readonly int RootCount;

            internal LoadedSceneObservation(Scene scene)
            {
                Scene = scene;
                IsValid = scene.IsValid();
                IsLoaded = IsValid && scene.isLoaded;
                Path = IsValid ? scene.path : string.Empty;
                IsDirty = IsLoaded && scene.isDirty;
                RootCount = IsLoaded ? scene.rootCount : 0;
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

using System;
using System.Collections;
using System.Collections.Generic;
using System.Reflection;
using NUnit.Framework;
using UnityEditor;
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
            DirtySceneScenario scenes = null;

            try
            {
                scenes = new DirtySceneScenario();
                var localScene = scenes.First;
                var remoteScene = scenes.Second;
                Assert.That(localScene, Is.Not.EqualTo(remoteScene));
                Assert.That(SceneManager.SetActiveScene(localScene), Is.True);
                var target = new GameObject("Initial Snapshot Local Target");
                SceneManager.MoveGameObjectToScene(target, localScene);
                Assert.That(target.scene, Is.EqualTo(localScene));

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
                scenes?.Dispose();
            }
        }

        [Test]
        public void InitialSnapshotCapturesDirtyScenesAndRetainsSubsequentLocalDirtyEvents()
        {
            var serviceType = typeof(TeamForgeTransformSyncService);
            DirtySceneScenario scenes = null;

            try
            {
                scenes = new DirtySceneScenario();
                ResetInitialSnapshotDirtyTracking(serviceType);
                var initialScene = scenes.First;
                var subsequentScene = scenes.Second;
                Assert.That(initialScene, Is.Not.EqualTo(subsequentScene));
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
                scenes?.Dispose();
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

        private sealed class DirtySceneScenario : IDisposable
        {
            private readonly Scene _previousActiveScene;
            private readonly List<Scene> _ownedScenes = new List<Scene>();
            private readonly List<string> _ownedPaths = new List<string>();
            private string _folderPath = string.Empty;
            private bool _emptyRunnerReplaced;
            private bool _disposed;

            internal DirtySceneScenario()
            {
                _previousActiveScene = SceneManager.GetActiveScene();
                var replaceEmptyRunner = RequireSafeInitialScenes();
                try
                {
                    var folderGuid = AssetDatabase.CreateFolder(
                        "Assets", "__TeamForgeTransformDirtyScenes_" + Guid.NewGuid().ToString("N"));
                    Assert.That(folderGuid, Is.Not.Empty);
                    _folderPath = AssetDatabase.GUIDToAssetPath(folderGuid);
                    Assert.That(_folderPath, Is.Not.Empty);

                    First = CreateOwnedScene("First", replaceEmptyRunner ? NewSceneMode.Single : NewSceneMode.Additive);
                    Second = CreateOwnedScene("Second", NewSceneMode.Additive);
                }
                catch
                {
                    Dispose();
                    throw;
                }
            }

            internal Scene First { get; }
            internal Scene Second { get; }

            private static bool RequireSafeInitialScenes()
            {
                const string isolationMessage =
                    "Run these tests with saved Scenes or one clean empty untitled Scene; no user Scene was changed.";
                var activeScene = SceneManager.GetActiveScene();
                Assert.That(activeScene.IsValid() && activeScene.isLoaded, Is.True, isolationMessage);
                var hasUntitledScene = false;
                for (var index = 0; index < SceneManager.sceneCount; index += 1)
                {
                    if (string.IsNullOrWhiteSpace(SceneManager.GetSceneAt(index).path))
                    {
                        hasUntitledScene = true;
                    }
                }
                if (!hasUntitledScene)
                {
                    return false;
                }

                Assert.That(SceneManager.sceneCount, Is.EqualTo(1), isolationMessage);
                var onlyScene = SceneManager.GetSceneAt(0);
                Assert.That(onlyScene.IsValid() && onlyScene.isLoaded, Is.True, isolationMessage);
                Assert.That(onlyScene.isDirty, Is.False, isolationMessage);
                Assert.That(onlyScene.rootCount, Is.Zero, isolationMessage);
                return true;
            }

            private Scene CreateOwnedScene(string name, NewSceneMode mode)
            {
                var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, mode);
                _ownedScenes.Add(scene);
                if (mode == NewSceneMode.Single)
                {
                    _emptyRunnerReplaced = true;
                }
                var path = _folderPath + "/" + name + ".unity";
                _ownedPaths.Add(path);
                Assert.That(EditorSceneManager.SaveScene(scene, path), Is.True);
                return scene;
            }

            public void Dispose()
            {
                if (_disposed) return;
                _disposed = true;
                try
                {
                    if (_emptyRunnerReplaced)
                    {
                        for (var index = 0; index < SceneManager.sceneCount; index += 1)
                        {
                            Assert.That(_ownedScenes.Contains(SceneManager.GetSceneAt(index)), Is.True,
                                "An unowned Scene appeared; preserve it instead of replacing the Scene setup.");
                        }
                        EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                    }
                    else
                    {
                        Assert.That(_previousActiveScene.IsValid() && _previousActiveScene.isLoaded, Is.True);
                        Assert.That(SceneManager.SetActiveScene(_previousActiveScene), Is.True);
                    }
                }
                finally
                {
                    foreach (var scene in _ownedScenes)
                    {
                        if (scene.IsValid() && scene.isLoaded)
                        {
                            EditorSceneManager.CloseScene(scene, true);
                        }
                    }
                    foreach (var path in _ownedPaths)
                    {
                        AssetDatabase.DeleteAsset(path);
                    }
                    if (!string.IsNullOrEmpty(_folderPath) && AssetDatabase.IsValidFolder(_folderPath) &&
                        AssetDatabase.FindAssets(string.Empty, new[] { _folderPath }).Length == 0)
                    {
                        AssetDatabase.DeleteAsset(_folderPath);
                    }
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

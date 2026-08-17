using System;
using System.Collections.Generic;
using System.Reflection;
using System.Threading.Tasks;
using NUnit.Framework;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace EunSung.TeamForge.Tests
{
    public sealed class TeamForgeTransformModelTests
    {
        private const string TemporaryFolder = "Assets/__TeamForgePhase2Tests";

        [Test]
        public void CaptureComparisonAndNestedApplyScopeAreDeterministic()
        {
            var gameObject = new GameObject("Transform Model");
            try
            {
                gameObject.transform.localPosition = new Vector3(1, 2, 3);
                gameObject.transform.localRotation = Quaternion.Euler(10, 20, 30);
                gameObject.transform.localScale = new Vector3(2, 3, 4);
                var first = TeamForgeTransformState.Capture(gameObject.transform);
                var second = first.Clone();

                Assert.That(first.ApproximatelyEquals(second), Is.True);
                using (TeamForgeRemoteApplyScope.Enter())
                {
                    Assert.That(TeamForgeRemoteApplyScope.IsActive, Is.True);
                    using (TeamForgeRemoteApplyScope.Enter())
                    {
                        Assert.That(TeamForgeRemoteApplyScope.IsActive, Is.True);
                    }
                    Assert.That(TeamForgeRemoteApplyScope.IsActive, Is.True);
                }
                Assert.That(TeamForgeRemoteApplyScope.IsActive, Is.False);
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(gameObject);
            }
        }

        [Test]
        public void RemoteApplyMarksSceneDirtyWithoutAdvancingUndoGroup()
        {
            EnsureTemporaryFolder();
            var scenePath = $"{TemporaryFolder}/{Guid.NewGuid():N}.unity";
            Scene workingScene = default;

            try
            {
                workingScene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                var gameObject = new GameObject("Remote Transform");
                SceneManager.MoveGameObjectToScene(gameObject, workingScene);
                Assert.That(EditorSceneManager.SaveScene(workingScene, scenePath), Is.True);
                Assert.That(workingScene.isDirty, Is.False);
                Undo.IncrementCurrentGroup();
                var undoGroupBeforeApply = Undo.GetCurrentGroup();

                var remote = new TeamForgeTransformState
                {
                    LocalPosition = new Vector3(5, 6, 7),
                    LocalRotation = Quaternion.Euler(0, 45, 0),
                    LocalScale = new Vector3(2, 2, 2),
                };
                Assert.That(TeamForgeTransformState.ApplyRemote(gameObject, remote), Is.True);
                Assert.That(workingScene.isDirty, Is.True);
                Assert.That(gameObject.transform.localPosition, Is.EqualTo(remote.LocalPosition));
                Assert.That(Undo.GetCurrentGroup(), Is.EqualTo(undoGroupBeforeApply));
                Assert.That(TeamForgeRemoteApplyScope.IsActive, Is.False);
            }
            finally
            {
                if (workingScene.IsValid() && workingScene.isLoaded)
                {
                    workingScene = EditorSceneManager.NewScene(
                        NewSceneSetup.EmptyScene,
                        NewSceneMode.Single);
                }
                AssetDatabase.DeleteAsset(scenePath);
                RemoveTemporaryFolderIfEmpty();
            }
        }

        [Test]
        public void IdenticalRemoteApplyKeepsSavedSceneClean()
        {
            EnsureTemporaryFolder();
            var scenePath = $"{TemporaryFolder}/{Guid.NewGuid():N}.unity";
            Scene workingScene = default;

            try
            {
                workingScene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                var gameObject = new GameObject("No-op Remote Transform");
                SceneManager.MoveGameObjectToScene(gameObject, workingScene);
                gameObject.transform.localPosition = new Vector3(3, 2, 1);
                Assert.That(EditorSceneManager.SaveScene(workingScene, scenePath), Is.True);
                Assert.That(workingScene.isDirty, Is.False);

                var unchanged = TeamForgeTransformState.Capture(gameObject.transform);
                Assert.That(TeamForgeTransformState.ApplyRemote(gameObject, unchanged), Is.True);
                Assert.That(workingScene.isDirty, Is.False);
            }
            finally
            {
                if (workingScene.IsValid() && workingScene.isLoaded)
                {
                    workingScene = EditorSceneManager.NewScene(
                        NewSceneSetup.EmptyScene,
                        NewSceneMode.Single);
                }
                AssetDatabase.DeleteAsset(scenePath);
                RemoveTemporaryFolderIfEmpty();
            }
        }

        [Test]
        public void IdenticalAuthoritativeValueClearsStaleTargetUndoWithoutDirtyingScene()
        {
            EnsureTemporaryFolder();
            var scenePath = $"{TemporaryFolder}/{Guid.NewGuid():N}.unity";
            var previousActiveScene = SceneManager.GetActiveScene();
            var workingScene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            SceneManager.SetActiveScene(workingScene);
            var guard = new GameObject("No-op Undo Guard");
            var target = new GameObject("No-op Remote Target");
            var sentinel = new GameObject("No-op Undo Sentinel");

            try
            {
                RecordPositionUndo(guard, new Vector3(1, 0, 0), "No-op Guard");
                RecordPositionUndo(target, new Vector3(5, 0, 0), "Stale Equal Target");
                Assert.That(EditorSceneManager.SaveScene(workingScene, scenePath), Is.True);
                Assert.That(workingScene.isDirty, Is.False);

                var authoritative = TeamForgeTransformState.Capture(target.transform);
                Assert.That(TeamForgeTransformState.ApplyRemote(target, authoritative), Is.True);
                Assert.That(workingScene.isDirty, Is.False);

                RecordPositionUndo(sentinel, new Vector3(3, 0, 0), "No-op Sentinel");
                Undo.PerformUndo();
                Assert.That(target.transform.localPosition, Is.EqualTo(authoritative.LocalPosition));
                Undo.PerformUndo();
                Assert.That(guard.transform.localPosition, Is.EqualTo(Vector3.zero));
                Assert.That(target.transform.localPosition, Is.EqualTo(authoritative.LocalPosition));
            }
            finally
            {
                Undo.ClearUndo(guard.transform);
                Undo.ClearUndo(target.transform);
                Undo.ClearUndo(sentinel.transform);
                UnityEngine.Object.DestroyImmediate(guard);
                UnityEngine.Object.DestroyImmediate(target);
                UnityEngine.Object.DestroyImmediate(sentinel);
                if (previousActiveScene.IsValid() && previousActiveScene.isLoaded)
                {
                    SceneManager.SetActiveScene(previousActiveScene);
                }
                if (workingScene.IsValid() && workingScene.isLoaded)
                {
                    workingScene = EditorSceneManager.NewScene(
                        NewSceneSetup.EmptyScene,
                        NewSceneMode.Single);
                }
                AssetDatabase.DeleteAsset(scenePath);
                RemoveTemporaryFolderIfEmpty();
            }
        }

        [Test]
        public void CleanSceneBaselineExcludesObjectsCreatedAfterCapture()
        {
            EnsureTemporaryFolder();
            var scenePath = $"{TemporaryFolder}/{Guid.NewGuid():N}.unity";
            var previousActiveScene = SceneManager.GetActiveScene();
            var workingScene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            SceneManager.SetActiveScene(workingScene);

            try
            {
                var savedParent = new GameObject("Saved Baseline Parent");
                var savedObject = new GameObject("Saved Baseline Object");
                savedObject.transform.SetParent(savedParent.transform);
                Assert.That(EditorSceneManager.SaveScene(workingScene, scenePath), Is.True);
                var sceneId = AssetDatabase.AssetPathToGUID(scenePath);
                Assert.That(TeamForgeObjectIdentity.TryGetGlobalObjectId(savedObject, out var savedId), Is.True);
                Assert.That(TeamForgeObjectIdentity.TryGetGlobalObjectId(savedParent, out var parentId), Is.True);

                var baseline = new TeamForgeObjectBaselineRegistry();
                Assert.That(baseline.RegisterCleanScene(workingScene, out var error), Is.True, error);
                Assert.That(baseline.Contains(sceneId, savedId), Is.True);
                Assert.That(baseline.MatchesParent(sceneId, savedId, parentId), Is.True);

                savedObject.transform.SetParent(null);
                Assert.That(baseline.MatchesParent(sceneId, savedId, string.Empty), Is.False);

                var newUnsavedObject = new GameObject("New Unsaved Object");
                EditorSceneManager.MarkSceneDirty(workingScene);
                Assert.That(workingScene.isDirty, Is.True);
                var hasTemporaryId = TeamForgeObjectIdentity.TryGetGlobalObjectId(
                    newUnsavedObject,
                    out var temporaryId);
                Assert.That(baseline.Contains(sceneId, hasTemporaryId ? temporaryId : string.Empty), Is.False);
                var restored = new TeamForgeObjectBaselineRegistry();
                restored.ReplaceAll(baseline.Snapshot());
                Assert.That(restored.Contains(sceneId, savedId), Is.True);
                Assert.That(restored.MatchesParent(sceneId, savedId, parentId), Is.True);
                Assert.That(restored.Contains(sceneId, hasTemporaryId ? temporaryId : string.Empty), Is.False);
                Assert.That(baseline.RegisterCleanScene(workingScene, out error), Is.False);
                Assert.That(error, Does.Contain("unsaved"));
                Assert.That(EditorSceneManager.SaveScene(workingScene), Is.True);
                Assert.That(baseline.RegisterCleanSceneIfMissing(workingScene, out error), Is.True, error);
                Assert.That(
                    TeamForgeObjectIdentity.TryGetGlobalObjectId(newUnsavedObject, out var persistedNewId),
                    Is.True);
                Assert.That(baseline.Contains(sceneId, persistedNewId), Is.False);
            }
            finally
            {
                if (previousActiveScene.IsValid() && previousActiveScene.isLoaded)
                {
                    SceneManager.SetActiveScene(previousActiveScene);
                }
                if (workingScene.IsValid() && workingScene.isLoaded)
                {
                    workingScene = EditorSceneManager.NewScene(
                        NewSceneSetup.EmptyScene,
                        NewSceneMode.Single);
                }
                AssetDatabase.DeleteAsset(scenePath);
                RemoveTemporaryFolderIfEmpty();
            }
        }

        [Test]
        public void SavedBaselineLogicalAliasesCanonicalizeForTrackingLockAndTransform()
        {
            EnsureTemporaryFolder();
            var scenePath = $"{TemporaryFolder}/{Guid.NewGuid():N}.unity";
            Scene workingScene = default;
            GameObject parent = null;
            GameObject child = null;
            var parentLogicalId = string.Empty;
            var childLogicalId = string.Empty;
            var serviceType = typeof(TeamForgeTransformSyncService);
            var connectionType = typeof(TeamForgeConnectionService);
            var baselineField = RequiredStaticField(serviceType, "Baseline");
            var resetMethod = RequiredStaticMethod(serviceType, "ResetSelectionTracking");
            var beginTrackingMethod = RequiredStaticMethod(serviceType, "BeginTrackingSelection");
            var trySendMethod = RequiredStaticMethod(serviceType, "TrySendCurrentTransform");
            var selectedParentField = RequiredStaticField(serviceType, "_selectedParentObjectId");
            var selectedLockGrantedField = RequiredStaticField(serviceType, "_selectedLockGranted");
            var pendingLockRequestField = RequiredStaticField(serviceType, "_pendingLockRequestId");
            var selectedLockExpiresField = RequiredStaticField(serviceType, "_selectedLockExpiresAt");
            var nextTransformSendField = RequiredStaticField(serviceType, "_nextTransformSendAt");
            var transportField = RequiredStaticField(connectionType, "_transport");
            var stateField = RequiredStaticField(connectionType, "<State>k__BackingField");
            var transformAvailableField = RequiredStaticField(
                connectionType,
                "<TransformSyncAvailable>k__BackingField");
            var hierarchyAvailableField = RequiredStaticField(
                connectionType,
                "<HierarchySyncAvailable>k__BackingField");
            var connectionIdField = RequiredStaticField(connectionType, "<ConnectionId>k__BackingField");
            var messagesSentField = RequiredStaticField(connectionType, "<MessagesSent>k__BackingField");
            var authorityType = connectionType.Assembly.GetType(
                "EunSung.TeamForge.TeamForgeAuthorityView",
                true);
            var observeConnectionMethod = RequiredStaticMethod(authorityType, "ObserveConnection");
            var baseline = baselineField.GetValue(null) as TeamForgeObjectBaselineRegistry;
            Assert.That(baseline, Is.Not.Null);

            var previousTransport = transportField.GetValue(null);
            var previousState = stateField.GetValue(null);
            var previousTransformAvailable = transformAvailableField.GetValue(null);
            var previousHierarchyAvailable = hierarchyAvailableField.GetValue(null);
            var previousConnectionId = connectionIdField.GetValue(null);
            var previousMessagesSent = messagesSentField.GetValue(null);

            try
            {
                workingScene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                parent = new GameObject("Saved Alias Parent");
                child = new GameObject("Saved Alias Child");
                child.transform.SetParent(parent.transform);
                Assert.That(EditorSceneManager.SaveScene(workingScene, scenePath), Is.True);
                var sceneId = AssetDatabase.AssetPathToGUID(scenePath);
                Assert.That(TeamForgeObjectIdentity.TryGetGlobalObjectId(parent, out var parentGlobalId), Is.True);
                Assert.That(TeamForgeObjectIdentity.TryGetGlobalObjectId(child, out var childGlobalId), Is.True);

                baseline.Clear();
                Assert.That(baseline.RegisterCleanScene(workingScene, out var baselineError), Is.True, baselineError);
                Assert.That(baseline.Contains(sceneId, parentGlobalId), Is.True);
                Assert.That(baseline.Contains(sceneId, childGlobalId), Is.True);
                Assert.That(baseline.MatchesParent(sceneId, childGlobalId, parentGlobalId), Is.True);

                // A Test Lab clone has no Library identity cache, so the same saved object
                // resolves directly to its GlobalObjectId before an alias is bound.
                Assert.That(TeamForgeObjectIdentity.TryGetCollaborativeObjectId(child, out var cloneLikeId), Is.True);
                Assert.That(cloneLikeId, Is.EqualTo(childGlobalId));

                // The original Editor can retain these bindings in Library/TeamForge while
                // clones intentionally omit Library. The clean baseline must remain Global-ID
                // canonical in either local cache state.
                parentLogicalId = "tf:" + Guid.NewGuid().ToString("N");
                childLogicalId = "tf:" + Guid.NewGuid().ToString("N");
                Assert.That(TeamForgeHierarchyIdentityRegistry.BindLogical(parentLogicalId, parent), Is.True);
                Assert.That(TeamForgeHierarchyIdentityRegistry.BindLogical(childLogicalId, child), Is.True);
                TeamForgeHierarchyIdentityRegistry.ForgetLiveObject(parentLogicalId);
                TeamForgeHierarchyIdentityRegistry.ForgetLiveObject(childLogicalId);
                Assert.That(TeamForgeObjectIdentity.TryGetCollaborativeObjectId(parent, out var rawParentId), Is.True);
                Assert.That(TeamForgeObjectIdentity.TryGetCollaborativeObjectId(child, out var rawChildId), Is.True);
                Assert.That(rawParentId, Is.EqualTo(parentGlobalId));
                Assert.That(rawChildId, Is.EqualTo(childGlobalId));
                Assert.That(baseline.Contains(sceneId, childLogicalId), Is.False);

                var transport = CreateRecordingTransport(connectionType.Assembly, out var recorder);
                transportField.SetValue(null, transport);
                stateField.SetValue(null, TeamForgeConnectionState.Connected);
                transformAvailableField.SetValue(null, true);
                hierarchyAvailableField.SetValue(null, false);
                connectionIdField.SetValue(null, "field-hotfix-test-connection");
                observeConnectionMethod.Invoke(null, null);

                resetMethod.Invoke(null, null);
                Selection.activeObject = null;
                Selection.activeGameObject = child;
                beginTrackingMethod.Invoke(null, new object[] { true });

                Assert.That(TeamForgeTransformSyncService.SelectedObjectId, Is.EqualTo(childGlobalId));
                Assert.That(selectedParentField.GetValue(null), Is.EqualTo(parentGlobalId));
                var lockJson = FindMessage(recorder.SentTexts, "lock_request");
                Assert.That(lockJson, Is.Not.Empty);
                var lockRequest = TeamForgeProtocol.Deserialize<LockRequestMessage>(lockJson);
                Assert.That(lockRequest.type, Is.EqualTo("lock_request"));
                Assert.That(lockRequest.objectId, Is.EqualTo(childGlobalId));

                selectedLockGrantedField.SetValue(null, true);
                pendingLockRequestField.SetValue(null, string.Empty);
                selectedLockExpiresField.SetValue(null, 0d);
                nextTransformSendField.SetValue(null, 0d);
                child.transform.localPosition = new Vector3(7, 8, 9);

                Assert.That(trySendMethod.Invoke(null, new object[] { true }), Is.EqualTo(true));
                var updateJson = FindMessage(recorder.SentTexts, "transform_update");
                Assert.That(updateJson, Is.Not.Empty);
                var update = TeamForgeProtocol.Deserialize<TransformUpdateMessage>(updateJson);
                Assert.That(update.type, Is.EqualTo("transform_update"));
                Assert.That(update.objectId, Is.EqualTo(childGlobalId));
            }
            finally
            {
                selectedLockGrantedField.SetValue(null, false);
                pendingLockRequestField.SetValue(null, string.Empty);
                resetMethod.Invoke(null, null);
                ClearStaticCollection(serviceType, "PendingLocalOperations");
                ClearStaticCollection(serviceType, "PendingOperationByRequestId");
                baseline.Clear();
                Selection.activeObject = null;

                transportField.SetValue(null, previousTransport);
                stateField.SetValue(null, previousState);
                transformAvailableField.SetValue(null, previousTransformAvailable);
                hierarchyAvailableField.SetValue(null, previousHierarchyAvailable);
                connectionIdField.SetValue(null, previousConnectionId);
                messagesSentField.SetValue(null, previousMessagesSent);
                observeConnectionMethod.Invoke(null, null);

                if (!string.IsNullOrWhiteSpace(childLogicalId))
                {
                    TeamForgeHierarchyIdentityRegistry.ForgetLiveObject(childLogicalId);
                }
                if (!string.IsNullOrWhiteSpace(parentLogicalId))
                {
                    TeamForgeHierarchyIdentityRegistry.ForgetLiveObject(parentLogicalId);
                }
                if (workingScene.IsValid() && workingScene.isLoaded)
                {
                    workingScene = EditorSceneManager.NewScene(
                        NewSceneSetup.EmptyScene,
                        NewSceneMode.Single);
                }
                AssetDatabase.DeleteAsset(scenePath);
                RemoveTemporaryFolderIfEmpty();
            }
        }

        [Test]
        public void RemoteApplyClearsOnlyTargetUndoAndCannotResurrectStaleTransform()
        {
            var previousActiveScene = SceneManager.GetActiveScene();
            var workingScene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            SceneManager.SetActiveScene(workingScene);
            var guard = new GameObject("Undo Guard");
            var target = new GameObject("Remote Target");
            var sentinel = new GameObject("Undo Sentinel");
            try
            {
                RecordPositionUndo(guard, new Vector3(1, 0, 0), "TeamForge Guard");
                RecordPositionUndo(target, new Vector3(2, 0, 0), "TeamForge Stale Local Transform");
                RecordPositionUndo(sentinel, new Vector3(3, 0, 0), "TeamForge Sentinel");

                var remote = new TeamForgeTransformState
                {
                    LocalPosition = new Vector3(9, 8, 7),
                    LocalRotation = Quaternion.identity,
                    LocalScale = Vector3.one,
                };
                Assert.That(TeamForgeTransformState.ApplyRemote(target, remote), Is.True);

                Undo.PerformUndo();
                Assert.That(sentinel.transform.localPosition, Is.EqualTo(Vector3.zero));
                Assert.That(target.transform.localPosition, Is.EqualTo(remote.LocalPosition));

                Undo.PerformUndo();
                Assert.That(target.transform.localPosition, Is.EqualTo(remote.LocalPosition));
                if (guard.transform.localPosition != Vector3.zero)
                {
                    // Unity 6000.3 can preserve the now-empty target Undo group as a no-op step
                    // after Undo.ClearUndo(target). Consume that step without weakening the
                    // invariant that the authoritative remote transform must never resurrect
                    // the stale local value.
                    Undo.PerformUndo();
                }

                Assert.That(guard.transform.localPosition, Is.EqualTo(Vector3.zero));
                Assert.That(target.transform.localPosition, Is.EqualTo(remote.LocalPosition));
            }
            finally
            {
                Undo.ClearUndo(guard.transform);
                Undo.ClearUndo(target.transform);
                Undo.ClearUndo(sentinel.transform);
                UnityEngine.Object.DestroyImmediate(guard);
                UnityEngine.Object.DestroyImmediate(target);
                UnityEngine.Object.DestroyImmediate(sentinel);
                if (previousActiveScene.IsValid() && previousActiveScene.isLoaded)
                {
                    SceneManager.SetActiveScene(previousActiveScene);
                }
                if (workingScene.IsValid() && workingScene.isLoaded)
                {
                    workingScene = EditorSceneManager.NewScene(
                        NewSceneSetup.EmptyScene,
                        NewSceneMode.Single);
                }
            }
        }

        [Test]
        public void RemoteApplyToPrefabInstanceRecordsOverrideAndSurvivesReload()
        {
            EnsureTemporaryFolder();
            var token = Guid.NewGuid().ToString("N");
            var prefabPath = $"{TemporaryFolder}/{token}.prefab";
            var scenePath = $"{TemporaryFolder}/{token}.unity";
            Scene workingScene = default;
            var source = new GameObject("Transform Prefab Source");

            try
            {
                Assert.That(PrefabUtility.SaveAsPrefabAsset(source, prefabPath), Is.Not.Null);
                UnityEngine.Object.DestroyImmediate(source);
                source = null;

                workingScene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(prefabPath);
                var instance = PrefabUtility.InstantiatePrefab(prefab, workingScene) as GameObject;
                Assert.That(instance, Is.Not.Null);
                Assert.That(EditorSceneManager.SaveScene(workingScene, scenePath), Is.True);

                var remote = new TeamForgeTransformState
                {
                    LocalPosition = new Vector3(4, 5, 6),
                    LocalRotation = Quaternion.Euler(0, 30, 0),
                    LocalScale = new Vector3(2, 2, 2),
                };
                Assert.That(TeamForgeTransformState.ApplyRemote(instance, remote), Is.True);
                var modifications = PrefabUtility.GetPropertyModifications(instance);
                Assert.That(modifications, Is.Not.Null.And.Not.Empty);
                Assert.That(EditorSceneManager.SaveScene(workingScene), Is.True);

                workingScene = EditorSceneManager.NewScene(
                    NewSceneSetup.EmptyScene,
                    NewSceneMode.Single);
                workingScene = EditorSceneManager.OpenScene(scenePath, OpenSceneMode.Single);
                var roots = workingScene.GetRootGameObjects();
                Assert.That(roots.Length, Is.EqualTo(1));
                Assert.That(roots[0].transform.localPosition, Is.EqualTo(remote.LocalPosition));
                Assert.That(roots[0].transform.localScale, Is.EqualTo(remote.LocalScale));
                Assert.That(
                    Quaternion.Angle(roots[0].transform.localRotation, remote.LocalRotation),
                    Is.LessThan(0.01f));
            }
            finally
            {
                if (source != null)
                {
                    UnityEngine.Object.DestroyImmediate(source);
                }
                if (workingScene.IsValid() && workingScene.isLoaded)
                {
                    workingScene = EditorSceneManager.NewScene(
                        NewSceneSetup.EmptyScene,
                        NewSceneMode.Single);
                }
                AssetDatabase.DeleteAsset(scenePath);
                AssetDatabase.DeleteAsset(prefabPath);
                RemoveTemporaryFolderIfEmpty();
            }
        }

        [Test]
        public void AuthoritativeHierarchyCreateRearmsSelectedTransformTrackingAndPreservesPendingDelta()
        {
            EnsureTemporaryFolder();
            var scenePath = $"{TemporaryFolder}/{Guid.NewGuid():N}.unity";
            Scene workingScene = default;
            GameObject target = null;
            var logicalId = string.Empty;
            var serviceType = typeof(TeamForgeTransformSyncService);
            var connectionType = typeof(TeamForgeConnectionService);
            var hierarchyType = typeof(TeamForgeHierarchySyncService);
            var stateScope = new TeamForgeSharedEditorStateScope();
            var resetMethod = serviceType.GetMethod("ResetSelectionTracking", BindingFlags.Static | BindingFlags.NonPublic);
            var wasConnectedField = serviceType.GetField("_wasConnected", BindingFlags.Static | BindingFlags.NonPublic);
            var lastObservedField = serviceType.GetField("_lastObservedState", BindingFlags.Static | BindingFlags.NonPublic);
            var lastConfirmedField = serviceType.GetField("_lastConfirmedState", BindingFlags.Static | BindingFlags.NonPublic);
            var stateAtLockRequestField = serviceType.GetField("_stateAtLockRequest", BindingFlags.Static | BindingFlags.NonPublic);
            var dirtyField = serviceType.GetField("_dirty", BindingFlags.Static | BindingFlags.NonPublic);
            var transportField = RequiredStaticField(connectionType, "_transport");
            var connectionStateField = RequiredStaticField(connectionType, "<State>k__BackingField");
            var transformAvailableField = RequiredStaticField(
                connectionType,
                "<TransformSyncAvailable>k__BackingField");
            var hierarchyAvailableField = RequiredStaticField(
                connectionType,
                "<HierarchySyncAvailable>k__BackingField");
            var connectionIdField = RequiredStaticField(connectionType, "<ConnectionId>k__BackingField");
            var hierarchyWasConnectedField = RequiredStaticField(hierarchyType, "_wasConnected");
            var hierarchySnapshotReadyField = RequiredStaticField(hierarchyType, "_receivedSnapshot");
            var hierarchyPendingOperationField = RequiredStaticField(hierarchyType, "_pendingOperation");
            var identityEpochField = RequiredStaticField(
                typeof(TeamForgeHierarchyIdentityRegistry),
                "_connectionIdentityEpoch");
            Assert.That(resetMethod, Is.Not.Null);
            Assert.That(wasConnectedField, Is.Not.Null);
            Assert.That(lastObservedField, Is.Not.Null);
            Assert.That(lastConfirmedField, Is.Not.Null);
            Assert.That(stateAtLockRequestField, Is.Not.Null);
            Assert.That(dirtyField, Is.Not.Null);

            var baseline = TeamForgeTransformSyncService.SelectionBaseline;

            try
            {
                var transport = CreateRecordingTransport(connectionType.Assembly, out var recorder);
                transportField.SetValue(null, transport);
                connectionStateField.SetValue(null, TeamForgeConnectionState.Connected);
                transformAvailableField.SetValue(null, true);
                hierarchyAvailableField.SetValue(null, true);
                connectionIdField.SetValue(null, "hierarchy-rearm-test-connection");
                RequiredStaticMethod(typeof(TeamForgeAuthorityView), "ObserveConnection").Invoke(null, null);
                TeamForgeHierarchyIdentityRegistry.BeginConnectionIdentityEpoch(
                    "hierarchy-rearm-test-connection");
                wasConnectedField.SetValue(null, true);
                hierarchyWasConnectedField.SetValue(null, true);
                hierarchySnapshotReadyField.SetValue(null, false);
                hierarchyPendingOperationField.SetValue(null, null);

                var authority = TeamForgeAuthorityView.Current;
                Assert.That(authority.IsConnected, Is.True);
                Assert.That(authority.TransformSyncAvailable, Is.True);
                Assert.That(authority.HierarchySyncAvailable, Is.True);
                Assert.That(
                    authority.ConnectionId,
                    Is.EqualTo("hierarchy-rearm-test-connection"));
                Assert.That(identityEpochField.GetValue(null), Is.EqualTo("hierarchy-rearm-test-connection"));
                Assert.That(hierarchyWasConnectedField.GetValue(null), Is.EqualTo(true));
                Assert.That(hierarchySnapshotReadyField.GetValue(null), Is.EqualTo(false));
                Assert.That(hierarchyPendingOperationField.GetValue(null), Is.Null);

                workingScene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                Assert.That(EditorSceneManager.SaveScene(workingScene, scenePath), Is.True);
                var sceneId = AssetDatabase.AssetPathToGUID(scenePath);
                Assert.That(sceneId, Is.Not.Empty);

                target = new GameObject("Pending Hierarchy Create");
                SceneManager.MoveGameObjectToScene(target, workingScene);
                logicalId = TeamForgeHierarchyIdentityRegistry.GetOrCreateLogicalId(target);
                Assert.That(TeamForgeHierarchyIdentityRegistry.IsLogicalId(logicalId), Is.True);
                Assert.That(SessionLogicalIdContains(logicalId), Is.True);

                baseline.Clear();
                resetMethod.Invoke(null, null);
                TeamForgeSharedEditorStateScope.SetSingleSelection(target);
                AssertSingleSelection(target);
                Assert.That(TeamForgeTransformSyncService.SelectedObjectId, Is.Empty);
                Assert.That(
                    TeamForgeTransformSyncService.ResolveTransformSelectionIdentity(target).Rejection,
                    Is.EqualTo(TeamForgeTransformSelectionRejection.AwaitingHierarchySnapshot));

                hierarchySnapshotReadyField.SetValue(null, true);
                Assert.That(hierarchySnapshotReadyField.GetValue(null), Is.EqualTo(true));
                AssertSingleSelection(target);
                Assert.That(TeamForgeTransformSyncService.SelectedObjectId, Is.Empty);
                Assert.That(baseline.Contains(sceneId, logicalId), Is.False);
                var missingBaseline = TeamForgeTransformSyncService.ResolveTransformSelectionIdentity(target);
                Assert.That(missingBaseline.SceneId, Is.EqualTo(sceneId));
                Assert.That(
                    missingBaseline.Rejection,
                    Is.EqualTo(TeamForgeTransformSelectionRejection.ObjectIdentityUnavailable),
                    "A current logical ID that is absent from the authoritative baseline must remain rejected.");

                var authoritativeTransform = new TeamForgeTransformState
                {
                    LocalPosition = Vector3.zero,
                    LocalRotation = Quaternion.identity,
                    LocalScale = Vector3.one,
                };
                target.transform.localPosition = new Vector3(4, 5, 6);
                var authoritativeState = new TeamForgeHierarchyState
                {
                    SceneId = sceneId,
                    ObjectId = logicalId,
                    Name = target.name,
                    ParentObjectId = string.Empty,
                    SiblingIndex = target.transform.GetSiblingIndex(),
                    Transform = authoritativeTransform.Clone(),
                    CreatedRevision = 1,
                    HierarchyRevision = 1,
                };

                AssertSingleSelection(target);
                Assert.That(hierarchySnapshotReadyField.GetValue(null), Is.EqualTo(true));
                Assert.That(hierarchyPendingOperationField.GetValue(null), Is.Null);
                TeamForgeTransformSyncService.ApplyHierarchyAuthoritativeState(
                    new[] { authoritativeState },
                    sceneId,
                    Array.Empty<string>());

                Assert.That(TeamForgeTransformSyncService.SelectedObjectId, Is.EqualTo(logicalId));
                var resolved = TeamForgeTransformSyncService.ResolveTransformSelectionIdentity(target);
                Assert.That(resolved.Rejection, Is.EqualTo(TeamForgeTransformSelectionRejection.None));
                Assert.That(resolved.SceneId, Is.EqualTo(sceneId));
                Assert.That(resolved.ObjectId, Is.EqualTo(logicalId));
                Assert.That(resolved.ParentObjectId, Is.Empty);
                Assert.That(target.transform.localPosition, Is.EqualTo(new Vector3(4, 5, 6)));
                var lockJson = FindMessage(recorder.SentTexts, "lock_request");
                Assert.That(lockJson, Is.Not.Empty);
                Assert.That(
                    TeamForgeProtocol.Deserialize<LockRequestMessage>(lockJson).objectId,
                    Is.EqualTo(logicalId));

                var lastObserved = lastObservedField.GetValue(null) as TeamForgeTransformState;
                var lastConfirmed = lastConfirmedField.GetValue(null) as TeamForgeTransformState;
                var stateAtLockRequest = stateAtLockRequestField.GetValue(null) as TeamForgeTransformState;
                Assert.That(lastObserved, Is.Not.Null);
                Assert.That(lastConfirmed, Is.Not.Null);
                Assert.That(stateAtLockRequest, Is.Not.Null);
                Assert.That(lastObserved.ApproximatelyEquals(authoritativeTransform), Is.True);
                Assert.That(lastConfirmed.ApproximatelyEquals(authoritativeTransform), Is.True);
                Assert.That(stateAtLockRequest.ApproximatelyEquals(authoritativeTransform), Is.True);
                Assert.That((bool)dirtyField.GetValue(null), Is.True);
            }
            finally
            {
                wasConnectedField.SetValue(null, false);
                resetMethod.Invoke(null, null);
                if (!string.IsNullOrWhiteSpace(logicalId))
                {
                    TeamForgeHierarchyIdentityRegistry.ForgetLiveObject(logicalId);
                }
                if (target != null)
                {
                    UnityEngine.Object.DestroyImmediate(target);
                }
                if (workingScene.IsValid() && workingScene.isLoaded)
                {
                    workingScene = EditorSceneManager.NewScene(
                        NewSceneSetup.EmptyScene,
                        NewSceneMode.Single);
                }
                AssetDatabase.DeleteAsset(scenePath);
                RemoveTemporaryFolderIfEmpty();
                stateScope.Dispose();
            }
        }

        [Test]
        public void LockRegistryRejectsInvalidReplacementAtomically()
        {
            var registry = new TeamForgeLockRegistry();
            var valid = ValidLock("object-a");
            Assert.That(registry.ReplaceAll(new[] { valid }, out var initialError), Is.True, initialError);

            var invalid = ValidLock("object-b");
            invalid.ownerColor = "not-a-color";
            Assert.That(registry.ReplaceAll(new[] { invalid }, out var error), Is.False);
            Assert.That(error, Does.Contain("invalid"));
            Assert.That(registry.TryGet("scene-guid", "object-a", out _), Is.True);
            Assert.That(registry.Count, Is.EqualTo(1));
        }

        [Test]
        public void TransformMessageRejectsZeroQuaternion()
        {
            var message = new TransformAppliedMessage
            {
                operationId = "operation-1",
                userId = "editor-a",
                sceneId = "scene-guid",
                objectId = "object-a",
                baseRevision = 0,
                serverRevision = 1,
                localPosition = new TeamForgeVector3Dto(),
                localRotation = new TeamForgeQuaternionDto { w = 0 },
                localScale = new TeamForgeVector3Dto { x = 1, y = 1, z = 1 },
            };

            Assert.That(
                TeamForgeTransformState.TryFromMessage(message, out _, out var error),
                Is.False);
            Assert.That(error, Does.Contain("quaternion"));
        }

        private static TeamForgeLockRecord ValidLock(string objectId)
        {
            return new TeamForgeLockRecord
            {
                sceneId = "scene-guid",
                objectId = objectId,
                ownerUserId = "editor-a",
                ownerConnectionId = "connection-a",
                ownerDisplayName = "Editor A",
                ownerColor = "#64B5F6",
                expiresAtUnixMs = 1786000015000,
            };
        }

        private static void RecordPositionUndo(GameObject gameObject, Vector3 position, string name)
        {
            Undo.IncrementCurrentGroup();
            Undo.SetCurrentGroupName(name);
            Undo.RecordObject(gameObject.transform, name);
            gameObject.transform.localPosition = position;
            Undo.FlushUndoRecordObjects();
        }

        private static void EnsureTemporaryFolder()
        {
            if (!AssetDatabase.IsValidFolder(TemporaryFolder))
            {
                AssetDatabase.CreateFolder("Assets", "__TeamForgePhase2Tests");
            }
        }

        private static void RemoveTemporaryFolderIfEmpty()
        {
            if (AssetDatabase.IsValidFolder(TemporaryFolder) &&
                AssetDatabase.FindAssets(string.Empty, new[] { TemporaryFolder }).Length == 0)
            {
                AssetDatabase.DeleteAsset(TemporaryFolder);
            }
        }

        private static FieldInfo RequiredStaticField(Type type, string name)
        {
            return type.GetField(name, BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic) ??
                   throw new MissingFieldException(type.FullName, name);
        }

        private static MethodInfo RequiredStaticMethod(Type type, string name)
        {
            return type.GetMethod(name, BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic) ??
                   throw new MissingMethodException(type.FullName, name);
        }

        private static PropertyInfo RequiredStaticProperty(Type type, string name)
        {
            return type.GetProperty(name, BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic) ??
                   throw new MissingMemberException(type.FullName, name);
        }

        private static T ReadInstanceProperty<T>(object target, string name)
        {
            if (target == null)
            {
                throw new ArgumentNullException(nameof(target));
            }
            var property = target.GetType().GetProperty(
                name,
                BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
            if (property == null)
            {
                throw new MissingMemberException(target.GetType().FullName, name);
            }
            return (T)property.GetValue(target);
        }

        private static void AssertSingleSelection(GameObject target)
        {
            Assert.That(Selection.activeGameObject, Is.SameAs(target));
            Assert.That(Selection.gameObjects, Is.Not.Null);
            Assert.That(Selection.gameObjects.Length, Is.EqualTo(1));
            Assert.That(Selection.gameObjects[0], Is.SameAs(target));
        }

        private static bool SessionLogicalIdContains(string logicalId)
        {
            var collection = RequiredStaticField(
                    typeof(TeamForgeHierarchyIdentityRegistry),
                    "SessionCanonicalLogicalIds")
                .GetValue(null);
            var contains = collection?.GetType().GetMethod("Contains", new[] { typeof(string) });
            return contains != null && (bool)contains.Invoke(collection, new object[] { logicalId });
        }

        private static void ClearStaticCollection(Type type, string fieldName)
        {
            var value = RequiredStaticField(type, fieldName).GetValue(null);
            value?.GetType().GetMethod("Clear", BindingFlags.Instance | BindingFlags.Public)?.Invoke(value, null);
        }

        private static object CreateRecordingTransport(Assembly editorAssembly, out RecordingTransportProxy recorder)
        {
            var transportInterface = editorAssembly.GetType("EunSung.TeamForge.IRealtimeTransport", true);
            MethodInfo createMethod = null;
            foreach (var method in typeof(DispatchProxy).GetMethods(BindingFlags.Static | BindingFlags.Public))
            {
                if (method.Name == "Create" &&
                    method.IsGenericMethodDefinition &&
                    method.GetGenericArguments().Length == 2 &&
                    method.GetParameters().Length == 0)
                {
                    createMethod = method;
                    break;
                }
            }
            Assert.That(createMethod, Is.Not.Null);
            var transport = createMethod.MakeGenericMethod(
                transportInterface,
                typeof(RecordingTransportProxy)).Invoke(null, null);
            recorder = transport as RecordingTransportProxy;
            Assert.That(recorder, Is.Not.Null);
            return transport;
        }

        private static string FindMessage(IEnumerable<string> messages, string messageType)
        {
            foreach (var message in messages)
            {
                if (TeamForgeProtocol.TryReadEnvelope(message, out var envelope, out _) &&
                    envelope.type == messageType)
                {
                    return message;
                }
            }
            return string.Empty;
        }

        public class RecordingTransportProxy : DispatchProxy
        {
            public List<string> SentTexts { get; } = new List<string>();

            protected override object Invoke(MethodInfo targetMethod, object[] args)
            {
                if (targetMethod.Name == "SendTextAsync")
                {
                    SentTexts.Add(args[0] as string ?? string.Empty);
                    return Task.CompletedTask;
                }
                if (targetMethod.ReturnType == typeof(Task))
                {
                    return Task.CompletedTask;
                }
                return null;
            }
        }
    }
}

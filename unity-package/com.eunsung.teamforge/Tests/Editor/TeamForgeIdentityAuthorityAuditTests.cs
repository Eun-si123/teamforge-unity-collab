using System;
using System.Collections;
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
    public sealed class TeamForgeIdentityAuthorityAuditTests
    {
        private const string TemporaryFolder = "Assets/__TeamForgeIdentityAuthorityAuditTests";

        [TestCase(true, false)]
        [TestCase(false, true)]
        [TestCase(true, true)]
        [TestCase(false, false)]
        public void SavedPresenceIdentityIsDirectionIndependentAcrossMixedLibraryCaches(
            bool editorAHasCache,
            bool editorBHasCache)
        {
            EnsureTemporaryFolder();
            var scenePath = $"{TemporaryFolder}/{Guid.NewGuid():N}.unity";
            Scene workingScene = default;
            GameObject target = null;
            var logicalId = "tf:" + Guid.NewGuid().ToString("N");

            try
            {
                workingScene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                target = new GameObject("Saved Presence Target");
                Assert.That(EditorSceneManager.SaveScene(workingScene, scenePath), Is.True);
                Assert.That(TeamForgeObjectIdentity.TryGetGlobalObjectId(target, out var globalId), Is.True);

                AssertDirectionResolves(target, globalId, logicalId, editorAHasCache, editorBHasCache, "A -> B");
                AssertDirectionResolves(target, globalId, logicalId, editorBHasCache, editorAHasCache, "B -> A");
            }
            finally
            {
                RemoveIdentityMappings(target, logicalId);
                Selection.activeObject = null;
                if (workingScene.IsValid() && workingScene.isLoaded)
                {
                    EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                }
                AssetDatabase.DeleteAsset(scenePath);
                RemoveTemporaryFolderIfEmpty();
            }
        }

        [Test]
        public void SavedParentChildUseGlobalCanonicalFamilyAcrossPresenceTransformAndHierarchy()
        {
            EnsureTemporaryFolder();
            var scenePath = $"{TemporaryFolder}/{Guid.NewGuid():N}.unity";
            Scene workingScene = default;
            GameObject parent = null;
            GameObject child = null;
            var parentLogicalId = "tf:" + Guid.NewGuid().ToString("N");
            var childLogicalId = "tf:" + Guid.NewGuid().ToString("N");
            var authoritative = GetStaticField(typeof(TeamForgeHierarchySyncService), "Authoritative").GetValue(null);

            try
            {
                workingScene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                parent = new GameObject("Saved Parent");
                child = new GameObject("Saved Child");
                child.transform.SetParent(parent.transform);
                Assert.That(EditorSceneManager.SaveScene(workingScene, scenePath), Is.True);
                var sceneId = AssetDatabase.AssetPathToGUID(scenePath);
                Assert.That(TeamForgeObjectIdentity.TryGetGlobalObjectId(parent, out var parentGlobalId), Is.True);
                Assert.That(TeamForgeObjectIdentity.TryGetGlobalObjectId(child, out var childGlobalId), Is.True);

                InstallPersistedAlias(parent, parentGlobalId, parentLogicalId);
                InstallPersistedAlias(child, childGlobalId, childLogicalId);

                Selection.activeGameObject = child;
                Assert.That(CaptureSelectedPresenceId(), Is.EqualTo(childGlobalId));

                var baseline = new TeamForgeObjectBaselineRegistry();
                Assert.That(baseline.RegisterCleanScene(workingScene, out var error), Is.True, error);
                Assert.That(baseline.TryGetCanonicalObjectId(sceneId, child, out var objectId), Is.True);
                Assert.That(baseline.TryGetCanonicalParentObjectId(sceneId, child, out var parentId), Is.True);
                Assert.That(objectId, Is.EqualTo(childGlobalId));
                Assert.That(parentId, Is.EqualTo(parentGlobalId));
                Assert.That(baseline.MatchesParent(sceneId, objectId, parentId), Is.True);

                ClearCollection(authoritative);
                UpsertHierarchy(authoritative, State(sceneId, parentGlobalId, parent.name, string.Empty, 0));
                UpsertHierarchy(authoritative, State(sceneId, childGlobalId, child.name, parentGlobalId, 0));
                var captureArguments = new object[] { workingScene, false, null, null, null };
                var captured = (bool)GetStaticMethod(typeof(TeamForgeHierarchySyncService), "TryCaptureScene")
                    .Invoke(null, captureArguments);
                Assert.That(captured, Is.True, captureArguments[4] as string);
                var states = captureArguments[2] as List<TeamForgeHierarchyState>;
                Assert.That(states, Is.Not.Null);
                var childState = states.Find(state => state.ObjectId == childGlobalId);
                Assert.That(childState, Is.Not.Null);
                Assert.That(childState.ParentObjectId, Is.EqualTo(parentGlobalId));
            }
            finally
            {
                ClearCollection(authoritative);
                RemoveIdentityMappings(child, childLogicalId);
                RemoveIdentityMappings(parent, parentLogicalId);
                Selection.activeObject = null;
                if (workingScene.IsValid() && workingScene.isLoaded)
                {
                    EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                }
                AssetDatabase.DeleteAsset(scenePath);
                RemoveTemporaryFolderIfEmpty();
            }
        }

        [Test]
        public void RuntimeLogicalIdentityRemainsCanonicalAfterSaveAndAuthoritativeBaselineUpsert()
        {
            EnsureTemporaryFolder();
            var scenePath = $"{TemporaryFolder}/{Guid.NewGuid():N}.unity";
            Scene workingScene = default;
            GameObject parent = null;
            GameObject child = null;
            var parentLogicalId = string.Empty;
            var childLogicalId = string.Empty;

            try
            {
                workingScene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                Assert.That(EditorSceneManager.SaveScene(workingScene, scenePath), Is.True);
                var sceneId = AssetDatabase.AssetPathToGUID(scenePath);

                parent = new GameObject("Runtime Parent");
                child = new GameObject("Runtime Child");
                child.transform.SetParent(parent.transform);
                parentLogicalId = TeamForgeHierarchyIdentityRegistry.GetOrCreateLogicalId(parent);
                childLogicalId = TeamForgeHierarchyIdentityRegistry.GetOrCreateLogicalId(child);

                var baseline = new TeamForgeObjectBaselineRegistry();
                baseline.Upsert(sceneId, parentLogicalId, string.Empty);
                baseline.Upsert(sceneId, childLogicalId, parentLogicalId);
                Assert.That(EditorSceneManager.SaveScene(workingScene), Is.True);
                Assert.That(TeamForgeObjectIdentity.TryGetGlobalObjectId(child, out _), Is.True);

                Selection.activeGameObject = child;
                Assert.That(CaptureSelectedPresenceId(), Is.EqualTo(childLogicalId));
                Assert.That(baseline.TryGetCanonicalObjectId(sceneId, child, out var objectId), Is.True);
                Assert.That(baseline.TryGetCanonicalParentObjectId(sceneId, child, out var parentId), Is.True);
                Assert.That(objectId, Is.EqualTo(childLogicalId));
                Assert.That(parentId, Is.EqualTo(parentLogicalId));
                Assert.That(baseline.MatchesParent(sceneId, objectId, parentId), Is.True);

                var savedOnlyBaseline = new TeamForgeObjectBaselineRegistry();
                Assert.That(savedOnlyBaseline.RegisterCleanScene(workingScene, out var savedError), Is.True, savedError);
                Assert.That(
                    savedOnlyBaseline.TryGetCanonicalObjectId(sceneId, child, out _),
                    Is.False,
                    "A current-session logical child must not fall back to a different saved Global key.");
                Assert.That(
                    savedOnlyBaseline.TryGetCanonicalParentObjectId(sceneId, child, out _),
                    Is.False,
                    "A current-session logical parent must not fall back to a different saved Global key.");
            }
            finally
            {
                if (!string.IsNullOrEmpty(childLogicalId)) TeamForgeHierarchyIdentityRegistry.ForgetLiveObject(childLogicalId);
                if (!string.IsNullOrEmpty(parentLogicalId)) TeamForgeHierarchyIdentityRegistry.ForgetLiveObject(parentLogicalId);
                Selection.activeObject = null;
                if (workingScene.IsValid() && workingScene.isLoaded)
                {
                    EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                }
                AssetDatabase.DeleteAsset(scenePath);
                RemoveTemporaryFolderIfEmpty();
            }
        }

        [Test]
        public void PresenceSelectionRecomputesWhenCurrentSessionLogicalIdentityChanges()
        {
            EnsureTemporaryFolder();
            var scenePath = $"{TemporaryFolder}/{Guid.NewGuid():N}.unity";
            Scene workingScene = default;
            GameObject target = null;
            var logicalId = "tf:" + Guid.NewGuid().ToString("N");

            try
            {
                workingScene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                target = new GameObject("Presence Identity Transition");
                Assert.That(EditorSceneManager.SaveScene(workingScene, scenePath), Is.True);
                Assert.That(TeamForgeObjectIdentity.TryGetGlobalObjectId(target, out var globalId), Is.True);
                InstallPersistedAlias(target, globalId, logicalId);

                Selection.activeGameObject = target;
                Assert.That(CaptureSelectedPresenceId(), Is.EqualTo(globalId));

                Assert.That(TeamForgeHierarchyIdentityRegistry.BindLogical(logicalId, target), Is.True);
                Assert.That(
                    ReadSampleString(CapturePresenceSample(false), "SelectedObjectId"),
                    Is.EqualTo(logicalId),
                    "The same Unity selection must be recanonicalized after current-session identity changes.");
            }
            finally
            {
                RemoveIdentityMappings(target, logicalId);
                Selection.activeObject = null;
                if (workingScene.IsValid() && workingScene.isLoaded)
                {
                    EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                }
                AssetDatabase.DeleteAsset(scenePath);
                RemoveTemporaryFolderIfEmpty();
            }
        }

        [Test]
        public void PresenceDoesNotResolvePersistedLogicalAliasUntilCurrentSessionConfirmsIt()
        {
            EnsureTemporaryFolder();
            var scenePath = $"{TemporaryFolder}/{Guid.NewGuid():N}.unity";
            Scene workingScene = default;
            GameObject target = null;
            var logicalId = "tf:" + Guid.NewGuid().ToString("N");

            try
            {
                workingScene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                target = new GameObject("Unconfirmed Presence Alias");
                Assert.That(EditorSceneManager.SaveScene(workingScene, scenePath), Is.True);
                Assert.That(TeamForgeObjectIdentity.TryGetGlobalObjectId(target, out var globalId), Is.True);
                InstallPersistedAlias(target, globalId, logicalId);

                ClearPresenceResolvedObjects();
                var beforeArguments = new object[] { logicalId, null };
                var before = (bool)GetStaticMethod(typeof(TeamForgePresenceService), "TryResolveObject")
                    .Invoke(null, beforeArguments);
                Assert.That(before, Is.False, "A Library-only alias must not acquire current-session authority.");

                Assert.That(TeamForgeHierarchyIdentityRegistry.BindLogical(logicalId, target), Is.True);
                ClearPresenceResolvedObjects();
                var afterArguments = new object[] { logicalId, null };
                var after = (bool)GetStaticMethod(typeof(TeamForgePresenceService), "TryResolveObject")
                    .Invoke(null, afterArguments);
                Assert.That(after, Is.True);
                Assert.That(afterArguments[1], Is.SameAs(target));
            }
            finally
            {
                RemoveIdentityMappings(target, logicalId);
                Selection.activeObject = null;
                if (workingScene.IsValid() && workingScene.isLoaded)
                {
                    EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                }
                AssetDatabase.DeleteAsset(scenePath);
                RemoveTemporaryFolderIfEmpty();
            }
        }

        [Test]
        public void ReconnectRevokesPriorLogicalIdentityAndWaitsForHierarchySnapshot()
        {
            ReconnectRearmScenario scenario = null;
            try
            {
                scenario = new ReconnectRearmScenario();
                Assert.That(TeamForgeTransformSyncService.TrackedObject, Is.Null);
                AssertSingleSelection(scenario.Target);
                Assert.That(scenario.SelectedSceneId, Is.EqualTo(scenario.SceneId));
                Assert.That(
                    TeamForgeHierarchyIdentityRegistry.IsSessionCanonicalLogicalId(scenario.LogicalId),
                    Is.False);
                Assert.That(scenario.Baseline.Contains(scenario.SceneId, scenario.GlobalId), Is.True);
                Assert.That(TeamForgeHierarchySyncService.SnapshotReady, Is.False);
                Assert.That(
                    TeamForgeHierarchySyncService.IsOperationPendingFor(
                        scenario.SceneId,
                        scenario.LogicalId),
                    Is.False);
                AssertAuthority(scenario.ConnectionId);

                var resolution = scenario.ResolveSelection();
                Assert.That(
                    resolution.Rejection,
                    Is.EqualTo(TeamForgeTransformSelectionRejection.AwaitingHierarchySnapshot));
                Assert.That(TeamForgeTransformSyncService.SelectedObjectId, Is.Empty);
                Assert.That(FindMessage(scenario.Recorder.SentTexts, "lock_request"), Is.Empty);

                var revisionBeforeRejectedMessages = TeamForgeTransformSyncService.CurrentRevision;
                var lockCountBeforeRejectedMessages = TeamForgeTransformSyncService.Locks.Count;
                scenario.SendTransformApplied(
                    scenario.GlobalId,
                    "pre-hierarchy-global-transform",
                    4,
                    new Vector3(5, 6, 7));
                scenario.SendTransformApplied(
                    scenario.LogicalId,
                    "pre-hierarchy-logical-transform",
                    5,
                    new Vector3(8, 9, 10));
                Assert.That(scenario.Target.transform.localPosition, Is.EqualTo(Vector3.zero));
                Assert.That(
                    TeamForgeTransformSyncService.CurrentRevision,
                    Is.EqualTo(revisionBeforeRejectedMessages));
                Assert.That(
                    TeamForgeTransformSyncService.Locks.Count,
                    Is.EqualTo(lockCountBeforeRejectedMessages));
            }
            finally
            {
                scenario?.Dispose();
            }
        }

        [Test]
        public void HierarchyConfirmationEstablishesCurrentLogicalSelectionIdentity()
        {
            ReconnectRearmScenario scenario = null;
            try
            {
                scenario = new ReconnectRearmScenario();
                scenario.EstablishHierarchyAuthority();

                Assert.That(
                    TeamForgeHierarchyIdentityRegistry.IsSessionCanonicalLogicalId(scenario.LogicalId),
                    Is.True);
                Assert.That(scenario.Baseline.Contains(scenario.SceneId, scenario.GlobalId), Is.True);
                Assert.That(scenario.Baseline.Contains(scenario.SceneId, scenario.LogicalId), Is.True);
                Assert.That(TeamForgeHierarchySyncService.SnapshotReady, Is.True);
                Assert.That(
                    TeamForgeHierarchySyncService.IsOperationPendingFor(
                        scenario.SceneId,
                        scenario.LogicalId),
                    Is.False);

                var resolution = scenario.ResolveSelection();
                AssertCanonicalResolution(scenario, resolution);
                Assert.That(TeamForgeTransformSyncService.TrackedObject, Is.Null);
                Assert.That(TeamForgeTransformSyncService.SelectedObjectId, Is.Empty);
            }
            finally
            {
                scenario?.Dispose();
            }
        }

        [Test]
        public void AuthoritativeConfirmationAutomaticallyRearmsSelectedTransform()
        {
            ReconnectRearmScenario scenario = null;
            try
            {
                scenario = new ReconnectRearmScenario();
                scenario.EstablishHierarchyAuthority();
                Assert.That(TeamForgeTransformSyncService.TrackedObject, Is.Null);
                AssertSingleSelection(scenario.Target);
                AssertCanonicalResolution(scenario, scenario.ResolveSelection());
                AssertAuthority(scenario.ConnectionId);

                scenario.ApplyHierarchyAuthority();

                Assert.That(scenario.Baseline.Contains(scenario.SceneId, scenario.LogicalId), Is.True);
                AssertCanonicalResolution(scenario, scenario.ResolveSelection());
                Assert.That(TeamForgeTransformSyncService.TrackedObject, Is.SameAs(scenario.Target));
                Assert.That(TeamForgeTransformSyncService.SelectedObjectId, Is.EqualTo(scenario.LogicalId));
            }
            finally
            {
                scenario?.Dispose();
            }
        }

        [Test]
        public void AutomaticRearmRequestsLockWithCurrentCanonicalLogicalIdentity()
        {
            ReconnectRearmScenario scenario = null;
            try
            {
                scenario = new ReconnectRearmScenario();
                scenario.EstablishHierarchyAuthority();
                scenario.ApplyHierarchyAuthority();

                var lockJson = FindMessage(scenario.Recorder.SentTexts, "lock_request");
                Assert.That(lockJson, Is.Not.Empty);
                var request = TeamForgeProtocol.Deserialize<LockRequestMessage>(lockJson);
                Assert.That(request.sceneId, Is.EqualTo(scenario.SceneId));
                Assert.That(request.objectId, Is.EqualTo(scenario.LogicalId));
                AssertCanonicalResolution(scenario, scenario.ResolveSelection());
            }
            finally
            {
                scenario?.Dispose();
            }
        }

        [Test]
        public void StaleLogicalTransformCreatesAnIsolatedProtectedConflictWithoutHidingRearmRootCause()
        {
            ReconnectRearmScenario scenario = null;
            try
            {
                scenario = new ReconnectRearmScenario();
                scenario.SetSnapshotReady(true);
                Assert.That(
                    TeamForgeHierarchyIdentityRegistry.IsSessionCanonicalLogicalId(scenario.LogicalId),
                    Is.False);
                scenario.SendTransformApplied(
                    scenario.LogicalId,
                    "stale-prior-epoch-operation",
                    1,
                    new Vector3(20, 30, 40));
                Assert.That(scenario.Target.transform.localPosition, Is.EqualTo(Vector3.zero));

                scenario.EstablishHierarchyAuthority();
                var protectedResolution = scenario.ResolveSelection();
                Assert.That(protectedResolution.SceneId, Is.EqualTo(scenario.SceneId));
                Assert.That(protectedResolution.ObjectId, Is.EqualTo(scenario.LogicalId));
                Assert.That(protectedResolution.ParentObjectId, Is.Empty);
                Assert.That(
                    protectedResolution.Rejection,
                    Is.EqualTo(TeamForgeTransformSelectionRejection.ProtectedConflict));
                Assert.That(
                    TeamForgeTransformSyncService.MatchesAuthoritativeSelection(
                        protectedResolution.SceneId,
                        protectedResolution.ObjectId,
                        scenario.AuthoritativeState),
                    Is.True,
                    "The authoritative state matches; the typed ProtectedConflict guard is the rejection cause.");

                scenario.ApplyHierarchyAuthority();
                Assert.That(TeamForgeTransformSyncService.TrackedObject, Is.Null);
                Assert.That(TeamForgeTransformSyncService.SelectedObjectId, Is.Empty);
                Assert.That(FindMessage(scenario.Recorder.SentTexts, "lock_request"), Is.Empty);
            }
            finally
            {
                scenario?.Dispose();
            }
        }

        [Test]
        public void CurrentLogicalAuthorityRejectsGlobalTransformAndAcceptsExactLogicalTransform()
        {
            ReconnectRearmScenario scenario = null;
            try
            {
                scenario = new ReconnectRearmScenario();
                scenario.EstablishHierarchyAuthority();
                scenario.Recorder.SentTexts.Clear();

                scenario.SendTransformApplied(
                    scenario.GlobalId,
                    "split-global-operation",
                    1,
                    new Vector3(20, 30, 40));
                Assert.That(scenario.Target.transform.localPosition, Is.EqualTo(Vector3.zero));

                var acceptedPosition = new Vector3(8, 9, 10);
                scenario.SendTransformApplied(
                    scenario.LogicalId,
                    "confirmed-logical-operation",
                    2,
                    acceptedPosition);
                Assert.That(scenario.Target.transform.localPosition, Is.EqualTo(acceptedPosition));
            }
            finally
            {
                scenario?.Dispose();
            }
        }

        [Test]
        public void PendingLogicalParentChangeCannotSendLockOrTransformUnderStaleIdentity()
        {
            ReconnectRearmScenario scenario = null;
            GameObject newParent = null;
            var newParentLogicalId = string.Empty;
            try
            {
                scenario = new ReconnectRearmScenario();
                scenario.EstablishHierarchyAuthority();
                scenario.ApplyHierarchyAuthority();
                scenario.PrepareForFreshLockAttempt();

                scenario.SetPendingOperation(
                    new TeamForgePendingHierarchyOperation(
                        "pending-selected-reparent-operation",
                        "pending-selected-reparent-request",
                        scenario.SceneId,
                        scenario.LogicalId,
                        "reparent_object"));
                Assert.That(TeamForgeTransformSyncService.RequestSelectedLock(), Is.False);
                Assert.That(FindMessage(scenario.Recorder.SentTexts, "lock_request"), Is.Empty);
                scenario.SetPendingOperation(null);

                newParent = new GameObject("Pending Logical Parent");
                newParent.transform.position = new Vector3(10, 0, 0);
                newParentLogicalId = TeamForgeHierarchyIdentityRegistry.GetOrCreateLogicalId(newParent);
                scenario.Target.transform.SetParent(newParent.transform, true);
                scenario.NotifyHierarchyChangedAndUpdate();
                Assert.That(FindMessage(scenario.Recorder.SentTexts, "lock_request"), Is.Empty);
                Assert.That(FindMessage(scenario.Recorder.SentTexts, "transform_update"), Is.Empty);
                Assert.That(TeamForgeTransformSyncService.TrackedObject, Is.SameAs(scenario.Target));
                Assert.That(TeamForgeTransformSyncService.SelectedObjectId, Is.EqualTo(scenario.LogicalId));
                Assert.That(TeamForgeTransformSyncService.SelectedObjectBlocked, Is.False);

                scenario.Target.transform.SetParent(null, true);
                scenario.Target.transform.SetSiblingIndex(scenario.AuthoritativeState.SiblingIndex);
                TeamForgeTransformSyncService.CompleteHierarchyReconciliation(
                    scenario.SceneId,
                    scenario.LogicalId);
                scenario.PrepareForFreshLockAttempt();
                Assert.That(TeamForgeTransformSyncService.RequestSelectedLock(), Is.True);
                var recoveredLock = TeamForgeProtocol.Deserialize<LockRequestMessage>(
                    FindMessage(scenario.Recorder.SentTexts, "lock_request"));
                Assert.That(recoveredLock.objectId, Is.EqualTo(scenario.LogicalId));
            }
            finally
            {
                if (!string.IsNullOrEmpty(newParentLogicalId))
                {
                    RemoveIdentityMappings(newParent, newParentLogicalId);
                }
                scenario?.Dispose();
            }
        }

        [Test]
        public void UnrelatedHierarchyChangeDoesNotPauseSelectedTransformLockRequest()
        {
            ReconnectRearmScenario scenario = null;
            try
            {
                scenario = new ReconnectRearmScenario();
                scenario.EstablishHierarchyAuthority();
                scenario.ApplyHierarchyAuthority();
                scenario.PrepareForFreshLockAttempt();

                scenario.NotifyHierarchyChangedAndUpdate();

                Assert.That(TeamForgeTransformSyncService.TrackedObject, Is.SameAs(scenario.Target));
                Assert.That(TeamForgeTransformSyncService.RequestSelectedLock(), Is.True);
                var request = TeamForgeProtocol.Deserialize<LockRequestMessage>(
                    FindMessage(scenario.Recorder.SentTexts, "lock_request"));
                Assert.That(request.objectId, Is.EqualTo(scenario.LogicalId));
            }
            finally
            {
                scenario?.Dispose();
            }
        }

        [Test]
        public void ReconciliationCompletionRearmsTargetAfterRapidSelectionChanges()
        {
            ReconnectRearmScenario scenario = null;
            GameObject newParent = null;
            GameObject decoy = null;
            var newParentLogicalId = string.Empty;
            try
            {
                scenario = new ReconnectRearmScenario();
                scenario.EstablishHierarchyAuthority();
                scenario.ApplyHierarchyAuthority();
                scenario.PrepareForFreshLockAttempt();

                newParent = new GameObject("Pending Reconciliation Parent");
                newParentLogicalId = TeamForgeHierarchyIdentityRegistry.GetOrCreateLogicalId(newParent);
                decoy = new GameObject("Pending Reconciliation Decoy");
                scenario.Target.transform.SetParent(newParent.transform, true);
                scenario.NotifyHierarchyChangedAndUpdate();

                TeamForgeSharedEditorStateScope.SetSingleSelection(decoy);
                scenario.NotifySelectionChanged();
                TeamForgeSharedEditorStateScope.SetSingleSelection(scenario.Target);
                scenario.NotifySelectionChanged();
                Assert.That(TeamForgeTransformSyncService.TrackedObject, Is.SameAs(scenario.Target));
                Assert.That(
                    TeamForgeTransformSyncService.SelectedLockStatus,
                    Does.Contain("Hierarchy reconciliation in progress"));

                scenario.Target.transform.SetParent(null, true);
                scenario.Target.transform.SetSiblingIndex(scenario.AuthoritativeState.SiblingIndex);
                TeamForgeTransformSyncService.CompleteHierarchyReconciliation(
                    scenario.SceneId,
                    scenario.LogicalId);

                Assert.That(TeamForgeTransformSyncService.TrackedObject, Is.SameAs(scenario.Target));
                Assert.That(TeamForgeTransformSyncService.SelectedObjectId, Is.EqualTo(scenario.LogicalId));
                Assert.That(TeamForgeTransformSyncService.SelectedObjectBlocked, Is.False);
            }
            finally
            {
                if (!string.IsNullOrEmpty(newParentLogicalId))
                {
                    RemoveIdentityMappings(newParent, newParentLogicalId);
                }
                if (decoy != null)
                {
                    UnityEngine.Object.DestroyImmediate(decoy);
                }
                scenario?.Dispose();
            }
        }

        [Test]
        public void PresenceSelectionSceneMatchesSelectedObjectInAdditiveSceneEditing()
        {
            EnsureTemporaryFolder();
            var activePath = $"{TemporaryFolder}/{Guid.NewGuid():N}-active.unity";
            var selectedPath = $"{TemporaryFolder}/{Guid.NewGuid():N}-selected.unity";
            Scene activeScene = default;
            Scene selectedScene = default;
            GameObject selected = null;

            try
            {
                activeScene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                Assert.That(EditorSceneManager.SaveScene(activeScene, activePath), Is.True);
                selectedScene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Additive);
                selected = new GameObject("Additive Selected Object");
                SceneManager.MoveGameObjectToScene(selected, selectedScene);
                Assert.That(EditorSceneManager.SaveScene(selectedScene, selectedPath), Is.True);
                Assert.That(SceneManager.SetActiveScene(activeScene), Is.True);

                Selection.activeGameObject = selected;
                var sample = CapturePresenceSample();
                Assert.That(ReadSampleString(sample, "SelectedObjectId"), Is.Not.Empty);
                Assert.That(
                    ReadSampleString(sample, "SceneId"),
                    Is.EqualTo(AssetDatabase.AssetPathToGUID(selectedPath)));
                Assert.That(ReadSampleString(sample, "SceneName"), Is.EqualTo(selectedScene.name));
            }
            finally
            {
                Selection.activeObject = null;
                EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                AssetDatabase.DeleteAsset(activePath);
                AssetDatabase.DeleteAsset(selectedPath);
                RemoveTemporaryFolderIfEmpty();
            }
        }

        private static void AssertDirectionResolves(
            GameObject target,
            string globalId,
            string logicalId,
            bool senderHasCache,
            bool receiverHasCache,
            string direction)
        {
            ConfigureCache(target, globalId, logicalId, senderHasCache);
            Selection.activeGameObject = target;
            var transmittedId = CaptureSelectedPresenceId();
            Assert.That(transmittedId, Is.EqualTo(globalId), $"{direction} sender selected a cache-dependent wire ID.");

            ConfigureCache(target, globalId, logicalId, receiverHasCache);
            ClearPresenceResolvedObjects();
            var arguments = new object[] { transmittedId, null };
            var resolved = (bool)GetStaticMethod(typeof(TeamForgePresenceService), "TryResolveObject")
                .Invoke(null, arguments);
            Assert.That(resolved, Is.True, $"{direction} receiver could not resolve the saved object.");
            Assert.That(arguments[1], Is.SameAs(target));
        }

        private static void ConfigureCache(GameObject target, string globalId, string logicalId, bool hasCache)
        {
            RemoveIdentityMappings(target, logicalId);
            if (hasCache)
            {
                InstallPersistedAlias(target, globalId, logicalId);
            }
            GetStaticMethod(typeof(TeamForgePresenceService), "InvalidateSelection").Invoke(null, null);
        }

        private static void InstallPersistedAlias(GameObject target, string globalId, string logicalId)
        {
            RemoveIdentityMappings(target, logicalId);
            GetIdentityMap("GlobalByLogical")[logicalId] = globalId;
            GetIdentityMap("LogicalByGlobal")[globalId] = logicalId;
        }

        private static void RemoveIdentityMappings(GameObject target, string logicalId)
        {
            var logicalByEntity = GetIdentityMap("LogicalByEntityId");
            var entityByLogical = GetIdentityMap("EntityIdByLogical");
            var globalByLogical = GetIdentityMap("GlobalByLogical");
            var logicalByGlobal = GetIdentityMap("LogicalByGlobal");
            if (target != null)
            {
                logicalByEntity.Remove(target.GetEntityId());
                if (TeamForgeObjectIdentity.TryGetGlobalObjectId(target, out var targetGlobalId))
                {
                    logicalByGlobal.Remove(targetGlobalId);
                }
            }
            if (!string.IsNullOrEmpty(logicalId))
            {
                entityByLogical.Remove(logicalId);
                if (globalByLogical.Contains(logicalId))
                {
                    var global = globalByLogical[logicalId];
                    globalByLogical.Remove(logicalId);
                    if (global != null) logicalByGlobal.Remove(global);
                }
                RemoveSessionLogicalId(logicalId);
            }
        }

        private static IDictionary GetIdentityMap(string name)
        {
            return GetStaticField(typeof(TeamForgeHierarchyIdentityRegistry), name).GetValue(null) as IDictionary
                   ?? throw new InvalidOperationException($"Identity map {name} is unavailable.");
        }

        private static void RemoveSessionLogicalId(string logicalId)
        {
            var field = typeof(TeamForgeHierarchyIdentityRegistry).GetField(
                "SessionCanonicalLogicalIds",
                BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic);
            var collection = field?.GetValue(null);
            collection?.GetType().GetMethod("Remove", new[] { typeof(string) })?.Invoke(collection, new object[] { logicalId });
        }

        private static bool SessionLogicalIdContains(string logicalId)
        {
            var collection = GetStaticField(
                    typeof(TeamForgeHierarchyIdentityRegistry),
                    "SessionCanonicalLogicalIds")
                .GetValue(null);
            var contains = collection?.GetType().GetMethod("Contains", new[] { typeof(string) });
            return contains != null && (bool)contains.Invoke(collection, new object[] { logicalId });
        }

        private static void AssertSingleSelection(GameObject target)
        {
            Assert.That(Selection.activeGameObject, Is.SameAs(target));
            Assert.That(Selection.gameObjects, Is.Not.Null);
            Assert.That(Selection.gameObjects.Length, Is.EqualTo(1));
            Assert.That(Selection.gameObjects[0], Is.SameAs(target));
        }

        private static string[] SnapshotSessionLogicalIds()
        {
            var values = new List<string>();
            var collection = GetStaticField(typeof(TeamForgeHierarchyIdentityRegistry), "SessionCanonicalLogicalIds")
                .GetValue(null) as IEnumerable;
            if (collection != null)
            {
                foreach (var value in collection)
                {
                    if (value is string logicalId) values.Add(logicalId);
                }
            }
            return values.ToArray();
        }

        private static void RestoreSessionLogicalIds(IEnumerable<string> logicalIds)
        {
            var collection = GetStaticField(typeof(TeamForgeHierarchyIdentityRegistry), "SessionCanonicalLogicalIds")
                .GetValue(null);
            collection?.GetType().GetMethod("Clear", BindingFlags.Instance | BindingFlags.Public)?.Invoke(collection, null);
            var add = collection?.GetType().GetMethod("Add", new[] { typeof(string) });
            if (add == null) return;
            foreach (var logicalId in logicalIds ?? Array.Empty<string>())
            {
                add.Invoke(collection, new object[] { logicalId });
            }
        }

        private static object CapturePresenceSample(bool invalidate = true)
        {
            if (invalidate)
            {
                GetStaticMethod(typeof(TeamForgePresenceService), "InvalidateSelection").Invoke(null, null);
            }
            return GetStaticMethod(typeof(TeamForgePresenceService), "CaptureSample").Invoke(null, null);
        }

        private static string CaptureSelectedPresenceId()
        {
            return ReadSampleString(CapturePresenceSample(), "SelectedObjectId");
        }

        private static string ReadSampleString(object sample, string fieldName)
        {
            return sample?.GetType().GetField(fieldName, BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic)
                ?.GetValue(sample) as string ?? string.Empty;
        }

        private static void ClearPresenceResolvedObjects()
        {
            ClearCollection(GetStaticField(typeof(TeamForgePresenceService), "ResolvedObjects").GetValue(null));
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

        private static void AssertAuthority(string connectionId)
        {
            var authority = TeamForgeAuthorityView.Current;
            Assert.That(authority.IsConnected, Is.True);
            Assert.That(authority.TransformSyncAvailable, Is.True);
            Assert.That(authority.HierarchySyncAvailable, Is.True);
            Assert.That(authority.ConnectionId, Is.EqualTo(connectionId));
        }

        private static void AssertCanonicalResolution(
            ReconnectRearmScenario scenario,
            TeamForgeTransformSelectionResolution resolution)
        {
            Assert.That(resolution.Rejection, Is.EqualTo(TeamForgeTransformSelectionRejection.None));
            Assert.That(resolution.Target, Is.SameAs(scenario.Target));
            Assert.That(resolution.SceneId, Is.EqualTo(scenario.SceneId));
            Assert.That(resolution.ObjectId, Is.EqualTo(scenario.LogicalId));
            Assert.That(resolution.ParentObjectId, Is.Empty);
            Assert.That(resolution.HasCanonicalObjectIdentity, Is.True);
            Assert.That(resolution.CanTrack, Is.True);
        }

        private static void UpsertHierarchy(object registry, TeamForgeHierarchyState state)
        {
            registry.GetType().GetMethod("Upsert", BindingFlags.Instance | BindingFlags.Public)
                ?.Invoke(registry, new object[] { state });
        }

        private static FieldInfo GetStaticField(Type type, string name)
        {
            return type.GetField(name, BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic)
                   ?? throw new MissingFieldException(type.FullName, name);
        }

        private static PropertyInfo GetStaticProperty(Type type, string name)
        {
            return type.GetProperty(name, BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic)
                   ?? throw new MissingMemberException(type.FullName, name);
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

        private static MethodInfo GetStaticMethod(Type type, string name)
        {
            return type.GetMethod(name, BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic)
                   ?? throw new MissingMethodException(type.FullName, name);
        }

        private static void ClearCollection(object collection)
        {
            collection?.GetType().GetMethod("Clear", BindingFlags.Instance | BindingFlags.Public)?.Invoke(collection, null);
        }

        private static object CreateRecordingTransport(Assembly editorAssembly, out RecordingTransportProxy recorder)
        {
            var transportInterface = editorAssembly.GetType("EunSung.TeamForge.IRealtimeTransport", true);
            MethodInfo createMethod = null;
            foreach (var method in typeof(DispatchProxy).GetMethods(BindingFlags.Static | BindingFlags.Public))
            {
                if (method.Name == "Create" && method.IsGenericMethodDefinition &&
                    method.GetGenericArguments().Length == 2 && method.GetParameters().Length == 0)
                {
                    createMethod = method;
                    break;
                }
            }
            Assert.That(createMethod, Is.Not.Null);
            var transport = createMethod.MakeGenericMethod(transportInterface, typeof(RecordingTransportProxy))
                .Invoke(null, null);
            recorder = transport as RecordingTransportProxy;
            Assert.That(recorder, Is.Not.Null);
            return transport;
        }

        private static string FindMessage(IEnumerable<string> messages, string messageType)
        {
            foreach (var message in messages)
            {
                if (TeamForgeProtocol.TryReadEnvelope(message, out var envelope, out _) && envelope.type == messageType)
                {
                    return message;
                }
            }
            return string.Empty;
        }

        private static void EnsureTemporaryFolder()
        {
            if (!AssetDatabase.IsValidFolder(TemporaryFolder))
            {
                AssetDatabase.CreateFolder("Assets", "__TeamForgeIdentityAuthorityAuditTests");
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

        private sealed class ReconnectRearmScenario : IDisposable
        {
            private readonly TeamForgeSharedEditorStateScope _stateScope;
            private readonly FieldInfo _hierarchySnapshotReadyField;
            private readonly FieldInfo _hierarchyPendingOperationField;
            private readonly FieldInfo _pendingLockRequestField;
            private readonly FieldInfo _selectedLockGrantedField;
            private readonly TeamForgeHierarchyRegistry _authoritative;
            private bool _disposed;

            internal ReconnectRearmScenario()
            {
                _stateScope = new TeamForgeSharedEditorStateScope();
                try
                {
                    EnsureTemporaryFolder();
                    ScenePath = $"{TemporaryFolder}/{Guid.NewGuid():N}.unity";
                    WorkingScene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                    Target = new GameObject("Prior Session Logical Target");
                    Assert.That(EditorSceneManager.SaveScene(WorkingScene, ScenePath), Is.True);
                    SceneId = AssetDatabase.AssetPathToGUID(ScenePath);
                    Assert.That(SceneId, Is.Not.Empty);
                    Assert.That(TeamForgeObjectIdentity.TryGetGlobalObjectId(Target, out var globalId), Is.True);
                    GlobalId = globalId;
                    LogicalId = "tf:" + Guid.NewGuid().ToString("N");
                    Assert.That(TeamForgeHierarchyIdentityRegistry.BindLogical(LogicalId, Target), Is.True);

                    Baseline = TeamForgeTransformSyncService.SelectionBaseline;
                    Baseline.Clear();
                    Baseline.Upsert(SceneId, LogicalId, string.Empty);
                    Baseline.Upsert(SceneId, GlobalId, string.Empty);
                    AuthoritativeState = State(SceneId, LogicalId, Target.name, string.Empty, 0);

                    var connectionType = typeof(TeamForgeConnectionService);
                    var transformType = typeof(TeamForgeTransformSyncService);
                    var hierarchyType = typeof(TeamForgeHierarchySyncService);
                    var transport = CreateRecordingTransport(connectionType.Assembly, out var recorder);
                    Recorder = recorder;
                    ConnectionId = "identity-rearm-" + Guid.NewGuid().ToString("N");
                    GetStaticField(connectionType, "_transport").SetValue(null, transport);
                    GetStaticField(connectionType, "<State>k__BackingField")
                        .SetValue(null, TeamForgeConnectionState.Connected);
                    GetStaticField(connectionType, "<TransformSyncAvailable>k__BackingField").SetValue(null, true);
                    GetStaticField(connectionType, "<HierarchySyncAvailable>k__BackingField").SetValue(null, true);
                    GetStaticField(connectionType, "<ConnectionId>k__BackingField").SetValue(null, ConnectionId);
                    GetStaticField(hierarchyType, "_wasConnected").SetValue(null, true);
                    _hierarchySnapshotReadyField = GetStaticField(hierarchyType, "_receivedSnapshot");
                    _hierarchySnapshotReadyField.SetValue(null, false);
                    _hierarchyPendingOperationField = GetStaticField(hierarchyType, "_pendingOperation");
                    _hierarchyPendingOperationField.SetValue(null, null);
                    GetStaticField(transformType, "_wasConnected").SetValue(null, false);
                    _pendingLockRequestField = GetStaticField(transformType, "_pendingLockRequestId");
                    _selectedLockGrantedField = GetStaticField(transformType, "_selectedLockGranted");
                    _authoritative = GetStaticField(hierarchyType, "Authoritative").GetValue(null)
                        as TeamForgeHierarchyRegistry;
                    Assert.That(_authoritative, Is.Not.Null);

                    using (TeamForgeTransformSyncService.SuppressSelectionLock())
                    {
                        TeamForgeSharedEditorStateScope.SetSingleSelection(Target);
                    }
                    GetStaticMethod(typeof(TeamForgeAuthorityView), "ObserveConnection").Invoke(null, null);
                    GetStaticMethod(transformType, "OnConnectionChanged").Invoke(null, null);
                }
                catch
                {
                    try
                    {
                        Dispose();
                    }
                    catch
                    {
                        // Preserve the construction failure; cleanup is best-effort on this exceptional path.
                    }
                    throw;
                }
            }

            internal string ScenePath { get; }
            internal Scene WorkingScene { get; private set; }
            internal GameObject Target { get; }
            internal string SceneId { get; }
            internal string GlobalId { get; }
            internal string LogicalId { get; }
            internal string ConnectionId { get; }
            internal TeamForgeObjectBaselineRegistry Baseline { get; }
            internal TeamForgeHierarchyState AuthoritativeState { get; }
            internal RecordingTransportProxy Recorder { get; }
            internal string SelectedSceneId =>
                Target == null || !Target.scene.IsValid()
                    ? string.Empty
                    : AssetDatabase.AssetPathToGUID(Target.scene.path);

            internal TeamForgeTransformSelectionResolution ResolveSelection()
            {
                return TeamForgeTransformSyncService.ResolveTransformSelectionIdentity(Target);
            }

            internal void EstablishHierarchyAuthority()
            {
                _authoritative.Upsert(AuthoritativeState);
                Assert.That(TeamForgeObjectIdentity.TryResolveGameObject(LogicalId, out var resolved), Is.True);
                Assert.That(resolved, Is.SameAs(Target));
                Assert.That(TeamForgeHierarchyIdentityRegistry.BindLogical(LogicalId, Target), Is.True);
                SetSnapshotReady(true);
            }

            internal void ApplyHierarchyAuthority()
            {
                TeamForgeTransformSyncService.ApplyHierarchyAuthoritativeState(
                    new[] { AuthoritativeState },
                    SceneId,
                    null);
            }

            internal void SetSnapshotReady(bool ready)
            {
                _hierarchySnapshotReadyField.SetValue(null, ready);
            }

            internal void SetPendingOperation(TeamForgePendingHierarchyOperation pending)
            {
                _hierarchyPendingOperationField.SetValue(null, pending);
            }

            internal void SendTransformApplied(
                string objectId,
                string operationId,
                long serverRevision,
                Vector3 localPosition)
            {
                var message = new TransformAppliedMessage
                {
                    type = "transform_applied",
                    protocolVersion = TeamForgeProtocol.Version,
                    requestId = operationId + "-request",
                    operationId = operationId,
                    userId = "remote-editor",
                    sceneId = SceneId,
                    objectId = objectId,
                    baseRevision = Math.Max(0, serverRevision - 1),
                    serverRevision = serverRevision,
                    localPosition = new TeamForgeVector3Dto
                    {
                        x = localPosition.x,
                        y = localPosition.y,
                        z = localPosition.z,
                    },
                    localRotation = new TeamForgeQuaternionDto { x = 0, y = 0, z = 0, w = 1 },
                    localScale = new TeamForgeVector3Dto { x = 1, y = 1, z = 1 },
                    serverTimestampUnixMs = 1786000004000 + serverRevision,
                };
                GetStaticMethod(typeof(TeamForgeTransformSyncService), "OnTransformMessageReceived").Invoke(
                    null,
                    new object[] { "transform_applied", TeamForgeProtocol.Serialize(message) });
            }

            internal void PrepareForFreshLockAttempt()
            {
                Recorder.SentTexts.Clear();
                _pendingLockRequestField.SetValue(null, string.Empty);
                _selectedLockGrantedField.SetValue(null, false);
            }

            internal void NotifyHierarchyChangedAndUpdate()
            {
                GetStaticMethod(typeof(TeamForgeTransformSyncService), "OnHierarchyChanged").Invoke(null, null);
                GetStaticMethod(typeof(TeamForgeTransformSyncService), "Update").Invoke(null, null);
            }

            internal void NotifySelectionChanged()
            {
                GetStaticMethod(typeof(TeamForgeTransformSyncService), "OnSelectionChanged").Invoke(null, null);
            }

            public void Dispose()
            {
                if (_disposed)
                {
                    return;
                }
                _disposed = true;
                try
                {
                    GetStaticField(typeof(TeamForgeConnectionService), "<State>k__BackingField")
                        .SetValue(null, TeamForgeConnectionState.Disconnected);
                    GetStaticField(typeof(TeamForgeHierarchySyncService), "_wasConnected")
                        .SetValue(null, false);
                    GetStaticField(typeof(TeamForgeTransformSyncService), "_wasConnected")
                        .SetValue(null, false);
                    GetStaticMethod(typeof(TeamForgeTransformSyncService), "ResetSelectionTracking")
                        .Invoke(null, null);
                    _authoritative?.Remove(SceneId, LogicalId, false);
                    RemoveIdentityMappings(Target, LogicalId);
                }
                finally
                {
                    try
                    {
                        if (WorkingScene.IsValid() && WorkingScene.isLoaded)
                        {
                            WorkingScene = EditorSceneManager.NewScene(
                                NewSceneSetup.EmptyScene,
                                NewSceneMode.Single);
                        }
                        if (!string.IsNullOrEmpty(ScenePath))
                        {
                            AssetDatabase.DeleteAsset(ScenePath);
                        }
                        RemoveTemporaryFolderIfEmpty();
                    }
                    finally
                    {
                        _stateScope.Dispose();
                    }
                }
            }
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
                if (targetMethod.ReturnType == typeof(Task)) return Task.CompletedTask;
                return null;
            }
        }
    }

    internal sealed class TeamForgeSharedEditorStateScope : IDisposable
    {
        private const string BaselineSessionStateKey = "EunSung.TeamForge.TransformBaseline.v1";

        private readonly UnityEngine.Object[] _selectionObjects;
        private readonly UnityEngine.Object _activeSelection;
        private readonly List<FieldValue> _connectionFields;
        private readonly List<FieldValue> _hierarchyFields;
        private readonly List<FieldValue> _transformFields;
        private readonly List<CollectionValue> _transformCollections;
        private readonly FieldInfo _identityEpochField;
        private readonly object _identityEpoch;
        private readonly CollectionValue _sessionLogicalIds;
        private readonly TeamForgeObjectBaselineRegistry _baseline;
        private readonly List<TeamForgeBaselineEntry> _baselineEntries;
        private readonly string _baselineSessionState;
        private readonly Type _authorityType;
        private readonly long _authorityRevision;
        private readonly List<TeamForgeLockRecord> _authorityLocks;
        private bool _disposed;

        internal TeamForgeSharedEditorStateScope()
        {
            var connectionType = typeof(TeamForgeConnectionService);
            var hierarchyType = typeof(TeamForgeHierarchySyncService);
            var transformType = typeof(TeamForgeTransformSyncService);
            var identityType = typeof(TeamForgeHierarchyIdentityRegistry);

            _selectionObjects = Selection.objects ?? Array.Empty<UnityEngine.Object>();
            _activeSelection = Selection.activeObject;
            _connectionFields = SnapshotFields(
                connectionType,
                "_transport",
                "<State>k__BackingField",
                "<PresenceAvailable>k__BackingField",
                "<TransformSyncAvailable>k__BackingField",
                "<HierarchySyncAvailable>k__BackingField",
                "<ProjectTransferAvailable>k__BackingField",
                "<ConnectionId>k__BackingField",
                "<MessagesSent>k__BackingField");
            _hierarchyFields = SnapshotFields(
                hierarchyType,
                "_wasConnected",
                "_receivedSnapshot",
                "_pendingOperation",
                "_scanScheduled");
            _transformFields = SnapshotFields(
                transformType,
                "_selectedObject",
                "_selectedSceneId",
                "_selectedObjectId",
                "_selectedParentObjectId",
                "_pendingLockRequestId",
                "_lastObservedState",
                "_lastConfirmedState",
                "_stateAtLockRequest",
                "_selectedLockGranted",
                "_wasConnected",
                "_dirty",
                "_syncBlocked",
                "_selectionLockSuppressionDepth",
                "_hierarchyRecoveryObject",
                "_hierarchyRecoverySceneId",
                "_hierarchyRecoveryObjectId",
                "_hierarchyRecoveryParentObjectId",
                "_hierarchyRecoveryObservedState",
                "_hierarchyRecoveryConfirmedState",
                "_hierarchyRecoveryLockRequestState",
                "_nextTransformSendAt",
                "_nextLockRenewalAt",
                "_selectedLockExpiresAt",
                "_nextIdentityValidationAt",
                "_selectedLockStatus",
                "<SnapshotConflictCount>k__BackingField");
            _transformCollections = SnapshotCollections(
                transformType,
                "AppliedOperationIds",
                "AppliedOperationOrder",
                "PendingLocalOperations",
                "PendingOperationByRequestId",
                "LatestObjectRevisions",
                "ProtectedConflictKeys",
                "HierarchyBlockedKeys");

            _identityEpochField = RequiredField(identityType, "_connectionIdentityEpoch");
            _identityEpoch = _identityEpochField.GetValue(null);
            _sessionLogicalIds = new CollectionValue(
                RequiredField(identityType, "SessionCanonicalLogicalIds").GetValue(null));

            _baseline = RequiredField(transformType, "Baseline").GetValue(null)
                as TeamForgeObjectBaselineRegistry;
            if (_baseline == null)
            {
                throw new InvalidOperationException("Transform baseline is unavailable.");
            }
            _baselineEntries = _baseline.Snapshot();
            _baselineSessionState = SessionState.GetString(BaselineSessionStateKey, string.Empty);

            _authorityType = connectionType.Assembly.GetType(
                "EunSung.TeamForge.TeamForgeAuthorityView",
                true);
            _authorityRevision = TeamForgeTransformSyncService.CurrentRevision;
            _authorityLocks = TeamForgeTransformSyncService.Locks.Snapshot();
        }

        internal static void SetSingleSelection(GameObject target)
        {
            Selection.objects = target == null
                ? Array.Empty<UnityEngine.Object>()
                : new UnityEngine.Object[] { target };
            Selection.activeGameObject = target;
        }

        public void Dispose()
        {
            if (_disposed)
            {
                return;
            }
            _disposed = true;

            RequiredMethod(typeof(TeamForgeTransformSyncService), "ResetSelectionTracking")
                .Invoke(null, null);
            RestoreFields(_connectionFields);
            RequiredMethod(_authorityType, "ObserveConnection").Invoke(null, null);
            RequiredMethod(_authorityType, "ResetSession").Invoke(null, null);
            RequiredMethod(_authorityType, "ObserveRevision").Invoke(
                null,
                new object[] { _authorityRevision });
            var replaceLocksArguments = new object[] { _authorityLocks, null };
            if (!(bool)RequiredMethod(_authorityType, "ReplaceLocks")
                    .Invoke(null, replaceLocksArguments))
            {
                throw new InvalidOperationException(
                    "Authority locks could not be restored: " +
                    (replaceLocksArguments[1] as string ?? "unknown error"));
            }

            _baseline.ReplaceAll(_baselineEntries);
            SessionState.SetString(BaselineSessionStateKey, _baselineSessionState);
            _identityEpochField.SetValue(null, _identityEpoch);
            _sessionLogicalIds.Restore();
            RestoreFields(_hierarchyFields);

            var suppressSelectionLock = RequiredMethod(
                typeof(TeamForgeTransformSyncService),
                "SuppressSelectionLock").Invoke(null, null) as IDisposable;
            try
            {
                Selection.objects = _selectionObjects;
                Selection.activeObject = _activeSelection;
            }
            finally
            {
                suppressSelectionLock?.Dispose();
            }

            RestoreCollections(_transformCollections);
            RestoreFields(_transformFields);
        }

        private static List<FieldValue> SnapshotFields(Type type, params string[] names)
        {
            var values = new List<FieldValue>(names.Length);
            foreach (var name in names)
            {
                var field = RequiredField(type, name);
                values.Add(new FieldValue(field, field.GetValue(null)));
            }
            return values;
        }

        private static List<CollectionValue> SnapshotCollections(Type type, params string[] names)
        {
            var values = new List<CollectionValue>(names.Length);
            foreach (var name in names)
            {
                values.Add(new CollectionValue(RequiredField(type, name).GetValue(null)));
            }
            return values;
        }

        private static void RestoreFields(IEnumerable<FieldValue> values)
        {
            foreach (var value in values)
            {
                value.Field.SetValue(null, value.Value);
            }
        }

        private static void RestoreCollections(IEnumerable<CollectionValue> values)
        {
            foreach (var value in values)
            {
                value.Restore();
            }
        }

        private static FieldInfo RequiredField(Type type, string name)
        {
            return type.GetField(name, BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic)
                   ?? throw new MissingFieldException(type.FullName, name);
        }

        private static MethodInfo RequiredMethod(Type type, string name)
        {
            return type.GetMethod(name, BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic)
                   ?? throw new MissingMethodException(type.FullName, name);
        }

        private sealed class FieldValue
        {
            internal FieldValue(FieldInfo field, object value)
            {
                Field = field;
                Value = value;
            }

            internal FieldInfo Field { get; }
            internal object Value { get; }
        }

        private sealed class CollectionValue
        {
            private readonly object _collection;
            private readonly List<DictionaryEntry> _dictionaryEntries;
            private readonly List<object> _items;

            internal CollectionValue(object collection)
            {
                _collection = collection ?? throw new ArgumentNullException(nameof(collection));
                if (collection is IDictionary dictionary)
                {
                    _dictionaryEntries = new List<DictionaryEntry>();
                    foreach (DictionaryEntry entry in dictionary)
                    {
                        _dictionaryEntries.Add(entry);
                    }
                    _items = null;
                    return;
                }

                _dictionaryEntries = null;
                _items = new List<object>();
                if (collection is IEnumerable enumerable)
                {
                    foreach (var item in enumerable)
                    {
                        _items.Add(item);
                    }
                }
            }

            internal void Restore()
            {
                _collection.GetType().GetMethod("Clear", BindingFlags.Instance | BindingFlags.Public)
                    ?.Invoke(_collection, null);
                if (_collection is IDictionary dictionary)
                {
                    foreach (var entry in _dictionaryEntries)
                    {
                        dictionary[entry.Key] = entry.Value;
                    }
                    return;
                }

                var insert = _collection.GetType().GetMethod(
                                 "Add",
                                 BindingFlags.Instance | BindingFlags.Public) ??
                             _collection.GetType().GetMethod(
                                 "Enqueue",
                                 BindingFlags.Instance | BindingFlags.Public);
                if (insert == null)
                {
                    throw new MissingMethodException(
                        _collection.GetType().FullName,
                        "Add/Enqueue");
                }
                foreach (var item in _items)
                {
                    insert.Invoke(_collection, new[] { item });
                }
            }
        }
    }
}

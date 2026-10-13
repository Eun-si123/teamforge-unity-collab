using System;
using System.Collections.Generic;
using System.Reflection;
using NUnit.Framework;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using Object = UnityEngine.Object;

namespace EunSung.TeamForge.Tests
{
    public sealed class TeamForgeHierarchyRecoveryTests
    {
        [TestCase("rename_object", false)]
        [TestCase("rename_object", true)]
        [TestCase("reparent_object", false)]
        [TestCase("reparent_object", true)]
        [TestCase("reorder_sibling", false)]
        [TestCase("reorder_sibling", true)]
        public void DelayedRejectionRestoresItsTargetAndPreservesLaterEditsAndUndo(string kind, bool protocolError)
        {
            using (var scenario = new RecoveryScene())
            {
                var originalTransform = TeamForgeTransformState.Capture(scenario.Target.transform);
                scenario.EditTarget(kind);
                scenario.SetPending(kind);
                scenario.MakeUnrelatedEdit();
                scenario.RejectPending(protocolError);

                scenario.AssertUnrelatedEditPreserved();
                Assert.That(scenario.Target.name, Is.EqualTo(scenario.Original.Name));
                Assert.That(scenario.Target.transform.parent, Is.Null);
                Assert.That(scenario.Target.transform.GetSiblingIndex(), Is.EqualTo(scenario.Original.SiblingIndex));
                Assert.That(originalTransform.ApproximatelyEquals(
                    TeamForgeTransformState.Capture(scenario.Target.transform)), Is.True);
                scenario.AssertUnrelatedEditPreserved();
                Assert.That(TeamForgeHierarchySyncService.HasPendingOperation, Is.False);

                // The user must still be able to Undo their unrelated edit.
                using (TeamForgeRemoteApplyScope.Enter()) Undo.PerformUndo();
                Assert.That(scenario.Decoy.transform.localPosition, Is.EqualTo(Vector3.zero));
                Assert.That(scenario.Box.center, Is.EqualTo(Vector3.zero));
            }
        }

        [TestCase("rename_object")]
        [TestCase("reparent_object")]
        [TestCase("reorder_sibling")]
        public void LocalSafetyRefusalAlsoPreservesUnrelatedEdit(string kind)
        {
            using (var scenario = new RecoveryScene())
            {
                scenario.EditTarget(kind);
                scenario.MakeUnrelatedEdit();
                Invoke("RevertUnsafeLocalChange", "Fixture foreign-lock refusal", scenario.SceneId, scenario.TargetId);
                Assert.That(scenario.Target.name, Is.EqualTo(scenario.Original.Name));
                Assert.That(scenario.Target.transform.parent, Is.Null);
                Assert.That(scenario.Target.transform.GetSiblingIndex(), Is.EqualTo(scenario.Original.SiblingIndex));
                scenario.AssertUnrelatedEditPreserved();
            }
        }

        [Test]
        public void RejectedReparentRestoresLatestServerTransformInsteadOfOldHierarchyCoordinates()
        {
            using (var scenario = new RecoveryScene())
            {
                var latest = new TeamForgeTransformState
                {
                    LocalPosition = new Vector3(17, 19, 23),
                    LocalRotation = Quaternion.Euler(7, 11, 13),
                    LocalScale = new Vector3(2, 3, 4),
                };
                scenario.ObserveServerTransform(latest, 2);
                Assert.That(scenario.Registry.TryGet(scenario.SceneId, scenario.TargetId, out var cached), Is.True);
                Assert.That(cached.Transform.ApproximatelyEquals(latest), Is.True,
                    "The recovery cache must observe newer server Transform state before a reparent occurs.");
                scenario.EditTarget("reparent_object");
                scenario.SetPending("reparent_object");
                scenario.MakeUnrelatedEdit();
                scenario.RejectPending(false);

                Assert.That(scenario.Target.transform.parent, Is.Null);
                Assert.That(latest.ApproximatelyEquals(
                    TeamForgeTransformState.Capture(scenario.Target.transform)), Is.True,
                    "Rejected reparent must not restore stale coordinates from the old Hierarchy seed.");
                scenario.AssertUnrelatedEditPreserved();
            }
        }

        [TestCase("delete_object")]
        [TestCase("create_object")]
        public void DestructiveOrUnverifiedRejectionPreservesLocalDataAndPausesHierarchy(string kind)
        {
            using (var scenario = new RecoveryScene())
            {
                if (kind == "delete_object")
                {
                    Undo.IncrementCurrentGroup();
                    Undo.DestroyObjectImmediate(scenario.Target);
                }
                else
                {
                    scenario.Registry.Remove(scenario.SceneId, scenario.TargetId, false);
                }
                scenario.SetPending(kind);
                scenario.MakeUnrelatedEdit();
                scenario.RejectPending(false);

                scenario.AssertUnrelatedEditPreserved();
                Assert.That(TeamForgeHierarchySyncService.SnapshotReady, Is.False,
                    "Unsafe recovery must pause instead of publishing the unresolved local Scene again.");
                Assert.That(TeamForgeHierarchySyncService.Status, Does.Contain("reconnect"));
                if (kind == "delete_object") Assert.That(scenario.Target == null, Is.True);
                else Assert.That(scenario.Target, Is.Not.Null);

                Invoke("Update");
                scenario.AssertUnrelatedEditPreserved();
                Assert.That(TeamForgeHierarchySyncService.HasPendingOperation, Is.False);
            }
        }

        [Test]
        public void MissingAuthoritativeParentPausesWithoutFabricatingObjectsOrUndoingNeighbors()
        {
            using (var scenario = new RecoveryScene())
            {
                var authoritative = scenario.Original.Clone();
                authoritative.ParentObjectId = "GlobalObjectId_V1-2-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-987654-0";
                scenario.Registry.Upsert(authoritative);
                scenario.EditTarget("reparent_object");
                scenario.SetPending("reparent_object");
                scenario.MakeUnrelatedEdit();
                scenario.RejectPending(false);

                Assert.That(scenario.Target.transform.parent, Is.SameAs(scenario.Parent.transform));
                scenario.AssertUnrelatedEditPreserved();
                Assert.That(TeamForgeHierarchySyncService.SnapshotReady, Is.False);

                // Disconnect clears the transient pause; a new verified
                // snapshot is still required before collaboration becomes ready.
                Invoke("OnConnectionChanged");
                SetField("_wasConnected", true);
                SetField("_receivedSnapshot", true);
                Assert.That(TeamForgeHierarchySyncService.SnapshotReady, Is.True);
            }
        }

        private static void Invoke(string name, params object[] args)
        {
            var method = typeof(TeamForgeHierarchySyncService).GetMethod(name, BindingFlags.NonPublic | BindingFlags.Static);
            Assert.That(method, Is.Not.Null, name);
            method.Invoke(null, args);
        }

        private static void SetField(string name, object value)
        {
            var field = typeof(TeamForgeHierarchySyncService).GetField(name, BindingFlags.NonPublic | BindingFlags.Static);
            Assert.That(field, Is.Not.Null, name);
            field.SetValue(null, value);
        }

        private sealed class RecoveryScene : IDisposable
        {
            private const string Folder = "Assets/__TeamForgeHierarchyRecoveryTests";
            private readonly TeamForgeSharedEditorStateScope _shared = new TeamForgeSharedEditorStateScope();
            private readonly string _path;
            private readonly Scene _scene;
            private readonly int _undoStartGroup;
            private readonly FieldInfo _statusField;
            private readonly object _oldStatus;
            private readonly FieldInfo _conflictField;
            private readonly object _oldConflict;
            private readonly Dictionary<string, TeamForgePendingHierarchyOperation> _requests;
            private readonly string _operationId = Guid.NewGuid().ToString("N");
            private readonly string _requestId = Guid.NewGuid().ToString("N");
            private readonly List<string> _registeredIds = new List<string>();
            private readonly HashSet<string> _authoritativeScenes;

            internal GameObject Target { get; }
            internal GameObject Parent { get; }
            internal GameObject Decoy { get; }
            internal BoxCollider Box { get; }
            internal string SceneId { get; }
            internal string TargetId { get; }
            internal TeamForgeHierarchyState Original { get; }
            internal TeamForgeHierarchyRegistry Registry { get; }

            internal RecoveryScene()
            {
                Undo.IncrementCurrentGroup();
                _undoStartGroup = Undo.GetCurrentGroup();
                SetField("_wasConnected", false);
                var service = typeof(TeamForgeHierarchySyncService);
                _statusField = service.GetField("_status", BindingFlags.NonPublic | BindingFlags.Static);
                _oldStatus = _statusField.GetValue(null);
                _conflictField = service.GetField("_conflictCount", BindingFlags.NonPublic | BindingFlags.Static);
                _oldConflict = _conflictField.GetValue(null);
                Registry = (TeamForgeHierarchyRegistry)service.GetField("Authoritative", BindingFlags.NonPublic | BindingFlags.Static).GetValue(null);
                _authoritativeScenes = (HashSet<string>)service.GetField("AuthoritativeSceneIds", BindingFlags.NonPublic | BindingFlags.Static).GetValue(null);
                _requests = (Dictionary<string, TeamForgePendingHierarchyOperation>)service.GetField("PendingByRequestId", BindingFlags.NonPublic | BindingFlags.Static).GetValue(null);

                if (!AssetDatabase.IsValidFolder(Folder)) AssetDatabase.CreateFolder("Assets", "__TeamForgeHierarchyRecoveryTests");
                _path = $"{Folder}/{Guid.NewGuid():N}.unity";
                _scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                Target = NewObject("Recovery Target");
                Target.transform.localPosition = new Vector3(2, 3, 5);
                Box = Target.AddComponent<BoxCollider>();
                Parent = NewObject("Alternate Parent");
                Parent.transform.localPosition = new Vector3(31, 37, 41);
                Decoy = NewObject("Unrelated Edit");
                Assert.That(EditorSceneManager.SaveScene(_scene, _path), Is.True);
                SceneId = AssetDatabase.AssetPathToGUID(_path);
                _authoritativeScenes.Add(SceneId);

                foreach (var target in new[] { Target, Parent, Decoy })
                {
                    Assert.That(TeamForgeObjectIdentity.TryGetGlobalObjectId(target, out var id), Is.True);
                    _registeredIds.Add(id);
                    var state = new TeamForgeHierarchyState
                    {
                        SceneId = SceneId, ObjectId = id, Name = target.name,
                        ParentObjectId = string.Empty, SiblingIndex = target.transform.GetSiblingIndex(),
                        Transform = TeamForgeTransformState.Capture(target.transform),
                        CreatedRevision = 1, HierarchyRevision = 1,
                    };
                    Registry.Upsert(state);
                    TeamForgeTransformSyncService.SelectionBaseline.Upsert(SceneId, id, string.Empty);
                    if (target == Target) { TargetId = id; Original = state; }
                }
                SetField("_wasConnected", true);
                SetField("_receivedSnapshot", true);
                SetField("_pendingOperation", null);
            }

            internal void EditTarget(string kind)
            {
                Undo.IncrementCurrentGroup();
                if (kind == "rename_object")
                {
                    Undo.RegisterCompleteObjectUndo(Target, "Rejected rename");
                    Target.name = "Rejected local name";
                }
                else if (kind == "reparent_object") Undo.SetTransformParent(Target.transform, Parent.transform, "Rejected reparent");
                else
                {
                    Undo.RegisterCompleteObjectUndo(Target.transform, "Rejected order");
                    Target.transform.SetSiblingIndex(2);
                }
                Undo.FlushUndoRecordObjects();
            }

            internal void SetPending(string kind)
            {
                var pending = new TeamForgePendingHierarchyOperation(_operationId, _requestId, SceneId, TargetId, kind);
                SetField("_pendingOperation", pending);
                _requests[_requestId] = pending;
            }

            internal void MakeUnrelatedEdit()
            {
                Undo.IncrementCurrentGroup();
                if (Box != null) Undo.RegisterCompleteObjectUndo(new Object[] { Decoy.transform, Box }, "Unrelated later edit");
                else Undo.RegisterCompleteObjectUndo(Decoy.transform, "Unrelated later edit");
                Decoy.transform.localPosition = new Vector3(101, 103, 107);
                if (Box != null) Box.center = new Vector3(3, 7, 11);
                Undo.FlushUndoRecordObjects();
                Selection.activeGameObject = Decoy;
            }

            internal void AssertUnrelatedEditPreserved()
            {
                Assert.That(Decoy.transform.localPosition, Is.EqualTo(new Vector3(101, 103, 107)),
                    "Recovery must not Undo an unrelated edit made while the rejected request was in flight.");
                if (Box != null) Assert.That(Box.center, Is.EqualTo(new Vector3(3, 7, 11)));
                Assert.That(Selection.activeGameObject, Is.SameAs(Decoy));
            }

            internal void RejectPending(bool protocolError)
            {
                if (protocolError) Invoke("OnProtocolErrorReceived", new ProtocolErrorMessage { requestId = _requestId, code = "fixture_rejection" });
                else Invoke("HandleHierarchyConflict", new HierarchyConflictMessage
                {
                    requestId = _requestId, operationId = _operationId, serverRevision = 2,
                    reason = "fixture_rejection", detail = "Deterministic delayed conflict fixture",
                });
            }

            internal void ObserveServerTransform(TeamForgeTransformState state, long revision)
            {
                var method = typeof(TeamForgeTransformSyncService).GetMethod("HandleTransformApplied", BindingFlags.NonPublic | BindingFlags.Static);
                method.Invoke(null, new object[] { new TransformAppliedMessage
                {
                    type = "transform_applied", operationId = Guid.NewGuid().ToString("N"),
                    userId = "fixture-server-authority", sceneId = SceneId, objectId = TargetId,
                    baseRevision = revision - 1, serverRevision = revision,
                    localPosition = state.PositionDto(), localRotation = state.RotationDto(), localScale = state.ScaleDto(),
                } });
            }

            private GameObject NewObject(string name)
            {
                var target = new GameObject(name);
                SceneManager.MoveGameObjectToScene(target, _scene);
                return target;
            }

            public void Dispose()
            {
                SetField("_wasConnected", false);
                // Test isolation only: every group since construction belongs
                // to this fixture. Product recovery never rewinds global Undo.
                using (TeamForgeRemoteApplyScope.Enter()) Undo.RevertAllDownToGroup(_undoStartGroup);
                _requests.Remove(_requestId);
                _authoritativeScenes.Remove(SceneId);
                foreach (var id in _registeredIds) Registry.Remove(SceneId, id, false);
                foreach (var target in new[] { Target, Parent, Decoy })
                {
                    if (target == null) continue;
                    Undo.ClearUndo(target);
                    Undo.ClearUndo(target.transform);
                }
                if (Box != null) Undo.ClearUndo(Box);
                EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                AssetDatabase.DeleteAsset(_path);
                if (AssetDatabase.IsValidFolder(Folder) && AssetDatabase.FindAssets(string.Empty, new[] { Folder }).Length == 0)
                    AssetDatabase.DeleteAsset(Folder);
                _shared.Dispose();
                _statusField.SetValue(null, _oldStatus);
                _conflictField.SetValue(null, _oldConflict);
            }
        }
    }
}

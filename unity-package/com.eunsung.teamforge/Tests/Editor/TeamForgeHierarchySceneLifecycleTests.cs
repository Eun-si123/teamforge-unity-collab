using System;
using System.Collections;
using System.Collections.Generic;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using Object = UnityEngine.Object;

namespace EunSung.TeamForge.Tests
{
    public sealed class TeamForgeHierarchySceneLifecycleTests
    {
        [Test]
        public void ClosingSavedSceneDoesNotPublishObjectDeletion()
        {
            using (var scenario = new SceneLifecycleScenario())
            {
                scenario.CloseFirstScene();
                scenario.Update();

                Assert.That(scenario.SentOperations, Is.Empty,
                    "Unloading a Scene must not publish deletion of its authoritative roots or children.");
                Assert.That(scenario.Registry.Contains(scenario.FirstSceneId, scenario.FirstRootId), Is.True);
                Assert.That(scenario.Registry.Count, Is.EqualTo(3));
                Assert.That(scenario.Registry.TombstoneCount, Is.Zero);
                Assert.That(TeamForgeHierarchySyncService.HasPendingOperation, Is.False);
                Assert.That(TeamForgeHierarchySyncService.SnapshotReady, Is.True);
            }
        }

        [Test]
        public void DeletingLastLoadedRootStillPublishesSubtreeDeletion()
        {
            using (var scenario = new SceneLifecycleScenario())
            {
                Object.DestroyImmediate(scenario.FirstRoot);
                // Deliver the same notification without waiting for an Editor frame.
                Invoke(typeof(TeamForgeHierarchySyncService), "OnHierarchyChanged");
                scenario.Update();

                Assert.That(scenario.SentOperations, Has.Count.EqualTo(1));
                var operation = scenario.SentOperations[0];
                Assert.That(operation.kind, Is.EqualTo("delete_object"));
                Assert.That(operation.sceneId, Is.EqualTo(scenario.FirstSceneId));
                Assert.That(operation.objectId, Is.EqualTo(scenario.FirstRootId));
            }
        }

        [Test]
        public void ClosedSceneDoesNotPreventChangesInAnotherLoadedScene()
        {
            using (var scenario = new SceneLifecycleScenario())
            {
                scenario.CloseFirstScene();
                scenario.SecondRoot.name = "Renamed in the loaded Scene";
                scenario.Update();

                Assert.That(scenario.SentOperations, Has.Count.EqualTo(1));
                var operation = scenario.SentOperations[0];
                Assert.That(operation.kind, Is.EqualTo("rename_object"));
                Assert.That(operation.sceneId, Is.EqualTo(scenario.SecondSceneId));
                Assert.That(operation.objectId, Is.EqualTo(scenario.SecondRootId));
                Assert.That(operation.name, Is.EqualTo(scenario.SecondRoot.name));
            }
        }

        private static FieldInfo Field(Type type, string name)
        {
            return type.GetField(name, BindingFlags.Static | BindingFlags.Instance | BindingFlags.NonPublic)
                   ?? throw new MissingFieldException(type.FullName, name);
        }

        private static void Invoke(Type type, string name)
        {
            var method = type.GetMethod(name, BindingFlags.Static | BindingFlags.NonPublic)
                         ?? throw new MissingMethodException(type.FullName, name);
            method.Invoke(null, null);
        }

        private sealed class SceneLifecycleScenario : IDisposable
        {
            private const string Folder = "Assets/__TeamForgeHierarchySceneLifecycleTests";
            private readonly TeamForgeSharedEditorStateScope _shared = new TeamForgeSharedEditorStateScope();
            private readonly List<CollectionSnapshot> _collections = new List<CollectionSnapshot>();
            private readonly RecordingTransport _transport = new RecordingTransport();
            private readonly object _oldStatus;
            private readonly string _firstPath = $"{Folder}/{Guid.NewGuid():N}.unity";
            private readonly string _secondPath = $"{Folder}/{Guid.NewGuid():N}.unity";
            private Scene _firstScene;
            private bool _disposed;

            internal SceneLifecycleScenario()
            {
                var hierarchy = typeof(TeamForgeHierarchySyncService);
                _oldStatus = Field(hierarchy, "_status").GetValue(null);
                try
                {
                    Field(hierarchy, "_wasConnected").SetValue(null, false);
                    Field(typeof(TeamForgeTransformSyncService), "_wasConnected").SetValue(null, false);
                    Field(typeof(TeamForgeConnectionService), "<State>k__BackingField")
                        .SetValue(null, TeamForgeConnectionState.Disconnected);
                    using (TeamForgeTransformSyncService.SuppressSelectionLock())
                        TeamForgeSharedEditorStateScope.SetSingleSelection(null);

                    Registry = (TeamForgeHierarchyRegistry)Field(hierarchy, "Authoritative").GetValue(null);
                    SaveAndClear(Field(typeof(TeamForgeHierarchyRegistry), "_objects").GetValue(Registry));
                    SaveAndClear(Field(typeof(TeamForgeHierarchyRegistry), "_tombstones").GetValue(Registry));
                    foreach (var name in new[] { "PendingByRequestId", "PendingSeeds", "LocalObjectByKey", "UnsafePrefabKeys", "AuthoritativeSceneIds" })
                        SaveAndClear(Field(hierarchy, name).GetValue(null));

                    if (!AssetDatabase.IsValidFolder(Folder)) AssetDatabase.CreateFolder("Assets", "__TeamForgeHierarchySceneLifecycleTests");
                    _firstScene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                    FirstRoot = new GameObject("First Scene Root");
                    var child = new GameObject("First Scene Child");
                    child.transform.SetParent(FirstRoot.transform, false);
                    Assert.That(EditorSceneManager.SaveScene(_firstScene, _firstPath), Is.True);
                    FirstSceneId = AssetDatabase.AssetPathToGUID(_firstPath);

                    var secondScene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Additive);
                    SecondRoot = new GameObject("Second Scene Root");
                    SceneManager.MoveGameObjectToScene(SecondRoot, secondScene);
                    Assert.That(EditorSceneManager.SaveScene(secondScene, _secondPath), Is.True);
                    SecondSceneId = AssetDatabase.AssetPathToGUID(_secondPath);
                    FirstRootId = Register(FirstRoot, FirstSceneId, string.Empty);
                    Register(child, FirstSceneId, FirstRootId);
                    SecondRootId = Register(SecondRoot, SecondSceneId, string.Empty);

                    var connection = typeof(TeamForgeConnectionService);
                    Field(connection, "_transport").SetValue(null, _transport);
                    Field(connection, "<State>k__BackingField").SetValue(null, TeamForgeConnectionState.Connected);
                    Field(connection, "<ConnectionId>k__BackingField").SetValue(null, "scene-lifecycle-" + Guid.NewGuid().ToString("N"));
                    Field(connection, "<TransformSyncAvailable>k__BackingField").SetValue(null, false);
                    Field(connection, "<HierarchySyncAvailable>k__BackingField").SetValue(null, true);
                    Invoke(typeof(TeamForgeAuthorityView), "ObserveConnection");
                    Field(hierarchy, "_wasConnected").SetValue(null, true);
                    Field(hierarchy, "_receivedSnapshot").SetValue(null, true);
                    Field(hierarchy, "_pendingOperation").SetValue(null, null);
                    Field(hierarchy, "_recoveryBlocked").SetValue(null, false);
                    Field(hierarchy, "_scanScheduled").SetValue(null, false);
                }
                catch
                {
                    Dispose();
                    throw;
                }
            }

            internal GameObject FirstRoot { get; }
            internal GameObject SecondRoot { get; }
            internal string FirstSceneId { get; }
            internal string SecondSceneId { get; }
            internal string FirstRootId { get; }
            internal string SecondRootId { get; }
            internal TeamForgeHierarchyRegistry Registry { get; }
            internal List<HierarchyOperationMessage> SentOperations => _transport.Operations;

            private void SaveAndClear(object collection)
            {
                _collections.Add(new CollectionSnapshot(collection));
                collection.GetType().GetMethod("Clear").Invoke(collection, null);
            }

            private string Register(GameObject target, string sceneId, string parentId)
            {
                Assert.That(TeamForgeObjectIdentity.TryGetGlobalObjectId(target, out var objectId), Is.True);
                Registry.Upsert(new TeamForgeHierarchyState
                {
                    SceneId = sceneId, ObjectId = objectId, Name = target.name, ParentObjectId = parentId,
                    SiblingIndex = target.transform.GetSiblingIndex(), Transform = TeamForgeTransformState.Capture(target.transform),
                });
                ((HashSet<string>)Field(typeof(TeamForgeHierarchySyncService), "AuthoritativeSceneIds").GetValue(null)).Add(sceneId);
                ((Dictionary<string, GameObject>)Field(typeof(TeamForgeHierarchySyncService), "LocalObjectByKey").GetValue(null))
                    [sceneId + "\n" + objectId] = target;
                return objectId;
            }

            internal void CloseFirstScene()
            {
                Assert.That(EditorSceneManager.CloseScene(_firstScene, true), Is.True);
                Assert.That(_firstScene.isLoaded, Is.False);
                Assert.That((bool)Field(typeof(TeamForgeHierarchySyncService), "_scanScheduled").GetValue(null), Is.True,
                    "The actual Scene-close callback must schedule the scan under test.");
            }

            internal void Update() => Invoke(typeof(TeamForgeHierarchySyncService), "Update");

            public void Dispose()
            {
                if (_disposed) return;
                _disposed = true;
                Field(typeof(TeamForgeHierarchySyncService), "_wasConnected").SetValue(null, false);
                try
                {
                    EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                    AssetDatabase.DeleteAsset(_firstPath);
                    AssetDatabase.DeleteAsset(_secondPath);
                    if (AssetDatabase.IsValidFolder(Folder) && AssetDatabase.FindAssets(string.Empty, new[] { Folder }).Length == 0)
                        AssetDatabase.DeleteAsset(Folder);
                }
                finally
                {
                    foreach (var snapshot in _collections) snapshot.Restore();
                    _shared.Dispose();
                    Field(typeof(TeamForgeHierarchySyncService), "_status").SetValue(null, _oldStatus);
                }
            }
        }

        private sealed class RecordingTransport : IRealtimeTransport
        {
            internal List<HierarchyOperationMessage> Operations { get; } = new List<HierarchyOperationMessage>();
            public event Action Connected { add { } remove { } }
            public event Action<string> TextReceived { add { } remove { } }
            public event Action<string> Closed { add { } remove { } }
            public event Action<Exception> Faulted { add { } remove { } }
            public Task ConnectAsync(CancellationToken cancellationToken) => Task.CompletedTask;
            public Task DisconnectAsync(CancellationToken cancellationToken) => Task.CompletedTask;
            public void Dispose() { }

            public Task SendTextAsync(string text, CancellationToken cancellationToken)
            {
                if (TeamForgeProtocol.TryReadEnvelope(text, out var envelope, out _) && envelope.type == "hierarchy_operation")
                    Operations.Add(TeamForgeProtocol.Deserialize<HierarchyOperationMessage>(text));
                return Task.CompletedTask;
            }
        }

        // SharedEditorStateScope restores scalar connection/authority/selection
        // state; these snapshots also restore the Hierarchy collections we isolate.
        private sealed class CollectionSnapshot
        {
            private readonly object _collection;
            private readonly List<DictionaryEntry> _entries;
            private readonly List<object> _items;

            internal CollectionSnapshot(object collection)
            {
                _collection = collection;
                if (collection is IDictionary dictionary)
                {
                    _entries = new List<DictionaryEntry>();
                    foreach (DictionaryEntry entry in dictionary) _entries.Add(entry);
                }
                else
                {
                    _items = new List<object>();
                    foreach (var item in (IEnumerable)collection) _items.Add(item);
                }
            }

            internal void Restore()
            {
                _collection.GetType().GetMethod("Clear").Invoke(_collection, null);
                if (_collection is IDictionary dictionary)
                {
                    foreach (var entry in _entries) dictionary[entry.Key] = entry.Value;
                }
                else
                {
                    var add = _collection.GetType().GetMethod("Add");
                    foreach (var item in _items) add.Invoke(_collection, new[] { item });
                }
            }
        }
    }
}

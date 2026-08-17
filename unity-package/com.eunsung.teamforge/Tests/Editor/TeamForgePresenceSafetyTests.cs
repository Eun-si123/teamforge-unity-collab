using System;
using NUnit.Framework;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace EunSung.TeamForge.Tests
{
    public sealed class TeamForgePresenceSafetyTests
    {
        private const string TemporaryFolder = "Assets/__TeamForgePresenceSafetyTests";

        [Test]
        public void IdentityPresenceRegistryAndSelectionDoNotDirtySavedSceneOrCreateTransformUndo()
        {
            EnsureTemporaryFolder();
            var scenePath = $"{TemporaryFolder}/{Guid.NewGuid():N}.unity";
            Scene workingScene = default;
            GameObject previousSelection = Selection.activeGameObject;

            try
            {
                workingScene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                var gameObject = new GameObject("Presence Read Only");
                SceneManager.MoveGameObjectToScene(gameObject, workingScene);
                Assert.That(EditorSceneManager.SaveScene(workingScene, scenePath), Is.True);
                Assert.That(workingScene.isDirty, Is.False);
                Undo.IncrementCurrentGroup();
                var undoGroupBeforePresence = Undo.GetCurrentGroup();

                Assert.That(TeamForgeObjectIdentity.TryGetGlobalObjectId(gameObject, out var objectId), Is.True);
                var registry = new TeamForgePresenceRegistry();
                Assert.That(
                    registry.ReplaceAll(new[] { ValidPresence(objectId) }, out var error),
                    Is.True,
                    error);
                Selection.activeGameObject = gameObject;

                Assert.That(workingScene.isDirty, Is.False);
                Assert.That(Undo.GetCurrentGroup(), Is.EqualTo(undoGroupBeforePresence));
                Assert.That(workingScene.isDirty, Is.False);
            }
            finally
            {
                Selection.activeGameObject = previousSelection;
                if (workingScene.IsValid() && workingScene.isLoaded)
                {
                    workingScene = EditorSceneManager.NewScene(
                        NewSceneSetup.EmptyScene,
                        NewSceneMode.Single);
                }
                AssetDatabase.DeleteAsset(scenePath);
                if (AssetDatabase.IsValidFolder(TemporaryFolder) &&
                    AssetDatabase.FindAssets(string.Empty, new[] { TemporaryFolder }).Length == 0)
                {
                    AssetDatabase.DeleteAsset(TemporaryFolder);
                }
            }
        }

        private static PresenceRecord ValidPresence(string objectId)
        {
            return new PresenceRecord
            {
                userId = "editor-a",
                connectionId = "connection-a",
                displayName = "Editor A",
                color = "#64B5F6",
                sceneId = "scene-guid",
                sceneName = "SampleScene",
                selectedObjectId = objectId,
                selectedObjectName = "Presence Read Only",
                hasSceneView = true,
                cameraPosition = new TeamForgeVector3Dto(),
                cameraRotation = new TeamForgeQuaternionDto { w = 1 },
                cameraPivot = new TeamForgeVector3Dto(),
                cameraSize = 10,
                cameraOrthographic = false,
                activity = "Selecting",
                lastHeartbeatUnixMs = 1786000000000,
            };
        }

        private static void EnsureTemporaryFolder()
        {
            if (!AssetDatabase.IsValidFolder(TemporaryFolder))
            {
                AssetDatabase.CreateFolder("Assets", "__TeamForgePresenceSafetyTests");
            }
        }
    }
}

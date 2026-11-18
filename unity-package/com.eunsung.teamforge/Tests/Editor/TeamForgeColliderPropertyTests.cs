using System;
using NUnit.Framework;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace EunSung.TeamForge.Tests
{
    public sealed class TeamForgeColliderPropertyTests
    {
        private const string Folder = "Assets/__TeamForgeColliderPropertyTests";
        private Scene scene;
        private string scenePath;
        private BoxCollider box;
        private BoxCollider sibling;
        private SphereCollider sphere;

        [SetUp]
        public void SetUp()
        {
            if (!AssetDatabase.IsValidFolder(Folder)) AssetDatabase.CreateFolder("Assets", "__TeamForgeColliderPropertyTests");
            scenePath = Folder + "/" + Guid.NewGuid().ToString("N") + ".unity";
            scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var owner = new GameObject("Exact saved Collider owner");
            box = owner.AddComponent<BoxCollider>();
            sibling = owner.AddComponent<BoxCollider>();
            sibling.center = new Vector3(9f, 8f, 7f);
            sphere = new GameObject("Sphere owner").AddComponent<SphereCollider>();
            Assert.That(EditorSceneManager.SaveScene(scene, scenePath), Is.True);
            AssetDatabase.ImportAsset(scenePath, ImportAssetOptions.ForceSynchronousImport);
        }

        [TearDown]
        public void TearDown()
        {
            if (box != null) Undo.ClearUndo(box.gameObject.transform);
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            AssetDatabase.DeleteAsset(scenePath);
            if (AssetDatabase.IsValidFolder(Folder) && AssetDatabase.FindAssets(string.Empty, new[] { Folder }).Length == 0)
                AssetDatabase.DeleteAsset(Folder);
        }

        [Test]
        public void ContinuousDirtySceneCasUpdatesOnlyExactPropertyAndComponent()
        {
            var center = Read(box, "m_Center");
            Assert.That(TeamForgeColliderProperty.TryApply(center, center.WithValue(new Vector3(1f, 2f, 3f)), out var error), Is.True, error);
            Assert.That(scene.isDirty, Is.True);
            var dirtyCenter = Read(box, "m_Center");
            Assert.That(TeamForgeColliderProperty.TryApply(dirtyCenter, dirtyCenter.WithValue(new Vector3(4f, 5f, 6f)), out error), Is.True, error);
            var trigger = Read(box, "m_IsTrigger");
            Assert.That(TeamForgeColliderProperty.TryApply(trigger, trigger.WithValue(true), out error), Is.True, error);
            Assert.That(box.center, Is.EqualTo(new Vector3(4f, 5f, 6f)));
            Assert.That(box.isTrigger, Is.True);
            Assert.That(box.size, Is.EqualTo(Vector3.one));
            Assert.That(sibling.center, Is.EqualTo(new Vector3(9f, 8f, 7f)));
            Assert.That(box.transform.localPosition, Is.EqualTo(Vector3.zero));
        }

        [Test]
        public void StaleCasRefusesOverwriteAndPreservesOtherLocalWork()
        {
            var before = Read(box, "m_Center");
            box.center = new Vector3(10f, 20f, 30f);
            box.size = new Vector3(3f, 4f, 5f);
            box.transform.localPosition = new Vector3(7f, 8f, 9f);
            Assert.That(TeamForgeColliderProperty.TryApply(before, before.WithValue(Vector3.one), out _), Is.False);
            Assert.That(box.center, Is.EqualTo(new Vector3(10f, 20f, 30f)));
            Assert.That(box.size, Is.EqualTo(new Vector3(3f, 4f, 5f)));
            Assert.That(box.transform.localPosition, Is.EqualTo(new Vector3(7f, 8f, 9f)));
        }

        [Test]
        public void RemoteApplyDoesNotJoinOrRevertUnrelatedUnityUndo()
        {
            Undo.IncrementCurrentGroup();
            Undo.RecordObject(box.transform, "Unrelated local Transform");
            box.transform.localPosition = new Vector3(2f, 3f, 4f);
            Undo.FlushUndoRecordObjects();
            Undo.IncrementCurrentGroup();
            var center = Read(box, "m_Center");
            Assert.That(TeamForgeColliderProperty.TryApply(center, center.WithValue(Vector3.one), out var error), Is.True, error);
            Undo.PerformUndo();
            Assert.That(box.transform.localPosition, Is.EqualTo(Vector3.zero));
            Assert.That(box.center, Is.EqualTo(Vector3.one), "A local Transform Undo must not remove remote Collider state.");
        }

        [Test]
        public void SavedReopenedSceneResolvesSameComponentAfterRepeatedEdits()
        {
            var old = Read(box, "m_Center");
            Assert.That(TeamForgeColliderProperty.TryApply(old, old.WithValue(new Vector3(3f, 2f, 1f)), out var error), Is.True, error);
            Assert.That(EditorSceneManager.SaveScene(scene, scenePath), Is.True);
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            scene = EditorSceneManager.OpenScene(scenePath, OpenSceneMode.Single);
            Assert.That(TeamForgeColliderProperty.TryRead(old, out var reopened, out error), Is.True, error);
            Assert.That(reopened.Vector, Is.EqualTo(new Vector3(3f, 2f, 1f)));
            Assert.That(TeamForgeColliderProperty.TryApply(reopened, reopened.WithValue(new Vector3(6f, 5f, 4f)), out error), Is.True, error);
            Assert.That(TeamForgeColliderProperty.TryRead(old, out var latest, out error), Is.True, error);
            Assert.That(latest.Vector, Is.EqualTo(new Vector3(6f, 5f, 4f)));
        }

        [Test]
        public void WrongOwnerOrWrongPathCannotRetargetSavedComponent()
        {
            var center = Read(box, "m_Center");
            var otherOwner = Read(sphere, "m_Center");
            var forged = new TeamForgeColliderProperty(center.SceneId, otherOwner.ObjectId, center.ComponentId,
                center.TypeName, center.Path, center.Kind, false, 0f, Vector3.zero);
            Assert.That(TeamForgeColliderProperty.TryRead(forged, out _, out _), Is.False);
            var wrongPath = new TeamForgeColliderProperty(center.SceneId, center.ObjectId, center.ComponentId,
                center.TypeName, "m_Enabled", "boolean", true, 0f, Vector3.zero);
            Assert.That(wrongPath.IsValid, Is.False);
            Assert.That(TeamForgeColliderProperty.TryApply(center, wrongPath, out _), Is.False);
        }

        [Test]
        public void InvalidOrApproximatelyEqualValuesAreNotAcceptedAsExactValues()
        {
            var center = Read(box, "m_Center");
            Assert.That(center.SameValue(center.WithValue(new Vector3(0.000001f, 0f, 0f))), Is.False);
            Assert.That(center.WithValue(new Vector3(float.NaN, 0f, 0f)).IsValid, Is.False);
            Assert.That(Read(box, "m_Size").WithValue(new Vector3(-1f, 1f, 1f)).IsValid, Is.False);
            Assert.That(Read(sphere, "m_Radius").WithValue(-1f).IsValid, Is.False);
            Assert.That(Read(sphere, "m_Radius").WithValue(float.PositiveInfinity).IsValid, Is.False);
        }

        [Test]
        public void NativeBooleanFloatVectorCodecRoundTripsWithoutDefaultingMissingValues()
        {
            foreach (var expected in new[] { Read(box, "m_IsTrigger"), Read(box, "m_Center").WithValue(new Vector3(1.5f, -2.25f, 3.75f)), Read(sphere, "m_Radius").WithValue(2.5f) })
            {
                var json = expected.ToWireJson();
                Assert.That(TeamForgeColliderProperty.TryParseRow(json, out var parsed, out var error), Is.True, error);
                Assert.That(parsed.SameTarget(expected) && parsed.SameValue(expected), Is.True, json);
                var missing = json.Substring(0, json.IndexOf(",\"value\":", StringComparison.Ordinal)) + "}";
                Assert.That(TeamForgeColliderProperty.TryParseRow(missing, out _, out _), Is.False);
            }
            var triggerJson = Read(box, "m_IsTrigger").ToWireJson();
            Assert.That(TeamForgeColliderProperty.TryParseRow(triggerJson.Replace("\"value\":false", "\"value\":0"), out _, out _), Is.False);
            Assert.That(TeamForgeColliderProperty.TryParseRow(triggerJson.Replace("\"value\":false", "\"value\":\"false\""), out _, out _), Is.False);
            Assert.That(TeamForgeColliderProperty.TryParseRow(triggerJson.Replace("\"value\":false", "\"value\":true,\"value\":false"), out _, out _), Is.False);
        }

        [Test]
        public void SnapshotCodecRejectsDuplicateMissingOrFutureRowRevisionsAndSceneMismatch()
        {
            var center = Read(box, "m_Center");
            var row = center.ToWireJson(false);
            var withRevision = row.Substring(0, row.Length - 1) + ",\"serverRevision\":3}";
            var prefix = "{\"sceneId\":\"" + center.SceneId + "\",\"serverRevision\":5,\"properties\":[";
            Assert.That(TeamForgeColliderProperty.TryParseRows(prefix + withRevision + "]}", out var parsed, out var error), Is.True, error);
            Assert.That(parsed[0].Revision, Is.EqualTo(3));
            Assert.That(TeamForgeColliderProperty.TryParseRows(prefix + withRevision + "," + withRevision + "]}", out _, out _), Is.False);
            Assert.That(TeamForgeColliderProperty.TryParseRows(prefix + row + "]}", out _, out _), Is.False);
            Assert.That(TeamForgeColliderProperty.TryParseRows(prefix + withRevision.Replace("\"serverRevision\":3", "\"serverRevision\":6") + "]}", out _, out _), Is.False);
            var foreign = center.ToWireJson().Replace(center.SceneId, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
            Assert.That(TeamForgeColliderProperty.TryParseRows(prefix + foreign + "]}", out _, out _), Is.False);
        }

        [TestCase("null")]
        [TestCase("[]")]
        [TestCase("{\"x\":1,\"y\":2}")]
        [TestCase("{\"x\":1,\"y\":2,\"z\":3,\"w\":4}")]
        [TestCase("{\"x\":1e999,\"y\":2,\"z\":3}")]
        [TestCase("{\"x\":\"1\",\"y\":2,\"z\":3}")]
        [TestCase("{\"x\":01,\"y\":2,\"z\":3}")]
        public void CodecRejectsInvalidNativeVectorShape(string nativeValue)
        {
            var center = Read(box, "m_Center");
            var json = center.ToWireJson();
            json = json.Substring(0, json.IndexOf(",\"value\":", StringComparison.Ordinal)) + ",\"value\":" + nativeValue + "}";
            Assert.That(TeamForgeColliderProperty.TryParseRow(json, out _, out _), Is.False);
        }

        private static TeamForgeColliderProperty Read(Component component, string path)
        {
            Assert.That(TeamForgeWp6InspectorProbe.TryCapture(component, out var captured, out var error), Is.True, error);
            foreach (var value in captured.Properties)
                if (value.Path == path) return TeamForgeColliderProperty.FromObservation(captured, value);
            Assert.Fail("Missing expected Collider property.");
            return null;
        }
    }
}

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using NUnit.Framework;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace EunSung.TeamForge.Tests
{
    public sealed class TeamForgeWp6SerializedSceneWitnessTests
    {
        private const string Folder = "Assets/__TeamForgeWp6SerializedSceneWitnessTests";

        private const string Yaml = @"%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1 &100
GameObject:
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_Component:
  - component: {fileID: 201}
  - component: {fileID: 202}
--- !u!65 &201
BoxCollider:
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 100}
  m_IsTrigger: 1
  m_Size: {x: 1, y: 2, z: 3}
  m_Center: {x: 0.000001, y: -2, z: 3}
--- !u!65 &202
BoxCollider:
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 100}
  m_IsTrigger: 0
  m_Size: {x: 4, y: 5, z: 6}
  m_Center: {x: 0, y: 0, z: 0}
--- !u!1 &101
GameObject:
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_Component:
  - component: {fileID: 203}
--- !u!135 &203
SphereCollider:
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 101}
  m_IsTrigger: 0
  m_Radius: 0.5
  m_Center: {x: 0, y: 1, z: 0}
";

        private static List<TeamForgeWp6YamlColliderWitness.Collider> Observed()
        {
            return new List<TeamForgeWp6YamlColliderWitness.Collider> {
                new TeamForgeWp6YamlColliderWitness.Collider(
                    201, 100, true, true, 0.000001f, -2, 3, 1, 2, 3, 0),
                new TeamForgeWp6YamlColliderWitness.Collider(
                    202, 100, true, false, 0, 0, 0, 4, 5, 6, 0),
                new TeamForgeWp6YamlColliderWitness.Collider(
                    203, 101, false, false, 0, 1, 0, 0, 0, 0, 0.5f),
            };
        }

        [Test]
        public void CanonicalUnityYamlAndTwoSameTypeCollidersMatchByExactOwnerAndFileId()
        {
            var entries = Observed();
            entries.Reverse();
            Assert.That(TeamForgeWp6YamlColliderWitness.TryVerify(Yaml, entries, out var error),
                Is.True, error);
            var unityEmptyScalar = Yaml.Replace("  m_IsTrigger: 1",
                "  m_EditorClassIdentifier:\n  m_IsTrigger: 1");
            Assert.That(TeamForgeWp6YamlColliderWitness.TryVerify(
                unityEmptyScalar, entries, out error), Is.True, error,
                "Unity allows empty unrelated m_ scalar values in actual Scene YAML.");
        }

        [Test]
        public void Unity6SceneRootsUsesLargeClassIdWithValidSignedFileId()
        {
            var text = Yaml +
                "--- !u!1660057539 &9223372036854775807\n" +
                "SceneRoots:\n" +
                "  m_Roots:\n" +
                "  - {fileID: 100}\n" +
                "  - {fileID: 101}\n";
            Assert.That(TeamForgeWp6YamlColliderWitness.TryVerify(
                text, Observed(), out var error), Is.True, error);
            Assert.That(TeamForgeWp6YamlColliderWitness.TryVerify(
                text.Replace("1660057539", "99999999999"), Observed(), out _), Is.False);
            Assert.That(TeamForgeWp6YamlColliderWitness.TryVerify(
                text.Replace("9223372036854775807", "9223372036854775808"),
                Observed(), out _), Is.False);
        }

        [Test]
        public void NegativeSignedUnitySceneFileIdsMatchExactGlobalObjectIdBitPatterns()
        {
            var ids = new[] { ("100", "-100"), ("101", "-101"),
                ("201", "-201"), ("202", "-202"), ("203", "-203") };
            var sample = Yaml;
            // Replace only structured YAML ID occurrences, not property values.
            foreach (var pair in ids)
                sample = sample.Replace("&" + pair.Item1, "&" + pair.Item2)
                    .Replace("fileID: " + pair.Item1 + "}", "fileID: " + pair.Item2 + "}");
            var entries = new System.Collections.Generic.List<TeamForgeWp6YamlColliderWitness.Collider> {
                new TeamForgeWp6YamlColliderWitness.Collider(
                    unchecked((ulong)-201L), unchecked((ulong)-100L),
                    true, true, 0.000001f, -2, 3, 1, 2, 3, 0),
                new TeamForgeWp6YamlColliderWitness.Collider(
                    unchecked((ulong)-202L), unchecked((ulong)-100L),
                    true, false, 0, 0, 0, 4, 5, 6, 0),
                new TeamForgeWp6YamlColliderWitness.Collider(
                    unchecked((ulong)-203L), unchecked((ulong)-101L),
                    false, false, 0, 1, 0, 0, 0, 0, 0.5f),
            };
            Assert.That(TeamForgeWp6YamlColliderWitness.TryVerify(sample, entries,
                out var error), Is.True, error);
            Assert.That(TeamForgeWp6YamlColliderWitness.TryVerify(
                sample.Replace("fileID: -201}", "fileID: -202}"),
                entries, out _), Is.False);
            Assert.That(TeamForgeWp6YamlColliderWitness.TryVerify(
                sample.Replace("&-201", "&-9223372036854775809"),
                entries, out _), Is.False);
        }

        [Test]
        public void TinyFloatChangeMissingColliderDuplicateIdsAndOwnerConflictsFailClosed()
        {
            var entries = Observed();
            foreach (var yaml in new [] {
                Yaml.Replace("0.000001", "0.000002"),
                Yaml.Replace("  m_IsTrigger: 1", "  m_IsTrigger: 0"),
                Yaml.Replace("  m_GameObject: {fileID: 101}", "  m_GameObject: {fileID: 100}"),
                Yaml.Replace("  - component: {fileID: 203}", "  - component: {fileID: 202}"),
                Yaml.Replace("m_Radius: 0.5", "m_Radius: -0.5"),
                Yaml.Replace("  m_Size: {x: 1, y: 2, z: 3}",
                    "  m_Size: {x: 1, y: 2, z: 3}\n  m_Size: {x: 1, y: 2, z: 3}"),
                Yaml.Replace("--- !u!65 &202", "--- !u!65 &201"),
                Yaml.Replace("--- !u!135 &203", "--- !u!135 &204"),
            })
            {
                Assert.That(TeamForgeWp6YamlColliderWitness.TryVerify(yaml, entries, out _),
                    Is.False, "Mismatch must not return an accepted partial Scene.");
            }
            entries.RemoveAt(0);
            Assert.That(TeamForgeWp6YamlColliderWitness.TryVerify(Yaml, entries, out _),
                Is.False, "All allowlisted serialized Colliders must be represented.");
        }

        [Test]
        public void UnsupportedPrefabBinaryYamlSchemaAndOversizedInputNeverPass()
        {
            var entries = Observed();
            foreach (var yaml in new [] {
                "not Unity yaml",
                Yaml.Replace("%YAML 1.1", "%YAML 1.2"),
                Yaml.Replace("m_PrefabInstance: {fileID: 0}", "m_PrefabInstance: {fileID: 42}"),
                Yaml + "--- !u!1001 &204\nPrefabInstance:\n",
                Yaml + "--- !u!65 &999 stripped\nBoxCollider:\n",
                Yaml.Replace("m_IsTrigger: 1", "m_IsTrigger: true"),
                Yaml.Replace("m_Radius: 0.5", "m_Radius: NaN"),
                Yaml.Replace("m_Radius: 0.5", "m_Radius:"),
                Yaml.Replace("  m_IsTrigger: 1", "  m_IsTrigger:"),
                Yaml.Replace("  m_IsTrigger: 1",
                    "  m_EditorClassIdentifier:\n  m_EditorClassIdentifier:\n  m_IsTrigger: 1"),
                Yaml.Replace("  - component: {fileID: 201}",
                    "  - component: {fileID: 201}\n  - component: {fileID: 201}"),
                Yaml.Replace("  m_GameObject: {fileID: 100}", "  m_GameObject: {fileID: 0}"),
            })
                Assert.That(TeamForgeWp6YamlColliderWitness.TryVerify(yaml, entries, out _), Is.False);
            Assert.That(TeamForgeWp6YamlColliderWitness.TryVerify(
                new string('x', TeamForgeWp6YamlColliderWitness.MaximumSerializedBytes + 1),
                entries, out _), Is.False);
            Assert.That(TeamForgeWp6YamlColliderWitness.TryVerify(Yaml, null, out _), Is.False);
        }

        [Test]
        public void ActualSavedUnitySceneMatchesExactSerializedColliderValuesWithoutWrites()
        {
            var scenePath = PrepareScenePath();
            Scene scene = default;
            try
            {
                scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                var first = new GameObject("two copies");
                SceneManager.MoveGameObjectToScene(first, scene);
                var boxA = first.AddComponent<BoxCollider>();
                boxA.isTrigger = true;
                boxA.center = new Vector3(0.000001f, -2f, 3f);
                boxA.size = new Vector3(1f, 2f, 3f);
                var boxB = first.AddComponent<BoxCollider>();
                boxB.size = new Vector3(4f, 5f, 6f);
                var child = new GameObject("nested sphere");
                child.transform.SetParent(first.transform);
                var sphere = child.AddComponent<SphereCollider>();
                sphere.radius = 0.5f;
                sphere.center = new Vector3(0f, 1f, 0f);

                Assert.That(EditorSceneManager.SaveScene(scene, scenePath), Is.True);
                AssetDatabase.ImportAsset(scenePath, ImportAssetOptions.ForceSynchronousImport);
                Assert.That(TeamForgeBaselineFingerprint.TryCaptureActiveScene(
                    out var baseline, out var error), Is.True, error);
                var metaHash = HashMeta(scenePath);
                var undoGroup = Undo.GetCurrentGroup();

                Assert.That(TeamForgeWp6SerializedSceneWitness.TryCapture(
                    baseline, metaHash, out var proof, out error), Is.True, error);
                Assert.That(proof.ColliderCount, Is.EqualTo(3));
                Assert.That(proof.Source.Inventory.Observations.Count, Is.EqualTo(3));
                Assert.That(proof.Source.SceneFileSha256, Is.EqualTo(baseline.sha256));
                Assert.That(scene.isDirty, Is.False);
                Assert.That(Undo.GetCurrentGroup(), Is.EqualTo(undoGroup));

                EditorSceneManager.MarkSceneDirty(scene);
                Assert.That(TeamForgeWp6SerializedSceneWitness.TryCapture(
                    baseline, metaHash, out var refused, out _), Is.False);
                Assert.That(refused, Is.Null);
            }
            finally { Cleanup(scene, scenePath); }
        }

        [Test]
        public void ExternallyEditedSceneByteSourceRefusesToAttestLoadedValues()
        {
            var scenePath = PrepareScenePath();
            Scene scene = default;
            try
            {
                scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                var owner = new GameObject("source");
                SceneManager.MoveGameObjectToScene(owner, scene);
                owner.AddComponent<BoxCollider>();
                Assert.That(EditorSceneManager.SaveScene(scene, scenePath), Is.True);
                AssetDatabase.ImportAsset(scenePath, ImportAssetOptions.ForceSynchronousImport);
                Assert.That(TeamForgeBaselineFingerprint.TryCaptureActiveScene(
                    out var baseline, out var error), Is.True, error);
                var metaHash = HashMeta(scenePath);
                File.AppendAllText(scenePath, "\n# source changed outside the Editor\n");
                Assert.That(TeamForgeWp6SerializedSceneWitness.TryCapture(
                    baseline, metaHash, out var proof, out _), Is.False);
                Assert.That(proof, Is.Null);
            }
            finally { Cleanup(scene, scenePath); }
        }

        private static string HashMeta(string path)
        {
            using (var sha = SHA256.Create())
            using (var file = File.OpenRead(path + ".meta"))
                return BitConverter.ToString(sha.ComputeHash(file))
                    .Replace("-", string.Empty).ToLowerInvariant();
        }

        private static string PrepareScenePath()
        {
            if (!AssetDatabase.IsValidFolder(Folder))
                AssetDatabase.CreateFolder("Assets", "__TeamForgeWp6SerializedSceneWitnessTests");
            return Folder + "/" + Guid.NewGuid().ToString("N") + ".unity";
        }

        private static void Cleanup(Scene scene, string path)
        {
            if (scene.IsValid() && scene.isLoaded)
                EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            AssetDatabase.DeleteAsset(path);
            if (AssetDatabase.IsValidFolder(Folder) &&
                AssetDatabase.FindAssets(string.Empty, new[] { Folder }).Length == 0)
                AssetDatabase.DeleteAsset(Folder);
        }
    }
}

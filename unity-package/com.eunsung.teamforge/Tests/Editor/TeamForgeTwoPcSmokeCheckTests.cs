using NUnit.Framework;
using UnityEngine;
using Object = UnityEngine.Object;

namespace EunSung.TeamForge.Tests
{
    public sealed class TeamForgeTwoPcSmokeCheckTests
    {
        [Test]
        public void VisualInspectionDoesNotInferPrimitiveFromNameOrMutateSelection()
        {
            var emptyNamedCube = new GameObject("Cube");
            var renamedPrimitive = GameObject.CreatePrimitive(PrimitiveType.Cube);
            renamedPrimitive.name = "Renamed and not inferred from name";
            try
            {
                var missing = TeamForgeSelectedVisualCheck.Capture(null);
                Assert.That(missing.HasSelection, Is.False);
                Assert.That(missing.Detail, Does.Contain("NOT RUN"));

                var empty = TeamForgeSelectedVisualCheck.Capture(emptyNamedCube);
                Assert.That(empty.HasSelection, Is.True);
                Assert.That(empty.MeshFilterPresent, Is.False);
                Assert.That(empty.MeshAssigned, Is.False);
                Assert.That(empty.MeshRendererPresent, Is.False);
                Assert.That(empty.RendererEnabled, Is.False);
                Assert.That(empty.ColliderPresent, Is.False);

                var filter = renamedPrimitive.GetComponent<MeshFilter>();
                var renderer = renamedPrimitive.GetComponent<MeshRenderer>();
                var collider = renamedPrimitive.GetComponent<BoxCollider>();
                var originalMesh = filter.sharedMesh;
                var originalMaterial = renderer.sharedMaterial;
                var originalEnabled = renderer.enabled;
                var primitive = TeamForgeSelectedVisualCheck.Capture(renamedPrimitive);
                Assert.That(primitive.HasSelection, Is.True);
                Assert.That(primitive.MeshFilterPresent, Is.True);
                Assert.That(primitive.MeshAssigned, Is.True);
                Assert.That(primitive.MeshRendererPresent, Is.True);
                Assert.That(primitive.RendererEnabled, Is.True);
                Assert.That(primitive.ColliderPresent, Is.True);
                Assert.That(primitive.Detail, Does.Contain("NOT a remote comparison"));
                Assert.That(filter.sharedMesh, Is.SameAs(originalMesh));
                Assert.That(renderer.sharedMaterial, Is.SameAs(originalMaterial));
                Assert.That(renderer.enabled, Is.EqualTo(originalEnabled));
                Assert.That(renamedPrimitive.GetComponent<BoxCollider>(), Is.SameAs(collider));
            }
            finally
            {
                Object.DestroyImmediate(emptyNamedCube);
                Object.DestroyImmediate(renamedPrimitive);
            }
        }

        [Test]
        public void RequiresConnectionAndIdentities()
        {
            var disconnected = TeamForgeTwoPcSmokeCheck.Evaluate(
                false, true, true, true, true, 4.0, 1, true);
            Assert.That(disconnected.Passed, Is.False);
            Assert.That(disconnected.Code, Is.EqualTo("not_connected"));

            var unnamed = TeamForgeTwoPcSmokeCheck.Evaluate(
                true, true, true, true, true, 4.0, 1, false);
            Assert.That(unnamed.Code, Is.EqualTo("connection_identity_missing"));
        }

        [Test]
        public void RequiresNegotiatedFeaturesSnapshotAndActualRoundTrip()
        {
            var noFeatures = TeamForgeTwoPcSmokeCheck.Evaluate(
                true, true, false, true, true, 4.0, 1, true);
            Assert.That(noFeatures.Code, Is.EqualTo("collaboration_capability_missing"));
            var noSnapshot = TeamForgeTwoPcSmokeCheck.Evaluate(
                true, true, true, true, false, 4.0, 1, true);
            Assert.That(noSnapshot.Code, Is.EqualTo("hierarchy_snapshot_missing"));
            var noPong = TeamForgeTwoPcSmokeCheck.Evaluate(
                true, true, true, true, true, null, 1, true);
            Assert.That(noPong.Code, Is.EqualTo("roundtrip_missing"));
            var invalidPong = TeamForgeTwoPcSmokeCheck.Evaluate(
                true, true, true, true, true, double.NaN, 1, true);
            Assert.That(invalidPong.Code, Is.EqualTo("roundtrip_missing"));
        }

        [Test]
        public void RequiresObservedRemotePeerButNeverClaimsFullField()
        {
            var missing = TeamForgeTwoPcSmokeCheck.Evaluate(
                true, true, true, true, true, 2.0, 0, true);
            Assert.That(missing.Code, Is.EqualTo("remote_peer_missing"));

            var result = TeamForgeTwoPcSmokeCheck.Evaluate(
                true, true, true, true, true, 2.0, 1, true);
            Assert.That(result.Passed, Is.True);
            Assert.That(result.Code, Is.EqualTo("smoke_passed"));
            Assert.That(result.RemoteMembers, Is.EqualTo(1));
            Assert.That(result.RoundTripMilliseconds, Is.EqualTo(2.0));
            Assert.That(result.Detail, Does.Contain("NOT full two-PC"));
        }
    }
}

using System;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace EunSung.TeamForge
{
    // WP6 developer Test Lab ONLY. A pasted Project Peer CLI JSON is an
    // *unauthenticated reference*, NOT a signed remote attestation.
    // This never grants a Server right, starts a WS request, or writes Unity.
    internal static class TeamForgeWp6ActiveSourceReportComparison
    {
        private const int MaxJsonCharacters = 8192;
        private const int MaxSceneBytes = 16 * 1024 * 1024;

        [Serializable]
        internal sealed class LocalReference
        {
            public int schemaVersion;
            public string status;
            public string projectId;
            public string projectUuid;
            public long baselineRevision;
            public string manifestHash;
            public string descriptorHash;
            public string ownerKeyId;
            public string publisherKeyId;
            public string sceneId;
            public string scenePath;
            public string sceneFileSha256;
            public int sceneFileBytes;
            public string sceneMetaSha256;
            public bool manifestMembershipVerified;
            public bool signedActiveFileBytesVerified;
            public bool inspectorValuesVerified;
            public bool currentServerSessionVerified;
            public bool editorApplyVerified;
            public bool networkWriteAuthorized;
        }

        private static bool SameHash(string value)
        {
            if (value == null || value.Length != 64) return false;
            foreach (char c in value)
                if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')))
                    return false;
            return true;
        }

        // The report is deliberately NOT trusted. Only an exact local
        // diagnostic match can be displayed. Never accept flags as an
        // authorization or treat this as current remote Publisher proof.
        internal static bool TryMatchReport(
            string reportJson,
            TeamForgeWp6PreviewSourceGate.ProjectPin project,
            TeamForgeWp6PreviewSourceGate.Verified editor,
            string currentScenePath,
            out string error)
        {
            if (string.IsNullOrWhiteSpace(reportJson) ||
                reportJson.Length > MaxJsonCharacters ||
                reportJson[0] != '{' ||
                project == null || !project.DescriptorMatchesBaseline ||
                editor == null)
            {
                error = "Missing, unbounded, or unverified local WP6 comparison context.";
                return false;
            }

            LocalReference report;
            try { report = JsonUtility.FromJson<LocalReference>(reportJson); }
            catch (Exception)
            {
                error = "Project Peer source reference is not valid JSON.";
                return false;
            }

            if (report == null ||
                report.schemaVersion != 1 ||
                report.status != "signed_active_scene_file_bytes_verified_local" ||
                !report.manifestMembershipVerified ||
                !report.signedActiveFileBytesVerified ||
                report.inspectorValuesVerified ||
                report.currentServerSessionVerified ||
                report.editorApplyVerified ||
                report.networkWriteAuthorized ||
                !SameHash(report.manifestHash) ||
                !SameHash(report.descriptorHash) ||
                !SameHash(report.sceneFileSha256) ||
                !SameHash(report.sceneMetaSha256) ||
                !SameHash(report.ownerKeyId) ||
                !SameHash(report.publisherKeyId) ||
                report.sceneFileBytes < 1 || report.sceneFileBytes > MaxSceneBytes)
            {
                error = "Project Peer report is incomplete, unsupported, or claims unverified authority.";
                return false;
            }

            if (!string.Equals(report.projectId, project.ProjectId, StringComparison.Ordinal) ||
                !string.Equals(report.projectUuid, project.ProjectUuid, StringComparison.Ordinal) ||
                report.baselineRevision != project.BaselineRevision ||
                !string.Equals(report.manifestHash, project.ManifestHash, StringComparison.Ordinal) ||
                !string.Equals(report.descriptorHash, project.DescriptorHash, StringComparison.Ordinal) ||
                !string.Equals(report.ownerKeyId, project.OwnerKeyId, StringComparison.Ordinal) ||
                !string.Equals(report.publisherKeyId, project.PublisherKeyId, StringComparison.Ordinal))
            {
                error = "The local Project Peer reference differs from the current connected Project baseline.";
                return false;
            }

            if (string.IsNullOrEmpty(currentScenePath) ||
                !currentScenePath.StartsWith("Assets/", StringComparison.Ordinal) ||
                !currentScenePath.EndsWith(".unity", StringComparison.Ordinal) ||
                currentScenePath.IndexOfAny(new[] { '\\', ':', '\0' }) >= 0 ||
                !string.Equals(report.scenePath, currentScenePath, StringComparison.Ordinal) ||
                !string.Equals(report.sceneId, editor.SceneGuid, StringComparison.Ordinal) ||
                !string.Equals(report.sceneFileSha256, editor.SceneFileSha256, StringComparison.Ordinal) ||
                !string.Equals(report.sceneMetaSha256, editor.MetaSha256, StringComparison.Ordinal))
            {
                error = "The saved local Editor Scene or metadata differs from the Project Peer reference.";
                return false;
            }

            error = string.Empty;
            return true;
        }

        // Re-observe Scene and Project immediately after comparing to reject
        // a local Editor switch or baseline rotation during the diagnostic.
        internal static bool TryCompareCurrent(string reportJson, out string status)
        {
            if (!TeamForgeWp6PreviewSourceGate.TryCaptureCurrentProjectPin(
                    out var firstProject, out status))
                return false;

            var active = SceneManager.GetActiveScene();
            if (!active.IsValid() || !active.isLoaded || active.isDirty ||
                string.IsNullOrEmpty(active.path))
            {
                status = "Load a clean saved active Scene first.";
                return false;
            }
            var path = active.path;
            var guid = UnityEditor.AssetDatabase.AssetPathToGUID(path);
            if (!TeamForgeWp6PreviewSourceGate.TryCaptureForReadOnlyPreview(
                    guid, out var firstScene, out status))
                return false;

            if (!TryMatchReport(reportJson, firstProject, firstScene, path, out status))
                return false;

            if (!TeamForgeWp6PreviewSourceGate.TryCaptureCurrentProjectPin(
                    out var lastProject, out status) || !firstProject.Same(lastProject) ||
                !TeamForgeWp6PreviewSourceGate.TryCaptureForReadOnlyPreview(
                    guid, out var lastScene, out status) ||
                !TeamForgeWp6PreviewSourceGate.CanReuseCachedPreview(
                    lastScene, firstScene.SceneGuid,
                    firstScene.SceneFileSha256, firstScene.MetaSha256) ||
                !string.Equals(SceneManager.GetActiveScene().path, path,
                    StringComparison.Ordinal))
            {
                status = "Editor Scene or Project changed during comparison. Retry without applying.";
                return false;
            }

            status = "LOCAL REFERENCE MATCH — saved Scene/metadata and current loaded " +
                     "Collider observations match this Project Peer report and the connected " +
                     "Project metadata. Report origin is NOT authenticated; no remote " +
                     "Scene provenance, Inspector apply, or ACK is verified.";
            return true;
        }
    }
}

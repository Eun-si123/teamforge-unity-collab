using System.IO;
using System.Runtime.InteropServices;
using System.Windows;
using TeamForge.Launcher.Core;

namespace TeamForge.Launcher;

public partial class MainWindow
{
    private async void CopyParticipantEnrollment_Click(object sender, RoutedEventArgs e)
    {
        var project = _readyProject;
        var bridge = _bridge;
        if (project is null || bridge is null || _receiving || !_runtimeReady) return;
        var operation = BeginUnityOperation();
        if (operation is null) return;
        try
        {
            StatusText.Text = "Preparing local participant identity…";
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(operation.Token);
            timeout.CancelAfter(TimeSpan.FromSeconds(20));
            var response = await bridge.SendRequestAsync("prepare_transition_identity", new Dictionary<string, object?>
            {
                ["managedRoot"] = project.ProjectsRoot,
                ["stateRoot"] = _userPaths.StateDirectory,
                ["projectUuid"] = project.ProjectUuid,
                ["baselineRevision"] = project.BaselineRevision,
                ["manifestHash"] = project.ManifestSha256,
            }, timeout.Token);
            if (!IsCurrentUnityOperation(operation) || !ReferenceEquals(project, _readyProject) ||
                !ReferenceEquals(bridge, _bridge)) return;
            var enrollment = ParticipantEnrollment.ValidateAndSerialize(response, project.ProjectUuid);
            Clipboard.SetText(enrollment);
            StatusText.Text = "Public participant enrollment copied. Share it with the Host for approval. This does not authorize a Project transition.";
            AppendDiagnostic("participant_enrollment_copied");
        }
        catch (OperationCanceledException) when (!IsCurrentUnityOperation(operation)) { }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or InvalidDataException or
            InvalidOperationException or BridgeException or OperationCanceledException or COMException)
        {
            if (!IsCurrentUnityOperation(operation)) return;
            // Never display a key, clipboard content, or untrusted worker detail.
            StatusText.Text = "Could not prepare or copy participant enrollment. Existing keys were kept. Verify the Project and retry.";
            AppendDiagnostic("participant_enrollment_unavailable");
        }
        finally { FinishUnityOperation(operation); }
    }
}

using System.IO;
using System.Runtime.InteropServices;
using System.Windows;
using TeamForge.Launcher.Core;

namespace TeamForge.Launcher;

public partial class MainWindow
{
    private async void InspectTransition_Click(object sender, RoutedEventArgs e)
    {
        var bridge = _bridge;
        if (bridge is null || !_runtimeReady || _receiving || _previewOperation is not null) return;
        var operation = BeginUnityOperation();
        if (operation is null) return;
        try
        {
            var root = RequireManagedRoot();
            var dialog = new TransitionInspectionDialog { Owner = this };
            if (dialog.ShowDialog() != true || dialog.Request is not { } request ||
                !IsCurrentUnityOperation(operation)) return;
            // A diagnostic must not be treated as a verified receive or handoff.
            StatusText.Text = "Inspecting saved files without changing the selected project…";
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(operation.Token);
            timeout.CancelAfter(TimeSpan.FromMinutes(2));
            var response = await bridge.SendRequestAsync("inspect_transition",
                request.BridgeFields(root, _userPaths.StateDirectory), timeout.Token);
            if (!IsCurrentUnityOperation(operation) || !ReferenceEquals(bridge, _bridge)) return;
            var presentation = TransitionInspectionPresentation.FromResponse(response, request);
            StatusText.Text = presentation.Summary;
            AppendDiagnostic("transition_inspection_completed");
            if (MessageBox.Show(this, presentation.Summary + "\n\nCopy this unsigned observation to share with your Host?",
                "Saved project inspection", MessageBoxButton.YesNo, MessageBoxImage.Information) == MessageBoxResult.Yes &&
                IsCurrentUnityOperation(operation))
                Clipboard.SetText(presentation.PublicReport);
        }
        catch (OperationCanceledException) when (!IsCurrentUnityOperation(operation)) { }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or InvalidDataException or
            InvalidOperationException or BridgeException or OperationCanceledException or COMException)
        {
            if (!IsCurrentUnityOperation(operation)) return;
            StatusText.Text = "Inspection or report copy could not complete. No repair was attempted. Keep existing files and ask the Host.";
            AppendDiagnostic("transition_inspection_unavailable");
        }
        finally { FinishUnityOperation(operation); }
    }
}

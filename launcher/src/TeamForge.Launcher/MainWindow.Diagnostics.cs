using Microsoft.Win32;
using System.IO;
using System.Windows;
using TeamForge.Launcher.Core;

namespace TeamForge.Launcher;

public partial class MainWindow
{
    private void SaveDiagnosticsBundle_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new SaveFileDialog
        {
            Title = "Save TeamForge support bundle",
            Filter = "TeamForge support bundle (*.zip)|*.zip",
            DefaultExt = ".zip",
            AddExtension = true,
            OverwritePrompt = true,
            FileName = $"TeamForge-Diagnostics-{DateTime.Now:yyyyMMdd-HHmmss}.zip",
        };

        if (dialog.ShowDialog(this) != true)
        {
            return;
        }

        try
        {
            var result = DiagnosticSupportBundle.Create(
                dialog.FileName,
                _diagnosticContext,
                _diagnosticHistory,
                _pendingAccessCode,
                AccessCodeBox.Password);

            var kib = Math.Max(1, (result.LengthBytes + 1023) / 1024);
            StatusText.Text = $"Support bundle saved locally ({kib} KiB). Raw local paths, endpoint addresses, and access credentials were excluded.";
            AppendDiagnostic("diagnostics_bundle_saved_locally");
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or InvalidDataException or NotSupportedException)
        {
            StatusText.Text = "The support bundle could not be saved safely.";
            AppendDiagnostic($"diagnostics_bundle_save_failed: {exception.Message}");
        }
    }
}

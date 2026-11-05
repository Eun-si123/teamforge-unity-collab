using System.Windows;
using TeamForge.Launcher.Core;

namespace TeamForge.Launcher;

public partial class TrustDialog : Window
{
    public TrustDialog(TrustPresentation presentation, string? verifiedHost)
    {
        InitializeComponent();
        var host = string.IsNullOrWhiteSpace(verifiedHost)
            ? Array.Empty<TrustDisplayField>()
            : new[] { new TrustDisplayField("Host", verifiedHost) };
        FriendlyFields.ItemsSource = presentation.FriendlyFields.Concat(host).ToArray();
        AdvancedFields.ItemsSource = presentation.AdvancedFields.Concat(host).ToArray();
        WarningText.Text = presentation.WarningText;
        WarningText.Visibility = presentation.WarningText.Length == 0
            ? Visibility.Collapsed : Visibility.Visible;
    }

    private void Trust_Click(object sender, RoutedEventArgs e)
    {
        DialogResult = true;
    }

    private void Cancel_Click(object sender, RoutedEventArgs e)
    {
        DialogResult = false;
    }
}

using System.Windows;

namespace TeamForge.Launcher;

public partial class TrustDialog : Window
{
    public TrustDialog(string friendlyText, string advancedText)
    {
        InitializeComponent();
        FriendlyText.Text = friendlyText;
        AdvancedText.Text = advancedText;
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

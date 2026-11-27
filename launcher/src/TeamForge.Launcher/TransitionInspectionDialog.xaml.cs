using System.IO;
using System.Windows;
using TeamForge.Launcher.Core;

namespace TeamForge.Launcher;

public partial class TransitionInspectionDialog : Window
{
    public TransitionInspectionRequest? Request { get; private set; }

    public TransitionInspectionDialog() => InitializeComponent();

    private void Inspect_Click(object sender, RoutedEventArgs e)
    {
        if (StoppedCheckBox.IsChecked != true)
        {
            ErrorText.Text = "Save and close Unity and stop other project writers before inspection.";
            return;
        }
        try
        {
            Request = TransitionInspectionRequest.Parse(RequestBox.Text);
            RequestBox.Clear();
            DialogResult = true;
        }
        catch (InvalidDataException)
        {
            ErrorText.Text = "The request is invalid. Ask the Host for the exact recovery inspection request.";
        }
    }
}

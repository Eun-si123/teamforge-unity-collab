using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Media;

namespace TeamForge.Launcher;

// First visible window; the packaged Runtime is verified later by MainWindow.
// Indeterminate animation never implies a fabricated percentage.
internal sealed class LauncherStartupWindow : Window
{
    internal LauncherStartupWindow()
    {
        Title = "Starting TeamForge";
        Width = 430;
        Height = 180;
        MinWidth = Width;
        MinHeight = Height;
        ResizeMode = ResizeMode.NoResize;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;
        Background = Brushes.White;

        var content = new StackPanel();
        content.Children.Add(new TextBlock
        {
            Text = "TeamForge",
            FontSize = 25,
            FontWeight = FontWeights.SemiBold,
            Foreground = new SolidColorBrush(Color.FromRgb(35, 48, 70)),
        });
        content.Children.Add(new TextBlock
        {
            Text = "Starting the Guest Launcher…",
            Margin = new Thickness(0, 12, 0, 12),
            Foreground = Brushes.DimGray,
        });
        var progress = new ProgressBar { Height = 12, IsIndeterminate = true };
        AutomationProperties.SetName(progress, "TeamForge Launcher startup in progress");
        content.Children.Add(progress);
        Content = new Border { Padding = new Thickness(25), Child = content };
    }
}

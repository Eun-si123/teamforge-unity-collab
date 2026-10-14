using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;

namespace TeamForge.Launcher;

// Owns secret presentation only. MainWindow owns invite-scoped retry lifetime,
// working copies, IPC, handoff and diagnostics; this control stores nothing.
public partial class AccessCodeInput : UserControl
{
    private bool _synchronizing;
    private Window? _ownerWindow;

    public AccessCodeInput()
    {
        InitializeComponent();
    }

    public string Password
    {
        get => MaskedCodeBox.Password;
        set
        {
            if ((value?.Length ?? 0) > MaskedCodeBox.MaxLength)
            {
                throw new ArgumentOutOfRangeException(nameof(value), "Access code exceeds the input limit.");
            }
            MaskedCodeBox.Password = value ?? string.Empty;
        }
    }

    public void Clear()
    {
        _synchronizing = true;
        try
        {
            MaskedCodeBox.Clear();
            RevealedCodeBox.Clear();
        }
        finally
        {
            _synchronizing = false;
        }
        Hide();
        UpdateClearButton();
    }

    public void Hide()
    {
        _synchronizing = true;
        try
        {
            RevealCodeButton.IsChecked = false;
            RevealedCodeBox.Clear();
            RevealedCodeBox.Visibility = Visibility.Collapsed;
            MaskedCodeBox.Visibility = Visibility.Visible;
            RevealCodeButton.Content = "Show";
            AutomationProperties.SetName(RevealCodeButton, "Show access code");
        }
        finally
        {
            _synchronizing = false;
        }
    }

    public new bool Focus() => RevealCodeButton.IsChecked == true
        ? RevealedCodeBox.Focus()
        : MaskedCodeBox.Focus();

    private void MaskedCode_Changed(object sender, RoutedEventArgs e)
    {
        if (_synchronizing) return;
        _synchronizing = true;
        try
        {
            if (RevealCodeButton.IsChecked == true)
            {
                RevealedCodeBox.Text = MaskedCodeBox.Password;
            }
        }
        finally
        {
            _synchronizing = false;
        }
        UpdateClearButton();
    }

    private void RevealedCode_Changed(object sender, TextChangedEventArgs e)
    {
        if (_synchronizing) return;
        _synchronizing = true;
        try
        {
            MaskedCodeBox.Password = RevealedCodeBox.Text;
        }
        finally
        {
            _synchronizing = false;
        }
        UpdateClearButton();
    }

    private void RevealCode_Changed(object sender, RoutedEventArgs e)
    {
        if (_synchronizing) return;
        if (RevealCodeButton.IsChecked != true || !IsEnabled || !IsVisible)
        {
            Hide();
            return;
        }
        _synchronizing = true;
        try
        {
            RevealedCodeBox.Text = MaskedCodeBox.Password;
            MaskedCodeBox.Visibility = Visibility.Collapsed;
            RevealedCodeBox.Visibility = Visibility.Visible;
            RevealCodeButton.Content = "Hide";
            AutomationProperties.SetName(RevealCodeButton, "Hide access code");
        }
        finally
        {
            _synchronizing = false;
        }
        RevealedCodeBox.Focus();
        RevealedCodeBox.CaretIndex = RevealedCodeBox.Text.Length;
    }

    private void ClearCode_Click(object sender, RoutedEventArgs e) => Clear();

    private void Input_Loaded(object sender, RoutedEventArgs e)
    {
        DetachWindow();
        _ownerWindow = Window.GetWindow(this);
        if (_ownerWindow is not null) _ownerWindow.Deactivated += OwnerWindow_Deactivated;
        Hide();
    }

    private void Input_Unloaded(object sender, RoutedEventArgs e)
    {
        DetachWindow();
        Clear();
    }

    private void DetachWindow()
    {
        if (_ownerWindow is not null) _ownerWindow.Deactivated -= OwnerWindow_Deactivated;
        _ownerWindow = null;
    }

    private void OwnerWindow_Deactivated(object? sender, EventArgs e) => Hide();

    private void Input_IsEnabledChanged(object sender, DependencyPropertyChangedEventArgs e)
    {
        if (!IsEnabled) Hide();
    }

    private void Input_IsVisibleChanged(object sender, DependencyPropertyChangedEventArgs e)
    {
        if (!IsVisible) Hide();
    }

    private void UpdateClearButton()
    {
        using var password = MaskedCodeBox.SecurePassword;
        ClearCodeButton.IsEnabled = password.Length > 0;
    }
}

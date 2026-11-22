using System.Windows;
using TeamForge.Launcher.Core;

namespace TeamForge.Launcher;

public partial class ProjectUpdateReviewDialog : Window
{
    public ProjectUpdateReviewDialog(ProjectUpdateReviewPresentation review)
    {
        InitializeComponent();
        RevisionText.Text = $"Revision {review.CurrentRevision} → revision {review.ProposedRevision}";
        ChangeCountText.Text = $"{review.AddedCount:N0} added · {review.ModifiedCount:N0} modified · {review.RemovedCount:N0} removed";
        PreviewCountText.Text = $"Showing {review.Changes.Count:N0} of {review.TotalChanges:N0} changed paths.";
        PreviewCountText.Visibility = review.TotalChanges > review.Changes.Count ? Visibility.Visible : Visibility.Collapsed;
        ChangeRows.ItemsSource = review.Changes;
        ReceiveRevisionButton.Content = $"Receive revision {review.ProposedRevision}";
    }

    private void KeepCurrent_Click(object sender, RoutedEventArgs e) => DialogResult = false;

    private void ReceiveRevision_Click(object sender, RoutedEventArgs e) => DialogResult = true;
}

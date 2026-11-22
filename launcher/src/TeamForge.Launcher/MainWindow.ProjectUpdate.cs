using System.IO;
using System.Text.Json;
using TeamForge.Launcher.Core;

namespace TeamForge.Launcher;

public partial class MainWindow
{
    private (long ReceiveEpoch, string ChallengeId)? _projectUpdateReview;
    private ProjectUpdateReviewDialog? _projectUpdateDialog;
    private Func<ProjectUpdateReviewPresentation, bool>? _confirmProjectUpdateForTests = null;

    private async Task HandleProjectUpdateReviewAsync(JsonElement message)
    {
        var epoch = _receiveEpoch;
        var bridge = _bridge;
        string? challengeId = null;
        if (bridge is null || !IsCurrentReview()) return;

        try
        {
            var presentation = ProjectUpdateReviewPresentation.FromBridgeEvent(
                message, _pendingAccessCode, AccessCodeBox.Password);
            var challenge = (epoch, presentation.ChallengeId);
            if (_projectUpdateReview == challenge) return;
            // Pause/resume can retire a challenge and issue a new one while
            // the same receive is active. Only this challenge owns its reply.
            challengeId = presentation.ChallengeId;
            if (SetProjectUpdateReview(challenge))
            {
                // Let the closed modal unwind before displaying its replacement.
                await Task.Yield();
                if (!IsCurrentReview()) return;
            }
            StatusText.Text = "Review the project update to continue.";
            var approved = ConfirmProjectUpdate(presentation);
            if (!IsCurrentReview()) return;

            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
            await bridge.SendRequestAsync("review_project_update", new Dictionary<string, object?>
            {
                ["challengeId"] = presentation.ChallengeId,
                ["approved"] = approved,
            }, timeout.Token);
            if (IsCurrentReview())
                AppendDiagnostic(approved ? "project_update_approved" : "project_update_declined");
        }
        catch (Exception exception) when (exception is BridgeException or InvalidDataException or IOException or InvalidOperationException or OperationCanceledException)
        {
            if (!IsCurrentReview() || _pauseCommandPending) return;
            ShowFailure("TeamForge could not finish the project update review safely.", "project_update_review_failed",
                "The runtime did not provide a valid project update review or accept the review decision.");
            await SendReceiveControlAsync(cancel: true);
        }

        bool IsCurrentReview() => IsCurrentReceive(epoch) && !_cancellingReceive && !_paused &&
            ReferenceEquals(bridge, _bridge) && (challengeId is null || _projectUpdateReview == (epoch, challengeId));
    }

    private bool SetProjectUpdateReview((long ReceiveEpoch, string ChallengeId)? review)
    {
        _projectUpdateReview = review;
        var previousDialog = _projectUpdateDialog;
        _projectUpdateDialog = null;
        previousDialog?.Close();
        return previousDialog is not null;
    }

    private bool ConfirmProjectUpdate(ProjectUpdateReviewPresentation review)
    {
        if (_confirmProjectUpdateForTests is not null) return _confirmProjectUpdateForTests(review);
        var dialog = new ProjectUpdateReviewDialog(review) { Owner = this };
        _projectUpdateDialog = dialog;
        try
        {
            return dialog.ShowDialog() == true;
        }
        finally
        {
            if (ReferenceEquals(_projectUpdateDialog, dialog)) _projectUpdateDialog = null;
        }
    }
}

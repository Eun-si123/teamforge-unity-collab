using System.Windows.Controls;
using TeamForge.Launcher;

internal static class LauncherStartupTests
{
    internal static void DuplicateLaunchNotifiesOwner()
    {
        var scope = "Ui-" + Guid.NewGuid().ToString("N");
        using var owner = new LauncherInstanceGate(scope);
        Require(owner.TryAcquire(), "First Launcher did not take the instance mutex.");

        // A second *thread* is essential: mutexes are recursive on the owning
        // thread, whereas a real second process runs on another thread.
        var duplicateOwned = Task.Run(() =>
        {
            using var duplicate = new LauncherInstanceGate(scope);
            var acquired = duplicate.TryAcquire();
            if (!acquired) duplicate.RequestActivation();
            return acquired;
        }).GetAwaiter().GetResult();
        Require(!duplicateOwned, "The second Launcher must not acquire the first instance's mutex.");

        // The notification preceded listener registration, as can happen on
        // a slow PC while the first application is still loading WPF.
        var notifications = 0;
        owner.ListenForActivation(() => Interlocked.Increment(ref notifications));
        Require(SpinWait.SpinUntil(() => Volatile.Read(ref notifications) == 1, TimeSpan.FromSeconds(3)),
            "A fast duplicate launch must notify even before the splash appears.");
    }

    internal static void RunningWindowCanBeReactivated()
    {
        var scope = "Ui-" + Guid.NewGuid().ToString("N");
        using var owner = new LauncherInstanceGate(scope);
        Require(owner.TryAcquire(), "First Launcher must acquire ownership.");
        var notifications = 0;
        owner.ListenForActivation(() => Interlocked.Increment(ref notifications));
        var acquired = Task.Run(() =>
        {
            using var duplicate = new LauncherInstanceGate(scope);
            var result = duplicate.TryAcquire();
            if (!result) duplicate.RequestActivation();
            return result;
        }).GetAwaiter().GetResult();
        Require(!acquired, "Duplicate Launcher obtained ownership.");
        Require(SpinWait.SpinUntil(() => Volatile.Read(ref notifications) >= 1, TimeSpan.FromSeconds(3)),
            "An already-running window did not receive the activation signal.");
    }

    internal static void ExitingReleasesOwnership()
    {
        var scope = "Ui-" + Guid.NewGuid().ToString("N");
        using (var first = new LauncherInstanceGate(scope))
        {
            Require(first.TryAcquire(), "First Launcher must acquire ownership.");
        }
        using var restarted = new LauncherInstanceGate(scope);
        Require(restarted.TryAcquire(), "Launcher restart must work after a clean exit.");
    }

    internal static void SplashIsIndeterminate()
    {
        var splash = new LauncherStartupWindow();
        try
        {
            Require(splash.Title.Contains("TeamForge", StringComparison.Ordinal),
                "Splash must identify TeamForge.");
            var content = ((Border)splash.Content).Child as StackPanel
                ?? throw new InvalidOperationException("Splash content missing.");
            var progress = content.Children.OfType<ProgressBar>().Single();
            Require(progress.IsIndeterminate,
                "Startup must never manufacture a percentage for unknown runtime loading.");
        }
        finally { splash.Close(); }
    }

    private static void Require(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException(message);
    }
}

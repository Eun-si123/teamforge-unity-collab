using System.Threading;

namespace TeamForge.Launcher;

// One visible Guest Launcher per Windows logon session. No invite, access code,
// project path or other private state is sent between processes.
internal sealed class LauncherInstanceGate : IDisposable
{
    private readonly Mutex _mutex;
    private readonly EventWaitHandle _activation;
    private RegisteredWaitHandle? _listener;
    private bool _ownsMutex;
    private int _disposed;

    internal LauncherInstanceGate(string scope)
    {
        if (string.IsNullOrEmpty(scope) || scope.Length > 64 ||
            scope.Any(character => !char.IsAsciiLetterOrDigit(character) && character != '-'))
        {
            throw new ArgumentException("Invalid Launcher instance scope.", nameof(scope));
        }
        var prefix = @"Local\TeamForge.Launcher." + scope;
        // Create the signal before the mutex so rapid repeated clicks can
        // notify the first process even before its window has appeared.
        _activation = new EventWaitHandle(false, EventResetMode.AutoReset, prefix + ".Activate");
        try { _mutex = new Mutex(false, prefix + ".Instance"); }
        catch
        {
            _activation.Dispose();
            throw;
        }
    }

    internal bool TryAcquire()
    {
        if (_ownsMutex) return true;
        try { _ownsMutex = _mutex.WaitOne(0); }
        catch (AbandonedMutexException)
        {
            // A crashed first process must not block a subsequent launch.
            _ownsMutex = true;
        }
        return _ownsMutex;
    }

    internal void RequestActivation() => _activation.Set();

    internal void ListenForActivation(Action activate)
    {
        if (!_ownsMutex) throw new InvalidOperationException("Only the owning Launcher can listen.");
        ArgumentNullException.ThrowIfNull(activate);
        if (_listener is not null) throw new InvalidOperationException("Activation listener already registered.");
        _listener = ThreadPool.RegisterWaitForSingleObject(
            _activation, (_, timedOut) =>
            {
                if (!timedOut && Volatile.Read(ref _disposed) == 0) activate();
            },
            null, Timeout.Infinite, executeOnlyOnce: false);
    }

    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0) return;
        _listener?.Unregister(null);
        _activation.Dispose();
        if (_ownsMutex) _mutex.ReleaseMutex();
        _mutex.Dispose();
    }
}

using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;

namespace EunSung.TeamForge
{
    internal enum TeamForgeCheckpointPreviewState
    {
        Idle, Scanning, Cancelling, Ready, Cancelled, Unavailable, Failed, TimedOut,
    }

    public static partial class TeamForgeHostFlow
    {
        private const int CheckpointReplyBytes = 65_536;
        private const int CheckpointPreviewPathCount = 20;
        private const long MaximumSafePeerInteger = 9_007_199_254_740_991L;

        private sealed class CheckpointContext
        {
            internal string LaunchPath;
            internal BaselinePart Baseline;
            internal TeamForgeRuntimeResolution Runtime;
        }

        [Serializable]
        private sealed class CheckpointReply
        {
            public string state;
            public BaselinePart baseline;
            public Review review;
        }

        private static CheckpointContext _checkpointContext;
        private static CancellationTokenSource _checkpointPreviewCancellation;
        private static long _checkpointSourceChangeSerial;
        private static bool _checkpointChangeNotificationScheduled;
        internal static bool LocalSourceChangedSinceCheckpointReview { get; private set; }
        internal static TeamForgeCheckpointPreviewState CheckpointPreviewState { get; private set; }
        internal static Review CheckpointPreviewResult { get; private set; }
        internal static bool HasCheckpointPreviewContext => State == TeamForgeHostFlowState.Ready && _checkpointContext != null;
        internal static bool CanBeginCheckpointPreview => HasCheckpointPreviewContext && _checkpointPreviewCancellation == null;

        private static void PinCheckpointPreview(string launchPath, BaselinePart baseline, string projectUuid)
        {
            if (_bridgeRuntime == null || baseline == null || baseline.projectUuid != projectUuid ||
                baseline.revision < 1 || baseline.revision > MaximumSafePeerInteger ||
                !TeamForgeProjectValidation.TryValidateCanonicalProjectUuid(projectUuid, out _) ||
                !TeamForgeProjectValidation.TryValidateSha256(baseline.manifestHash, "Manifest hash", out _) ||
                !TeamForgeProjectValidation.TryValidateSha256(baseline.descriptorHash, "Descriptor hash", out _) ||
                !TeamForgeProjectValidation.TryValidateSha256(baseline.launchSettingsDigest, "Launch settings digest", out _)) return;

            _checkpointContext = new CheckpointContext { LaunchPath = launchPath, Baseline = baseline, Runtime = _bridgeRuntime };
            LocalSourceChangedSinceCheckpointReview = false;
            _checkpointSourceChangeSerial += 1;
        }

        // Unity's regular Asset import/move/delete and Scene Save callbacks are
        // observations, NOT Project publication authority. A preview is only a
        // comparison of saved local bytes against a pinned signed baseline.
        // Invalidate it when a local source changes instead of showing a stale
        // "no changes" result or automatically distributing imported assets.
        internal static void MarkLocalProjectSourceChanged()
        {
            if (!HasCheckpointPreviewContext || _editorShuttingDown) return;
            LocalSourceChangedSinceCheckpointReview = true;
            _checkpointSourceChangeSerial += 1;
            CheckpointPreviewResult = null;
            if (_checkpointPreviewCancellation != null)
                CheckpointPreviewState = TeamForgeCheckpointPreviewState.Cancelling;
            else CheckpointPreviewState = TeamForgeCheckpointPreviewState.Idle;
            // An AssetPostprocessor can see many files in one import batch.
            // Notify UI once in a deferred Editor event, never from worker or
            // per-file import callbacks. No filesystem scan is triggered.
            if (_checkpointChangeNotificationScheduled) return;
            _checkpointChangeNotificationScheduled = true;
            UnityEditor.EditorApplication.delayCall += () =>
            {
                _checkpointChangeNotificationScheduled = false;
                // Cancel only after Unity finishes the import callback: the
                // worker registration may kill a child process synchronously.
                // Generation checking already makes any finished old result
                // stale; avoid blocking import or duplicate cancellation.
                if (_checkpointPreviewCancellation != null &&
                    CheckpointPreviewState == TeamForgeCheckpointPreviewState.Cancelling)
                    _checkpointPreviewCancellation.Cancel();
                if (!_editorShuttingDown) Changed?.Invoke();
            };
        }

        private static void ClearCheckpointPreview()
        {
            _checkpointContext = null;
            CheckpointPreviewResult = null;
            LocalSourceChangedSinceCheckpointReview = false;
            _checkpointSourceChangeSerial += 1;
            CheckpointPreviewState = TeamForgeCheckpointPreviewState.Idle;
            _checkpointPreviewCancellation?.Cancel();
        }

        internal static void CancelCheckpointPreview()
        {
            if (CheckpointPreviewState != TeamForgeCheckpointPreviewState.Scanning) return;
            CheckpointPreviewState = TeamForgeCheckpointPreviewState.Cancelling;
            _checkpointPreviewCancellation?.Cancel();
            Changed?.Invoke();
        }

        internal static async void BeginCheckpointPreview()
        {
            if (!CanBeginCheckpointPreview) return;
            var context = _checkpointContext;
            var sourceChangeSerial = _checkpointSourceChangeSerial;
            using var cancellation = new CancellationTokenSource();
            _checkpointPreviewCancellation = cancellation;
            CheckpointPreviewResult = null;
            CheckpointPreviewState = TeamForgeCheckpointPreviewState.Scanning;
            try
            {
                Changed?.Invoke();
                var json = await Task.Run(() => RunCheckpointPreview(context, cancellation.Token));
                if (!IsCurrentCheckpoint(context, sourceChangeSerial)) return;
                cancellation.Token.ThrowIfCancellationRequested();
                if (json == null)
                {
                    CheckpointPreviewState = TeamForgeCheckpointPreviewState.Unavailable;
                    return;
                }

                CheckpointPreviewResult = DecodeCheckpointPreview(json, context.Baseline);
                CheckpointPreviewState = CheckpointPreviewResult == null
                    ? TeamForgeCheckpointPreviewState.Failed : TeamForgeCheckpointPreviewState.Ready;
                if (CheckpointPreviewResult != null) LocalSourceChangedSinceCheckpointReview = false;
            }
            catch (OperationCanceledException)
            {
                if (IsCurrentCheckpoint(context, sourceChangeSerial)) CheckpointPreviewState = cancellation.IsCancellationRequested
                    ? TeamForgeCheckpointPreviewState.Cancelled : TeamForgeCheckpointPreviewState.TimedOut;
            }
            catch (TeamForgeRuntimeException)
            {
                if (IsCurrentCheckpoint(context, sourceChangeSerial)) CheckpointPreviewState = TeamForgeCheckpointPreviewState.Unavailable;
            }
            catch (Exception)
            {
                if (IsCurrentCheckpoint(context, sourceChangeSerial)) CheckpointPreviewState = TeamForgeCheckpointPreviewState.Failed;
            }
            finally
            {
                if (ReferenceEquals(_checkpointPreviewCancellation, cancellation))
                {
                    _checkpointPreviewCancellation = null;
                    if (_checkpointSourceChangeSerial != sourceChangeSerial &&
                        CheckpointPreviewState == TeamForgeCheckpointPreviewState.Cancelling)
                        CheckpointPreviewState = TeamForgeCheckpointPreviewState.Idle;
                }
                if (!_editorShuttingDown) Changed?.Invoke();
            }
        }

        private static bool IsCurrentCheckpoint(CheckpointContext context, long sourceChangeSerial) =>
            !_editorShuttingDown && HasCheckpointPreviewContext &&
            ReferenceEquals(context, _checkpointContext) &&
            sourceChangeSerial == _checkpointSourceChangeSerial;

        private static async Task<string> RunCheckpointPreview(CheckpointContext context, CancellationToken cancellation)
        {
            using var lifetime = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
            lifetime.CancelAfter(TimeSpan.FromMinutes(2));
            var token = lifetime.Token;
            token.ThrowIfCancellationRequested();
            var cli = TeamForgeRuntimeDiscovery.ResolveHostCheckpointPreview(context.Runtime, token);
            if (cli == null) return null;
            token.ThrowIfCancellationRequested();

            // Both arguments are absolute trusted file paths, never shell text.
            // Quotes and controls are excluded before using the Host's quoting helper.
            foreach (var path in new[] { cli, context.LaunchPath })
                foreach (var character in path)
                    if (character == '"' || char.IsControl(character)) throw new InvalidDataException();
            var baseline = context.Baseline;
            var start = new ProcessStartInfo
            {
                FileName = context.Runtime.NodeExecutable,
                WorkingDirectory = context.Runtime.WorkspaceRoot,
                Arguments = Quote(cli) + " --launch-settings " + Quote(context.LaunchPath) +
                    " --project-uuid " + baseline.projectUuid +
                    " --baseline-revision " + baseline.revision.ToString(CultureInfo.InvariantCulture) +
                    " --manifest-hash " + baseline.manifestHash + " --descriptor-hash " + baseline.descriptorHash +
                    " --launch-digest " + baseline.launchSettingsDigest,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            // This separate read-only worker needs no inherited credentials or Node preloads.
            start.EnvironmentVariables.Clear();
            foreach (var name in new[] { "SystemRoot", "WINDIR", "TEMP", "TMP", "TMPDIR" })
            {
                var value = Environment.GetEnvironmentVariable(name);
                if (!string.IsNullOrEmpty(value)) start.EnvironmentVariables[name] = value;
            }

            using var worker = new Process { StartInfo = start };
            if (!worker.Start()) throw new InvalidOperationException();
            using var stop = token.Register(() => TerminateCheckpointWorker(worker));
            try
            {
                var stdout = ReadCheckpointReply(worker, token);
                var drain = worker.StandardError.BaseStream.CopyToAsync(Stream.Null, 4096, token);
                await Task.WhenAll(stdout, drain).ConfigureAwait(false);
                token.ThrowIfCancellationRequested();
                if (!worker.WaitForExit(2000) || worker.ExitCode != 0) throw new IOException();
                return await stdout.ConfigureAwait(false);
            }
            catch (Exception) when (token.IsCancellationRequested)
            {
                throw new OperationCanceledException(token);
            }
            finally
            {
                TerminateCheckpointWorker(worker);
            }
        }

        private static async Task<string> ReadCheckpointReply(Process worker, CancellationToken token)
        {
            var output = worker.StandardOutput.BaseStream;
            var frame = new byte[CheckpointReplyBytes + 1];
            var length = 0;
            while (length < frame.Length)
            {
                var read = await output.ReadAsync(frame, length, frame.Length - length, token).ConfigureAwait(false);
                if (read == 0) return new UTF8Encoding(false, true).GetString(frame, 0, length);
                length += read;
            }
            TerminateCheckpointWorker(worker);
            throw new InvalidDataException();
        }

        private static void TerminateCheckpointWorker(Process worker)
        {
            try { if (!worker.HasExited) worker.Kill(); }
            catch (InvalidOperationException) { }
            catch (System.ComponentModel.Win32Exception) { }
        }

        internal static Review DecodeCheckpointPreview(string json, BaselinePart expected)
        {
            if (expected == null || string.IsNullOrWhiteSpace(json) || Encoding.UTF8.GetByteCount(json) > CheckpointReplyBytes) return null;
            CheckpointReply result;
            try { result = JsonUtility.FromJson<CheckpointReply>(json); }
            catch (ArgumentException) { return null; }
            var baseline = result?.baseline;
            var review = result?.review;
            if (result?.state != "preview_ready" || baseline == null || review == null ||
                baseline.revision != expected.revision || baseline.projectUuid != expected.projectUuid ||
                baseline.manifestHash != expected.manifestHash || baseline.descriptorHash != expected.descriptorHash ||
                review.firstPublish || review.added < 0 || review.changed < 0 || review.deleted < 0 || review.unchanged < 0 ||
                review.totalBytes < 0 || review.totalChunks < 0 ||
                review.missingAssetMetaCount < 0 ||
                review.missingAssetMetaCount > (long)review.added + review.changed + review.deleted ||
                review.totalFiles != (long)review.added + review.changed + review.unchanged ||
                review.reuseExistingBaseline != (review.added == 0 && review.changed == 0 && review.deleted == 0) ||
                !ValidCheckpointPaths(review.missingAssetMetaPreview, review.missingAssetMetaCount,
                    review.missingAssetMetaTruncated) ||
                !ValidCheckpointPaths(review.addedPreview, review.added, review.previewTruncated) ||
                !ValidCheckpointPaths(review.changedPreview, review.changed, review.previewTruncated) ||
                !ValidCheckpointPaths(review.deletedPreview, review.deleted, review.previewTruncated)) return null;
            return review;
        }

        private static bool ValidCheckpointPaths(string[] paths, int total, bool truncated)
        {
            if (paths == null || paths.Length > Math.Min(total, CheckpointPreviewPathCount) ||
                (!truncated && paths.Length != total)) return false;
            foreach (var path in paths)
                if (!TeamForgeProjectValidation.TryValidateRelativeProjectPath(path, false, out _)) return false;
            return true;
        }
    }
}

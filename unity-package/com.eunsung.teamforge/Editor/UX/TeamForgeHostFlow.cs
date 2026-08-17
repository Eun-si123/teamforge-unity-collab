using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace EunSung.TeamForge
{
    public enum TeamForgeHostFlowState
    {
        Idle,
        Preflighting,
        AwaitingPublishConfirmation,
        Starting,
        Ready,
        Stopping,
        NeedsAction,
    }

    [InitializeOnLoad]
    public static class TeamForgeHostFlow
    {
        [Serializable]
        private sealed class Request
        {
            public string requestId;
            public string operation;
            public Arguments arguments;
        }

        [Serializable]
        private sealed class Arguments
        {
            public string launchSettingsPath;
            public bool confirmed;
            public string planId;
            public string reviewFingerprint;
            public string confirmation;
            public string realtimeJoinCode;
            public bool requireRealtimeBootstrap;
        }

        [Serializable]
        private sealed class Failure
        {
            public string kind;
            public string rawCode;
            public string message;
            public bool recoverable;
            public string action;
        }

        [Serializable]
        private sealed class Review
        {
            public bool firstPublish;
            public bool reuseExistingBaseline;
            public int added;
            public int changed;
            public int deleted;
            public int unchanged;
            public int totalFiles;
            public long totalBytes;
            public int totalChunks;
            public string[] addedPreview;
            public string[] changedPreview;
            public string[] deletedPreview;
            public bool previewTruncated;
        }

        [Serializable]
        private sealed class ReadyPart
        {
            public bool ready;
            public bool owned;
        }

        [Serializable]
        private sealed class BaselinePart
        {
            public long revision;
        }

        [Serializable]
        private sealed class Response
        {
            public string requestId;
            public string operation;
            public string state;
            public string planId;
            public string reviewFingerprint;
            public Review review;
            public Failure failure;
            public Failure[] failures;
            public ReadyPart server;
            public ReadyPart seed;
            public BaselinePart baseline;
            public string invite;
            public string invitePath;
            public string bootstrapInvite;
        }

        private static readonly ConcurrentDictionary<string, TaskCompletionSource<string>> Pending =
            new ConcurrentDictionary<string, TaskCompletionSource<string>>();
        private static readonly StringBuilder StandardError = new StringBuilder();
        private static Process _bridge;
        private static bool _workflowRunning;
        private static string _collaborationInvite = string.Empty;
        private static string _detail = "Ready to preflight.";
        private static string _errorCode = "none";
        private static string _processOwnershipState = "idle";
        private static string _healthIdentity = "not_started";
        private static long _baselineRevision;

        static TeamForgeHostFlow()
        {
            AssemblyReloadEvents.beforeAssemblyReload += StopForEditorShutdown;
            EditorApplication.quitting += StopForEditorShutdown;
        }

        public static event Action Changed;
        public static TeamForgeHostFlowState State { get; private set; } = TeamForgeHostFlowState.Idle;
        public static string Detail => _detail;
        public static string ErrorCode => _errorCode;
        public static string ProcessOwnershipState => _processOwnershipState;
        public static string HealthIdentity => _healthIdentity;
        public static long BaselineRevision => _baselineRevision;
        public static bool HasCollaborationInvite => State == TeamForgeHostFlowState.Ready &&
                                                     !string.IsNullOrWhiteSpace(_collaborationInvite);
        public static bool HasProjectInvite => HasCollaborationInvite;
        public static bool IsBusy => _workflowRunning || State == TeamForgeHostFlowState.Preflighting ||
                                     State == TeamForgeHostFlowState.AwaitingPublishConfirmation ||
                                     State == TeamForgeHostFlowState.Starting ||
                                     State == TeamForgeHostFlowState.Stopping;

        public static async void StartCollaboration()
        {
            if (_workflowRunning || State == TeamForgeHostFlowState.Ready)
            {
                return;
            }
            _workflowRunning = true;
            try
            {
                SetState(TeamForgeHostFlowState.Preflighting, "Checking Host network and access policy…");
                if (!TryPrepareHostNetworkInteractive(out var networkError))
                {
                    SetState(TeamForgeHostFlowState.NeedsAction, networkError);
                    return;
                }

                SetState(TeamForgeHostFlowState.Preflighting, "Checking runtime and locked dependencies…");
                EnsureBridge();
                var initial = await SendAsync("inspect", new Arguments());
                if (!await EnsureDependenciesAsync(initial))
                {
                    return;
                }

                if (!TeamForgeQuickStartUtility.EnsureSavedActiveSceneInteractive(out var saveError))
                {
                    SetState(TeamForgeHostFlowState.NeedsAction, saveError);
                    return;
                }
                AssetDatabase.SaveAssets();
                if (SceneManager.GetActiveScene().isDirty)
                {
                    SetState(TeamForgeHostFlowState.NeedsAction, "Save all Scene changes before Publish review.");
                    return;
                }
                if (!TeamForgeQuickStartUtility.TryEnsureProjectSetup(true, out var setupError))
                {
                    SetState(TeamForgeHostFlowState.NeedsAction, setupError);
                    return;
                }

                if (!TeamForgeProjectService.CurrentProjectSeedSourceSelected)
                {
                    var accepted = EditorUtility.DisplayDialog(
                        "Use Current Project as Host Source?",
                        "TeamForge will create a local Publish draft for this saved Project. Nothing is published " +
                        "until you review the exact change summary and choose Publish & Start.",
                        "Use Current Project",
                        "Cancel");
                    if (!accepted || !TeamForgeProjectService.TrySelectCurrentProjectAsSeedSource(out setupError))
                    {
                        SetState(TeamForgeHostFlowState.NeedsAction,
                            accepted ? setupError : "Host setup was cancelled before Publish review.");
                        return;
                    }
                }

                if (!TryWriteLaunchSettings(out var launchPath, out setupError))
                {
                    SetState(TeamForgeHostFlowState.NeedsAction, setupError);
                    return;
                }
                var inspected = await SendAsync("inspect", new Arguments { launchSettingsPath = launchPath });
                if (!IsIdle(inspected))
                {
                    FailFrom(inspected);
                    return;
                }
                var plan = await SendAsync("planHost", new Arguments { launchSettingsPath = launchPath });
                if (!string.Equals(plan.state, "awaiting_publish_confirmation", StringComparison.Ordinal) ||
                    plan.review == null)
                {
                    FailFrom(plan);
                    return;
                }

                SetState(TeamForgeHostFlowState.AwaitingPublishConfirmation,
                    plan.review.reuseExistingBaseline
                        ? "Review the existing approved Baseline before starting its verified Seed."
                        : "Review the saved source changes before publishing.");
                if (!EditorUtility.DisplayDialog(
                        plan.review.reuseExistingBaseline
                            ? "TeamForge Existing Baseline Review"
                            : "TeamForge Publish Review",
                        PublishReviewText(plan.review),
                        plan.review.reuseExistingBaseline ? "Start Existing Baseline" : "Publish & Start",
                        "Cancel"))
                {
                    SetState(TeamForgeHostFlowState.Idle, plan.review.reuseExistingBaseline
                        ? "Host start cancelled; no Coordinator registry was changed."
                        : "Publish cancelled; no Baseline was sent.");
                    return;
                }

                SetState(TeamForgeHostFlowState.Starting,
                    plan.review.reuseExistingBaseline
                        ? "Starting the verified Coordinator and re-arming it from the signed approved Baseline…"
                        : "Starting the verified Coordinator, safely re-arming if required, publishing, and starting its Seed…");
                if (!TeamForgeJoinCode.TryCreateFresh(out var realtimeJoinCode, out setupError))
                {
                    SetState(TeamForgeHostFlowState.NeedsAction,
                        "The realtime session invite could not be prepared before Host start. " + setupError);
                    return;
                }
                var ready = await SendAsync("commitHost", new Arguments
                {
                    planId = plan.planId,
                    reviewFingerprint = plan.reviewFingerprint,
                    confirmation = "PUBLISH",
                    realtimeJoinCode = realtimeJoinCode,
                    requireRealtimeBootstrap = true,
                }, 120000);
                if (!string.Equals(ready.state, "host_ready", StringComparison.Ordinal) ||
                    ready.server == null || !ready.server.ready || ready.seed == null || !ready.seed.ready ||
                    ready.baseline == null || string.IsNullOrWhiteSpace(ready.invite))
                {
                    FailFrom(ready);
                    return;
                }
                if (!LooksLikeCollaborationInvite(ready.bootstrapInvite))
                {
                    await StopAfterInvalidHostReadyAsync();
                    SetState(
                        TeamForgeHostFlowState.NeedsAction,
                        "Host start was stopped because the signed Collaboration Invite was missing. " +
                        "No transfer-only invite was exposed as Host Ready; start collaboration again.");
                    return;
                }
                _collaborationInvite = ready.bootstrapInvite;
                _baselineRevision = ready.baseline.revision;
                _processOwnershipState = ready.server.owned && ready.seed.owned
                    ? "verified_owned_coordinator_and_seed"
                    : "verified_reusable_teamforge_process";
                _healthIdentity = "protocol_v1_coordinator_and_direct_seed_ready";
                SetState(TeamForgeHostFlowState.Ready,
                    $"Host Ready · Collaboration Invite copied · Baseline revision {_baselineRevision}");
                EditorGUIUtility.systemCopyBuffer = _collaborationInvite;
                TeamForgeConnectionService.Connect();
                TeamForgeDiagnostics.Info(
                    $"Host Ready at Baseline revision {_baselineRevision}. " +
                    "The signed Collaboration Invite was copied; credentials and private keys were not included.");
            }
            catch (TeamForgeRuntimeException exception)
            {
                var message = $"{exception.Message} [{exception.Code}]";
                SetState(TeamForgeHostFlowState.NeedsAction, message);
                EditorUtility.DisplayDialog("TeamForge Host — Runtime", message, "OK");
            }
            catch (Exception exception)
            {
                SetState(TeamForgeHostFlowState.NeedsAction,
                    $"Host flow failed ({exception.GetType().Name}). {exception.Message}");
            }
            finally
            {
                _workflowRunning = false;
                Changed?.Invoke();
            }
        }

        public static async void StopCollaboration()
        {
            if (_workflowRunning || _bridge == null)
            {
                return;
            }
            _workflowRunning = true;
            SetState(TeamForgeHostFlowState.Stopping, "Stopping the owned Seed and Coordinator cooperatively…");
            try
            {
                var stopped = await SendAsync("stop", new Arguments(), 15000);
                if (!IsIdle(stopped))
                {
                    FailFrom(stopped);
                    return;
                }
                TeamForgeConnectionService.Disconnect();
                _collaborationInvite = string.Empty;
                _baselineRevision = 0;
                SetState(TeamForgeHostFlowState.Idle,
                    "Collaboration stopped. Approved metadata and Project data were preserved.");
            }
            catch (Exception exception)
            {
                SetState(TeamForgeHostFlowState.NeedsAction,
                    $"Cooperative stop needs attention ({exception.GetType().Name}).");
            }
            finally
            {
                _workflowRunning = false;
                Changed?.Invoke();
            }
        }

        public static bool CopyCollaborationInvite(out string error)
        {
            if (!HasCollaborationInvite)
            {
                error = "A signed Collaboration Invite is available only after Host Ready.";
                return false;
            }
            EditorGUIUtility.systemCopyBuffer = _collaborationInvite;
            TeamForgeDiagnostics.Info(
                "Signed Collaboration Invite copied; credentials and private keys were not included.");
            error = string.Empty;
            return true;
        }

        public static bool CopyProjectInvite(out string error)
        {
            return CopyCollaborationInvite(out error);
        }

        public static bool SaveCollaborationInvite(out string error)
        {
            if (!HasCollaborationInvite)
            {
                error = "A signed Collaboration Invite is available only after Host Ready.";
                return false;
            }
            var selected = EditorUtility.SaveFilePanel(
                "Save Signed TeamForge Collaboration Invite",
                CurrentProjectRoot(),
                "teamforge-collaboration.invite.json",
                "json");
            if (string.IsNullOrWhiteSpace(selected))
            {
                error = string.Empty;
                return false;
            }
            try
            {
                File.WriteAllText(selected, _collaborationInvite + Environment.NewLine, new UTF8Encoding(false));
                TeamForgeDiagnostics.Info(
                    "Signed Collaboration Invite saved to the explicitly selected path.");
                error = string.Empty;
                return true;
            }
            catch (Exception exception)
            {
                error = $"Invite could not be saved ({exception.GetType().Name}).";
                return false;
            }
        }

        public static bool SaveProjectInvite(out string error)
        {
            return SaveCollaborationInvite(out error);
        }

        private static bool TryPrepareHostNetworkInteractive(out string error)
        {
            var settings = TeamForgeConnectionService.Settings;
            settings.EnsureDefaults();
            if (!TeamForgeHostEndpointPolicy.TryValidateListenHost(settings.CoordinatorListenHost, out error))
            {
                return false;
            }

            var listenExposed = TeamForgeHostEndpointPolicy.IsExposedListenHost(settings.CoordinatorListenHost);
            if (listenExposed && string.IsNullOrWhiteSpace(settings.EffectiveAuthenticationToken))
            {
                error = "LAN hosting was not started without authentication. Expand Manual connection settings, " +
                        "set a unique Server access code (Bearer Token), and share it separately from the invite. " +
                        "For explicit same-PC testing, set both Guest address and Coordinator listen address to loopback.";
                return false;
            }

            if (listenExposed &&
                TeamForgeUriBuilder.TryValidateBaseAddress(settings.ServerAddress, out var current, out _) &&
                (TeamForgeHostEndpointPolicy.IsLoopbackHost(current.Host) ||
                 TeamForgeHostEndpointPolicy.IsWildcardHost(current.Host)))
            {
                if (!TeamForgeHostEndpointPolicy.TryDiscoverPreferredLanAddress(out var lanAddress, out error) ||
                    !TeamForgeHostEndpointPolicy.TryBuildAdvertisedAddress(
                        settings.ServerAddress,
                        lanAddress,
                        out var suggested,
                        out error))
                {
                    return false;
                }

                if (!EditorUtility.DisplayDialog(
                        "Use this Guest address?",
                        "The saved Guest address is local-only and cannot work from a second PC. " +
                        $"TeamForge found {suggested}. Use it in the signed Collaboration Invite?\n\n" +
                        "The Coordinator and direct Seed will listen for LAN connections, protected by the separately shared access code. " +
                        "This does not add Internet/NAT traversal.",
                        "Use LAN Address",
                        "Cancel"))
                {
                    error = "LAN Host start was cancelled before changing the advertised Guest address.";
                    return false;
                }

                settings.ServerAddress = suggested;
                settings.SaveSettings();
            }

            return TeamForgeHostEndpointPolicy.TryValidateHostingPolicy(
                settings.ServerAddress,
                settings.CoordinatorListenHost,
                settings.EffectiveAuthenticationToken,
                out error);
        }

        internal static bool LooksLikeCollaborationInvite(string source)
        {
            if (string.IsNullOrWhiteSpace(source) || source.Length > 65536)
            {
                return false;
            }

            try
            {
                var header = JsonUtility.FromJson<CollaborationInviteHeader>(source);
                return header != null &&
                       string.Equals(header.format, "teamforge-bootstrap-invite-v1", StringComparison.Ordinal) &&
                       !string.IsNullOrWhiteSpace(header.sessionJoinCode) &&
                       header.sessionJoinCode.StartsWith(TeamForgeJoinCode.Prefix, StringComparison.Ordinal);
            }
            catch
            {
                return false;
            }
        }

        [Serializable]
        private sealed class CollaborationInviteHeader
        {
            public string format;
            public string sessionJoinCode;
        }

        private static async Task StopAfterInvalidHostReadyAsync()
        {
            try
            {
                await SendAsync("stop", new Arguments(), 15000);
            }
            catch
            {
                // The missing-envelope failure remains primary; normal Editor teardown
                // will make a second bounded cooperative-stop attempt.
            }
        }

        private static async Task<bool> EnsureDependenciesAsync(Response inspection)
        {
            if (IsIdle(inspection))
            {
                return true;
            }
            var failure = FirstFailure(inspection);
            if (failure == null || !string.Equals(failure.action, "repair_dependencies", StringComparison.Ordinal))
            {
                FailFrom(inspection);
                return false;
            }
            if (!EditorUtility.DisplayDialog(
                    "TeamForge Dependencies",
                    "The locked Server/Project Peer dependencies are not ready. Repair uses the committed lockfiles " +
                    "and does not start a Server or Seed.",
                    "Repair Dependencies",
                    "Cancel"))
            {
                SetState(TeamForgeHostFlowState.NeedsAction, "Dependency repair was cancelled.");
                return false;
            }
            var repaired = await SendAsync("repairDependencies", new Arguments { confirmed = true }, 120000);
            if (!IsIdle(repaired))
            {
                FailFrom(repaired);
                return false;
            }
            return true;
        }

        private static bool TryWriteLaunchSettings(out string destination, out string error)
        {
            destination = Path.Combine(CurrentProjectRoot(), "teamforge-project-peer.launch.json");
            if (!TeamForgeProjectService.TryBuildLaunchSettingsJson(out var json, out error))
            {
                return false;
            }
            try
            {
                if (File.Exists(destination))
                {
                    var existing = File.ReadAllText(destination, Encoding.UTF8);
                    if (!string.Equals(existing.Trim(), json.Trim(), StringComparison.Ordinal) &&
                        !EditorUtility.DisplayDialog(
                            "Update TeamForge Launch Settings?",
                            "The existing secret-free launch settings differ from the current saved Project/session. " +
                            "Replace them before planning this Host Publish?",
                            "Update Settings",
                            "Cancel"))
                    {
                        error = "Launch-settings update was cancelled.";
                        return false;
                    }
                }
                File.WriteAllText(destination, json + Environment.NewLine, new UTF8Encoding(false));
                error = string.Empty;
                return true;
            }
            catch (Exception exception)
            {
                error = $"Launch settings could not be written ({exception.GetType().Name}).";
                return false;
            }
        }

        private static void EnsureBridge()
        {
            if (_bridge != null && !_bridge.HasExited)
            {
                return;
            }
            var runtime = TeamForgeRuntimeDiscovery.Resolve();
            var start = new ProcessStartInfo
            {
                FileName = runtime.NodeExecutable,
                Arguments = Quote(runtime.BridgePath) + " --workspace-root " + Quote(runtime.WorkspaceRoot),
                WorkingDirectory = runtime.WorkspaceRoot,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            var token = TeamForgeConnectionService.Settings.EffectiveAuthenticationToken;
            if (!string.IsNullOrEmpty(token)) start.EnvironmentVariables["TEAMFORGE_AUTH_TOKEN"] = token;
            start.EnvironmentVariables["TEAMFORGE_RUNTIME_KIND"] = runtime.RuntimeKind;
            _bridge = new Process { StartInfo = start, EnableRaisingEvents = true };
            _bridge.OutputDataReceived += (_, args) => CompleteResponse(args.Data);
            _bridge.ErrorDataReceived += (_, args) =>
            {
                if (!string.IsNullOrWhiteSpace(args.Data))
                {
                    lock (StandardError) StandardError.AppendLine(args.Data);
                }
            };
            _bridge.Exited += (_, __) =>
            {
                foreach (var pending in Pending)
                {
                    if (Pending.TryRemove(pending.Key, out var completion))
                    {
                        completion.TrySetException(new InvalidOperationException("Host orchestrator exited unexpectedly."));
                    }
                }
            };
            if (!_bridge.Start()) throw new InvalidOperationException("TeamForge Host orchestrator did not start.");
            _bridge.BeginOutputReadLine();
            _bridge.BeginErrorReadLine();
        }

        private static async Task<Response> SendAsync(string operation, Arguments arguments, int timeoutMilliseconds = 30000)
        {
            EnsureBridge();
            var requestId = Guid.NewGuid().ToString("N");
            var completion = new TaskCompletionSource<string>();
            if (!Pending.TryAdd(requestId, completion)) throw new InvalidOperationException("Duplicate request ID.");
            var request = new Request { requestId = requestId, operation = operation, arguments = arguments };
            _bridge.StandardInput.WriteLine(JsonUtility.ToJson(request));
            _bridge.StandardInput.Flush();
            var timeout = Task.Delay(timeoutMilliseconds);
            var completed = await Task.WhenAny(completion.Task, timeout);
            if (completed == timeout)
            {
                Pending.TryRemove(requestId, out _);
                throw new TimeoutException($"Host operation '{operation}' timed out.");
            }
            return JsonUtility.FromJson<Response>(await completion.Task);
        }

        private static void CompleteResponse(string line)
        {
            if (string.IsNullOrWhiteSpace(line)) return;
            string requestId;
            try
            {
                requestId = JsonUtility.FromJson<Response>(line)?.requestId;
            }
            catch
            {
                return;
            }
            if (!string.IsNullOrWhiteSpace(requestId) && Pending.TryRemove(requestId, out var completion))
            {
                completion.TrySetResult(line);
            }
        }

        private static string PublishReviewText(Review review)
        {
            if (review.reuseExistingBaseline)
            {
                return "Existing Approved Baseline\n\nNo saved source content changes were detected. " +
                       "TeamForge will verify the local approved metadata, start its existing Seed through the " +
                       "owned lifecycle manager, and rebuild an empty Coordinator registry only through the " +
                       "signed Project Peer announcement path. No new revision will be published.";
            }
            var mode = review.firstPublish ? "First Baseline" : "Next Baseline";
            var text = $"{mode}\n\nAdded: {review.added}\nChanged: {review.changed}\nDeleted: {review.deleted}" +
                       $"\nUnchanged: {review.unchanged}\nFiles: {review.totalFiles}\nSize: {FormatBytes(review.totalBytes)}";
            var preview = Preview("Added", review.addedPreview) + Preview("Changed", review.changedPreview) +
                          Preview("Deleted", review.deletedPreview);
            if (!string.IsNullOrEmpty(preview)) text += "\n\nAdvanced preview:" + preview;
            if (review.previewTruncated) text += "\n…preview truncated; the confirmation remains bound to the full review.";
            return text + "\n\nPublish & Start is an explicit approval of this exact saved-source fingerprint.";
        }

        private static string Preview(string label, string[] values)
        {
            if (values == null || values.Length == 0) return string.Empty;
            return "\n" + label + ":\n  " + string.Join("\n  ", values);
        }

        private static string FormatBytes(long value)
        {
            if (value < 1024) return value + " B";
            if (value < 1024 * 1024) return (value / 1024d).ToString("0.0") + " KiB";
            return (value / (1024d * 1024d)).ToString("0.0") + " MiB";
        }

        private static Failure FirstFailure(Response response)
        {
            if (response?.failure != null) return response.failure;
            return response?.failures != null && response.failures.Length > 0 ? response.failures[0] : null;
        }

        private static bool IsIdle(Response response)
        {
            return response != null && string.Equals(response.state, "idle", StringComparison.Ordinal);
        }

        private static void FailFrom(Response response)
        {
            var failure = FirstFailure(response);
            var code = string.IsNullOrWhiteSpace(failure?.rawCode)
                ? "host_operation_failed"
                : failure.rawCode;
            var recovery = TeamForgeRecoveryUx.FromStableCode(code);
            var message = failure == null
                ? recovery.Message
                : $"{recovery.Title}\n{recovery.Message}\n\nCode: {code}";
            if (failure != null && string.Equals(failure.kind, "source_changed", StringComparison.Ordinal))
            {
                message += " Start Collaboration again to create and approve a fresh review.";
            }
            if (string.Equals(code, "port_conflict", StringComparison.Ordinal) ||
                string.Equals(code, "lifecycle_identity_mismatch", StringComparison.Ordinal))
            {
                _processOwnershipState = "unknown_listener_not_terminated";
                _healthIdentity = "unverified_or_incompatible_listener";
            }
            SetState(TeamForgeHostFlowState.NeedsAction, message, code);
            EditorUtility.DisplayDialog("TeamForge Host", message, "OK");
        }

        private static void SetState(TeamForgeHostFlowState state, string detail, string code = null)
        {
            State = state;
            _detail = detail ?? string.Empty;
            _errorCode = state == TeamForgeHostFlowState.NeedsAction
                ? (string.IsNullOrWhiteSpace(code) ? "host_needs_action" : code)
                : "none";
            TeamForgeRecoveryUx.Record("host_" + state, _errorCode, _detail);
            Changed?.Invoke();
        }

        private static string CurrentProjectRoot()
        {
            return Directory.GetParent(Application.dataPath)?.FullName ?? Application.dataPath;
        }

        private static string Quote(string value)
        {
            return "\"" + (value ?? string.Empty).Replace("\"", "\\\"") + "\"";
        }

        private static void StopForEditorShutdown()
        {
            try
            {
                if (_bridge == null || _bridge.HasExited) return;
                var request = new Request
                {
                    requestId = Guid.NewGuid().ToString("N"),
                    operation = "stop",
                    arguments = new Arguments(),
                };
                _bridge.StandardInput.WriteLine(JsonUtility.ToJson(request));
                _bridge.StandardInput.Flush();
                _bridge.StandardInput.Close();
            }
            catch
            {
                // Editor teardown is bounded; closing stdin also asks the Node bridge to stop owned children.
            }
        }
    }
}

using System;
using System.IO;
using UnityEditor;
using UnityEngine;

namespace EunSung.TeamForge
{
    [Serializable]
    internal sealed class TeamForgeCloneBootstrapData
    {
        public string role = string.Empty;
        public string userName = string.Empty;
        public string serverAddress = string.Empty;
        public string realtimePath = string.Empty;
        public string projectId = string.Empty;
        public string sessionId = string.Empty;
        public TeamForgeSceneBaseline sceneBaseline;
        public bool autoConnect;
        public bool openHome;
    }

    [InitializeOnLoad]
    internal static class TeamForgeCloneBootstrap
    {
        internal const string RelativePath = "UserSettings/TeamForgeCloneBootstrap.json";
        private static bool _pendingBootstrap;
        private static bool _baselinePrepared;
        private static bool _autoConnectAfterPreparation;
        private static bool _openHomeAfterPreparation;
        private static double _bootstrapDeadline;
        private static TeamForgeSceneBaseline _expectedSceneBaseline;
        private static string _lastPreparationError = string.Empty;

        static TeamForgeCloneBootstrap()
        {
            EditorApplication.delayCall += ApplyIfPresent;
        }

        private static void ApplyIfPresent()
        {
            var path = Path.GetFullPath(Path.Combine(Directory.GetCurrentDirectory(), RelativePath));
            if (!File.Exists(path))
            {
                return;
            }

            TeamForgeCloneBootstrapData data;
            try
            {
                data = JsonUtility.FromJson<TeamForgeCloneBootstrapData>(File.ReadAllText(path));
                File.Delete(path);
            }
            catch (Exception exception)
            {
                TeamForgeDiagnostics.Warning($"Test Lab bootstrap could not be applied ({exception.GetType().Name}).");
                return;
            }

            if (data == null)
            {
                return;
            }

            var settings = TeamForgeConnectionService.Settings;
            settings.EnsureDefaults();
            if (!string.IsNullOrWhiteSpace(data.userName)) settings.UserName = data.userName.Trim();
            if (!string.IsNullOrWhiteSpace(data.serverAddress)) settings.ServerAddress = data.serverAddress.Trim();
            if (!string.IsNullOrWhiteSpace(data.realtimePath)) settings.RealtimePath = data.realtimePath.Trim();
            if (!string.IsNullOrWhiteSpace(data.projectId)) settings.ProjectId = data.projectId.Trim();
            if (!string.IsNullOrWhiteSpace(data.sessionId)) settings.SessionId = data.sessionId.Trim();
            settings.SaveSettings();

            _expectedSceneBaseline = CopyBaseline(data.sceneBaseline);
            _autoConnectAfterPreparation = data.autoConnect;
            _openHomeAfterPreparation = data.openHome;
            _baselinePrepared = _expectedSceneBaseline == null;
            _lastPreparationError = string.Empty;
            _pendingBootstrap = _expectedSceneBaseline != null || data.autoConnect || data.openHome;
            _bootstrapDeadline = EditorApplication.timeSinceStartup + 120.0;

            if (!_pendingBootstrap)
            {
                return;
            }

            EditorApplication.update -= TryPrepareCloneWhenReady;
            EditorApplication.update += TryPrepareCloneWhenReady;
        }

        private static void TryPrepareCloneWhenReady()
        {
            if (!_pendingBootstrap)
            {
                EditorApplication.update -= TryPrepareCloneWhenReady;
                return;
            }

            if (EditorApplication.timeSinceStartup >= _bootstrapDeadline)
            {
                var detail = string.IsNullOrWhiteSpace(_lastPreparationError)
                    ? "Unity did not become ready before the Test Lab timeout."
                    : _lastPreparationError;
                FailBootstrap(
                    $"Test Lab could not prepare the host Scene before timeout: {detail} " +
                    "Open the TeamForge window and retry when the Editor is ready.");
                return;
            }

            // Unity's AssetDatabase and script assemblies are not stable while these flags are true.
            if (EditorApplication.isCompiling || EditorApplication.isUpdating)
            {
                return;
            }

            if (!_baselinePrepared)
            {
                if (!TeamForgeBaselineFingerprint.TryPrepareAutomationScene(
                        _expectedSceneBaseline,
                        out var retryable,
                        out var preparationError))
                {
                    _lastPreparationError = preparationError;
                    if (retryable)
                    {
                        return;
                    }

                    FailBootstrap(
                        "Test Lab refused to auto-connect because the clone could not load the exact host baseline Scene. " +
                        preparationError);
                    return;
                }

                _baselinePrepared = true;
                _lastPreparationError = string.Empty;

                // Give sceneOpened/hierarchy callbacks one Editor update before the realtime snapshot can arrive.
                return;
            }

            if (_autoConnectAfterPreparation)
            {
                if (TeamForgeConnectionService.State != TeamForgeConnectionState.Disconnected &&
                    TeamForgeConnectionService.State != TeamForgeConnectionState.Faulted)
                {
                    FinishBootstrap();
                    return;
                }

                TeamForgeConnectionService.Connect();
            }

            FinishBootstrap();
        }

        private static void FinishBootstrap()
        {
            _pendingBootstrap = false;
            EditorApplication.update -= TryPrepareCloneWhenReady;

            if (_openHomeAfterPreparation)
            {
                EditorApplication.delayCall += TeamForgeHomeWindow.Open;
            }

            ClearPendingState();
        }

        private static void FailBootstrap(string message)
        {
            _pendingBootstrap = false;
            EditorApplication.update -= TryPrepareCloneWhenReady;
            TeamForgeDiagnostics.Warning(message);

            if (_openHomeAfterPreparation)
            {
                EditorApplication.delayCall += TeamForgeHomeWindow.Open;
            }

            ClearPendingState();
        }

        private static void ClearPendingState()
        {
            _expectedSceneBaseline = null;
            _autoConnectAfterPreparation = false;
            _openHomeAfterPreparation = false;
            _baselinePrepared = false;
            _lastPreparationError = string.Empty;
        }

        private static TeamForgeSceneBaseline CopyBaseline(TeamForgeSceneBaseline source)
        {
            if (source == null)
            {
                return null;
            }

            return new TeamForgeSceneBaseline
            {
                scenePath = source.scenePath ?? string.Empty,
                sceneGuid = source.sceneGuid ?? string.Empty,
                sha256 = source.sha256 ?? string.Empty,
            };
        }
    }
}

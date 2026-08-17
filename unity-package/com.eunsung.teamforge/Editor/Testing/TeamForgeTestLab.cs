using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace EunSung.TeamForge
{
    public static class TeamForgeTestLab
    {
        private const string LastLabRootKey = "EunSung.TeamForge.TestLab.LastRoot";

        private static readonly HashSet<string> ExcludedDirectoryNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "Library", "Temp", "Logs", "obj", "UserSettings", ".vs", ".idea", ".git",
        };

        public static bool IsExcludedDirectoryName(string name)
        {
            return !string.IsNullOrWhiteSpace(name) && ExcludedDirectoryNames.Contains(name);
        }

        public static string DefaultDestinationRoot()
        {
            try
            {
                var current = new DirectoryInfo(Directory.GetCurrentDirectory());
                var parent = current.Parent?.FullName ?? current.FullName;
                return Path.Combine(parent, current.Name + "-TeamForgeLab");
            }
            catch
            {
                return string.Empty;
            }
        }

        public static bool TryCreateStandardLab(out List<string> clonePaths, out string error)
        {
            clonePaths = new List<string>();
            string joinCode;
            if (TeamForgeConnectionService.State == TeamForgeConnectionState.Disconnected ||
                TeamForgeConnectionService.State == TeamForgeConnectionState.Faulted)
            {
                if (!TeamForgeQuickStartUtility.TryPrepareHost(out joinCode, out error))
                {
                    return false;
                }
                EditorGUIUtility.systemCopyBuffer = joinCode;
            }
            else
            {
                if (!TeamForgeJoinCode.TryCreate(out joinCode, out error))
                {
                    return false;
                }
            }
            EditorGUIUtility.systemCopyBuffer = joinCode;

            if (!TryCreateAndLaunchClones(
                    DefaultDestinationRoot(),
                    2,
                    true,
                    true,
                    true,
                    out clonePaths,
                    out error))
            {
                return false;
            }

            if (TeamForgeConnectionService.State == TeamForgeConnectionState.Disconnected ||
                TeamForgeConnectionService.State == TeamForgeConnectionState.Faulted)
            {
                TeamForgeConnectionService.Connect();
            }

            EditorPrefs.SetString(LastLabRootKey, DefaultDestinationRoot());
            error = string.Empty;
            return true;
        }

        public static bool TryRevealLastLab(out string error)
        {
            var root = EditorPrefs.GetString(LastLabRootKey, DefaultDestinationRoot());
            if (string.IsNullOrWhiteSpace(root) || !Directory.Exists(root))
            {
                error = "No previous TeamForge Test Lab folder was found.";
                return false;
            }
            EditorUtility.RevealInFinder(root);
            error = string.Empty;
            return true;
        }

        public static bool TryValidateCloneTarget(string sourceRoot, string targetRoot, out string error)
        {
            try
            {
                var source = NormalizeRoot(sourceRoot);
                var target = NormalizeRoot(targetRoot);
                if (string.Equals(source, target, PathComparison()))
                {
                    error = "Clone target cannot be the source Project.";
                    return false;
                }
                if (target.StartsWith(source + Path.DirectorySeparatorChar, PathComparison()))
                {
                    error = "Clone target cannot be inside the source Project.";
                    return false;
                }
                if (source.StartsWith(target + Path.DirectorySeparatorChar, PathComparison()))
                {
                    error = "Clone target cannot be an ancestor of the source Project.";
                    return false;
                }
                error = string.Empty;
                return true;
            }
            catch (Exception exception)
            {
                error = $"Clone paths are invalid ({exception.GetType().Name}).";
                return false;
            }
        }

        public static bool TryCreateAndLaunchClones(
            string destinationRoot,
            int cloneCount,
            bool launch,
            bool autoConnect,
            bool keepLastCloneOffline,
            out List<string> clonePaths,
            out string error)
        {
            clonePaths = new List<string>();
            if (cloneCount < 1 || cloneCount > 3)
            {
                error = "Test Lab supports 1-3 additional Editor clones.";
                return false;
            }

            if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo())
            {
                error = "Test Lab creation was cancelled.";
                return false;
            }
            if (HasDirtyLoadedScenes())
            {
                error =
                    "Test Lab needs a saved baseline so A/B/C have the same Scene identities. " +
                    "Save all open Scenes, then create the lab again.";
                return false;
            }
            AssetDatabase.SaveAssets();

            if (!TeamForgeQuickStartUtility.TryEnsureProjectSetup(false, out error))
            {
                return false;
            }
            if (!TeamForgeBaselineFingerprint.TryCaptureActiveScene(out var sceneBaseline, out error))
            {
                return false;
            }

            var sourceRoot = NormalizeRoot(Directory.GetCurrentDirectory());
            var destination = NormalizeRoot(destinationRoot);
            if (!TryValidateCloneTarget(sourceRoot, destination, out error))
            {
                return false;
            }

            var settings = TeamForgeConnectionService.Settings;
            settings.EnsureDefaults();
            Directory.CreateDirectory(destination);

            try
            {
                for (var index = 0; index < cloneCount; index += 1)
                {
                    var suffix = ((char)('B' + index)).ToString();
                    var target = Path.Combine(destination, "TF-" + suffix);
                    if (!TryValidateCloneTarget(sourceRoot, target, out error))
                    {
                        return false;
                    }

                    if (Directory.Exists(target))
                    {
                        Directory.Delete(target, true);
                    }

                    CopyProjectFastestAvailable(sourceRoot, target);
                    WriteBootstrap(
                        target,
                        settings,
                        suffix,
                        ShouldAutoConnectClone(index, cloneCount, autoConnect, keepLastCloneOffline),
                        sceneBaseline);
                    clonePaths.Add(target);
                }
            }
            catch (Exception exception)
            {
                error = $"Test Lab clone creation failed ({exception.GetType().Name}): {exception.Message}";
                return false;
            }
            finally
            {
                EditorUtility.ClearProgressBar();
            }

            if (launch)
            {
                for (var index = 0; index < clonePaths.Count; index += 1)
                {
                    var role = ((char)('B' + index)).ToString();
                    if (!TryLaunchClone(clonePaths[index], role, settings.EffectiveAuthenticationToken, out error))
                    {
                        return false;
                    }
                }
            }

            EditorPrefs.SetString(LastLabRootKey, destination);
            error = string.Empty;
            return true;
        }

        public static bool ShouldAutoConnectClone(
            int cloneIndex,
            int cloneCount,
            bool autoConnect,
            bool keepLastCloneOffline)
        {
            if (!autoConnect || cloneCount <= 0 || cloneIndex < 0 || cloneIndex >= cloneCount)
            {
                return false;
            }

            return !keepLastCloneOffline || cloneIndex != cloneCount - 1;
        }

        private static bool HasDirtyLoadedScenes()
        {
            for (var index = 0; index < SceneManager.sceneCount; index += 1)
            {
                var scene = SceneManager.GetSceneAt(index);
                if (scene.IsValid() && scene.isLoaded && scene.isDirty)
                {
                    return true;
                }
            }
            return false;
        }

        private static void CopyProjectFastestAvailable(string sourceRoot, string targetRoot)
        {
            if (Application.platform == RuntimePlatform.WindowsEditor &&
                TryRobocopyProject(sourceRoot, targetRoot, out _))
            {
                return;
            }

            CopyProjectManaged(sourceRoot, targetRoot);
        }

        private static bool TryRobocopyProject(string sourceRoot, string targetRoot, out string error)
        {
            try
            {
                var args = new StringBuilder();
                args.Append(Quote(sourceRoot)).Append(' ').Append(Quote(targetRoot));
                args.Append(" /E /COPY:DAT /DCOPY:DAT /R:1 /W:1 /NFL /NDL /NJH /NJS /NP /XJ /XD");
                foreach (var name in ExcludedDirectoryNames)
                {
                    args.Append(' ').Append(Quote(Path.Combine(sourceRoot, name)));
                }

                var startInfo = new ProcessStartInfo
                {
                    FileName = "robocopy.exe",
                    Arguments = args.ToString(),
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WorkingDirectory = sourceRoot,
                };
                using (var process = Process.Start(startInfo))
                {
                    if (process == null)
                    {
                        error = "robocopy could not be started.";
                        return false;
                    }
                    process.WaitForExit();
                    if (process.ExitCode < 8)
                    {
                        error = string.Empty;
                        return true;
                    }
                    error = $"robocopy returned exit code {process.ExitCode}.";
                    return false;
                }
            }
            catch (Exception exception)
            {
                error = $"robocopy unavailable ({exception.GetType().Name}).";
                return false;
            }
        }

        private static void CopyProjectManaged(string sourceRoot, string targetRoot)
        {
            var sourceInfo = new DirectoryInfo(sourceRoot);
            var files = new List<FileInfo>();
            CollectFiles(sourceInfo, files);
            var total = Math.Max(1, files.Count);
            for (var index = 0; index < files.Count; index += 1)
            {
                var sourceFile = files[index];
                var relative = sourceFile.FullName.Substring(sourceRoot.Length)
                    .TrimStart(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
                var destinationFile = Path.Combine(targetRoot, relative);
                var parent = Path.GetDirectoryName(destinationFile);
                if (!string.IsNullOrEmpty(parent)) Directory.CreateDirectory(parent);
                EditorUtility.DisplayProgressBar(
                    "TeamForge Test Lab",
                    $"Copying baseline · {relative}",
                    (float)index / total);
                sourceFile.CopyTo(destinationFile, true);
            }
        }

        private static void CollectFiles(DirectoryInfo directory, List<FileInfo> files)
        {
            foreach (var child in directory.EnumerateDirectories())
            {
                if (IsExcludedDirectoryName(child.Name) ||
                    (child.Attributes & FileAttributes.ReparsePoint) != 0)
                {
                    continue;
                }
                CollectFiles(child, files);
            }
            files.AddRange(directory.EnumerateFiles());
        }

        private static void WriteBootstrap(
            string targetRoot,
            TeamForgeConnectionSettings settings,
            string suffix,
            bool autoConnect,
            TeamForgeSceneBaseline sceneBaseline)
        {
            var userSettings = Path.Combine(targetRoot, "UserSettings");
            Directory.CreateDirectory(userSettings);
            var bootstrap = new TeamForgeCloneBootstrapData
            {
                role = suffix,
                userName = $"{settings.UserName} {suffix}",
                serverAddress = settings.ServerAddress,
                realtimePath = settings.RealtimePath,
                projectId = settings.ProjectId,
                sessionId = settings.SessionId,
                sceneBaseline = CopyBaseline(sceneBaseline),
                autoConnect = autoConnect,
                openHome = true,
            };
            File.WriteAllText(
                Path.Combine(targetRoot, TeamForgeCloneBootstrap.RelativePath),
                JsonUtility.ToJson(bootstrap, true));
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

        private static bool TryLaunchClone(string projectPath, string role, string authToken, out string error)
        {
            try
            {
                var safeProjectPath = projectPath.Replace("\"", string.Empty);
                var startInfo = new ProcessStartInfo
                {
                    FileName = EditorApplication.applicationPath,
                    Arguments = $"-projectPath \"{safeProjectPath}\"",
                    UseShellExecute = false,
                    CreateNoWindow = false,
                    WorkingDirectory = projectPath,
                };
                if (!string.IsNullOrWhiteSpace(authToken))
                {
                    startInfo.EnvironmentVariables["TEAMFORGE_TESTLAB_AUTH_TOKEN"] = authToken;
                }
                startInfo.EnvironmentVariables["TEAMFORGE_TESTLAB"] = "1";
                startInfo.EnvironmentVariables["TEAMFORGE_TESTLAB_ROLE"] = role ?? string.Empty;
                Process.Start(startInfo);
                error = string.Empty;
                return true;
            }
            catch (Exception exception)
            {
                error = $"Unity clone could not be launched ({exception.GetType().Name}): {exception.Message}";
                return false;
            }
        }

        private static string Quote(string value)
        {
            return "\"" + (value ?? string.Empty).Replace("\"", string.Empty) + "\"";
        }

        private static string NormalizeRoot(string path)
        {
            return Path.GetFullPath(path ?? string.Empty)
                .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        }

        private static StringComparison PathComparison()
        {
            return Application.platform == RuntimePlatform.WindowsEditor
                ? StringComparison.OrdinalIgnoreCase
                : StringComparison.Ordinal;
        }
    }
}

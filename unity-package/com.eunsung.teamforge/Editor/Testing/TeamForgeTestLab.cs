using System;
using System.Collections.Generic;
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
                if (string.IsNullOrWhiteSpace(sourceRoot) || string.IsNullOrWhiteSpace(targetRoot) ||
                    !HasAbsoluteRoot(sourceRoot) || !HasAbsoluteRoot(targetRoot))
                {
                    error = "Clone paths must be non-empty absolute paths.";
                    return false;
                }
                var source = NormalizeRoot(sourceRoot);
                var target = NormalizeRoot(targetRoot);
                if (string.Equals(source, target, PathComparison()))
                {
                    error = "Clone target cannot be the source Project.";
                    return false;
                }
                if (target.StartsWith(DirectoryPrefix(source), PathComparison()))
                {
                    error = "Clone target cannot be inside the source Project.";
                    return false;
                }
                if (source.StartsWith(DirectoryPrefix(target), PathComparison()))
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

        public static bool TryAllocateCloneDirectories(
            string sourceRoot,
            string destinationRoot,
            int cloneCount,
            out List<string> clonePaths,
            out string error)
        {
            clonePaths = new List<string>();
            if (cloneCount < 1 || cloneCount > 3)
            {
                error = "Test Lab supports 1-3 additional Editor clones.";
                return false;
            }
            if (!TryValidateCloneTarget(sourceRoot, destinationRoot, out error))
            {
                return false;
            }

            try
            {
                var source = NormalizeRoot(sourceRoot);
                var destination = NormalizeRoot(destinationRoot);
                if (!Directory.Exists(source))
                {
                    error = "The source Project directory is unavailable.";
                    return false;
                }
                if (!TryResolveSourceDirectoryForComparison(source, out var physicalSource, out error) ||
                    !TryValidateCloneTarget(physicalSource, destination, out error))
                {
                    return false;
                }
                if (!TryValidateDestinationDirectories(destination, out error))
                {
                    return false;
                }
                Directory.CreateDirectory(destination);
                if (!TryValidateDestinationDirectories(destination, out error))
                {
                    return false;
                }

                // Keep the existing depth for relative UPM paths. A fresh batch
                // suffix prevents ordinary concurrent runs from sharing clones.
                // These path checks are not protection against hostile namespace swaps.
                var batch = Guid.NewGuid().ToString("N");
                for (var index = 0; index < cloneCount; index += 1)
                {
                    var role = ((char)('B' + index)).ToString();
                    var target = Path.Combine(destination, "TF-" + role + "-" + batch);
                    if (Directory.Exists(target) || File.Exists(target))
                    {
                        error = "A new Test Lab clone path is already occupied; existing contents were kept.";
                        return false;
                    }
                    if (!TryValidateDestinationDirectories(target, out error))
                    {
                        return false;
                    }
                    Directory.CreateDirectory(target);
                    clonePaths.Add(target);
                    if (!TryValidateDestinationDirectories(target, out error))
                    {
                        return false;
                    }
                }
                error = string.Empty;
                return true;
            }
            catch (Exception exception)
            {
                error = $"Test Lab clone directories could not be prepared ({exception.GetType().Name}). " +
                        "Existing and partially created lab folders were kept.";
                return false;
            }
        }

        private static bool TryResolveSourceDirectoryForComparison(
            string sourceRoot, out string physicalRoot, out string error)
        {
            physicalRoot = sourceRoot;
            error = string.Empty;
            var redirected = false;
            for (var current = new DirectoryInfo(sourceRoot); current != null; current = current.Parent)
            {
                if ((current.Attributes & FileAttributes.ReparsePoint) != 0) redirected = true;
            }
            if (!redirected) return true;

            // Keep the original Launcher execution path for copying; only the
            // containment comparison uses its resolved physical directory.
#if UNITY_EDITOR_WIN
            return TeamForgeGuestHandoff.TryResolveFinalDirectoryPath(sourceRoot, out physicalRoot, out error);
#else
            var start = new ProcessStartInfo
            {
                FileName = "/bin/pwd",
                Arguments = "-P",
                WorkingDirectory = sourceRoot,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            using (var process = Process.Start(start))
            {
                if (process != null)
                {
                    var output = new char[32769];
                    var diagnostic = new char[1025];
                    var outputRead = ReadDirectoryPathOutput(process.StandardOutput, output);
                    var diagnosticRead = ReadDirectoryPathOutput(process.StandardError, diagnostic);
                    if (!process.WaitForExit(10000))
                    {
                        process.Kill();
                        process.WaitForExit(1000);
                    }
                    else if (Task.WaitAll(new Task[] { outputRead, diagnosticRead }, 1000) &&
                             process.ExitCode == 0 && outputRead.Result > 1 && outputRead.Result < output.Length &&
                             diagnosticRead.Result >= 0 && diagnosticRead.Result < diagnostic.Length &&
                             output[outputRead.Result - 1] == '\n')
                    {
                        // Remove exactly pwd's terminating newline, preserving any
                        // newline that is part of a valid Unix directory name.
                        physicalRoot = NormalizeRoot(new string(output, 0, outputRead.Result - 1));
                        return true;
                    }
                }
            }
            error = "The source Project's physical directory could not be resolved safely.";
            return false;
#endif
        }

        private static async Task<int> ReadDirectoryPathOutput(StreamReader reader, char[] buffer)
        {
            try
            {
                var total = 0;
                while (total < buffer.Length)
                {
                    var read = await reader.ReadAsync(buffer, total, buffer.Length - total).ConfigureAwait(false);
                    if (read == 0) break;
                    total += read;
                }
                return total;
            }
            catch (IOException)
            {
                return -1;
            }
            catch (ObjectDisposedException)
            {
                return -1;
            }
        }

        private static bool TryValidateDestinationDirectories(string targetRoot, out string error)
        {
            var current = new DirectoryInfo(targetRoot);
            while (current != null)
            {
                FileAttributes attributes;
                try
                {
                    attributes = File.GetAttributes(current.FullName);
                }
                catch (FileNotFoundException)
                {
                    current = current.Parent;
                    continue;
                }
                catch (DirectoryNotFoundException)
                {
                    current = current.Parent;
                    continue;
                }

                if ((attributes & FileAttributes.ReparsePoint) != 0)
                {
                    error = "The clone destination cannot contain a symbolic link or reparse point. Choose a direct folder path.";
                    return false;
                }
                if ((attributes & FileAttributes.Directory) == 0)
                {
                    error = "The clone destination contains a file where a directory is required.";
                    return false;
                }
                current = current.Parent;
            }
            error = string.Empty;
            return true;
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
            var sourceRoot = Directory.GetCurrentDirectory();
            if (!TryValidateCloneTarget(sourceRoot, destinationRoot, out error))
            {
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

            var package = UnityEditor.PackageManager.PackageInfo.FindForAssembly(typeof(TeamForgeTestLab).Assembly);
            if (!TeamForgeTestLabPackageSnapshot.TryPrepare(
                    sourceRoot, package?.resolvedPath, package?.version, out var packageSnapshot, out error) ||
                (packageSnapshot != null && !packageSnapshot.TryValidateDestination(destinationRoot, out error)))
            {
                return false;
            }

            var allocated = TryAllocateCloneDirectories(sourceRoot, destinationRoot, cloneCount, out clonePaths, out error);
            if (clonePaths.Count > 0)
            {
                // Keep partially created labs reachable through Show Last Lab Folder.
                EditorPrefs.SetString(LastLabRootKey, Path.GetDirectoryName(clonePaths[0]));
            }
            if (!allocated)
            {
                return false;
            }
            var destination = NormalizeRoot(destinationRoot);

            var settings = TeamForgeConnectionService.Settings;
            settings.EnsureDefaults();
            try
            {
                for (var index = 0; index < cloneCount; index += 1)
                {
                    var suffix = ((char)('B' + index)).ToString();
                    var target = clonePaths[index];
                    if (!TryValidateDestinationDirectories(target, out error))
                    {
                        return false;
                    }

                    CopyProjectFastestAvailable(sourceRoot, target);
                    if (packageSnapshot != null && !packageSnapshot.TryApply(target, out error))
                    {
                        return false;
                    }
                    WriteBootstrap(
                        target,
                        settings,
                        suffix,
                        ShouldAutoConnectClone(index, cloneCount, autoConnect, keepLastCloneOffline),
                        sceneBaseline);
                }
            }
            catch (Exception exception)
            {
                error = $"Test Lab clone creation failed ({exception.GetType().Name}). " +
                        "Existing and partially created lab folders were kept; no clone Editors were launched.";
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
                args.Append(" /E /COPY:DAT /DCOPY:DAT /R:1 /W:1 /NFL /NDL /NJH /NJS /NP /XJ /XF .git /XD .git");
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
            foreach (var file in directory.EnumerateFiles())
            {
                if (!string.Equals(file.Name, ".git", StringComparison.OrdinalIgnoreCase)) files.Add(file);
            }
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
            var fullPath = Path.GetFullPath(path);
            var root = Path.GetPathRoot(fullPath);
            return fullPath.Length == root.Length
                ? fullPath
                : fullPath.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        }

        private static string DirectoryPrefix(string path)
        {
            return path.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) +
                   Path.DirectorySeparatorChar;
        }

        private static bool HasAbsoluteRoot(string path)
        {
            if (!Path.IsPathRooted(path)) return false;
            if (Path.DirectorySeparatorChar != '\\') return true;

            // IsPathRooted also accepts C:relative and \drive-relative on Windows.
            var root = Path.GetPathRoot(path);
            return (root.Length == 3 && root[1] == ':' &&
                    (root[2] == '\\' || root[2] == '/')) ||
                   root.StartsWith("\\\\", StringComparison.Ordinal) ||
                   root.StartsWith("//", StringComparison.Ordinal);
        }

        private static StringComparison PathComparison()
        {
            return Path.DirectorySeparatorChar == '\\'
                ? StringComparison.OrdinalIgnoreCase
                : StringComparison.Ordinal;
        }
    }
}

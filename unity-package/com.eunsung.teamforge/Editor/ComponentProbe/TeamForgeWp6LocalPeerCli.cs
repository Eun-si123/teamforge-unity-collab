using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading.Tasks;

namespace EunSung.TeamForge
{
    // A local-only Test Lab diagnostic. Process launch via verified TeamForge
    // runtime is stronger than untrusted pasted JSON, but is NOT an
    // authenticated, nonce-bound Server/Publisher source attestation.
    internal static class TeamForgeWp6LocalPeerCli
    {
        private const int MaxOutputChars = 8192;
        private const int MaxErrorChars = 4096;
        private const int TimeoutMilliseconds = 15000;

        internal sealed class Invocation
        {
            internal string NodeExecutable { get; set; }
            internal string CliPath { get; set; }
            internal string WorkspaceRoot { get; set; }
            internal string ManagedRoot { get; set; }
            internal string ProjectUuid { get; set; }
            internal string ScenePath { get; set; }
            internal string SceneGuid { get; set; }
        }

        internal sealed class Result
        {
            internal bool Success { get; set; }
            internal string Json { get; set; }
            internal string Status { get; set; }
        }

        private static bool SafeAbsolute(string path)
        {
            return !string.IsNullOrWhiteSpace(path) &&
                Path.IsPathRooted(path) &&
                path.IndexOfAny(new[] { '"', '\r', '\n', '\0' }) < 0;
        }

        private static bool SafeScenePath(string path)
        {
            if (string.IsNullOrEmpty(path) || path.Length > 1024 ||
                !path.StartsWith("Assets/", StringComparison.Ordinal) ||
                !path.EndsWith(".unity", StringComparison.Ordinal) ||
                path.IndexOfAny(new[] { '\\', ':', '"', '\r', '\n', '\0' }) >= 0)
                return false;
            foreach (var component in path.Split('/'))
                if (component.Length == 0 || component == "." || component == "..")
                    return false;
            return true;
        }

        internal static bool TryBuildInvocation(
            string nodeExecutable, string workspaceRoot,
            string managedRoot, string projectUuid, string scenePath,
            string sceneGuid, out Invocation invocation, out string error)
        {
            invocation = null;
            error = "WP6 local sidecar requires a valid installed runtime, Active Project and Scene.";
            if (!SafeAbsolute(nodeExecutable) || !SafeAbsolute(workspaceRoot) ||
                !SafeAbsolute(managedRoot) || !SafeScenePath(scenePath) ||
                !Guid.TryParseExact(projectUuid, "D", out var parsedUuid) ||
                !string.Equals(parsedUuid.ToString("D"), projectUuid, StringComparison.Ordinal) ||
                sceneGuid == null || sceneGuid.Length != 32 ||
                sceneGuid == "00000000000000000000000000000000")
                return false;
            foreach (var value in sceneGuid)
                if (!((value >= '0' && value <= '9') ||
                      (value >= 'a' && value <= 'f')))
                    return false;

            var node = Path.GetFullPath(nodeExecutable);
            var workspace = Path.GetFullPath(workspaceRoot);
            var managed = Path.GetFullPath(managedRoot);
            var cli = Path.GetFullPath(Path.Combine(
                workspace, "project-peer", "src", "cli.mjs"));
            if (!File.Exists(node) || !File.Exists(cli) ||
                !Directory.Exists(workspace) || !Directory.Exists(managed) ||
                (new FileInfo(node).Attributes & FileAttributes.ReparsePoint) != 0 ||
                (new FileInfo(cli).Attributes & FileAttributes.ReparsePoint) != 0 ||
                (new DirectoryInfo(managed).Attributes & FileAttributes.ReparsePoint) != 0)
                return false;

            invocation = new Invocation
            {
                NodeExecutable = node,
                CliPath = cli,
                WorkspaceRoot = workspace,
                ManagedRoot = managed,
                ProjectUuid = projectUuid,
                ScenePath = scenePath,
                SceneGuid = sceneGuid,
            };
            error = string.Empty;
            return true;
        }

        // All caller-controlled values are passed as *quoted arguments* to
        // a fixed executable with UseShellExecute=false. Reject quotes and
        // controls up front so there is no shell metacharacter ambiguity.
        private static string Quote(string value) => "\"" + value + "\"";

        // Keep child-process output bounded even when a broken or replaced
        // executable prints continuously. Continue draining excess output
        // to avoid a blocked pipe, but never allocate a huge JSON string.
        internal static async Task<string> ReadBoundedAsync(TextReader reader, int maxCharacters)
        {
            if (reader == null || maxCharacters < 1) return null;
            var text = new StringBuilder(Math.Min(maxCharacters, 1024));
            var buffer = new char[1024];
            var exceeded = false;
            int count;
            while ((count = await reader.ReadAsync(buffer, 0, buffer.Length)) > 0)
            {
                if (exceeded || text.Length > maxCharacters - count)
                {
                    exceeded = true;
                    continue;
                }
                text.Append(buffer, 0, count);
            }
            return exceeded ? null : text.ToString();
        }

        internal static Task<Result> RunAsync(Invocation invocation)
        {
            return Task.Run(() => Run(invocation));
        }

        private static Result Run(Invocation input)
        {
            if (input == null)
                return new Result { Status = "No WP6 Project Peer invocation was prepared." };
            try
            {
                var start = new ProcessStartInfo
                {
                    FileName = input.NodeExecutable,
                    Arguments = Quote(input.CliPath) +
                        " wp6-scene-source --managed-root " + Quote(input.ManagedRoot) +
                        " --project-uuid " + Quote(input.ProjectUuid) +
                        " --scene-path " + Quote(input.ScenePath) +
                        " --scene-guid " + Quote(input.SceneGuid),
                    WorkingDirectory = input.WorkspaceRoot,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    StandardOutputEncoding = new UTF8Encoding(false, true),
                    StandardErrorEncoding = new UTF8Encoding(false, true),
                };
                // The source CLI is read-only and does not need tokens or
                // Publisher private material. Do not pass them to a child.
                foreach (var key in new[] {
                    "TEAMFORGE_AUTH_TOKEN", "TEAMFORGE_OWNER_PRIVATE_KEY",
                    "NODE_OPTIONS", "NODE_PATH" })
                    start.EnvironmentVariables.Remove(key);

                using (var process = new Process { StartInfo = start })
                {
                    if (!process.Start())
                        return new Result { Status = "Project Peer CLI could not start." };
                    var stdout = ReadBoundedAsync(process.StandardOutput, MaxOutputChars);
                    var stderr = ReadBoundedAsync(process.StandardError, MaxErrorChars);
                    if (!process.WaitForExit(TimeoutMilliseconds))
                    {
                        try { process.Kill(); process.WaitForExit(2000); } catch { }
                        return new Result { Status = "Project Peer source verification timed out." };
                    }
                    // The CLI emits a small single JSON summary. Never return
                    // or display stderr: it can contain local filesystem paths.
                    if (!stdout.Wait(2000) || !stderr.Wait(2000) ||
                        process.ExitCode != 0 || stdout.Result == null ||
                        stdout.Result.Length < 2 ||
                        stdout.Result.Length > MaxOutputChars ||
                        stderr.Result == null)
                        return new Result { Status =
                            "Project Peer source verification refused, exceeded its output limit, or failed." };

                    return new Result {
                        Success = true, Json = stdout.Result, Status = string.Empty,
                    };
                }
            }
            catch (Exception)
            {
                return new Result { Status =
                    "Unable to execute the installed Project Peer source verifier safely." };
            }
        }
    }
}

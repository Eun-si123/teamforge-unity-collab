using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using UnityEngine;

namespace EunSung.TeamForge
{
    internal sealed class TeamForgeRuntimeException : Exception
    {
        internal string Code { get; }

        internal TeamForgeRuntimeException(string code, string message, Exception inner = null)
            : base(message, inner)
        {
            Code = code;
        }
    }

    internal sealed class TeamForgeRuntimeResolution
    {
        internal string NodeExecutable { get; set; }
        internal string WorkspaceRoot { get; set; }
        internal string BridgePath { get; set; }
        internal string RuntimeKind { get; set; }
        internal string NodeVersion { get; set; }
    }

    internal static class TeamForgeRuntimeDiscovery
    {
        [Serializable] private sealed class FileRecord { public string path; public long size; public string sha256; }
        [Serializable] private sealed class PlatformRecord
        {
            public string id;
            public string os;
            public string architecture;
            public string executable;
            public string sha256;
        }
        [Serializable] private sealed class Manifest
        {
            public int schemaVersion;
            public string productVersion;
            public int backendContractVersion;
            public string backendRelativePath;
            public string bridgeRelativePath;
            public string nodeVersion;
            public int[] supportedNodeMajors;
            public PlatformRecord[] platforms;
            public FileRecord[] files;
        }

        internal static TeamForgeRuntimeResolution Resolve()
        {
            var package = UnityEditor.PackageManager.PackageInfo.FindForAssembly(typeof(TeamForgeRuntimeDiscovery).Assembly);
            var packageRoot = package == null ? string.Empty : Path.GetFullPath(package.resolvedPath);
            var runtimeRoot = string.IsNullOrWhiteSpace(packageRoot)
                ? string.Empty
                : Path.Combine(packageRoot, "Runtime~");
            if (!string.IsNullOrWhiteSpace(runtimeRoot) && Directory.Exists(runtimeRoot))
            {
                return ResolvePackageRuntime(runtimeRoot);
            }

            // Developer compatibility fallback only. End-user packages are expected to contain Runtime~.
            var workspace = Environment.GetEnvironmentVariable("TEAMFORGE_WORKSPACE_ROOT");
            if (!string.IsNullOrWhiteSpace(workspace))
            {
                workspace = Path.GetFullPath(workspace);
                var bridge = Path.Combine(workspace, "project-peer", "src", "host-orchestrator-cli.mjs");
                if (Directory.Exists(workspace) && File.Exists(bridge))
                {
                    var node = ResolveInstalledNode(new[] { 22, 24 }, true, out var version);
                    return new TeamForgeRuntimeResolution
                    {
                        NodeExecutable = node,
                        WorkspaceRoot = workspace,
                        BridgePath = bridge,
                        RuntimeKind = "external_development",
                        NodeVersion = version,
                    };
                }
            }
            throw Failure("runtime_bundle_missing",
                "TeamForge internal runtime is missing. Reinstall the TeamForge package. Developer workspaces may use TEAMFORGE_WORKSPACE_ROOT as a fallback.");
        }

        private static TeamForgeRuntimeResolution ResolvePackageRuntime(string runtimeRoot)
        {
            try
            {
                var manifestPath = Path.Combine(runtimeRoot, "runtime-manifest.json");
                if (!File.Exists(manifestPath) || !FixedEquals(Sha256(manifestPath), TeamForgeRuntimeManifest.ExpectedSha256))
                    throw Failure("runtime_bundle_corrupt", "TeamForge internal runtime manifest is missing or does not match this package.");
                var manifest = JsonUtility.FromJson<Manifest>(File.ReadAllText(manifestPath));
                if (manifest == null || manifest.schemaVersion != 1 || manifest.backendContractVersion != 1 ||
                    !string.Equals(manifest.productVersion, TeamForgeRuntimeManifest.ProductVersion, StringComparison.Ordinal) ||
                    manifest.files == null || manifest.platforms == null || manifest.supportedNodeMajors == null)
                    throw Failure("runtime_bundle_corrupt", "TeamForge internal runtime manifest is incompatible.");
                foreach (var record in manifest.files)
                {
                    var file = SafeChild(runtimeRoot, record.path);
                    var details = new FileInfo(file);
                    if (!details.Exists || details.Length != record.size || IsReparse(details) ||
                        !FixedEquals(Sha256(file), record.sha256))
                        throw Failure("runtime_bundle_corrupt", $"TeamForge internal runtime file failed verification: {record.path}");
                }
                var workspace = SafeChild(runtimeRoot, manifest.backendRelativePath);
                var bridge = SafeChild(runtimeRoot, manifest.bridgeRelativePath);
                if (!Directory.Exists(workspace) || !File.Exists(bridge))
                    throw Failure("runtime_bundle_corrupt", "TeamForge internal backend entrypoint is missing.");

                var os = Application.platform == RuntimePlatform.WindowsEditor ? "win32" :
                    Application.platform == RuntimePlatform.OSXEditor ? "darwin" : "linux";
                var architecture = RuntimeInformation.ProcessArchitecture == Architecture.X64 ? "x64" :
                    RuntimeInformation.ProcessArchitecture == Architecture.Arm64 ? "arm64" : "unsupported";
                var platform = manifest.platforms.FirstOrDefault(item => item.os == os && item.architecture == architecture);
                string node;
                string version;
                var kind = "installed_package_runtime";
                if (platform != null)
                {
                    node = SafeChild(runtimeRoot, platform.executable);
                    if (!File.Exists(node) || !FixedEquals(Sha256(node), platform.sha256))
                        throw Failure("runtime_bundle_corrupt", "TeamForge platform runtime failed verification.");
                    version = ProbeNode(node, manifest.supportedNodeMajors);
                    if (!string.Equals(version, manifest.nodeVersion, StringComparison.Ordinal))
                        throw Failure("runtime_bundle_corrupt", "TeamForge platform runtime version differs from its signed package manifest.");
                    kind = "bundled_package";
                }
                else
                {
                    node = ResolveInstalledNode(manifest.supportedNodeMajors, false, out version);
                }
                return new TeamForgeRuntimeResolution
                {
                    NodeExecutable = node,
                    WorkspaceRoot = workspace,
                    BridgePath = bridge,
                    RuntimeKind = kind,
                    NodeVersion = version,
                };
            }
            catch (TeamForgeRuntimeException) { throw; }
            catch (Exception exception)
            {
                throw Failure("runtime_bundle_corrupt", "TeamForge internal runtime could not be verified.", exception);
            }
        }

        private static string ResolveInstalledNode(int[] supportedMajors, bool allowDeveloperOverride, out string version)
        {
            var candidates = new List<string>();
            if (allowDeveloperOverride)
            {
                var configured = Environment.GetEnvironmentVariable("TEAMFORGE_NODE_PATH");
                if (!string.IsNullOrWhiteSpace(configured)) candidates.Add(configured);
            }
            if (Application.platform == RuntimePlatform.WindowsEditor)
            {
                var programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
                if (!string.IsNullOrWhiteSpace(programFiles)) candidates.Add(Path.Combine(programFiles, "nodejs", "node.exe"));
            }
            else
            {
                candidates.Add("/usr/local/bin/node");
                candidates.Add("/opt/homebrew/bin/node");
                candidates.Add("/usr/bin/node");
            }
            foreach (var directory in (Environment.GetEnvironmentVariable("PATH") ?? string.Empty).Split(Path.PathSeparator))
                if (!string.IsNullOrWhiteSpace(directory)) candidates.Add(Path.Combine(directory, Application.platform == RuntimePlatform.WindowsEditor ? "node.exe" : "node"));
            foreach (var candidate in candidates)
            {
                try
                {
                    if (!Path.IsPathRooted(candidate)) continue;
                    var absolute = Path.GetFullPath(candidate);
                    if (!File.Exists(absolute) || IsReparse(new FileInfo(absolute))) continue;
                    version = ProbeNode(absolute, supportedMajors);
                    return absolute;
                }
                catch (TeamForgeRuntimeException) { }
                catch { }
            }
            version = string.Empty;
            throw Failure("runtime_version_unsupported", "A compatible TeamForge internal runtime is unavailable for this platform. Reinstall a complete TeamForge package.");
        }

        private static string ProbeNode(string executable, int[] supportedMajors)
        {
            var start = new ProcessStartInfo
            {
                FileName = Path.GetFullPath(executable), Arguments = "--version", UseShellExecute = false,
                CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true,
            };
            using (var process = Process.Start(start))
            {
                if (process == null || !process.WaitForExit(5000))
                {
                    try { process?.Kill(); } catch { }
                    throw Failure("runtime_probe_failed", "TeamForge internal runtime version check timed out.");
                }
                var output = process.StandardOutput.ReadToEnd().Trim();
                if (process.ExitCode != 0 || !output.StartsWith("v", StringComparison.Ordinal))
                    throw Failure("runtime_probe_failed", "TeamForge internal runtime version check failed.");
                var version = output.Substring(1);
                int major;
                if (!int.TryParse(version.Split('.')[0], out major) || !supportedMajors.Contains(major))
                    throw Failure("runtime_version_unsupported", $"TeamForge internal runtime {version} is not in the supported LTS set.");
                return version;
            }
        }

        private static string SafeChild(string root, string relative)
        {
            if (string.IsNullOrWhiteSpace(relative) || Path.IsPathRooted(relative)) throw Failure("runtime_bundle_corrupt", "Runtime manifest contains an unsafe path.");
            var absoluteRoot = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            var target = Path.GetFullPath(Path.Combine(root, relative.Replace('/', Path.DirectorySeparatorChar)));
            if (!target.StartsWith(absoluteRoot, StringComparison.OrdinalIgnoreCase)) throw Failure("runtime_bundle_corrupt", "Runtime manifest path escaped the package.");
            return target;
        }

        private static bool IsReparse(FileSystemInfo item) => (item.Attributes & FileAttributes.ReparsePoint) != 0;
        private static string Sha256(string file)
        {
            using (var stream = File.OpenRead(file))
            using (var algorithm = SHA256.Create())
                return BitConverter.ToString(algorithm.ComputeHash(stream)).Replace("-", string.Empty).ToLowerInvariant();
        }
        private static bool FixedEquals(string left, string right)
        {
            if (left == null || right == null || left.Length != right.Length) return false;
            var difference = 0;
            for (var index = 0; index < left.Length; index++) difference |= left[index] ^ right[index];
            return difference == 0;
        }
        private static TeamForgeRuntimeException Failure(string code, string message, Exception inner = null) =>
            new TeamForgeRuntimeException(code, message, inner);
    }
}

using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using UnityEditor;
using UnityEngine;

namespace EunSung.TeamForge
{
    [Serializable]
    internal sealed class TeamForgeGuestHandoffData
    {
        public int schemaVersion;
        public string projectUuid = string.Empty;
        public long baselineRevision;
        public string manifestHash = string.Empty;
        public string descriptorHash = string.Empty;
        public string ownerKeyId = string.Empty;
        public string publisherKeyId = string.Empty;
        public string activeProjectPath = string.Empty;
        public string sessionJoinCode = string.Empty;
        public long createdAtUnixMs;
    }

    // This is the production launcher handoff. Test Lab uses a separate bootstrap
    // contract and cannot reach this path without both launcher-only environment
    // values and the exact post-transfer Active project identity.
    [InitializeOnLoad]
    internal static class TeamForgeGuestHandoff
    {
        internal const string PathEnvironmentVariable = "TEAMFORGE_GUEST_HANDOFF_PATH";
        internal const string HashEnvironmentVariable = "TEAMFORGE_GUEST_HANDOFF_SHA256";
        internal const string AuthenticationEnvironmentVariable = "TEAMFORGE_GUEST_AUTHENTICATION_TOKEN";
        private const int SchemaVersion = 1;
        private const long MaximumHandoffBytes = 65536;
        private const long MaximumAgeMilliseconds = 15 * 60 * 1000;
        private const long MaximumFutureSkewMilliseconds = 5 * 60 * 1000;
        private static readonly string[] HandoffFields =
        {
            "schemaVersion", "projectUuid", "baselineRevision", "manifestHash", "descriptorHash",
            "ownerKeyId", "publisherKeyId", "activeProjectPath", "sessionJoinCode", "createdAtUnixMs",
        };

#if UNITY_EDITOR_WIN
        private const uint FileShareRead = 0x00000001;
        private const uint FileShareWrite = 0x00000002;
        private const uint FileShareDelete = 0x00000004;
        private const uint OpenExisting = 3;
        private const uint FileFlagBackupSemantics = 0x02000000;
        private static readonly IntPtr InvalidHandleValue = new IntPtr(-1);
#endif

        private static TeamForgeGuestHandoffData _pending;
        private static string _pendingAuthenticationToken = string.Empty;
        private static double _deadline;

        static TeamForgeGuestHandoff()
        {
            EditorApplication.delayCall += ReadLauncherHandoff;
            EditorApplication.quitting += ClearSensitiveState;
            AssemblyReloadEvents.beforeAssemblyReload += ClearSensitiveState;
            TeamForgeConnectionService.Changed += ClearCredentialWhenConnectionStops;
        }

        private static void ReadLauncherHandoff()
        {
            var handoffPath = Environment.GetEnvironmentVariable(PathEnvironmentVariable) ?? string.Empty;
            var expectedHash = Environment.GetEnvironmentVariable(HashEnvironmentVariable) ?? string.Empty;
            var authenticationToken = Environment.GetEnvironmentVariable(AuthenticationEnvironmentVariable) ?? string.Empty;

            // Clear every launcher control value before validation, parsing, diagnostics,
            // or any later child process can observe it. The access code remains only in
            // this class' private memory until the exact Active identity is verified.
            Environment.SetEnvironmentVariable(PathEnvironmentVariable, null);
            Environment.SetEnvironmentVariable(HashEnvironmentVariable, null);
            Environment.SetEnvironmentVariable(AuthenticationEnvironmentVariable, null);

            if (string.IsNullOrWhiteSpace(handoffPath) && string.IsNullOrWhiteSpace(expectedHash))
            {
                if (!string.IsNullOrEmpty(authenticationToken))
                {
                    TeamForgeDiagnostics.Warning(
                        "Guest bootstrap was rejected [guest_handoff_invalid]. Launcher authentication arrived without a verified handoff.");
                }
                return;
            }

            if (!TryValidateAuthenticationToken(authenticationToken, out var authenticationError))
            {
                ClearSensitiveState();
                TeamForgeDiagnostics.Warning("Guest bootstrap was rejected [guest_handoff_invalid]. " + authenticationError);
                return;
            }

            if (!TryReadAndConsume(handoffPath, expectedHash, out var data, out var error))
            {
                ClearSensitiveState();
                TeamForgeDiagnostics.Warning("Guest bootstrap was rejected [guest_handoff_invalid]. " + error);
                return;
            }

            _pending = data;
            _pendingAuthenticationToken = authenticationToken;
            _deadline = EditorApplication.timeSinceStartup + 120.0;
            EditorApplication.update -= ApplyWhenEditorReady;
            EditorApplication.update += ApplyWhenEditorReady;
        }

        private static void ApplyWhenEditorReady()
        {
            if (_pending == null)
            {
                EditorApplication.update -= ApplyWhenEditorReady;
                return;
            }
            if (EditorApplication.timeSinceStartup >= _deadline)
            {
                Fail("Unity did not become ready before the verified handoff expired.");
                return;
            }
            if (EditorApplication.isCompiling || EditorApplication.isUpdating)
            {
                return;
            }

            var handoff = _pending;
            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            if (handoff.createdAtUnixMs < now - MaximumAgeMilliseconds ||
                handoff.createdAtUnixMs > now + MaximumFutureSkewMilliseconds)
            {
                Fail("The verified handoff is stale or has an invalid timestamp.");
                return;
            }

            if (!TryValidateActiveProject(handoff, out var validationError))
            {
                Fail(validationError);
                return;
            }

            // Reload only after the launcher Active identity has been checked directly.
            TeamForgeProjectService.ReloadDescriptor();
            // Join application must persist only a cleared credential field. The
            // Launcher credential is installed into a separate nonserialized seam
            // only after TF1 and Active identity validation have both succeeded.
            var settings = TeamForgeConnectionService.Settings;
            var previousPersistentAuthenticationToken = settings.AuthenticationToken;
            settings.AuthenticationToken = string.Empty;
            TeamForgeConnectionSettings.ClearGuestTransientAuthenticationToken();

            var verifiedReconnect = TeamForgeVerifiedGuestReconnect.Matches(handoff);
            string applyError;
            var applied = verifiedReconnect
                ? TeamForgeVerifiedGuestReconnect.TryApplyJoinCode(handoff.sessionJoinCode, true, out applyError)
                : TeamForgeJoinCode.TryApply(handoff.sessionJoinCode, true, out applyError);
            if (!applied)
            {
                settings.AuthenticationToken = previousPersistentAuthenticationToken;
                previousPersistentAuthenticationToken = string.Empty;
                Fail(applyError);
                return;
            }
            previousPersistentAuthenticationToken = string.Empty;
            if (!TeamForgeConnectionSettings.TrySetGuestTransientAuthenticationToken(
                    _pendingAuthenticationToken,
                    out var authenticationError))
            {
                Fail(authenticationError);
                return;
            }

            // Store only after the exact Launcher handoff, Project identity, TF1 session,
            // Scene policy, and transient authentication seam have all been accepted.
            // This marker lets a later reopen of the same verified Active/session keep a
            // legitimately saved collaborative Scene without weakening first-join checks.
            TeamForgeVerifiedGuestReconnect.Store(handoff);

            _pending = null;
            _pendingAuthenticationToken = string.Empty;
            EditorApplication.update -= ApplyWhenEditorReady;
            TeamForgeConnectionService.Connect();
            TeamForgeDiagnostics.Info(
                verifiedReconnect
                    ? $"Guest reconnect accepted for verified Baseline revision {handoff.baselineRevision}; connecting to the existing signed invitation session."
                    : $"Guest Ready at verified Baseline revision {handoff.baselineRevision}; connecting to the signed invitation session.");
        }

        private static bool TryReadAndConsume(
            string handoffPath,
            string expectedHash,
            out TeamForgeGuestHandoffData data,
            out string error)
        {
            data = null;
            error = string.Empty;
            byte[] bytes;
            string fullPath;
            try
            {
                if (string.IsNullOrWhiteSpace(handoffPath) || !Path.IsPathRooted(handoffPath) ||
                    !IsLowerHex(expectedHash, 64))
                {
                    error = "Launcher handoff controls are incomplete.";
                    return false;
                }
                fullPath = Path.GetFullPath(handoffPath);
                var localState = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                if (string.IsNullOrWhiteSpace(localState))
                {
                    error = "Windows did not provide a safe Launcher state folder.";
                    return false;
                }
                var expectedRoot = Path.GetFullPath(Path.Combine(
                    localState,
                    "TeamForge",
                    "Launcher",
                    "guest-core",
                    "handoff"));
                var expectedPrefix = expectedRoot.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) +
                                     Path.DirectorySeparatorChar;
                if (!string.Equals(fullPath, handoffPath, PathComparison()) ||
                    !fullPath.StartsWith(expectedPrefix, PathComparison()) ||
                    !TryEnsureNoReparseSegments(fullPath, false, out error))
                {
                    if (string.IsNullOrWhiteSpace(error))
                    {
                        error = "Launcher handoff is outside the private TeamForge state folder.";
                    }
                    return false;
                }

                var info = new FileInfo(fullPath);
                if (!info.Exists || (info.Attributes & (FileAttributes.Directory | FileAttributes.ReparsePoint)) != 0 ||
                    info.Length <= 0 || info.Length > MaximumHandoffBytes)
                {
                    error = "Launcher handoff file is missing or unsafe.";
                    return false;
                }

                using (var stream = new FileStream(fullPath, FileMode.Open, FileAccess.Read, FileShare.Read))
                {
                    if (stream.Length <= 0 || stream.Length > MaximumHandoffBytes)
                    {
                        error = "Launcher handoff size is invalid.";
                        return false;
                    }
                    bytes = new byte[checked((int)stream.Length)];
                    var offset = 0;
                    while (offset < bytes.Length)
                    {
                        var read = stream.Read(bytes, offset, bytes.Length - offset);
                        if (read <= 0)
                        {
                            error = "Launcher handoff could not be read completely.";
                            return false;
                        }
                        offset += read;
                    }
                }

                if (!string.Equals(TeamForgeBaselineFingerprint.HashBytes(bytes), expectedHash, StringComparison.Ordinal))
                {
                    error = "Launcher handoff integrity verification failed.";
                    return false;
                }

                // Consume before JSON interpretation or any connection-state mutation.
                File.Delete(fullPath);
                if (File.Exists(fullPath))
                {
                    error = "Launcher handoff could not be consumed safely.";
                    return false;
                }
            }
            catch (Exception exception)
            {
                error = $"Launcher handoff could not be consumed ({exception.GetType().Name}).";
                return false;
            }

            string json;
            try
            {
                json = new UTF8Encoding(false, true).GetString(bytes);
            }
            catch (DecoderFallbackException)
            {
                error = "Launcher handoff is not valid UTF-8.";
                return false;
            }

            if (!HasExactJsonFields(json, HandoffFields))
            {
                error = "Launcher handoff fields are missing or unsupported.";
                return false;
            }
            try
            {
                data = JsonUtility.FromJson<TeamForgeGuestHandoffData>(json);
            }
            catch (Exception)
            {
                error = "Launcher handoff JSON is damaged.";
                return false;
            }

            error = string.Empty;
            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            if (data == null || data.schemaVersion != SchemaVersion || data.baselineRevision <= 0 ||
                !TeamForgeProjectValidation.TryValidateCanonicalProjectUuid(data.projectUuid, out error) ||
                !IsLowerHex(data.manifestHash, 64) || !IsLowerHex(data.descriptorHash, 64) ||
                !IsLowerHex(data.ownerKeyId, 64) || !IsLowerHex(data.publisherKeyId, 64) ||
                string.IsNullOrWhiteSpace(data.activeProjectPath) || !Path.IsPathRooted(data.activeProjectPath) ||
                data.createdAtUnixMs < now - MaximumAgeMilliseconds ||
                data.createdAtUnixMs > now + MaximumFutureSkewMilliseconds)
            {
                data = null;
                error = string.IsNullOrWhiteSpace(error)
                    ? "Launcher handoff identity or timestamp is invalid."
                    : error;
                return false;
            }
            if (!TeamForgeJoinCode.TryParse(data.sessionJoinCode, out var session, out error) ||
                !string.Equals(session.projectUuid, data.projectUuid, StringComparison.Ordinal))
            {
                data = null;
                error = string.IsNullOrWhiteSpace(error)
                    ? "Realtime session identity does not match the transferred Project."
                    : error;
                return false;
            }

            error = string.Empty;
            return true;
        }

        private static bool TryValidateActiveProject(TeamForgeGuestHandoffData handoff, out string error)
        {
            try
            {
                var openedRoot = Directory.GetParent(Application.dataPath)?.FullName;
                if (string.IsNullOrWhiteSpace(openedRoot))
                {
                    error = "The opened Unity Project root is unavailable.";
                    return false;
                }

                openedRoot = Path.GetFullPath(openedRoot);
                var expectedRoot = Path.GetFullPath(handoff.activeProjectPath);
                if (!TryEnsureNoReparseSegments(expectedRoot, true, out error))
                {
                    return false;
                }

                if (!string.Equals(openedRoot, expectedRoot, PathComparison()))
                {
                    if (!TryValidateExecutionAlias(openedRoot, expectedRoot, out error))
                    {
                        return false;
                    }
                }

                // Descriptor and Baseline identity are always verified against the
                // canonical Launcher Active path, never against an arbitrary alias.
                if (!TeamForgeJoinProjectLocator.TryValidateMatchingProjectFolder(
                        expectedRoot,
                        handoff.projectUuid,
                        out var descriptor,
                        out error))
                {
                    return false;
                }
                if (descriptor.baselineRevision != handoff.baselineRevision ||
                    !string.Equals(descriptor.manifestHash, handoff.manifestHash, StringComparison.Ordinal) ||
                    !string.Equals(descriptor.descriptorHash, handoff.descriptorHash, StringComparison.Ordinal) ||
                    !string.Equals(descriptor.unityVersion, Application.unityVersion, StringComparison.Ordinal))
                {
                    error = "The opened Unity Project or Unity Editor version does not match the exact verified Active Baseline.";
                    return false;
                }

                error = string.Empty;
                return true;
            }
            catch (Exception exception)
            {
                error = $"The opened Unity Project could not be verified ({exception.GetType().Name}).";
                return false;
            }
        }

        private static bool TryValidateExecutionAlias(string openedRoot, string expectedRoot, out string error)
        {
            // An ExecutionAlias is allowed only when the canonical Active path is clean,
            // every parent of the Unity-visible alias is a normal directory, the alias
            // leaf is itself a reparse point, and Windows resolves that exact opened
            // directory back to the integrity-protected canonical Active path.
            if (Path.DirectorySeparatorChar != '\\')
            {
                error = "Unity did not open the exact verified Active Project.";
                return false;
            }
            if (!TryEnsureNoReparseSegments(openedRoot, false, out error))
            {
                return false;
            }

            var alias = new DirectoryInfo(openedRoot);
            if (!alias.Exists || (alias.Attributes & FileAttributes.ReparsePoint) == 0)
            {
                error = "Unity opened a different Project path that is not a verified execution alias.";
                return false;
            }

            if (!TryResolveFinalDirectoryPath(openedRoot, out var resolvedRoot, out error) ||
                !string.Equals(resolvedRoot, expectedRoot, PathComparison()))
            {
                if (string.IsNullOrWhiteSpace(error))
                {
                    error = "The Unity execution alias does not resolve to the exact verified Active Project.";
                }
                return false;
            }

            error = string.Empty;
            return true;
        }

        private static bool TryResolveFinalDirectoryPath(string path, out string resolvedPath, out string error)
        {
            resolvedPath = string.Empty;
#if UNITY_EDITOR_WIN
            var handle = CreateFile(
                path,
                0,
                FileShareRead | FileShareWrite | FileShareDelete,
                IntPtr.Zero,
                OpenExisting,
                FileFlagBackupSemantics,
                IntPtr.Zero);
            if (handle == InvalidHandleValue)
            {
                error = "The Unity execution alias could not be opened for identity verification.";
                return false;
            }

            try
            {
                var builder = new StringBuilder(32768);
                var length = GetFinalPathNameByHandle(handle, builder, (uint)builder.Capacity, 0);
                if (length == 0 || length >= (uint)builder.Capacity)
                {
                    error = "Windows could not resolve the Unity execution alias safely.";
                    return false;
                }

                var value = builder.ToString();
                if (value.StartsWith("\\\\?\\UNC\\", StringComparison.OrdinalIgnoreCase))
                {
                    value = "\\\\" + value.Substring(8);
                }
                else if (value.StartsWith("\\\\?\\", StringComparison.OrdinalIgnoreCase))
                {
                    value = value.Substring(4);
                }

                resolvedPath = Path.GetFullPath(value);
                error = string.Empty;
                return true;
            }
            catch (Exception exception)
            {
                error = $"The Unity execution alias could not be resolved ({exception.GetType().Name}).";
                return false;
            }
            finally
            {
                CloseHandle(handle);
            }
#else
            error = "Unity execution aliases are supported only on Windows.";
            return false;
#endif
        }

        private static bool TryEnsureNoReparseSegments(string path, bool includeLeaf, out string error)
        {
            var current = includeLeaf ? new DirectoryInfo(path) : new FileInfo(path).Directory;
            while (current != null)
            {
                if (!current.Exists || (current.Attributes & FileAttributes.ReparsePoint) != 0)
                {
                    error = "Launcher handoff path contains a missing or redirected directory.";
                    return false;
                }
                current = current.Parent;
            }
            error = string.Empty;
            return true;
        }

        private static bool HasExactJsonFields(string json, IEnumerable<string> expectedFields)
        {
            var expected = new HashSet<string>(expectedFields, StringComparer.Ordinal);
            var found = new HashSet<string>(StringComparer.Ordinal);
            var matches = Regex.Matches(json ?? string.Empty, "\"(?<key>(?:\\\\.|[^\"\\\\])*)\"\\s*:");
            foreach (Match match in matches)
            {
                var key = match.Groups["key"].Value;
                if (!expected.Contains(key) || !found.Add(key))
                {
                    return false;
                }
            }
            return found.SetEquals(expected);
        }

        private static bool IsLowerHex(string value, int length)
        {
            return !string.IsNullOrWhiteSpace(value) && value.Length == length &&
                   Regex.IsMatch(value, "^[0-9a-f]+$", RegexOptions.CultureInvariant);
        }

        private static bool TryValidateAuthenticationToken(string value, out string error)
        {
            value = value ?? string.Empty;
            if (value.Length > 8192 || value.IndexOfAny(new[] { '\0', '\r', '\n' }) >= 0)
            {
                error = "The one-shot Launcher access code is invalid.";
                return false;
            }

            error = string.Empty;
            return true;
        }

        private static void ClearCredentialWhenConnectionStops()
        {
            if (!TeamForgeConnectionService.ConnectionDesired &&
                (TeamForgeConnectionService.State == TeamForgeConnectionState.Disconnected ||
                 TeamForgeConnectionService.State == TeamForgeConnectionState.Faulted))
            {
                TeamForgeConnectionSettings.ClearGuestTransientAuthenticationToken();
            }
        }

        private static void ClearSensitiveState()
        {
            _pendingAuthenticationToken = string.Empty;
            TeamForgeConnectionSettings.ClearGuestTransientAuthenticationToken();
            Environment.SetEnvironmentVariable(AuthenticationEnvironmentVariable, null);
        }

        private static StringComparison PathComparison()
        {
            return Path.DirectorySeparatorChar == '\\'
                ? StringComparison.OrdinalIgnoreCase
                : StringComparison.Ordinal;
        }

        private static void Fail(string detail)
        {
            _pending = null;
            ClearSensitiveState();
            EditorApplication.update -= ApplyWhenEditorReady;
            TeamForgeDiagnostics.Warning("Guest bootstrap was rejected [guest_handoff_mismatch]. " + detail);
        }

#if UNITY_EDITOR_WIN
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr CreateFile(
            string fileName,
            uint desiredAccess,
            uint shareMode,
            IntPtr securityAttributes,
            uint creationDisposition,
            uint flagsAndAttributes,
            IntPtr templateFile);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern uint GetFinalPathNameByHandle(
            IntPtr file,
            StringBuilder filePath,
            uint filePathLength,
            uint flags);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CloseHandle(IntPtr handle);
#endif
    }
}

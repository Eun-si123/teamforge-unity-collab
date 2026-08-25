using System;
using System.IO;
using System.Text;
using UnityEngine;

namespace EunSung.TeamForge
{
    [Serializable]
    internal sealed class TeamForgeVerifiedGuestReconnectData
    {
        public int schemaVersion = 1;
        public string projectUuid = string.Empty;
        public string sessionId = string.Empty;
        public long baselineRevision;
        public string manifestHash = string.Empty;
        public string descriptorHash = string.Empty;
        public string activeProjectPath = string.Empty;
    }

    internal static class TeamForgeVerifiedGuestReconnect
    {
        private const int SchemaVersion = 1;
        private const long MaximumMarkerBytes = 65536;

        private static string MarkerPath()
        {
            return Path.GetFullPath(Path.Combine("Library", "TeamForge", "verified-guest-reconnect.json"));
        }

        internal static bool Matches(TeamForgeGuestHandoffData handoff)
        {
            if (handoff == null ||
                !TeamForgeJoinCode.TryParse(handoff.sessionJoinCode, out var session, out _))
            {
                return false;
            }

            try
            {
                var path = MarkerPath();
                if (!File.Exists(path))
                {
                    return false;
                }

                var information = new FileInfo(path);
                if ((information.Attributes & (FileAttributes.Directory | FileAttributes.ReparsePoint)) != 0 ||
                    information.Length <= 0 || information.Length > MaximumMarkerBytes)
                {
                    return false;
                }

                var json = File.ReadAllText(path, new UTF8Encoding(false, true));
                var marker = JsonUtility.FromJson<TeamForgeVerifiedGuestReconnectData>(json);
                if (marker == null || marker.schemaVersion != SchemaVersion)
                {
                    return false;
                }

                return string.Equals(marker.projectUuid, handoff.projectUuid, StringComparison.Ordinal) &&
                       string.Equals(marker.sessionId, session.sessionId, StringComparison.Ordinal) &&
                       marker.baselineRevision == handoff.baselineRevision &&
                       string.Equals(marker.manifestHash, handoff.manifestHash, StringComparison.Ordinal) &&
                       string.Equals(marker.descriptorHash, handoff.descriptorHash, StringComparison.Ordinal) &&
                       PathsEqual(marker.activeProjectPath, handoff.activeProjectPath);
            }
            catch (Exception)
            {
                return false;
            }
        }

        internal static void Store(TeamForgeGuestHandoffData handoff)
        {
            if (handoff == null ||
                !TeamForgeJoinCode.TryParse(handoff.sessionJoinCode, out var session, out _))
            {
                return;
            }

            try
            {
                var marker = new TeamForgeVerifiedGuestReconnectData
                {
                    schemaVersion = SchemaVersion,
                    projectUuid = handoff.projectUuid,
                    sessionId = session.sessionId,
                    baselineRevision = handoff.baselineRevision,
                    manifestHash = handoff.manifestHash,
                    descriptorHash = handoff.descriptorHash,
                    activeProjectPath = Path.GetFullPath(handoff.activeProjectPath),
                };
                var destination = MarkerPath();
                var directory = Path.GetDirectoryName(destination);
                if (string.IsNullOrWhiteSpace(directory))
                {
                    return;
                }

                Directory.CreateDirectory(directory);
                var temporary = destination + ".tmp";
                File.WriteAllText(temporary, JsonUtility.ToJson(marker, false), new UTF8Encoding(false));
                if (File.Exists(destination))
                {
                    File.Replace(temporary, destination, null);
                }
                else
                {
                    File.Move(temporary, destination);
                }
            }
            catch (Exception exception)
            {
                TeamForgeDiagnostics.Warning(
                    $"Verified Guest reconnect marker could not be updated ({exception.GetType().Name}). Future reconnect will remain fail-closed.");
            }
        }

        private static bool PathsEqual(string left, string right)
        {
            try
            {
                return string.Equals(
                    Path.GetFullPath(left ?? string.Empty),
                    Path.GetFullPath(right ?? string.Empty),
                    Path.DirectorySeparatorChar == '\\'
                        ? StringComparison.OrdinalIgnoreCase
                        : StringComparison.Ordinal);
            }
            catch (Exception)
            {
                return false;
            }
        }
    }
}

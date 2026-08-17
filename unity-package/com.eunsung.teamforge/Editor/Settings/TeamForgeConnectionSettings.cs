using System;
using UnityEditor;
using UnityEngine;

namespace EunSung.TeamForge
{
    public enum TeamForgeLogLevel
    {
        Trace = 0,
        Info = 1,
        Warning = 2,
        Error = 3,
        Off = 4,
    }

    [FilePath("UserSettings/TeamForgeSettings.asset", FilePathAttribute.Location.ProjectFolder)]
    public sealed class TeamForgeConnectionSettings : ScriptableSingleton<TeamForgeConnectionSettings>
    {
        private const int MaximumTransientAuthenticationTokenLength = 8192;

        [NonSerialized]
        private static string _guestTransientAuthenticationToken = string.Empty;

        public string ServerAddress = "http://127.0.0.1:5080";
        public string CoordinatorListenHost = TeamForgeHostEndpointPolicy.DefaultLanListenHost;
        public string RealtimePath = "ws";
        public string UserName = string.Empty;
        public string UserId = string.Empty;
        public string UserColorHtml = string.Empty;
        public string ProjectId = "default-project";
        public string SessionId = "default-session";
        public string AuthenticationToken = string.Empty;
        public int ConnectionTimeoutSeconds = 10;
        public bool AutoReconnect = true;
        public int MaximumReconnectDelaySeconds = 30;
        public int PresenceUpdatesPerSecond = 5;
        public int PresenceHeartbeatSeconds = 5;
        public int TransformUpdatesPerSecond = 10;
        public int LockRenewalSeconds = 5;
        public TeamForgeLogLevel LogLevel = TeamForgeLogLevel.Info;

        // Internal hand-off flag used only across a Unity domain/assembly reload.
        public bool ResumeAfterAssemblyReload;

        public string EffectiveAuthenticationToken
        {
            get
            {
                if (!string.IsNullOrWhiteSpace(AuthenticationToken))
                {
                    return AuthenticationToken;
                }

                if (!string.IsNullOrEmpty(_guestTransientAuthenticationToken))
                {
                    return _guestTransientAuthenticationToken;
                }

                if (string.Equals(
                        Environment.GetEnvironmentVariable("TEAMFORGE_TESTLAB"),
                        "1",
                        StringComparison.Ordinal))
                {
                    return Environment.GetEnvironmentVariable("TEAMFORGE_TESTLAB_AUTH_TOKEN") ?? string.Empty;
                }

                return string.Empty;
            }
        }

        internal static bool TrySetGuestTransientAuthenticationToken(string value, out string error)
        {
            value = value ?? string.Empty;
            if (value.Length > MaximumTransientAuthenticationTokenLength ||
                value.IndexOfAny(new[] { '\0', '\r', '\n' }) >= 0)
            {
                _guestTransientAuthenticationToken = string.Empty;
                error = "The one-shot Launcher access code is invalid.";
                return false;
            }

            _guestTransientAuthenticationToken = value;
            error = string.Empty;
            return true;
        }

        internal static void ClearGuestTransientAuthenticationToken()
        {
            _guestTransientAuthenticationToken = string.Empty;
        }

        public void EnsureDefaults()
        {
            if (string.IsNullOrWhiteSpace(ServerAddress))
            {
                ServerAddress = "http://127.0.0.1:5080";
            }

            if (string.IsNullOrWhiteSpace(CoordinatorListenHost))
            {
                CoordinatorListenHost = TeamForgeHostEndpointPolicy.DefaultLanListenHost;
            }

            if (string.IsNullOrWhiteSpace(RealtimePath))
            {
                RealtimePath = "ws";
            }

            if (string.IsNullOrWhiteSpace(UserName))
            {
                UserName = GetLocalUserName();
            }

            if (string.IsNullOrWhiteSpace(UserId))
            {
                UserId = Guid.NewGuid().ToString("N");
            }

            if (!IsHtmlColor(UserColorHtml))
            {
                UserColorHtml = ColorForUserId(UserId);
            }

            if (string.IsNullOrWhiteSpace(ProjectId))
            {
                ProjectId = "default-project";
            }

            if (string.IsNullOrWhiteSpace(SessionId))
            {
                SessionId = "default-session";
            }

            // Fields added after Phase 1 deserialize as zero in older settings assets.
            if (TransformUpdatesPerSecond <= 0)
            {
                TransformUpdatesPerSecond = 10;
            }
            if (LockRenewalSeconds <= 0)
            {
                LockRenewalSeconds = 5;
            }

            ConnectionTimeoutSeconds = Mathf.Clamp(ConnectionTimeoutSeconds, 1, 120);
            MaximumReconnectDelaySeconds = Mathf.Clamp(MaximumReconnectDelaySeconds, 1, 300);
            PresenceUpdatesPerSecond = Mathf.Clamp(PresenceUpdatesPerSecond, 1, 20);
            PresenceHeartbeatSeconds = Mathf.Clamp(PresenceHeartbeatSeconds, 2, 60);
            TransformUpdatesPerSecond = Mathf.Clamp(TransformUpdatesPerSecond, 1, 30);
            LockRenewalSeconds = Mathf.Clamp(LockRenewalSeconds, 1, 30);
        }

        public void SaveSettings()
        {
            EnsureDefaults();
            Save(true);
        }

        private static string GetLocalUserName()
        {
            try
            {
                var value = Environment.UserName;
                return string.IsNullOrWhiteSpace(value) ? "Unity User" : value.Trim();
            }
            catch
            {
                return "Unity User";
            }
        }

        private static bool IsHtmlColor(string value)
        {
            if (string.IsNullOrWhiteSpace(value) || value.Length != 7 || value[0] != '#')
            {
                return false;
            }

            for (var index = 1; index < value.Length; index += 1)
            {
                if (!Uri.IsHexDigit(value[index]))
                {
                    return false;
                }
            }

            return true;
        }

        private static string ColorForUserId(string userId)
        {
            var palette = new[]
            {
                "#E57373", "#64B5F6", "#81C784", "#FFD54F",
                "#BA68C8", "#4DD0E1", "#FF8A65", "#A1887F",
            };
            unchecked
            {
                uint hash = 2166136261;
                foreach (var character in userId ?? string.Empty)
                {
                    hash ^= character;
                    hash *= 16777619;
                }
                return palette[hash % palette.Length];
            }
        }
    }
}

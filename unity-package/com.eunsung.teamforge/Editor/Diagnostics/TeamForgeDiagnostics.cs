using System;
using System.Collections.Generic;
using System.Text;
using UnityEngine;

namespace EunSung.TeamForge
{
    public static class TeamForgeDiagnostics
    {
        private const int MaximumEntries = 200;
        private static readonly object Gate = new object();
        private static readonly Queue<string> Entries = new Queue<string>();
        private static TeamForgeLogLevel _minimumLevel = TeamForgeLogLevel.Info;

        public static void Configure(TeamForgeLogLevel minimumLevel)
        {
            _minimumLevel = minimumLevel;
        }

        public static void Trace(string message) => Write(TeamForgeLogLevel.Trace, message);
        public static void Info(string message) => Write(TeamForgeLogLevel.Info, message);
        public static void Warning(string message) => Write(TeamForgeLogLevel.Warning, message);
        public static void Error(string message) => Write(TeamForgeLogLevel.Error, message);

        public static void Clear()
        {
            lock (Gate)
            {
                Entries.Clear();
            }
        }

        public static string Snapshot()
        {
            lock (Gate)
            {
                var builder = new StringBuilder();
                foreach (var entry in Entries)
                {
                    builder.AppendLine(entry);
                }
                return builder.ToString();
            }
        }

        private static void Write(TeamForgeLogLevel level, string message)
        {
            if (_minimumLevel == TeamForgeLogLevel.Off || level < _minimumLevel)
            {
                return;
            }

            var entry = $"{DateTime.UtcNow:O} [{level}] {message}";
            lock (Gate)
            {
                Entries.Enqueue(entry);
                while (Entries.Count > MaximumEntries)
                {
                    Entries.Dequeue();
                }
            }

            if (level == TeamForgeLogLevel.Error)
            {
                Debug.LogError($"[TeamForge] {message}");
            }
            else if (level == TeamForgeLogLevel.Warning)
            {
                Debug.LogWarning($"[TeamForge] {message}");
            }
            else if (level == TeamForgeLogLevel.Trace)
            {
                Debug.Log($"[TeamForge/Trace] {message}");
            }
            else
            {
                Debug.Log($"[TeamForge] {message}");
            }
        }
    }
}

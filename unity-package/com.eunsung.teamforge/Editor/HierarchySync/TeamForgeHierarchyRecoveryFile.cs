using System;
using System.IO;
using System.Text;
using UnityEngine;

namespace EunSung.TeamForge
{
    internal sealed class TeamForgeHierarchyRecoveryFile
    {
        private const int MaximumBytes = 256 * 1024;
        private static readonly UTF8Encoding Encoding = new UTF8Encoding(false, true);
        [Serializable] private sealed class Envelope { public string payload, checksum; }
        private readonly string path;

        internal TeamForgeHierarchyRecoveryFile(string path) { this.path = path; }

        internal string Read()
        {
            if (!File.Exists(path)) return null;
            RequireSafeFile(false);
            var bytes = new byte[MaximumBytes + 1];
            var count = 0;
            using (var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                while (count < bytes.Length)
                {
                    var read = stream.Read(bytes, count, bytes.Length - count);
                    if (read == 0) break;
                    count += read;
                }
            }
            if (count > MaximumBytes) throw new IOException();
            var envelope = JsonUtility.FromJson<Envelope>(Encoding.GetString(bytes, 0, count));
            if (envelope?.payload == null || envelope.checksum != TeamForgeTransformRecoveryStore.Digest(envelope.payload))
                throw new IOException();
            return envelope.payload;
        }

        internal void Write(string payload)
        {
            var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try
            {
                var bytes = Encoding.GetBytes(JsonUtility.ToJson(new Envelope
                    { payload = payload, checksum = TeamForgeTransformRecoveryStore.Digest(payload) }));
                if (bytes.Length > MaximumBytes) throw new IOException();
                RequireSafeFile(true);
                using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                {
                    stream.Write(bytes, 0, bytes.Length);
                    stream.Flush(true);
                }
                if (File.Exists(path)) File.Replace(temporary, path, null);
                else File.Move(temporary, path);
            }
            finally
            {
                try { if (File.Exists(temporary)) File.Delete(temporary); }
                catch (Exception) { TeamForgeDiagnostics.Warning("Hierarchy recovery temporary file cleanup failed."); }
            }
        }

        private void RequireSafeFile(bool create)
        {
            var directory = new DirectoryInfo(Path.GetDirectoryName(path));
            for (var parent = directory; parent != null; parent = parent.Parent)
            {
                if (parent.Exists && (parent.Attributes & FileAttributes.ReparsePoint) != 0) throw new IOException();
            }
            if (create) directory.Create();
            if (File.Exists(path) && (new FileInfo(path).Attributes & FileAttributes.ReparsePoint) != 0) throw new IOException();
        }
    }
}

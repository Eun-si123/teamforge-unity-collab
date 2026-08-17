using System.Collections;
using System.Diagnostics;

namespace TeamForge.Launcher.Core;

public static class EnvironmentPolicy
{
    public static bool IsUnsafeInheritedVariable(string name)
    {
        return name.StartsWith("NODE_", StringComparison.OrdinalIgnoreCase)
            || name.Equals("SSL_CERT_FILE", StringComparison.OrdinalIgnoreCase)
            || name.Equals("SSL_CERT_DIR", StringComparison.OrdinalIgnoreCase)
            || name.Equals("OPENSSL_CONF", StringComparison.OrdinalIgnoreCase)
            || name.StartsWith("NPM_", StringComparison.OrdinalIgnoreCase)
            || name.StartsWith("NPM_CONFIG_", StringComparison.OrdinalIgnoreCase)
            || name.StartsWith("COREPACK_", StringComparison.OrdinalIgnoreCase)
            || name.StartsWith("TEAMFORGE_", StringComparison.OrdinalIgnoreCase);
    }

    public static void Scrub(IDictionary<string, string?> environment)
    {
        foreach (var key in environment.Keys.Where(IsUnsafeInheritedVariable).ToArray())
        {
            environment.Remove(key);
        }
    }

    public static Dictionary<string, string?> ScrubbedCopy(IEnumerable<KeyValuePair<string, string?>> source)
    {
        var result = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
        foreach (var pair in source)
        {
            if (!IsUnsafeInheritedVariable(pair.Key))
            {
                result[pair.Key] = pair.Value;
            }
        }

        return result;
    }
}

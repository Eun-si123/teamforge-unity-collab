namespace EunSung.TeamForge
{
    public static class TeamForgeInputValidator
    {
        public static bool TryValidateIdentity(
            string userName,
            string projectId,
            string sessionId,
            out string error)
        {
            return TryValidateText(userName, "User name", 64, out error) &&
                   TryValidateText(projectId, "Project ID", 128, out error) &&
                   TryValidateText(sessionId, "Session ID", 128, out error);
        }

        public static bool TryValidatePresenceIdentity(string userId, string userColor, out string error)
        {
            if (!TryValidateText(userId, "User ID", 128, out error))
            {
                return false;
            }

            var candidate = userColor?.Trim() ?? string.Empty;
            if (candidate.Length != 7 || candidate[0] != '#')
            {
                error = "User color must use the #RRGGBB format.";
                return false;
            }

            for (var index = 1; index < candidate.Length; index += 1)
            {
                if (!System.Uri.IsHexDigit(candidate[index]))
                {
                    error = "User color must use the #RRGGBB format.";
                    return false;
                }
            }

            error = string.Empty;
            return true;
        }

        public static bool TryValidateText(string value, string label, int maximumLength, out string error)
        {
            error = string.Empty;
            var candidate = value?.Trim() ?? string.Empty;
            if (candidate.Length == 0 || candidate.Length > maximumLength)
            {
                error = $"{label} must contain 1-{maximumLength} characters.";
                return false;
            }

            foreach (var character in candidate)
            {
                if (char.IsControl(character))
                {
                    error = $"{label} cannot contain control characters.";
                    return false;
                }
            }

            return true;
        }
    }
}

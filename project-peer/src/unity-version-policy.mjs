// Source-project admission only. Keep the full version token for descriptors,
// hashes and exact Editor matching; a family classification is not release proof.
export function classifyUnityProjectVersion(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) return null;
  const match = /^6000\.(3|6)\.[0-9]+f[0-9]+$/u.exec(value);
  // JavaScript's $ can match before a final newline. Require the entire token.
  if (!match || match[0] !== value) return null;
  return match[1] === "3" ? "lts" : "experimental";
}

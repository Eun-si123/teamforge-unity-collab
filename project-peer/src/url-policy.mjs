import { isIP } from "node:net";
import { fail } from "./errors.mjs";

// URL parsers can reinterpret a mistyped numeric host such as 192.168.219.
// as a different IPv4 address. Validate the original input before parsing.
export function hasMalformedNumericIpv4Host(serverAddress) {
  if (typeof serverAddress !== "string") return false;
  // Special URLs also accept missing slashes and backslashes as separators.
  const match = /^[a-z][a-z0-9+.-]*:[/\\]*([^/\\?#]*)/iu.exec(serverAddress.trim());
  const originalHost = match?.[1].split("@").at(-1).replace(/:[0-9]*$/u, "");
  // Keep rejecting invalid numeric listeners even when URL itself cannot parse
  // them: listener validation also uses this helper before binding a socket.
  if (originalHost && /^[0-9.]+$/u.test(originalHost)) return isIP(originalHost) !== 4;
  // Compare the literal Host with the parsed IPv4 address. WHATWG URL also
  // accepts hex, octal, integer, percent-encoded and shortened IPv4 aliases.
  let parsed;
  try { parsed = new URL(serverAddress); } catch { return false; }
  return isIP(parsed.hostname) === 4 && originalHost !== parsed.hostname;
}

export function websocketUrl(serverAddress, realtimePath) {
  if (hasMalformedNumericIpv4Host(serverAddress)) {
    fail("invalid_server_address", "Coordinator IPv4 address must have four decimal octets (for example, 192.168.1.10); check the Host address.");
  }
  let url;
  try {
    url = new URL(serverAddress);
  } catch {
    fail("invalid_server_address", "Coordinator server address is not a valid absolute URL.");
  }
  if (url.username || url.password || url.search || url.hash) {
    fail("invalid_server_address", "Coordinator URL cannot contain credentials, query, or fragment.");
  }
  if (url.protocol === "http:") {
    url.protocol = "ws:";
  } else if (url.protocol === "https:") {
    url.protocol = "wss:";
  } else if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    fail("invalid_server_address", "Coordinator URL must use HTTP(S) or WS(S).");
  }
  const rawPath = String(realtimePath ?? "ws");
  // Unity trims editor input before writing TF1 codes. A signed Peer invite
  // carrying untrimmed outer whitespace would otherwise target a different
  // endpoint when Unity builds its URI; reject it instead of silently diverging.
  if (rawPath !== rawPath.trim()) {
    fail("invalid_realtime_path", "Realtime path cannot have outer whitespace.");
  }
  const suffix = rawPath.replace(/^\/+|\/+$/gu, "");
  // WHATWG URL collapses dot segments (including %2e aliases), treats
  // backslashes as separators, and strips tabs/newlines. Reject these and
  // control characters before they can silently retarget the endpoint.
  if (!suffix || /[?#\\\u0000-\u001f\u007f]/u.test(suffix) || suffix.includes("..") ||
      suffix.split("/").some((segment) => !segment || /^(?:\.|%2e)+$/iu.test(segment))) {
    fail("invalid_realtime_path", "Realtime path is invalid.");
  }
  url.pathname = `${url.pathname.replace(/\/+$/u, "")}/${suffix}`.replace(/\/{2,}/gu, "/");
  return url;
}

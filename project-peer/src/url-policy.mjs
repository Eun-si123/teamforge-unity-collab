import { isIP } from "node:net";
import { fail } from "./errors.mjs";

// URL parsers can reinterpret a mistyped numeric host such as 192.168.219.
// as a different IPv4 address. Validate the original input before parsing.
// WHATWG URL silently strips ASCII tabs/newlines and outer controls from
// raw addresses. Keep the signed invite and Unity URI boundaries fail-closed.
export function hasUnsafeServerAddressCharacters(serverAddress) {
  return typeof serverAddress === "string" && /[\u0000-\u001f\u007f]/u.test(serverAddress);
}

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

// .NET UriBuilder decodes unreserved escapes and canonicalizes hex case;
// WHATWG URL retains the raw spelling. Only accept a shared canonical form.
function hasNoncanonicalPercentEscape(path) {
  for (let i = 0; i < path.length; i += 1) {
    if (path[i] !== "%") continue;
    const hex = path.slice(i + 1, i + 3);
    if (!/^[0-9A-F]{2}$/u.test(hex) ||
        /[A-Za-z0-9._~-]/u.test(String.fromCharCode(Number.parseInt(hex, 16)))) return true;
    i += 2;
  }
  return false;
}

export function websocketUrl(serverAddress, realtimePath) {
  if (hasUnsafeServerAddressCharacters(serverAddress)) {
    fail("invalid_server_address", "Coordinator URL cannot contain control characters.");
  }
  if (hasMalformedNumericIpv4Host(serverAddress)) {
    fail("invalid_server_address", "Coordinator IPv4 address must have four decimal octets (for example, 192.168.1.10); check the Host address.");
  }
  // WHATWG URL repairs missing authority slashes and treats backslashes as
  // separators. Require the literal address to agree with the intended URL.
  const rawAddress = String(serverAddress).trim();
  if (!/^(?:https?|wss?):\/\/[^/\\?#]+/iu.test(rawAddress) || rawAddress.includes("\\")) {
    fail("invalid_server_address", "Coordinator URL must use a canonical scheme, authority, and forward slashes.");
  }
  let url;
  try {
    url = new URL(serverAddress);
  } catch {
    fail("invalid_server_address", "Coordinator server address is not a valid absolute URL.");
  }
  // Empty '?' and '#' delimiters have empty WHATWG search/hash properties,
  // but survive URL construction (and a fragment makes WebSocket fail).
  // Reject their literal presence as well as nonempty query/fragment values.
  if (rawAddress.includes("?") || rawAddress.includes("#") ||
      url.username || url.password || url.search || url.hash) {
    fail("invalid_server_address", "Coordinator URL cannot contain credentials, query, or fragment.");
  }
  // Check the raw path: WHATWG URL may already have removed a %2E segment.
  const schemeEnd = rawAddress.indexOf("://");
  const pathStart = schemeEnd < 0 ? -1 : rawAddress.indexOf("/", schemeEnd + 3);
  if (pathStart >= 0) {
    const basePath = rawAddress.slice(pathStart);
    if (hasNoncanonicalPercentEscape(basePath)) {
      fail("invalid_server_address", "Coordinator URL contains a noncanonical percent escape.");
    }
    // Peer URL assembly collapses interior repeated slashes while Unity
    // preserves them. Reject this ambiguous base path before connecting.
    if (/[^/]\/{2,}[^/]/u.test(basePath)) {
      fail("invalid_server_address", "Coordinator URL contains ambiguous interior path separators.");
    }
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
  if (hasNoncanonicalPercentEscape(suffix)) {
    fail("invalid_realtime_path", "Realtime path contains a noncanonical percent escape.");
  }
  url.pathname = `${url.pathname.replace(/\/+$/u, "")}/${suffix}`.replace(/\/{2,}/gu, "/");
  return url;
}

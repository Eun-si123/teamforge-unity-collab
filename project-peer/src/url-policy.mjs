import { fail } from "./errors.mjs";

export function websocketUrl(serverAddress, realtimePath) {
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
  const suffix = String(realtimePath ?? "ws").replace(/^\/+|\/+$/gu, "");
  if (!suffix || suffix.includes("?") || suffix.includes("#") || suffix.includes("..")) {
    fail("invalid_realtime_path", "Realtime path is invalid.");
  }
  url.pathname = `${url.pathname.replace(/\/+$/u, "")}/${suffix}`.replace(/\/{2,}/gu, "/");
  return url;
}

import process from "node:process";
import { fail } from "./errors.mjs";
import { previewHostCheckpoint } from "./host-checkpoint-preview.mjs";

const maximumResponseBytes = 65_536;
const optionNames = new Set([
  "--launch-settings", "--launch-digest", "--project-uuid", "--baseline-revision", "--manifest-hash", "--descriptor-hash",
]);
const failureMessages = new Map([
  ["invalid_host_preview_request", "An exact Host baseline is required before checking saved Project changes."],
  ["host_preview_baseline_changed", "The current approved Project changed. Check Host status and review again."],
  ["source_changed", "A saved source file changed during the check. Wait for any saves to finish and try again."],
  ["invalid_launch_settings_file", "TeamForge could not safely read the active Host launch settings."],
  ["launch_settings_load_failed", "TeamForge could not safely read the active Host launch settings."],
  ["source_project_not_authorized", "The Host launch settings must allow the current Project as a saved source."],
]);

function request(args) {
  const options = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!optionNames.has(name) || options.has(name) || !value) invalidRequest();
    options.set(name, value);
  }
  const revision = options.get("--baseline-revision");
  if (options.size !== optionNames.size || !/^[1-9][0-9]*$/u.test(revision)) invalidRequest();
  return {
    launchSettingsPath: options.get("--launch-settings"),
    launchSettingsDigest: options.get("--launch-digest"),
    projectUuid: options.get("--project-uuid"),
    revision: Number(revision),
    manifestHash: options.get("--manifest-hash"),
    descriptorHash: options.get("--descriptor-hash"),
  };
}

function invalidRequest() {
  fail("invalid_host_preview_request", failureMessages.get("invalid_host_preview_request"));
}

try {
  const result = await previewHostCheckpoint(request(process.argv.slice(2)));
  const response = `${JSON.stringify(result)}\n`;
  if (Buffer.byteLength(response, "utf8") > maximumResponseBytes) {
    fail("host_preview_response_limit", "The saved changes report exceeded its display limit.");
  }
  process.stdout.write(response);
} catch (error) {
  // Parser and filesystem error messages can contain source paths or bytes.
  const rawCode = failureMessages.has(error?.code) ? error.code : "host_preview_unavailable";
  const message = failureMessages.get(rawCode) ?? "TeamForge could not verify the approved revision and saved source files.";
  process.stdout.write(`${JSON.stringify({ state: "needs_action", failure: { rawCode, message } })}\n`);
}

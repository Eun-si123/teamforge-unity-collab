import fs from "node:fs";
import path from "node:path";

function readableNpmCli(candidate) {
  if (!candidate || !path.isAbsolute(candidate) || path.basename(candidate).toLowerCase() !== "npm-cli.js") return false;
  try {
    if (!fs.statSync(candidate).isFile()) return false;
    fs.accessSync(candidate, fs.constants.R_OK);
    return true;
  } catch { return false; }
}

// Windows npm.cmd cannot be spawned without a shell on supported Node versions.
// Invoke npm's JavaScript entry point instead; never interpret shell arguments.
export function resolveTestLabCommand(command, args, {
  platform = process.platform, env = process.env, nodeExecutable = process.execPath,
} = {}) {
  if (platform !== "win32" || !/^npm(?:\.cmd)?$/i.test(command)) return { command, args };

  const directories = [path.dirname(nodeExecutable),
    ...(env.PATH ?? env.Path ?? "").split(";").filter((directory) => directory && path.isAbsolute(directory))];
  const candidates = [env.npm_execpath];
  for (const directory of directories) {
    candidates.push(path.join(directory, "node_modules", "npm", "bin", "npm-cli.js"),
      path.resolve(directory, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"));
  }
  const npmCli = candidates.find(readableNpmCli);
  if (!npmCli) {
    const error = new Error("A readable npm-cli.js was not found. Run Test Lab through npm or install npm beside Node or on PATH.");
    error.code = "testlab_npm_cli_unavailable";
    throw error;
  }
  return { command: nodeExecutable, args: [npmCli, ...args] };
}

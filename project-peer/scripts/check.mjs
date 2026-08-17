import { readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = [];
for (const directory of ["src", "scripts", "test"]) {
  for (const name of await readdir(path.join(root, directory), { recursive: true })) {
    if (name.endsWith(".mjs")) files.push(path.join(root, directory, name));
  }
}
files.sort();
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
process.stdout.write(`Syntax checked ${files.length} module(s).\n`);

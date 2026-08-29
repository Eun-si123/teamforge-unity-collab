import { readFile } from "node:fs/promises";
import process from "node:process";

const config = JSON.parse(await readFile(new URL("../quality-gates.json", import.meta.url), "utf8"));

function normalize(path) {
  return String(path).trim().replaceAll("\\", "/").replace(/^\.\//u, "");
}

function matchesRule(path, rule) {
  if (Array.isArray(rule.exact) && rule.exact.includes(path)) return true;
  if (Array.isArray(rule.prefixes) && rule.prefixes.some((prefix) => path.startsWith(prefix))) return true;
  return false;
}

function maxRisk(a, b) {
  const order = config.riskOrder;
  return order.indexOf(b) > order.indexOf(a) ? b : a;
}

async function readStdin() {
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  return text.split(/\r?\n/u).map(normalize).filter(Boolean);
}

const args = process.argv.slice(2);
const useStdin = args.includes("--stdin");
const githubOutputIndex = args.indexOf("--github-output");
const githubOutputPath = githubOutputIndex >= 0
  ? (args[githubOutputIndex + 1] || process.env.GITHUB_OUTPUT || "")
  : "";

const positional = args.filter((arg, index) => {
  if (arg === "--stdin" || arg === "--github-output") return false;
  if (githubOutputIndex >= 0 && index === githubOutputIndex + 1) return false;
  return !arg.startsWith("--");
});

const files = [...new Set((useStdin ? await readStdin() : positional.map(normalize)).filter(Boolean))].sort();
const matchedRules = new Set();
const gates = new Set(["engineering-policy"]);
let risk = "low";

for (const path of files) {
  for (const rule of config.rules) {
    if (!matchesRule(path, rule)) continue;
    matchedRules.add(rule.id);
    risk = maxRisk(risk, rule.risk);
    for (const gate of rule.requires) gates.add(gate);
  }

  const lower = path.toLowerCase();
  if (config.highRiskFragments.some((fragment) => lower.includes(fragment.toLowerCase()))) {
    risk = "high";
    for (const gate of config.highRiskAdditionalGates) gates.add(gate);
  }
}

if (files.length === 0) {
  matchedRules.add("no-paths");
}

const gateDetails = [...gates]
  .sort()
  .map((name) => ({ name, ...config.gates[name] }));

const result = {
  schemaVersion: config.schemaVersion,
  risk,
  changedFiles: files,
  matchedRules: [...matchedRules].sort(),
  gates: gateDetails,
  note: "Path classification routes review and validation. It does not prove that required evidence passed, and semantic risk may require stronger testing than the path alone suggests."
};

const json = JSON.stringify(result, null, 2);
console.log(json);

if (githubOutputPath) {
  const { appendFile } = await import("node:fs/promises");
  const gateNames = gateDetails.map((gate) => gate.name).join(",");
  const summary = `risk=${risk}; gates=${gateNames || "none"}; files=${files.length}`;
  await appendFile(
    githubOutputPath,
    `risk=${risk}\ngates=${gateNames}\nchanged_count=${files.length}\nsummary=${summary}\n`,
    "utf8",
  );
}

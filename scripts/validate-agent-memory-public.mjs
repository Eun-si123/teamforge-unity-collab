import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const targets = ['docs/AGENT_MEMORY.md'];
const checkpointRoot = path.join(root, 'docs', 'agent-checkpoints');

if (fs.existsSync(checkpointRoot)) {
  for (const entry of fs.readdirSync(checkpointRoot, { withFileTypes: true })) {
    if (entry.isFile() && /\.md$/i.test(entry.name)) {
      targets.push(path.posix.join('docs/agent-checkpoints', entry.name));
    }
  }
}

const checks = [
  ['private IPv4 address', /\b(?:10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})\b/g],
  ['CGNAT/Tailscale-style address', /\b100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])(?:\.\d{1,3}){2}\b/g],
  ['local Unix home/workspace path', /(?:^|[\s"'\x60(])\/(?:home|Users|workspace)\/[A-Za-z0-9._-]+(?:\/[^\s"'\x60)]*)?/gm],
  ['Windows user-profile path', /\b[A-Za-z]:\\Users\\[^\s"'\x60]+/g],
  ['email address', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi],
  ['SSH fingerprint', /\bSHA256:[A-Za-z0-9+/]{20,}={0,2}\b/g],
  ['private-key material', /-----BEGIN (?:OPENSSH |RSA |EC |DSA )?PRIVATE KEY-----/g],
  ['Bearer credential', /\bBearer\s+[A-Za-z0-9._~+\/-]{12,}=*/g],
  ['common token prefix', /\b(?:ghp_|github_pat_|sk-[A-Za-z0-9_-]{8,})[A-Za-z0-9_-]*/g],
  ['credential assignment', /\b(?:password|passwd|token|api[_-]?key|client[_-]?secret)\s*[:=]\s*["']?[^\s"'<>]{6,}/gi],
  ['private home-arpa hostname', /\b(?:[A-Za-z0-9-]+\.)+home\.arpa\b/gi],
];

const failures = [];
for (const rel of targets) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) continue;
  const text = fs.readFileSync(full, 'utf8');
  for (const [label, regex] of checks) {
    regex.lastIndex = 0;
    for (const match of text.matchAll(regex)) {
      const line = text.slice(0, match.index).split('\n').length;
      failures.push(`${rel}:${line}: ${label}: ${JSON.stringify(match[0])}`);
    }
  }
}

if (failures.length) {
  console.error('Public agent-memory privacy validation failed.');
  console.error('Move raw/private evidence to an authorized private location and keep only a sanitized technical conclusion here.');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Public agent-memory privacy validation passed for ${targets.filter((rel) => fs.existsSync(path.join(root, rel))).length} file(s).`);

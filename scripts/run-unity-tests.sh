#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${UNITY_EDITOR:-}" ]]; then
  echo "Set UNITY_EDITOR to the absolute Unity 6000.3.x executable path." >&2
  exit 2
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required to validate Unity EditMode result XML." >&2
  exit 2
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd "$script_dir/../unity-project" && pwd)"
results_dir="$script_dir/../artifacts/unity-tests"
mkdir -p "$results_dir"
results_file="$results_dir/editmode-results.xml"
log_file="$results_dir/unity-editor.log"
# A previous passing result must never satisfy a new launch that produced none.
rm -f -- "$results_file" "$log_file"

"$UNITY_EDITOR" \
  -batchmode \
  -nographics \
  -projectPath "$project_dir" \
  -runTests \
  -testPlatform EditMode \
  -testResults "$results_file" \
  -logFile "$log_file"

python3 - "$results_file" <<'PY'
import re
import sys
import xml.etree.ElementTree as ET

try:
    root = ET.parse(sys.argv[1]).getroot()
    if root.tag != "test-run":
        raise ValueError("expected a test-run root")
    counts = {}
    for name in ("total", "passed", "failed", "skipped", "inconclusive"):
        value = root.get(name, "")
        if not re.fullmatch(r"[0-9]+", value):
            raise ValueError(f"invalid or missing {name} count")
        counts[name] = int(value)
    if counts["total"] != sum(counts[name] for name in ("passed", "failed", "skipped", "inconclusive")):
        raise ValueError("inconsistent test counts")
    # Intentional ignored tests may coexist with real passing tests. An empty or
    # skipped-only run cannot establish that the EditMode suite passed.
    if (root.get("result") != "Passed" or counts["passed"] == 0
            or counts["failed"] != 0 or counts["inconclusive"] != 0):
        raise ValueError("expected positive passing tests without failures or inconclusive results")
except (OSError, ET.ParseError, ValueError) as error:
    print(f"Unity EditMode result validation failed: {error}", file=sys.stderr)
    sys.exit(1)
PY

echo "Unity EditMode results: $results_file"

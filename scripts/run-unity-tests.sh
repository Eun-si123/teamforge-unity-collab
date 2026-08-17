#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${UNITY_EDITOR:-}" ]]; then
  echo "Set UNITY_EDITOR to the absolute Unity 6000.3.x executable path." >&2
  exit 2
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd "$script_dir/../unity-project" && pwd)"
results_dir="$script_dir/../artifacts/unity-tests"
mkdir -p "$results_dir"

"$UNITY_EDITOR" \
  -batchmode \
  -nographics \
  -projectPath "$project_dir" \
  -runTests \
  -testPlatform EditMode \
  -testResults "$results_dir/editmode-results.xml" \
  -logFile "$results_dir/unity-editor.log"

echo "Unity EditMode results: $results_dir/editmode-results.xml"

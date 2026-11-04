#!/usr/bin/env bash
# Unity images need room for both downloaded layers and extraction. These SDKs
# are unused by this disposable, Linux container-only Unity job.
set -euo pipefail

if [[ "${GITHUB_ACTIONS:-}" != true || "${RUNNER_ENVIRONMENT:-}" != github-hosted || "${RUNNER_OS:-}" != Linux ]]; then
  echo 'Unity disk preparation requires a disposable GitHub-hosted Linux runner.' >&2
  exit 2
fi

docker_root="$(docker info --format '{{.DockerRootDir}}')"
if [[ "$docker_root" != /* ]]; then
  echo 'Docker storage location is unavailable; Unity has not been started.' >&2
  exit 2
fi
echo 'Docker storage before removing unused hosted SDKs:'
df -h "$docker_root"
sudo rm -rf -- /usr/share/dotnet /usr/local/lib/android /opt/ghc \
  /usr/share/swift /opt/microsoft/powershell/7 /opt/hostedtoolcache/CodeQL /opt/az

# Retain capacity evidence even when the prerequisite below blocks Unity.
echo 'Docker storage after preparation:'
df -h "$docker_root"

available_kib="$(df -Pk "$docker_root" | awk 'NR == 2 { print $4 }')"
minimum_kib=$((30 * 1024 * 1024))
printf 'Docker available capacity: %s KiB (minimum %s KiB).\n' "$available_kib" "$minimum_kib"
if [[ ! "$available_kib" =~ ^[0-9]+$ ]] || (( available_kib < minimum_kib )); then
  echo 'Less than 30 GiB is available for Unity image extraction and clone import; Editor tests are NOT RUN.' >&2
  exit 2
fi

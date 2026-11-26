#!/usr/bin/env bash
# Extracted from .github/workflows/android-release.yml (stage step 9: Download and inject pinned sponsor runtime content).
# Behavior is preserved; edit this script, not the workflow YAML.
set -euo pipefail
pin="$GITHUB_WORKSPACE/deploy/sponsor/content.json"
if [ ! -f "$pin" ]; then
  echo "state=absent" >> "$GITHUB_OUTPUT"
  echo "bundle=" >> "$GITHUB_OUTPUT"
  echo "no sponsor content pin: building the APK without sponsor runtime content"
  exit 0
fi
eval "$(python3 - "$pin" <<'PY'
import json, shlex, sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
artifact = data.get("artifact") or {}
repo = data.get("repo", "")
release = artifact.get("release", "")
asset = artifact.get("asset", "")
sha = artifact.get("sha256", "")
if not (repo and release and asset and len(sha) == 64):
    raise SystemExit("deploy/sponsor/content.json has incomplete artifact metadata")
base = repo if repo.startswith("http") else "https://github.com/" + repo
values = {
    "SPONSOR_URL": f"{base}/releases/download/{release}/{asset}",
    "SPONSOR_ASSET": asset,
    "SPONSOR_SHA": sha,
}
for key, value in values.items():
    print(f"{key}={shlex.quote(value)}")
PY
)"
bundle="$RUNNER_TEMP/$SPONSOR_ASSET"
curl --fail --silent --show-error --location --retry 3 "$SPONSOR_URL" -o "$bundle"
printf '%s  %s\n' "$SPONSOR_SHA" "$bundle" | sha256sum -c --quiet
state="$(SPONSOR_BUNDLE="$bundle" bash "$GITHUB_WORKSPACE/scripts/ci/inject-sponsor-runtime-content.sh")"
case "$state" in
  sponsorRuntimeContent=injected) ;;
  *) echo "::error::unexpected sponsor injection result: $state" >&2; exit 1 ;;
esac
{
  echo "state=injected"
  echo "bundle=$bundle"
} >> "$GITHUB_OUTPUT"

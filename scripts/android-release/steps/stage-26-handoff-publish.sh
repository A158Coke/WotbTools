#!/usr/bin/env bash
# Extracted from .github/workflows/android-release.yml (stage step 45: Hand off to the guarded publish phase).
# Behavior is preserved; edit this script, not the workflow YAML.
{
  echo "### stage complete — production version.json untouched"
  echo ""
  echo "Android Auto Publish continues this candidate automatically: after this run succeeds it"
  echo "dispatches \`mode=publish\`, \`version=$STEP_VERSION_VERSIONNAME\` and"
  echo "\`auto_publish=true\`. The publish phase re-checks the staged identity, runtime readiness and"
  echo "minSupported/bridge guards before writing version.json as its last step."
  echo ""
  echo "Physical-device testing is still valuable, but it is no longer an approval gate before"
  echo "version.json: run the production smoke / regression matrix after the rollout and fix any"
  echo "finding with a higher version. Manual workflow_dispatch(mode=publish, version=X) remains the"
  echo "recovery/rerun path."
} >> "$GITHUB_STEP_SUMMARY"

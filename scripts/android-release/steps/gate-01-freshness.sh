#!/usr/bin/env bash
set -euo pipefail
SUPERSEDED=false
STATE=manual
MAIN_VERSION=""
if [ "$AUTO_PUBLISH" = "true" ]; then
  . scripts/android-release/check-release-guards.sh
  git show HEAD:android/gradle.properties > "$RUNNER_TEMP/main-gradle.properties"
  classify_candidate_freshness "$REQUESTED_VERSION" "$RUNNER_TEMP/main-gradle.properties"
  STATE="$CANDIDATE_STATE"
  MAIN_VERSION="$MAIN_CANDIDATE_VERSION"
  case "$CANDIDATE_STATE" in
    candidate_latest)
      echo "Automatic publish $REQUESTED_VERSION is still the latest Android candidate (main committed version: $MAIN_CANDIDATE_VERSION)."
      ;;
    candidate_superseded)
      SUPERSEDED=true
      echo "::notice::Skipping automatic publish $REQUESTED_VERSION: main already commits the newer Android candidate $MAIN_CANDIDATE_VERSION. The staged candidate stays immutable and manually recoverable."
      ;;
    *)
      echo "::error::Unclassified candidate freshness state: '$CANDIDATE_STATE'" >&2
      exit 1
      ;;
  esac
else
  echo "Manual publish: the automatic latest-candidate policy does not apply; the existing publish guards decide."
fi
echo "superseded=$SUPERSEDED" >> "$GITHUB_OUTPUT"
{
  echo "# Android publish gate"
  echo ""
  echo "Requested version: $REQUESTED_VERSION"
  echo "Entry: $([ "$AUTO_PUBLISH" = "true" ] && echo automatic || echo manual)"
  echo "Main committed version: ${MAIN_VERSION:-n/a}"
  echo "Candidate state: $STATE"
  echo "Automatic publish superseded: $SUPERSEDED"
  if [ "$SUPERSEDED" = "true" ]; then
    echo ""
    echo "No publish step ran: the newer Android candidate owns the automatic release path."
    echo "The immutable staged version (tag / APK / staging evidence) is untouched and can still be"
    echo "published through workflow_dispatch(mode=publish, version=X) as a recovery action."
  fi
} >> "$GITHUB_STEP_SUMMARY"

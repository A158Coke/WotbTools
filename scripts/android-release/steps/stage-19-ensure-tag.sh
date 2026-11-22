#!/usr/bin/env bash
# Extracted from .github/workflows/android-release.yml (stage step 26: Ensure release tag (idempotent)).
# Behavior is preserved; edit this script, not the workflow YAML.
set -euo pipefail
. scripts/android-release/check-release-guards.sh
TAG="$STEP_VERSION_TAGNAME"
COMMIT_SHA="$STEP_VERSION_COMMIT"
REFS="$(git ls-remote --tags origin "refs/tags/$TAG")"
classify_tag "$REFS" "$TAG" "$COMMIT_SHA"
case "$TAG_STATE" in
  tag_absent)
    git config user.name "github-actions[bot]"
    git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
    git tag "$TAG" "$COMMIT_SHA"
    git push origin "$TAG"
    echo "Created and pushed release tag: $TAG -> $COMMIT_SHA"
    ;;
  tag_equal)
    echo "Release tag already points to this commit; resuming: $TAG -> $COMMIT_SHA"
    ;;
  tag_conflict)
    echo "::error::Release tag $TAG points to a different commit; refusing to repoint." >&2
    exit 1
    ;;
esac

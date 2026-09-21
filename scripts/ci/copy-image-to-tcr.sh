#!/usr/bin/env bash
set -euo pipefail

readonly COPY_TIMEOUT_SECONDS="${COPY_TIMEOUT_SECONDS:-600}"
readonly COPY_KILL_AFTER_SECONDS="${COPY_KILL_AFTER_SECONDS:-30}"
readonly GHCR_PREFIX="${GHCR_IMAGE_PREFIX:-}"
readonly TCR_PREFIX="${TCR_IMAGE_PREFIX:-}"
replication_started_at=""
replication_started_epoch=""

fail() {
  if [ -n "$replication_started_epoch" ]; then
    local replication_ended_at
    local replication_ended_epoch
    replication_ended_at="$(timestamp)"
    replication_ended_epoch="$(date -u +%s)"
    echo "[$replication_ended_at] component=${component:-unknown} stage=replication-end result=FAIL started_at=$replication_started_at ended_at=$replication_ended_at elapsed_seconds=$((replication_ended_epoch - replication_started_epoch))" >&2
  fi
  echo "::error::$*" >&2
  exit 1
}

usage() {
  echo "usage: $0 <backend|frontend|keycloak> <sha-12> [--update-latest]" >&2
  exit 2
}

timestamp() {
  date -u +%Y-%m-%dT%H:%M:%SZ
}

[ "$#" -ge 2 ] && [ "$#" -le 3 ] || usage
component="$1"
image_tag="$2"
update_latest="${3:-}"

case "$component" in
  backend|frontend|keycloak) ;;
  *) fail "unsupported TX image component: $component" ;;
esac
[[ "$image_tag" =~ ^sha-[0-9a-f]{12}$ ]] || fail "immutable image tag must be sha-<12 lowercase hex>"
[ -n "$GHCR_PREFIX" ] || fail "GHCR_IMAGE_PREFIX is required"
[ -n "$TCR_PREFIX" ] || fail "TCR_IMAGE_PREFIX is required"
[ "$GHCR_PREFIX" = "ghcr.io/a158coke/wotbtools" ] || fail "GHCR_IMAGE_PREFIX must be the WotBTools GHCR namespace"
[[ "$TCR_PREFIX" == ccr.ccs.tencentyun.com/* ]] || fail "TCR_IMAGE_PREFIX must be a Tencent TCR namespace"
[ "$COPY_TIMEOUT_SECONDS" -gt 0 ] 2>/dev/null || fail "COPY_TIMEOUT_SECONDS must be a positive integer"
[ "$COPY_KILL_AFTER_SECONDS" -gt 0 ] 2>/dev/null || fail "COPY_KILL_AFTER_SECONDS must be a positive integer"
[ -z "$update_latest" ] || [ "$update_latest" = "--update-latest" ] || usage

source_image="$GHCR_PREFIX-$component:$image_tag"
target_image="$TCR_PREFIX/wotbtools-$component:$image_tag"
replication_started_at="$(timestamp)"
replication_started_epoch="$(date -u +%s)"
echo "[$replication_started_at] component=$component stage=replication-start source=$source_image target=$target_image"

copy_image() {
  local stage="$1"
  local target="$2"
  echo "[$(timestamp)] component=$component stage=$stage source=$source_image target=$target attempt=1"
  timeout --kill-after="${COPY_KILL_AFTER_SECONDS}s" "${COPY_TIMEOUT_SECONDS}s" crane copy "$source_image" "$target" ||
    fail "TCR image copy failed or timed out for component=$component stage=$stage after ${COPY_TIMEOUT_SECONDS}s"
}

copy_image immutable "$target_image"
if [ "$update_latest" = "--update-latest" ]; then
  copy_image latest "$TCR_PREFIX/wotbtools-$component:latest"
fi

replication_ended_at="$(timestamp)"
replication_ended_epoch="$(date -u +%s)"
echo "[$replication_ended_at] component=$component stage=replication-end result=PASS started_at=$replication_started_at ended_at=$replication_ended_at elapsed_seconds=$((replication_ended_epoch - replication_started_epoch))"
replication_started_at=""
replication_started_epoch=""

echo "[$(timestamp)] component=$component stage=verify-immutable source=$source_image target=$target_image"
source_digest="$(crane digest "$source_image")" || fail "cannot resolve GHCR immutable digest for component=$component"
target_digest="$(crane digest "$target_image")" || fail "cannot resolve Tencent TCR immutable digest for component=$component"
[ "$source_digest" = "$target_digest" ] ||
  fail "immutable image digests differ between GHCR and Tencent TCR for component=$component"
echo "[$(timestamp)] component=$component stage=verify-immutable result=PASS digest=$source_digest"

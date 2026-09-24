#!/usr/bin/env bash
# Explicit Yecao MinIO runtime reconcile. OpenTofu topology belongs to Tofu Apply.
set -Eeuo pipefail

ROOT="${1:-}"
WOTB_DIR="${WOTB_DIR:-/opt/wotb}"
COMPOSE_FILE="$ROOT/deploy/docker-compose.minio.yml"
METADATA_TOOL="$ROOT/deploy/release-metadata.py"
METADATA_FILE="$WOTB_DIR/production-release.json"
CONFIG_SHA="${WOTB_DEPLOY_CONFIG_SHA:-}"
IMAGE_TAG="${WOTB_DEPLOY_IMAGE_TAG:-}"
IMAGE_COMMIT_SHA="${WOTB_DEPLOY_IMAGE_COMMIT_SHA:-}"
IMAGE_DIGEST="${WOTB_DEPLOY_IMAGE_DIGEST:-}"
DEFER_RELEASE_METADATA="${WOTB_DEPLOY_DEFER_METADATA:-0}"

die() { echo "ERROR: $*" >&2; exit 1; }
require_env() { [ -n "${!1:-}" ] || die "$1 is required."; }

[ -n "$ROOT" ] && [ "$ROOT" != / ] && [ "$ROOT" != . ] || die "safe staged root is required."
[ "${WOTB_DEPLOY_SERVICE:-}" = minio ] || die "MinIO deploy requires WOTB_DEPLOY_SERVICE=minio."
case "$DEFER_RELEASE_METADATA" in
  0|1) ;;
  *) die "WOTB_DEPLOY_DEFER_METADATA must be 0 or 1." ;;
esac
[[ "$CONFIG_SHA" =~ ^[0-9a-f]{40}$ ]] || die "WOTB_DEPLOY_CONFIG_SHA must be a full lowercase commit SHA."
if [ -n "$IMAGE_TAG" ] || [ -n "$IMAGE_COMMIT_SHA" ] || [ -n "$IMAGE_DIGEST" ]; then
  [ -n "$IMAGE_TAG" ] && [ -n "$IMAGE_COMMIT_SHA" ] && [ -n "$IMAGE_DIGEST" ] \
    || die "image tag, source SHA, and registry digest must be supplied together."
  [[ "$IMAGE_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] \
    || die "WOTB_DEPLOY_IMAGE_DIGEST must be a sha256 digest."
fi
require_env YECAO_MINIO_ROOT_USER
require_env YECAO_MINIO_ROOT_PASSWORD
[ -f "$COMPOSE_FILE" ] || die "MinIO compose file is missing."
[ -f "$METADATA_TOOL" ] || die "staged release metadata validator is missing."
command -v docker >/dev/null 2>&1 || die "docker is required."
command -v flock >/dev/null 2>&1 || die "flock is required."
command -v python3 >/dev/null 2>&1 || die "python3 is required."

mkdir -p "$WOTB_DIR"
if [ -n "${WOTB_DEPLOY_LOCK_FD:-}" ]; then
  [ "$WOTB_DEPLOY_LOCK_FD" = 9 ] || die "unsupported inherited deployment lock descriptor."
  { true >&9; } 2>/dev/null || die "inherited deployment lock descriptor is unavailable."
  flock -n 9 || die "another Yecao deployment is already running."
else
  exec 9>"$WOTB_DIR/.deploy.lock"
  flock -n 9 || die "another Yecao deployment is already running."
fi

metadata_args=(validate --host yecao --file "$METADATA_FILE")
if [ -n "$IMAGE_TAG" ]; then
  metadata_args+=(--service minio --image-tag "$IMAGE_TAG" --image-commit-sha "$IMAGE_COMMIT_SHA")
fi
python3 "$METADATA_TOOL" "${metadata_args[@]}" || die "production metadata or incoming image identity is invalid."

if [ -z "$IMAGE_TAG" ]; then
  IMAGE_TAG="$(python3 "$METADATA_TOOL" get --host yecao --file "$METADATA_FILE" --service minio --field tag)" \
    || die "MinIO config-only deployment lacks a recorded image identity."
fi
export TAG="${IMAGE_TAG##*:}"
if [ -n "$IMAGE_DIGEST" ]; then
  TAG="${TAG}@${IMAGE_DIGEST}"
  export TAG
fi
docker compose -f "$COMPOSE_FILE" config --quiet
docker compose -f "$COMPOSE_FILE" pull minio
docker compose -f "$COMPOSE_FILE" up -d --wait --no-deps minio \
  || die "MinIO failed readiness; production metadata was not advanced."

if [ "$DEFER_RELEASE_METADATA" = 0 ]; then
  update_args=(update --host yecao --file "$METADATA_FILE" --service minio --config-sha "$CONFIG_SHA")
  if [ -n "${WOTB_DEPLOY_IMAGE_TAG:-}" ]; then
    update_args+=(--image-tag "$IMAGE_TAG" --image-commit-sha "$IMAGE_COMMIT_SHA")
  fi
  python3 "$METADATA_TOOL" "${update_args[@]}"
else
  echo "MinIO release metadata update deferred until OpenTofu and final verification succeed."
fi
echo "MinIO runtime ready: config=$CONFIG_SHA image=$IMAGE_TAG"

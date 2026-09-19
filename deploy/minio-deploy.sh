#!/usr/bin/env bash
# Explicit, MinIO-only Yecao deployment. It shares the Deploy workflow but is
# intentionally isolated from application releases and their credentials.
set -Eeuo pipefail

readonly ROOT="${1:-}"
readonly COMPOSE_FILE="$ROOT/deploy/docker-compose.minio.yml"
readonly TOFU_ROOT="$ROOT/infra/tofu/minio"
readonly TOFU_CLI_CONFIG="$ROOT/deploy/minio/tofurc"
readonly TOFU_MIRROR="/opt/wotb/tofu-provider-mirror"

die() {
  echo "ERROR: $*" >&2
  exit 1
}

require_env() {
  local name="$1"
  [ -n "${!name:-}" ] || die "$name is required."
}

require_env TAG
require_env RELEASE_SHA
require_env RELEASE_RUN_NUMBER
require_env YECAO_MINIO_ROOT_USER
require_env YECAO_MINIO_ROOT_PASSWORD
require_env YECAO_MINIO_WORKER_ACCESS_KEY
require_env YECAO_MINIO_WORKER_SECRET_KEY

[[ "$TAG" =~ ^sha-[0-9a-f]{12}$ ]] || die "TAG must be an immutable sha-<12 lowercase hex> tag."
[[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]] || die "RELEASE_SHA must be a full lowercase commit SHA."
[[ "$RELEASE_RUN_NUMBER" =~ ^[1-9][0-9]*$ ]] || die "RELEASE_RUN_NUMBER must be a positive integer."
[ -f "$COMPOSE_FILE" ] || die "MinIO compose file is missing."
[ -d "$TOFU_ROOT" ] || die "MinIO OpenTofu root is missing."
[ -f "$TOFU_CLI_CONFIG" ] || die "MinIO OpenTofu CLI configuration is missing."
[ -d "$TOFU_MIRROR" ] || die "MinIO provider mirror is missing: $TOFU_MIRROR."
command -v docker >/dev/null 2>&1 || die "docker is required."
command -v tofu >/dev/null 2>&1 || die "tofu is required on Yecao."
command -v python3 >/dev/null 2>&1 || die "python3 is required on Yecao for plan safety validation."

# Do not inherit a permissive CLI config from the host environment.
export TF_CLI_CONFIG_FILE="$TOFU_CLI_CONFIG"
export TF_VAR_minio_server="10.20.0.2:9000"
export TF_VAR_minio_root_user="$YECAO_MINIO_ROOT_USER"
export TF_VAR_minio_root_password="$YECAO_MINIO_ROOT_PASSWORD"
export TF_VAR_worker_access_key="$YECAO_MINIO_WORKER_ACCESS_KEY"
export TF_VAR_worker_secret_key="$YECAO_MINIO_WORKER_SECRET_KEY"

# The provider stores the configured worker secret in state. Keep the state
# local to Yecao, root-only, and outside the staged checkout.
umask 077
install -d -m 700 /opt/wotb/minio-tofu-state

docker compose -f "$COMPOSE_FILE" config --quiet
docker compose -f "$COMPOSE_FILE" pull minio
docker compose -f "$COMPOSE_FILE" up -d --wait minio

(
  cd "$TOFU_ROOT"
  trap 'rm -f -- plan.tfplan second-plan.tfplan' EXIT
  tofu init -reconfigure -input=false -lockfile=readonly
  # A fresh OpenTofu workspace can report a provider as unavailable immediately
  # after its first successful init; the second idempotent init loads it reliably.
  tofu init -reconfigure -input=false -lockfile=readonly
  tofu validate
  tofu plan -input=false -no-color -out=plan.tfplan
  bash ./validate-plan.sh plan.tfplan
  tofu apply -input=false -auto-approve plan.tfplan
  tofu plan -input=false -no-color -out=second-plan.tfplan
  bash ./validate-plan.sh second-plan.tfplan --require-no-changes
)

echo "Yecao MinIO deployment, provisioning, and second-plan drift check passed."

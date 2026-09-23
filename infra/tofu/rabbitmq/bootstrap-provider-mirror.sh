#!/usr/bin/env bash
# Preserve the reviewed TX mirror checksum and atomic promotion contract.
set -Eeuo pipefail
readonly RABBITMQ_TOFU_ROOT="${1:-}"
readonly RABBITMQ_TOFU_MIRROR="/opt/wotb-tx/tofu-provider-mirror"
readonly RABBITMQ_PROVIDER_SOURCE="registry.opentofu.org/cyrilgdn/rabbitmq"
readonly RABBITMQ_PROVIDER_PLATFORM="linux_amd64"
[[ -d "$RABBITMQ_TOFU_ROOT" ]] || { echo 'RabbitMQ root is required.' >&2; exit 2; }
command -v tofu >/dev/null && command -v python3 >/dev/null

die() {
  echo "ERROR: $*" >&2
  exit 1
}
rabbitmq_provider_lock_metadata() {
  local lockfile="$RABBITMQ_TOFU_ROOT/.terraform.lock.hcl"
  [ -f "$lockfile" ] || die "TX RabbitMQ provider lockfile is missing: $lockfile."
  python3 - "$lockfile" "$RABBITMQ_PROVIDER_SOURCE" <<'PY'
import re
import sys
from pathlib import Path

lockfile = Path(sys.argv[1])
expected_source = sys.argv[2]
text = lockfile.read_text(encoding="utf-8")
blocks = re.findall(r'provider\s+"([^"]+)"\s*\{(.*?)^\}', text, flags=re.MULTILINE | re.DOTALL)
matching = [body for source, body in blocks if source == expected_source]
if len(matching) != 1:
    raise SystemExit(f"expected exactly one {expected_source} provider block in {lockfile}")

body = matching[0]
version_match = re.search(r'^\s*version\s*=\s*"([^"]+)"\s*$', body, flags=re.MULTILINE)
constraint_match = re.search(r'^\s*constraints\s*=\s*"([^"]+)"\s*$', body, flags=re.MULTILINE)
if not version_match or not constraint_match:
    raise SystemExit(f"provider version and constraints must both be present in {lockfile}")
version = version_match.group(1)
constraint = constraint_match.group(1)
if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", version):
    raise SystemExit(f"provider version must be an exact semantic version, got {version!r}")
if constraint != version:
    raise SystemExit(
        f"provider constraint {constraint!r} must exactly match locked version {version!r}"
    )
print(f"{expected_source}\t{version}")
PY
}

verify_rabbitmq_provider_archive() {
  local archive="$1"
  local mirror_metadata="$2"
  local provider_version="$3"
  local lockfile="$RABBITMQ_TOFU_ROOT/.terraform.lock.hcl"
  local expected_filename="terraform-provider-rabbitmq_${provider_version}_${RABBITMQ_PROVIDER_PLATFORM}.zip"

  python3 - "$lockfile" "$mirror_metadata" "$archive" "$RABBITMQ_PROVIDER_SOURCE" \
    "$RABBITMQ_PROVIDER_PLATFORM" "$expected_filename" <<'PY'
import hashlib
import json
import re
import sys
from pathlib import Path

lockfile = Path(sys.argv[1])
metadata_file = Path(sys.argv[2])
archive = Path(sys.argv[3])
expected_source = sys.argv[4]
platform = sys.argv[5]
expected_filename = sys.argv[6]

if not metadata_file.is_file():
    raise SystemExit(f"provider mirror metadata is missing: {metadata_file}")
if not archive.is_file():
    raise SystemExit(f"provider archive is missing: {archive}")

try:
    metadata = json.loads(metadata_file.read_text(encoding="utf-8"))
except (OSError, json.JSONDecodeError) as exc:
    raise SystemExit(f"provider mirror metadata is invalid: {exc}") from exc

platform_metadata = metadata.get("archives", {}).get(platform)
if not isinstance(platform_metadata, dict):
    raise SystemExit(f"provider mirror metadata has no {platform} archive")
if platform_metadata.get("url") != expected_filename:
    raise SystemExit(
        f"provider mirror metadata archive mismatch: expected {expected_filename!r}, "
        f"got {platform_metadata.get('url')!r}"
    )
platform_hashes = platform_metadata.get("hashes")
if not isinstance(platform_hashes, list):
    raise SystemExit("provider mirror metadata hashes must be a list")
platform_zh = [
    value.removeprefix("zh:").lower()
    for value in platform_hashes
    if isinstance(value, str) and re.fullmatch(r"zh:[0-9a-fA-F]{64}", value)
]
if len(platform_zh) != 1:
    raise SystemExit(f"expected exactly one {platform} zh checksum in provider mirror metadata")

lock_text = lockfile.read_text(encoding="utf-8")
blocks = re.findall(r'provider\s+"([^"]+)"\s*\{(.*?)^\}', lock_text, flags=re.MULTILINE | re.DOTALL)
matching = [body for source, body in blocks if source == expected_source]
if len(matching) != 1:
    raise SystemExit(f"expected exactly one {expected_source} provider block in {lockfile}")
locked_zh = {
    value.lower()
    for value in re.findall(r'"zh:([0-9a-fA-F]{64})"', matching[0])
}
expected_sha256 = platform_zh[0]
if expected_sha256 not in locked_zh:
    raise SystemExit(f"{platform} provider checksum is not present in {lockfile}")

digest = hashlib.sha256()
with archive.open("rb") as stream:
    for chunk in iter(lambda: stream.read(1024 * 1024), b""):
        digest.update(chunk)
actual_sha256 = digest.hexdigest()
if actual_sha256 != expected_sha256:
    raise SystemExit(
        f"provider archive checksum mismatch: expected {expected_sha256}, got {actual_sha256}"
    )
PY
}

stage_and_promote_rabbitmq_provider_mirror() {
  local provider_source="$1"
  local provider_version="$2"
  local provider_dir="$3"
  local staging_root

  install -d -m 755 "$RABBITMQ_TOFU_MIRROR" "$(dirname "$provider_dir")" || return 1
  staging_root="$(mktemp -d "$RABBITMQ_TOFU_MIRROR/.rabbitmq-provider-staging.XXXXXX")" \
    || return 1

  (
    local staging_provider_dir staged_archive staged_metadata backup_dir archive
    local cleanup_staging=1
    local -a staged_archives=()

    cleanup_rabbitmq_provider_staging() {
      if [ "$cleanup_staging" = 1 ]; then
        rm -rf -- "$staging_root"
      fi
    }
    trap cleanup_rabbitmq_provider_staging EXIT

    unset TF_CLI_CONFIG_FILE
    if ! tofu -chdir="$RABBITMQ_TOFU_ROOT" providers mirror \
      -platform="$RABBITMQ_PROVIDER_PLATFORM" "$staging_root"; then
      echo "TX RabbitMQ provider staging download failed." >&2
      exit 1
    fi

    staging_provider_dir="$staging_root/$provider_source"
    staged_archive="$staging_provider_dir/terraform-provider-rabbitmq_${provider_version}_${RABBITMQ_PROVIDER_PLATFORM}.zip"
    staged_metadata="$staging_provider_dir/${provider_version}.json"
    if [ -d "$staging_root/registry.opentofu.org" ]; then
      while IFS= read -r archive; do
        [ -n "$archive" ] && staged_archives+=("$archive")
      done < <(find "$staging_root/registry.opentofu.org" -type f \
        -name 'terraform-provider-*.zip' -print | sort)
    fi
    if [ "${#staged_archives[@]}" -ne 1 ] || [ "${staged_archives[0]:-}" != "$staged_archive" ]; then
      echo "TX RabbitMQ provider staging source/version mismatch: expected only $staged_archive." >&2
      exit 1
    fi
    if ! verify_rabbitmq_provider_archive \
      "$staged_archive" "$staged_metadata" "$provider_version"; then
      echo "TX RabbitMQ provider staging checksum validation failed." >&2
      exit 1
    fi

    # Both renames stay on the mirror filesystem. The old provider directory is
    # held inside staging until the verified replacement reaches its canonical
    # path, so a failed promotion can restore the original without touching any
    # PostgreSQL or Keycloak provider directory.
    backup_dir="$staging_root/canonical-backup"
    if [ -e "$provider_dir" ]; then
      if ! mv -- "$provider_dir" "$backup_dir"; then
        echo "TX RabbitMQ provider canonical directory could not be staged for replacement." >&2
        exit 1
      fi
    fi
    if ! mv -- "$staging_provider_dir" "$provider_dir"; then
      echo "TX RabbitMQ provider promotion failed." >&2
      if [ -e "$backup_dir" ] && ! mv -- "$backup_dir" "$provider_dir"; then
        cleanup_staging=0
        echo "TX RabbitMQ provider rollback failed; original directory remains at $backup_dir." >&2
      fi
      exit 1
    fi
  )
}

bootstrap_rabbitmq_provider_mirror() {
  local metadata provider_source provider_version provider_dir expected_archive mirror_metadata archive
  local repairing=0
  local -a installed_archives=()

  metadata="$(rabbitmq_provider_lock_metadata)" \
    || die "TX RabbitMQ provider metadata could not be derived from the lockfile."
  IFS=$'\t' read -r provider_source provider_version <<< "$metadata"
  [ "$provider_source" = "$RABBITMQ_PROVIDER_SOURCE" ] \
    || die "TX RabbitMQ provider source does not match the production mirror contract."
  [ -n "$provider_version" ] || die "TX RabbitMQ provider version is empty."

  provider_dir="$RABBITMQ_TOFU_MIRROR/$provider_source"
  expected_archive="$provider_dir/terraform-provider-rabbitmq_${provider_version}_${RABBITMQ_PROVIDER_PLATFORM}.zip"
  mirror_metadata="$provider_dir/${provider_version}.json"
  if [ -L "$provider_dir" ] || { [ -e "$provider_dir" ] && [ ! -d "$provider_dir" ]; }; then
    die "TX RabbitMQ provider mirror has an unsupported canonical path: $provider_dir."
  fi
  if [ -d "$provider_dir" ]; then
    while IFS= read -r archive; do
      [ -n "$archive" ] && installed_archives+=("$archive")
    done < <(find "$provider_dir" -maxdepth 1 -type f \
      -name "terraform-provider-rabbitmq_*_${RABBITMQ_PROVIDER_PLATFORM}.zip" -print | sort)
  fi

  if [ "${#installed_archives[@]}" -gt 0 ]; then
    [ "${#installed_archives[@]}" -eq 1 ] && [ "${installed_archives[0]}" = "$expected_archive" ] \
      || die "TX RabbitMQ provider mirror version mismatch: expected only $expected_archive."
    if verify_rabbitmq_provider_archive "$expected_archive" "$mirror_metadata" "$provider_version"; then
      echo "RabbitMQ provider mirror already contains $provider_source $provider_version ($RABBITMQ_PROVIDER_PLATFORM); reusing it."
      return
    fi
    echo "RabbitMQ provider mirror contains an invalid $provider_source $provider_version ($RABBITMQ_PROVIDER_PLATFORM); attempting staged repair."
    repairing=1
  elif [ -d "$provider_dir" ]; then
    echo "RabbitMQ provider mirror contains incomplete $provider_source state; attempting staged repair."
    repairing=1
  fi

  stage_and_promote_rabbitmq_provider_mirror \
    "$provider_source" "$provider_version" "$provider_dir" \
    || die "TX RabbitMQ provider staged bootstrap failed for $provider_source $provider_version ($RABBITMQ_PROVIDER_PLATFORM)."
  if [ "$repairing" = 1 ]; then
    echo "RabbitMQ provider mirror repaired $provider_source $provider_version ($RABBITMQ_PROVIDER_PLATFORM)."
  else
    echo "RabbitMQ provider mirror installed $provider_source $provider_version ($RABBITMQ_PROVIDER_PLATFORM)."
  fi
}


bootstrap_rabbitmq_provider_mirror

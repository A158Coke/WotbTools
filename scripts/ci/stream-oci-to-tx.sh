#!/usr/bin/env bash
# Stream a BuildKit OCI archive directly to TX and import its deterministic tag.
set -euo pipefail

if [ "$#" -ne 1 ]; then
  printf 'usage: %s <archive>\n' "$0" >&2
  exit 2
fi

archive="$1"
[ -s "$archive" ] || { printf 'ERROR: OCI archive is missing or empty\n' >&2; exit 2; }
[ -n "${TX_SSH_DIR:-}" ] && [ -f "$TX_SSH_DIR/config" ] || {
  printf 'ERROR: native TX SSH configuration is missing\n' >&2
  exit 2
}

# Import is intentionally the only retryable operation; publication is a
# separate, exactly-once SSH command in the workflow.
gzip -c -- "$archive" | timeout --kill-after=30s 1200s \
  ssh -F "$TX_SSH_DIR/config" tx-image-publication \
    "mkdir -p /opt/wotb-tx/replication.incoming && flock -w 900 /opt/wotb-tx/replication.incoming/oci-import.lock bash -o pipefail -c 'gzip -d | docker load'"

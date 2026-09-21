#!/usr/bin/env bash
# Stream a BuildKit OCI archive directly to TX, then publish its loaded tag.
set -euo pipefail

if [ "$#" -ne 4 ]; then
  printf 'usage: %s <archive> <backend|frontend|keycloak> <sha-12> <sha256:digest>\n' "$0" >&2
  exit 2
fi

archive="$1"
component="$2"
image_tag="$3"
expected_digest="$4"

case "$component" in
  backend|frontend|keycloak) ;;
  *) printf 'ERROR: unsupported TX image component\n' >&2; exit 2 ;;
esac
[[ "$image_tag" =~ ^sha-[0-9a-f]{12}$ ]] || { printf 'ERROR: immutable image tag is invalid\n' >&2; exit 2; }
[[ "$expected_digest" =~ ^sha256:[0-9a-f]{64}$ ]] || { printf 'ERROR: expected digest is invalid\n' >&2; exit 2; }
[ -s "$archive" ] || { printf 'ERROR: OCI archive is missing or empty\n' >&2; exit 2; }
[ -n "${TX_SSH_DIR:-}" ] && [ -f "$TX_SSH_DIR/config" ] || {
  printf 'ERROR: native TX SSH configuration is missing\n' >&2
  exit 2
}

readonly remote_helper='/opt/wotb-tx/replication.incoming/publish-loaded-image-to-tcr.sh'
# This covers the 30-minute TX lock wait plus two bounded 10-minute TCR pushes.
gzip -c -- "$archive" | timeout --kill-after=30s 3300s \
  ssh -F "$TX_SSH_DIR/config" tx-image-publication \
    "mkdir -p /opt/wotb-tx/replication.incoming && flock -w 1800 /opt/wotb-tx/replication.incoming/tcr-publication.lock bash -o pipefail -c 'gzip -d | docker load && exec bash \"\$0\" \"\$@\"' '$remote_helper' '$component' '$image_tag' '$expected_digest'"

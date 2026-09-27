#!/usr/bin/env bash
# Validate the staged TX Caddy configuration with the real runtime image before
# the live gateway is touched. The compose service definition is used so the
# validated file is exactly the one Compose will mount.
set -euo pipefail

INCOMING_DIR="${1:?usage: validate-caddy-config.sh <staged-tx-directory>}"
for required in Caddyfile common.compose.yml caddy.compose.yml; do
  [ -f "$INCOMING_DIR/$required" ] \
    || { echo "ERROR: staged Caddy input is missing: $INCOMING_DIR/$required" >&2; exit 1; }
done

# The published Caddy image declares no ENTRYPOINT, so `--entrypoint caddy` is
# what turns the `validate ...` argument list into a real executable; it also
# keeps this command correct if a future image starts declaring
# `ENTRYPOINT ["caddy"]` (which would make a plain `caddy validate ...` argument
# list run `caddy caddy`).
docker compose -p deploy \
  -f "$INCOMING_DIR/common.compose.yml" -f "$INCOMING_DIR/caddy.compose.yml" \
  run --rm --no-deps --entrypoint caddy caddy \
  validate --config /etc/caddy/Caddyfile --adapter caddyfile

echo "Caddy staged configuration OK: $INCOMING_DIR"

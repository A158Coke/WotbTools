#!/usr/bin/env bash
# Validate the production Alloy config before a staged deployment is promoted.
set -euo pipefail

CONFIG_FILE="${1:?usage: validate-alloy-config.sh <config.alloy>}"
if [ ! -f "$CONFIG_FILE" ]; then
  echo "ERROR: Alloy config is missing: $CONFIG_FILE" >&2
  exit 1
fi

# Loki's match selector has its own LogQL string parser.  A backslash-escaped
# dot is rejected there, even though the same spelling is valid in the later
# regex stage.  Keep the selector's dot as a character class and reject the
# production failure spelling explicitly.
required_selector='selector            = "{container_name=\"wotb-frontend\"} !~ \"GET /download/android/[^ ]+[.]apk\""'
legacy_selector='GET /download/android/[^ ]+\\.apk'

if ! grep -Fq "$required_selector" "$CONFIG_FILE"; then
  echo "ERROR: Alloy Android download selector must use the LogQL-safe [.] form." >&2
  exit 1
fi
if grep -Fq "$legacy_selector" "$CONFIG_FILE"; then
  echo "ERROR: Alloy Android download selector contains the invalid \\. escape." >&2
  exit 1
fi

docker run --rm --entrypoint alloy \
  -v "$CONFIG_FILE:/etc/alloy/config.alloy:ro" \
  grafana/alloy:v1.4.2 fmt -t /etc/alloy/config.alloy >/dev/null

echo "Alloy config contract and format OK: $CONFIG_FILE"

#!/bin/sh
# Shared Alpine/BusyBox-compatible Grafana API request path.
# The caller passes only an API path; this script owns the hostname prefix.
set -eu

path="${1:?Grafana API path is required}"
case "$path" in
  /*) ;;
  *) echo "Grafana API path must start with /" >&2; exit 2 ;;
esac

token="$(printf '%s:%s' "$GRAFANA_VERIFY_USER" "$GRAFANA_VERIFY_PASSWORD" | base64 | tr -d '\r\n')"
url="http://grafana:3000${path}"
if [ -n "${GRAFANA_API_TRACE_FILE:-}" ]; then
  printf '%s\n' "$url" > "$GRAFANA_API_TRACE_FILE"
fi
wget --header="Authorization: Basic $token" -qO- "$url"

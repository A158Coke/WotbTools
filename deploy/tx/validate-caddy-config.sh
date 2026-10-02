#!/usr/bin/env bash
# Validate the staged TX Caddy configuration with the real runtime image before
# the live gateway is touched. The compose service definition is used so the
# validated file is exactly the one Compose will mount.
#
# First it asserts the public site inventory. Caddy is the only owner of public
# ingress, so a missing site or a wrong upstream is a production incident that
# must fail here - before the gateway is reloaded - instead of only showing up as
# a broken route afterwards. This is an independent statement of intent, not a
# restatement of whatever the Caddyfile happens to contain.
set -euo pipefail

INCOMING_DIR="${1:?usage: validate-caddy-config.sh <staged-tx-directory>}"
for required in Caddyfile common.compose.yml caddy.compose.yml; do
  [ -f "$INCOMING_DIR/$required" ] \
    || { echo "ERROR: staged Caddy input is missing: $INCOMING_DIR/$required" >&2; exit 1; }
done
CADDYFILE="$INCOMING_DIR/Caddyfile"

# site_block <host>: the body of the `<host> { ... }` site, honouring nested
# blocks. Matching is literal (`index(...) == 1`), so no regex escaping is needed.
site_block() {
  awk -v host="$1" '
    !inside && index($0, host " {") == 1 { inside = 1 }
    inside {
      depth += gsub(/\{/, "{")
      depth -= gsub(/\}/, "}")
      print
      if (depth <= 0) exit
    }
  ' "$CADDYFILE"
}

assert_upstream() {
  local host="$1" expected="$2" actual
  actual="$(site_block "$host" \
    | sed -n 's/^[[:space:]]*reverse_proxy[[:space:]]\{1,\}\([^[:space:]]*\).*$/\1/p' \
    | head -n1)"
  [ "$actual" = "$expected" ] || {
    echo "ERROR: Caddy site $host must reverse_proxy $expected (found: ${actual:-<none>})." >&2
    exit 1
  }
}

# Every public host this gateway owns. Yecao upstreams are always the WireGuard
# address 10.20.0.2; a public Yecao address here would bypass the private
# boundary that ai-service, Grafana, and Komodo Core rely on.
assert_upstream wotbtools.com wotb-frontend:80
assert_upstream auth.wotbtools.com keycloak:8080
assert_upstream monitor.wotbtools.com 10.20.0.2:3000
assert_upstream komodo.wotbtools.com 10.20.0.2:9120

site_block www.wotbtools.com \
  | grep -qE '^[[:space:]]*redir[[:space:]]+https://wotbtools\.com\{uri\}[[:space:]]+permanent[[:space:]]*$' \
  || { echo 'ERROR: www.wotbtools.com must permanently redirect to https://wotbtools.com.' >&2; exit 1; }

# The TX-local readiness surface the runtime check drives must survive.
site_block 'http://caddy' | grep -q 'handle /_wotb/ready' \
  || { echo 'ERROR: the TX-local /_wotb/ready readiness surface is missing.' >&2; exit 1; }

# No upstream may exist beyond the reviewed set above.
unexpected="$(sed -n 's/^[[:space:]]*reverse_proxy[[:space:]]\{1,\}\([^[:space:]]*\).*$/\1/p' "$CADDYFILE" \
  | grep -vxE 'wotb-frontend:80|keycloak:8080|10\.20\.0\.2:3000|10\.20\.0\.2:9120' || true)"
[ -z "$unexpected" ] || {
  echo "ERROR: unreviewed Caddy upstream(s): $(tr '\n' ' ' <<<"$unexpected")" >&2
  exit 1
}

# Yecao is reachable only over WireGuard, so its public address must never appear.
if grep -q '45\.136\.14\.101' "$CADDYFILE"; then
  echo 'ERROR: the Caddyfile references the Yecao public address; Yecao upstreams must use 10.20.0.2.' >&2
  exit 1
fi

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

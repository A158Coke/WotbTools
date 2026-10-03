#!/usr/bin/env bash
# Fixtures for the TX Caddy public-site inventory guard.
#
# The guard lives in `deploy/tx/validate-caddy-config.sh` and runs in two places:
# PR CI (`ci-caddy.yml`) and production staging (`deploy/tx/deploy.sh`, through
# `deploy/tx/validate-caddy-config.sh`). Every rejected case must fail *before*
# the runtime validation is reached - that ordering is asserted through the stub
# log below, not assumed.
#
# Docker is stubbed so that ordering is observable, but the stub **delegates** the
# invocation to the real docker binary: the guard's final assertions run against
# the JSON Caddy actually adapts the staged file to. A stub that answered with a
# canned or empty document would either hide a real adapted-shape regression or
# reject a valid configuration for the wrong reason (which is exactly what an
# empty adaptation did before). Docker is therefore required here, as it already
# is for the other TX runtime fixtures and for the production caller.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

real_docker="$(command -v docker || true)"
[ -n "$real_docker" ] || {
  echo 'docker is required: the adapted-config assertions are verified against the real Caddy image.' >&2
  exit 1
}
# The Caddyfile takes its ACME account address from the environment; production and
# the PR fixture both set it. Keep the same default so the adaptation under test is
# decided by the staged Caddyfile, not by a missing variable.
: "${CADDY_ACME_EMAIL:=ci@example.invalid}"
export CADDY_ACME_EMAIL

stub_log="$work/docker.log"
mkdir -p "$work/bin"
cat > "$work/bin/docker" <<STUB
#!/usr/bin/env bash
printf '%s\n' "\$*" >> "\${STUB_DOCKER_LOG:?}"
exec "$real_docker" "\$@"
STUB
chmod +x "$work/bin/docker"

# staged <name> -> a disposable staged TX directory with the real compose files
# and the mounted domain-association asset, mirroring the production staging tree.
staged() {
  local dir="$work/$1"
  mkdir -p "$dir/assets/auth/.well-known"
  cp "$ROOT/deploy/tx/common.compose.yml" "$ROOT/deploy/tx/caddy.compose.yml" "$dir/"
  cp "$ROOT/deploy/tx/assets/auth/.well-known/assetlinks.json" "$dir/assets/auth/.well-known/"
  printf '%s\n' "$dir"
}

# caddyfile <name> -> staged dir with a copy of the repository Caddyfile
caddyfile() {
  local dir
  dir="$(staged "$1")"
  cp "$ROOT/deploy/tx/Caddyfile" "$dir/Caddyfile"
  printf '%s\n' "$dir"
}

guard() {
  rm -f "$stub_log"
  PATH="$work/bin:$PATH" STUB_DOCKER_LOG="$stub_log" \
    bash "$ROOT/deploy/tx/validate-caddy-config.sh" "$1" >"$work/out.log" 2>&1
}

accepts() {
  local label="$1" dir="$2"
  guard "$dir" || {
    echo "valid Caddy inventory was rejected: $label" >&2
    cat "$work/out.log" >&2
    exit 1
  }
  [ -s "$stub_log" ] || { echo "runtime validation was skipped for: $label" >&2; exit 1; }
}

rejects() {
  local label="$1" dir="$2" expected="$3"
  if guard "$dir"; then
    echo "invalid Caddy inventory was accepted: $label" >&2
    exit 1
  fi
  [ ! -s "$stub_log" ] || {
    echo "runtime validation ran despite an invalid inventory: $label" >&2
    exit 1
  }
  grep -q -- "$expected" "$work/out.log" || {
    echo "rejected for the wrong reason: $label (expected to see: $expected)" >&2
    cat "$work/out.log" >&2
    exit 1
  }
}

# The repository Caddyfile itself must satisfy the inventory, including the
# Komodo public ingress added for K2.
accepts 'repository Caddyfile' "$(caddyfile repository)"

# --- komodo.wotbtools.com is mandatory and must target the WireGuard address ---
missing="$(caddyfile komodo-missing)"
awk '/^komodo\.wotbtools\.com \{/ { skip = 1 }
     skip && /^\}/ { skip = 0; next }
     skip { next }
     { print }' "$ROOT/deploy/tx/Caddyfile" > "$missing/Caddyfile"
rejects 'komodo site removed' "$missing" 'komodo.wotbtools.com must reverse_proxy 10.20.0.2:9120'

wrong_port="$(caddyfile komodo-wrong-port)"
sed -i 's|reverse_proxy 10\.20\.0\.2:9120|reverse_proxy 10.20.0.2:9999|' "$wrong_port/Caddyfile"
rejects 'komodo upstream on the wrong port' "$wrong_port" 'komodo.wotbtools.com must reverse_proxy 10.20.0.2:9120'

public_yecao="$(caddyfile komodo-public-yecao)"
sed -i 's|^\(\t*\)reverse_proxy 10\.20\.0\.2:9120$|\1reverse_proxy 10.20.0.2:9120 {\n\1\theader_up Host 45.136.14.101\n\1}|' \
  "$public_yecao/Caddyfile"
rejects 'Yecao public address in the Caddyfile' "$public_yecao" 'Yecao public address'

# --- the pre-existing routes must survive ------------------------------------
monitor_drift="$(caddyfile monitor-drift)"
sed -i 's|reverse_proxy 10\.20\.0\.2:3000|reverse_proxy 10.20.0.2:3001|' "$monitor_drift/Caddyfile"
rejects 'monitor upstream drift' "$monitor_drift" 'monitor.wotbtools.com must reverse_proxy 10.20.0.2:3000'

www_drift="$(caddyfile www-drift)"
sed -i 's| permanent| temporary|' "$www_drift/Caddyfile"
rejects 'www canonical redirect drift' "$www_drift" 'www.wotbtools.com must permanently redirect'

readiness_missing="$(caddyfile readiness-missing)"
sed -i 's|handle /_wotb/ready|handle /_wotb/health|' "$readiness_missing/Caddyfile"
rejects 'TX-local readiness surface removed' "$readiness_missing" '/_wotb/ready readiness surface is missing'

# --- the Android App Link callback must exist, answer, and stay reachable -----
# A browser that returns to the HTTPS redirect URI without the app installed must
# land on the WotBTools-owned page instead of Keycloak's catch-all 404. Every case
# below is decided by the inventory guard, before the runtime validation runs.
callback_missing="$(caddyfile android-callback-missing)"
awk '/^\thandle \/android\/oauth\/callback \{/ { skip = 1 }
     skip && /^\t\}/ { skip = 0; next }
     skip { next }
     { print }' "$ROOT/deploy/tx/Caddyfile" > "$callback_missing/Caddyfile"
rejects 'android callback route removed' "$callback_missing" \
  'auth.wotbtools.com must declare handle /android/oauth/callback'

callback_proxied="$(caddyfile android-callback-proxied)"
# The route keeps a respond (so only the "answer from Caddy" rule can reject it)
# but also proxies the same path into Keycloak.
awk '/^\thandle \/android\/oauth\/callback \{/ { print; print "\t\treverse_proxy keycloak:8080"; next }
     { print }' "$ROOT/deploy/tx/Caddyfile" > "$callback_proxied/Caddyfile"
rejects 'android callback handed back to Keycloak' "$callback_proxied" \
  'must answer from Caddy, never reverse_proxy an upstream'

# The route is only an answer while it is the most specific match: once it no
# longer exists on that host, the guard must fail on it.
callback_removed_entirely="$(caddyfile android-callback-gone)"
awk '/^\thandle \/android\/oauth\/callback \{/ { skip = 1 }
     skip && /^\t\}$/ { skip = 0; next }
     skip { next }
     { print }' "$ROOT/deploy/tx/Caddyfile" > "$callback_removed_entirely/Caddyfile"
rejects 'android callback absent from the inventory' "$callback_removed_entirely" \
  'auth.wotbtools.com must declare handle /android/oauth/callback'

unreviewed="$(caddyfile unreviewed-upstream)"
printf '\n%sunreviewed.example.com {\n%sreverse_proxy example.invalid:1234\n%s}\n' \
  '' "$(printf '\t')" '' >> "$unreviewed/Caddyfile"
rejects 'unreviewed upstream added' "$unreviewed" 'unreviewed Caddy upstream'

echo 'Caddy public-site inventory fixtures: PASS'

#!/usr/bin/env bash
# Fixtures for the TX Caddy public-site inventory guard.
#
# The guard lives in `deploy/tx/validate-caddy-config.sh` and runs in two places:
# PR CI (`ci-caddy.yml`) and production staging (`deploy/tx/deploy.sh`, through
# `deploy/tx/validate-caddy-config.sh`). Docker is stubbed because these cases are
# about the inventory decision, and every rejected case must fail *before* the
# runtime validation is reached - that ordering is asserted, not assumed.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

stub_log="$work/docker.log"
mkdir -p "$work/bin"
cat > "$work/bin/docker" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${STUB_DOCKER_LOG:?}"
exit 0
STUB
chmod +x "$work/bin/docker"

# staged <name> -> a disposable staged TX directory with the real compose files.
staged() {
  local dir="$work/$1"
  mkdir -p "$dir"
  cp "$ROOT/deploy/tx/common.compose.yml" "$ROOT/deploy/tx/caddy.compose.yml" "$dir/"
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

unreviewed="$(caddyfile unreviewed-upstream)"
printf '\n%sunreviewed.example.com {\n%sreverse_proxy example.invalid:1234\n%s}\n' \
  '' "$(printf '\t')" '' >> "$unreviewed/Caddyfile"
rejects 'unreviewed upstream added' "$unreviewed" 'unreviewed Caddy upstream'

echo 'Caddy public-site inventory fixtures: PASS'

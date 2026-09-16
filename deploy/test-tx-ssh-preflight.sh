#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/deploy/tx/preflight.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

grep -Fq 'TX_PREFLIGHT_OK' "$SCRIPT"
grep -Fq 'TX_KC_POSTGRES_ADMIN_PASSWORD' "$ROOT/.github/workflows/tx-ssh-smoke.yml"
grep -Fq 'CADDY_ACME_EMAIL' "$ROOT/.github/workflows/tx-ssh-smoke.yml"
! grep -Fq 'tx-runtime.env' "$ROOT/.github/workflows/tx-ssh-smoke.yml"
! grep -Fq 'postgres-keycloak-tofu.env' "$ROOT/.github/workflows/tx-ssh-smoke.yml"
! grep -Eq 'echo .*TX_KC_|>.*TX_KC_|printf .*TX_KC_' "$ROOT/.github/workflows/tx-ssh-smoke.yml"

mkdir -p "$WORK/bin"
cat > "$WORK/bin/docker" <<'EOF'
#!/usr/bin/env bash
[ "${1:-}" = compose ] && [ "${2:-}" = version ]
EOF
cat > "$WORK/bin/tofu" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
cat > "$WORK/bin/ip" <<'EOF'
#!/usr/bin/env bash
case "${1:-}" in
  link) [ "${PREFLIGHT_WG_MISSING:-0}" != 1 ] ;;
  -4) [ "${PREFLIGHT_WG_MISSING:-0}" != 1 ] && printf '    inet 10.20.0.1/24\n' ;;
  route) [ "${PREFLIGHT_WG_MISSING:-0}" != 1 ] ;;
  *) exit 1 ;;
esac
EOF
cat > "$WORK/bin/timeout" <<'EOF'
#!/usr/bin/env bash
[ "${PREFLIGHT_BACKEND_UNREACHABLE:-0}" != 1 ]
EOF
chmod 700 "$WORK/bin"/*

run_preflight() {
  env -i PATH="$WORK/bin:$PATH" PREFLIGHT_WG_MISSING="${PREFLIGHT_WG_MISSING:-0}" \
    PREFLIGHT_BACKEND_UNREACHABLE="${PREFLIGHT_BACKEND_UNREACHABLE:-0}" \
    bash "$SCRIPT"
}

grep -Fq TX_PREFLIGHT_OK <<< "$(run_preflight)"
set +e
PREFLIGHT_WG_MISSING=1 run_preflight >/dev/null 2>&1
[ $? -ne 0 ]
PREFLIGHT_WG_MISSING=0 PREFLIGHT_BACKEND_UNREACHABLE=1 run_preflight >/dev/null 2>&1
[ $? -ne 0 ]
set -e

rm "$WORK/bin/tofu"
set +e
run_preflight >/dev/null 2>&1
[ $? -ne 0 ]
set -e

echo "TX SSH preflight contract OK"

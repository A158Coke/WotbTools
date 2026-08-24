#!/usr/bin/env bash
# Deploy/rollback smoke test (CI-safe, no production access).
#
# Simulates two deployments against a sandbox dir with a fake `docker` shim and
# asserts the original contract:
#   1. deploy A succeeds and the formal docker-compose.yml pins sha-A images;
#   2. deploy B starts and its health check fails;
#   3. rollback restores the previous (A) compose, not the failed B tag;
#   4. DEPLOYED_SHA is restored to A;
#   5. with the deploy env cleared, `docker compose config` and the daily backup
#      script still parse the formal deployment.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$WORK/deploy" "$WORK/bin"
cp "$ROOT/deploy/docker-compose.prod.yml" "$WORK/deploy/docker-compose.prod.yml"
cp "$ROOT/deploy/deploy.sh" "$WORK/deploy/deploy.sh"
cp "$ROOT/deploy/sponsor-config.example.json" "$WORK/deploy/sponsor-config.example.json"
cp "$ROOT/deploy/postgres-backup.sh" "$WORK/deploy/postgres-backup.sh"
cp "$ROOT/deploy/postgres-backup-inspect.sh" "$WORK/deploy/postgres-backup-inspect.sh"
cp "$ROOT/deploy/postgres-restore.sh" "$WORK/deploy/postgres-restore.sh"
# Normalize line endings so the sandbox runs identically on CRLF checkouts
# (CI/ubuntu checkouts are LF; this keeps the smoke test portable).
sed -i 's/\r$//' \
  "$WORK/deploy/docker-compose.prod.yml" \
  "$WORK/deploy/deploy.sh" \
  "$WORK/deploy/postgres-backup.sh" \
  "$WORK/deploy/postgres-backup-inspect.sh" \
  "$WORK/deploy/postgres-restore.sh" \
  "$WORK/deploy/sponsor-config.example.json"

cat > "$WORK/bin/docker" <<'FAKE_DOCKER'
#!/usr/bin/env bash
# Fake docker shim for the deploy rollback smoke test.
# - `compose config` resolves ${VAR} / ${VAR:?msg} / ${VAR:-default} from env,
#   mirroring what `docker compose config` does during the real deploy.
# - health checks (`compose exec ... wget`) succeed only when the active compose
#   file references the sha-A backend image, so deploy B fails and rolls back to A.
set -euo pipefail

resolve_line() {
  local line="$1" out expr name dflt val
  out="$line"
  while [[ "$out" =~ \$\{([^}]+)\} ]]; do
    expr="${BASH_REMATCH[1]}"
    if [[ "$expr" == *":-"* ]]; then
      name="${expr%%:-*}"; dflt="${expr#*:-}"
      val="${!name:-$dflt}"
    elif [[ "$expr" == *":?"* ]]; then
      name="${expr%%:?*}"; dflt="${expr#*:?}"
      if [[ -z "${!name:-}" ]]; then echo "ERROR: $dflt" >&2; return 1; fi
      val="${!name}"
    else
      val="${!expr:-}"
    fi
    out="${out//"\${$expr}"/$val}"
  done
  printf '%s\n' "$out"
}

active_tag_healthy() {
  local file="${COMPOSE_FILE:-docker-compose.yml}"
  [[ -f "$file" ]] || return 0
  grep -q 'wotbtools-backend:sha-A' "$file"
}

COMPOSE_FILE=""
cmd="${1:-}"; shift || true
case "$cmd" in
  compose)
    sub=""
    while [[ $# -gt 0 ]]; do
      case "$1" in
        -f) COMPOSE_FILE="$2"; shift 2 ;;
        -d|--remove-orphans|-T) shift ;;
        config|pull|up|ps|exec|logs) sub="$1"; shift ;;
        *) shift ;;
      esac
    done
    case "$sub" in
      config)
        while IFS= read -r line || [[ -n "$line" ]]; do resolve_line "$line"; done < "$COMPOSE_FILE"
        ;;
      pull) exit 0 ;;
      up) exit 0 ;;
      ps) printf 'wotb-backend Up\ntest Up\n' ;;
      exec)
        if active_tag_healthy; then
          # non-empty stdout so pg_dump / pg_restore validation passes
          printf 'mock-pg-dump-data\n'
          exit 0
        fi
        exit 1
        ;;
      logs) exit 0 ;;
      *) exit 0 ;;
    esac
    ;;
  image) exit 0 ;;
  builder) exit 0 ;;
  rm) exit 0 ;;
  *) exit 0 ;;
esac
FAKE_DOCKER
chmod +x "$WORK/bin/docker"

export PATH="$WORK/bin:$PATH"
export WOTB_DIR="$WORK"
export WOTB_COMPOSE_DIR="$WORK"
export WOTB_BACKUP_ROOT="$WORK/backups"
export WOTB_HEALTH_RETRIES=3
export DB_PASSWORD=db-secret KC_ADMIN_PASSWORD=kc-secret WG_APPLICATION_ID=wg-id \
       KEYCLOAK_ADMIN_CLIENT_SECRET=kc-client-secret AI_API_KEY=ai-key \
       GRAFANA_ADMIN_USER=admin GRAFANA_ADMIN_PASSWORD=grafana-secret

fail() { echo "FAIL: $*" >&2; exit 1; }

# WG application ID must reach both consumers: Keycloak IdP and backend hundred-battle verification.
wg_application_id_injections="$(grep -Fc 'WG_APPLICATION_ID: ${WG_APPLICATION_ID:?WG_APPLICATION_ID is required}' \
  "$WORK/deploy/docker-compose.prod.yml")"
[[ "$wg_application_id_injections" == "2" ]] \
  || fail "production compose must inject WG_APPLICATION_ID into keycloak and backend"

# ---- deadline alignment guard: 400 must fail fast with a clean error; 1100 must pass ----
export TAG=sha-A
set +e
guard_output=$(AI_REVIEW_WORKER_OVERALL_DEADLINE_SEC=400 bash "$WORK/deploy/deploy.sh" 2>&1)
guard_rc=$?
set -e
[[ $guard_rc -ne 0 ]] || fail "deadline=400 must fail the alignment guard"
[[ $guard_rc -eq 3 ]] || fail "deadline=400 must exit with the controlled code 3, got $guard_rc"
grep -q "AI_REVIEW_WORKER_OVERALL_DEADLINE_SEC must be 1100" <<<"$guard_output" \
  || fail "deadline=400 error message missing: $guard_output"
if grep -q "command not found\|No such file or directory" <<<"$guard_output"; then
  fail "deadline=400 must not produce shell errors: $guard_output"
fi

# ---- deploy A (success) ----
export AI_REVIEW_WORKER_OVERALL_DEADLINE_SEC=1100
bash "$WORK/deploy/deploy.sh"
[[ -f "$WORK/DEPLOYED_SHA" ]] || fail "DEPLOYED_SHA missing after deploy A"
[[ "$(cat "$WORK/DEPLOYED_SHA")" == "sha-A" ]] || fail "DEPLOYED_SHA != sha-A after deploy A"
grep -q 'wotbtools-backend:sha-A' "$WORK/docker-compose.yml" || fail "formal compose does not pin sha-A images"
grep -q '\${' "$WORK/docker-compose.yml" && fail "formal compose still contains unresolved \${...}"

# ---- deploy B (health fails) -> must roll back to A ----
export TAG=sha-B
set +e
bash "$WORK/deploy/deploy.sh"
rc=$?
set -e
[[ $rc -ne 0 ]] || fail "deploy B must fail (health check)"
grep -q 'wotbtools-backend:sha-A' "$WORK/docker-compose.yml" || fail "after rollback compose must reference sha-A"
grep -q 'wotbtools-backend:sha-B' "$WORK/docker-compose.yml" && fail "after rollback compose still references sha-B"
[[ "$(cat "$WORK/DEPLOYED_SHA")" == "sha-A" ]] || fail "DEPLOYED_SHA not restored to sha-A"

# ---- independent session: no GitHub Actions temporary env ----
env -i PATH="$PATH" HOME="$WORK" bash -c 'cd "$1" && docker compose -f docker-compose.yml config >/dev/null' _ "$WORK" \
  || fail "compose config fails without deploy env"

# ---- daily backup independent of GH temporary env ----
env -i PATH="$PATH" HOME="$WORK" WOTB_COMPOSE_DIR="$WORK" WOTB_BACKUP_ROOT="$WORK/backups" \
  bash "$WORK/deploy/postgres-backup.sh" --database wotb --skip-retention \
  || fail "postgres-backup.sh fails without deploy env"

echo "OK: deploy A ok; deploy B health failure rolled back to sha-A; compose + backup self-contained"
